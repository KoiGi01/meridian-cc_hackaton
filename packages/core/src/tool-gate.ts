export interface ToolResultFrame {
  call_id: string;
  /** JSON string — the API reads it verbatim. */
  result: string;
  is_error?: boolean;
}

/**
 * Encodes the one non-obvious rule of client-side tools on the Voice Agent
 * API: send `tool.result` only when `reply.done` is the latest event. Earlier
 * and the agent is mid-sentence; later and a new turn has begun. If the user
 * interrupted (`reply.done.status === "interrupted"`), pending results are
 * stale and must be dropped.
 *
 * Pure so it can be tested without a socket. VoiceSession feeds it events and
 * sends whatever `drain()` returns.
 */
export class ToolGate {
  private last: string | null = null;
  private queue: ToolResultFrame[] = [];

  onEvent(type: string, status?: string): void {
    this.last = type;
    if (type === 'reply.done' && status === 'interrupted') this.queue = [];
  }

  add(callId: string, result: unknown, isError = false): void {
    this.queue.push({
      call_id: callId,
      result: JSON.stringify(result),
      ...(isError ? { is_error: true } : {}),
    });
  }

  /** Results that may be sent now. Empty unless the agent is idle. */
  drain(): ToolResultFrame[] {
    if (this.last !== 'reply.done') return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }
}
