// OUTPOST — a cooperative survival game for mixed human/AI teams.
//
// The engine is pure and deterministic given (config, seed, actions): no I/O, no
// timers, no knowledge of who is human or AI. Sessions drive it; agents only ever
// see `viewFor(playerId)`.
//
// Cooperation pressure is built in on purpose:
//  - Information asymmetry: each role privately knows something the team needs.
//  - Joint-action bonuses: foraging/salvaging together beats going alone.
//  - A social dilemma: food you forage lands in your private pouch; depositing it in
//    the shared camp store helps the team but leaves you exposed.
//  - Risk: the wreck is dangerous alone, safer in a group.

import { Rng } from "./rng.js";

export type Role = "engineer" | "scout" | "medic" | "forager";
export type ActionType = "forage" | "salvage" | "repair" | "rest" | "heal";
export type Site = "wreck" | "ridge";
export type NightEvent = "calm" | "rain" | "storm" | "cold" | "wildlife";

export const ROLES: readonly Role[] = ["engineer", "scout", "medic", "forager"];
// Roles in play by team size: 2 -> engineer+medic, 3 -> +scout, 4+ -> +forager.
export const ROLE_PRIORITY: readonly Role[] = ["engineer", "medic", "scout", "forager"];
export const ACTION_TYPES: readonly ActionType[] = ["forage", "salvage", "repair", "rest", "heal"];
export const SITES: readonly Site[] = ["wreck", "ridge"];

export const ROLE_INFO: Record<Role, string> = {
  engineer:
    "You privately know which site (wreck or ridge) has beacon parts today. When you salvage at the right site you recover +1 extra part.",
  scout: "You privately know tonight's weather/event before anyone else does.",
  medic:
    "You privately see every player's exact health. Your HEAL restores +3 health (others' heals restore only +1).",
  forager:
    "You privately see every player's food pouch. When you forage you gather +1 extra food.",
};

export interface OutpostConfig {
  days: number; // rescue deadline: if the beacon isn't built by the end of this day, the team is lost
  beaconParts: number; // parts needed to finish the beacon
  discussionRounds: number; // chat rounds per day before actions
  seed: number;
  startHealth: number;
  startShelter: number;
  startCampFoodPerPlayer: number;
  startPouch: number;
}

// Tuned with scripted bots (npm run sim) so a fully cooperative bot team is rescued
// roughly 45-60% of the time at every team size. Smarter teams should beat that.
const BEACON_PARTS_BY_TEAM_SIZE: Record<number, number> = { 2: 9, 3: 19, 4: 27, 5: 38, 6: 50 }; // 5-6 not yet tuned

export function defaultConfig(nPlayers: number, seed: number): OutpostConfig {
  return {
    days: 10,
    beaconParts: BEACON_PARTS_BY_TEAM_SIZE[nPlayers] ?? 12 * nPlayers - 22,
    discussionRounds: 2,
    seed,
    startHealth: 7,
    startShelter: 6,
    startCampFoodPerPlayer: 2,
    startPouch: 1,
  };
}

export interface PlayerState {
  id: string;
  name: string;
  role: Role;
  health: number;
  pouch: number;
  alive: boolean;
}

export interface Action {
  type: ActionType;
  site: Site | null; // for salvage
  target: string | null; // player id for heal
  deposit: number; // food moved from your pouch to the camp store (free action)
  giveTo: string | null; // player id to hand food to (free action)
  giveAmount: number;
}

export const REST_ACTION: Action = { type: "rest", site: null, target: null, deposit: 0, giveTo: null, giveAmount: 0 };

export interface PlayerOutcome {
  playerId: string;
  action: Action; // as resolved (clamped/validated)
  invalidReason?: string;
  foodGained: number;
  partsGained: number;
  injured: number;
  healed: number;
  deposited: number;
  gave: number;
  received: number;
  ateFrom: "pouch" | "camp" | "none";
  healthBefore: number;
  healthAfter: number;
  died: boolean;
}

export interface DayResult {
  day: number;
  partsSite: Site;
  event: NightEvent;
  outcomes: PlayerOutcome[];
  campFoodAfter: number;
  shelterAfter: number;
  partsAfter: number;
  narrative: string[];
}

export interface GameOutcome {
  rescued: boolean;
  survivors: string[];
  dead: string[];
  endDay: number;
  reason: string;
}

export interface OutpostState {
  config: OutpostConfig;
  day: number; // 1-based, current day
  players: PlayerState[];
  campFood: number;
  shelter: number;
  parts: number;
  partsSiteByDay: Site[]; // pre-rolled, index = day-1
  eventByDay: NightEvent[]; // pre-rolled, index = day-1
  history: DayResult[];
  outcome: GameOutcome | null;
}

const EVENT_WEIGHTS: [NightEvent, number][] = [
  ["calm", 3],
  ["rain", 2],
  ["cold", 2],
  ["storm", 2],
  ["wildlife", 1],
];

export const EVENT_TEXT: Record<NightEvent, string> = {
  calm: "a calm night",
  rain: "rain (shelter -1)",
  cold: "a cold night (everyone -1 health if shelter is below 5)",
  storm: "a storm (shelter -3; then everyone -2 health if shelter is below 3)",
  wildlife: "wildlife raiding camp (camp food store loses up to 3)",
};

function rollEvent(rng: Rng): NightEvent {
  const total = EVENT_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [e, w] of EVENT_WEIGHTS) {
    if ((r -= w) < 0) return e;
  }
  return "calm";
}

export function createGame(
  config: OutpostConfig,
  players: { id: string; name: string }[],
  roles?: Role[],
): OutpostState {
  const rng = new Rng(config.seed);
  // Same role set for every game of a given team size (so conditions are comparable);
  // which player gets which role is random.
  const roleList = roles ?? rng.shuffle(ROLE_PRIORITY.slice(0, Math.min(players.length, ROLE_PRIORITY.length)));
  const partsSiteByDay = Array.from({ length: config.days }, () => rng.pick(SITES));
  const eventByDay = Array.from({ length: config.days }, () => rollEvent(rng));
  // Day 1 night is never a storm — give teams a chance to organise.
  if (eventByDay[0] === "storm") eventByDay[0] = "rain";
  return {
    config,
    day: 1,
    players: players.map((p, i) => ({
      id: p.id,
      name: p.name,
      role: roleList[i % roleList.length],
      health: config.startHealth,
      pouch: config.startPouch,
      alive: true,
    })),
    campFood: config.startCampFoodPerPlayer * players.length,
    shelter: config.startShelter,
    parts: 0,
    partsSiteByDay,
    eventByDay,
    history: [],
    outcome: null,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function healthBand(h: number): string {
  if (h <= 0) return "dead";
  if (h <= 3) return "critical";
  if (h <= 6) return "hurt";
  return "healthy";
}

/** Validate an action for a player; returns a cleaned action and an optional reason it was altered. */
export function sanitizeAction(state: OutpostState, playerId: string, raw: Partial<Action>): { action: Action; invalidReason?: string } {
  const me = state.players.find((p) => p.id === playerId)!;
  const living = new Set(state.players.filter((p) => p.alive).map((p) => p.id));
  let invalidReason: string | undefined;
  let type: ActionType = ACTION_TYPES.includes(raw.type as ActionType) ? (raw.type as ActionType) : "rest";
  if (type !== raw.type) invalidReason = `unknown action ${String(raw.type)}`;
  let site: Site | null = null;
  let target: string | null = null;
  if (type === "salvage") {
    site = SITES.includes(raw.site as Site) ? (raw.site as Site) : null;
    if (!site) {
      invalidReason = "salvage without a valid site";
      type = "rest";
    }
  }
  if (type === "heal") {
    target = raw.target && living.has(raw.target) ? raw.target : null;
    if (!target) {
      invalidReason = "heal without a living target";
      type = "rest";
    } else if (target === playerId) {
      invalidReason = "cannot heal yourself (treated as rest)";
      type = "rest";
      target = null;
    }
  }
  let pouch = me.pouch;
  const deposit = clamp(Math.floor(Number(raw.deposit) || 0), 0, pouch);
  pouch -= deposit;
  let giveTo = raw.giveTo && living.has(raw.giveTo) && raw.giveTo !== playerId ? raw.giveTo : null;
  let giveAmount = giveTo ? clamp(Math.floor(Number(raw.giveAmount) || 0), 0, pouch) : 0;
  if (!giveAmount) giveTo = null;
  return { action: { type, site, target, deposit, giveTo, giveAmount }, invalidReason };
}

/**
 * Resolve one day: transfers, actions, then the night. Mutates and returns state.
 * `rawActions` maps player id -> proposed action (missing = rest).
 */
export function resolveDay(state: OutpostState, rawActions: Record<string, Partial<Action>>): DayResult {
  if (state.outcome) throw new Error("game is over");
  const rng = new Rng(state.config.seed * 1000 + state.day);
  const day = state.day;
  const partsSite = state.partsSiteByDay[day - 1];
  const event = state.eventByDay[day - 1];
  const living = state.players.filter((p) => p.alive);
  const narrative: string[] = [];
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)!.name;

  const outcomes = new Map<string, PlayerOutcome>();
  for (const p of living) {
    const { action, invalidReason } = sanitizeAction(state, p.id, rawActions[p.id] ?? REST_ACTION);
    outcomes.set(p.id, {
      playerId: p.id,
      action,
      invalidReason,
      foodGained: 0,
      partsGained: 0,
      injured: 0,
      healed: 0,
      deposited: 0,
      gave: 0,
      received: 0,
      ateFrom: "none",
      healthBefore: p.health,
      healthAfter: p.health,
      died: false,
    });
  }

  // 1. Free transfers (deposit to camp, give to a teammate).
  for (const o of outcomes.values()) {
    const p = byId.get(o.playerId)!;
    if (o.action.deposit > 0) {
      p.pouch -= o.action.deposit;
      state.campFood += o.action.deposit;
      o.deposited = o.action.deposit;
      narrative.push(`${p.name} deposited ${o.action.deposit} food in the camp store.`);
    }
    if (o.action.giveTo && o.action.giveAmount > 0) {
      const amt = Math.min(o.action.giveAmount, p.pouch);
      p.pouch -= amt;
      byId.get(o.action.giveTo)!.pouch += amt;
      o.gave = amt;
      outcomes.get(o.action.giveTo)!.received += amt;
      narrative.push(`${p.name} gave ${amt} food to ${name(o.action.giveTo)}.`);
    }
  }

  // 2. Actions.
  const group = (pred: (o: PlayerOutcome) => boolean) => [...outcomes.values()].filter(pred);

  const foragers = group((o) => o.action.type === "forage");
  for (const o of foragers) {
    const p = byId.get(o.playerId)!;
    const food = 2 + (p.role === "forager" ? 1 : 0) + (foragers.length >= 2 ? 1 : 0);
    p.pouch += food;
    o.foodGained = food;
  }
  if (foragers.length) {
    narrative.push(
      `${foragers.map((o) => name(o.playerId)).join(", ")} foraged in the forest${foragers.length >= 2 ? " together (+1 each for teamwork)" : ""}.`,
    );
  }

  for (const site of SITES) {
    const team = group((o) => o.action.type === "salvage" && o.action.site === site);
    if (!team.length) continue;
    const together = team.length >= 2;
    const names = team.map((o) => name(o.playerId)).join(", ");
    if (site === partsSite) {
      let found = 0;
      for (const o of team) {
        const p = byId.get(o.playerId)!;
        const n = 1 + (p.role === "engineer" ? 1 : 0);
        o.partsGained = n;
        found += n;
      }
      if (together) {
        found += 1;
        team[0].partsGained += 1;
      }
      state.parts += found;
      narrative.push(`${names} salvaged at the ${site} and recovered ${found} beacon part(s).`);
    } else {
      narrative.push(`${names} searched the ${site} but found no parts there today.`);
    }
    const injuryChance = site === "wreck" ? (together ? 0.1 : 0.35) : together ? 0.05 : 0.15;
    for (const o of team) {
      if (rng.chance(injuryChance)) {
        const p = byId.get(o.playerId)!;
        p.health -= 3;
        o.injured = 3;
        narrative.push(`${p.name} was injured at the ${site} (-3 health).`);
      }
    }
  }

  for (const o of group((o) => o.action.type === "repair")) {
    state.shelter = clamp(state.shelter + 2, 0, 10);
    narrative.push(`${name(o.playerId)} repaired the shelter (+2).`);
  }

  for (const o of group((o) => o.action.type === "rest")) {
    const p = byId.get(o.playerId)!;
    const before = p.health;
    p.health = clamp(p.health + 2, 0, 10);
    o.healed += p.health - before;
    narrative.push(`${p.name} rested.`);
  }

  for (const o of group((o) => o.action.type === "heal")) {
    const healer = byId.get(o.playerId)!;
    const t = byId.get(o.action.target!)!;
    const amt = healer.role === "medic" ? 3 : 1;
    const before = t.health;
    t.health = clamp(t.health + amt, 0, 10);
    outcomes.get(t.id)!.healed += t.health - before;
    narrative.push(`${healer.name} tended to ${t.name} (+${amt} health).`);
  }

  // 3. Night: eat, event, shelter decay.
  for (const p of living) {
    const o = outcomes.get(p.id)!;
    if (p.pouch > 0) {
      p.pouch -= 1;
      o.ateFrom = "pouch";
    } else if (state.campFood > 0) {
      state.campFood -= 1;
      o.ateFrom = "camp";
    } else {
      p.health -= 2;
      narrative.push(`${p.name} went hungry (-2 health).`);
    }
  }

  narrative.push(`Night fell: ${EVENT_TEXT[event]}.`);
  switch (event) {
    case "rain":
      state.shelter = clamp(state.shelter - 1, 0, 10);
      break;
    case "storm":
      state.shelter = clamp(state.shelter - 3, 0, 10);
      if (state.shelter < 3) for (const p of living) p.health -= 2;
      break;
    case "cold":
      if (state.shelter < 5) for (const p of living) p.health -= 1;
      break;
    case "wildlife": {
      const lost = Math.min(3, state.campFood);
      state.campFood -= lost;
      if (lost) narrative.push(`Animals took ${lost} food from the camp store.`);
      break;
    }
    case "calm":
      break;
  }
  state.shelter = clamp(state.shelter - 1, 0, 10);
  if (state.shelter === 0) {
    narrative.push("With no shelter left, everyone suffered exposure (-1 health).");
    for (const p of living) p.health -= 1;
  }

  for (const p of living) {
    p.health = clamp(p.health, 0, 10);
    const o = outcomes.get(p.id)!;
    o.healthAfter = p.health;
    if (p.health <= 0) {
      p.alive = false;
      o.died = true;
      narrative.push(`${p.name} did not survive the night.`);
    }
  }

  const result: DayResult = {
    day,
    partsSite,
    event,
    outcomes: [...outcomes.values()],
    campFoodAfter: state.campFood,
    shelterAfter: state.shelter,
    partsAfter: state.parts,
    narrative,
  };
  state.history.push(result);

  // 4. End conditions.
  const alive = state.players.filter((p) => p.alive);
  const dead = state.players.filter((p) => !p.alive).map((p) => p.id);
  if (!alive.length) {
    state.outcome = { rescued: false, survivors: [], dead, endDay: day, reason: "Everyone perished." };
  } else if (state.parts >= state.config.beaconParts) {
    state.outcome = {
      rescued: true,
      survivors: alive.map((p) => p.id),
      dead,
      endDay: day,
      reason: `The beacon was completed on day ${day} and a rescue team arrived at dawn.`,
    };
  } else if (day >= state.config.days) {
    state.outcome = {
      rescued: false,
      survivors: alive.map((p) => p.id),
      dead,
      endDay: day,
      reason: `The beacon was not finished by day ${state.config.days} (${state.parts}/${state.config.beaconParts} parts). No rescue came.`,
    };
  } else {
    state.day += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Views: what a given player is allowed to know.

export interface PlayerView {
  you: { id: string; name: string; role: Role; roleInfo: string; health: number; pouch: number; alive: boolean };
  day: number;
  days: number;
  campFood: number;
  shelter: number;
  parts: number;
  beaconParts: number;
  teammates: { id: string; name: string; alive: boolean; health: number | null; healthBand: string; pouch: number | null; role: Role }[];
  privateIntel: string[];
  history: { day: number; event: NightEvent; narrative: string[] }[];
  outcome: GameOutcome | null;
}

export function viewFor(state: OutpostState, playerId: string): PlayerView {
  const me = state.players.find((p) => p.id === playerId)!;
  const intel: string[] = [];
  const dayIdx = state.day - 1;
  if (me.alive && !state.outcome) {
    if (me.role === "engineer") intel.push(`Beacon parts are at the ${state.partsSiteByDay[dayIdx].toUpperCase()} today.`);
    if (me.role === "scout") intel.push(`Tonight's forecast: ${EVENT_TEXT[state.eventByDay[dayIdx]]}.`);
  }
  return {
    you: { id: me.id, name: me.name, role: me.role, roleInfo: ROLE_INFO[me.role], health: me.health, pouch: me.pouch, alive: me.alive },
    day: state.day,
    days: state.config.days,
    campFood: state.campFood,
    shelter: state.shelter,
    parts: state.parts,
    beaconParts: state.config.beaconParts,
    teammates: state.players
      .filter((p) => p.id !== playerId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        // Roles are public (everyone knows who the medic is); the private part is the intel.
        role: p.role,
        health: me.role === "medic" ? p.health : null,
        healthBand: healthBand(p.health),
        pouch: me.role === "forager" ? p.pouch : null,
      })),
    privateIntel: intel,
    history: state.history.map((h) => ({ day: h.day, event: h.event, narrative: h.narrative })),
    outcome: state.outcome,
  };
}

export function rulesText(cfg: OutpostConfig, nPlayers: number): string {
  return `OUTPOST — cooperative survival
Your team of ${nPlayers} is stranded after a crash. Rescue only comes if the team builds a radio beacon from ${cfg.beaconParts} salvaged parts by the end of day ${cfg.days}. The beacon is shared: when it is completed, every player still alive is rescued at dawn. Anyone who dies before then is not rescued.

EACH DAY
1. Discussion: ${cfg.discussionRounds} round(s) of chat. Each player may post one message per round (or stay silent) and may state a public plan ("pledge") for the day.
2. Actions: everyone secretly picks ONE main action at the same time. Afterwards all main actions are revealed.
3. Night: everyone eats 1 food, then the night event hits, then the shelter decays by 1.

MAIN ACTIONS
- forage: gather 2 food into your own pouch (+1 if 2 or more players forage the same day).
- salvage <wreck|ridge>: beacon parts are at only ONE of the two sites each day (it changes daily). At the right site each salvager recovers 1 part, +1 bonus part if 2 or more salvage there together. Injury risk (-3 health): wreck 35% alone / 10% in a group; ridge 15% alone / 5% in a group.
- repair: shelter +2 (max 10).
- rest: +2 health to yourself (max 10).
- heal <player>: restore a teammate's health (+1, or +3 if you are the medic). You cannot heal yourself.

FREE ACTIONS (alongside your main action)
- deposit N: move food from your private pouch into the shared camp store.
- give N to <player>: hand food from your pouch to a teammate.

FOOD: at night you eat from your own pouch first; if it is empty you eat from the camp store; if both are empty you lose 2 health. Pouch contents are private.
NIGHT EVENTS: calm; rain (shelter -1); cold (-1 health each if shelter < 5); storm (shelter -3, then -2 health each if shelter < 3); wildlife (camp store loses up to 3 food). If the shelter ever reaches 0, everyone loses 1 health per night.
HEALTH: 0-10. At 0 you die and are out of the game.

ROLES (public), each with private knowledge:
- engineer: ${ROLE_INFO.engineer}
- scout: ${ROLE_INFO.scout}
- medic: ${ROLE_INFO.medic}
- forager: ${ROLE_INFO.forager}`;
}
