import { describe, expect, it } from 'vitest';
import { ManifestError, parseManifest } from './manifest';

const valid = {
  version: 1,
  generatedAt: '2026-09-12T00:00:00Z',
  baseUrl: 'http://localhost:3000',
  routes: [
    {
      path: '/settings/team',
      label: 'Team settings',
      elements: [
        {
          id: 'team.invite-member',
          purpose: 'Opens the invite dialog',
          aliases: ['add someone'],
          anchors: [{ kind: 'testid', value: 'invite-member-btn', confidence: 1 }],
        },
      ],
    },
  ],
};

describe('parseManifest', () => {
  it('accepts a valid manifest and returns it typed', () => {
    const m = parseManifest(structuredClone(valid));
    expect(m.routes[0]!.elements[0]!.id).toBe('team.invite-member');
  });

  it('accepts a null purpose, because the labeler must be allowed to abstain', () => {
    const input = structuredClone(valid) as Record<string, any>;
    input.routes[0].elements[0].purpose = null;
    expect(parseManifest(input).routes[0]!.elements[0]!.purpose).toBeNull();
  });

  it('defaults aliases to an empty array when absent', () => {
    const input = structuredClone(valid) as Record<string, any>;
    delete input.routes[0].elements[0].aliases;
    expect(parseManifest(input).routes[0]!.elements[0]!.aliases).toEqual([]);
  });

  it('rejects an unsupported version', () => {
    const input = { ...structuredClone(valid), version: 2 };
    expect(() => parseManifest(input)).toThrowError(ManifestError);
    expect(() => parseManifest(input)).toThrowError(/version/);
  });

  it('rejects an element with no anchors, since it could never be resolved', () => {
    const input = structuredClone(valid);
    input.routes[0]!.elements[0]!.anchors = [];
    expect(() => parseManifest(input)).toThrowError(/anchors/);
  });

  it('reports the json path of the offending element', () => {
    const input = structuredClone(valid) as Record<string, any>;
    delete input.routes[0].elements[0].id;
    try {
      parseManifest(input);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as ManifestError).path).toBe('routes[0].elements[0].id');
    }
  });

  it('rejects duplicate element ids across routes', () => {
    const input = structuredClone(valid);
    input.routes.push(structuredClone(input.routes[0]!));
    expect(() => parseManifest(input)).toThrowError(/duplicate/i);
  });

  it('rejects a flow step that names an unknown element id', () => {
    const input = structuredClone(valid) as Record<string, any>;
    input.flows = [{ id: 'f', intent: 'x', steps: ['team.nope'] }];
    expect(() => parseManifest(input)).toThrowError(/team\.nope/);
  });
});
