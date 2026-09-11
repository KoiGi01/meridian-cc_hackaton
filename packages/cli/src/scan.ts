import { chromium, type Page } from 'playwright';
import { parseAriaSnapshot, type AriaNode } from './aria';
import type { ScanConfig } from './config';

export interface ScannedAnchors {
  testid: string | null;
  /** Accessible name as the RUNTIME resolver computes it: aria-label, aria-labelledby, else text. */
  runtimeName: string;
  /** Visible trimmed text. */
  text: string;
  /** A structural selector, the last resort. */
  css: string;
  /** Icon-ish tokens present in the a11y name but not in the text (antd leaks these). */
  iconTokens: string[];
}

export interface ScannedRoute {
  path: string;
  label?: string;
  elements: Array<AriaNode & ScannedAnchors>;
  skipped: number;
}

export interface ScanProgress {
  (message: string): void;
}

/**
 * Runs in the page, once per element. Mirrors pointto-core's accessibleName()
 * so the anchors we write are the ones the runtime will actually match.
 */
function collect(el: Element): Omit<ScannedAnchors, 'iconTokens'> {
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
  const label = el.getAttribute('aria-label');
  const labelledBy = el.getAttribute('aria-labelledby');
  let runtimeName = '';
  if (label) runtimeName = label;
  else if (labelledBy) {
    runtimeName = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '')
      .join(' ');
  }
  if (!norm(runtimeName) && !norm(el.textContent) && el.getAttribute('placeholder')) {
    runtimeName = el.getAttribute('placeholder') || '';
  }
  if (!norm(runtimeName)) runtimeName = el.textContent || '';
  runtimeName = norm(runtimeName);

  const text = norm(el.textContent);

  // A structural path: tag + nth-of-type up to the nearest usable id or body.
  const parts: string[] = [];
  let n: Element | null = el;
  while (n && n.nodeType === 1 && n !== document.body) {
    if (n.id && !/^[0-9]/.test(n.id) && !/[:.]/.test(n.id)) {
      parts.unshift('#' + CSS.escape(n.id));
      break;
    }
    let sel = n.tagName.toLowerCase();
    const parent: Element | null = n.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === n!.tagName);
      if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
    }
    parts.unshift(sel);
    n = parent;
  }
  return { testid: el.getAttribute('data-testid'), runtimeName, text, css: parts.join(' > ') };
}

async function runAuth(page: Page, config: ScanConfig, log: ScanProgress): Promise<void> {
  if (!config.auth) return;
  log(`auth: ${config.auth.loginUrl}`);
  await page.goto(config.baseUrl + config.auth.loginUrl, { waitUntil: 'networkidle' });
  for (const step of config.auth.steps) {
    if ('fill' in step) await page.fill(step.fill, step.value);
    else if ('click' in step) await page.click(step.click);
    else await page.waitForSelector(step.waitFor);
  }
}

async function scanRoute(
  page: Page,
  config: ScanConfig,
  route: ScanConfig['routes'][number],
  log: ScanProgress,
): Promise<ScannedRoute> {
  log(`route: ${route.path}`);
  await page.goto(config.baseUrl + route.path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(config.settleMs);

  const snapshot = await page.ariaSnapshot({ mode: 'ai' });
  const nodes = parseAriaSnapshot(snapshot);
  if (process.env.POINTTO_DEBUG) {
    log(`  [debug] url=${page.url()} snapshot=${snapshot.length} chars, ${snapshot.split('\n').length} lines, ${nodes.length} interactive`);
  }

  const elements: ScannedRoute['elements'] = [];
  let skipped = 0;
  for (const node of nodes) {
    try {
      const loc = page.locator(`aria-ref=${node.ref}`);
      const info = await loc.evaluate(collect);
      // Tokens in the a11y name that the runtime name lacks are icon leaks.
      const rt = new Set(info.runtimeName.toLowerCase().split(/\s+/));
      const iconTokens = node.name
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t && !rt.has(t));
      elements.push({ ...node, ...info, iconTokens });
    } catch (e) {
      skipped++;
      if (process.env.POINTTO_DEBUG && skipped === 1) log(`  [debug] first skip (${node.role} "${node.name}"): ${(e as Error).message.split('\n')[0]}`);
    }
  }
  log(`  ${elements.length} interactive elements${skipped ? `, ${skipped} skipped` : ''}`);
  return { path: route.path, ...(route.label ? { label: route.label } : {}), elements, skipped };
}

export async function scan(config: ScanConfig, opts: { headed?: boolean; log?: ScanProgress } = {}): Promise<ScannedRoute[]> {
  const log = opts.log ?? (() => {});
  const browser = await chromium.launch({ headless: !opts.headed });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await runAuth(page, config, log);
    const out: ScannedRoute[] = [];
    for (const route of config.routes) out.push(await scanRoute(page, config, route, log));
    return out;
  } finally {
    await browser.close();
  }
}
