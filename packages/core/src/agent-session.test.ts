import { describe, expect, it } from 'vitest';
import { buildSessionUpdate } from './agent-session';
import type { Manifest } from './types';

const manifest: Manifest = {
  version: 1,
  generatedAt: '2026-09-11T00:00:00Z',
  baseUrl: 'http://localhost',
  routes: [
    {
      path: '/products',
      label: 'Products',
      elements: [
        {
          id: 'products.create',
          purpose: 'Opens the form for adding a new product',
          aliases: ['add a product', 'new product'],
          anchors: [
            { kind: 'role-name', role: 'button', name: 'Add new product', confidence: 0.8 },
            { kind: 'text', value: 'Add new product', confidence: 0.4 },
          ],
          destructive: false,
        },
      ],
    },
    {
      path: '/stores',
      label: 'Stores',
      elements: [
        {
          id: 'stores.create',
          purpose: 'Opens the form for adding a new store',
          aliases: ['add a store'],
          anchors: [{ kind: 'role-name', role: 'button', name: 'Add new store', confidence: 0.8 }],
          destructive: false,
        },
        {
          id: 'stores.delete',
          purpose: 'Deletes the store permanently',
          aliases: ['remove store'],
          anchors: [{ kind: 'text', value: 'Delete', confidence: 0.4 }],
          destructive: true,
        },
      ],
    },
  ],
};

describe('buildSessionUpdate', () => {
  const s = buildSessionUpdate(manifest);

  it('is a session.update event', () => {
    expect(s.type).toBe('session.update');
  });

  it('uses the flat tool schema, not the nested OpenAI form', () => {
    for (const t of s.session.tools) {
      expect(t.type).toBe('function');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('parameters.type', 'object');
      expect(t).not.toHaveProperty('function');
    }
  });

  it('constrains highlight to the ids that actually exist', () => {
    const highlight = s.session.tools.find((t) => t.name === 'highlight')!;
    const ids = (highlight.parameters.properties as Record<string, { enum?: string[] }>).element_id!.enum;
    expect(ids).toEqual(['products.create', 'stores.create', 'stores.delete']);
  });

  it('constrains navigate to the routes that actually exist', () => {
    const nav = s.session.tools.find((t) => t.name === 'navigate')!;
    const paths = (nav.parameters.properties as Record<string, { enum?: string[] }>).path!.enum;
    expect(paths).toEqual(['/products', '/stores']);
  });

  it('exposes get_current_context with no parameters', () => {
    const ctx = s.session.tools.find((t) => t.name === 'get_current_context')!;
    expect(ctx.parameters.properties).toEqual({});
  });

  it('feeds element labels and route names to the transcriber as keyterms, deduplicated', () => {
    const k = s.session.input.keyterms;
    expect(k).toContain('Add new product');
    expect(k).toContain('Stores');
    expect(new Set(k).size).toBe(k.length);
  });

  it('puts every element id and purpose in the system prompt', () => {
    for (const r of manifest.routes) {
      for (const e of r.elements) {
        expect(s.session.system_prompt).toContain(e.id);
        expect(s.session.system_prompt).toContain(e.purpose!);
      }
    }
  });

  it('tells the agent it guides and never clicks', () => {
    expect(s.session.system_prompt).toMatch(/never (click|perform)/i);
  });

  it('flags destructive elements so the agent asks for confirmation', () => {
    expect(s.session.system_prompt).toMatch(/stores\.delete[^\n]*DESTRUCTIVE/);
  });

  it('exposes await_interaction, constrained to real ids, for multi-step guidance only', () => {
    const t = s.session.tools.find((t) => t.name === 'await_interaction')!;
    const props = t.parameters.properties as Record<string, { enum?: string[]; type?: string }>;
    expect(props.element_id!.enum).toEqual(['products.create', 'stores.create', 'stores.delete']);
    expect(props.timeout_ms!.type).toBe('integer');
    expect(t.parameters.required).toEqual(['element_id']);
    expect(t.description).toMatch(/multi-step/i);
  });

  it('lets highlight carry an optional confirmed flag for destructive elements', () => {
    const highlight = s.session.tools.find((t) => t.name === 'highlight')!;
    const props = highlight.parameters.properties as Record<string, { type?: string }>;
    expect(props.confirmed!.type).toBe('boolean');
    expect(highlight.parameters.required).toEqual(['element_id']);
    expect(s.session.system_prompt).toContain('confirmed: true');
  });

  it('prepares the agent for drift corrections: one sentence, no scolding, no navigating', () => {
    expect(s.session.system_prompt).toMatch(/wandered/i);
    expect(s.session.system_prompt).toMatch(/never navigate/i);
  });

  it('defaults to an English-native voice', () => {
    expect(s.session.output.voice).toBe('anna');
  });

  it('leaves language detection automatic unless told otherwise', () => {
    expect(s.session.input).not.toHaveProperty('language_codes');
    const pinned = buildSessionUpdate(manifest, { languageCodes: ['es'] });
    expect(pinned.session.input.language_codes).toEqual(['es']);
  });

  it('sends pcm audio in and out', () => {
    expect(s.session.input.format).toEqual({ encoding: 'audio/pcm' });
    expect(s.session.output.format).toEqual({ encoding: 'audio/pcm' });
  });
});
