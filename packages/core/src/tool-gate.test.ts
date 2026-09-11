import { describe, expect, it } from 'vitest';
import { ToolGate } from './tool-gate';

describe('ToolGate', () => {
  it('holds a result that arrives before reply.done', () => {
    const g = new ToolGate();
    g.onEvent('reply.started');
    g.add('c1', { ok: true });
    expect(g.drain()).toEqual([]);
  });

  it('releases held results once reply.done arrives', () => {
    const g = new ToolGate();
    g.onEvent('reply.started');
    g.add('c1', { ok: true });
    g.onEvent('reply.done', 'completed');
    expect(g.drain()).toEqual([{ call_id: 'c1', result: '{"ok":true}' }]);
  });

  it('releases immediately when reply.done was already the latest event', () => {
    const g = new ToolGate();
    g.onEvent('reply.done', 'completed');
    g.add('c1', { ok: true });
    expect(g.drain()).toHaveLength(1);
  });

  it('serialises results as JSON strings, which is what the API expects', () => {
    const g = new ToolGate();
    g.onEvent('reply.done');
    g.add('c1', { path: '/stores', navigated: true });
    expect(g.drain()[0]!.result).toBe('{"path":"/stores","navigated":true}');
  });

  it('re-holds when a new turn starts after reply.done', () => {
    const g = new ToolGate();
    g.onEvent('reply.done');
    g.onEvent('input.speech.started');
    g.add('c1', { ok: true });
    expect(g.drain()).toEqual([]);
  });

  it('discards pending results when the user interrupted', () => {
    const g = new ToolGate();
    g.onEvent('reply.started');
    g.add('c1', { ok: true });
    g.onEvent('reply.done', 'interrupted');
    expect(g.drain()).toEqual([]);
  });

  it('drain empties the queue so nothing is sent twice', () => {
    const g = new ToolGate();
    g.onEvent('reply.done');
    g.add('c1', { ok: true });
    g.drain();
    expect(g.drain()).toEqual([]);
  });

  it('marks errors so the agent can recover', () => {
    const g = new ToolGate();
    g.onEvent('reply.done');
    g.add('c1', { error: 'no such element' }, true);
    expect(g.drain()[0]).toMatchObject({ call_id: 'c1', is_error: true });
  });
});
