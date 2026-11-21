# Preregistration draft: one person, two AI teammates (Tethered)

Status: **draft, not yet registered.** Register it (for example on OSF) before the first confirmatory game. The family pilot (condition `family-pilot`) is exploratory: it tests the setup and estimates variance, and it is excluded from the confirmatory analysis.

## Background (AI-only results, 2026-11-17 to 11-19)

In 138 error-free, blind AI-only games:
- **Team mix:** in Tethered (rules v1), Opus + Sonnet + Haiku summited 16 of 16 games and three Haikus 0 of 16, on the same 16 seeded cliffs (sign test on paired seeds, p < 0.001).
- **Teammate effect:** Haiku climbed on 34% of its turns with Haiku teammates and 64% with Opus and Sonnet (game-level means, difference +30 points, bootstrap 95% CI 26 to 34, permutation p < 0.001).

The question for this study is whether a **person's** play shifts with their AI teammates the same way Haiku's did.

## Design

- **Game:** Tethered, current default rules (v2, short radio). 3 climbers: 1 person + 2 AI. The person's rope position (their place in the lobby's seat list) is chosen at random.
- **Factor A, AI teammates (between subjects):** strong (Opus 5.5 + Sonnet 5.5) vs weak (Haiku 5.5 + Haiku 5.5).
- **Factor B, identities (between subjects):** blind vs revealed (lobby "reveal" checkbox).
- **Assignment:** each participant plays **one** confirmatory game, assigned at random to one of the 4 cells, on seeds drawn from a fixed list shared across cells.
- **Turn time:** 120 seconds per step for the person.

## Hypotheses

| | Hypothesis | Test |
|---|---|---|
| H1 | People climb on a larger share of their turns next to strong AI teammates than next to weak ones. | One-sided permutation test on climb share (climbs ÷ actions) |
| H2 | Teams with strong AI teammates summit more often. | One-sided Fisher exact test |
| H4 | Revealing identities changes people's trust in their AI teammates (debrief, 1 to 7). | Two-sided permutation test |

α = 0.05, Holm correction across H1, H2 and H4. All other measures (warn rate, support anchors, catches, chat length, people's identity guesses) are exploratory and reported as such.

**Manipulation check (was H3).** How often the AI teammates identify the person as human in blind games is reported descriptively (rate and 95% CI), not tested as a hypothesis. In the first practice game both AIs named the human correctly from writing style alone (see "Pilot lessons"), so a test against 50% would be uninformative. "Blind" in this study means names and seat types are hidden, not that the person is undetectable; Factor B is read as "identities stated vs. hidden", and H4 is interpreted with the detection rate in view.

## Sample size

Target **40 participants** (10 per cell). Haiku's effect was very large (+30 points); people will vary far more, so revisit this number with the pilot's variance before registering. Cost estimate: about $1.40 per strong-teammate game and $0.10 per weak one, so about $30 in API cost.

## Exclusions (decided in advance)

- Any AI error or timeout in the game (the simulator's `clean: false`).
- The person times out on more than 25% of their steps.
- The person has played Tethered before.

## AI-only control (done 2026-11-20)

Haiku + 2 scripted cooperative bots on the same 16 seeds (condition `haiku-bot-control`). The bots warn and anchor but never give an all-clear. Haiku climbed on 16% of its turns (vs 34% with Haikus, 64% with Opus and Sonnet) and the team never summited. Haiku's climbing tracks teammates' explicit all-clears, so for people:

- **Exploratory measure E1:** the share of the person's messages that give an all-clear (keyword count, as in `scripts/stats.py`), and how it relates to the AI teammates' climb share.
- **Second control (done 2026-11-20):** the same bots plus an all-clear sentence (`bot:allclear`, condition `haiku-allclear-control`). Haiku's climbing rose from 16% to 41% (+25 points, 95% CI 18 to 32, p < 0.001). Explicit all-clears cause about half of the teammate effect.
- **Exploratory measure E2:** the AI teammates' all-clear rate to the person, as a possible mediator of H1 (strong teammates gave all-clears in 76% of messages, Haikus in 49%).

## Pilot lessons (researcher practice game, 2026-11-21)

One game, the researcher with Opus + Haiku, blind, rules v2, condition `practice-researcher`. Not evidence about the hypotheses; it changed the design as follows.

1. **Identity is obvious from style.** The person wrote 56 words in 20 rounds (Opus 591, Haiku 461), left 9 rounds silent, and wrote in short lowercase commands. Both AIs guessed "human" correctly and rated the person's trust 3 against 6 for each other. → H3 becomes a manipulation check (above).
2. **Climb share may hit a ceiling for people.** The person climbed on 85% of turns (Opus 70%, Haiku 50%) and anchored to support a teammate once (Opus 6, Haiku 10). The failure was the reverse of Haiku's: not hesitation but stepping off-plan onto a hold a teammate had called loose, with no anchor, falling 3 rows. Before registering, check climb share's spread in the family pilot. If most people sit near the top, make the primary H1 measure **E3** below instead, and record that switch here before the first confirmatory game.
   - **E3 (exploratory unless promoted):** risky steps, i.e. the share of a person's moves onto a hold that a teammate had named in chat while knowing it was loose, earlier in the game and before it was broken; and plan adherence, i.e. the share of rounds where the person's move matches what a teammate proposed for them that round (hand-coded).
3. **Short human messages are ambiguous.** "a7 lets go" (meant as "A7, let's go") was relayed by Haiku as a loose-hold warning. The keyword counts in `scripts/stats.py` were built on AI sentences and would misread it the same way. → All human messages, and AI messages addressed to the person, are hand-coded for warnings, all-clears, questions and proposals by two coders blind to condition; report Cohen's κ. Keyword counts are used only for AI-to-AI messages, after checking them against a hand-coded sample.
4. **The AIs paired up.** They agreed with each other almost every round and twice moved the person down a row to let the other AI pass. → Exploratory: share of AI messages addressed to the person vs. to the other AI, and how often a plan moves the person down.
5. **Empty debrief.** The free-text reflection was skipped. → Before the study, make a one-sentence reflection required and add two fixed-choice items (who led the plan; whether the person felt included).

## Ethics and data

Informed consent and IRB approval before any confirmatory game. Chat and debrief answers stay in the private data repository (poro/HybridGame-data) and are never published raw.
