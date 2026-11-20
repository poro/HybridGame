import type { Action, ActionType, PlayerView, Site } from "./game/outpost.js";

export type SeatKind = "human" | "anthropic" | "openai" | "bot";
export type BotPersona = "cooperative" | "allclear" | "selfish" | "random";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** One seat at the table. `label` is the experimenter-facing description, e.g. "claude-opus-5-5". */
export interface SeatSpec {
  kind: SeatKind;
  label: string;
  model?: string; // provider model id for anthropic/openai
  effort?: Effort;
  persona?: BotPersona; // bots only
}

export interface Pledge {
  type: ActionType;
  site: Site | null;
  target: string | null; // player id
}

export interface ChatMessage {
  day: number;
  round: number;
  from: string; // player id
  fromName: string;
  text: string;
  pledge: Pledge | null;
  ts: number;
}

export interface TurnContext {
  rules: string;
  identityBrief: string; // what this player is told about who their teammates are
  view: PlayerView;
  chat: ChatMessage[];
  todaysPledges: Record<string, Pledge | null>;
  round: number; // discussion round (1-based); 0 during the action phase
  rounds: number;
  deadlineMs?: number;
}

export interface DiscussReply {
  message: string; // "" = stay silent
  pledge: Pledge | null;
  note?: string; // what researchers see: Claude's thinking summary, or the memo
  memo?: string; // the model's short memo to itself, fed back on later turns
}

export interface ActReply {
  action: Partial<Action>;
  note?: string;
  memo?: string;
}

export type IdentityGuess = "human" | "ai" | "unsure";

export interface SurveyReply {
  ratings: { playerId: string; trust: number; guess: IdentityGuess }[];
  reflection: string;
}

export interface SurveyContext {
  rules: string;
  identityBrief: string;
  view: PlayerView;
  chat: ChatMessage[];
  deadlineMs?: number;
}

export interface CallUsage {
  model: string;
  inputTokens: number; // uncached input (Anthropic reports cache reads/writes separately)
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number | null; // list-price estimate; null when the model's price is unknown
  latencyMs: number;
}

export interface Agent {
  readonly seat: SeatSpec;
  discuss(ctx: TurnContext): Promise<DiscussReply>;
  act(ctx: TurnContext): Promise<ActReply>;
  survey(ctx: SurveyContext): Promise<SurveyReply>;
  /** Usage from the agent's most recent call, if it was a model call. */
  lastUsage?: CallUsage | null;
}
