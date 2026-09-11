import { describe, expect, it } from 'vitest';
import { elementId, routeSlug, slug, uniqueIds } from './ids';

describe('slug', () => {
  it('lowercases, strips icon prefixes and punctuation, joins with dashes', () => {
    expect(slug('Add new product')).toBe('add-new-product');
    expect(slug('Search by Store ID, E-mail, Keyword')).toBe('search-by-store-id-e-mail-keyword');
  });
  it('drops antd icon tokens that leak into accessible names', () => {
    expect(slug('plus-square Add new product', ['plus-square'])).toBe('add-new-product');
  });
});

describe('routeSlug', () => {
  it('uses the label when present', () => {
    expect(routeSlug({ path: '/settings/team', label: 'Team settings' })).toBe('team-settings');
  });
  it('falls back to the path, and calls the root "home"', () => {
    expect(routeSlug({ path: '/settings/team' })).toBe('settings-team');
    expect(routeSlug({ path: '/' })).toBe('home');
  });
});

describe('elementId', () => {
  it('is route.name', () => {
    expect(elementId('products', 'Add new product')).toBe('products.add-new-product');
  });
  it('truncates absurdly long names', () => {
    expect(elementId('r', 'a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe('uniqueIds', () => {
  it('suffixes duplicates deterministically', () => {
    expect(uniqueIds(['a.x', 'a.x', 'a.y', 'a.x'])).toEqual(['a.x', 'a.x-2', 'a.y', 'a.x-3']);
  });
});
