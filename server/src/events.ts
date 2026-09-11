import { appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = resolve(dirname(fileURLToPath(import.meta.url)), '../events.log');

export interface RuntimeEvent {
  sessionId: string;
  type: string;
  elementId?: string;
  anchorKindUsed?: string;
  resolved?: boolean;
  ts: number;
}

function isEvent(v: unknown): v is RuntimeEvent {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as RuntimeEvent).sessionId === 'string' &&
    typeof (v as RuntimeEvent).type === 'string' &&
    typeof (v as RuntimeEvent).ts === 'number'
  );
}

/**
 * Append-only JSON lines. For the hackathon this is the whole analytics
 * pipeline (BUILD-SPEC 5.8): no database, no dashboard. Which anchor kind
 * resolved each element is the number that says how brittle manifests are.
 */
export async function recordEvents(batch: unknown): Promise<number> {
  const items = Array.isArray(batch) ? batch : [batch];
  const valid = items.filter(isEvent);
  if (valid.length === 0) return 0;
  await appendFile(LOG, valid.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return valid.length;
}
