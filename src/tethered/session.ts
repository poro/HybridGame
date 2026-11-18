// Runs one game of Tethered: talk -> simultaneous action -> resolve, with logging,
// timeouts, a live snapshot for the browser, and cooperation metrics at the end.

import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Rng } from "../game/rng.js";
import { HumanAgent } from "../players/human.js";
import { compositionClass, compositionKey } from "../models.js";
import type { CallUsage, IdentityGuess, SeatKind, SeatSpec, SurveyReply } from "../types.js";
import { RULES_VERSION, createTethered, resolveRound, sanitizeAction, tDefaultConfig, tRulesText, tViewFor, type TConfig, type TState } from "./engine.js";
import { THumanAgent, TBotAgent, TLlmAgent, type TAgent, type TChat, type TCtx } from "./players.js";

const CALLSIGNS = ["Alder", "Birch", "Cedar", "Dune", "Ember", "Flint", "Grove", "Heath"];

export interface TSessionOptions {
  seats: SeatSpec[];
  revealIdentities: boolean;
  seed?: number;
  game?: Partial<TConfig>;
  condition?: string;
  timeouts?: Partial<{ humanTalkSec: number; humanActSec: number; humanSurveySec: number; aiSec: number }>;
  dataDir?: string;
}

export interface TPlayerSummary {
  playerId: string;
  name: string;
  ropeIndex: number;
  kind: SeatKind;
  label: string;
  summited: boolean;
  summitRound: number | null;
  messages: number;
  words: number;
  climbs: number;
  anchors: number;
  waits: number;
  supportAnchors: number; // anchored while a rope neighbour climbed
  ropeBlocked: number; // moves undone because the rope went taut
  invalid: number;
  falls: number; // uncaught
  slipsCaught: number; // they slipped and were caught
  catches: number; // they caught someone
  dragged: number;
  holdsFelt: number;
  holdsWarned: number; // loose holds they named in chat while knowing they were loose
  warnRate: number | null;
  timeouts: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number | null;
  trustReceivedAvg: number | null;
  guessedAsAi: number;
  guessedAsHuman: number;
  guessAccuracy: number | null;
}

export interface TSummary {
  game: "tethered";
  rulesVersion: number;
  sessionId: string;
  createdAt: string;
  condition: string | null;
  seed: number;
  revealIdentities: boolean;
  compositionClass: string;
  compositionKey: string;
  nPlayers: number;
  won: boolean;
  summited: number;
  injuries: number;
  endRound: number;
  outcomeReason: string;
  players: TPlayerSummary[];
}

export class TSession extends EventEmitter {
  readonly game = "tethered" as const;
  readonly id: string;
  readonly opts: TSessionOptions;
  readonly state: TState;
  readonly playerIds: string[];
  readonly agents = new Map<string, TAgent>();
  readonly humanAgents = new Map<string, HumanAgent>();
  readonly seatOf = new Map<string, SeatSpec>();
  readonly humanTokens = new Map<string, string>();
  readonly observerToken = randomBytes(8).toString("hex");
  readonly chat: TChat[] = [];
  readonly notes: { playerId: string; round: number; phase: string; note: string }[] = [];
  readonly usage: (CallUsage & { playerId: string; round: number; phase: string })[] = [];
  readonly events: { type: string; playerId?: string; round?: number; detail?: string }[] = [];
  readonly surveys: Record<string, SurveyReply> = {};
  readonly warnings: Record<string, Set<string>> = {};
  readonly felt: Record<string, Set<string>> = {};
  readonly createdAt = new Date().toISOString();
  phase: { name: "lobby" | "talk" | "act" | "survey" | "finished"; round: number; chatRound: number; waitingOn: string[]; deadlineMs?: number } = {
    name: "lobby",
    round: 0,
    chatRound: 0,
    waitingOn: [],
  };
  summary: TSummary | null = null;
  private rng: Rng;
  private logPath: string;
  private dataDir: string;
  private t = { humanTalkSec: 90, humanActSec: 90, humanSurveySec: 600, aiSec: 180 };

  constructor(opts: TSessionOptions) {
    super();
    this.opts = opts;
    Object.assign(this.t, opts.timeouts);
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(seed ^ 0x7e7);
    this.id = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}_${randomBytes(3).toString("hex")}`;
    const n = opts.seats.length;
    if (n < 2 || n > 5) throw new Error(`Tethered needs 2-5 climbers, got ${n}`);
    const names = this.rng.shuffle(CALLSIGNS).slice(0, n);
    this.playerIds = names.map((_, i) => `p${i + 1}`);
    // Rope order is shuffled too, so seat 1 isn't always the leader.
    const order = this.rng.shuffle(this.playerIds.map((id, i) => ({ id, name: names[i] })));
    this.state = createTethered({ ...tDefaultConfig(seed), ...opts.game, seed }, order);
    opts.seats.forEach((seat, i) => {
      const pid = this.playerIds[i];
      this.seatOf.set(pid, seat);
      this.warnings[pid] = new Set();
      this.felt[pid] = new Set();
      if (seat.kind === "human") {
        const h = new HumanAgent(seat, pid);
        this.humanTokens.set(randomBytes(8).toString("hex"), pid);
        h.on("request", () => this.emit("update"));
        h.on("resolved", () => this.emit("update"));
        this.humanAgents.set(pid, h);
        this.agents.set(pid, new THumanAgent(seat, h));
      } else if (seat.kind === "bot") this.agents.set(pid, new TBotAgent(seat, seed + i * 7919));
      else this.agents.set(pid, new TLlmAgent(seat));
    });
    this.dataDir = opts.dataDir ?? path.resolve("data/games");
    mkdirSync(this.dataDir, { recursive: true });
    this.logPath = path.join(this.dataDir, `${this.id}.jsonl`);
  }

  name(pid: string) {
    return this.state.climbers.find((c) => c.id === pid)!.name;
  }
  humans() {
    return [...this.humanAgents.values()];
  }
  humanFor(pid: string) {
    return this.humanAgents.get(pid) ?? null;
  }
  progress() {
    return this.state.round;
  }

  identityBrief(pid: string): string {
    if (!this.opts.revealIdentities) return "Your teammates may be humans or AI models — you have not been told which.";
    const me = this.seatOf.get(pid)!;
    const self = me.kind === "human" ? "You are a human player." : `You are an AI model (${me.label}).`;
    const others = this.playerIds
      .filter((id) => id !== pid)
      .map((id) => {
        const s = this.seatOf.get(id)!;
        return `${this.name(id)} is ${s.kind === "human" ? "a human" : s.kind === "bot" ? "a scripted bot" : `an AI model (${s.label})`}`;
      });
    return `${self} Your teammates: ${others.join("; ")}.`;
  }

  private log(type: string, data: Record<string, unknown> = {}) {
    appendFileSync(this.logPath, JSON.stringify({ t: new Date().toISOString(), game: "tethered", type, ...data }) + "\n");
  }

  private async guard<T>(pid: string, p: Promise<T>, ms: number, fallback: T, what: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        this.events.push({ type: "timeout", playerId: pid, round: this.state.round, detail: what });
        this.log("timeout", { playerId: pid, what });
        this.humanFor(pid)?.cancel();
        resolve(fallback);
      }, ms);
    });
    try {
      return await Promise.race([
        p.catch((e) => {
          const detail = e instanceof Error ? e.message : String(e);
          this.events.push({ type: "error", playerId: pid, round: this.state.round, detail: `${what}: ${detail}` });
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

  private limit(pid: string, kind: "talk" | "act" | "survey") {
    if (!this.humanAgents.has(pid)) return this.t.aiSec * 1000;
    return (kind === "talk" ? this.t.humanTalkSec : kind === "act" ? this.t.humanActSec : this.t.humanSurveySec) * 1000;
  }

  private ctx(pid: string, chatRound: number, deadlineMs?: number): TCtx {
    return {
      rules: tRulesText(this.state.config, this.playerIds.length),
      identityBrief: this.identityBrief(pid),
      view: tViewFor(this.state, pid),
      chat: this.chat,
      narrative: this.state.history.map((h) => ({ round: h.round, lines: h.narrative })),
      chatRound,
      chatRounds: this.state.config.chatRounds,
      deadlineMs,
    };
  }

  private afterCall(pid: string, phase: string, note?: string) {
    const a = this.agents.get(pid)!;
    if (a.lastUsage) {
      this.usage.push({ ...a.lastUsage, playerId: pid, round: this.state.round, phase });
      a.lastUsage = null;
    }
    if (note && note.trim()) this.notes.push({ playerId: pid, round: this.state.round, phase, note: note.trim() });
  }

  async run(): Promise<TSummary> {
    const s = this.state;
    this.log("session_start", {
      id: this.id,
      rulesVersion: RULES_VERSION,
      condition: this.opts.condition ?? null,
      revealIdentities: this.opts.revealIdentities,
      config: s.config,
      terrain: s.terrain,
      loose: s.loose,
      players: s.climbers.map((c) => ({ ...c, seat: this.seatOf.get(c.id) })),
    });
    for (const id of this.playerIds) for (const t of s.known[id]) this.felt[id].add(t);

    while (!s.outcome) {
      const round = s.round;
      for (let cr = 1; cr <= s.config.chatRounds; cr++) {
        // Talk order follows the rope from the top climber down, which reads naturally.
        const order = [...s.climbers].sort((a, b) => b.y - a.y || a.ropeIndex - b.ropeIndex).map((c) => c.id);
        for (const pid of order) {
          const ms = this.limit(pid, "talk");
          this.phase = { name: "talk", round, chatRound: cr, waitingOn: [pid], deadlineMs: Date.now() + ms };
          this.emit("update");
          const t0 = Date.now();
          const reply = await this.guard(pid, this.agents.get(pid)!.discuss(this.ctx(pid, cr, Date.now() + ms)), ms, { message: "" }, `talk r${round}`);
          this.afterCall(pid, "talk", reply.note);
          const text = reply.message.trim();
          if (text) {
            const msg: TChat = { round, chatRound: cr, from: pid, fromName: this.name(pid), text, ts: Date.now() };
            this.chat.push(msg);
            const known = s.known[pid];
            for (const tile of text.toUpperCase().match(/\b[A-G]\d{1,2}\b/g) ?? []) if (known.includes(tile)) this.warnings[pid].add(tile);
          }
          this.log("chat", { round, chatRound: cr, playerId: pid, name: this.name(pid), text, note: reply.note ?? null, memo: reply.memo ?? null, latencyMs: Date.now() - t0 });
          this.emit("update");
        }
      }

      const ids = [...this.playerIds];
      this.phase = { name: "act", round, chatRound: 0, waitingOn: [...ids], deadlineMs: Date.now() + Math.max(...ids.map((id) => this.limit(id, "act"))) };
      this.emit("update");
      const actions: Record<string, unknown> = {};
      await Promise.all(
        ids.map(async (pid) => {
          const ms = this.limit(pid, "act");
          const t0 = Date.now();
          const reply = await this.guard(pid, this.agents.get(pid)!.act(this.ctx(pid, 0, Date.now() + ms)), ms, { action: { type: "wait" as const, dir: null } }, `act r${round}`);
          actions[pid] = reply.action;
          this.afterCall(pid, "act", reply.note);
          this.log("action", { round, playerId: pid, raw: reply.action, sanitized: sanitizeAction(reply.action), note: reply.note ?? null, memo: reply.memo ?? null, latencyMs: Date.now() - t0 });
          this.phase.waitingOn = this.phase.waitingOn.filter((x) => x !== pid);
          this.emit("update");
        }),
      );
      const result = resolveRound(s, actions);
      for (const id of this.playerIds) for (const t of s.known[id]) this.felt[id].add(t);
      this.log("round_resolved", { result, injuries: s.injuries, climbers: s.climbers, loose: s.loose });
      this.emit("update");
    }

    this.log("game_over", { outcome: s.outcome });
    this.phase = { name: "survey", round: s.round, chatRound: 0, waitingOn: [...this.playerIds] };
    this.emit("update");
    await Promise.all(
      this.playerIds.map(async (pid) => {
        const ms = this.limit(pid, "survey");
        const reply = await this.guard(pid, this.agents.get(pid)!.survey(this.ctx(pid, 0, Date.now() + ms)), ms, { ratings: [], reflection: "" }, "survey");
        this.afterCall(pid, "survey");
        this.surveys[pid] = reply;
        this.log("survey", { playerId: pid, reply });
        this.phase.waitingOn = this.phase.waitingOn.filter((x) => x !== pid);
        this.emit("update");
      }),
    );
    this.summary = this.computeSummary();
    this.log("summary", { summary: this.summary });
    writeFileSync(path.join(this.dataDir, `${this.id}.summary.json`), JSON.stringify(this.summary, null, 2));
    this.phase = { name: "finished", round: s.round, chatRound: 0, waitingOn: [] };
    this.emit("update");
    return this.summary;
  }

  private computeSummary(): TSummary {
    const s = this.state;
    const o = s.outcome!;
    const players = s.climbers.map((c): TPlayerSummary => {
      const seat = this.seatOf.get(c.id)!;
      const msgs = this.chat.filter((m) => m.from === c.id);
      const p: TPlayerSummary = {
        playerId: c.id,
        name: c.name,
        ropeIndex: c.ropeIndex,
        kind: seat.kind,
        label: seat.label,
        summited: c.onSummit,
        summitRound: null,
        messages: msgs.length,
        words: msgs.reduce((a, m) => a + m.text.split(/\s+/).filter(Boolean).length, 0),
        climbs: 0,
        anchors: 0,
        waits: 0,
        supportAnchors: 0,
        ropeBlocked: 0,
        invalid: 0,
        falls: 0,
        slipsCaught: 0,
        catches: 0,
        dragged: 0,
        holdsFelt: this.felt[c.id].size,
        holdsWarned: this.warnings[c.id].size,
        warnRate: this.felt[c.id].size ? this.warnings[c.id].size / this.felt[c.id].size : null,
        timeouts: this.events.filter((e) => e.type === "timeout" && e.playerId === c.id).length,
        errors: this.events.filter((e) => e.type === "error" && e.playerId === c.id).length,
        inputTokens: 0,
        outputTokens: 0,
        avgLatencyMs: null,
        trustReceivedAvg: null,
        guessedAsAi: 0,
        guessedAsHuman: 0,
        guessAccuracy: null,
      };
      const nbs = s.climbers.filter((x) => Math.abs(x.ropeIndex - c.ropeIndex) === 1).map((x) => x.id);
      for (const h of s.history) {
        const a = h.actions[c.id];
        if (a.type === "climb") p.climbs++;
        if (a.type === "anchor") p.anchors++;
        if (a.type === "wait") p.waits++;
        if (a.type === "anchor" && nbs.some((n) => h.actions[n]?.type === "climb")) p.supportAnchors++;
        for (const f of h.frames)
          for (const e of f.effects) {
            if (e.climber === c.id && e.kind === "taut") p.ropeBlocked++;
            if (e.climber === c.id && e.kind === "invalid") p.invalid++;
            if (e.climber === c.id && e.kind === "fall") p.falls++;
            if (e.climber === c.id && e.kind === "caught") p.slipsCaught++;
            if (e.by === c.id && e.kind === "caught") p.catches++;
            if (e.climber === c.id && e.kind === "dragged") p.dragged++;
            if (e.climber === c.id && e.kind === "summit") p.summitRound = h.round;
          }
      }
      const u = this.usage.filter((x) => x.playerId === c.id);
      p.inputTokens = u.reduce((a, x) => a + x.inputTokens, 0);
      p.outputTokens = u.reduce((a, x) => a + x.outputTokens, 0);
      if (u.length) p.avgLatencyMs = Math.round(u.reduce((a, x) => a + x.latencyMs, 0) / u.length);
      const about = Object.entries(this.surveys)
        .filter(([r]) => r !== c.id)
        .flatMap(([, r]) => r.ratings.filter((x) => x.playerId === c.id));
      if (about.length) p.trustReceivedAvg = about.reduce((a, x) => a + x.trust, 0) / about.length;
      p.guessedAsAi = about.filter((x) => x.guess === "ai").length;
      p.guessedAsHuman = about.filter((x) => x.guess === "human").length;
      const mine = this.surveys[c.id]?.ratings ?? [];
      if (mine.length) {
        const truth = (pid: string): IdentityGuess => (this.seatOf.get(pid)!.kind === "human" ? "human" : "ai");
        p.guessAccuracy = mine.filter((r) => r.guess !== "unsure" && r.guess === truth(r.playerId)).length / mine.length;
      }
      return p;
    });
    return {
      game: "tethered",
      rulesVersion: RULES_VERSION,
      sessionId: this.id,
      createdAt: this.createdAt,
      condition: this.opts.condition ?? null,
      seed: s.config.seed,
      revealIdentities: this.opts.revealIdentities,
      compositionClass: compositionClass(this.opts.seats),
      compositionKey: compositionKey(this.opts.seats),
      nPlayers: s.climbers.length,
      won: o.won,
      summited: o.summited.length,
      injuries: o.injuries,
      endRound: o.endRound,
      outcomeReason: o.reason,
      players,
    };
  }

  // -------------------------------------------------------------------------

  snapshotFor(pid: string | null) {
    const s = this.state;
    const observer = pid === null;
    const over = this.phase.name === "survey" || this.phase.name === "finished";
    const showLabels = observer || this.opts.revealIdentities || this.phase.name === "finished";
    const h = pid ? this.humanFor(pid) : null;
    const view = pid ? tViewFor(s, pid) : null;
    return {
      game: "tethered",
      rulesVersion: RULES_VERSION,
      sessionId: this.id,
      observer,
      you: pid,
      phase: this.phase,
      config: s.config,
      rules: tRulesText(s.config, this.playerIds.length),
      identityBrief: pid ? this.identityBrief(pid) : null,
      round: s.round,
      terrain: s.terrain,
      climbers: s.climbers,
      injuries: s.injuries,
      // Loose holds: observers see all; players only what they've felt (and the whole map once it's over).
      loose: observer || over ? s.loose.flatMap((row, y) => row.flatMap((l, x) => (l ? [`${"ABCDEFG"[x]}${y + 1}`] : []))) : view!.knownLoose,
      players: s.climbers.map((c) => ({
        id: c.id,
        name: c.name,
        ropeIndex: c.ropeIndex,
        label: showLabels ? this.seatOf.get(c.id)!.label : null,
        kind: showLabels ? this.seatOf.get(c.id)!.kind : null,
        connected: this.humanAgents.has(c.id) ? this.humanAgents.get(c.id)!.connected > 0 : null,
      })),
      chat: this.chat,
      history: s.history.map((r) => ({
        round: r.round,
        actions: r.actions,
        narrative: r.narrative,
        frames: r.frames.map((f) => ({ ...f, loose: observer || over ? f.loose : undefined })),
      })),
      outcome: s.outcome,
      pending: h?.pending ? { kind: h.pending.kind, round: h.pending.round, deadlineMs: h.pending.deadlineMs } : null,
      surveyDone: pid ? Boolean(this.surveys[pid]) : null,
      notes: observer ? this.notes : null,
      usage: observer ? { calls: this.usage.length, tokens: this.usage.reduce((a, u) => a + u.inputTokens + u.outputTokens, 0) } : null,
      events: observer ? this.events : null,
      summary: observer || this.phase.name === "finished" ? this.summary : null,
      surveys: observer ? this.surveys : null,
      joinLinks: observer ? [...this.humanTokens.entries()].map(([token, playerId]) => ({ playerId, name: this.name(playerId), token })) : null,
    };
  }
}
