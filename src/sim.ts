// Headless runner: play many games with no humans (AI vs AI, AI + bots, bots only).
//
//   npm run sim -- --game tethered --seats opus,haiku,bot --games 3
//   npm run sim -- --seats opus,haiku,bot --games 5            (Outpost)
//   npm run sim -- --seats opus,luna,haiku --reveal --condition pilot --days 8
//   npm run sim -- --seats bot,bot,bot:selfish --games 200 --quiet

import "dotenv/config";
import { parseArgs } from "node:util";
import { hasAnthropicCredentials, hasOpenAICredentials, parseSeat } from "./models.js";
import { Session } from "./session.js";
import { TSession } from "./tethered/session.js";

const { values } = parseArgs({
  options: {
    game: { type: "string", default: "outpost" },
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
    game: { ...(values.days ? { rounds: Number(values.days) } : {}), ...(values.rounds ? { chatRounds: Number(values.rounds) } : {}) },
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
  return { ok: s.won, score: s.summited / s.nPlayers };
}

async function playOne(i: number) {
  if (values.game === "tethered") return playTethered(i);
  const session = new Session({ seats, revealIdentities: values.reveal!, seed: baseSeed + i, game, condition: values.condition, dataDir: values.out });
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
  return { ok: summary.rescued, score: summary.teamScore };
}

const conc = Math.max(1, Number(values.concurrency));
const results = [];
for (let i = 0; i < games; i += conc) {
  results.push(...(await Promise.all(Array.from({ length: Math.min(conc, games - i) }, (_, k) => playOne(i + k)))));
}
const wins = results.filter((r) => r.ok).length;
const meanScore = results.reduce((a, r) => a + r.score, 0) / results.length;
console.log(`\n${games} ${values.game} game(s) [${seats.map((s) => s.label).join(", ")}]: win rate ${(100 * wins / games).toFixed(0)}%, mean team score ${meanScore.toFixed(2)}`);
console.log(`Logs: ${values.out ?? "data/games"}/  —  run \`npm run analyze${values.out ? ` -- --dir ${values.out}` : ""}\` for a breakdown by team composition.`);
