// Aggregate every game summary into comparison tables + CSVs.
//
//   npm run analyze                      # all games in data/games
//   npm run analyze -- --condition pilot # only one experiment condition
//   npm run analyze -- --dir some/other/folder

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { GameSummary, PlayerSummary } from "./metrics.js";
import { estimateCost } from "./models.js";
import type { TSummary, TPlayerSummary } from "./tethered/session.js";

const { values } = parseArgs({
  options: { dir: { type: "string", default: "data/games" }, condition: { type: "string" }, "include-errors": { type: "boolean", default: false } },
});
const dir = path.resolve(values.dir!);
const loaded: (GameSummary | TSummary)[] = readdirSync(dir)
  .filter((f) => f.endsWith(".summary.json"))
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")))
  .filter((g: GameSummary) => !values.condition || g.condition === values.condition);
// Games with agent errors or timeouts are left out unless --include-errors is given.
const errorsIn = (g: GameSummary | TSummary) => (g.players as { errors: number; timeouts: number }[]).reduce((a, p) => a + p.errors + p.timeouts, 0);
const withErrors = loaded.filter((g) => errorsIn(g) > 0);
const all = values["include-errors"] ? loaded : loaded.filter((g) => errorsIn(g) === 0);
// Cost per game: exact (incl. cache tokens) where recorded; older games are estimated from
// their token counts without cache tokens and shown with "~".
function gameCost(g: GameSummary | TSummary): { usd: number | null; estimated: boolean } {
  if (typeof (g as { costUsd?: number | null }).costUsd === "number") return { usd: (g as { costUsd: number }).costUsd, estimated: false };
  let total = 0;
  for (const p of g.players as { label: string; kind: string; inputTokens: number; outputTokens: number }[]) {
    if (p.kind === "bot" || p.kind === "human") continue;
    const c = estimateCost(p.label.replace(/@.*/, ""), p);
    if (c === null) return { usd: null, estimated: true };
    total += c;
  }
  return { usd: total, estimated: true };
}
function costText(gs: (GameSummary | TSummary)[]): string {
  const cs = gs.map(gameCost);
  if (cs.some((c) => c.usd === null)) return "—";
  const avg = cs.reduce((a, c) => a + c.usd!, 0) / cs.length;
  return `${cs.some((c) => c.estimated) ? "~" : ""}$${avg.toFixed(2)}`;
}

if (withErrors.length) {
  console.log(`${values["include-errors"] ? "Including" : "Skipping"} ${withErrors.length} game(s) with errors or timeouts: ${withErrors.map((g) => g.sessionId).join(", ")}`);
}
const games = all.filter((g): g is GameSummary => !("game" in g) || (g as any).game !== "tethered");
const climbs = all.filter((g): g is TSummary => (g as any).game === "tethered");

if (!all.length) {
  console.log(`No game summaries in ${dir}${values.condition ? ` for condition "${values.condition}"` : ""}.`);
  process.exit(0);
}

const pct = (x: number | null) => (x === null || Number.isNaN(x) ? "—" : `${Math.round(100 * x)}%`);
const num = (x: number | null, d = 1) => (x === null || Number.isNaN(x) ? "—" : x.toFixed(d));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ratio = (a: number, b: number) => (b ? a / b : null);

function table(headers: string[], rows: (string | number)[][]) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r: (string | number)[]) => r.map((c, i) => String(c).padEnd(w[i])).join("  ");
  console.log(line(headers));
  console.log(w.map((n) => "-".repeat(n)).join("  "));
  rows.forEach((r) => console.log(line(r)));
  console.log();
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}

console.log(`\n${all.length} game(s) from ${dir}\n`);
if (games.length) {
console.log(`===== OUTPOST (${games.length} games) =====\n`);

console.log("TEAM OUTCOMES BY COMPOSITION");
table(
  ["composition", "class", "ids", "games", "rescued", "team score", "survivors", "$/game"],
  groupBy(games, (g) => `${g.compositionKey} (${g.difficulty ?? "normal"})|${g.compositionClass}|${g.revealIdentities ? "revealed" : "blind"}`).map(([k, gs]) => {
    const [key, cls, ids] = k.split("|");
    return [key, cls, ids, gs.length, pct(mean(gs.map((g) => (g.rescued ? 1 : 0)))), num(mean(gs.map((g) => g.teamScore)), 2), num(mean(gs.map((g) => g.survivors))), costText(gs)];
  }),
);

const players = games.flatMap((g) => g.players.map((p) => ({ ...p, game: g })));
type P = PlayerSummary & { game: GameSummary };

function playerRow(label: string, ps: P[]) {
  const s = (f: (p: P) => number) => ps.reduce((a, p) => a + f(p), 0);
  return [
    label,
    ps.length,
    pct(mean(ps.map((p) => (p.survived ? 1 : 0)))),
    pct(ratio(s((p) => p.pledgesKept), s((p) => p.pledges))),
    pct(ratio(s((p) => p.foodDeposited + p.foodGiven), s((p) => p.foodForaged))),
    pct(ratio(s((p) => p.jointActions), s((p) => p.daysAlive))),
    num(ratio(s((p) => p.messages), s((p) => p.daysAlive))),
    num(ratio(s((p) => p.words), s((p) => p.messages)), 0),
    s((p) => p.healsGiven),
    num(mean(ps.filter((p) => p.trustReceivedAvg !== null).map((p) => p.trustReceivedAvg!))),
    pct(ratio(s((p) => p.guessedAsAi), s((p) => p.guessedAsAi + p.guessedAsHuman))),
    s((p) => p.timeouts + p.errors),
  ];
}

const PH = ["player", "n", "survived", "kept pledges", "shared food", "joint actions", "msgs/day", "words/msg", "heals", "trust rcvd", "seen as AI", "timeouts+errs"];

console.log("PLAYER BEHAVIOUR BY SEAT TYPE");
table(PH, groupBy(players, (p) => (p.kind === "human" ? "human" : p.label)).map(([k, ps]) => playerRow(k, ps)));

console.log("PLAYER BEHAVIOUR BY SEAT TYPE × TEAM CLASS");
table(PH, groupBy(players, (p) => `${p.kind === "human" ? "human" : p.label} in ${p.game.compositionClass}`).map(([k, ps]) => playerRow(k, ps)));

const humans = players.filter((p) => p.kind === "human" && p.guessAccuracy !== null);
if (humans.length) {
  console.log(`Humans identified teammates correctly ${pct(mean(humans.map((p) => p.guessAccuracy!)))} of the time (n=${humans.length}).`);
}
const ais = players.filter((p) => (p.kind === "anthropic" || p.kind === "openai") && p.guessAccuracy !== null);
if (ais.length) {
  console.log(`AIs identified teammates correctly ${pct(mean(ais.map((p) => p.guessAccuracy!)))} of the time (n=${ais.length}).`);
}

}

// ---------------------------------------------------------------------------
// Tethered

type TP = TPlayerSummary & { game: TSummary };
const tPlayers: TP[] = climbs.flatMap((g) => g.players.map((p) => ({ ...p, game: g })));
if (climbs.length) {
  console.log(`===== TETHERED (${climbs.length} games) =====\n`);
  console.log("TEAM OUTCOMES BY COMPOSITION");
  table(
    ["composition", "class", "ids", "games", "summit", "climbers up", "injuries", "rounds", "$/game"],
    groupBy(climbs, (g) => `${g.compositionKey} (rules ${g.variant ?? `v${g.rulesVersion ?? 1}`})|${g.compositionClass}|${g.revealIdentities ? "revealed" : "blind"}`).map(([k, gs]) => {
      const [key, cls, ids] = k.split("|");
      return [key, cls, ids, gs.length, pct(mean(gs.map((g) => (g.won ? 1 : 0)))), pct(mean(gs.map((g) => g.summited / g.nPlayers))), num(mean(gs.map((g) => g.injuries))), num(mean(gs.map((g) => g.endRound))), costText(gs)];
    }),
  );
  const tRow = (label: string, ps: TP[]) => {
    const s = (f: (p: TP) => number) => ps.reduce((a, p) => a + f(p), 0);
    const turns = s((p) => p.climbs + p.anchors + p.waits);
    return [
      label,
      ps.length,
      pct(ratio(s((p) => p.climbs), turns)),
      pct(ratio(s((p) => p.anchors), turns)),
      pct(ratio(s((p) => p.supportAnchors), s((p) => p.anchors))),
      pct(ratio(s((p) => p.holdsWarned), s((p) => p.holdsFelt))),
      s((p) => p.catches),
      s((p) => p.falls),
      num(ratio(s((p) => p.ropeBlocked), ps.length)),
      num(ratio(s((p) => p.messages), turns)),
      num(mean(ps.filter((p) => p.trustReceivedAvg !== null).map((p) => p.trustReceivedAvg!))),
      pct(ratio(s((p) => p.guessedAsAi), s((p) => p.guessedAsAi + p.guessedAsHuman))),
      s((p) => p.timeouts + p.errors),
    ];
  };
  const TH = ["player", "n", "climb", "anchor", "anchors that helped", "warned", "catches", "falls", "taut/game", "msgs/round", "trust rcvd", "seen as AI", "timeouts+errs"];
  console.log("CLIMBER BEHAVIOUR BY SEAT TYPE");
  table(TH, groupBy(tPlayers, (p) => `${p.kind === "human" ? "human" : p.label} (rules ${p.game.variant ?? `v${p.game.rulesVersion ?? 1}`})`).map(([k, ps]) => tRow(k, ps)));
  console.log("CLIMBER BEHAVIOUR BY SEAT TYPE × TEAM CLASS");
  table(TH, groupBy(tPlayers, (p) => `${p.kind === "human" ? "human" : p.label} in ${p.game.compositionClass}`).map(([k, ps]) => tRow(k, ps)));
}

// CSV export for R / pandas / spreadsheets.
const csv = (rows: Record<string, unknown>[]) => {
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
};
const outDir = path.dirname(dir);
if (games.length) {
  const players = games.flatMap((g) => g.players.map((p) => ({ ...p, game: g })));
  writeFileSync(path.join(outDir, "outpost_games.csv"), csv(games.map(({ players: _p, ...g }) => g)));
  writeFileSync(path.join(outDir, "outpost_players.csv"), csv(players.map(({ game, ...p }) => ({ sessionId: game.sessionId, condition: game.condition, compositionClass: game.compositionClass, compositionKey: game.compositionKey, revealIdentities: game.revealIdentities, teamRescued: game.rescued, ...p }))));
}
if (climbs.length) {
  writeFileSync(path.join(outDir, "tethered_games.csv"), csv(climbs.map(({ players: _p, ...g }) => g)));
  writeFileSync(path.join(outDir, "tethered_players.csv"), csv(tPlayers.map(({ game, ...p }) => ({ sessionId: game.sessionId, condition: game.condition, compositionClass: game.compositionClass, compositionKey: game.compositionKey, revealIdentities: game.revealIdentities, teamWon: game.won, ...p }))));
}
console.log(`\nWrote CSVs to ${outDir}/ (outpost_*.csv, tethered_*.csv)`);
