import {
  findElementById,
  resolveElement,
  type Manifest,
  type ResolveOutcome,
} from '@pointto/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { createShadowHost } from './shadow-root';
import { SpotlightOverlay } from './SpotlightOverlay';

export interface GuideOptions {
  zIndex?: number;
  padding?: number;
  radius?: number;
  dimOpacity?: number;
}

export interface GuideContextValue {
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
  /** Outcome of the most recent spotlightId call. */
  lastOutcome: ResolveOutcome | null;
  clear: () => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error('useGuide must be called inside a <GuideProvider>');
  return ctx;
}

export function GuideProvider({
  children,
  options,
  manifest,
}: {
  children: ReactNode;
  options?: GuideOptions;
  manifest?: Manifest;
}) {
  const { zIndex = 2147483000, padding = 6, radius = 8, dimOpacity = 0.6 } = options ?? {};
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const [lastOutcome, setLastOutcome] = useState<ResolveOutcome | null>(null);
  // Bumped on every request. The overlay keys its effect on this as well as on
  // the target, so asking for an element you are already pointing at still
  // re-scrolls to it — the user may have wandered off since they last asked.
  const [request, setRequest] = useState(0);

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

  const value = useMemo<GuideContextValue>(
    () => ({ target, spotlight, spotlightId, lastOutcome, clear }),
    [target, spotlight, spotlightId, lastOutcome, clear],
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      {shadow &&
        createPortal(
          <SpotlightOverlay
            target={target}
            request={request}
            zIndex={zIndex}
            padding={padding}
            radius={radius}
            dimOpacity={dimOpacity}
          />,
          shadow,
        )}
    </GuideContext.Provider>
  );
}
