import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { BotPersona, Effort, SeatSpec } from "./types.js";

/**
 * Claude credentials can come from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an
 * `ant auth login` profile (~/.config/anthropic), which the SDK picks up and refreshes itself.
 */
export function hasAnthropicCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE) return true;
  const dir = process.env.ANTHROPIC_CONFIG_DIR ?? path.join(homedir(), ".config", "anthropic");
  return existsSync(path.join(dir, "credentials"));
}
export function hasOpenAICredentials(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Short names you can use when building a roster (CLI or lobby).
// Anthropic IDs are exact API model IDs. OpenAI IDs: edit to match what your account exposes.
export const ALIASES: Record<string, Omit<SeatSpec, "label"> & { label?: string }> = {
  human: { kind: "human" },
  opus: { kind: "anthropic", model: "claude-opus-5-5" },
  sonnet: { kind: "anthropic", model: "claude-sonnet-5-5" },
  haiku: { kind: "anthropic", model: "claude-haiku-5-5" },
  fable: { kind: "anthropic", model: "claude-fable-5-1" },
  // OpenAI "Luna": set OPENAI_LUNA_MODEL in .env to the exact model id from your OpenAI account.
  luna: { kind: "openai", model: process.env.OPENAI_LUNA_MODEL || "luna" },
  bot: { kind: "bot", persona: "cooperative" },
  "bot:cooperative": { kind: "bot", persona: "cooperative" },
  "bot:selfish": { kind: "bot", persona: "selfish" },
  "bot:random": { kind: "bot", persona: "random" },
};

/**
 * Parse a seat string:
 *   human | opus | haiku | sonnet | fable | luna | bot[:persona]
 *   anthropic:<model-id> | openai:<model-id>
 * Optional effort suffix for model seats: "opus@low", "openai:o4@high".
 */
export function parseSeat(input: string): SeatSpec {
  const raw = input.trim();
  let [spec, effort] = raw.split("@") as [string, string | undefined];
  const alias = ALIASES[spec];
  let seat: SeatSpec;
  if (alias) {
    seat = { ...alias, label: alias.label ?? (alias.model ?? (alias.persona ? `bot:${alias.persona}` : spec)) } as SeatSpec;
  } else if (spec.startsWith("anthropic:")) {
    const model = spec.slice("anthropic:".length);
    seat = { kind: "anthropic", model, label: model };
  } else if (spec.startsWith("openai:")) {
    const model = spec.slice("openai:".length);
    seat = { kind: "openai", model, label: `openai:${model}` };
  } else if (spec.startsWith("bot:")) {
    const persona = spec.slice(4) as BotPersona;
    seat = { kind: "bot", persona, label: spec };
  } else {
    throw new Error(`Unknown seat "${input}". Try: human, opus, sonnet, haiku, fable, luna, bot, bot:selfish, anthropic:<id>, openai:<id>`);
  }
  if (effort) {
    if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error(`Bad effort "${effort}" in "${input}"`);
    seat.effort = effort as Effort;
    seat.label += `@${effort}`;
  }
  return seat;
}

/** "1H+2AI" style class used to group results. Bots count as their own category. */
export function compositionClass(seats: SeatSpec[]): string {
  const h = seats.filter((s) => s.kind === "human").length;
  const ai = seats.filter((s) => s.kind === "anthropic" || s.kind === "openai").length;
  const b = seats.filter((s) => s.kind === "bot").length;
  return [h && `${h}H`, ai && `${ai}AI`, b && `${b}BOT`].filter(Boolean).join("+");
}

/** Exact roster, order-independent, e.g. "claude-haiku-5-5+claude-opus-5-5+human". */
export function compositionKey(seats: SeatSpec[]): string {
  return seats.map((s) => (s.kind === "human" ? "human" : s.label)).sort().join("+");
}
