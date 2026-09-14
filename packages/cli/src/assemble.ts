import { parseManifest, type Anchor, type Manifest, type ManifestElement } from 'pointto-core';
import { elementId, routeSlug, uniqueIds } from './ids';
import type { Label, Labeler, ScannedElement } from './labeler';
import type { ScannedRoute } from './scan';

export interface AssembleResult {
  manifest: Manifest;
  /** Ids the labeler left with a null purpose — for the summary. */
  unlabeled: string[];
  /** Routes where labeling failed outright and skeleton labels were used. */
  labelFailures: Array<{ path: string; error: string }>;
}

/**
 * Anchor cascade in durability order (BUILD-SPEC 5.2). A testid anchor is
 * emitted only when the element actually has one: most real apps do not.
 */
function anchorsFor(el: ScannedRoute['elements'][number]): Anchor[] {
  const out: Anchor[] = [];
  if (el.testid) out.push({ kind: 'testid', value: el.testid, confidence: 1 });
  if (el.runtimeName) out.push({ kind: 'role-name', role: el.role, name: el.runtimeName, confidence: 0.8 });
  if (el.text && el.text.length <= 80) out.push({ kind: 'text', value: el.text, confidence: 0.6 });
  if (el.css) out.push({ kind: 'css', value: el.css, confidence: 0.3 });
  return out;
}

/**
 * Names that mean the action loses something: data, or the session. These
 * get `destructive: true`, which makes the runtime ask before pointing
 * (BUILD-SPEC 6). Word-bounded so "Deleted orders" (a filter) is not flagged.
 */
export function isDestructive(name: string): boolean {
  return /\b(delete|remove|destroy|erase|log ?out|sign ?out|eliminar|borrar|cerrar sesi[oó]n)\b/i.test(name);
}

export async function assemble(
  routes: ScannedRoute[],
  labeler: Labeler,
  opts: { baseUrl: string; log?: (m: string) => void },
): Promise<AssembleResult> {
  const log = opts.log ?? (() => {});
  const unlabeled: string[] = [];
  const labelFailures: AssembleResult['labelFailures'] = [];
  const allIds: string[] = [];

  // Elements that appear identically on every route (sidebar, header) are
  // hoisted into one shared route, path "*". Otherwise a 7-route app yields
  // 7 copies of each nav link, and guiding to one would navigate away from
  // the user's screen to light a link that was already in front of them.
  const key = (e: ScannedRoute['elements'][number]) => `${e.role}|${e.runtimeName}|${e.css}`;
  const shared = new Set<string>();
  if (routes.length > 1) {
    const first = routes[0]!;
    for (const e of first.elements) {
      const k = key(e);
      if (routes.every((r) => r.elements.some((x) => key(x) === k))) shared.add(k);
    }
  }
  const sharedRoute: ScannedRoute = {
    path: '*',
    label: 'Everywhere',
    elements: routes[0]!.elements.filter((e) => shared.has(key(e))),
    skipped: 0,
  };
  routes = [
    ...(sharedRoute.elements.length ? [sharedRoute] : []),
    ...routes.map((r) => ({ ...r, elements: r.elements.filter((e) => !shared.has(key(e))) })),
  ];
  if (sharedRoute.elements.length) log(`hoisted ${sharedRoute.elements.length} elements shared by every route`);

  // Ids first, globally unique across routes.
  const perRoute = routes.map((r) => {
    const rs = r.path === '*' ? 'app' : routeSlug(r);
    // Pure numbers and symbols are pagination and ellipses: noise in the
    // agent's catalog, and nothing a user would ask for by name.
    const usable = r.elements.filter((e) => {
      const name = e.runtimeName || e.text;
      return name && !/^[\d\s\p{P}\p{S}]+$/u.test(name);
    });
    return { r, rs, usable, ids: usable.map((e) => elementId(rs, e.runtimeName || e.text, e.iconTokens)) };
  });
  const flat = uniqueIds(perRoute.flatMap((p) => p.ids));
  let cursor = 0;
  for (const p of perRoute) {
    p.ids = flat.slice(cursor, cursor + p.ids.length);
    cursor += p.ids.length;
    allIds.push(...p.ids);
  }

  const manifestRoutes: Manifest['routes'] = [];
  for (const p of perRoute) {
    const scanned: ScannedElement[] = p.usable.map((e, i) => ({
      id: p.ids[i]!,
      role: e.role,
      name: e.runtimeName || e.text,
      text: e.text,
    }));

    log(`labeling ${p.r.path} (${scanned.length} elements)`);
    let labels: Map<string, Label>;
    try {
      labels = await labeler.label(p.r, scanned);
    } catch (e) {
      // One flaky route must not lose the whole scan. Skeleton labels here;
      // the developer re-runs or fills these in by hand.
      const error = (e as Error).message.split('\n')[0]!;
      labelFailures.push({ path: p.r.path, error });
      log(`  ! labeling failed for ${p.r.path}, writing skeleton labels: ${error.slice(0, 120)}`);
      labels = new Map();
    }

    const elements: ManifestElement[] = p.usable.map((e, i) => {
      const id = p.ids[i]!;
      const l = labels.get(id) ?? { purpose: null, aliases: [], category: null };
      if (!l.purpose) unlabeled.push(id);
      return {
        id,
        purpose: l.purpose,
        aliases: l.aliases,
        ...(l.category ? { category: l.category } : {}),
        anchors: anchorsFor(e),
        destructive: isDestructive(e.runtimeName || e.text),
      };
    });

    manifestRoutes.push({ path: p.r.path, label: p.r.label ?? routeSlug(p.r), elements });
  }

  const manifest = parseManifest({
    version: 1,
    generatedAt: new Date().toISOString(),
    baseUrl: opts.baseUrl,
    routes: manifestRoutes,
  });

  return { manifest, unlabeled, labelFailures };
}
