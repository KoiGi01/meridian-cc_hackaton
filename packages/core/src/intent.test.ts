import { describe, expect, it } from 'vitest';
import { LexicalIntentResolver, tokenize } from './intent';
import type { Manifest } from './types';

const manifest: Manifest = {
  version: 1,
  generatedAt: '2026-09-11T00:00:00Z',
  baseUrl: 'http://localhost',
  routes: [
    {
      path: '/products',
      label: 'Products',
      elements: [
        {
          id: 'products.create',
          purpose: 'Opens the form for adding a new product to the catalogue',
          aliases: ['add a product', 'new product', 'create a product', 'add an item to the menu'],
          anchors: [{ kind: 'text', value: 'Add new product', confidence: 0.4 }],
          destructive: false,
        },
        {
          id: 'products.nav',
          purpose: 'Sidebar link that opens the product catalogue',
          aliases: ['products', 'catalogue', 'menu items'],
          anchors: [{ kind: 'text', value: 'Products', confidence: 0.4 }],
          destructive: false,
        },
      ],
    },
    {
      path: '/stores',
      label: 'Stores',
      elements: [
        {
          id: 'stores.create',
          purpose: 'Opens the form for adding a new store location',
          aliases: ['add a store', 'new store', 'open a new branch'],
          anchors: [{ kind: 'text', value: 'Add new store', confidence: 0.4 }],
          destructive: false,
        },
      ],
    },
  ],
};

const resolver = new LexicalIntentResolver();

describe('tokenize', () => {
  it('lowercases, strips punctuation, and drops stopwords', () => {
    expect(tokenize('How do I add a Product?')).toEqual(['add', 'product']);
  });

  it('singularises crudely so "products" matches "product"', () => {
    expect(tokenize('products')).toEqual(['product']);
  });
});

describe('LexicalIntentResolver', () => {
  it('ranks the obvious answer first', async () => {
    const [best] = await resolver.resolve('how do I add a product?', manifest);
    expect(best?.elementId).toBe('products.create');
  });

  it('carries the route path so the caller can navigate', async () => {
    const [best] = await resolver.resolve('open a new branch', manifest);
    expect(best?.elementId).toBe('stores.create');
    expect(best?.routePath).toBe('/stores');
  });

  it('weights aliases above purpose text', async () => {
    // "menu" appears only in an alias of products.create; "catalogue" in an alias of products.nav.
    const [best] = await resolver.resolve('add an item to the menu', manifest);
    expect(best?.elementId).toBe('products.create');
  });

  it('returns nothing rather than a weak guess for an unrelated question', async () => {
    expect(await resolver.resolve('what is the weather today', manifest)).toEqual([]);
  });

  it('returns an empty list for an empty query', async () => {
    expect(await resolver.resolve('   ', manifest)).toEqual([]);
  });

  it('explains what it matched on', async () => {
    const [best] = await resolver.resolve('new product', manifest);
    expect(best?.matchedOn).toContain('alias');
  });

  it('returns more than one candidate when several are plausible', async () => {
    const matches = await resolver.resolve('add new', manifest);
    expect(matches.map((m) => m.elementId)).toEqual(
      expect.arrayContaining(['products.create', 'stores.create']),
    );
  });
});
