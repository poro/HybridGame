# HybridGame

A research testbed for **mixed human + AI teams**. Humans and AI models (Claude Opus / Sonnet / Haiku / Fable, OpenAI models, scripted bots) play cooperative games at the same table. Every message, action, private AI note and post-game debrief is logged, so you can compare how teams of different makeup cooperate.

There are two games:

| Game | Feel | Best for |
|---|---|---|
| **Tethered** (visual) | A rope team climbs a cliff together. Simple rules; you watch the climbers move, talk, fall and catch each other. | Seeing human/AI interaction; quick sessions; demos |
| **Outpost** (text) | Survival camp with roles, private food pouches and a beacon to build. | Deeper social dilemmas (sharing vs hoarding, keeping promises) |

## Tethered: the rope game

The whole team is tied to **one rope** and must all reach the summit before the storm (20 rounds).

- **The rope:** neighbours on the rope can never be more than 2 tiles apart. If a move would stretch it further, the rope goes taut and the move fails. Nobody can race ahead.
- **Each round:** everyone says one thing, then secretly picks one action: **climb** (8 directions) or **anchor** (brace the rope).
- **Loose holds:** some holds break. You can only spot a loose hold when it's **2 tiles away**, not the one right in front of you. Because the rope keeps partners 1–2 tiles apart, your teammates are the ones who can see your next holds, so you have to warn each other.
- **Falls:** step on a loose hold and you fall. A rope neighbour catches you if, after this round's moves, they are anchored or standing on a ledge, the ground or the summit. If you all climb off the ground at once, nobody is left to catch. Uncaught, you drop, drag your neighbours down, and the team takes an injury. 3 injuries and the team turns back.

The co-op patterns behind it: shared fate, a visible clock, a few clear actions, support moves (anchoring), and hidden information that only teammates hold.

**Bot baselines** (200 games each):

| Team | 2 climbers | 3 climbers | 4 climbers |
|---|---|---|---|
| Cooperative bots (warn, avoid warned holds, anchor for laggards) | 60% | 55% | 46% |
| Solo bots (no talking, no anchoring) | 21% | 10% | 6% |

So the game rewards cooperation. 2 cooperative bots + 1 solo bot summit 40% of the time.

## Quick start

```bash
cd ~/Documents/src/HybridGame
cp .env.example .env    # add ANTHROPIC_API_KEY / OPENAI_API_KEY (+ OPENAI_LUNA_MODEL)
npm install
npm run dev             # http://localhost:8787
```

1. In the lobby, choose the game, set up the seats (e.g. `human`, `opus`, `haiku`) and decide whether players are told who is human or AI.
2. **Create game** gives one join link per human seat plus an **observer** link. The observer sees everything, including loose holds and the AIs' private thoughts.
3. The game starts when every human has opened their link. With no human seats it starts straight away, and you can watch it live from the observer link.
4. **Finished games** in the lobby have a **replay** link (Tethered). Replays show the AIs' private thoughts next to their speech and can run at 0.5×–4× speed.

Remote players: run `HOST=0.0.0.0 npm start` and share links that use your machine's IP. Only the game pages are reachable from other machines; the lobby, observer and replay APIs answer only on the host. Use `npm start` (not `dev`) for real sessions: dev mode restarts the server when files change, which drops live games.

Playing in person on this Mac: double-click `Game Night.command` (starts `npm start` with the Mac kept awake and opens the lobby). The lobby's "Seconds per turn (people)" sets how long human players get per step (default 120). See [docs/GAME_NIGHT.md](docs/GAME_NIGHT.md).

## Seat types

| Seat | Meaning |
|---|---|
| `human` | A person in the browser |
| `opus` / `sonnet` / `haiku` / `fable` | `claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5` / `claude-fable-5-1` |
| `luna` | OpenAI model set by `OPENAI_LUNA_MODEL` in `.env` |
| `anthropic:<id>` / `openai:<id>` | Any other model id |
| `bot`, `bot:selfish`, `bot:random` | Scripted baselines (no API cost). In Tethered, `bot:selfish` is a solo climber. |
| `…@low` / `@high` / … | Reasoning effort for model seats, e.g. `opus@low` |

## AI-only runs

```bash
npm run sim -- --game tethered --seats opus,haiku,luna --games 3
npm run sim -- --game tethered --seats opus,bot,bot:selfish --reveal --condition pilot
npm run sim -- --seats opus,haiku,bot --games 5                  # Outpost
npm run sim -- --game tethered --seats bot,bot,bot --games 500 --quiet   # free baseline
npm run analyze
```

Flags: `--days` (Outpost days / Tethered rounds), `--rounds` (chat rounds per turn), `--parts` (Outpost), `--seed`, `--concurrency`, `--out <dir>`, `--condition <label>`.

## Data

Each game writes to `data/games/`. The `data/` folder is its own private repository, [poro/HybridGame-data](https://github.com/poro/HybridGame-data), ignored by this repo because it contains every player's chat. Run `npm run backup-data` after playing games to push new logs.

Games that hit errors or timeouts (for example when the computer sleeps mid-game) are set aside in `data/games/excluded/` and their seed is replayed automatically (`--retries`, default 1). `npm run analyze` skips any game with errors unless you pass `--include-errors`. Each summary records exact token use, including cached tokens, and its cost at list prices.

Outpost has two difficulties: `normal` (tuned on bots; every Claude team is rescued every time) and `hard` (50% more beacon parts, half the starting food). Pick it in the lobby or with `--difficulty hard`.

- `<id>.jsonl`: every event: chat with private notes, raw and sanitized actions, latencies, token usage, round results (including animation frames), timeouts/errors, surveys.
- `<id>.summary.json`: the outcome plus cooperation metrics for each player.

`npm run analyze` prints tables by team composition and seat type. It writes `data/tethered_games.csv`, `data/tethered_players.csv`, `data/outpost_games.csv` and `data/outpost_players.csv`.

**Tethered metrics for each climber:**
- how often they climbed vs anchored
- **support anchors**: anchoring while a rope neighbour climbed
- **warn rate**: loose holds they called out ÷ loose holds they could see
- catches made, falls, times dragged down
- moves blocked by a taut rope
- messages per round
- trust received in the debrief
- how often teammates guessed they were an AI
- how accurately they guessed their teammates' identities

**Outpost metrics:** see `docs/RESEARCH.md`.

## Layout

```
src/tethered/engine.ts    Tethered rules (pure, seeded)
src/tethered/players.ts   Tethered AI / bot / human players + prompt
src/tethered/session.ts   runs a Tethered game, logs, metrics, live snapshots
src/game/outpost.ts       Outpost rules
src/session.ts            runs an Outpost game
src/players/              shared: Claude + OpenAI callers (llm.ts), human bridge, Outpost prompts/bots
src/server.ts             lobby, game pages, observer, replays (HTTP + WebSocket)
src/sim.ts, src/analyze.ts
public/tethered.*         animated cliff (live + replay)
public/play.*             Outpost UI
docs/RESEARCH.md          study design notes
```
