// TETHERED — a simple, visual cooperative climbing game for mixed human/AI teams.
//
// The whole team is tied to one rope and must reach the summit before the storm.
// Co-op patterns it leans on:
//  - Physically linked fate: the rope can't stretch more than ROPE tiles between neighbours,
//    so nobody can race ahead — moves must be coordinated.
//  - Support roles chosen each turn: climb, or anchor to protect the climbers next to you.
//  - Hidden hazards only some can see: loose holds are felt only by climbers next to them.
//  - Shared consequences: an uncaught fall drags neighbours down and injures the team.
//  - A clock everyone can see (the storm).
//
// Pure + deterministic given (config, seed, actions). No I/O.

import { Rng } from "../game/rng.js";

export type Dir = "N" | "NE" | "NW" | "E" | "W" | "S" | "SE" | "SW";
export const DIRS: readonly Dir[] = ["N", "NE", "NW", "E", "W", "S", "SE", "SW"];
const DELTA: Record<Dir, [number, number]> = {
  N: [0, 1], NE: [1, 1], NW: [-1, 1], E: [1, 0], W: [-1, 0], S: [0, -1], SE: [1, -1], SW: [-1, -1],
};

export type Terrain = "ground" | "rock" | "ledge" | "slab" | "summit";
export type ActionType = "climb" | "anchor" | "wait";
export interface TAction {
  type: ActionType;
  dir: Dir | null;
}

export const ROPE = 2; // max tiles (king-move distance) between neighbours on the rope

// Fixed wall so every team composition faces the same climb. Row 0 here is the TOP.
//   ^ summit   # rock hold   = ledge (safe)   . smooth slab (can't climb)   _ ground
const WALL = [
  "^^^^^^^", // 12
  "##.##.#", // 11
  "#.###.#", // 10
  "==.#===", // 9
  "#.##.##", // 8
  "##.#.##", // 7
  "#.===.#", // 6
  "##.##.#", // 5
  "#.###.#", // 4
  "===.===", // 3
  "#.##.##", // 2
  "_______", // 1
];
export const WIDTH = WALL[0].length;
export const HEIGHT = WALL.length;
const COLS = "ABCDEFGHIJ";

export const tileName = (x: number, y: number) => `${COLS[x]}${y + 1}`; // y=0 is the bottom row
export function parseTile(name: string | null | undefined): { x: number; y: number } | null {
  const m = /^([A-Za-z])\s*(\d{1,2})$/.exec((name ?? "").trim());
  if (!m) return null;
  const x = COLS.indexOf(m[1].toUpperCase());
  const y = Number(m[2]) - 1;
  return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT ? { x, y } : null;
}

export interface Climber {
  id: string;
  name: string;
  x: number;
  y: number;
  ropeIndex: number; // order on the rope, 0 = first
  onSummit: boolean;
}

export interface TConfig {
  rounds: number; // the storm hits after this many rounds
  maxInjuries: number; // the expedition fails when the team takes this many uncaught falls
  looseShare: number; // fraction of rock holds that are loose
  chatRounds: number;
  seed: number;
}

export function tDefaultConfig(seed: number): TConfig {
  return { rounds: 20, maxInjuries: 3, looseShare: 0.22, chatRounds: 1, seed };
}

export interface TEffect {
  kind: "climb" | "anchor" | "taut" | "crumble" | "caught" | "fall" | "dragged" | "summit" | "invalid";
  climber?: string;
  by?: string;
  from?: string;
  to?: string;
  detail?: string;
}

export interface TFrame {
  label: string;
  climbers: Climber[];
  anchored: string[];
  effects: TEffect[];
  loose: string[]; // loose holds remaining after this frame (observer/replay only)
}

export interface TRoundResult {
  round: number;
  actions: Record<string, TAction>;
  frames: TFrame[];
  narrative: string[];
}

export interface TOutcome {
  won: boolean;
  summited: string[];
  injuries: number;
  endRound: number;
  reason: string;
}

export interface TState {
  config: TConfig;
  round: number;
  terrain: Terrain[][]; // [y][x], y=0 bottom
  loose: boolean[][];
  climbers: Climber[];
  known: Record<string, string[]>; // loose holds each climber has felt
  injuries: number;
  history: TRoundResult[];
  outcome: TOutcome | null;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const climbable = (t: Terrain) => t !== "slab";
export const safeFooting = (t: Terrain) => t === "ledge" || t === "ground" || t === "summit";

export function createTethered(config: TConfig, players: { id: string; name: string }[]): TState {
  const rng = new Rng(config.seed);
  const terrain: Terrain[][] = [];
  for (let y = 0; y < HEIGHT; y++) {
    const row = WALL[HEIGHT - 1 - y];
    terrain.push([...row].map((c) => ({ "^": "summit", "#": "rock", "=": "ledge", ".": "slab", _: "ground" })[c] as Terrain));
  }
  const loose = terrain.map((row) => row.map((t) => t === "rock" && rng.chance(config.looseShare)));
  const n = players.length;
  const start = Math.floor((WIDTH - n) / 2);
  const climbers: Climber[] = players.map((p, i) => ({ id: p.id, name: p.name, x: start + i, y: 0, ropeIndex: i, onSummit: false }));
  const s: TState = { config, round: 1, terrain, loose, climbers, known: {}, injuries: 0, history: [], outcome: null };
  for (const c of climbers) s.known[c.id] = [];
  feel(s);
  return s;
}

/**
 * Each climber spots loose holds exactly 2 tiles away. Holds right next to you are too close
 * to judge, so you depend on teammates (who the rope keeps 1-2 tiles away) to warn you.
 * Knowledge is what you can see right now, not a memory.
 */
function feel(s: TState) {
  for (const c of s.climbers) {
    const seen: string[] = [];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
        const x = c.x + dx, y = c.y + dy;
        if (inBounds(x, y) && s.loose[y][x]) seen.push(tileName(x, y));
      }
    s.known[c.id] = seen;
  }
}

const looseList = (s: TState) => s.loose.flatMap((row, y) => row.flatMap((l, x) => (l ? [tileName(x, y)] : [])));

export function sanitizeAction(raw: any): TAction {
  const type: ActionType = ["climb", "anchor", "wait"].includes(raw?.type) ? raw.type : "wait";
  const dir = DIRS.includes(raw?.dir) ? (raw.dir as Dir) : null;
  if (type === "climb" && !dir) return { type: "wait", dir: null };
  return { type, dir: type === "climb" ? dir : null };
}

export function resolveRound(s: TState, raw: Record<string, unknown>): TRoundResult {
  if (s.outcome) throw new Error("game over");
  const actions: Record<string, TAction> = {};
  for (const c of s.climbers) actions[c.id] = c.onSummit && raw[c.id] && (raw[c.id] as any).type === "climb" ? { type: "anchor", dir: null } : sanitizeAction(raw[c.id]);
  const effects: TEffect[] = [];
  const narrative: string[] = [];
  const rope = [...s.climbers].sort((a, b) => a.ropeIndex - b.ropeIndex);
  const prev = new Map(s.climbers.map((c) => [c.id, { x: c.x, y: c.y }]));
  const anchored = s.climbers.filter((c) => actions[c.id].type === "anchor").map((c) => c.id);

  // 1. Proposed moves.
  const moving = new Set<string>();
  for (const c of s.climbers) {
    const a = actions[c.id];
    if (a.type !== "climb") continue;
    const [dx, dy] = DELTA[a.dir!];
    const nx = c.x + dx, ny = c.y + dy;
    if (!inBounds(nx, ny) || !climbable(s.terrain[ny][nx])) {
      effects.push({ kind: "invalid", climber: c.id, detail: `can't climb ${a.dir} from ${tileName(c.x, c.y)}` });
      continue;
    }
    c.x = nx;
    c.y = ny;
    moving.add(c.id);
  }
  // 2. The rope goes taut: undo moves that would stretch a pair beyond ROPE (and further than before).
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i + 1 < rope.length; i++) {
      const a = rope[i], b = rope[i + 1];
      const before = dist(prev.get(a.id)!, prev.get(b.id)!);
      const now = dist(a, b);
      if (now > ROPE && now > before) {
        for (const c of [a, b]) {
          if (moving.has(c.id)) {
            moving.delete(c.id);
            const p = prev.get(c.id)!;
            c.x = p.x;
            c.y = p.y;
            effects.push({ kind: "taut", climber: c.id, detail: `rope to ${c === a ? b.name : a.name} too short` });
            changed = true;
          }
        }
      }
    }
  }
  for (const id of moving) {
    const c = s.climbers.find((x) => x.id === id)!;
    effects.push({ kind: "climb", climber: id, from: tileName(prev.get(id)!.x, prev.get(id)!.y), to: tileName(c.x, c.y) });
  }
  for (const id of anchored) effects.push({ kind: "anchor", climber: id });
  const frames: TFrame[] = [{ label: "Moves", climbers: clone(s.climbers), anchored, effects: [...effects], loose: looseList(s) }];

  // 3. Loose holds crumble under anyone who stepped on them.
  const fallEffects: TEffect[] = [];
  const fallers = s.climbers.filter((c) => moving.has(c.id) && s.loose[c.y][c.x]);
  const fell = new Set(fallers.map((c) => c.id));
  for (const c of fallers) {
    s.loose[c.y][c.x] = false; // the loose rock falls away; solid rock underneath
    fallEffects.push({ kind: "crumble", climber: c.id, to: tileName(c.x, c.y) });
  }
  for (const c of fallers) {
    const neighbours = rope.filter((o) => Math.abs(o.ropeIndex - c.ropeIndex) === 1 && !fell.has(o.id));
    const catcher = neighbours.find((o) => anchored.includes(o.id) || safeFooting(s.terrain[o.y][o.x]));
    const p = prev.get(c.id)!;
    if (catcher) {
      c.x = p.x;
      c.y = p.y;
      fallEffects.push({ kind: "caught", climber: c.id, by: catcher.id, to: tileName(c.x, c.y) });
      narrative.push(`${c.name} slipped on a loose hold and was caught by ${catcher.name}.`);
    } else {
      s.injuries++;
      let ny = Math.max(0, p.y - 2);
      while (ny > 0 && !climbable(s.terrain[ny][c.x])) ny--;
      const from = tileName(c.x, c.y);
      c.y = ny;
      fallEffects.push({ kind: "fall", climber: c.id, from, to: tileName(c.x, c.y) });
      narrative.push(`${c.name} fell from ${from} to ${tileName(c.x, c.y)} — nobody was anchored to catch them (injury ${s.injuries}/${s.config.maxInjuries}).`);
      for (const o of neighbours) {
        if (anchored.includes(o.id) || safeFooting(s.terrain[o.y][o.x]) || o.y === 0) continue;
        const below = o.y - 1;
        if (climbable(s.terrain[below][o.x])) {
          const f = tileName(o.x, o.y);
          o.y = below;
          fallEffects.push({ kind: "dragged", climber: o.id, by: c.id, from: f, to: tileName(o.x, o.y) });
          narrative.push(`${o.name} was dragged down by the rope.`);
        }
      }
    }
  }
  for (const c of s.climbers) {
    if (!c.onSummit && s.terrain[c.y][c.x] === "summit") {
      c.onSummit = true;
      fallEffects.push({ kind: "summit", climber: c.id, to: tileName(c.x, c.y) });
      narrative.push(`${c.name} reached the summit!`);
    }
  }
  frames.push({ label: fallers.length ? "Loose rock!" : "Settled", climbers: clone(s.climbers), anchored, effects: fallEffects, loose: looseList(s) });
  feel(s);

  const result: TRoundResult = { round: s.round, actions, frames, narrative };
  s.history.push(result);
  const summited = s.climbers.filter((c) => c.onSummit).map((c) => c.id);
  if (summited.length === s.climbers.length) {
    s.outcome = { won: true, summited, injuries: s.injuries, endRound: s.round, reason: `The whole team reached the summit in ${s.round} rounds.` };
  } else if (s.injuries >= s.config.maxInjuries) {
    s.outcome = { won: false, summited, injuries: s.injuries, endRound: s.round, reason: `Too many falls (${s.injuries}) — the team had to turn back.` };
  } else if (s.round >= s.config.rounds) {
    s.outcome = { won: false, summited, injuries: s.injuries, endRound: s.round, reason: `The storm hit before everyone reached the summit (${summited.length}/${s.climbers.length} made it).` };
  } else s.round++;
  return result;
}

// ---------------------------------------------------------------------------

export interface TView {
  you: Climber;
  round: number;
  rounds: number;
  terrain: Terrain[][];
  climbers: Climber[];
  knownLoose: string[]; // loose holds YOU can see right now (exactly 2 tiles away)
  injuries: number;
  maxInjuries: number;
  outcome: TOutcome | null;
}

export function tViewFor(s: TState, pid: string): TView {
  return {
    you: s.climbers.find((c) => c.id === pid)!,
    round: s.round,
    rounds: s.config.rounds,
    terrain: s.terrain,
    climbers: s.climbers,
    knownLoose: [...s.known[pid]],
    injuries: s.injuries,
    maxInjuries: s.config.maxInjuries,
    outcome: s.outcome,
  };
}

/** Text picture of the wall for language-model players (top row first). */
export function wallText(v: TView): string {
  const lines: string[] = [];
  lines.push("     " + [...COLS.slice(0, WIDTH)].join(" "));
  for (let y = HEIGHT - 1; y >= 0; y--) {
    const cells = [];
    for (let x = 0; x < WIDTH; x++) {
      const c = v.climbers.find((k) => k.x === x && k.y === y);
      const t = v.terrain[y][x];
      const loose = v.knownLoose.includes(tileName(x, y));
      cells.push(c ? c.name[0] : loose ? "!" : { summit: "^", rock: "#", ledge: "=", slab: ".", ground: "_" }[t]);
    }
    lines.push(`${String(y + 1).padStart(3)}  ${cells.join(" ")}`);
  }
  return lines.join("\n");
}

export function tRulesText(cfg: TConfig, n: number): string {
  return `TETHERED — cooperative roped climb
Your team of ${n} climbers is tied together on ONE rope and must ALL reach the summit (row ${HEIGHT}) before the storm hits after round ${cfg.rounds}. Everyone wins or loses together.

THE WALL: columns A-${COLS[WIDTH - 1]}, rows 1 (bottom) to ${HEIGHT} (summit). # rock holds can be climbed, = ledges are safe resting spots, . smooth slabs cannot be climbed, row 1 is the ground.

THE ROPE: climbers are tied in a fixed order. Neighbours on the rope can never be more than ${ROPE} tiles apart (counting diagonals as 1). If a move would stretch the rope further, the rope goes taut and that move doesn't happen. So the team has to move together.

EACH ROUND
1. Talk: each climber may send one short message.
2. Act: everyone secretly picks ONE action at the same time:
   - climb <N, NE, NW, E, W, S, SE, SW>: move one tile.
   - anchor: stay put and brace the rope. Anchored climbers (and anyone standing on a ledge, the ground or the summit) catch a falling neighbour.
   - wait.
3. Loose holds: some rock holds are loose. You can spot a loose hold only when it is exactly 2 tiles away from you — holds right next to you are too close to judge. So the holds you are about to grab are usually visible to your rope partners, not to you: warn each other. Stepping onto a loose hold breaks it (the rock underneath is solid afterwards) and you fall:
   - If a rope neighbour is anchored or standing on safe footing, they catch you and you're back where you were.
   - If not, you fall 2 rows, your un-anchored neighbours are dragged down 1 row, and the team takes an injury. ${cfg.maxInjuries} injuries and the expedition fails.
Once on the summit you stay there (you can still anchor for the climbers below you).`;
}
