export interface ScannedElement {
  id: string;
  role: string;
  /** Accessible name as the runtime will compute it. */
  name: string;
  /** Visible text, if any. */
  text: string;
}

export interface Label {
  purpose: string | null;
  aliases: string[];
  category: string | null;
}

export interface Labeler {
  label(route: { path: string; label?: string }, elements: ScannedElement[]): Promise<Map<string, Label>>;
}

/** `--no-llm`: a reviewable skeleton the developer fills in by hand. */
export class SkeletonLabeler implements Labeler {
  async label(_route: { path: string }, elements: ScannedElement[]): Promise<Map<string, Label>> {
    return new Map(elements.map((e) => [e.id, { purpose: null, aliases: [], category: null }]));
  }
}

export interface OpenAICompatibleOptions {
  /** e.g. https://generativelanguage.googleapis.com/v1beta/openai */
  baseUrl: string;
  model: string;
  apiKey: string;
}

const SYSTEM = `You label controls in a web application so a voice assistant can point users to them.
For each element you are given its id, role, accessible name, and visible text, plus the screen it is on.
Return ONLY a JSON object: {"labels":[{"id":"...","purpose":"...","aliases":["..."],"category":"..."}]}.
- purpose: one plain sentence saying what happens when the user activates it. If you genuinely cannot infer it from the name and screen, set purpose to null. NEVER invent a purpose.
- aliases: 3 to 6 short phrases a non-technical user might say when looking for this control, in the same language as the app's labels. Empty array if purpose is null.
- category: a short kebab-case grouping such as navigation, product-management, billing. null if unsure.
Include every id you were given, exactly once.`;

/**
 * Works with any provider exposing the OpenAI chat-completions shape: Gemini's
 * compatibility endpoint (the default), Groq, OpenRouter, Ollama. Swapping
 * providers is a config edit, not a code change — free tiers have rate
 * limits, and hitting one two days before the deadline must not need a
 * refactor.
 */
export class OpenAICompatibleLabeler implements Labeler {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly opts: OpenAICompatibleOptions,
    private readonly retry: { attempts: number; delaysMs: number[] } = { attempts: 4, delaysMs: [2000, 5000, 12000] },
  ) {}

  /**
   * Free tiers answer 429 and 503 routinely. Retry those with backoff; give
   * up on anything else immediately, since a bad key or model will not fix
   * itself.
   */
  async label(route: { path: string; label?: string }, elements: ScannedElement[]): Promise<Map<string, Label>> {
    if (elements.length === 0) return new Map();
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.retry.attempts; attempt++) {
      try {
        return await this.labelOnce(route, elements);
      } catch (e) {
        lastErr = e;
        const msg = (e as Error).message;
        const transient = /returned (429|500|502|503|504):/.test(msg);
        if (!transient || attempt === this.retry.attempts - 1) throw e;
        await new Promise((r) => setTimeout(r, this.retry.delaysMs[attempt] ?? 10000));
      }
    }
    throw lastErr;
  }

  private async labelOnce(route: { path: string; label?: string }, elements: ScannedElement[]): Promise<Map<string, Label>> {

    const user = [
      `Screen: ${route.label ?? route.path} (${route.path})`,
      'Elements:',
      ...elements.map((e) => `- id=${e.id} role=${e.role} name=${JSON.stringify(e.name)} text=${JSON.stringify(e.text)}`),
    ].join('\n');

    const res = await this.fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({
        model: this.opts.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
    });

    const raw = await res.text();
    if (!res.ok) throw new Error(`labeler: ${this.opts.baseUrl} returned ${res.status}: ${raw.slice(0, 300)}`);

    let content: string;
    try {
      content = (JSON.parse(raw) as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content;
    } catch {
      throw new Error(`labeler: response was not a chat completion: ${raw.slice(0, 300)}`);
    }

    const parsed = parseJsonLoosely(content) as { labels?: unknown };
    if (!parsed || !Array.isArray(parsed.labels)) {
      throw new Error(`labeler: model did not return {"labels":[...]} json: ${content.slice(0, 300)}`);
    }

    const wanted = new Set(elements.map((e) => e.id));
    const out = new Map<string, Label>();
    for (const l of parsed.labels as Array<Record<string, unknown>>) {
      const id = typeof l.id === 'string' ? l.id : '';
      if (!wanted.has(id)) continue;
      const purpose = typeof l.purpose === 'string' && l.purpose.trim() ? l.purpose.trim() : null;
      out.set(id, {
        purpose,
        aliases: Array.isArray(l.aliases) ? l.aliases.filter((a): a is string => typeof a === 'string' && !!a.trim()) : [],
        category: typeof l.category === 'string' && l.category.trim() ? l.category.trim() : null,
      });
    }
    return out;
  }
}

/** Accepts bare JSON or JSON inside a ```json fence. Throws on anything else. */
function parseJsonLoosely(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1] : text)!.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error(`labeler: could not parse model output as json: ${candidate.slice(0, 200)}`);
  }
}
