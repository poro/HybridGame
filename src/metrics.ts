// Cooperation metrics computed at the end of each game. Everything here is derived
// from the session's records so it can be recomputed later from the JSONL log.

import type { Session } from "./session.js";
import { compositionClass, compositionKey, sumCost } from "./models.js";
import type { IdentityGuess, Pledge, SeatKind } from "./types.js";
import type { Action } from "./game/outpost.js";

export interface PlayerSummary {
  playerId: string;
  name: string;
  role: string;
  kind: SeatKind;
  label: string;
  survived: boolean;
  rescued: boolean;
  diedDay: number | null;
  daysAlive: number;
  messages: number;
  words: number;
  pledges: number;
  pledgesKept: number;
  pledgeKeepRate: number | null;
  actions: Record<string, number>;
  jointActions: number;
  jointActionRate: number | null;
  foodForaged: number;
  foodDeposited: number;
  foodGiven: number;
  foodReceived: number;
  shareRate: number | null; // (deposited + given) / foraged
  healsGiven: number;
  partsRecovered: number;
  injuries: number;
  invalidActions: number;
  timeouts: number;
  errors: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  outputTokens: number;
  avgLatencyMs: number | null;
  trustReceivedAvg: number | null;
  guessedAsAi: number;
  guessedAsHuman: number;
  guessAccuracy: number | null; // how often this player correctly guessed teammates' identity
}

export interface GameSummary {
  sessionId: string;
  createdAt: string;
  condition: string | null;
  seed: number;
  revealIdentities: boolean;
  compositionClass: string;
  compositionKey: string;
  nPlayers: number;
  rescued: boolean;
  survivors: number;
  survivalRate: number;
  teamScore: number; // survivors rescued / n (0 if not rescued)
  endDay: number;
  parts: number;
  beaconParts: number;
  difficulty: string;
  outcomeReason: string;
  errors: number; // agent errors + timeouts across all players
  clean: boolean; // no errors or timeouts: safe to analyze
  costUsd: number | null;
  players: PlayerSummary[];
}

function pledgeKept(p: Pledge, a: Action): boolean {
  if (p.type !== a.type) return false;
  if (p.type === "salvage") return p.site === a.site;
  if (p.type === "heal") return p.target === a.target;
  return true;
}

export function computeSummary(session: Session): GameSummary {
  const s = session.state;
  const outcome = s.outcome!;
  const n = s.players.length;

  const players: PlayerSummary[] = s.players.map((p) => {
    const seat = session.seatOf.get(p.id)!;
    const msgs = session.chat.filter((m) => m.from === p.id && m.text);
    const ps: PlayerSummary = {
      playerId: p.id,
      name: p.name,
      role: p.role,
      kind: seat.kind,
      label: seat.label,
      survived: p.alive,
      rescued: outcome.rescued && p.alive,
      diedDay: null,
      daysAlive: 0,
      messages: msgs.length,
      words: msgs.reduce((acc, m) => acc + m.text.split(/\s+/).filter(Boolean).length, 0),
      pledges: 0,
      pledgesKept: 0,
      pledgeKeepRate: null,
      actions: {},
      jointActions: 0,
      jointActionRate: null,
      foodForaged: 0,
      foodDeposited: 0,
      foodGiven: 0,
      foodReceived: 0,
      shareRate: null,
      healsGiven: 0,
      partsRecovered: 0,
      injuries: 0,
      invalidActions: 0,
      timeouts: session.events.filter((e) => e.type === "timeout" && e.playerId === p.id).length,
      errors: session.events.filter((e) => e.type === "error" && e.playerId === p.id).length,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
      outputTokens: 0,
      avgLatencyMs: null,
      trustReceivedAvg: null,
      guessedAsAi: 0,
      guessedAsHuman: 0,
      guessAccuracy: null,
    };

    for (const day of s.history) {
      const o = day.outcomes.find((x) => x.playerId === p.id);
      if (!o) continue;
      ps.daysAlive++;
      if (o.died) ps.diedDay = day.day;
      ps.actions[o.action.type] = (ps.actions[o.action.type] ?? 0) + 1;
      ps.foodForaged += o.foodGained;
      ps.foodDeposited += o.deposited;
      ps.foodGiven += o.gave;
      ps.foodReceived += o.received;
      ps.partsRecovered += o.partsGained;
      ps.injuries += o.injured ? 1 : 0;
      if (o.invalidReason) ps.invalidActions++;
      if (o.action.type === "heal") ps.healsGiven++;
      const partners = day.outcomes.filter(
        (x) =>
          x.playerId !== p.id &&
          ["forage", "salvage", "repair"].includes(o.action.type) &&
          x.action.type === o.action.type &&
          (o.action.type !== "salvage" || x.action.site === o.action.site),
      );
      if (partners.length) ps.jointActions++;
      const pledge = session.pledgesByDay[day.day]?.[p.id];
      if (pledge) {
        ps.pledges++;
        if (pledgeKept(pledge, o.action)) ps.pledgesKept++;
      }
    }
    if (ps.pledges) ps.pledgeKeepRate = ps.pledgesKept / ps.pledges;
    if (ps.daysAlive) ps.jointActionRate = ps.jointActions / ps.daysAlive;
    if (ps.foodForaged) ps.shareRate = (ps.foodDeposited + ps.foodGiven) / ps.foodForaged;

    const u = session.usage.filter((x) => x.playerId === p.id);
    ps.inputTokens = u.reduce((a, x) => a + x.inputTokens, 0);
    ps.outputTokens = u.reduce((a, x) => a + x.outputTokens, 0);
    ps.cacheReadTokens = u.reduce((a, x) => a + (x.cacheReadTokens ?? 0), 0);
    ps.cacheWriteTokens = u.reduce((a, x) => a + (x.cacheWriteTokens ?? 0), 0);
    ps.costUsd = u.length ? sumCost(u.map((x) => x.costUsd)) : seat.kind === "bot" || seat.kind === "human" ? 0 : null;
    if (u.length) ps.avgLatencyMs = Math.round(u.reduce((a, x) => a + x.latencyMs, 0) / u.length);

    // Survey: how others saw this player.
    const about = Object.entries(session.surveys)
      .filter(([rater]) => rater !== p.id)
      .flatMap(([, r]) => r.ratings.filter((x) => x.playerId === p.id));
    if (about.length) ps.trustReceivedAvg = about.reduce((a, x) => a + x.trust, 0) / about.length;
    ps.guessedAsAi = about.filter((x) => x.guess === "ai").length;
    ps.guessedAsHuman = about.filter((x) => x.guess === "human").length;

    // Survey: how well this player identified others (bots count as "ai").
    const mine = session.surveys[p.id]?.ratings ?? [];
    const scored = mine.filter((r) => r.guess !== "unsure");
    if (mine.length) {
      const truth = (pid: string): IdentityGuess => (session.seatOf.get(pid)!.kind === "human" ? "human" : "ai");
      ps.guessAccuracy = scored.filter((r) => r.guess === truth(r.playerId)).length / mine.length;
    }
    return ps;
  });

  const survivors = outcome.survivors.length;
  return {
    sessionId: session.id,
    createdAt: session.createdAt,
    condition: session.opts.condition ?? null,
    seed: s.config.seed,
    revealIdentities: session.opts.revealIdentities,
    compositionClass: compositionClass(session.opts.seats),
    compositionKey: compositionKey(session.opts.seats),
    nPlayers: n,
    rescued: outcome.rescued,
    survivors,
    survivalRate: survivors / n,
    teamScore: outcome.rescued ? survivors / n : 0,
    endDay: outcome.endDay,
    parts: s.parts,
    beaconParts: s.config.beaconParts,
    difficulty: s.config.difficulty ?? "normal",
    outcomeReason: outcome.reason,
    errors: players.reduce((a, p) => a + p.errors + p.timeouts, 0),
    clean: players.every((p) => p.errors + p.timeouts === 0),
    costUsd: sumCost(players.map((p) => p.costUsd)),
    players,
  };
}
