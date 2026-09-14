// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceSession } from './VoiceSession';

/** Records what the client sends; lets the test inject server frames. */
class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  serverSends(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  types() {
    return this.sent.map((f) => f.type);
  }
}

const sessionUpdate = {
  type: 'session.update' as const,
  session: { system_prompt: 'x', greeting: 'hi', input: {}, output: { voice: 'lola' }, tools: [] },
};

let capture: { stop: ReturnType<typeof vi.fn> };
let playback: { push: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> };

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ token: 'tok' }) })));
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      currentTime = 0;
      sampleRate = 24000;
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
    },
  );
  capture = { stop: vi.fn() };
  playback = { push: vi.fn(), flush: vi.fn() };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function make(overrides: Partial<ConstructorParameters<typeof VoiceSession>[0]> = {}) {
  return new VoiceSession({
    tokenEndpoint: 'http://localhost:8787/api/voice/token',
    sessionUpdate,
    onToolCall: vi.fn(async () => ({ ok: true })),
    onEvent: vi.fn(),
    // Audio is injected so the tests never touch the mic or a real AudioContext.
    audio: {
      createCapture: vi.fn(async () => capture),
      createPlayback: vi.fn(() => playback),
    },
    ...overrides,
  });
}

async function started(s: VoiceSession) {
  const p = s.start();
  await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
  FakeSocket.last!.open();
  await p;
  return FakeSocket.last!;
}

describe('VoiceSession', () => {
  it('fetches a token and connects with it in the query string', async () => {
    const s = make();
    const ws = await started(s);
    expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/voice/token', expect.objectContaining({ method: 'POST' }));
    expect(ws.url).toBe('wss://agents.assemblyai.com/v1/ws?token=tok');
  });

  it('sends session.update as the very first frame, before session.ready', async () => {
    const ws = await started(make());
    expect(ws.types()[0]).toBe('session.update');
  });

  it('does not open the microphone until session.ready', async () => {
    const audio = { createCapture: vi.fn(async () => capture), createPlayback: vi.fn(() => playback) };
    const s = make({ audio });
    const ws = await started(s);
    expect(audio.createCapture).not.toHaveBeenCalled();
    ws.serverSends({ type: 'session.ready', session_id: 'sess_1' });
    await vi.waitFor(() => expect(audio.createCapture).toHaveBeenCalledOnce());
    expect(s.state).toBe('listening');
  });

  it('forwards agent audio to playback using the data field, not audio', async () => {
    const ws = await started(make());
    ws.serverSends({ type: 'session.ready' });
    ws.serverSends({ type: 'reply.audio', data: 'AAAA' });
    expect(playback.push).toHaveBeenCalledWith('AAAA');
  });

  it('flushes playback when the user interrupts', async () => {
    const ws = await started(make());
    ws.serverSends({ type: 'session.ready' });
    ws.serverSends({ type: 'reply.done', status: 'interrupted' });
    expect(playback.flush).toHaveBeenCalled();
  });

  it('runs a tool call but holds the result until reply.done', async () => {
    const onToolCall = vi.fn(async () => ({ status: 'resolved' }));
    const ws = await started(make({ onToolCall }));
    ws.serverSends({ type: 'session.ready' });
    ws.serverSends({ type: 'reply.started' });
    ws.serverSends({ type: 'tool.call', call_id: 'c1', name: 'highlight', arguments: { element_id: 'x' } });
    await vi.waitFor(() => expect(onToolCall).toHaveBeenCalledWith('highlight', { element_id: 'x' }));
    expect(ws.types()).not.toContain('tool.result');

    ws.serverSends({ type: 'reply.done', status: 'completed' });
    await vi.waitFor(() => expect(ws.types()).toContain('tool.result'));
    const frame = ws.sent.find((f) => f.type === 'tool.result')!;
    expect(frame.call_id).toBe('c1');
    expect(frame.result).toBe('{"status":"resolved"}');
  });

  it('marks a failed tool as an error so the agent can recover', async () => {
    const onToolCall = vi.fn(async () => {
      throw new Error('No element with id x. Ask the user to describe it.');
    });
    const ws = await started(make({ onToolCall }));
    ws.serverSends({ type: 'session.ready' });
    ws.serverSends({ type: 'reply.done' });
    ws.serverSends({ type: 'tool.call', call_id: 'c1', name: 'highlight', arguments: {} });
    await vi.waitFor(() => expect(ws.types()).toContain('tool.result'));
    const frame = ws.sent.find((f) => f.type === 'tool.result')!;
    expect(frame.is_error).toBe(true);
    expect(frame.result).toContain('No element with id x');
  });

  it('sends typed text as a user message followed by a reply request', async () => {
    const s = make();
    const ws = await started(s);
    ws.serverSends({ type: 'session.ready' });
    s.sendText('how do I add a store');
    const t = ws.types();
    expect(t.slice(-2)).toEqual(['conversation.message', 'reply.create']);
    expect(ws.sent.at(-2)).toMatchObject({ role: 'user', content: 'how do I add a store' });
    // The text rides in the instructions too: a bare reply.create did not
    // reliably act on the injected message against the live API.
    expect(String(ws.sent.at(-1)!.instructions)).toContain('how do I add a store');
  });

  describe('say', () => {
    it('speaks on demand right away when the agent is idle', async () => {
      const s = make();
      const ws = await started(s);
      ws.serverSends({ type: 'session.ready' });
      ws.serverSends({ type: 'reply.done', status: 'completed' });
      s.say('The user went to Orders.');
      expect(ws.sent.at(-1)).toEqual({ type: 'reply.create', instructions: 'The user went to Orders.' });
    });

    it('holds the instruction while the agent is talking and sends it after the tool results', async () => {
      const onToolCall = vi.fn(async () => ({ ok: true }));
      const s = make({ onToolCall });
      const ws = await started(s);
      ws.serverSends({ type: 'session.ready' });
      ws.serverSends({ type: 'reply.started' });
      ws.serverSends({ type: 'tool.call', call_id: 'c1', name: 'highlight', arguments: { element_id: 'x' } });
      await vi.waitFor(() => expect(onToolCall).toHaveBeenCalled());
      s.say('correction');
      expect(ws.types()).not.toContain('reply.create');

      ws.serverSends({ type: 'reply.done', status: 'completed' });
      await vi.waitFor(() => expect(ws.types()).toContain('reply.create'));
      const t = ws.types();
      expect(t.indexOf('tool.result')).toBeLessThan(t.indexOf('reply.create'));
    });

    it('drops a held instruction when the user interrupted — they are talking, not wandering', async () => {
      const s = make();
      const ws = await started(s);
      ws.serverSends({ type: 'session.ready' });
      ws.serverSends({ type: 'reply.started' });
      s.say('correction');
      ws.serverSends({ type: 'reply.done', status: 'interrupted' });
      expect(ws.types()).not.toContain('reply.create');
    });
  });

  it('ends the session cleanly and releases the microphone', async () => {
    const s = make();
    const ws = await started(s);
    ws.serverSends({ type: 'session.ready' });
    await vi.waitFor(() => expect(s.state).toBe('listening'));
    s.stop();
    expect(ws.types()).toContain('session.end');
    expect(capture.stop).toHaveBeenCalled();
    expect(s.state).toBe('ended');
  });

  it('reports a session.error and stops', async () => {
    const onEvent = vi.fn();
    const s = make({ onEvent });
    const ws = await started(s);
    ws.serverSends({ type: 'session.error', code: 'unauthorized', message: 'bad token' });
    expect(s.state).toBe('error');
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.error' }));
  });
});
