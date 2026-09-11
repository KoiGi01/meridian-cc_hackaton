import { ToolGate, type SessionUpdate } from 'pointto-core';
import { AGENT_SAMPLE_RATE, createCapture, createPlayback, type Capture, type Playback } from './audio';

const AGENT_WS = 'wss://agents.assemblyai.com/v1/ws';

export type VoiceState = 'idle' | 'connecting' | 'ready' | 'listening' | 'speaking' | 'ended' | 'error';

export interface AgentEvent {
  type: string;
  [k: string]: unknown;
}

export interface VoiceSessionOptions {
  /** Our token server. The browser never sees the API key. */
  tokenEndpoint: string;
  sessionUpdate: SessionUpdate | { type: 'session.update'; session: Record<string, unknown> };
  /** Runs a client-side tool. Throw with a specific message to report an error to the agent. */
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Every server frame except audio, plus state changes as `{ type: 'state', state }`. */
  onEvent: (event: AgentEvent) => void;
  /** Injectable for tests. Defaults to the real microphone and speakers. */
  audio?: {
    createCapture: typeof createCapture;
    createPlayback: typeof createPlayback;
  };
}

/**
 * One conversation with the AssemblyAI Voice Agent API over a WebSocket.
 *
 * Lifecycle (verified against live docs 2026-09-11): fetch token → connect
 * with `?token=` → send `session.update` immediately → wait for
 * `session.ready` → only then open the mic and stream `input.audio`.
 * Agent speech arrives as `reply.audio` (in `data`, not `audio`). Tool
 * results go out only when `reply.done` is the latest event (ToolGate).
 */
export class VoiceSession {
  state: VoiceState = 'idle';
  sessionId: string | null = null;

  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private capture: Capture | null = null;
  private playback: Playback | null = null;
  private readonly gate = new ToolGate();
  private readonly audio: NonNullable<VoiceSessionOptions['audio']>;

  constructor(private readonly opts: VoiceSessionOptions) {
    this.audio = opts.audio ?? { createCapture, createPlayback };
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.setState('connecting');

    const res = await fetch(this.opts.tokenEndpoint, { method: 'POST' });
    if (!res.ok) {
      this.fail(`token server returned ${res.status}`);
      throw new Error(`pointto: token server returned ${res.status}`);
    }
    const { token } = (await res.json()) as { token: string };

    // Creating the context on the user's click keeps autoplay policies happy.
    // Chromium honours 24 kHz; elsewhere the worklet resamples.
    this.ctx = new AudioContext({ sampleRate: AGENT_SAMPLE_RATE });
    this.playback = this.audio.createPlayback(this.ctx);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${AGENT_WS}?token=${encodeURIComponent(token)}`);
      this.ws = ws;
      ws.onopen = () => {
        this.send(this.opts.sessionUpdate);
        resolve();
      };
      ws.onmessage = (e) => this.onFrame(JSON.parse(e.data as string) as AgentEvent);
      ws.onerror = () => {
        if (this.state === 'connecting') reject(new Error('pointto: websocket failed to connect'));
        this.fail('websocket error');
      };
      ws.onclose = () => {
        if (this.state !== 'ended' && this.state !== 'error') this.teardown('ended');
      };
    });
  }

  /** Text in, through the same agent: it understands intent and any language. */
  sendText(text: string): void {
    this.send({ type: 'conversation.message', role: 'user', content: text });
    this.send({ type: 'reply.create' });
  }

  stop(): void {
    if (this.state === 'ended' || this.state === 'error') return;
    // session.end avoids paying for the 30 s resume window.
    this.send({ type: 'session.end' });
    this.teardown('ended');
  }

  // ---- internals ----------------------------------------------------------

  private async onFrame(ev: AgentEvent): Promise<void> {
    switch (ev.type) {
      case 'session.ready': {
        this.sessionId = (ev.session_id as string) ?? null;
        this.setState('ready');
        this.opts.onEvent(ev);
        await this.openMic();
        return;
      }
      case 'reply.audio': {
        // Field-name asymmetry: input is `audio`, output is `data`.
        this.playback?.push(ev.data as string);
        return;
      }
      case 'reply.started':
        this.gate.onEvent(ev.type);
        this.setState('speaking');
        break;
      case 'input.speech.started':
        this.gate.onEvent(ev.type);
        break;
      case 'reply.done': {
        const status = ev.status as string | undefined;
        this.gate.onEvent(ev.type, status);
        if (status === 'interrupted') this.playback?.flush();
        if (this.capture) this.setState('listening');
        this.flushTools();
        break;
      }
      case 'tool.call': {
        void this.runTool(ev.call_id as string, ev.name as string, (ev.arguments as Record<string, unknown>) ?? {});
        break;
      }
      case 'session.error': {
        this.opts.onEvent(ev);
        this.fail(String(ev.message ?? ev.code ?? 'session error'));
        return;
      }
      case 'session.ended': {
        this.opts.onEvent(ev);
        this.teardown('ended');
        return;
      }
    }
    this.opts.onEvent(ev);
  }

  private async openMic(): Promise<void> {
    if (!this.ctx || this.capture) return;
    try {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.capture = await this.audio.createCapture(this.ctx, (b64) => {
        this.send({ type: 'input.audio', audio: b64 });
      });
      this.setState('listening');
    } catch (e) {
      // Mic denied or unavailable. The session still works for typed text.
      this.opts.onEvent({ type: 'mic.unavailable', message: (e as Error).message });
    }
  }

  private async runTool(callId: string, name: string, args: Record<string, unknown>): Promise<void> {
    try {
      const result = await this.opts.onToolCall(name, args);
      this.gate.add(callId, result ?? { ok: true });
    } catch (e) {
      this.gate.add(callId, { error: (e as Error).message }, true);
    }
    // May already be idle if reply.done fired while the tool was running.
    this.flushTools();
  }

  private flushTools(): void {
    for (const frame of this.gate.drain()) this.send({ type: 'tool.result', ...frame });
  }

  private send(frame: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(frame));
  }

  private setState(s: VoiceState): void {
    if (this.state === s) return;
    this.state = s;
    this.opts.onEvent({ type: 'state', state: s });
  }

  private fail(message: string): void {
    this.opts.onEvent({ type: 'error', message });
    this.teardown('error');
  }

  private teardown(final: 'ended' | 'error'): void {
    this.capture?.stop();
    this.capture = null;
    this.playback?.flush();
    this.playback = null;
    void this.ctx?.close();
    this.ctx = null;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState < 2) ws.close();
    this.setState(final);
  }
}
