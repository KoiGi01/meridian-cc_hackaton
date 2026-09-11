import type { Manifest } from './types';

export interface IntentMatch {
  elementId: string;
  routePath: string;
  /** 0..1-ish. Compare between candidates, do not treat as a probability. */
  score: number;
  /** Which fields contributed: 'alias' | 'purpose' | 'id' | 'route'. */
  matchedOn: string[];
}

/**
 * Maps a natural-language request to manifest element ids, best first.
 * Text mode and voice mode both go through this interface; only the
 * implementation differs. An empty result means "nothing plausible" and the
 * caller must say so rather than pick something.
 */
export interface IntentResolver {
  resolve(query: string, manifest: Manifest): Promise<IntentMatch[]>;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'i', 'me', 'my', 'we', 'you',
  'is', 'are', 'do', 'does', 'can', 'how', 'where', 'what', 'want', 'need', 'please', 'it', 'this',
  'that', 'with', 'at', 'from', 'by', 'up', 'go', 'get', 'find', 'show', 'let',
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

function overlap(query: string[], text: string): number {
  const bag = new Set(tokenize(text));
  return query.filter((t) => bag.has(t)).length;
}

/**
 * Explainable token-overlap scoring. Aliases are what a user would actually
 * say, so they weigh most; purpose is descriptive prose; id and route label
 * are weak hints. Normalised by query length so verbosity is not rewarded.
 */
export class LexicalIntentResolver implements IntentResolver {
  private readonly minScore: number;

  constructor(opts: { minScore?: number } = {}) {
    this.minScore = opts.minScore ?? 0.34;
  }

  async resolve(query: string, manifest: Manifest): Promise<IntentMatch[]> {
    const q = tokenize(query);
    if (q.length === 0) return [];

    const matches: IntentMatch[] = [];

    for (const route of manifest.routes) {
      for (const el of route.elements) {
        const matchedOn: string[] = [];
        let raw = 0;

        const aliasHits = Math.max(0, ...el.aliases.map((a) => overlap(q, a)));
        if (aliasHits > 0) {
          raw += 3 * aliasHits;
          matchedOn.push('alias');
        }

        const purposeHits = el.purpose ? overlap(q, el.purpose) : 0;
        if (purposeHits > 0) {
          raw += 2 * purposeHits;
          matchedOn.push('purpose');
        }

        const idHits = overlap(q, el.id.replace(/[.\-_]/g, ' '));
        if (idHits > 0) {
          raw += idHits;
          matchedOn.push('id');
        }

        const routeHits = overlap(q, route.label);
        if (routeHits > 0) {
          raw += routeHits;
          matchedOn.push('route');
        }

        const score = raw / (3 * q.length);
        if (score >= this.minScore) {
          matches.push({ elementId: el.id, routePath: route.path, score, matchedOn });
        }
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }
}
