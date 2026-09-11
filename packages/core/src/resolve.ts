import { matchAnchor } from './anchors';
import type { AnchorKind, Manifest, ManifestElement } from './types';

export type ResolveOutcome =
  | {
      status: 'resolved';
      element: HTMLElement;
      /** Which anchor kind won. Telemetry: this is how we learn what decays. */
      anchorKind: AnchorKind;
      /** Position in the anchor list. 0 means the most durable anchor still works. */
      anchorIndex: number;
      /** True when the winning anchor matched more than one element. */
      ambiguous: boolean;
    }
  | { status: 'not-found'; tried: AnchorKind[] };

function distanceFromViewportCentre(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const dx = r.x + r.width / 2 - window.innerWidth / 2;
  const dy = r.y + r.height / 2 - window.innerHeight / 2;
  return Math.hypot(dx, dy);
}

/**
 * Walks the anchor cascade and returns the first anchor that finds the element.
 *
 * Anchors are ordered most-durable-first in the manifest, so falling through is
 * the mechanism that survives a host app renaming a button. A unique match at
 * any level wins immediately; an ambiguous match is only used once every
 * remaining anchor has been tried, and is flagged so the caller can report it.
 *
 * Never returns a best guess. No match is `not-found`, because a wrong
 * highlight is worse than an admitted failure. (BUILD-SPEC 5.3)
 */
export function resolveElement(element: ManifestElement, root: ParentNode = document): ResolveOutcome {
  const tried: AnchorKind[] = [];
  let fallback: { element: HTMLElement; kind: AnchorKind; index: number } | null = null;

  for (const [index, anchor] of element.anchors.entries()) {
    tried.push(anchor.kind);
    const hits = matchAnchor(anchor, root);

    if (hits.length === 1) {
      return {
        status: 'resolved',
        element: hits[0]!,
        anchorKind: anchor.kind,
        anchorIndex: index,
        ambiguous: false,
      };
    }

    if (hits.length > 1 && !fallback) {
      // Keep the best candidate, but prefer a unique match from a weaker anchor.
      const nearest = [...hits].sort(
        (a, b) => distanceFromViewportCentre(a) - distanceFromViewportCentre(b),
      )[0]!;
      fallback = { element: nearest, kind: anchor.kind, index };
    }
  }

  if (fallback) {
    return {
      status: 'resolved',
      element: fallback.element,
      anchorKind: fallback.kind,
      anchorIndex: fallback.index,
      ambiguous: true,
    };
  }

  return { status: 'not-found', tried };
}

export function findElementById(manifest: Manifest, id: string): ManifestElement | null {
  for (const route of manifest.routes) {
    for (const element of route.elements) {
      if (element.id === id) return element;
    }
  }
  return null;
}
