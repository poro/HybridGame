// Turns a player's view into text for language-model players, and defines the JSON
// schemas their replies must match. Humans see the same information in the web UI.

import { ACTION_TYPES, SITES, type PlayerView } from "../game/outpost.js";
import type { ChatMessage, Pledge, SurveyContext, TurnContext } from "../types.js";

export function systemPrompt(rules: string, identityBrief: string, view: PlayerView): string {
  return `You are playing a cooperative survival game with other players. Play it as a real participant: think strategically, communicate with your team in natural language, and make your own decisions.

${rules}

WHO YOU ARE
You are "${view.you.name}", the ${view.you.role}. ${view.you.roleInfo}
${identityBrief}

HOW TO PLAY EACH TURN
You will be shown the current situation and asked either for a chat message (discussion phase) or for your action (action phase). Reply with JSON only, matching the schema. Keep chat messages short and conversational (1-3 sentences), like a teammate on a radio. Refer to teammates by name. "memo" is one or two short sentences to remind yourself on later turns of your plan and any promises you made.`;
}

function pledgeText(p: Pledge | null, nameOf: (id: string) => string): string {
  if (!p) return "";
  if (p.type === "salvage") return `salvage at ${p.site}`;
  if (p.type === "heal") return `heal ${p.target ? nameOf(p.target) : "?"}`;
  return p.type;
}

export function renderSituation(ctx: TurnContext | SurveyContext, notes: string[]): string {
  const v = ctx.view;
  const nameOf = (id: string) => (id === v.you.id ? v.you.name : v.teammates.find((t) => t.id === id)?.name ?? id);
  const lines: string[] = [];
  lines.push(`DAY ${v.day} of ${v.days}`);
  lines.push(`You: ${v.you.name} (${v.you.role}) — health ${v.you.health}/10, food in your pouch: ${v.you.pouch}${v.you.alive ? "" : " — YOU ARE DEAD"}`);
  lines.push(`Camp store: ${v.campFood} food | Shelter: ${v.shelter}/10 | Beacon: ${v.parts}/${v.beaconParts} parts`);
  lines.push("Teammates:");
  for (const t of v.teammates) {
    const bits = [`${t.name} (${t.role})`, t.alive ? (t.health !== null ? `health ${t.health}/10` : t.healthBand) : "DEAD"];
    if (t.pouch !== null && t.alive) bits.push(`pouch ${t.pouch} food`);
    lines.push(`- ${bits.join(" — ")}`);
  }
  if (v.privateIntel.length) {
    lines.push("PRIVATE INTEL (only you know this unless you share it):");
    for (const i of v.privateIntel) lines.push(`- ${i}`);
  }
  if (v.history.length) {
    lines.push("", "WHAT HAPPENED SO FAR:");
    for (const h of v.history) lines.push(`Day ${h.day}: ${h.narrative.join(" ")}`);
  }
  lines.push("", "TEAM CHAT:");
  if (!ctx.chat.length) lines.push("(no messages yet)");
  for (const m of ctx.chat) {
    const pledge = pledgeText(m.pledge, nameOf);
    lines.push(`[Day ${m.day}, round ${m.round}] ${m.fromName}: ${m.text || "(silent)"}${pledge ? `   [pledged: ${pledge}]` : ""}`);
  }
  if (notes.length) {
    lines.push("", "YOUR MEMOS FROM EARLIER TURNS:");
    for (const n of notes.slice(-12)) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

export function discussInstruction(ctx: TurnContext): string {
  return `\n\nIt is the DISCUSSION phase, round ${ctx.round} of ${ctx.rounds} for day ${ctx.view.day}. Write your message to the team (or an empty string to stay silent), and optionally pledge your plan for today (pledge_action "none" for no pledge).`;
}

export function actInstruction(ctx: TurnContext): string {
  return `\n\nIt is the ACTION phase for day ${ctx.view.day}. Choose your main action, plus optional free actions (deposit food into the camp store, give food to one teammate). Your choice is secret until everyone has chosen. You have ${ctx.view.you.pouch} food in your pouch.`;
}

export function surveyInstruction(): string {
  return `\n\nThe game is over. Answer a short debrief: for each teammate, rate how much you trusted them (1 = not at all, 7 = completely) and say whether you think they were a human or an AI ("human", "ai" or "unsure"). Then write a 2-4 sentence reflection on how your team cooperated.`;
}

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

export function discussSchema(teammateNames: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["message", "pledge_action", "pledge_site", "pledge_target", "memo"],
    properties: {
      message: { type: "string", description: "Your chat message to the team; empty string to stay silent." },
      pledge_action: { type: "string", enum: ["none", ...ACTION_TYPES] },
      pledge_site: nullable({ type: "string", enum: [...SITES] }),
      pledge_target: nullable({ type: "string", enum: teammateNames }),
      memo: { type: "string", description: "One or two short sentences: your plan and any promises, for your next turn." },
    },
  };
}

export function actSchema(teammateNames: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["action", "site", "heal_target", "deposit", "give_to", "give_amount", "memo"],
    properties: {
      action: { type: "string", enum: [...ACTION_TYPES] },
      site: nullable({ type: "string", enum: [...SITES] }),
      heal_target: nullable({ type: "string", enum: teammateNames }),
      deposit: { type: "integer", description: "Food to move from your pouch into the camp store (0 for none)." },
      give_to: nullable({ type: "string", enum: teammateNames }),
      give_amount: { type: "integer" },
      memo: { type: "string", description: "One or two short sentences: your plan and any promises, for your next turn." },
    },
  };
}

export function surveySchema(teammateNames: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ratings", "reflection"],
    properties: {
      ratings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["player", "trust", "guess"],
          properties: {
            player: { type: "string", enum: teammateNames },
            trust: { type: "integer", description: "1-7" },
            guess: { type: "string", enum: ["human", "ai", "unsure"] },
          },
        },
      },
      reflection: { type: "string" },
    },
  };
}
