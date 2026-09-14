import {
  buildSessionUpdate,
  correctionInstruction,
  correctionText,
  DriftTracker,
  findElementById,
  LexicalIntentResolver,
  resolveElement,
  waitForElement,
  watchGoal,
  type CorrectionContext,
  type GoalWatchEvent,
  type IntentMatch,
  type IntentResolver,
  type Manifest,
  type ManifestElement,
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
import { createToolRunner, currentContext, type GuideResult } from './tools';
import { VoiceSession, type AgentEvent, type VoiceState } from './voice/VoiceSession';

export interface GuideOptions {
  zIndex?: number;
  padding?: number;
  radius?: number;
  dimOpacity?: number;
}

export type { GuideResult } from './tools';

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
  /** The best match is destructive: ask the user, then call `confirmGuide`. */
  | { status: 'needs-confirmation'; match: IntentMatch }
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
  /** The user said yes to a destructive element `ask` held back. */
  confirmGuide: (id: string) => Promise<GuideResult>;
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
  /**
   * Subscribe to agent events (transcripts, state) and to the provider's own
   * `{ type: 'drift', kind: 'reached' | 'drift' | 'lost' | 'relit', ... }`
   * events. A drift/lost event carries `text` (the correction) and `spoken`
   * (true when a live agent said it; false when the widget should show it).
   */
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
  // The manifest element currently lit, so it can be found again if the host
  // re-renders and replaces the DOM node underneath us.
  const litEntryRef = useRef<ManifestElement | null>(null);
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

  // ---- the quest -----------------------------------------------------------
  // What the user asked for outlives the light. `DriftTracker` holds it;
  // `watchGoal` reports what the user did with the lit target; this provider
  // turns those into light (locally, at once) and words (through the agent
  // when a session is open, as text otherwise). (BUILD-SPEC 5.7)
  const trackerRef = useRef(new DriftTracker());
  // Stop function of the live watcher, so the agent's own navigation can
  // disarm it synchronously before the route changes.
  const watchStopRef = useRef<(() => void) | null>(null);
  // Set while a goal is pending (correction spoken, light off): the route is
  // watched and the goal relit the moment the user comes back.
  const [pendingGoal, setPendingGoal] = useState<string | null>(null);
  // One await_interaction at a time.
  const pendingAwaitRef = useRef<{
    id: string;
    resolve: () => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const listenersRef = useRef(new Set<(e: AgentEvent) => void>());
  const sessionRef = useRef<VoiceSession | null>(null);

  const emit = useCallback((e: AgentEvent) => {
    for (const fn of listenersRef.current) fn(e);
  }, []);

  const routeOf = useCallback(
    (entry: ManifestElement): string | null => manifest?.routes.find((r) => r.elements.includes(entry))?.path ?? null,
    [manifest],
  );
  const labelOf = useCallback(
    (path: string | null) => manifest?.routes.find((r) => r.path === path)?.label ?? null,
    [manifest],
  );

  const settleAwait = useCallback((clickedId: string | null, reason?: string) => {
    const p = pendingAwaitRef.current;
    if (!p) return;
    if (clickedId !== null && p.id !== clickedId) return;
    pendingAwaitRef.current = null;
    clearTimeout(p.timer);
    if (clickedId !== null) p.resolve();
    else p.reject(new Error(reason ?? 'The wait was cancelled.'));
  }, []);

  /** Ends the quest and everything waiting on it. The light is the caller's. */
  const abandonQuest = useCallback(
    (reason: string) => {
      trackerRef.current.reset();
      settleAwait(null, reason);
      setPendingGoal(null);
    },
    [settleAwait],
  );

  const light = useCallback((entry: ManifestElement | null, el: HTMLElement | null) => {
    litEntryRef.current = el ? entry : null;
    setTarget(el);
    setRequest((n) => n + 1);
  }, []);

  const spotlight = useCallback(
    (el: HTMLElement | null) => {
      light(null, el); // a raw element has no manifest entry to re-find
    },
    [light],
  );

  const clear = useCallback(() => {
    abandonQuest('The guide was closed.');
    light(null, null);
  }, [abandonQuest, light]);

  const spotlightId = useCallback(
    (id: string): ResolveOutcome => {
      const notFound: ResolveOutcome = { status: 'not-found', tried: [] };
      const entry = manifest ? findElementById(manifest, id) : null;
      const outcome = entry ? resolveElement(entry) : notFound;

      setLastOutcome(outcome);
      // On failure clear rather than leave the previous light burning, so the
      // agent is never narrating one element while another is lit.
      if (outcome.status === 'resolved' && entry) {
        trackerRef.current.lit(id, routeOf(entry) ?? '*', routerRef.current.currentPath());
        light(entry, outcome.element);
      } else {
        light(null, null);
      }
      return outcome;
    },
    [manifest, light, routeOf],
  );

  const guideInternal = useCallback(
    async (id: string, silent = false): Promise<GuideResult> => {
      const entry = manifest ? findElementById(manifest, id) : null;
      if (!entry || !manifest) return { status: 'unknown-id', elementId: id };

      const route = routeOf(entry);
      // Path "*" means the element is on every screen (sidebar, header):
      // never navigate for it.
      const navigated = !!route && route !== '*' && route !== routerRef.current.currentPath();
      if (navigated && route) {
        // Our own navigation must never read as the user wandering: disarm
        // the watcher before the URL changes, not on the next render.
        watchStopRef.current?.();
        watchStopRef.current = null;
        setTarget(null);
        routerRef.current.navigate(route);
      }

      // After a navigation the target does not exist until the route renders;
      // on the current route a miss is a miss and should read as prompt.
      const outcome = await waitForElement(entry, { timeoutMs: navigated ? 2500 : 300 });
      setLastOutcome(outcome);
      if (outcome.status === 'resolved') {
        // A global element lit while the goal is pending elsewhere is the
        // agent showing the way back: the quest, and its correction count,
        // survive. Anything else is a new quest.
        trackerRef.current.lit(id, route ?? '*', routerRef.current.currentPath());
        setPendingGoal(null);
        light(entry, outcome.element);
        if (silent) emit({ type: 'drift', kind: 'relit', elementId: id });
      } else {
        if (silent) trackerRef.current.reset(); // came back, but it is not there: let it go quietly
        light(null, null);
      }
      return { status: outcome.status, elementId: id, navigated };
    },
    [manifest, routeOf, light, emit],
  );

  const guide = useCallback((id: string) => guideInternal(id), [guideInternal]);
  const confirmGuide = guide;
  const guideRef = useRef(guideInternal);
  guideRef.current = guideInternal;

  const ask = useCallback(
    async (query: string): Promise<AskResult> => {
      // Whatever we say next, a light left over from an earlier question must
      // not stay on. The words and the light never disagree. And a new
      // question is a new quest: the correction count starts over.
      abandonQuest('The user asked a new question.');
      light(null, null);

      if (!manifest) return { status: 'no-match' };
      const matches = await intentRef.current.resolve(query, manifest);
      if (matches.length === 0) return { status: 'no-match' };

      const [best, second] = matches;
      if (second && best!.score - second.score < AMBIGUITY_MARGIN) {
        return { status: 'ambiguous', candidates: matches.slice(0, 3) };
      }
      // Destructive elements need a yes first (BUILD-SPEC 6). The widget asks;
      // confirmGuide is the yes.
      if (findElementById(manifest, best!.elementId)?.destructive) {
        return { status: 'needs-confirmation', match: best! };
      }
      return { status: 'guided', match: best!, result: await guideInternal(best!.elementId) };
    },
    [manifest, guideInternal, abandonQuest, light],
  );

  const sessionLive = () => {
    const s = sessionRef.current;
    return !!s && (s.state === 'listening' || s.state === 'ready' || s.state === 'speaking');
  };

  // What the watcher reports, turned into light and words. In a ref so the
  // watcher effect below does not have to re-arm on every render.
  const onWatchRef = useRef<(e: GoalWatchEvent) => void>(() => {});
  onWatchRef.current = (e) => {
    if (e.kind === 'replaced') {
      setTarget(e.element);
      return;
    }
    const entry = litEntryRef.current;
    light(null, null);
    if (!entry || !manifest) return;
    const tracker = trackerRef.current;

    if (e.kind === 'reached') {
      const r = tracker.reached(entry.id);
      settleAwait(entry.id);
      emit({ type: 'drift', kind: 'reached', elementId: entry.id });
      // The way back was taken: the goal is pending again; the route watch
      // relights it as soon as the user lands on its screen.
      if (r === 'waypoint-done') setPendingGoal(tracker.quest?.goalId ?? null);
      return;
    }

    // drift or lost
    const goalId = tracker.quest?.goalId ?? entry.id;
    const goalEntry = findElementById(manifest, goalId) ?? entry;
    const d = tracker.left();
    if (!d) return; // a raw spotlight: nothing was promised, nothing to say
    settleAwait(
      null,
      e.kind === 'drift'
        ? `The user went to ${e.path} instead of clicking "${entry.id}".`
        : `"${entry.id}" disappeared from the screen before the user clicked it.`,
    );
    const now = currentContext(manifest, routerRef.current);
    const goalPath = routeOf(goalEntry) ?? '*';
    const ctx: CorrectionContext = {
      kind: e.kind,
      attempt: d.attempt,
      goal: { id: goalId, purpose: goalEntry.purpose, screen: labelOf(goalPath), path: goalPath },
      now: { path: now.path, screen: now.screen, visibleIds: now.visibleIds },
    };
    // Local feedback was immediate (the light is already off). Only the
    // sentence goes through the model, and only when there is one to speak.
    const spoken = sessionLive();
    if (spoken) sessionRef.current!.say(correctionInstruction(ctx));
    emit({
      type: 'drift',
      kind: e.kind,
      elementId: goalId,
      attempt: d.attempt,
      final: d.final,
      text: correctionText(ctx),
      spoken,
    });
    setPendingGoal(d.final ? null : goalId);
  };

  // While something is lit, watch what the user does with it.
  useEffect(() => {
    if (!target) return;
    const entry = litEntryRef.current;
    const stop = watchGoal({
      target,
      entry,
      goalPath: entry ? routeOf(entry) : null,
      currentPath: () => routerRef.current.currentPath(),
      ignoreWithin: shadow?.host ?? null,
      onEvent: (e) => onWatchRef.current(e),
    });
    watchStopRef.current = stop;
    return () => {
      stop();
      if (watchStopRef.current === stop) watchStopRef.current = null;
    };
  }, [target, request, shadow, routeOf]);

  // While a goal is pending, watch the route and relight it silently when the
  // user comes back — "adapt silently and re-spotlight from the new state".
  useEffect(() => {
    if (!pendingGoal) return;
    let done = false;
    const check = () => {
      if (done) return;
      const tracker = trackerRef.current;
      if (!tracker.quest) {
        done = true;
        setPendingGoal(null);
        return;
      }
      if (tracker.routeChanged(routerRef.current.currentPath())) {
        done = true;
        void guideRef.current(pendingGoal, true);
      }
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', check);
    return () => {
      done = true;
      mo.disconnect();
      window.removeEventListener('popstate', check);
    };
  }, [pendingGoal]);

  // ---- voice ---------------------------------------------------------------
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');

  const onAgentEvent = useCallback((fn: (e: AgentEvent) => void) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const awaitInteraction = useCallback(
    (id: string, timeoutMs: number) => {
      settleAwait(null, 'Superseded by a new await_interaction.');
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingAwaitRef.current = null;
          reject(new Error(`The user has not clicked "${id}" after ${timeoutMs} ms.`));
        }, timeoutMs);
        pendingAwaitRef.current = { id, resolve, reject, timer };
      });
    },
    [settleAwait],
  );

  const runTool = useMemo(
    () =>
      manifest
        ? createToolRunner({
            manifest,
            guide: (id) => guideRef.current(id),
            router: routerRef.current,
            awaitInteraction,
            // The agent moving the user on purpose is not the user wandering.
            onNavigate: () => {
              abandonQuest('The agent navigated somewhere else.');
              watchStopRef.current?.();
              watchStopRef.current = null;
              light(null, null);
            },
          })
        : async () => {
            throw new Error('No manifest is loaded, so nothing can be highlighted.');
          },
    [manifest, awaitInteraction, abandonQuest, light],
  );

  const stopVoice = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    settleAwait(null, 'The voice session ended.');
  }, [settleAwait]);

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
        emit(e);
        if (e.type === 'state' && (e.state === 'ended' || e.state === 'error')) sessionRef.current = null;
      },
    });
    sessionRef.current = session;
    await session.start();
  }, [voice, manifest, runTool, emit]);

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
      confirmGuide,
      lastOutcome,
      clear,
      voiceEnabled: !!voice && !!manifest,
      voiceState,
      startVoice,
      stopVoice,
      sendText,
      onAgentEvent,
    }),
    [manifest, target, spotlight, spotlightId, guide, ask, confirmGuide, lastOutcome, clear, voice, voiceState, startVoice, stopVoice, sendText, onAgentEvent],
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
