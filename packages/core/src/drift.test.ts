import { describe, expect, it } from 'vitest';
import { DriftTracker, MAX_CORRECTIONS, QUEST_TTL_MS, correctionInstruction, correctionText } from './drift';

describe('DriftTracker', () => {
  it('starts a quest when an element is lit', () => {
    const t = new DriftTracker();
    expect(t.lit('products.add', '/products', '/products')).toBe('goal');
    expect(t.quest).toMatchObject({ goalId: 'products.add', goalPath: '/products', corrections: 0, lit: 'goal' });
  });

  it('clicking the goal ends the quest', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    expect(t.reached('products.add')).toBe('goal-done');
    expect(t.quest).toBeNull();
  });

  it('counts corrections and gives up on the third drift', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    expect(t.left()).toEqual({ attempt: 1, final: false });
    expect(t.quest?.lit).toBe('none');
    t.lit('products.add', '/products', '/products'); // relit after the user came back
    expect(t.left()).toEqual({ attempt: 2, final: false });
    t.lit('products.add', '/products', '/products');
    expect(t.left()).toEqual({ attempt: MAX_CORRECTIONS + 1, final: true });
    expect(t.quest).toBeNull();
  });

  it('lighting a global element while the quest is pending elsewhere is a waypoint, not a new quest', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    t.left(); // user went to /orders
    expect(t.lit('app.products', '*', '/orders')).toBe('waypoint');
    expect(t.quest?.goalId).toBe('products.add');
    expect(t.reached('app.products')).toBe('waypoint-done');
    expect(t.quest?.goalId).toBe('products.add'); // still pending
    expect(t.quest?.lit).toBe('none');
  });

  it('lighting a global element with no pending quest is a new quest', () => {
    const t = new DriftTracker();
    expect(t.lit('app.products', '*', '/orders')).toBe('goal');
  });

  it('lighting a non-global element while pending replaces the quest', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    t.left();
    expect(t.lit('stores.add', '/stores', '/stores')).toBe('goal');
    expect(t.quest?.goalId).toBe('stores.add');
    expect(t.quest?.corrections).toBe(0);
  });

  it('lighting the goal itself while pending keeps the correction count', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    t.left();
    expect(t.lit('products.add', '/products', '/products')).toBe('goal');
    expect(t.quest?.corrections).toBe(1);
  });

  it('relights when the route returns to the goal while pending, once', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    t.left();
    expect(t.routeChanged('/orders')).toBe(false);
    expect(t.routeChanged('/products')).toBe(true);
    // The provider lights it and calls lit(); until then, no double fire.
    expect(t.routeChanged('/products')).toBe(false);
  });

  it('does not relight while something is lit', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    expect(t.routeChanged('/products')).toBe(false);
  });

  it('forgets a pending quest after the TTL', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products', 0);
    t.left(0);
    expect(t.routeChanged('/products', QUEST_TTL_MS + 1)).toBe(false);
    expect(t.quest).toBeNull();
  });

  it('a global goal never drifts by route', () => {
    const t = new DriftTracker();
    t.lit('app.products', '*', '/orders');
    expect(t.quest?.goalPath).toBe('*');
  });

  it('left() with no quest is null', () => {
    expect(new DriftTracker().left()).toBeNull();
  });

  it('reset() forgets everything', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    t.reset();
    expect(t.quest).toBeNull();
    expect(t.reached('products.add')).toBe('none');
  });
});

const ctx = {
  kind: 'drift' as const,
  attempt: 1,
  goal: { id: 'products.add-new-product', purpose: 'Opens a form to add a new product', screen: 'Products', path: '/products' },
  now: { path: '/orders', screen: 'Orders', visibleIds: ['orders.export', 'app.products'] },
};

describe('correctionText', () => {
  it('names where the user is and where the goal lives', () => {
    const s = correctionText(ctx);
    expect(s).toContain('Orders');
    expect(s).toContain('Products');
    expect(s).toContain('add new product');
    expect(s).not.toMatch(/wrong|mistake|oops/i);
  });

  it('offers to start over on the final attempt', () => {
    expect(correctionText({ ...ctx, attempt: 3 })).toMatch(/start over|stop/i);
  });

  it('handles a lost target on the same screen', () => {
    const s = correctionText({ ...ctx, kind: 'lost', now: { ...ctx.now, path: '/products', screen: 'Products' } });
    expect(s).toMatch(/can.t see|no longer/i);
  });

  it('falls back to the path when a screen has no label', () => {
    expect(correctionText({ ...ctx, now: { ...ctx.now, screen: null } })).toContain('/orders');
  });
});

describe('correctionInstruction', () => {
  it('carries the context the model needs and the tone rule', () => {
    const s = correctionInstruction(ctx);
    expect(s).toContain('/orders');
    expect(s).toContain('products.add-new-product');
    expect(s).toContain('/products');
    expect(s).toContain('orders.export');
    expect(s).toMatch(/one short/i);
    expect(s).toMatch(/call highlight/);
    expect(s).toMatch(/never call navigate/i);
  });

  it('on the final attempt tells the model to offer to start over and stop correcting', () => {
    const s = correctionInstruction({ ...ctx, attempt: 3 });
    expect(s).toMatch(/start over/i);
    expect(s).not.toMatch(/call highlight on/i);
  });

  it('describes a lost target without inventing a screen change', () => {
    const s = correctionInstruction({ ...ctx, kind: 'lost', now: { ...ctx.now, path: '/products', screen: 'Products' } });
    expect(s).toMatch(/no longer visible/i);
    expect(s).not.toMatch(/went to/i);
  });
});
