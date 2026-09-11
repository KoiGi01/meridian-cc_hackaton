import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAriaSnapshot } from './aria';

const sample = readFileSync(
  resolve(import.meta.dirname, '../../../docs/superpowers/specs/aria-snapshot-products-sample.yml'),
  'utf8',
);

describe('parseAriaSnapshot', () => {
  const nodes = parseAriaSnapshot(sample);

  it('finds named interactive nodes with their refs', () => {
    expect(nodes).toContainEqual({ role: 'link', name: 'Products', ref: 'e44' });
    expect(nodes).toContainEqual({ role: 'button', name: 'plus-square Add new product', ref: 'e144' });
    expect(nodes).toContainEqual({ role: 'combobox', name: 'Search by Store ID, E-mail, Keyword', ref: 'e86' });
  });

  it('skips unnamed nodes, which the runtime could only find by css', () => {
    expect(nodes.find((n) => n.ref === 'e69')).toBeUndefined();
    expect(nodes.find((n) => n.ref === 'e172')).toBeUndefined();
  });

  it('skips non-interactive roles', () => {
    expect(nodes.every((n) => n.role !== 'generic' && n.role !== 'text' && n.role !== 'img')).toBe(true);
  });

  it('ignores [cursor=pointer] and trailing colons', () => {
    const p = nodes.find((n) => n.ref === 'e44')!;
    expect(p.name).toBe('Products');
  });

  it('handles a minimal hand-written line', () => {
    expect(parseAriaSnapshot('- button "Save" [ref=e1]')).toEqual([{ role: 'button', name: 'Save', ref: 'e1' }]);
  });

  // Regression: every route after the first parsed to zero elements, because
  // Playwright prefixes refs with the frame after a navigation.
  it('accepts frame-prefixed refs, which appear after the first navigation', () => {
    expect(parseAriaSnapshot('- link "Stores" [ref=f1e56]:')).toEqual([{ role: 'link', name: 'Stores', ref: 'f1e56' }]);
  });

  it('handles escaped quotes inside a name', () => {
    expect(parseAriaSnapshot('- button "Say \\"hi\\"" [ref=e1]')[0]!.name).toBe('Say "hi"');
  });
});
