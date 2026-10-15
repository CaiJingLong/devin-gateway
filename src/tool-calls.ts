import type { ChatToolCall } from "./proto.js";

export interface ChatToolCallDelta extends ChatToolCall {
  /** Stable, zero-based position within this response. */
  index: number;
}

interface PendingCall {
  call: ChatToolCallDelta;
  emittedLength: number;
}

/**
 * Cascade argument deltas may omit both ID and name. Parallel calls are
 * disabled by streamChat(), so anonymous fragments belong to the active call.
 * Normalize identity while forwarding argument bytes immediately. Retain a
 * copy for final validation; streamed fragments are not completed tool calls.
 */
export class ToolCallAccumulator {
  private calls: PendingCall[] = [];
  private byId = new Map<string, PendingCall>();
  private active?: PendingCall;

  add(deltas: ChatToolCall[]): ChatToolCallDelta[] {
    const output: ChatToolCallDelta[] = [];
    for (const delta of deltas) {
      if (delta.invalidJsonErr) throw new Error("Upstream tool arguments are invalid");
      let pending = delta.id ? this.byId.get(delta.id) : this.active;
      // A named header without an ID still starts a distinct call. Preserve
      // its empty ID so each API adapter can apply its existing fallback.
      if (!delta.id && delta.name && pending?.call.name) {
        pending = undefined;
      }
      if (!pending && (delta.id || delta.name)) {
        pending = {
          call: { index: this.calls.length, id: delta.id, name: "", argumentsJson: "" },
          emittedLength: 0,
        };
        this.calls.push(pending);
        if (delta.id) this.byId.set(delta.id, pending);
      }
      if (!pending) throw new Error("Tool argument fragment has no call header");
      this.active = pending;
      const { call } = pending;
      if (delta.name) {
        if (call.name && call.name !== delta.name) throw new Error("Tool call name changed");
        call.name = delta.name;
      }
      if (delta.isCustomToolCall !== undefined) call.isCustomToolCall = delta.isCustomToolCall;
      call.argumentsJson += delta.argumentsJson;
      // A header may arrive before its name. Wait only for identity, never for
      // complete JSON, then send any argument bytes accumulated in the meantime.
      if (call.name) {
        output.push({ ...call, argumentsJson: call.argumentsJson.slice(pending.emittedLength) });
        pending.emittedLength = call.argumentsJson.length;
      }
    }
    return output;
  }

  finish(): ChatToolCallDelta[] {
    const output: ChatToolCallDelta[] = [];
    for (const { call } of this.calls) {
      if (!call.name) throw new Error("Tool call has no name");
      const argumentsJson = call.argumentsJson || "{}";
      let value: unknown;
      try {
        value = JSON.parse(argumentsJson);
      } catch {
        throw new Error("Incomplete or invalid tool arguments");
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Tool arguments must be a JSON object");
      }
      // Zero-argument calls have already emitted a header. Supply their only
      // argument bytes at EOF; never replay previously streamed fragments.
      if (!call.argumentsJson) output.push({ ...call, argumentsJson });
    }
    return output;
  }
}
