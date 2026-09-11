import type { Anchor } from './types';
import { isVisible } from './visibility';

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Implicit ARIA roles for the handful of tags a manifest actually anchors to. */
const IMPLICIT_ROLE: Record<string, string> = {
  BUTTON: 'button',
  A: 'link',
  INPUT: 'textbox',
  TEXTAREA: 'textbox',
  SELECT: 'combobox',
  SUMMARY: 'button',
};

function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.toLowerCase();
  return IMPLICIT_ROLE[el.tagName] ?? null;
}

/**
 * Approximates the accessible name the scanner recorded from Playwright's
 * accessibility tree. Full accname computation is far larger than this; these
 * three sources cover what real dashboards actually use.
 */
function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label) return label;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) return text;
  }

  return el.textContent ?? '';
}

/**
 * Escapes a value for use inside a double-quoted attribute selector. Not
 * CSS.escape: that escapes identifiers, this is a quoted string, and CSS.escape
 * is missing in some non-browser DOM implementations we run tests under.
 */
function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function queryAll(root: ParentNode, selector: string): HTMLElement[] {
  try {
    return [...root.querySelectorAll<HTMLElement>(selector)];
  } catch {
    // A malformed selector in a manifest must not take the whole widget down.
    return [];
  }
}

/**
 * Every currently visible element matching a single anchor, in document order.
 * Returning all matches rather than the first is deliberate: the caller needs to
 * know when an anchor is ambiguous.
 */
export function matchAnchor(anchor: Anchor, root: ParentNode = document): HTMLElement[] {
  let candidates: HTMLElement[];

  switch (anchor.kind) {
    case 'testid':
      candidates = queryAll(root, `[data-testid="${escapeAttributeValue(anchor.value)}"]`);
      break;

    case 'role-name': {
      const want = normalize(anchor.name);
      candidates = queryAll(root, '*').filter(
        (el) => roleOf(el) === anchor.role.toLowerCase() && normalize(accessibleName(el)) === want,
      );
      break;
    }

    case 'text': {
      const want = normalize(anchor.value);
      candidates = queryAll(root, '*').filter((el) => {
        if (normalize(el.textContent ?? '') !== want) return false;
        // Prefer the innermost element carrying the text, not its wrappers.
        return ![...el.children].some((child) => normalize(child.textContent ?? '') === want);
      });
      break;
    }

    case 'css':
      candidates = queryAll(root, anchor.value);
      break;
  }

  return candidates.filter(isVisible);
}
