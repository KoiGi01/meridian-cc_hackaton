import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleLabeler, SkeletonLabeler, type ScannedElement } from './labeler';

const elements: ScannedElement[] = [
  { id: 'products.add-new-product', role: 'button', name: 'Add new product', text: 'Add new product' },
  { id: 'products.products', role: 'link', name: 'Products', text: 'Products' },
];
const route = { path: '/products', label: 'Products' };

function fakeFetch(content: string, status = 200) {
  return vi.fn(async () => ({
    ok: status < 300,
    status,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  })) as unknown as typeof fetch;
}

describe('SkeletonLabeler', () => {
  it('returns null purposes and empty aliases, never inventing', async () => {
    const out = await new SkeletonLabeler().label(route, elements);
    expect(out.get('products.add-new-product')).toEqual({ purpose: null, aliases: [], category: null });
  });
});

describe('OpenAICompatibleLabeler', () => {
  const opts = { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', apiKey: 'k' };

  it('posts a chat completion with the key as a Bearer and strict json requested', async () => {
    const f = fakeFetch('{"labels":[]}');
    await new OpenAICompatibleLabeler(f, opts).label(route, elements);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${opts.baseUrl}/chat/completions`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gemini-2.5-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages.at(-1).content).toContain('products.add-new-product');
  });

  it('maps returned labels onto element ids', async () => {
    const f = fakeFetch(
      JSON.stringify({
        labels: [
          {
            id: 'products.add-new-product',
            purpose: 'Opens the form to add a product',
            aliases: ['add a product', 'new item'],
            category: 'product-management',
          },
        ],
      }),
    );
    const out = await new OpenAICompatibleLabeler(f, opts).label(route, elements);
    expect(out.get('products.add-new-product')).toEqual({
      purpose: 'Opens the form to add a product',
      aliases: ['add a product', 'new item'],
      category: 'product-management',
    });
  });

  it('keeps a null purpose when the model abstains', async () => {
    const f = fakeFetch(JSON.stringify({ labels: [{ id: 'products.products', purpose: null, aliases: [] }] }));
    const out = await new OpenAICompatibleLabeler(f, opts).label(route, elements);
    expect(out.get('products.products')!.purpose).toBeNull();
  });

  it('tolerates a fenced json reply', async () => {
    const f = fakeFetch('```json\n{"labels":[{"id":"products.products","purpose":"Go to products","aliases":[]}]}\n```');
    const out = await new OpenAICompatibleLabeler(f, opts).label(route, elements);
    expect(out.get('products.products')!.purpose).toBe('Go to products');
  });

  it('ignores labels for ids it did not ask about', async () => {
    const f = fakeFetch(JSON.stringify({ labels: [{ id: 'nope', purpose: 'x', aliases: [] }] }));
    const out = await new OpenAICompatibleLabeler(f, opts).label(route, elements);
    expect(out.has('nope')).toBe(false);
  });

  it('retries a 503 and succeeds on the next attempt', async () => {
    let calls = 0;
    const f = vi.fn(async () => {
      calls++;
      const ok = calls > 1;
      return {
        ok,
        status: ok ? 200 : 503,
        text: async () => (ok ? JSON.stringify({ choices: [{ message: { content: '{"labels":[]}' } }] }) : 'overloaded'),
      };
    }) as unknown as typeof fetch;
    const l = new OpenAICompatibleLabeler(f, opts, { attempts: 3, delaysMs: [0, 0] });
    await l.label(route, elements);
    expect(calls).toBe(2);
  });

  it('does not retry a 401: a bad key will not fix itself', async () => {
    const f = fakeFetch('', 401);
    const l = new OpenAICompatibleLabeler(f, opts, { attempts: 3, delaysMs: [0, 0] });
    await expect(l.label(route, elements)).rejects.toThrow(/401/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('fails loudly on a non-2xx, naming the status', async () => {
    const l = new OpenAICompatibleLabeler(fakeFetch('', 429), opts, { attempts: 2, delaysMs: [0] });
    await expect(l.label(route, elements)).rejects.toThrow(/429/);
  });

  it('fails loudly on unparseable output rather than silently dropping labels', async () => {
    await expect(new OpenAICompatibleLabeler(fakeFetch('not json at all'), opts).label(route, elements)).rejects.toThrow(
      /json/i,
    );
  });
});
