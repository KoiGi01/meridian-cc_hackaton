import type { Anchor, Manifest, ManifestElement, ManifestFlow, ManifestRoute } from './types';

export class ManifestError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ManifestError';
  }
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ManifestError('expected an object', path);
  }
  return v as Record<string, unknown>;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new ManifestError('expected a non-empty string', path);
  }
  return v;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ManifestError('expected an array', path);
  return v;
}

function parseAnchor(v: unknown, path: string): Anchor {
  const a = obj(v, path);
  const confidence = typeof a.confidence === 'number' ? a.confidence : 0.5;
  switch (a.kind) {
    case 'testid':
      return { kind: 'testid', value: str(a.value, `${path}.value`), confidence };
    case 'role-name':
      return {
        kind: 'role-name',
        role: str(a.role, `${path}.role`),
        name: str(a.name, `${path}.name`),
        confidence,
      };
    case 'text':
      return { kind: 'text', value: str(a.value, `${path}.value`), confidence };
    case 'css':
      return { kind: 'css', value: str(a.value, `${path}.value`), confidence };
    default:
      throw new ManifestError(`unknown anchor kind ${JSON.stringify(a.kind)}`, `${path}.kind`);
  }
}

function parseElement(v: unknown, path: string): ManifestElement {
  const e = obj(v, path);
  const anchors = arr(e.anchors, `${path}.anchors`).map((a, i) => parseAnchor(a, `${path}.anchors[${i}]`));
  if (anchors.length === 0) {
    throw new ManifestError('element has no anchors, so it could never be resolved', `${path}.anchors`);
  }
  return {
    id: str(e.id, `${path}.id`),
    purpose: e.purpose === null || e.purpose === undefined ? null : str(e.purpose, `${path}.purpose`),
    aliases:
      e.aliases === undefined
        ? []
        : arr(e.aliases, `${path}.aliases`).map((a, i) => str(a, `${path}.aliases[${i}]`)),
    ...(e.category === undefined ? {} : { category: str(e.category, `${path}.category`) }),
    anchors,
    ...(e.requires === undefined
      ? {}
      : { requires: arr(e.requires, `${path}.requires`).map((r, i) => str(r, `${path}.requires[${i}]`)) }),
    destructive: e.destructive === true,
  };
}

function parseRoute(v: unknown, path: string): ManifestRoute {
  const r = obj(v, path);
  return {
    path: str(r.path, `${path}.path`),
    label: str(r.label, `${path}.label`),
    elements: arr(r.elements, `${path}.elements`).map((e, i) => parseElement(e, `${path}.elements[${i}]`)),
  };
}

export function parseManifest(input: unknown): Manifest {
  const m = obj(input, '$');
  if (m.version !== 1) {
    throw new ManifestError(`unsupported version ${String(m.version)}, expected 1`, '$.version');
  }

  const routes = arr(m.routes, 'routes').map((r, i) => parseRoute(r, `routes[${i}]`));

  const seen = new Set<string>();
  for (const [ri, route] of routes.entries()) {
    for (const [ei, el] of route.elements.entries()) {
      if (seen.has(el.id)) {
        throw new ManifestError(
          `duplicate element id ${JSON.stringify(el.id)}`,
          `routes[${ri}].elements[${ei}].id`,
        );
      }
      seen.add(el.id);
    }
  }

  let flows: ManifestFlow[] | undefined;
  if (m.flows !== undefined) {
    flows = arr(m.flows, 'flows').map((f, i) => {
      const flow = obj(f, `flows[${i}]`);
      const steps = arr(flow.steps, `flows[${i}].steps`).map((s, si) => str(s, `flows[${i}].steps[${si}]`));
      for (const [si, step] of steps.entries()) {
        if (!seen.has(step)) {
          throw new ManifestError(
            `flow step references unknown element id ${step}`,
            `flows[${i}].steps[${si}]`,
          );
        }
      }
      return {
        id: str(flow.id, `flows[${i}].id`),
        intent: str(flow.intent, `flows[${i}].intent`),
        steps,
      };
    });
  }

  return {
    version: 1,
    generatedAt: str(m.generatedAt, 'generatedAt'),
    baseUrl: str(m.baseUrl, 'baseUrl'),
    routes,
    ...(flows === undefined ? {} : { flows }),
  };
}
