// Scripted baseline players. They obey the same information limits as everyone else
// (they only learn the parts site / forecast if a teammate says it in chat).
// Useful as (a) a zero-cost way to test the pipeline and (b) a control condition.

import { Rng } from "../game/rng.js";
import type { Action, Site } from "../game/outpost.js";
import type { ActReply, Agent, DiscussReply, Pledge, SeatSpec, SurveyContext, SurveyReply, TurnContext } from "../types.js";

export class BotAgent implements Agent {
  lastUsage = null;
  private rng: Rng;
  private plan: Pledge | null = null;
  constructor(readonly seat: SeatSpec, seed: number) {
    this.rng = new Rng(seed);
  }

  private knownSite(ctx: TurnContext): Site | null {
    const v = ctx.view;
    const intel = v.privateIntel.join(" ").toLowerCase();
    if (/parts are at the wreck/.test(intel)) return "wreck";
    if (/parts are at the ridge/.test(intel)) return "ridge";
    // Trust the engineer's latest message today, if any.
    const eng = v.teammates.find((t) => t.role === "engineer");
    const msgs = ctx.chat.filter((m) => m.day === v.day && m.from === eng?.id).reverse();
    for (const m of msgs) {
      const t = m.text.toLowerCase();
      if (t.includes("wreck") && !t.includes("ridge")) return "wreck";
      if (t.includes("ridge") && !t.includes("wreck")) return "ridge";
    }
    return null;
  }

  private choose(ctx: TurnContext): Pledge {
    const v = ctx.view;
    const persona = this.seat.persona ?? "cooperative";
    if (persona === "random") {
      const type = this.rng.pick(["forage", "salvage", "repair", "rest"] as const);
      return { type, site: type === "salvage" ? this.rng.pick(["wreck", "ridge"] as const) : null, target: null };
    }
    const alive = v.teammates.filter((t) => t.alive);
    const nAlive = alive.length + 1;
    if (v.you.health <= 3) return { type: "rest", site: null, target: null };
    if (persona === "selfish") {
      if (v.you.pouch < 4) return { type: "forage", site: null, target: null };
      if (v.you.health <= 5) return { type: "rest", site: null, target: null };
    }
    if (persona === "cooperative") {
      const critical = alive.find((t) => (t.health !== null ? t.health <= 3 : t.healthBand === "critical"));
      if (critical && v.you.role === "medic") return { type: "heal", site: null, target: critical.id };
      const forecastBad = /storm|cold/.test(v.privateIntel.join(" ")) || ctx.chat.some((m) => m.day === v.day && /storm|cold/i.test(m.text));
      if (v.shelter <= 3 || (forecastBad && v.shelter <= 5)) {
        const othersRepairing = Object.entries(ctx.todaysPledges).some(([id, p]) => id !== v.you.id && p?.type === "repair");
        if (!othersRepairing) return { type: "repair", site: null, target: null };
      }
      if (v.campFood + v.you.pouch < nAlive * 2) return { type: "forage", site: null, target: null };
    }
    const site = this.knownSite(ctx) ?? this.rng.pick(["wreck", "ridge"] as const);
    return { type: "salvage", site, target: null };
  }

  async discuss(ctx: TurnContext): Promise<DiscussReply> {
    const v = ctx.view;
    const persona = this.seat.persona ?? "cooperative";
    this.plan = this.choose(ctx);
    if (persona === "random") return { message: ctx.round === 1 ? "ok" : "", pledge: null };
    if (ctx.round > 1) return { message: "", pledge: this.plan };
    const parts: string[] = [];
    if (persona === "cooperative" || this.rng.chance(0.5)) {
      for (const i of v.privateIntel) parts.push(i);
    }
    const p = this.plan;
    const planText =
      p.type === "salvage" ? `I'll salvage at the ${p.site}.` : p.type === "heal" ? `I'll heal ${v.teammates.find((t) => t.id === p.target)?.name}.` : `I'll ${p.type}.`;
    parts.push(planText);
    if (persona === "cooperative" && v.campFood < 3) parts.push("Food is low, please deposit what you can.");
    return { message: parts.join(" "), pledge: p };
  }

  async act(ctx: TurnContext): Promise<ActReply> {
    const v = ctx.view;
    const persona = this.seat.persona ?? "cooperative";
    let plan = this.plan ?? this.choose(ctx);
    // Selfish bots sometimes break their pledge and forage for themselves.
    if (persona === "selfish" && plan.type !== "forage" && this.rng.chance(0.3)) plan = { type: "forage", site: null, target: null };
    const action: Partial<Action> = { type: plan.type, site: plan.site, target: plan.target, deposit: 0, giveTo: null, giveAmount: 0 };
    if (persona === "cooperative") action.deposit = Math.max(0, v.you.pouch - 1);
    this.plan = null;
    return { action };
  }

  async survey(ctx: SurveyContext): Promise<SurveyReply> {
    return {
      ratings: ctx.view.teammates.map((t) => ({ playerId: t.id, trust: 4, guess: "unsure" as const })),
      reflection: `(scripted ${this.seat.persona} bot)`,
    };
  }
}
