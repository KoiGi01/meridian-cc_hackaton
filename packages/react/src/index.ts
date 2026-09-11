export { GuideProvider, useGuide } from './GuideProvider';
export type { GuideOptions, GuideContextValue } from './GuideProvider';

// Re-exported so a consumer only ever installs and imports `pointto`.
// pointto-core is an implementation detail: it exists so the resolver can stay
// framework-free for a future Vue adapter, not so users have to know about it.
export { parseManifest, ManifestError } from 'pointto-core';
export type {
  Manifest,
  ManifestRoute,
  ManifestElement,
  ManifestFlow,
  Anchor,
  AnchorKind,
  ResolveOutcome,
} from 'pointto-core';
