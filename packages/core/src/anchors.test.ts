// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchAnchor } from './anchors';

beforeEach(() => {
  // Every element in these tests is considered laid out.
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

describe('matchAnchor', () => {
  it('finds by data-testid', () => {
    document.body.innerHTML = '<button data-testid="invite-btn">Invite</button>';
    const hits = matchAnchor({ kind: 'testid', value: 'invite-btn', confidence: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.textContent).toBe('Invite');
  });

  it('escapes testid values so an odd value cannot break the selector', () => {
    document.body.innerHTML = '<button data-testid="a.b:c">Invite</button>';
    expect(matchAnchor({ kind: 'testid', value: 'a.b:c', confidence: 1 })).toHaveLength(1);
  });

  it('finds by role and accessible name from aria-label', () => {
    document.body.innerHTML = '<button aria-label="Invite member">+</button>';
    const hits = matchAnchor({ kind: 'role-name', role: 'button', name: 'Invite member', confidence: 0.8 });
    expect(hits).toHaveLength(1);
  });

  it('falls back to text content for the accessible name', () => {
    document.body.innerHTML = '<button>Invite member</button>';
    const hits = matchAnchor({ kind: 'role-name', role: 'button', name: 'Invite member', confidence: 0.8 });
    expect(hits).toHaveLength(1);
  });

  it('matches the accessible name case-insensitively and ignores stray whitespace', () => {
    document.body.innerHTML = '<button>  invite   MEMBER </button>';
    const hits = matchAnchor({ kind: 'role-name', role: 'button', name: 'Invite member', confidence: 0.8 });
    expect(hits).toHaveLength(1);
  });

  it('uses the placeholder as the name of an otherwise unnamed input', () => {
    document.body.innerHTML = '<input placeholder="Search by Store ID, E-mail, Keyword" />';
    expect(
      matchAnchor({ kind: 'role-name', role: 'textbox', name: 'Search by Store ID, E-mail, Keyword', confidence: 0.8 }),
    ).toHaveLength(1);
  });

  it('treats an anchor element as the link role', () => {
    document.body.innerHTML = '<a href="/x">Billing</a>';
    expect(matchAnchor({ kind: 'role-name', role: 'link', name: 'Billing', confidence: 0.8 })).toHaveLength(1);
  });

  it('honours an explicit role attribute over the tag name', () => {
    document.body.innerHTML = '<div role="button">Save</div>';
    expect(matchAnchor({ kind: 'role-name', role: 'button', name: 'Save', confidence: 0.8 })).toHaveLength(1);
  });

  it('finds by exact trimmed text', () => {
    document.body.innerHTML = '<button> Invite member </button>';
    expect(matchAnchor({ kind: 'text', value: 'Invite member', confidence: 0.6 })).toHaveLength(1);
  });

  it('does not match text that merely contains the value', () => {
    document.body.innerHTML = '<button>Invite member to workspace</button>';
    expect(matchAnchor({ kind: 'text', value: 'Invite member', confidence: 0.6 })).toHaveLength(0);
  });

  it('prefers the innermost element when text is nested, not its container', () => {
    document.body.innerHTML = '<div><button><span>Invite member</span></button></div>';
    const hits = matchAnchor({ kind: 'text', value: 'Invite member', confidence: 0.6 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.tagName).toBe('SPAN');
  });

  it('finds by css selector', () => {
    document.body.innerHTML = '<header><div></div><div><button>Go</button></div></header>';
    expect(
      matchAnchor({ kind: 'css', value: 'header > div:nth-child(2) > button', confidence: 0.3 }),
    ).toHaveLength(1);
  });

  it('returns nothing rather than throwing on a malformed css selector', () => {
    document.body.innerHTML = '<button>Go</button>';
    expect(matchAnchor({ kind: 'css', value: '>>> not a selector', confidence: 0.3 })).toEqual([]);
  });

  it('skips hidden matches', () => {
    document.body.innerHTML = '<button data-testid="x" style="visibility:hidden">A</button>';
    expect(matchAnchor({ kind: 'testid', value: 'x', confidence: 1 })).toEqual([]);
  });

  it('returns every match when an anchor is ambiguous', () => {
    document.body.innerHTML = '<button>Edit</button><button>Edit</button>';
    expect(matchAnchor({ kind: 'text', value: 'Edit', confidence: 0.6 })).toHaveLength(2);
  });
});
