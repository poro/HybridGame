# HybridGame Results

**AI-only games, November 17 to 21, 2026.** Three climbers share one rope, and each can only spot the loose holds near its teammates. Across 170 blind, error-free games with Claude Opus, Sonnet and Haiku 5.5, this study asks a first question: does a model play differently depending on who its teammates are?

A styled version of this page is in [`summary.html`](summary.html). The full write-up is the [white paper](whitepaper/WHITEPAPER.md) ([PDF](whitepaper/whitepaper.pdf)), and the [slide deck](HybridGame-deck.pdf) covers the same ground.

## The game: Tethered

Three climbers are tied to one rope and must all reach the summit within 20 rounds, before a storm. Every game is seeded, so two teams can climb exactly the same cliff.

- **The rope:** neighbours can never be more than 2 tiles apart. A move that would stretch the rope further fails, so nobody can race ahead.
- **Each round:** everyone sends one radio message, then secretly picks one action: **climb** (8 directions) or **anchor** (brace the rope).
- **Loose holds:** about a fifth of holds break. A loose hold is visible only from 2 tiles away, so a climber cannot judge the hold right next to it, but a teammate can.
- **Falls:** a rope neighbour catches a fall if it is anchored or on a ledge. Uncaught, the climber drags its neighbours down and the team takes an injury. Three injuries and the team turns back.
- **Afterwards:** each player rates every teammate's trustworthiness (1 to 7) and guesses whether each was a person or an AI.

Scripted baselines show the game rewards cooperation: three cooperative bots summit in 55% of 200 games, three solo bots in 10%.

## The question

Does a model behave differently depending on who its teammates are? If it does, testing a model on its own misses part of what it will do on a team. The games ran blind: no player was told who was a model, a bot or a person. Teams were compared on the same seeded cliffs, and any game with an API error or timeout was set aside and replayed. These AI-only runs were exploratory, not preregistered.

## Findings

1. **Team composition decided the outcome.** On seeds 101 to 116, Opus, Sonnet and Haiku together reached the summit in all 16 games; three Haikus reached it in none (paired sign test, p < 0.001). The all-Haiku team never fell; it ran out of time. The mixed team adopted its own rule, stepping only on holds a teammate had already stood on, and beat the storm in rounds 15 to 20.
2. **The same model played differently on different teams.** Haiku climbed on 34% of its turns next to other Haikus and 64% next to Opus and Sonnet, a difference of 30 points (bootstrap 95% CI 26 to 34, permutation p < 0.001). Nothing about Haiku changed, only its teammates.
3. **Explicit all-clears cause about half of that effect.** Next to scripted bots that warn about every loose hold but never say a hold is safe, Haiku climbed on only 16% of its turns. Giving the same bots one sentence naming the holds they can judge solid, with identical moves, raised that to 41% (+25 points, 95% CI 18 to 32, p < 0.001). The rest of the gap, from 41% to 64%, is not explained yet.
4. **Teams failed by being too careful, not reckless.** AI climbers called out 465 of the 508 loose holds they could see (92%). Teams almost never lost to falls; they lost to the clock.
5. **Small instruction changes add up.** A clearer catching rule and shorter radio calls each cost the mixed team at most one summit; together they cost three of six (Fisher's exact p = 0.18). With six games per cell, this is a hint, not an effect.

### The controls: Haiku's climbing, by teammate

Same 16 cliffs. The two bot conditions differ only in one all-clear sentence per round.

| Haiku's teammates | Teammates' all-clears | Haiku's questions | Haiku climbs | Summits |
| --- | --- | --- | --- | --- |
| 2 bots, warn only | 0% | 32% | 16% | 0 of 16 |
| 2 bots, warn + all-clear | 67% | 10% | 41% | 2 of 16 |
| 2 other Haikus | 49% | 16% | 34% | 0 of 16 |
| Opus + Sonnet | 76% | 7% | 64% | 16 of 16 |

All-clears and questions are keyword counts, as a share of messages. Climb shares and summits are exact.

## Outpost, the second game

Outpost is a text survival game: three players with private roles build a radio beacon within 10 days while managing their own food. At normal difficulty every Claude team was rescued in 16 of 16 games. In hard mode the mixed team was rescued in 8 of 16 and the all-Haiku team in 6 of 16 (Fisher's exact p = 0.72), so Outpost has not yet separated the teams.

## A first game with a person

In blind debriefs, Haiku guessed that a teammate was an AI in 2 of 64 guesses; Sonnet named both AI teammates in 23 of 32 games. On November 21 the author played one practice game with Opus and Haiku. It is excluded from every analysis and reported only because it changed the human study's design.

- Both models identified the person as human from writing style alone: 56 words in 20 rounds, against 591 for Opus and 461 for Haiku.
- The person climbed on 85% of turns, more than Opus (70%) or Haiku (50%), and anchored for a teammate once.
- "a7 lets go", meant as encouragement, was relayed by Haiku to Opus as a loose-hold warning.

## The next study

Each participant plays one game of Tethered with two AI teammates, assigned at random to a 2 × 2 design: strong teammates (Opus and Sonnet) or weak ones (two Haikus), with identities hidden or stated. The target is 40 participants. Hypotheses, tests and exclusions are written down in advance in the [preregistration](PREREGISTRATION.md).

| | Hypothesis | Test |
| --- | --- | --- |
| H1 | People climb on a larger share of turns next to strong AI teammates. | One-sided permutation |
| H2 | Teams with strong AI teammates summit more often. | One-sided Fisher's exact |
| H4 | Stating identities changes people's trust in their AI teammates. | Two-sided permutation |
| Check | How often the AI teammates identify the person in hidden-identity games. | 95% interval, not tested |

## How to watch games

The code is public. Game logs stay in a separate private repository because they include participants' chat, so to watch games you run your own (see the [README](../README.md#quick-start)).

```bash
npm install
npm run dev        # lobby at http://localhost:8787
npm run sim -- --game tethered --seats opus,sonnet,haiku --games 3
```

1. In the lobby, pick Tethered, set the seats (for example `opus`, `sonnet`, `haiku`) and create the game.
2. Open the observer link to watch live. It shows the loose holds and each model's summarised thinking next to its radio messages.
3. Finished games have a replay link that runs at 0.5× to 4× speed.

A game with Opus and Sonnet costs about $1.40 in model calls; three Haikus about $0.09.

## Related work

Cooperative games are long-standing testbeds for AI that must coordinate: Hanabi built a benchmark around information only teammates hold (Bard et al., 2020), and agents trained only with copies of themselves coordinate poorly with people (Carroll et al., 2019). Language models in repeated games did well when self-interest paid and poorly when coordination was needed (Akata et al., 2025). Human-autonomy teaming research has studied synthetic teammates working with people (McNeese et al., 2018; O'Neill et al., 2022), and people both over- and under-rely on automated partners (Lee & See, 2004). The pull of a group on individual judgment is a classic finding about people (Asch, 1956), and partners in conversation look for positive evidence that they were understood, not only reports of trouble (Clark & Brennan, 1991). The practice game reverses the Turing test, in which people often cannot tell a model from a person in short chats (Jones & Bergen, 2024).

- Akata, E., Schulz, L., Coda-Forno, J., Oh, S. J., Bethge, M., & Schulz, E. (2025). Playing repeated games with large language models. *Nature Human Behaviour, 9*(7), 1380–1390. [doi:10.1038/s41562-025-02172-y](https://doi.org/10.1038/s41562-025-02172-y)
- Asch, S. E. (1956). Studies of independence and conformity: I. A minority of one against a unanimous majority. *Psychological Monographs, 70*(9), 1–70.
- Bard, N., Foerster, J. N., Chandar, S., et al. (2020). The Hanabi challenge: A new frontier for AI research. *Artificial Intelligence, 280*, 103216.
- Carroll, M., Shah, R., Ho, M. K., Griffiths, T. L., Seshia, S. A., Abbeel, P., & Dragan, A. (2019). On the utility of learning about humans for human-AI coordination. *NeurIPS 32*.
- Clark, H. H., & Brennan, S. E. (1991). Grounding in communication. In *Perspectives on socially shared cognition* (pp. 127–149). American Psychological Association.
- Jones, C. R., & Bergen, B. K. (2024). People cannot distinguish GPT-4 from a human in a Turing test. [arXiv:2405.08007](https://arxiv.org/abs/2405.08007)
- Lee, J. D., & See, K. A. (2004). Trust in automation: Designing for appropriate reliance. *Human Factors, 46*(1), 50–80.
- McNeese, N. J., Demir, M., Cooke, N. J., & Myers, C. (2018). Teaming with a synthetic teammate: Insights into human-autonomy teaming. *Human Factors, 60*(2), 262–273. [doi:10.1177/0018720817743223](https://doi.org/10.1177/0018720817743223)
- O'Neill, T., McNeese, N., Barron, A., & Schelble, B. (2022). Human-autonomy teaming: A review and analysis of the empirical literature. *Human Factors, 64*(5), 904–938. [doi:10.1177/0018720820960865](https://doi.org/10.1177/0018720820960865)

The [white paper](whitepaper/WHITEPAPER.md) places the study in context with 28 references.

## Limits

All games so far are AI-only, Claude-only, blind and exploratory. Comparisons use 16 cliffs, and the wording split test 6 games per cell. All-clears and questions are keyword counts. The controls explain about half of Haiku's teammate effect; the rest is open. One practice game by the researcher is the only human data.

This page was drafted with Claude in Claude Code from the white paper; the author directed and reviewed it.
