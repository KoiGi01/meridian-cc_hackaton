// @vitest-environment jsdom
import type { Manifest } from 'pointto-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolRunner, DEFAULT_AWAIT_MS, MAX_AWAIT_MS, type GuideResult, type ToolDeps } from './tools';

const manifest: Manifest = {
  version: 1,
  generatedAt: '2026-09-14T00:00:00Z',
  baseUrl: 'http://localhost:5173',
  routes: [
    {
      path: '*',
      label: 'Everywhere',
      elements: [
        {
          id: 'app.logout',
          purpose: 'Logs out of the current account session',
          aliases: ['sign out'],
          anchors: [{ kind: 'text', value: 'Logout', confidence: 0.6 }],
          destructive: true,
        },
      ],
    },
    {
      path: '/products',
      label: 'Products',
      elements: [
        {
          id: 'products.create',
          purpose: 'Opens the form for adding a new product',
          aliases: ['add a product'],
          anchors: [{ kind: 'text', value: 'Add new product', confidence: 0.6 }],
          destructive: false,
        },
      ],
    },
  ],
};

let deps: ToolDeps & { guide: ReturnType<typeof vi.fn>; awaitInteraction: ReturnType<typeof vi.fn> };
let path: string;
let navigated: string[];

beforeEach(() => {
  path = '/products';
  navigated = [];
  deps = {
    manifest,
    guide: vi.fn(async (id: string): Promise<GuideResult> => ({ status: 'resolved', elementId: id, navigated: false })),
    router: { currentPath: () => path, navigate: (p) => navigated.push(p) },
    awaitInteraction: vi.fn(async () => {}),
    onNavigate: vi.fn(),
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 80, bottom: 20, width: 80, height: 20, toJSON: () => '',
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('createToolRunner', () => {
  describe('highlight', () => {
    it('guides and returns the purpose so the agent can describe it', async () => {
      const run = createToolRunner(deps);
      await expect(run('highlight', { element_id: 'products.create' })).resolves.toEqual({
        status: 'highlighted',
        element_id: 'products.create',
        navigated: false,
        purpose: 'Opens the form for adding a new product',
      });
    });

    it('rejects an unknown id with advice', async () => {
      const run = createToolRunner(deps);
      await expect(run('highlight', { element_id: 'nope' })).rejects.toThrow(/No element with id "nope"/);
      expect(deps.guide).not.toHaveBeenCalled();
    });

    it('reports a miss as an error the agent must not paper over', async () => {
      deps.guide.mockResolvedValueOnce({ status: 'not-found', elementId: 'products.create', navigated: true });
      const run = createToolRunner(deps);
      await expect(run('highlight', { element_id: 'products.create' })).rejects.toThrow(/even after navigating/);
    });

    it('refuses a destructive element until the user has confirmed', async () => {
      const run = createToolRunner(deps);
      await expect(run('highlight', { element_id: 'app.logout' })).rejects.toThrow(/confirmed: true/);
      expect(deps.guide).not.toHaveBeenCalled();
    });

    it('guides a destructive element once confirmed', async () => {
      const run = createToolRunner(deps);
      await expect(run('highlight', { element_id: 'app.logout', confirmed: true })).resolves.toMatchObject({
        status: 'highlighted',
      });
      expect(deps.guide).toHaveBeenCalledWith('app.logout');
    });
  });

  describe('await_interaction', () => {
    it('waits for the click with a sane default timeout', async () => {
      const run = createToolRunner(deps);
      await expect(run('await_interaction', { element_id: 'products.create' })).resolves.toEqual({
        status: 'clicked',
        element_id: 'products.create',
      });
      expect(deps.awaitInteraction).toHaveBeenCalledWith('products.create', DEFAULT_AWAIT_MS);
    });

    it('clamps an absurd timeout', async () => {
      const run = createToolRunner(deps);
      await run('await_interaction', { element_id: 'products.create', timeout_ms: 999_999 });
      expect(deps.awaitInteraction).toHaveBeenCalledWith('products.create', MAX_AWAIT_MS);
    });

    it('rejects an unknown id', async () => {
      const run = createToolRunner(deps);
      await expect(run('await_interaction', { element_id: 'nope' })).rejects.toThrow(/No element with id "nope"/);
    });

    it('surfaces the reason the wait ended without a click', async () => {
      deps.awaitInteraction.mockRejectedValueOnce(new Error('The user went to /orders instead of clicking "products.create".'));
      const run = createToolRunner(deps);
      await expect(run('await_interaction', { element_id: 'products.create' })).rejects.toThrow(/went to \/orders/);
    });
  });

  describe('navigate', () => {
    it('navigates to a known path and tells the provider first', async () => {
      const run = createToolRunner(deps);
      await expect(run('navigate', { path: '/products' })).resolves.toEqual({ ok: true, path: '/products' });
      expect(deps.onNavigate).toHaveBeenCalled();
      expect(navigated).toEqual(['/products']);
    });

    it('rejects a path that is not in the catalog', async () => {
      const run = createToolRunner(deps);
      await expect(run('navigate', { path: '/nowhere' })).rejects.toThrow(/Unknown path/);
      expect(navigated).toEqual([]);
    });
  });

  describe('get_current_context', () => {
    it('reports the screen and which catalog elements are actually on it, including global ones', async () => {
      document.body.innerHTML = '<a>Logout</a><button>Add new product</button>';
      const run = createToolRunner(deps);
      await expect(run('get_current_context', {})).resolves.toEqual({
        path: '/products',
        screen: 'Products',
        visible_element_ids: ['products.create', 'app.logout'],
      });
    });
  });

  it('rejects an unknown tool', async () => {
    const run = createToolRunner(deps);
    await expect(run('teleport', {})).rejects.toThrow(/Unknown tool/);
  });
});
