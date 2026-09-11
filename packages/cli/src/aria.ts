export interface AriaNode {
  role: string;
  name: string;
  /** Playwright's handle, usable as `page.locator('aria-ref=e12')`. */
  ref: string;
}

/**
 * Roles a user can act on. Anything else is structure, not a target.
 * Unnamed nodes are skipped: without a name the runtime could only find them
 * by css, which is the most brittle anchor, and the labeler would have nothing
 * to go on.
 */
const INTERACTIVE = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
  'slider',
  'spinbutton',
]);

// - role "name" [ref=eN] [cursor=pointer]:
// After a navigation Playwright prefixes refs with the frame, e.g. [ref=f1e26].
const LINE = /^\s*-\s+([a-z]+)\s+"((?:[^"\\]|\\.)*)"(?:\s+\[[^\]]*\])*?\s*\[ref=((?:f\d+)?e\d+)\]/;

/**
 * Parses the YAML-ish text from `page.ariaSnapshot({ mode: 'ai' })`
 * (Playwright ≥ 1.49; `page.accessibility.snapshot()` no longer exists).
 */
export function parseAriaSnapshot(text: string): AriaNode[] {
  const out: AriaNode[] = [];
  for (const raw of text.split('\n')) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const [, role, rawName, ref] = m;
    if (!INTERACTIVE.has(role!)) continue;
    const name = rawName!.replace(/\\(.)/g, '$1').trim();
    if (!name) continue;
    out.push({ role: role!, name, ref: ref! });
  }
  return out;
}
