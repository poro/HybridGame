# Same Model, Different Team

**How AI teammates shape one another in a cooperative climbing game: results from 170 AI-only games with Claude models, two causal controls, and the plan for mixed human and AI teams**

Dr. Mark Ollila, Founding Director · Endless Games and Learning Lab, Arizona State University · White paper · November 2026

A styled version with the Lab's branding is built from this file by `build.py` (`whitepaper.html`, `whitepaper.pdf`).

<!-- body -->

## Abstract

AI models are starting to work on teams: with people, with each other, and with both at once. Most evaluations still test a model on its own. This paper reports early results from HybridGame, a testbed in which humans and AI models play cooperative games on the same team, and asks a simple question first: does a model behave differently depending on who its teammates are?

In Tethered, a rope-climbing game, three climbers share one rope, can only see loose holds two tiles away, and must warn one another to reach the summit before a storm. Across 170 error-free, blind, AI-only games with Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5, played between November 17 and 20, 2026, four findings stand out.

First, team composition decided the outcome: on the same 16 seeded cliffs, Opus, Sonnet and Haiku together reached the summit in 16 of 16 games, and three Haikus in 0 of 16 (paired sign test, p < 0.001). Second, the same model played differently on different teams: Haiku climbed on 34% of its turns next to other Haikus and 64% next to Opus and Sonnet (+30 points, 95% CI 26 to 34). Third, two controls with scripted teammates identified a cause. Next to bots that warn about every loose hold but never say a hold is safe, Haiku climbed on only 16% of its turns; adding one all-clear sentence to the same bots, with identical moves, raised that to 41% (+25 points, 95% CI 18 to 32, p < 0.001). Explicit all-clears cause about half of Haiku's teammate effect. Fourth, the teams failed by being too careful, not by being reckless: they called out 465 of 508 loose holds they could see, and lost by running out of time.

All of this comes from AI-only teams. A first practice game with a person, reported here as an illustration only, showed why the human study has to be designed differently: both AI teammates identified the human from writing style alone, and the human's play was the opposite of Haiku's. The paper closes with the preregistered design for the human study, revised after that game.

## 1. Why teams

AI systems are moving from answering questions to taking part in work: coordinating schedules, sharing tasks, splitting resources, acting alongside people who depend on them. In that setting the unit that matters is the team, not the model (McNeese et al., 2018; O'Neill et al., 2022). A model that is safe and capable alone may stall, take over, or mislead when it is one voice among several, and the people next to it may change how they play: decades of research on automation show people both over- and under-relying on automated partners (Parasuraman & Riley, 1997; Lee & See, 2004).

Three questions follow, and HybridGame was built to study them:

- **Does a model's behaviour depend on its teammates?** If so, single-model evaluations miss part of what a deployed model will do.
- **What do teammates do that changes it?** A correlation between strong teammates and better play has many explanations; controls are needed to find the mechanism.
- **Do people respond to AI teammates the way models respond to each other?** And can the models tell when a teammate is human?

This paper answers the first question, gives a partial causal answer to the second, and sets up the third.

**Where this fits.** Cooperative games have long been testbeds for AI that must coordinate with partners. Hanabi built a benchmark around hidden information that only teammates hold (Bard et al., 2020), and Overcooked-AI showed that agents trained only with copies of themselves coordinate poorly with people (Carroll et al., 2019; see also Hu et al., 2020; Strouse et al., 2021). Language models have since played negotiation games with people (Meta FAIR Diplomacy Team et al., 2022) and repeated economic games, where they did well when self-interest paid and poorly when coordination was needed (Akata et al., 2025), and have populated simulated social worlds (Park et al., 2023). Human-autonomy teaming research, including work at Arizona State University, has studied synthetic teammates working with people (McNeese et al., 2018; O'Neill et al., 2022), and cooperative AI has been set out as an open research field (Dafoe et al., 2020). Studies of human groups find that a team's performance is not simply the sum of its members' abilities (Woolley et al., 2010). HybridGame adds a setting in which the same language models can be placed on different teams, with or without people, under identical rules and maps.

## 2. The testbed

HybridGame is a web platform in which any mix of people, Claude models, OpenAI models and scripted bots can sit at the same table. A lobby sets up the seats and conditions; people play in a browser and models play through the API, under the same rules and with the same information. Every game is seeded and deterministic, so two teams can play exactly the same map.

<!-- figure:screen -->

### Tethered, the main game

Three climbers are tied to **one rope** and must all reach the summit within 20 rounds, before a storm.

| Element | Rule |
| --- | --- |
| The rope | Neighbours on the rope can never be more than 2 tiles apart. A move that would stretch it further fails, so nobody can race ahead. |
| Each round | Everyone sends one radio message, then secretly picks one action: **climb** (8 directions) or **anchor** (brace the rope). |
| Loose holds | About a fifth of holds break. A climber can only spot a loose hold **2 tiles away**, never the one right next to them. Because the rope keeps partners 1 to 2 tiles apart, a climber's teammates are the ones who can see its next holds. |
| Falls | Step on a loose hold and you fall. A rope neighbour catches you if, after the moves, they are anchored or on a ledge, the ground or the summit. Uncaught, you drop and drag your neighbours with you, and the team takes an injury. Three injuries and the team turns back. |
| End | Everyone reaches the summit, the storm hits after round 20, or the team takes three injuries. |

The design packs the main patterns of cooperative games into a few rules: shared fate, a visible clock, a support action (anchoring), and hidden information that only teammates hold, the idea at the heart of Hanabi (Bard et al., 2020). Scripted baselines confirm that the game rewards cooperation: three cooperative bots, which warn, avoid warned holds and anchor for laggards, summit in 55% of 200 games; three solo bots that never talk or anchor summit in 10%.

### Outpost, the second game

Outpost is a text survival game: three players with private roles build a radio beacon from salvaged parts within 10 days, while food they forage goes into their own pouch and sharing it leaves them exposed. Players pledge a plan in chat, then act in secret, so the log shows who kept their word. Scripted bots are rescued in 58% of games with three cooperative bots and 11% when one is selfish.

### What is measured

| Source | Measures |
| --- | --- |
| The game | Climbs and anchors; support anchors (bracing while a neighbour climbs); warn rate (loose holds called out ÷ loose holds seen); catches, falls and moves blocked by the rope. Outpost adds pledges kept, food shared and joint actions. |
| The debrief | Each player rates every teammate's trustworthiness (1 to 7) and guesses whether each was a human or an AI. |
| The log | The full chat and every action; each model's short memo and the API's summarised thinking; response times, tokens and cost for every call. |

## 3. Method

**Models.** Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5 through the Anthropic API, with structured JSON outputs, a cached system prompt, and adaptive thinking with summaries. Models return a short memo that is fed back on later turns; they are never asked to write out their reasoning in the answer, which the models' safeguards decline. Researchers read the API's thinking summaries instead.

**Paired seeds.** Every comparison between teams uses the same seeded maps. The main Tethered comparison uses seeds 101 to 116 for every team; hard Outpost uses 201 to 216.

**Blind play.** Every AI-only game was blind: players were not told who was a model, a bot or a person.

**Clean games only.** Any game with an API error, a timeout or a blocked call is set aside automatically and its seed replayed. Five Tethered games interrupted when the host computer slept were replayed on the same seeds. Every result below comes from error-free games.

**Rule versions.** Changing what players read changes results, so every game logs its rules version and variant, and versions are never pooled. Version 1 covers all main results. Version 2 (a clearer catching rule and one-sentence radio calls) was tested separately, one change at a time.

**Statistics.** Rates carry 95% Wilson intervals (Wilson, 1927). Team outcomes on paired seeds use a sign test; independent proportions use Fisher's exact test (Fisher, 1935). Climb shares are game-level means compared with a bootstrap 95% interval (Efron & Tibshirani, 1993) and a permutation test (Good, 2005), each with 20,000 resamples, so p < 0.001 is the floor reported. Chat measures such as all-clears and questions are keyword counts. All analysis is in one standard-library Python script.

**Status.** These AI-only runs were exploratory, not preregistered. The human study is preregistered (Section 10).

**Cost.** About $34 in model cost for all 170 games, measured from token counts at list prices: roughly $1.39 per Opus, Sonnet and Haiku game in Tethered and $0.09 per all-Haiku game.

## 4. Team composition decides the outcome

| Seeds 101 to 116, rules v1 | Three Haikus | Opus + Sonnet + Haiku |
| --- | --- | --- |
| Reached the summit | 0 of 16 games | 16 of 16 games, in rounds 15 to 20 |
| Falls | 0 (3 slips caught) | 2 (3 slips caught) |
| Turns spent climbing | 34% | 64% |
| Loose holds called out | 88% of those seen | 94% of those seen |
| Trust from teammates (1 to 7) | 5.1 on average | 6.5 on average |
| Model cost per game | about $0.09 | about $1.39 |

All 16 seeds were discordant and all favoured the mixed team (sign test, p < 0.001). The all-Haiku team understood the key rule at once, and that understanding made it cautious. One Haiku's first message summed it up: it could not judge the holds next to it, so it would not move until someone spotted a loose one two tiles out. The team never fell, and never reached the top. The mixed team invented its own safety rule, stepping only on holds a teammate had already stood on, and climbed fast enough to beat the storm.

## 5. Same model, different team

The clearest single finding concerns Haiku, the one model that appears in both teams. On the same 16 cliffs, Haiku climbed on **34%** of its turns when its teammates were other Haikus and **64%** when they were Opus and Sonnet: a difference of 30 points (bootstrap 95% CI 26 to 34, permutation p < 0.001). With Haiku teammates it anchored or waited about two thirds of the time; with stronger teammates it climbed about two thirds of the time.

This matters because nothing about Haiku changed. A single-model evaluation would report one Haiku. On a team there are at least two, and which one appears depends on the others. The pull of a group on individual judgment is a classic finding about people (Asch, 1956); this is a version of it in a language model that was never told to agree.

The obvious explanation is safety: stronger teammates warn more and anchor more, so climbing becomes less risky and Haiku rationally climbs more. The two controls below were designed to test that explanation and the alternatives.

## 6. Two controls: explicit all-clears cause about half the effect

<!-- figure:climb -->

**First control: teammates who only warn.** Haiku played the same 16 cliffs with two scripted cooperative bots. The bots warn about every loose hold they can see, avoid warned holds and anchor reliably, but never say a hold is safe. If stronger teammates help by making climbing safer, Haiku should climb at least as much here as with other Haikus. Instead it climbed on **16%** of its turns, and the team never summited. Haiku kept asking whether holds were loose or solid: questions made up 32% of its messages.

**Second control: the same bots plus one sentence.** The bots were then given one addition: each round, they name up to three holds they can judge, next to or above a teammate, as solid. Their moves are otherwise identical, which was checked over 200 bot-only games. Haiku's climbing rose to **41%** (+25 points over the warn-only bots, 95% CI 18 to 32, p < 0.001), its questions fell to 10% of its messages, and two teams summited.

| Haiku's teammates | Teammates' all-clears | Haiku's questions | Haiku climbs | Summits |
| --- | --- | --- | --- | --- |
| 2 bots, warn only | 0% | 32% | 16% | 0 of 16 |
| 2 bots, warn + all-clear | 67% | 10% | 41% | 2 of 16 |
| 2 other Haikus | 49% | 16% | 34% | 0 of 16 |
| Opus + Sonnet | 76% | 7% | 64% | 16 of 16 |

Because only the all-clear sentence changed, this is a causal effect of explicit all-clears. It closes about half of the gap between the warn-only bots and Opus and Sonnet. The rest, from 41% to 64%, is not explained yet. The likely candidates are things Opus and Sonnet do that the bots never do: answering Haiku's questions and proposing shared plans. In the mixed games we read, Opus or Sonnet usually proposed the plan and Haiku took it up, but who leads has not been measured.

The general lesson is uncomfortable for a common design instinct. A teammate that reports every problem and never confirms that something is fine can make a careful partner stall. That applies to AI teammates and, plausibly, to people. Research on conversation describes the same need: partners look for positive evidence that they have been understood, not only for reports of trouble (Clark & Brennan, 1991).

## 7. Careful, not reckless, and sensitive to wording

**Failures came from caution.** Across all v1 games, AI climbers called out 465 of the 508 loose holds they could see (92%). Teams almost never lost to falls; they lost to the clock. Caution was the default for every Claude model tested. Whether it survives next to a person who pushes the pace is an open question that the first practice game (Section 9) suggests is real.

**Small instruction changes add up.** Rules version 2 changed two things at once: a clearer catching rule and one-sentence radio calls. A split test on the same six cliffs separated them.

| Seeds 101 to 106 | Mixed team: summits | Mixed: words per call | Mixed: climbing | All-Haiku: climbing |
| --- | --- | --- | --- | --- |
| v1, original | 6 of 6 | 45 | 65% | 32% |
| Rules change only | 5 of 6 | 44 | 59% | 32% |
| Radio change only | 6 of 6 | 26 | 59% | 31% |
| v2, both changes | 3 of 6 | 27 | 58% | 21% |

Each change alone cost the mixed team at most one summit; together they cost three, and the all-Haiku team slowed down only when both came together. With six games per cell this is a hint, not an effect (v1 against v2, Fisher's exact p = 0.18). An earlier reading, based on four of the six rules-only games, blamed the catching rule alone; the last two games did not support it, and the conclusion was corrected.

## 8. Outpost: difficulty decides what can be seen

At normal difficulty, tuned on scripted bots, Outpost could not tell Claude teams apart: Opus, Sonnet and Haiku together and three Haikus were both rescued in 16 of 16 games. The finer measures leaned the same way as in Tethered (the mixed team kept 267 of 267 pledges against 292 of 297, shared 30% of foraged food against 22%, and was trusted more, 5.8 against 4.7), but none changed the outcome.

A hard mode, with 50% more beacon parts and half the starting food, removed the ceiling but showed no clear winner: the mixed team was rescued in 8 of 16 games and the all-Haiku team in 6 of 16 (Fisher's exact p = 0.72). The mixed team won on two seeds the Haiku team lost and never the reverse, but more of its players died along the way (26 of 48 against 22 of 48). That may be a trade-off between finishing the job and keeping everyone alive, but it is a question for more games, not a finding.

## 9. Identity, and a first game with a person

**Models rarely spot AI teammates.** In blind debriefs, Haiku guessed that a teammate was an AI in only 2 of its 64 guesses. Sonnet named both of its AI teammates in 23 of its 32 games, often citing consistent, structured phrasing.

**A first practice game.** On November 21 the author played one practice game of Tethered with Opus and Haiku as teammates, blind, under rules v2. It is one game by the researcher, excluded from every analysis and labelled as practice in the data. It is reported because it changed the design of the human study.

- **The human was obvious.** The person wrote 56 words in 20 rounds against 591 for Opus and 461 for Haiku, left 9 rounds silent, and typed short lowercase commands. Both models guessed "human" correctly, and both rated the person's trustworthiness 3 against 6 for each other.
- **The opposite of Haiku.** The person climbed on 85% of turns, more than Opus (70%) or Haiku (50%), and anchored to support a teammate once (Opus 6, Haiku 10). The team lost when the storm hit, partly because the person stepped onto a hold a teammate had called loose, with no anchor, and fell three rows.
- **Short messages were misread.** "a7 lets go", meant as encouragement, was relayed by Haiku to Opus as a loose-hold warning. The hold was never loose.
- **The models paired up.** Opus and Haiku agreed with each other nearly every round, and twice moved the person down a row so the other model could pass. Whether this relates to sycophancy, the tendency of assistant models to agree with the people they talk to (Sharma et al., 2024), is untested.

The direction is the reverse of the Turing test (Turing, 1950). There, people try to tell a machine from a person, and in recent short text chats they often could not (Jones & Bergen, 2024). Here the models told the person apart at once, from style alone.

None of this is evidence about people in general. It shows that the measures and the blind condition built for AI-only teams need changes before they are used with people.

## 10. The next study

The human study is preregistered in draft and will be registered before its first confirmatory game, so that the hypotheses and analyses are fixed before the data exist (Nosek et al., 2018). Each participant plays one game of Tethered (rules v2) with two AI teammates, assigned at random to a 2 × 2 between-subjects design: strong teammates (Opus and Sonnet) or weak ones (two Haikus), and identities hidden or stated. The target is 40 participants, 10 per cell, at about $30 in model cost.

| | Hypothesis | Test |
| --- | --- | --- |
| H1 | People climb on a larger share of turns next to strong AI teammates than next to weak ones. | One-sided permutation test |
| H2 | Teams with strong AI teammates summit more often. | One-sided Fisher's exact test |
| H4 | Stating identities changes people's trust in their AI teammates (1 to 7). | Two-sided permutation test |
| Check | How often the AI teammates identify the person as human in hidden-identity games. | Reported with a 95% interval, not tested |

H4 is two-sided because earlier work points both ways: people lose trust in an algorithm quickly after seeing it err (Dietvorst et al., 2015), yet often prefer algorithmic advice to human advice (Logg et al., 2019). Holm correction (Holm, 1979) applies across H1, H2 and H4. Exclusions are fixed in advance: any game with an AI error or timeout, a person who times out on more than a quarter of their steps, and anyone who has played Tethered before.

The practice game changed four things. Whether the models spot the person, first planned as hypothesis H3, became a manipulation check, because style alone gives the person away. If a family pilot shows people near the ceiling on climb share, the primary measure for H1 switches, before the first confirmatory game, to risky steps onto holds a teammate called loose and adherence to the team's plan. Human messages, and AI messages addressed to the person, will be coded by hand by two coders blind to condition, with agreement reported as Cohen's κ (Cohen, 1960), because keyword counts built on model sentences misread human shorthand. And the debrief will require a one-sentence reflection, with two fixed-choice items on who led and whether the person felt included. Informed consent and IRB approval come before any confirmatory game.

## 11. What this means for AI teammates

- **Evaluate models in teams, not only alone.** The same model climbed nearly twice as often next to stronger teammates. Behaviour on a team is a property of the team.
- **Confirmation is information.** A teammate that only reports problems made a careful model stall; one added sentence of confirmation doubled its pace. Designers of AI teammates, and of the instructions people give them, should treat "this is fine" as a signal worth sending.
- **Caution is the default, and that may change next to people.** Every Claude team failed by being slow, never by being reckless. A person who takes risks may change what a careful model does, in either direction.
- **Multi-agent behaviour is sensitive to wording.** Two harmless-looking changes together halved the mixed team's summits. Changes to instructions should be split-tested.
- **Disclosure needs measuring, not assuming.** Models rarely flagged other models, but immediately spotted a person. Whether people know when a teammate is an AI, and whether it matters, is a question for the human study.
- **Work with the safeguards.** Asking models to write out their reasoning was declined by a safety filter. The design now reads summarised thinking and a short memo, and loses nothing important.

## 12. Limits

- **AI-only and Claude-only.** No participant has played yet; one practice game by the researcher is the only human data. Three models from one family played; OpenAI models are supported but have not played.
- **Exploratory.** The AI-only games were not preregistered. Hypotheses tested on them were formed while looking at the data, which makes false positives more likely (Simmons et al., 2011).
- **Small samples.** 16 cliffs per comparison, 6 games per cell in the split test, one game designer, and maps tuned with scripted bots.
- **Blind only.** Every AI-only game hid identities, so nothing here says what stating them changes.
- **Rough chat measures.** All-clears and questions are keyword counts. Climb shares and summits are exact.
- **Half explained.** The controls account for about half of Haiku's teammate effect. The rest is open.

## 13. Reproducibility and how this was built

Every game is seeded and logs its rules version, full chat, actions, model memos, thinking summaries, token use and cost. Teams are compared on the same maps, games with any error are set aside and replayed, bot results are always labelled as such, and three conclusions have been corrected openly as more data arrived. Statistics come from one script (`scripts/stats.py`) run on the game summaries.

Participant data, including all chat and debrief answers, is kept in a separate private repository and is never published raw. The code, the rules, the analysis script and the source of this paper are public at https://github.com/poro/HybridGame.

The platform was written with Claude Code (Claude Opus 5.5), with the author directing the project, designing the studies and reviewing every result. The text of this paper and the slide deck were also drafted with Claude (Opus 5.5) in Claude Code, from the game logs and analysis; the author directed and reviewed them and is responsible for their content. The AI players are Claude models called through the Anthropic API.

## References

- Akata, E., Schulz, L., Coda-Forno, J., Oh, S. J., Bethge, M., & Schulz, E. (2025). Playing repeated games with large language models. *Nature Human Behaviour, 9*(7), 1380-1390. https://doi.org/10.1038/s41562-025-02172-y
- Asch, S. E. (1956). Studies of independence and conformity: I. A minority of one against a unanimous majority. *Psychological Monographs: General and Applied, 70*(9), 1-70.
- Bard, N., Foerster, J. N., Chandar, S., et al. (2020). The Hanabi challenge: A new frontier for AI research. *Artificial Intelligence, 280*, 103216.
- Carroll, M., Shah, R., Ho, M. K., Griffiths, T. L., Seshia, S. A., Abbeel, P., & Dragan, A. (2019). On the utility of learning about humans for human-AI coordination. *Advances in Neural Information Processing Systems, 32*.
- Clark, H. H., & Brennan, S. E. (1991). Grounding in communication. In L. B. Resnick, J. M. Levine, & S. D. Teasley (Eds.), *Perspectives on socially shared cognition* (pp. 127-149). American Psychological Association.
- Cohen, J. (1960). A coefficient of agreement for nominal scales. *Educational and Psychological Measurement, 20*(1), 37-46.
- Dafoe, A., Hughes, E., Bachrach, Y., Collins, T., McKee, K. R., Leibo, J. Z., Larson, K., & Graepel, T. (2020). Open problems in cooperative AI. arXiv:2012.08630.
- Dietvorst, B. J., Simmons, J. P., & Massey, C. (2015). Algorithm aversion: People erroneously avoid algorithms after seeing them err. *Journal of Experimental Psychology: General, 144*(1), 114-126.
- Efron, B., & Tibshirani, R. J. (1993). *An introduction to the bootstrap*. Chapman & Hall.
- Fisher, R. A. (1935). *The design of experiments*. Oliver & Boyd.
- Good, P. I. (2005). *Permutation, parametric, and bootstrap tests of hypotheses* (3rd ed.). Springer.
- Holm, S. (1979). A simple sequentially rejective multiple test procedure. *Scandinavian Journal of Statistics, 6*(2), 65-70.
- Hu, H., Lerer, A., Peysakhovich, A., & Foerster, J. (2020). "Other-play" for zero-shot coordination. *Proceedings of the 37th International Conference on Machine Learning*, PMLR 119.
- Jones, C. R., & Bergen, B. K. (2024). People cannot distinguish GPT-4 from a human in a Turing test. arXiv:2405.08007.
- Lee, J. D., & See, K. A. (2004). Trust in automation: Designing for appropriate reliance. *Human Factors, 46*(1), 50-80.
- Logg, J. M., Minson, J. A., & Moore, D. A. (2019). Algorithm appreciation: People prefer algorithmic to human judgment. *Organizational Behavior and Human Decision Processes, 151*, 90-103.
- McNeese, N. J., Demir, M., Cooke, N. J., & Myers, C. (2018). Teaming with a synthetic teammate: Insights into human-autonomy teaming. *Human Factors, 60*(2), 262-273. https://doi.org/10.1177/0018720817743223
- Meta Fundamental AI Research Diplomacy Team (FAIR), Bakhtin, A., Brown, N., et al. (2022). Human-level play in the game of Diplomacy by combining language models with strategic reasoning. *Science, 378*(6624), 1067-1074.
- Nosek, B. A., Ebersole, C. R., DeHaven, A. C., & Mellor, D. T. (2018). The preregistration revolution. *Proceedings of the National Academy of Sciences, 115*(11), 2600-2606.
- O'Neill, T., McNeese, N., Barron, A., & Schelble, B. (2022). Human-autonomy teaming: A review and analysis of the empirical literature. *Human Factors, 64*(5), 904-938. https://doi.org/10.1177/0018720820960865
- Parasuraman, R., & Riley, V. (1997). Humans and automation: Use, misuse, disuse, abuse. *Human Factors, 39*(2), 230-253.
- Park, J. S., O'Brien, J. C., Cai, C. J., Morris, M. R., Liang, P., & Bernstein, M. S. (2023). Generative agents: Interactive simulacra of human behavior. *Proceedings of the 36th Annual ACM Symposium on User Interface Software and Technology (UIST '23)*.
- Sharma, M., Tong, M., Korbak, T., et al. (2024). Towards understanding sycophancy in language models. *International Conference on Learning Representations (ICLR 2024)*. arXiv:2310.13548.
- Simmons, J. P., Nelson, L. D., & Simonsohn, U. (2011). False-positive psychology: Undisclosed flexibility in data collection and analysis allows presenting anything as significant. *Psychological Science, 22*(11), 1359-1366.
- Strouse, D. J., McKee, K. R., Botvinick, M., Hughes, E., & Everett, R. (2021). Collaborating with humans without human data. *Advances in Neural Information Processing Systems, 34*.
- Turing, A. M. (1950). Computing machinery and intelligence. *Mind, 59*(236), 433-460.
- Wilson, E. B. (1927). Probable inference, the law of succession, and statistical inference. *Journal of the American Statistical Association, 22*(158), 209-212.
- Woolley, A. W., Chabris, C. F., Pentland, A., Hashmi, N., & Malone, T. W. (2010). Evidence for a collective intelligence factor in the performance of human groups. *Science, 330*(6004), 686-688.
