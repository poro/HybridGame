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
| H3 | In blind games, the AI teammates identify the person as human above chance. | One-sided binomial test vs 50% |
| H4 | Revealing identities changes people's trust in their AI teammates (debrief, 1 to 7). | Two-sided permutation test |

α = 0.05, Holm correction across H1 to H4. All other measures (warn rate, support anchors, catches, chat length, people's identity guesses) are exploratory and reported as such.

## Sample size

Target **40 participants** (10 per cell). Haiku's effect was very large (+30 points); people will vary far more, so revisit this number with the pilot's variance before registering. Cost estimate: about $1.40 per strong-teammate game and $0.10 per weak one, so about $30 in API cost.

## Exclusions (decided in advance)

- Any AI error or timeout in the game (the simulator's `clean: false`).
- The person times out on more than 25% of their steps.
- The person has played Tethered before.

## AI-only control to run first

Haiku + 2 scripted cooperative bots on the same 16 seeds. If Haiku's climb share rises there too, the teammate effect is a reaction to teammates' behaviour (warnings and anchors), not to who the teammates are. That changes how H1 should be read.

## Ethics and data

Informed consent and IRB approval before any confirmatory game. Chat and debrief answers stay in the private data repository (poro/HybridGame-data) and are never published raw.
