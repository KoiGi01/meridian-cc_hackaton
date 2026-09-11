/**
 * Ids are what the developer reads and hand-edits, and what the agent's
 * catalog is keyed by. They must be readable and stable across re-scans.
 */

export function slug(text: string, dropTokens: string[] = []): string {
  let t = text.toLowerCase();
  // Drop phrases first (icon names like "plus-square" contain dashes).
  for (const d of dropTokens) t = t.split(d.toLowerCase()).join(' ');
  return t
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .join('-');
}

export function routeSlug(route: { path: string; label?: string }): string {
  if (route.label) return slug(route.label);
  const s = slug(route.path.replace(/^\/+|\/+$/g, '').replace(/\//g, ' '));
  return s || 'home';
}

const MAX_ID = 60;

export function elementId(routeSlugValue: string, name: string, dropTokens: string[] = []): string {
  const id = `${routeSlugValue}.${slug(name, dropTokens) || 'unnamed'}`;
  return id.length > MAX_ID ? id.slice(0, MAX_ID).replace(/-+$/, '') : id;
}

export function uniqueIds(ids: string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}-${n}`;
  });
}
