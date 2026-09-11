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
  clear: () => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error('useGuide must be called inside a <GuideProvider>');
  return ctx;
}

export function GuideProvider({ children, options }: { children: ReactNode; options?: GuideOptions }) {
  const { zIndex = 2147483000, padding = 6, radius = 8, dimOpacity = 0.6 } = options ?? {};
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);

  useEffect(() => {
    const { shadow: s, destroy } = createShadowHost();
    setShadow(s);
    return () => {
      setShadow(null);
      destroy();
    };
  }, []);

  const spotlight = useCallback((el: HTMLElement | null) => setTarget(el), []);
  const clear = useCallback(() => setTarget(null), []);

  const value = useMemo<GuideContextValue>(
    () => ({ target, spotlight, clear }),
    [target, spotlight, clear],
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      {shadow &&
        createPortal(
          <SpotlightOverlay
            target={target}
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
