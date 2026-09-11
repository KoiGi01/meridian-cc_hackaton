// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findElementById, resolveElement } from './resolve';
import type { Manifest, ManifestElement } from './types';

const inviteButton: ManifestElement = {
  id: 'team.invite-member',
  purpose: 'Opens the invite dialog',
  aliases: ['add someone'],
  anchors: [
    { kind: 'testid', value: 'invite-btn', confidence: 1 },
    { kind: 'role-name', role: 'button', name: 'Invite member', confidence: 0.8 },
    { kind: 'text', value: 'Invite member', confidence: 0.6 },
    { kind: 'css', value: 'main > button', confidence: 0.3 },
  ],
  destructive: false,
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 80,
    bottom: 20,
    width: 80,
    height: 20,
    toJSON: () => '',
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('resolveElement', () => {
  it('resolves on the most durable anchor when everything is intact', () => {
    document.body.innerHTML = '<main><button data-testid="invite-btn">Invite member</button></main>';
    const out = resolveElement(inviteButton);
    expect(out.status).toBe('resolved');
    if (out.status !== 'resolved') return;
    expect(out.anchorKind).toBe('testid');
    expect(out.anchorIndex).toBe(0);
  });

  // The headline reliability claim: the host app renamed the button and did not
  // regenerate the manifest.
  it('survives the test id being removed by falling through to role and name', () => {
    document.body.innerHTML = '<main><button>Invite member</button></main>';
    const out = resolveElement(inviteButton);
    expect(out.status).toBe('resolved');
    if (out.status !== 'resolved') return;
    expect(out.anchorKind).toBe('role-name');
  });

  it('survives a renamed button by falling all the way through to the css anchor', () => {
    document.body.innerHTML = '<main><button>Add a teammate</button></main>';
    const out = resolveElement(inviteButton);
    expect(out.status).toBe('resolved');
    if (out.status !== 'resolved') return;
    expect(out.anchorKind).toBe('css');
    expect(out.element.textContent).toBe('Add a teammate');
  });

  it('reports which anchor won, so manifest brittleness can be measured', () => {
    document.body.innerHTML = '<main><button>Invite member</button></main>';
    const out = resolveElement(inviteButton);
    if (out.status !== 'resolved') throw new Error('expected resolution');
    expect(out.anchorIndex).toBe(1);
  });

  it('returns not-found rather than guessing when nothing matches', () => {
    document.body.innerHTML = '<main><section>nothing here</section></main>';
    const out = resolveElement(inviteButton);
    expect(out.status).toBe('not-found');
    if (out.status !== 'not-found') return;
    expect(out.tried).toEqual(['testid', 'role-name', 'text', 'css']);
  });

  it('skips an ambiguous anchor in favour of a lower one that is unique', () => {
    // Two buttons share the text, but only one carries the test id.
    document.body.innerHTML =
      '<main><button data-testid="invite-btn">Invite member</button><button>Invite member</button></main>';
    const out = resolveElement(inviteButton);
    if (out.status !== 'resolved') throw new Error('expected resolution');
    expect(out.anchorKind).toBe('testid');
    expect(out.ambiguous).toBe(false);
  });

  it('resolves an ambiguous anchor to the match nearest the viewport centre, and says so', () => {
    document.body.innerHTML = '<main><button>Invite member</button><button>Invite member</button></main>';
    const [far, near] = [...document.querySelectorAll('button')] as HTMLElement[];
    vi.spyOn(far!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 80,
      bottom: 20,
      width: 80,
      height: 20,
      toJSON: () => '',
    } as DOMRect);
    vi.spyOn(near!, 'getBoundingClientRect').mockReturnValue({
      x: 500,
      y: 380,
      top: 380,
      left: 500,
      right: 580,
      bottom: 400,
      width: 80,
      height: 20,
      toJSON: () => '',
    } as DOMRect);

    const textOnly: ManifestElement = { ...inviteButton, anchors: [inviteButton.anchors[2]!] };
    const out = resolveElement(textOnly);
    if (out.status !== 'resolved') throw new Error('expected resolution');
    expect(out.element).toBe(near);
    expect(out.ambiguous).toBe(true);
  });

  it('finds elements rendered outside the react tree, such as a portalled modal', () => {
    // The portal target is a sibling of the app root, not a descendant.
    document.body.innerHTML =
      '<div id="root"><main></main></div><div id="portal"><button data-testid="invite-btn">Invite member</button></div>';
    expect(resolveElement(inviteButton).status).toBe('resolved');
  });
});

describe('findElementById', () => {
  const manifest: Manifest = {
    version: 1,
    generatedAt: '2026-09-12T00:00:00Z',
    baseUrl: 'http://localhost:3000',
    routes: [
      { path: '/a', label: 'A', elements: [inviteButton] },
      { path: '/b', label: 'B', elements: [] },
    ],
  };

  it('finds an element across every route', () => {
    expect(findElementById(manifest, 'team.invite-member')?.id).toBe('team.invite-member');
  });

  it('returns null for an unknown id rather than throwing', () => {
    expect(findElementById(manifest, 'nope')).toBeNull();
  });
});
