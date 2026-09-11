import type { Manifest } from './types';

/** Flat tool schema. NOT OpenAI's nested `{type:"function", function:{…}}`. */
export interface ToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface SessionUpdate {
  type: 'session.update';
  session: {
    system_prompt: string;
    greeting: string;
    input: {
      format: { encoding: 'audio/pcm' };
      keyterms: string[];
      language_codes?: string[];
      turn_detection: {
        vad_threshold: number;
        min_silence: number;
        max_silence: number;
        interrupt_response: boolean;
      };
    };
    output: {
      voice: string;
      format: { encoding: 'audio/pcm' };
    };
    tools: ToolDefinition[];
  };
}

export interface SessionOptions {
  /** Default `lola`: speaks Spanish and English. Must be an exact catalog id. */
  voice?: string;
  greeting?: string;
  /** Omit for automatic detection and mid-sentence code-switching. */
  languageCodes?: string[];
  /** Product name spoken in the prompt. */
  appName?: string;
}

const MAX_KEYTERMS = 60;

function catalog(manifest: Manifest): string {
  const lines: string[] = [];
  for (const route of manifest.routes) {
    lines.push(`Screen "${route.label}" (path ${route.path}):`);
    for (const e of route.elements) {
      const flag = e.destructive ? ' [DESTRUCTIVE — ask the user to confirm before highlighting]' : '';
      const aliases = e.aliases.length ? ` Users may say: ${e.aliases.join('; ')}.` : '';
      lines.push(`  - ${e.id}${flag}: ${e.purpose ?? '(no description)'}.${aliases}`);
    }
  }
  return lines.join('\n');
}

function keyterms(manifest: Manifest): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  };
  for (const route of manifest.routes) {
    push(route.label);
    for (const e of route.elements) {
      for (const a of e.anchors) {
        if (a.kind === 'role-name') push(a.name);
        else if (a.kind === 'text') push(a.value);
      }
    }
  }
  return out.slice(0, MAX_KEYTERMS);
}

/**
 * Turns the manifest into the agent's brain: what exists, what to call, how to
 * behave. Pure, so the exact JSON the socket will carry is unit-testable.
 *
 * Shape verified against live AssemblyAI docs, 2026-09-11.
 */
export function buildSessionUpdate(manifest: Manifest, opts: SessionOptions = {}): SessionUpdate {
  const app = opts.appName ?? 'this application';
  const ids = manifest.routes.flatMap((r) => r.elements.map((e) => e.id));
  const paths = manifest.routes.map((r) => r.path);

  const system_prompt = [
    `You are an in-app guide for ${app}. The user is looking at the app right now and asks where things are or how to do something. You answer by POINTING: you call the highlight tool, which lights up the exact control on their screen, and then you tell them in one or two short sentences what it is.`,
    '',
    'Rules:',
    '- Your FIRST action for any "where is", "how do I", "I want to", or "show me" request is to call highlight with the best matching element_id from the catalog. Do this immediately, before saying anything. highlight navigates to the right screen by itself, so you never need to check where the user is first.',
    '- After highlight succeeds, tell the user in one short sentence what the lit control does, using the purpose it returns. Do not repeat the greeting or ask what they need — they already told you.',
    '- You guide. You NEVER click, submit, or perform actions for the user. If asked to do something for them, say you will show them where and let them do it.',
    '- If highlight reports an error, say plainly that you could not find it. Never claim you have highlighted something when the tool said otherwise.',
    '- If two catalog entries could match, ask a short clarifying question instead of guessing.',
    '- Elements marked DESTRUCTIVE: confirm the user really wants that before highlighting.',
    '- get_current_context is rarely needed: only when the user asks where they are, or after a highlight error. Never call it instead of highlight.',
    '- Keep replies to one or two sentences. Answer in the language the user spoke.',
    '',
    'What exists in the app:',
    catalog(manifest),
  ].join('\n');

  const tools: ToolDefinition[] = [
    {
      type: 'function',
      name: 'highlight',
      description:
        'ALWAYS call this first for any "where is", "how do I", "show me", or "I want to" request. Lights up one control on the user\'s screen and navigates to the right screen automatically. Returns the control\'s purpose so you can describe it in one sentence.',
      parameters: {
        type: 'object',
        properties: {
          element_id: {
            type: 'string',
            description: 'The id of the element from the catalog, e.g. products.create',
            enum: ids,
          },
        },
        required: ['element_id'],
      },
    },
    {
      type: 'function',
      name: 'navigate',
      description: 'Take the user to a screen without highlighting anything. Prefer highlight when there is a specific control.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'A route path from the catalog, e.g. /stores', enum: paths },
        },
        required: ['path'],
      },
    },
    {
      type: 'function',
      name: 'get_current_context',
      description: 'Rarely needed. Only if the user asks where they are, or after a highlight error. Never call this instead of highlight.',
      parameters: { type: 'object', properties: {} },
    },
  ];

  const input: SessionUpdate['session']['input'] = {
    format: { encoding: 'audio/pcm' },
    keyterms: keyterms(manifest),
    turn_detection: {
      vad_threshold: 0.5,
      min_silence: 200,
      max_silence: 1000,
      interrupt_response: true,
    },
  };
  if (opts.languageCodes?.length) input.language_codes = opts.languageCodes;

  return {
    type: 'session.update',
    session: {
      system_prompt,
      greeting: opts.greeting ?? 'Hi! Ask me where anything is and I will point at it.',
      input,
      output: {
        voice: opts.voice ?? 'lola',
        format: { encoding: 'audio/pcm' },
      },
      tools,
    },
  };
}
