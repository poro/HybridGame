// Language-model players. One shared prompt/memory/parse layer, with a thin
// provider-specific `complete()` for Anthropic (Claude) and OpenAI.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Action, ActionType, Site } from "../game/outpost.js";
import type { ActReply, Agent, CallUsage, DiscussReply, SeatSpec, SurveyContext, SurveyReply, TurnContext } from "../types.js";
import {
  actInstruction,
  actSchema,
  discussInstruction,
  discussSchema,
  renderSituation,
  surveyInstruction,
  surveySchema,
  systemPrompt,
} from "./prompt.js";

export interface Completion {
  json: any;
  usage: CallUsage;
  /** Claude's summarized thinking, when the API returns it (shown to researchers as the model's reasoning). */
  thinking?: string;
}

abstract class LlmAgent implements Agent {
  readonly notes: string[] = [];
  lastUsage: CallUsage | null = null;
  constructor(readonly seat: SeatSpec) {}

  protected abstract complete(system: string, user: string, schema: object, schemaName: string): Promise<Completion>;

  private async call(system: string, user: string, schema: object, schemaName: string): Promise<Completion> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const c = await this.complete(system, user, schema, schemaName);
        this.lastUsage = c.usage;
        return c;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  private remember(note: unknown, day: number, phase: string) {
    if (typeof note === "string" && note.trim()) this.notes.push(`(day ${day}, ${phase}) ${note.trim()}`);
  }

  async discuss(ctx: TurnContext): Promise<DiscussReply> {
    const v = ctx.view;
    const names = v.teammates.map((t) => t.name);
    const byName = (n: string | null) => v.teammates.find((t) => t.name === n)?.id ?? null;
    const c = await this.call(
      systemPrompt(ctx.rules, ctx.identityBrief, v),
      renderSituation(ctx, this.notes) + discussInstruction(ctx),
      discussSchema(names),
      "discussion_turn",
    );
    const out = c.json;
    this.remember(out.memo, v.day, `discussion r${ctx.round}`);
    const pledge =
      out.pledge_action && out.pledge_action !== "none"
        ? { type: out.pledge_action as ActionType, site: (out.pledge_site as Site) ?? null, target: byName(out.pledge_target) }
        : null;
    return { message: String(out.message ?? "").slice(0, 600), pledge, note: c.thinking ?? out.memo, memo: out.memo };
  }

  async act(ctx: TurnContext): Promise<ActReply> {
    const v = ctx.view;
    const names = v.teammates.map((t) => t.name);
    const byName = (n: string | null) => v.teammates.find((t) => t.name === n)?.id ?? null;
    const c = await this.call(
      systemPrompt(ctx.rules, ctx.identityBrief, v),
      renderSituation(ctx, this.notes) + actInstruction(ctx),
      actSchema(names),
      "action_turn",
    );
    const out = c.json;
    this.remember(out.memo, v.day, "action");
    const action: Partial<Action> = {
      type: out.action,
      site: out.site ?? null,
      target: byName(out.heal_target),
      deposit: out.deposit ?? 0,
      giveTo: byName(out.give_to),
      giveAmount: out.give_amount ?? 0,
    };
    return { action, note: c.thinking ?? out.memo, memo: out.memo };
  }

  async survey(ctx: SurveyContext): Promise<SurveyReply> {
    const v = ctx.view;
    const names = v.teammates.map((t) => t.name);
    const out = (
      await this.call(systemPrompt(ctx.rules, ctx.identityBrief, v), renderSituation(ctx, this.notes) + surveyInstruction(), surveySchema(names), "debrief")
    ).json;
    return {
      ratings: (out.ratings ?? [])
        .map((r: any) => ({
          playerId: v.teammates.find((t) => t.name === r.player)?.id ?? "",
          trust: Math.max(1, Math.min(7, Number(r.trust) || 4)),
          guess: r.guess,
        }))
        .filter((r: any) => r.playerId),
      reflection: String(out.reflection ?? ""),
    };
  }
}

// ---------------------------------------------------------------------------

let anthropicClient: Anthropic | null = null;
const anthropic = () => (anthropicClient ??= new Anthropic());

// Models that support the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5)/;

/** One structured-output call to Claude. Returns parsed JSON + usage. */
export async function claudeJson(seat: SeatSpec, system: string, user: string, schema: object): Promise<Completion> {
  const model = seat.model!;
  const t0 = Date.now();
  const useFallback = FALLBACK_MODELS.test(model);
  const res = await anthropic().beta.messages.create({
    model,
    max_tokens: 16000,
    // Rules + identity are stable for the whole game, so cache them.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
    // Reasoning is read from the API's thinking summaries, never requested in the answer text
    // (asking a model to write out its reasoning can be declined as "reasoning_extraction").
    thinking: { type: "adaptive", display: "summarized" },
    output_config: {
      format: { type: "json_schema", schema: schema as Record<string, unknown> },
      ...(seat.effort ? { effort: seat.effort } : {}),
    },
    ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  if (res.stop_reason === "refusal") throw new Error(`refusal (${res.stop_details?.category ?? "unknown"})`);
  if (res.stop_reason === "max_tokens") throw new Error("hit max_tokens");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const thinking = res.content.flatMap((b) => (b.type === "thinking" && b.thinking ? [b.thinking] : [])).join("\n").trim();
  return {
    json: JSON.parse(text),
    thinking: thinking || undefined,
    usage: { model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, latencyMs: Date.now() - t0 },
  };
}

let openaiClient: OpenAI | null = null;
const openai = () => (openaiClient ??= new OpenAI());

/** One structured-output call to an OpenAI model (Responses API). */
export async function openaiJson(seat: SeatSpec, system: string, user: string, schema: object, schemaName: string): Promise<Completion> {
  const t0 = Date.now();
  const res = await openai().responses.create({
    model: seat.model!,
    instructions: system,
    input: user,
    text: { format: { type: "json_schema", name: schemaName, schema: schema as Record<string, unknown>, strict: true } },
    ...(seat.effort ? { reasoning: { effort: seat.effort === "max" || seat.effort === "xhigh" ? "high" : seat.effort } } : {}),
  });
  return {
    json: JSON.parse(res.output_text),
    usage: { model: res.model, inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0, latencyMs: Date.now() - t0 },
  };
}

/** Provider-agnostic structured call with one retry. */
export async function modelJson(seat: SeatSpec, system: string, user: string, schema: object, schemaName: string): Promise<Completion> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return seat.kind === "openai" ? await openaiJson(seat, system, user, schema, schemaName) : await claudeJson(seat, system, user, schema);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export class ClaudeAgent extends LlmAgent {
  protected complete(system: string, user: string, schema: object): Promise<Completion> {
    return claudeJson(this.seat, system, user, schema);
  }
}

export class OpenAIAgent extends LlmAgent {
  protected complete(system: string, user: string, schema: object, schemaName: string): Promise<Completion> {
    return openaiJson(this.seat, system, user, schema, schemaName);
  }
}
