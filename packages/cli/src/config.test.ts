import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from './config';

const minimal = {
  baseUrl: 'http://localhost:5190',
  routes: [{ path: '/products', label: 'Products' }],
  output: './src/pointto.manifest.json',
};

describe('parseConfig', () => {
  it('accepts a minimal config and fills defaults', () => {
    const c = parseConfig(minimal, {});
    expect(c.baseUrl).toBe('http://localhost:5190');
    expect(c.routes[0]).toEqual({ path: '/products', label: 'Products' });
    expect(c.settleMs).toBe(800);
    expect(c.llm).toBeNull();
  });

  it('resolves env: values from the environment, never from the file', () => {
    const c = parseConfig(
      {
        ...minimal,
        auth: { type: 'form', loginUrl: '/login', steps: [{ fill: 'input[name=password]', value: 'env:DEMO_PASSWORD' }] },
      },
      { DEMO_PASSWORD: 's3cret' },
    );
    expect(c.auth!.steps[0]).toEqual({ fill: 'input[name=password]', value: 's3cret' });
  });

  it('fails clearly when an env: value is missing', () => {
    expect(() =>
      parseConfig(
        { ...minimal, auth: { type: 'form', loginUrl: '/login', steps: [{ fill: 'x', value: 'env:NOPE' }] } },
        {},
      ),
    ).toThrow(/NOPE/);
  });

  it('defaults the llm block to Gemini via the OpenAI-compatible endpoint', () => {
    const c = parseConfig({ ...minimal, llm: {} }, { GEMINI_API_KEY: 'g' });
    expect(c.llm).toMatchObject({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.6-flash',
      apiKey: 'g',
    });
  });

  it('accepts any OpenAI-compatible provider by baseUrl', () => {
    const c = parseConfig(
      { ...minimal, llm: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' } },
      { POINTTO_LLM_API_KEY: 'k' },
    );
    expect(c.llm).toMatchObject({ baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', apiKey: 'k' });
  });

  it('rejects an llm block with no key in the environment', () => {
    expect(() => parseConfig({ ...minimal, llm: {} }, {})).toThrow(/GEMINI_API_KEY|POINTTO_LLM_API_KEY/);
  });

  it('rejects a route without a path', () => {
    expect(() => parseConfig({ ...minimal, routes: [{ label: 'x' }] }, {})).toThrow(ConfigError);
  });

  it('rejects a missing output path', () => {
    const { output: _o, ...noOutput } = minimal;
    expect(() => parseConfig(noOutput, {})).toThrow(/output/);
  });
});
