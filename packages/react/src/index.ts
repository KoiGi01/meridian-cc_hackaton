export { GuideProvider, useGuide } from './GuideProvider';
export type { GuideOptions, GuideContextValue, GuideResult, AskResult } from './GuideProvider';
export { GuideWidget } from './GuideWidget';
export type { GuideWidgetProps } from './GuideWidget';
export { createHistoryRouter } from './router';
export type { RouterAdapter } from './router';

// Re-exported so a consumer only ever installs and imports `pointto`.
// pointto-core is an implementation detail: it exists so the resolver can stay
// framework-free for a future Vue adapter, not so users have to know about it.
export { parseManifest, ManifestError, LexicalIntentResolver } from 'pointto-core';
export type {
  Manifest,
  ManifestRoute,
  ManifestElement,
  ManifestFlow,
  Anchor,
  AnchorKind,
  ResolveOutcome,
  IntentMatch,
  IntentResolver,
} from 'pointto-core';
export { VoiceSession } from './voice/VoiceSession';
export type { VoiceSessionOptions, VoiceState, AgentEvent } from './voice/VoiceSession';
export { buildSessionUpdate } from 'pointto-core';
export type { SessionUpdate, SessionOptions } from 'pointto-core';
