import {
  buildSessionUpdate,
  findElementById,
  LexicalIntentResolver,
  resolveElement,
  waitForElement,
  type IntentMatch,
  type IntentResolver,
  type Manifest,
  type ResolveOutcome,
} from 'pointto-core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { GuideWidget, type GuideWidgetProps } from './GuideWidget';
import { createHistoryRouter, type RouterAdapter } from './router';
import { createShadowHost } from './shadow-root';
import { SpotlightOverlay } from './SpotlightOverlay';
import { VoiceSession, type AgentEvent, type VoiceState } from './voice/VoiceSession';

export interface GuideOptions {
  zIndex?: number;
  padding?: number;
  radius?: number;
  dimOpacity?: number;
}

export type GuideResult =
  | { status: 'resolved'; elementId: string; navigated: boolean }
  | { status: 'not-found'; elementId: string; navigated: boolean }
  | { status: 'unknown-id'; elementId: string };

export interface VoiceOptions {
  /** Our token server, e.g. http://localhost:8787/api/voice/token */
  tokenEndpoint: string;
  /** Exact AssemblyAI voice id. Default `lola` (Spanish + English). */
  voice?: string;
  greeting?: string;
  /** Omit for automatic language detection. */
  languageCodes?: string[];
  appName?: string;
}

export type AskResult =
  | { status: 'guided'; match: IntentMatch; result: GuideResult }
  | { status: 'ambiguous'; candidates: IntentMatch[] }
  | { status: 'no-match' };

export interface GuideContextValue {
  manifest: Manifest | undefined;
  target: HTMLElement | null;
  spotlight: (el: HTMLElement | null) => void;
  /**
   * Resolves a manifest element id against the live page and lights it.
   *
   * Returns the outcome rather than throwing: the voice agent calls this as a
   * tool and needs the failure as a value, so it can say "I cannot find that on
   * this screen" out loud instead of claiming success.
   */
  spotlightId: (id: string) => ResolveOutcome;
  /**
   * The full path: navigate to the element's route if we are not on it, wait
   * for it to render, then light it.
   */
  guide: (id: string) => Promise<GuideResult>;
  /** Natural-language request in, guidance out. Text and voice both call this. */
  ask: (query: string) => Promise<AskResult>;
  /** Outcome of the most recent spotlightId / guide call. */
  lastOutcome: ResolveOutcome | null;
  clear: () => void;
  /** Voice is available only when the provider was given `voice` config. */
  voiceEnabled: boolean;
  voiceState: VoiceState;
  /** Opens the microphone. This is the ONLY path that does. */
  startVoice: () => Promise<void>;
  stopVoice: () => void;
  /** Route typed text through the live agent. Returns false if no session is open. */
  sendText: (text: string) => boolean;
  /** Subscribe to agent events (transcripts, state). Returns unsubscribe. */
  onAgentEvent: (fn: (e: AgentEvent) => void) => () => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error('useGuide must be called inside a <GuideProvider>');
  return ctx;
}

/** Two candidates closer than this are a question for the user, not a guess. */
const AMBIGUITY_MARGIN = 0.15;

export function GuideProvider({
  children,
  options,
  manifest,
  router,
  intent,
  widget,
  voice,
}: {
  children: ReactNode;
  options?: GuideOptions;
  manifest?: Manifest;
  router?: RouterAdapter;
  intent?: IntentResolver;
  /** `false` hides the built-in widget; an object configures it. */
  widget?: boolean | GuideWidgetProps;
  /** Enables the mic button. Without it the widget is text-only. */
  voice?: VoiceOptions;
}) {
  const { zIndex = 2147483000, padding = 6, radius = 8, dimOpacity = 0.6 } = options ?? {};
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const [lastOutcome, setLastOutcome] = useState<ResolveOutcome | null>(null);
  // Bumped on every request. The overlay keys its effect on this as well as on
  // the target, so asking for an element you are already pointing at still
  // re-scrolls to it — the user may have wandered off since they last asked.
  const [request, setRequest] = useState(0);

  // Refs so a host passing a fresh object each render does not churn callbacks.
  const routerRef = useRef<RouterAdapter>(router ?? createHistoryRouter());
  const intentRef = useRef<IntentResolver>(intent ?? new LexicalIntentResolver());
  useEffect(() => {
    if (router) routerRef.current = router;
  }, [router]);
  useEffect(() => {
    if (intent) intentRef.current = intent;
  }, [intent]);

  useEffect(() => {
    const { shadow: s, destroy } = createShadowHost();
    setShadow(s);
    return () => {
      setShadow(null);
      destroy();
    };
  }, []);

  const spotlight = useCallback((el: HTMLElement | null) => {
    setTarget(el);
    setRequest((n) => n + 1);
  }, []);

  const clear = useCallback(() => setTarget(null), []);

  const spotlightId = useCallback(
    (id: string): ResolveOutcome => {
      const notFound: ResolveOutcome = { status: 'not-found', tried: [] };
      const entry = manifest ? findElementById(manifest, id) : null;
      const outcome = entry ? resolveElement(entry) : notFound;

      setLastOutcome(outcome);
      // On failure clear rather than leave the previous light burning, so the
      // agent is never narrating one element while another is lit.
      setTarget(outcome.status === 'resolved' ? outcome.element : null);
      setRequest((n) => n + 1);
      return outcome;
    },
    [manifest],
  );

  const guide = useCallback(
    async (id: string): Promise<GuideResult> => {
      const entry = manifest ? findElementById(manifest, id) : null;
      if (!entry || !manifest) return { status: 'unknown-id', elementId: id };

      const route = manifest.routes.find((r) => r.elements.includes(entry));
      const navigated = !!route && route.path !== routerRef.current.currentPath();
      if (navigated && route) routerRef.current.navigate(route.path);

      // After a navigation the target does not exist until the route renders;
      // on the current route a miss is a miss and should read as prompt.
      const outcome = await waitForElement(entry, { timeoutMs: navigated ? 2500 : 300 });
      setLastOutcome(outcome);
      setTarget(outcome.status === 'resolved' ? outcome.element : null);
      setRequest((n) => n + 1);
      return { status: outcome.status, elementId: id, navigated };
    },
    [manifest],
  );

  const ask = useCallback(
    async (query: string): Promise<AskResult> => {
      // Whatever we say next, a light left over from an earlier question must
      // not stay on. The words and the light never disagree.
      setTarget(null);

      if (!manifest) return { status: 'no-match' };
      const matches = await intentRef.current.resolve(query, manifest);
      if (matches.length === 0) return { status: 'no-match' };

      const [best, second] = matches;
      if (second && best!.score - second.score < AMBIGUITY_MARGIN) {
        return { status: 'ambiguous', candidates: matches.slice(0, 3) };
      }
      return { status: 'guided', match: best!, result: await guide(best!.elementId) };
    },
    [manifest, guide],
  );

  // ---- voice ---------------------------------------------------------------
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const sessionRef = useRef<VoiceSession | null>(null);
  const listenersRef = useRef(new Set<(e: AgentEvent) => void>());
  const guideRef = useRef(guide);
  guideRef.current = guide;

  const onAgentEvent = useCallback((fn: (e: AgentEvent) => void) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  /**
   * The agent's tools. Every result is a plain value; errors are thrown with a
   * message specific enough for the model to recover (name what failed and
   * what to ask for next).
   */
  const runTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      if (!manifest) throw new Error('No manifest is loaded, so nothing can be highlighted.');

      if (name === 'highlight') {
        const id = String(args.element_id ?? '');
        const entry = findElementById(manifest, id);
        if (!entry) {
          throw new Error(`No element with id "${id}". Pick an id from the catalog, or ask the user to describe it differently.`);
        }
        const r = await guideRef.current(id);
        if (r.status === 'resolved') {
          return { status: 'highlighted', element_id: id, navigated: r.navigated, purpose: entry.purpose };
        }
        throw new Error(
          `Element "${id}" exists but is not visible on the current screen${
            r.status === 'not-found' && r.navigated ? ' even after navigating' : ''
          }. Tell the user you could not find it right now.`,
        );
      }

      if (name === 'navigate') {
        const path = String(args.path ?? '');
        if (!manifest.routes.some((r) => r.path === path)) {
          throw new Error(`Unknown path "${path}". Use a path from the catalog.`);
        }
        routerRef.current.navigate(path);
        return { ok: true, path };
      }

      if (name === 'get_current_context') {
        const path = routerRef.current.currentPath();
        const route = manifest.routes.find((r) => r.path === path);
        const visible = (route?.elements ?? []).filter((e) => resolveElement(e).status === 'resolved').map((e) => e.id);
        return { path, screen: route?.label ?? null, visible_element_ids: visible };
      }

      throw new Error(`Unknown tool "${name}".`);
    },
    [manifest],
  );

  const stopVoice = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  const startVoice = useCallback(async () => {
    if (!voice || !manifest || sessionRef.current) return;
    const session = new VoiceSession({
      tokenEndpoint: voice.tokenEndpoint,
      sessionUpdate: buildSessionUpdate(manifest, {
        ...(voice.voice ? { voice: voice.voice } : {}),
        ...(voice.greeting ? { greeting: voice.greeting } : {}),
        ...(voice.languageCodes ? { languageCodes: voice.languageCodes } : {}),
        ...(voice.appName ? { appName: voice.appName } : {}),
      }),
      onToolCall: runTool,
      onEvent: (e) => {
        if (e.type === 'state') setVoiceState(e.state as VoiceState);
        for (const fn of listenersRef.current) fn(e);
        if (e.type === 'state' && (e.state === 'ended' || e.state === 'error')) sessionRef.current = null;
      },
    });
    sessionRef.current = session;
    await session.start();
  }, [voice, manifest, runTool]);

  const sendText = useCallback((text: string): boolean => {
    const s = sessionRef.current;
    if (!s || (s.state !== 'listening' && s.state !== 'ready' && s.state !== 'speaking')) return false;
    s.sendText(text);
    return true;
  }, []);

  // End any live session if the provider unmounts.
  useEffect(() => () => sessionRef.current?.stop(), []);

  const value = useMemo<GuideContextValue>(
    () => ({
      manifest,
      target,
      spotlight,
      spotlightId,
      guide,
      ask,
      lastOutcome,
      clear,
      voiceEnabled: !!voice && !!manifest,
      voiceState,
      startVoice,
      stopVoice,
      sendText,
      onAgentEvent,
    }),
    [manifest, target, spotlight, spotlightId, guide, ask, lastOutcome, clear, voice, voiceState, startVoice, stopVoice, sendText, onAgentEvent],
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      {shadow &&
        createPortal(
          <>
            <SpotlightOverlay
              target={target}
              request={request}
              zIndex={zIndex}
              padding={padding}
              radius={radius}
              dimOpacity={dimOpacity}
            />
            {widget !== false && (
              <GuideWidget zIndex={zIndex + 1} {...(typeof widget === 'object' ? widget : {})} />
            )}
          </>,
          shadow,
        )}
    </GuideContext.Provider>
  );
}
