# HybridGame

Testbed for studying cooperation in mixed human + AI teams. TypeScript on Node 24, run with `tsx` (no build step). It has two games: **Tethered** (visual rope-climbing co-op, the main one) and **Outpost** (text survival). See README.md for usage and docs/RESEARCH.md for the study design.

## Commands
- `npm run dev`: lobby at http://localhost:8787 (tsx watch; restarts drop live games)
- `npm start`: the same without watch; use it for real sessions
- `npm run sim -- --game tethered --seats opus,haiku,bot --games 3`: headless games (no `--game` means Outpost)
- `npm run analyze`: tables + CSVs from `data/games/*.summary.json`
- `npm run typecheck`

## Architecture rules
- Game engines (`src/tethered/engine.ts`, `src/game/outpost.ts`) stay pure and deterministic: no I/O, and all randomness from `Rng` seeded by `config.seed`. Rule changes go there, plus the rules text that both AIs and humans read.
- Players only get the per-player view (`tViewFor` / `viewFor`). Never give an agent more than its rules allow it to see. Bots follow the same limits and learn hidden info from chat.
- Model calls go through `modelJson()` in `src/players/llm.ts`: Claude via `@anthropic-ai/sdk` with structured outputs, a cached system prompt, and the `server-side-fallback-2026-07-01` refusal fallback on Opus/Sonnet 5.5/Fable; OpenAI via the Responses API with a strict JSON schema.
- Never ask a model to write out its reasoning in the answer (a "scratchpad" or "reasoning" field): Opus/Sonnet 5.5 decline that as `reasoning_extraction`, and fallbacks don't retry it. Models return a short `memo` (fed back to them on later turns). Researchers see Claude's reasoning through `thinking: {type: "adaptive", display: "summarized"}`, which ends up in `note` in the logs.
- Claude credentials: `ant auth login` works with no API key (the SDK reads and refreshes the profile); `hasAnthropicCredentials()` in `src/models.ts` checks for it.
- Humans go through `HumanAgent.request()` over WebSocket. Each session class exposes `game`, `humanFor()`, `humans()`, `snapshotFor()`, `run()`, `progress()` so `src/server.ts` can host both games.
- The Tethered page (`public/tethered.js`) animates from `round_resolved` frames. Live snapshots and replays (`/api/replay/:id`) feed the same step queue.
- Changing what Tethered players read (rules text or prompt) changes results: bump `RULES_VERSION` in `src/tethered/engine.ts`. It is logged in every game and `analyze` keeps versions apart. v1 = games up to 2026-11-18 (all published results so far); v2 = clearer catching rule, simpler wording, one-sentence radio calls.
- After changing rules, re-tune with bot sims. Targets: cooperative bots win ~45-60%, solo bots far lower. Update the baseline tables in README.

## Data
- `data/` is a separate private repo (poro/HybridGame-data) holding participant data (chat, debrief reflections). This repo ignores it; never commit it here or send it anywhere else. `npm run backup-data` commits and pushes it.
- Games with errors/timeouts are set aside in `data/games/excluded/` by the simulator (seed replayed) and skipped by `analyze`. Summaries carry `clean`, `errors` and `costUsd` (list prices in `PRICES`, `src/models.ts`).
- Outpost `difficulty` ("normal" | "hard") is part of each game's config and summary; never mix difficulties when comparing.
- `.env` holds API keys. Never commit it.
- The lobby, observer and replay APIs are served only to localhost (`isLocal` in server.ts). Keep it that way.
