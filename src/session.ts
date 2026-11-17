// A Session runs one game of OUTPOST with a given roster of seats, drives every
// phase, enforces timeouts, and writes a full JSONL log + summary for analysis.

import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  ACTION_TYPES,
  SITES,
  createGame,
  defaultConfig,
  resolveDay,
  rulesText,
  sanitizeAction,
  viewFor,
  type Action,
  type OutpostConfig,
  type OutpostState,
} from "./game/outpost.js";
import { Rng } from "./game/rng.js";
import { BotAgent } from "./players/bot.js";
import { HumanAgent } from "./players/human.js";
import { ClaudeAgent, OpenAIAgent } from "./players/llm.js";
import { computeSummary, type GameSummary } from "./metrics.js";
import type { Agent, CallUsage, ChatMessage, Pledge, SeatSpec, SurveyReply } from "./types.js";

const CALLSIGNS = ["Alder", "Birch", "Cedar", "Dune", "Ember", "Flint", "Grove", "Heath"];

export interface SessionOptions {
  seats: SeatSpec[];
  revealIdentities: boolean;
  seed?: number;
  game?: Partial<OutpostConfig>;
  condition?: string; // free-text experiment label, e.g. "pilot-blind"
  timeouts?: Partial<Timeouts>;
  dataDir?: string;
}

export interface Timeouts {
  humanDiscussSec: number;
  humanActSec: number;
  humanSurveySec: number;
  aiSec: number;
}

const DEFAULT_TIMEOUTS: Timeouts = { humanDiscussSec: 90, humanActSec: 120, humanSurveySec: 600, aiSec: 180 };

export interface Phase {
  name: "lobby" | "discuss" | "act" | "survey" | "finished";
  day: number;
  round: number;
  waitingOn: string[];
  deadlineMs?: number;
}

export interface NoteRecord {
  playerId: string;
  day: number;
  phase: string;
  note: string;
}

export interface UsageRecord extends CallUsage {
  playerId: string;
  day: number;
  phase: string;
}

export class Session extends EventEmitter {
  readonly game = "outpost" as const;
  readonly id: string;
  readonly opts: SessionOptions;
  readonly timeouts: Timeouts;
  readonly state: OutpostState;
  readonly playerIds: string[];
  readonly agents = new Map<string, Agent>();
  readonly seatOf = new Map<string, SeatSpec>();
  readonly humanTokens = new Map<string, string>(); // token -> playerId
  readonly observerToken: string;
  readonly chat: ChatMessage[] = [];
  readonly pledgesByDay: Record<number, Record<string, Pledge | null>> = {};
  readonly notes: NoteRecord[] = [];
  readonly usage: UsageRecord[] = [];
  readonly events: { type: string; playerId?: string; day?: number; detail?: string }[] = [];
  readonly surveys: Record<string, SurveyReply> = {};
  readonly createdAt = new Date().toISOString();
  phase: Phase = { name: "lobby", day: 0, round: 0, waitingOn: [] };
  summary: GameSummary | null = null;
  private rng: Rng;
  private logPath: string;
  private dataDir: string;

  constructor(opts: SessionOptions) {
    super();
    this.opts = opts;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(seed ^ 0x5eed);
    this.id = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}_${randomBytes(3).toString("hex")}`;
    this.observerToken = randomBytes(8).toString("hex");
    const n = opts.seats.length;
    if (n < 2 || n > CALLSIGNS.length) throw new Error(`Need 2-${CALLSIGNS.length} seats, got ${n}`);
    const names = this.rng.shuffle(CALLSIGNS).slice(0, n);
    this.playerIds = names.map((_, i) => `p${i + 1}`);
    const config = { ...defaultConfig(n, seed), ...opts.game, seed };
    this.state = createGame(
      config,
      this.playerIds.map((id, i) => ({ id, name: names[i] })),
    );
    opts.seats.forEach((seat, i) => {
      const pid = this.playerIds[i];
      this.seatOf.set(pid, seat);
      let agent: Agent;
      if (seat.kind === "human") {
        const h = new HumanAgent(seat, pid);
        this.humanTokens.set(randomBytes(8).toString("hex"), pid);
        h.on("request", () => this.emit("update"));
        h.on("resolved", () => this.emit("update"));
        agent = h;
      } else if (seat.kind === "anthropic") agent = new ClaudeAgent(seat);
      else if (seat.kind === "openai") agent = new OpenAIAgent(seat);
      else agent = new BotAgent(seat, seed + i * 7919);
      this.agents.set(pid, agent);
    });
    this.dataDir = opts.dataDir ?? path.resolve("data/games");
    mkdirSync(this.dataDir, { recursive: true });
    this.logPath = path.join(this.dataDir, `${this.id}.jsonl`);
  }

  // -------------------------------------------------------------------------

  name(pid: string) {
    return this.state.players.find((p) => p.id === pid)!.name;
  }

  humanFor(pid: string): HumanAgent | null {
    const a = this.agents.get(pid);
    return a instanceof HumanAgent ? a : null;
  }

  progress() {
    return this.state.day;
  }

  humans(): HumanAgent[] {
    return [...this.agents.values()].filter((a): a is HumanAgent => a instanceof HumanAgent);
  }

  /** What `pid` is told about who their teammates are. */
  identityBrief(pid: string): string {
    const me = this.seatOf.get(pid)!;
    if (!this.opts.revealIdentities) {
      return "Your teammates may be humans or AI models — you have not been told which.";
    }
    const self = me.kind === "human" ? "You are a human player." : `You are an AI model (${me.label}).`;
    const others = this.playerIds
      .filter((id) => id !== pid)
      .map((id) => {
        const s = this.seatOf.get(id)!;
        return `${this.name(id)} is ${s.kind === "human" ? "a human" : s.kind === "bot" ? "a scripted bot" : `an AI model (${s.label})`}`;
      });
    return `${self} Your teammates: ${others.join("; ")}.`;
  }

  rules() {
    return rulesText(this.state.config, this.playerIds.length);
  }

  private log(type: string, data: Record<string, unknown> = {}) {
    appendFileSync(this.logPath, JSON.stringify({ t: new Date().toISOString(), type, ...data }) + "\n");
  }

  private async withTimeout<T>(pid: string, p: Promise<T>, ms: number, fallback: T, what: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        this.events.push({ type: "timeout", playerId: pid, day: this.state.day, detail: what });
        this.log("timeout", { playerId: pid, what });
        const a = this.agents.get(pid);
        if (a instanceof HumanAgent) a.cancel();
        resolve(fallback);
      }, ms);
    });
    try {
      return await Promise.race([
        p.catch((e) => {
          const detail = e instanceof Error ? e.message : String(e);
          this.events.push({ type: "error", playerId: pid, day: this.state.day, detail: `${what}: ${detail}` });
          this.log("agent_error", { playerId: pid, what, error: detail });
          console.error(`[${this.id}] ${this.name(pid)} (${this.seatOf.get(pid)!.label}) ${what} failed: ${detail}`);
          return fallback;
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private recordUsage(pid: string, phase: string) {
    const u = this.agents.get(pid)!.lastUsage;
    if (u) {
      this.usage.push({ ...u, playerId: pid, day: this.state.day, phase });
      this.agents.get(pid)!.lastUsage = null;
    }
  }

  private recordNote(pid: string, phase: string, note?: string) {
    if (note && note.trim()) this.notes.push({ playerId: pid, day: this.state.day, phase, note: note.trim() });
  }

  private cleanPledge(pid: string, p: Pledge | null | undefined): Pledge | null {
    if (!p || !ACTION_TYPES.includes(p.type)) return null;
    const site = p.type === "salvage" && SITES.includes(p.site as any) ? p.site : null;
    const target = p.type === "heal" && p.target && p.target !== pid && this.playerIds.includes(p.target) ? p.target : null;
    if (p.type === "salvage" && !site) return null;
    if (p.type === "heal" && !target) return null;
    return { type: p.type, site, target };
  }

  // -------------------------------------------------------------------------

  async run(): Promise<GameSummary> {
    const s = this.state;
    this.log("session_start", {
      id: this.id,
      condition: this.opts.condition ?? null,
      revealIdentities: this.opts.revealIdentities,
      config: s.config,
      players: s.players.map((p) => ({ id: p.id, name: p.name, role: p.role, seat: this.seatOf.get(p.id) })),
      partsSiteByDay: s.partsSiteByDay,
      eventByDay: s.eventByDay,
    });
    const ms = (sec: number) => sec * 1000;

    while (!s.outcome) {
      const day = s.day;
      const pledges: Record<string, Pledge | null> = {};
      this.pledgesByDay[day] = pledges;

      for (let round = 1; round <= s.config.discussionRounds; round++) {
        const order = this.rng.shuffle(s.players.filter((p) => p.alive).map((p) => p.id));
        for (const pid of order) {
          const agent = this.agents.get(pid)!;
          const isHuman = agent instanceof HumanAgent;
          const limit = isHuman ? ms(this.timeouts.humanDiscussSec) : ms(this.timeouts.aiSec);
          const deadlineMs = Date.now() + limit;
          this.phase = { name: "discuss", day, round, waitingOn: [pid], deadlineMs };
          this.emit("update");
          const t0 = Date.now();
          const reply = await this.withTimeout(
            pid,
            agent.discuss({
              rules: this.rules(),
              identityBrief: this.identityBrief(pid),
              view: viewFor(s, pid),
              chat: this.chat,
              todaysPledges: { ...pledges },
              round,
              rounds: s.config.discussionRounds,
              deadlineMs,
            }),
            limit,
            { message: "", pledge: null },
            `discuss d${day}r${round}`,
          );
          this.recordUsage(pid, `discuss r${round}`);
          this.recordNote(pid, `discuss r${round}`, reply.note);
          const pledge = this.cleanPledge(pid, reply.pledge);
          const pledgeChanged = Boolean(pledge) && JSON.stringify(pledge) !== JSON.stringify(pledges[pid] ?? null);
          if (pledge) pledges[pid] = pledge;
          const msg: ChatMessage = { day, round, from: pid, fromName: this.name(pid), text: reply.message.trim(), pledge, ts: Date.now() };
          // Post to chat if they said something, or silently changed their pledge.
          if (msg.text || pledgeChanged) this.chat.push(msg);
          this.log("chat", { ...msg, latencyMs: Date.now() - t0, note: reply.note ?? null, memo: reply.memo ?? null });
          this.emit("update");
        }
      }

      const alive = s.players.filter((p) => p.alive).map((p) => p.id);
      const actLimit = (pid: string) => (this.agents.get(pid) instanceof HumanAgent ? ms(this.timeouts.humanActSec) : ms(this.timeouts.aiSec));
      this.phase = { name: "act", day, round: 0, waitingOn: [...alive], deadlineMs: Date.now() + Math.max(...alive.map(actLimit)) };
      this.emit("update");
      const actions: Record<string, Partial<Action>> = {};
      await Promise.all(
        alive.map(async (pid) => {
          const t0 = Date.now();
          const reply = await this.withTimeout(
            pid,
            this.agents.get(pid)!.act({
              rules: this.rules(),
              identityBrief: this.identityBrief(pid),
              view: viewFor(s, pid),
              chat: this.chat,
              todaysPledges: { ...pledges },
              round: 0,
              rounds: s.config.discussionRounds,
              deadlineMs: Date.now() + actLimit(pid),
            }),
            actLimit(pid),
            { action: { type: "rest" } },
            `act d${day}`,
          );
          actions[pid] = reply.action;
          this.recordUsage(pid, "act");
          this.recordNote(pid, "act", reply.note);
          this.log("action", {
            playerId: pid,
            day,
            raw: reply.action,
            sanitized: sanitizeAction(s, pid, reply.action),
            latencyMs: Date.now() - t0,
            note: reply.note ?? null,
            memo: reply.memo ?? null,
          });
          this.phase.waitingOn = this.phase.waitingOn.filter((x) => x !== pid);
          this.emit("update");
        }),
      );

      const result = resolveDay(s, actions);
      this.log("day_resolved", { result, state: { campFood: s.campFood, shelter: s.shelter, parts: s.parts, players: s.players } });
      this.emit("update");
    }

    this.log("game_over", { outcome: s.outcome });
    this.phase = { name: "survey", day: s.day, round: 0, waitingOn: [...this.playerIds] };
    this.emit("update");
    await Promise.all(
      this.playerIds.map(async (pid) => {
        const agent = this.agents.get(pid)!;
        const limit = agent instanceof HumanAgent ? ms(this.timeouts.humanSurveySec) : ms(this.timeouts.aiSec);
        const reply = await this.withTimeout(
          pid,
          agent.survey({ rules: this.rules(), identityBrief: this.identityBrief(pid), view: viewFor(s, pid), chat: this.chat, deadlineMs: Date.now() + limit }),
          limit,
          { ratings: [], reflection: "" },
          "survey",
        );
        this.recordUsage(pid, "survey");
        this.surveys[pid] = reply;
        this.log("survey", { playerId: pid, reply });
        this.phase.waitingOn = this.phase.waitingOn.filter((x) => x !== pid);
        this.emit("update");
      }),
    );

    this.summary = computeSummary(this);
    this.log("summary", { summary: this.summary });
    writeFileSync(path.join(this.dataDir, `${this.id}.summary.json`), JSON.stringify(this.summary, null, 2));
    this.phase = { name: "finished", day: s.day, round: 0, waitingOn: [] };
    this.emit("update");
    return this.summary;
  }

  // -------------------------------------------------------------------------
  // Snapshots for the web UI.

  snapshotFor(pid: string | null) {
    const s = this.state;
    const observer = pid === null;
    const finished = this.phase.name === "finished" || this.phase.name === "survey";
    const showLabels = observer || this.opts.revealIdentities || this.phase.name === "finished";
    const agent = pid ? this.agents.get(pid) : undefined;
    const pending = agent instanceof HumanAgent && agent.pending ? { kind: agent.pending.kind, round: agent.pending.round, deadlineMs: agent.pending.deadlineMs } : null;
    return {
      sessionId: this.id,
      observer,
      phase: this.phase,
      day: s.day,
      config: s.config,
      rules: this.rules(),
      identityBrief: pid ? this.identityBrief(pid) : null,
      you: pid,
      view: pid ? viewFor(s, pid) : null,
      chat: this.chat,
      todaysPledges: this.pledgesByDay[s.day] ?? {},
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        alive: p.alive,
        label: showLabels ? this.seatOf.get(p.id)!.label : null,
        kind: showLabels ? this.seatOf.get(p.id)!.kind : null,
        connected: (() => {
          const a = this.agents.get(p.id);
          return a instanceof HumanAgent ? a.connected > 0 : null;
        })(),
        // Observers see everything.
        health: observer || finished ? p.health : undefined,
        pouch: observer || finished ? p.pouch : undefined,
      })),
      history: s.history.map((h) => ({
        day: h.day,
        event: h.event,
        narrative: h.narrative,
        campFoodAfter: h.campFoodAfter,
        shelterAfter: h.shelterAfter,
        partsAfter: h.partsAfter,
        // Actions are public once revealed; food gained and exact health are not (pouches/health are private).
        outcomes: h.outcomes.map((o) =>
          observer || finished
            ? o
            : { ...o, foodGained: o.foodGained ? -1 : 0, healed: 0, healthBefore: null, healthAfter: o.playerId === pid ? o.healthAfter : null },
        ),
      })),
      outcome: s.outcome,
      pending,
      surveyDone: pid ? Boolean(this.surveys[pid]) : null,
      observerExtra: observer
        ? {
            campFood: s.campFood,
            shelter: s.shelter,
            parts: s.parts,
            partsSiteToday: s.partsSiteByDay[s.day - 1],
            eventTonight: s.eventByDay[s.day - 1],
            notes: this.notes,
            usage: this.usage,
            events: this.events,
            surveys: this.surveys,
            summary: this.summary,
            joinLinks: [...this.humanTokens.entries()].map(([token, playerId]) => ({ playerId, name: this.name(playerId), token })),
          }
        : null,
    };
  }
}
