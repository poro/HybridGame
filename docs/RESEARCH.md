# Research design notes

## Question

When humans and AI models play on the same team toward a shared goal, how do they cooperate, and how does team composition change the outcome?

## The two games

- **Tethered** (visual): a rope-climbing co-op. Cooperation is physical and observable. You can see who anchors for whom, who warns about the loose holds they can see, who ignores a warning, and who drags the team down. The rules are simple enough for first-time human players and for small models.
- **Outpost** (text): a survival camp with private food pouches and structured pledges. It tests social dilemmas (sharing vs hoarding) and promise-keeping.

## Independent variables (lobby or `sim` flags)

| Variable | Levels | How |
|---|---|---|
| Game | tethered, outpost | lobby picker / `--game` |
| Team composition | 0H/1H/2H × which models | seat list |
| Model | opus, sonnet, haiku, fable, luna/OpenAI, bots | seat names |
| Identity disclosure | blind vs revealed | `reveal` checkbox / `--reveal` |
| Reasoning effort | low…max | `@effort` suffix |
| Communication bandwidth | chat rounds per turn | `rounds` / `--rounds` |
| Time pressure | rounds (Tethered) / days (Outpost) | `days` / `--days` |
| Seed | same hazards (loose holds / events) | `seed` / `--seed` (same world, different teams) |

Use `condition` / `--condition` to tag each run; `npm run analyze -- --condition X` filters on it.

## Dependent variables (computed automatically)

**Tethered**
- **Team:** reached the summit (y/n), climbers on top, injuries, rounds used.
- **For each climber:**
  - Support: anchors while a rope neighbour climbed; catches made.
  - Information sharing: warn rate (loose holds called out ÷ loose holds they could see).
  - Coordination failures: moves blocked by a taut rope; falls; times dragged down.
  - Communication: messages per round.
  - Debrief: trust received, "seen as AI" rate, how accurately they identified teammates.

**Outpost**
- **Team:** rescued (y/n), survivors, team score, day the game ended, parts built.
- **For each player:** pledge-keeping rate, food share rate, heals, joint-action rate, messages and words, plus the same debrief measures.

**Process data in every JSONL log:** full chat, the AIs' private notes (their stated reasoning, plans and suspicions), actions as submitted and as resolved, latencies, token usage.

## Results so far and the next study

AI-only results, with tests and confidence intervals, are in the README ("Findings so far"); reproduce them with `python3 scripts/stats.py data/games`. The first human study is planned in [PREREGISTRATION.md](PREREGISTRATION.md).

## Suggested first studies (start with Tethered)

1. **Baselines (free):** `npm run sim -- --game tethered --seats bot,bot,bot --games 500 --quiet`, and the same with `bot:selfish`.
2. **AI-only teams:** opus×3 vs haiku×3 vs mixed (opus+haiku+luna). Does the stronger model take the lead (calling who climbs and who anchors)? Do weaker models follow its warnings?
3. **1 human + 2 AI, blind vs revealed.** Do humans heed warnings from a teammate they know is an AI? Do they anchor for an AI? Can they tell which teammates are AI?
4. **2 humans + 1 AI.** Does the AI coordinate the humans, or get sidelined?
5. **Defector probe:** one `bot:selfish` (solo climber). Do humans and AIs compensate (anchor more), call it out, or give up?
6. **Same seed, different teams:** run identical cliffs (`--seed`) across compositions for a paired comparison.

## Known limitations and next steps

- Turns are sequential, with everyone talking in order (no free real-time chat). This keeps conditions symmetric and lets slow models play, but feels slower than normal chat.
- AI players are stateless between calls apart from their own private notes and the full chat/history, which are re-sent each turn.
- Tethered has one fixed cliff (good for comparisons). More walls or procedurally generated walls would test generalisation.
- Free-text promises ("I'll anchor") aren't scored against actions yet. An LLM judge over the JSONL could add promise-keeping to Tethered.
- Human-subjects research: get consent and IRB approval before running studies with real participants. The debrief stores free-text reflections.
