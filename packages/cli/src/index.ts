import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assemble } from './assemble';
import { ConfigError, parseConfig } from './config';
import { OpenAICompatibleLabeler, SkeletonLabeler, type Labeler } from './labeler';
import { scan } from './scan';

const USAGE = `pointto-cli — generate a pointto manifest from a running app

  pointto-cli scan --config <guide.config.json> [--no-llm] [--headed]

  --no-llm   Skip labeling; write a skeleton (purpose: null) to fill in by hand.
  --headed   Show the browser while scanning.

Secrets come from the environment, never the config: GEMINI_API_KEY (or
POINTTO_LLM_API_KEY for another OpenAI-compatible provider), and any env:NAME
values referenced by auth steps.`;

function loadDotEnv(): void {
  // Convenience for local runs: read a .env from cwd or any parent, without a dependency.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    try {
      const text = readFileSync(resolve(dir, '.env'), 'utf8');
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!(k in process.env)) process.env[k] = v;
      }
      return;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  }
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd !== 'scan') {
    console.log(USAGE);
    return cmd ? 1 : 0;
  }

  const flags = new Set(rest.filter((a) => a.startsWith('--') && !a.includes('=')));
  const configIdx = rest.indexOf('--config');
  const configPath = configIdx >= 0 ? rest[configIdx + 1] : undefined;
  if (!configPath) {
    console.error('error: --config <path> is required\n');
    console.log(USAGE);
    return 1;
  }

  loadDotEnv();

  let config;
  try {
    config = parseConfig(JSON.parse(readFileSync(configPath, 'utf8')), process.env);
  } catch (e) {
    console.error(`error: ${e instanceof ConfigError ? e.message : `could not read ${configPath}: ${(e as Error).message}`}`);
    return 1;
  }

  const noLlm = flags.has('--no-llm');
  let labeler: Labeler;
  if (noLlm || !config.llm) {
    labeler = new SkeletonLabeler();
    console.log(noLlm ? 'labeling: skipped (--no-llm)' : 'labeling: skipped (no "llm" block in config)');
  } else {
    labeler = new OpenAICompatibleLabeler(fetch, config.llm);
    console.log(`labeling: ${config.llm.model} via ${config.llm.baseUrl}`);
  }

  const t0 = Date.now();
  const routes = await scan(config, { headed: flags.has('--headed'), log: (m) => console.log(m) });
  const { manifest, unlabeled, labelFailures } = await assemble(routes, labeler, { baseUrl: config.baseUrl, log: (m) => console.log(m) });

  const outPath = resolve(dirname(configPath), config.output);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');

  const total = manifest.routes.reduce((n, r) => n + r.elements.length, 0);
  const withTestId = manifest.routes.flatMap((r) => r.elements).filter((e) => e.anchors.some((a) => a.kind === 'testid')).length;
  console.log('');
  console.log(`wrote ${outPath}`);
  console.log(`  ${manifest.routes.length} routes, ${total} elements, ${withTestId} with data-testid, in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (labelFailures.length) {
    console.log(`  labeling FAILED on ${labelFailures.length} route(s); those have skeleton labels. Re-run to retry:`);
    for (const f of labelFailures) console.log(`    - ${f.path}: ${f.error.slice(0, 100)}`);
  }
  if (unlabeled.length) {
    console.log(`  ${unlabeled.length} element(s) have no purpose — review these by hand:`);
    for (const id of unlabeled.slice(0, 20)) console.log(`    - ${id}`);
    if (unlabeled.length > 20) console.log(`    … and ${unlabeled.length - 20} more`);
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  },
);
