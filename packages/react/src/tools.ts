import { findElementById, resolveElement, type Manifest, type ManifestElement } from 'pointto-core';
import type { RouterAdapter } from './router';

export type GuideResult =
  | { status: 'resolved'; elementId: string; navigated: boolean }
  | { status: 'not-found'; elementId: string; navigated: boolean }
  | { status: 'unknown-id'; elementId: string };

export interface ToolDeps {
  manifest: Manifest;
  guide: (id: string) => Promise<GuideResult>;
  router: RouterAdapter;
  /** Resolves when the user clicks the element; rejects with a specific reason otherwise. */
  awaitInteraction: (id: string, timeoutMs: number) => Promise<void>;
  /** Called before `navigate` so the provider can end the current quest. */
  onNavigate?: () => void;
}

export const DEFAULT_AWAIT_MS = 30_000;
export const MAX_AWAIT_MS = 120_000;
const MIN_AWAIT_MS = 1_000;

export interface CurrentContext {
  path: string;
  screen: string | null;
  /** Ids of catalog elements on this screen, this route's first, then the global ones. */
  visibleIds: string[];
}

/** What the agent gets from get_current_context, and what a correction is built from. */
export function currentContext(manifest: Manifest, router: RouterAdapter): CurrentContext {
  const path = router.currentPath();
  const route = manifest.routes.find((r) => r.path === path);
  const global = manifest.routes.find((r) => r.path === '*');
  const candidates: ManifestElement[] = [...(route?.elements ?? []), ...(global?.elements ?? [])];
  return {
    path,
    screen: route?.label ?? null,
    visibleIds: candidates.filter((e) => resolveElement(e).status === 'resolved').map((e) => e.id),
  };
}

/**
 * The agent's client-side tools. Every result is a plain value; errors are
 * thrown with a message specific enough for the model to recover (name what
 * failed and what to do next). The runner owns no state — the provider does.
 */
export function createToolRunner(deps: ToolDeps): (name: string, args: Record<string, unknown>) => Promise<unknown> {
  const { manifest } = deps;

  const lookup = (id: string): ManifestElement => {
    const entry = findElementById(manifest, id);
    if (!entry) {
      throw new Error(`No element with id "${id}". Pick an id from the catalog, or ask the user to describe it differently.`);
    }
    return entry;
  };

  return async (name, args) => {
    if (name === 'highlight') {
      const id = String(args.element_id ?? '');
      const entry = lookup(id);
      // The runtime gate behind the prompt's "ask first" (BUILD-SPEC 6): a
      // model that skips the question still cannot light a destructive control.
      if (entry.destructive && args.confirmed !== true) {
        throw new Error(
          `"${id}" is a destructive action: ${entry.purpose ?? 'no description'}. Ask the user to confirm they really want it; only after they say yes, call highlight again with confirmed: true.`,
        );
      }
      const r = await deps.guide(id);
      if (r.status === 'resolved') {
        return { status: 'highlighted', element_id: id, navigated: r.navigated, purpose: entry.purpose };
      }
      throw new Error(
        `Element "${id}" exists but is not visible on the current screen${
          r.status === 'not-found' && r.navigated ? ' even after navigating' : ''
        }. Tell the user you could not find it right now.`,
      );
    }

    if (name === 'await_interaction') {
      const id = String(args.element_id ?? '');
      lookup(id);
      const asked = Number(args.timeout_ms);
      const timeoutMs = Number.isFinite(asked) && asked > 0 ? Math.min(Math.max(asked, MIN_AWAIT_MS), MAX_AWAIT_MS) : DEFAULT_AWAIT_MS;
      await deps.awaitInteraction(id, timeoutMs);
      return { status: 'clicked', element_id: id };
    }

    if (name === 'navigate') {
      const path = String(args.path ?? '');
      if (!manifest.routes.some((r) => r.path === path)) {
        throw new Error(`Unknown path "${path}". Use a path from the catalog.`);
      }
      deps.onNavigate?.();
      deps.router.navigate(path);
      return { ok: true, path };
    }

    if (name === 'get_current_context') {
      const ctx = currentContext(manifest, deps.router);
      return { path: ctx.path, screen: ctx.screen, visible_element_ids: ctx.visibleIds };
    }

    throw new Error(`Unknown tool "${name}".`);
  };
}
