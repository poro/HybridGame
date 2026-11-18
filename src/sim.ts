// Headless runner: play many games with no humans (AI vs AI, AI + bots, bots only).
//
//   npm run sim -- --game tethered --seats opus,haiku,bot --games 3
//   npm run sim -- --seats opus,haiku,bot --games 5            (Outpost)
//   npm run sim -- --seats opus,luna,haiku --reveal --condition pilot --days 8
//   npm run sim -- --seats bot,bot,bot:selfish --games 200 --quiet

import "dotenv/config";
import { appendFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { hasAnthropicCredentials, hasOpenAICredentials, parseSeat } from "./models.js";
import { Session } from "./session.js";
import { TSession } from "./tethered/session.js";

const { values } = parseArgs({
  options: {
    game: { type: "string", default: "outpost" },
    difficulty: { type: "string", default: "normal" }, // Outpost: normal | hard
    rules: { type: "string" }, // Tethered rules text: v1 | v2 (default v2)
    radio: { type: "string" }, // Tethered radio calls: long | short (default short)
    seats: { type: "string", default: "bot,bot,bot" },
    games: { type: "string", default: "1" },
    reveal: { type: "boolean", default: false },
    seed: { type: "string" },
    days: { type: "string" },
    parts: { type: "string" },
    rounds: { type: "string" },
    condition: { type: "string" },
    concurrency: { type: "string", default: "1" },
    quiet: { type: "boolean", default: false },
    out: { type: "string" }, // directory for logs (default data/games)
    retries: { type: "string", default: "1" }, // replay a seed this many times if its game had errors or timeouts
  },
});

const seats = values.seats!.split(",").map(parseSeat);
if (seats.some((s) => s.kind === "human")) {
  console.error("The simulator has no human seats; use `npm run dev` and the web lobby for games with humans.");
  process.exit(1);
}
if (seats.some((s) => s.kind === "anthropic") && !hasAnthropicCredentials()) {
  console.error("No Claude credentials: run `ant auth login`, or set ANTHROPIC_API_KEY in .env.");
  process.exit(1);
}
if (seats.some((s) => s.kind === "openai") && !hasOpenAICredentials()) {
  console.error("OPENAI_API_KEY is not set (add it to .env) but the roster has OpenAI seats.");
  process.exit(1);
}
const games = Number(values.games);
const baseSeed = values.seed ? Number(values.seed) : Math.floor(Math.random() * 1e9);
const game = {
  ...(values.days ? { days: Number(values.days) } : {}),
  ...(values.parts ? { beaconParts: Number(values.parts) } : {}),
  ...(values.rounds ? { discussionRounds: Number(values.rounds) } : {}),
};

async function playTethered(i: number) {
  const session = new TSession({
    seats,
    revealIdentities: values.reveal!,
    seed: baseSeed + i,
    condition: values.condition,
    dataDir: values.out,
    game: {
      ...(values.days ? { rounds: Number(values.days) } : {}),
      ...(values.rounds ? { chatRounds: Number(values.rounds) } : {}),
      ...(values.rules ? { rulesText: values.rules as "v1" | "v2" } : {}),
      ...(values.radio ? { radio: values.radio as "long" | "short" } : {}),
    },
  });
  if (!values.quiet) {
    let seen = 0;
    let rounds = 0;
    session.on("update", () => {
      for (; seen < session.chat.length; seen++) {
        const m = session.chat[seen];
        console.log(`  [r${m.round}] ${m.fromName} (${session.seatOf.get(m.from)!.label}): ${m.text}`);
      }
      for (; rounds < session.state.history.length; rounds++) {
        const h = session.state.history[rounds];
        const acts = Object.entries(h.actions).map(([id, a]) => `${session.name(id)} ${a.type}${a.dir ? " " + a.dir : ""}`).join(", ");
        const pos = session.state.climbers.map((c) => `${c.name}@${"ABCDEFG"[c.x]}${c.y + 1}`).join(" ");
        console.log(`  == Round ${h.round}: ${acts}. ${h.narrative.join(" ")}  [${pos}]`);
      }
    });
  }
  const s = await session.run();
  console.log(`game ${i + 1}/${games} ${s.sessionId}: ${s.won ? "SUMMIT" : "FAILED"} — ${s.summited}/${s.nPlayers} on top, ${s.injuries} injuries, round ${s.endRound}`);
  return { ok: s.won, score: s.summited / s.nPlayers, clean: s.clean, errors: s.errors, sessionId: s.sessionId, cost: s.costUsd };
}

async function playOne(i: number) {
  if (values.game === "tethered") return playTethered(i);
  const session = new Session({ difficulty: values.difficulty as "normal" | "hard", seats, revealIdentities: values.reveal!, seed: baseSeed + i, game, condition: values.condition, dataDir: values.out });
  if (!values.quiet) {
    let seen = 0;
    let days = 0;
    session.on("update", () => {
      for (; seen < session.chat.length; seen++) {
        const m = session.chat[seen];
        const seat = session.seatOf.get(m.from)!.label;
        if (!m.text) continue;
        console.log(`  [d${m.day}r${m.round}] ${m.fromName} (${seat}): ${m.text}`);
      }
      for (; days < session.state.history.length; days++) {
        const h = session.state.history[days];
        console.log(`  == Day ${h.day}: ${h.narrative.join(" ")}`);
        console.log(`     camp ${h.campFoodAfter} food, shelter ${h.shelterAfter}, beacon ${h.partsAfter}/${session.state.config.beaconParts}`);
      }
    });
  }
  const summary = await session.run();
  console.log(
    `game ${i + 1}/${games} ${summary.sessionId}: ${summary.rescued ? "RESCUED" : "LOST"} — ${summary.survivors}/${summary.nPlayers} alive, day ${summary.endDay}, parts ${summary.parts}/${summary.beaconParts}`,
  );
  return { ok: summary.rescued, score: summary.teamScore, clean: summary.clean, errors: summary.errors, sessionId: summary.sessionId, cost: summary.costUsd };
}

// A game with errors or timeouts (network drop, the computer sleeping...) is moved to
// <out>/excluded/ and its seed is replayed, so bad runs never mix into the results.
const dataDir = path.resolve(values.out ?? "data/games");
function setAside(sessionId: string, why: string) {
  const dir = path.join(dataDir, "excluded");
  mkdirSync(dir, { recursive: true });
  for (const ext of [".jsonl", ".summary.json"]) {
    const f = path.join(dataDir, sessionId + ext);
    if (existsSync(f)) renameSync(f, path.join(dir, sessionId + ext));
  }
  appendFileSync(path.join(dir, "README.txt"), `${new Date().toISOString()} ${sessionId}: ${why}\n`);
}
const maxRetries = Math.max(0, Number(values.retries));
async function playClean(i: number) {
  for (let attempt = 0; ; attempt++) {
    const r = await playOne(i);
    if (r.clean) return r;
    if (attempt >= maxRetries) {
      console.log(`game ${i + 1}: still had ${r.errors} errors/timeouts after ${attempt} retries; kept but marked unclean (analyze skips it)`);
      return r;
    }
    setAside(r.sessionId, `${r.errors} errors/timeouts; seed ${baseSeed + i} replayed`);
    console.log(`game ${i + 1}: ${r.errors} errors/timeouts, set aside in excluded/ and replaying seed ${baseSeed + i}`);
  }
}

const conc = Math.max(1, Number(values.concurrency));
const results = [];
for (let i = 0; i < games; i += conc) {
  results.push(...(await Promise.all(Array.from({ length: Math.min(conc, games - i) }, (_, k) => playClean(i + k)))));
}
const wins = results.filter((r) => r.ok).length;
const meanScore = results.reduce((a, r) => a + r.score, 0) / results.length;
const known = results.map((r) => r.cost).filter((c): c is number => typeof c === "number");
const unclean = results.filter((r) => !r.clean).length;
console.log(
  `\nModel cost: $${known.reduce((a, c) => a + c, 0).toFixed(2)} at list prices${known.length < results.length ? " (some models have no listed price)" : ""}${unclean ? `; ${unclean} game(s) still unclean` : ""}`,
);
console.log(`${games} ${values.game} game(s) [${seats.map((s) => s.label).join(", ")}]: win rate ${(100 * wins / games).toFixed(0)}%, mean team score ${meanScore.toFixed(2)}`);
console.log(`Logs: ${values.out ?? "data/games"}/  —  run \`npm run analyze${values.out ? ` -- --dir ${values.out}` : ""}\` for a breakdown by team composition.`);
