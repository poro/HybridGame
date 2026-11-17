// A human seat. The session asks it for a turn; the request is pushed to the
// player's browser over WebSocket and resolved when they submit.

import { EventEmitter } from "node:events";
import type { Action } from "../game/outpost.js";
import type { ActReply, Agent, DiscussReply, Pledge, SeatSpec, SurveyContext, SurveyReply, TurnContext } from "../types.js";

export type HumanRequestKind = "discuss" | "act" | "survey";

export interface PendingRequest {
  kind: HumanRequestKind;
  round: number;
  deadlineMs?: number;
  resolve: (payload: any) => void;
}

export class HumanAgent extends EventEmitter implements Agent {
  lastUsage = null;
  pending: PendingRequest | null = null;
  connected = 0;
  constructor(readonly seat: SeatSpec, readonly playerId: string) {
    super();
  }

  /** Push a request to the browser and wait for the submission (used by every game). */
  request<T>(kind: HumanRequestKind, round: number, deadlineMs?: number): Promise<T> {
    return new Promise<T>((resolve) => {
      this.pending = { kind, round, deadlineMs, resolve };
      this.emit("request", this.pending);
    });
  }

  /** Called by the server when the browser submits. Returns false if nothing was pending. */
  submit(kind: HumanRequestKind, payload: any): boolean {
    if (!this.pending || this.pending.kind !== kind) return false;
    const p = this.pending;
    this.pending = null;
    p.resolve(payload);
    this.emit("resolved");
    return true;
  }

  cancel() {
    this.pending = null;
    this.emit("resolved");
  }

  async discuss(ctx: TurnContext): Promise<DiscussReply> {
    const p = await this.request<{ message?: string; pledge?: Pledge | null }>("discuss", ctx.round, ctx.deadlineMs);
    return { message: String(p?.message ?? "").slice(0, 600), pledge: p?.pledge ?? null };
  }

  async act(ctx: TurnContext): Promise<ActReply> {
    const p = await this.request<{ action?: Partial<Action> }>("act", 0, ctx.deadlineMs);
    return { action: p?.action ?? { type: "rest" } };
  }

  async survey(ctx: SurveyContext): Promise<SurveyReply> {
    const p = await this.request<SurveyReply>("survey", 0, ctx.deadlineMs);
    return { ratings: p?.ratings ?? [], reflection: String(p?.reflection ?? "") };
  }
}
