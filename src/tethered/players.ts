// Players for Tethered: language models, scripted bots, and humans (via the browser).

import { Rng } from "../game/rng.js";
import { HumanAgent } from "../players/human.js";
import { modelJson } from "../players/llm.js";
import { surveyInstruction, surveySchema } from "../players/prompt.js";
import type { CallUsage, SeatSpec, SurveyReply } from "../types.js";
import {
  DIRS,
  HEIGHT,
  ROPE,
  WIDTH,
  climbable,
  dist,
  parseTile,
  safeFooting,
  tileName,
  wallText,
  type Dir,
  type TAction,
  type TView,
  type Terrain,
} from "./engine.js";

export interface TChat {
  round: number;
  chatRound: number;
  from: string;
  fromName: string;
  text: string;
  ts: number;
}

export interface TCtx {
  rules: string;
  identityBrief: string;
  view: TView;
  chat: TChat[];
  narrative: { round: number; lines: string[] }[];
  chatRound: number;
  chatRounds: number;
  deadlineMs?: number;
}

export interface TAgent {
  readonly seat: SeatSpec;
  lastUsage: CallUsage | null;
  // note: what researchers see (Claude's thinking summary, or the memo); memo: the model's reminder to itself
  discuss(ctx: TCtx): Promise<{ message: string; note?: string; memo?: string }>;
  act(ctx: TCtx): Promise<{ action: TAction; note?: string; memo?: string }>;
  survey(ctx: TCtx): Promise<SurveyReply>;
}

const DELTA: Record<Dir, [number, number]> = { N: [0, 1], NE: [1, 1], NW: [-1, 1], E: [1, 0], W: [-1, 0], S: [0, -1], SE: [1, -1], SW: [-1, -1] };
const TERRAIN_WORD: Record<Terrain, string> = { rock: "rock hold", ledge: "ledge (safe)", slab: "slab", summit: "SUMMIT", ground: "ground (safe)" };

function ropeNeighbours(v: TView, id: string) {
  const me = v.climbers.find((c) => c.id === id)!;
  return v.climbers.filter((c) => Math.abs(c.ropeIndex - me.ropeIndex) === 1);
}

/** Moves from the current tile, with whether the rope allows them if neighbours stay put. */
export function moveOptions(v: TView) {
  const me = v.you;
  const nbs = ropeNeighbours(v, me.id);
  return DIRS.map((d) => {
    const [dx, dy] = DELTA[d];
    const x = me.x + dx, y = me.y + dy;
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return null;
    const t = v.terrain[y][x];
    if (!climbable(t)) return null;
    const ropeOk = nbs.every((n) => dist({ x, y }, n) <= ROPE || dist({ x, y }, n) <= dist(me, n));
    return { dir: d, tile: tileName(x, y), terrain: t, loose: v.knownLoose.includes(tileName(x, y)), ropeOk };
  }).filter((o): o is NonNullable<typeof o> => o !== null);
}

// ---------------------------------------------------------------------------
// Language-model climbers.

const MEMO_HINT = "One or two short sentences: your plan and any promises, for your next turn.";

function system(ctx: TCtx): string {
  const v = ctx.view;
  return `You are playing a cooperative climbing game with other players. Play as a real participant: think, talk to your team naturally, and make your own decisions.

${ctx.rules}

WHO YOU ARE
You are "${v.you.name}", climber #${v.you.ropeIndex + 1} on the rope.
${ctx.identityBrief}

Reply with JSON only, matching the schema. Keep each radio call to one short sentence (two at most, under 25 words): the thing your team most needs to hear. Use tile names like "C5". "memo" is one or two short sentences to remind yourself on later turns of your plan and any promises you made.`;
}

export function situation(ctx: TCtx, notes: string[]): string {
  const v = ctx.view;
  const rope = [...v.climbers].sort((a, b) => a.ropeIndex - b.ropeIndex);
  const lines: string[] = [];
  lines.push(`ROUND ${v.round} of ${v.rounds} (storm after round ${v.rounds}). Team injuries: ${v.injuries}/${v.maxInjuries}.`);
  lines.push(`Rope order: ${rope.map((c) => `${c.name} (#${c.ropeIndex + 1})`).join(" — ")}. Neighbours can be at most ${ROPE} tiles apart.`);
  lines.push("Climbers:");
  for (const c of rope) {
    const t = v.terrain[c.y][c.x];
    lines.push(`- ${c.name}${c.id === v.you.id ? " (YOU)" : ""}: ${tileName(c.x, c.y)} on ${TERRAIN_WORD[t]}${c.onSummit ? " — on the summit" : ""}`);
  }
  for (const n of ropeNeighbours(v, v.you.id)) lines.push(`Rope to ${n.name}: ${dist(v.you, n)} of ${ROPE} tiles used.`);
  lines.push("", `THE WALL (top row = summit; letters are climbers' initials; ! = a loose hold you can see right now):`, wallText(v));
  lines.push("", `Loose holds you can see right now (2 tiles away): ${v.knownLoose.length ? v.knownLoose.join(", ") : "none"}. You cannot judge the holds right next to you — rely on teammates' warnings. Teammates don't see what you see unless you tell them.`);
  if (!v.you.onSummit) {
    lines.push("Your possible climbs (rope check assumes your neighbours stay where they are):");
    lines.push("Remember: a neighbour only catches you if, after this round's moves, they are anchored or standing on a ledge, the ground or the summit.");
    for (const o of moveOptions(v)) {
      lines.push(`- ${o.dir} -> ${o.tile}: ${TERRAIN_WORD[o.terrain]}${o.ropeOk ? "" : ", rope too short unless a neighbour moves closer"}`);
    }
  }
  if (ctx.narrative.length) {
    lines.push("", "WHAT HAPPENED SO FAR:");
    for (const n of ctx.narrative) if (n.lines.length) lines.push(`Round ${n.round}: ${n.lines.join(" ")}`);
  }
  lines.push("", "TEAM CHAT:");
  if (!ctx.chat.length) lines.push("(no messages yet)");
  for (const m of ctx.chat) lines.push(`[Round ${m.round}] ${m.fromName}: ${m.text}`);
  if (notes.length) {
    lines.push("", "YOUR MEMOS FROM EARLIER TURNS:");
    for (const n of notes.slice(-12)) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

export class TLlmAgent implements TAgent {
  lastUsage: CallUsage | null = null;
  readonly notes: string[] = [];
  constructor(readonly seat: SeatSpec) {}

  private async call(sys: string, user: string, schema: object, name: string) {
    const c = await modelJson(this.seat, sys, user, schema, name);
    this.lastUsage = c.usage;
    return c;
  }
  private remember(note: unknown, round: number, phase: string) {
    if (typeof note === "string" && note.trim()) this.notes.push(`(round ${round}, ${phase}) ${note.trim()}`);
  }

  async discuss(ctx: TCtx) {
    const c = await this.call(
      system(ctx),
      situation(ctx, this.notes) + `\n\nIt is the TALK phase (round ${ctx.view.round}). Say something to your rope team, or "" to stay quiet.`,
      { type: "object", additionalProperties: false, required: ["message", "memo"], properties: { message: { type: "string" }, memo: { type: "string", description: MEMO_HINT } } },
      "talk_turn",
    );
    const out = c.json;
    this.remember(out.memo, ctx.view.round, "talk");
    return { message: String(out.message ?? "").slice(0, 400), note: c.thinking ?? out.memo, memo: out.memo };
  }

  async act(ctx: TCtx) {
    const c = await this.call(
      system(ctx),
      situation(ctx, this.notes) + `\n\nIt is the ACTION phase (round ${ctx.view.round}). Choose ONE action: climb (with a direction), anchor, or wait. Everyone chooses at the same time.`,
      {
        type: "object",
        additionalProperties: false,
        required: ["action", "dir", "memo"],
        properties: {
          action: { type: "string", enum: ["climb", "anchor", "wait"] },
          dir: { anyOf: [{ type: "string", enum: [...DIRS] }, { type: "null" }] },
          memo: { type: "string", description: MEMO_HINT },
        },
      },
      "action_turn",
    );
    const out = c.json;
    this.remember(out.memo, ctx.view.round, "action");
    return { action: { type: out.action, dir: out.dir ?? null } as TAction, note: c.thinking ?? out.memo, memo: out.memo };
  }

  async survey(ctx: TCtx): Promise<SurveyReply> {
    const mates = ctx.view.climbers.filter((c) => c.id !== ctx.view.you.id);
    const out = (await this.call(system(ctx), situation(ctx, this.notes) + surveyInstruction(), surveySchema(mates.map((m) => m.name)), "debrief")).json;
    return {
      ratings: (out.ratings ?? [])
        .map((r: any) => ({ playerId: mates.find((m) => m.name === r.player)?.id ?? "", trust: Math.max(1, Math.min(7, Number(r.trust) || 4)), guess: r.guess }))
        .filter((r: any) => r.playerId),
      reflection: String(out.reflection ?? ""),
    };
  }
}

// ---------------------------------------------------------------------------
// Scripted climbers (free baselines).
//   cooperative: warns teammates about loose holds near them, avoids warned holds,
//                anchors for neighbours who are lagging below
//   solo:        never talks or anchors, ignores warnings, just climbs
//   random:      random actions

let distField: number[][] | null = null;
function summitDistance(terrain: Terrain[][]): number[][] {
  if (distField) return distField;
  const d = terrain.map((row) => row.map(() => Infinity));
  const q: [number, number][] = [];
  terrain.forEach((row, y) => row.forEach((t, x) => t === "summit" && (d[y][x] = 0, q.push([x, y]))));
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of Object.values(DELTA)) {
      const nx = x - dx, ny = y - dy; // reverse edge
      if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT || !climbable(terrain[ny][nx]) || d[ny][nx] <= d[y][x] + 1) continue;
      d[ny][nx] = d[y][x] + 1;
      q.push([nx, ny]);
    }
  }
  return (distField = d);
}

export class TBotAgent implements TAgent {
  lastUsage = null;
  private rng: Rng;
  constructor(readonly seat: SeatSpec, seed: number) {
    this.rng = new Rng(seed);
  }
  private get persona() {
    return this.seat.persona === "selfish" ? "solo" : this.seat.persona ?? "cooperative";
  }

  private warned(ctx: TCtx): string[] {
    // Loose holds teammates have warned about in chat this round or last.
    return ctx.chat
      .filter((m) => m.round >= ctx.view.round - 1 && /loose/i.test(m.text))
      .flatMap((m) => m.text.toUpperCase().match(/\b[A-G]\d{1,2}\b/g) ?? []);
  }

  private bestClimb(ctx: TCtx, respectRope: boolean, avoid: string[]): Dir | null {
    const v = ctx.view;
    const d = summitDistance(v.terrain);
    const here = d[v.you.y][v.you.x];
    const opts = moveOptions(v)
      .filter((o) => !respectRope || o.ropeOk)
      .map((o) => ({ ...o, d: d[parseTile(o.tile)!.y][parseTile(o.tile)!.x], risky: avoid.includes(o.tile) }))
      .filter((o) => o.d <= here)
      // Prefer safe progress, then risky progress, then a safe sidestep.
      .sort((a, b) => Number(a.risky) - Number(b.risky) || a.d - b.d || (a.dir === "N" ? -1 : 0));
    const best = opts[0];
    if (!best || (best.d === here && best.risky)) return null;
    if (best.d === here && this.rng.chance(0.5)) return null; // don't shuffle sideways forever
    return best.dir;
  }

  /** Cooperative convention: the lowest climber(s) climb, plus anyone the rope allows; neighbours of a risky move anchor. */
  private plan(ctx: TCtx): TAction {
    const v = ctx.view;
    if (v.you.onSummit) return { type: "anchor", dir: null };
    const avoid = this.warned(ctx);
    const dir = this.bestClimb(ctx, true, avoid);
    // Anchor for a neighbour who is lower than us (they need to catch up and may grab a loose hold).
    const nbs = ctx.view.climbers.filter((c) => Math.abs(c.ropeIndex - v.you.ropeIndex) === 1 && !c.onSummit);
    const helpBelow = nbs.some((n) => n.y < v.you.y - 1) && !safeFooting(v.terrain[v.you.y][v.you.x]);
    if (!dir || helpBelow) return { type: "anchor", dir: null };
    return { type: "climb", dir };
  }

  async discuss(ctx: TCtx) {
    const v = ctx.view;
    if (this.persona === "solo") return { message: "" };
    if (this.persona === "random") return { message: this.rng.chance(0.3) ? "Going up!" : "" };
    const parts: string[] = [];
    // Warn about loose holds next to (or just above) a teammate.
    const mates = v.climbers.filter((c) => c.id !== v.you.id);
    const relevant = v.knownLoose.filter((t) => {
      const p = parseTile(t)!;
      return mates.some((m) => !m.onSummit && dist(m, p) <= 1);
    });
    if (relevant.length) parts.push(`Careful, ${relevant.join(" and ")} ${relevant.length > 1 ? "are" : "is"} loose.`);
    const a = this.plan(ctx);
    parts.push(v.you.onSummit ? "On top — anchoring for you." : a.type === "climb" ? `I'll climb ${a.dir}.` : "I'll anchor.");
    return { message: parts.join(" ") };
  }

  async act(ctx: TCtx) {
    const v = ctx.view;
    if (v.you.onSummit) return { action: { type: "anchor", dir: null } as TAction };
    if (this.persona === "random") {
      return this.rng.chance(0.3) ? { action: { type: "anchor", dir: null } as TAction } : { action: { type: "climb", dir: this.rng.pick(DIRS) } as TAction };
    }
    if (this.persona === "solo") {
      const dir = this.bestClimb(ctx, false, []);
      return { action: (dir ? { type: "climb", dir } : { type: "wait", dir: null }) as TAction };
    }
    return { action: this.plan(ctx) };
  }

  async survey(ctx: TCtx): Promise<SurveyReply> {
    return { ratings: ctx.view.climbers.filter((c) => c.id !== ctx.view.you.id).map((c) => ({ playerId: c.id, trust: 4, guess: "unsure" as const })), reflection: `(scripted ${this.persona} bot)` };
  }
}

// ---------------------------------------------------------------------------
// Human climbers: requests go to the browser through the shared HumanAgent.

export class THumanAgent implements TAgent {
  lastUsage = null;
  constructor(readonly seat: SeatSpec, readonly human: HumanAgent) {}
  async discuss(ctx: TCtx) {
    const p = await this.human.request<{ message?: string }>("discuss", ctx.chatRound, ctx.deadlineMs);
    return { message: String(p?.message ?? "").slice(0, 400) };
  }
  async act(ctx: TCtx) {
    const p = await this.human.request<{ action?: TAction }>("act", 0, ctx.deadlineMs);
    return { action: (p?.action ?? { type: "wait", dir: null }) as TAction };
  }
  async survey(ctx: TCtx) {
    const p = await this.human.request<SurveyReply>("survey", 0, ctx.deadlineMs);
    return { ratings: p?.ratings ?? [], reflection: String(p?.reflection ?? "") };
  }
}
