# Game night: family pilot on this Mac

An informal pilot: one person plays Tethered with two AI teammates. It's not a formal study, so these games show whether the setup works and give first impressions, not publishable results.

## Before anyone plays
- Ask each person if they're OK with their chat and answers being saved. The data stays private (in poro/HybridGame-data, never shared).
- Close other apps. The Mac stays awake while the game runs.
- Check credit: each game with Opus costs about $1 to $1.50.

## Start
1. Double-click **Game Night.command** in the HybridGame folder. A Terminal window opens, then the lobby at http://localhost:8787. Leave the Terminal window open.
2. In the lobby:
   - Game: **Tethered**
   - Seats: `human`, `opus`, `haiku`
   - Leave "reveal identities" **off** (blind, like all games so far)
   - Condition label: `family-pilot`
   - Seconds per turn (people): **120** (lower to 90 for quick players, raise for kids)
3. Click **Create game**, then open the **human join link** and hand over the keyboard.
4. Optional: open the **observer link** on another screen to watch the AIs' thinking. Don't show it to the player during the game.

## While playing
- Explain only what's in the "How to play" box. Don't say which teammates are AI.
- A game takes about 15 to 25 minutes.
- Let them finish the **debrief questions** at the end. They're the most useful part.

## After the session
- Close the Terminal window to stop the server.
- Run `npm run backup-data` in the HybridGame folder to save the games to the private data repo.
- Run `npm run analyze` to see the results (games labelled `family-pilot`).
