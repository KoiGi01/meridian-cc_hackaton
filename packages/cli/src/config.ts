export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type AuthStep =
  | { fill: string; value: string }
  | { click: string }
  | { waitFor: string };

export interface ScanConfig {
  baseUrl: string;
  auth: { loginUrl: string; steps: AuthStep[] } | null;
  routes: Array<{ path: string; label?: string }>;
  output: string;
  /** Milliseconds to wait after network idle, for client-side rendering to finish. */
  settleMs: number;
  llm: { baseUrl: string; model: string; apiKey: string } | null;
}

const GEMINI_COMPAT = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-3.6-flash';

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v) throw new ConfigError(`${what} must be a non-empty string`);
  return v;
}

/** `env:NAME` → process.env.NAME. Secrets never live in the config file. */
function resolveEnv(value: string, env: Record<string, string | undefined>): string {
  if (!value.startsWith('env:')) return value;
  const name = value.slice(4);
  const v = env[name];
  if (v === undefined) throw new ConfigError(`config references env:${name} but ${name} is not set in the environment`);
  return v;
}

function parseStep(v: unknown, env: Record<string, string | undefined>, i: number): AuthStep {
  if (typeof v !== 'object' || v === null) throw new ConfigError(`auth.steps[${i}] must be an object`);
  const s = v as Record<string, unknown>;
  if ('fill' in s) return { fill: str(s.fill, `auth.steps[${i}].fill`), value: resolveEnv(str(s.value, `auth.steps[${i}].value`), env) };
  if ('click' in s) return { click: str(s.click, `auth.steps[${i}].click`) };
  if ('waitFor' in s) return { waitFor: str(s.waitFor, `auth.steps[${i}].waitFor`) };
  throw new ConfigError(`auth.steps[${i}] must be one of {fill,value} | {click} | {waitFor}`);
}

export function parseConfig(input: unknown, env: Record<string, string | undefined>): ScanConfig {
  if (typeof input !== 'object' || input === null) throw new ConfigError('config must be a JSON object');
  const c = input as Record<string, unknown>;

  const baseUrl = str(c.baseUrl, 'baseUrl').replace(/\/+$/, '');
  const output = str(c.output, 'output');

  if (!Array.isArray(c.routes) || c.routes.length === 0) throw new ConfigError('routes must be a non-empty array');
  const routes = c.routes.map((r, i) => {
    const o = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
    const route: { path: string; label?: string } = { path: str(o.path, `routes[${i}].path`) };
    if (typeof o.label === 'string' && o.label) route.label = o.label;
    return route;
  });

  let auth: ScanConfig['auth'] = null;
  if (c.auth !== undefined && c.auth !== null) {
    const a = c.auth as Record<string, unknown>;
    auth = {
      loginUrl: str(a.loginUrl, 'auth.loginUrl'),
      steps: (Array.isArray(a.steps) ? a.steps : []).map((s, i) => parseStep(s, env, i)),
    };
  }

  let llm: ScanConfig['llm'] = null;
  if (c.llm !== undefined && c.llm !== null) {
    const l = c.llm as Record<string, unknown>;
    const apiKey = env.POINTTO_LLM_API_KEY ?? env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ConfigError('llm is configured but neither POINTTO_LLM_API_KEY nor GEMINI_API_KEY is set in the environment');
    }
    llm = {
      baseUrl: (typeof l.baseUrl === 'string' && l.baseUrl ? l.baseUrl : GEMINI_COMPAT).replace(/\/+$/, ''),
      model: typeof l.model === 'string' && l.model ? l.model : DEFAULT_MODEL,
      apiKey,
    };
  }

  return {
    baseUrl,
    auth,
    routes,
    output,
    settleMs: typeof c.settleMs === 'number' ? c.settleMs : 800,
    llm,
  };
}
