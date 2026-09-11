import { computeCutout, observeRect, scrollIntoViewIfNeeded, type Rect } from '@pointto/core';
import { useEffect, useState } from 'react';
import { OVERLAY_CSS } from './overlay-styles';

export interface SpotlightOverlayProps {
  target: HTMLElement | null;
  /** Increments on every spotlight request, so re-asking re-scrolls. */
  request: number;
  zIndex: number;
  padding: number;
  radius: number;
  dimOpacity: number;
}

export function SpotlightOverlay({
  target,
  request,
  zIndex,
  padding,
  radius,
  dimOpacity,
}: SpotlightOverlayProps) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    // A target below the fold clamps to a zero-size cutout, so bring it into
    // view before tracking it. observeRect then follows the scroll itself.
    scrollIntoViewIfNeeded(target);
    return observeRect(target, setRect);
    // `request` is deliberately a dependency: re-asking for the element the user
    // is already pointed at must scroll back to it.
  }, [target, request]);

  if (!target || !rect) return <style>{OVERLAY_CSS}</style>;

  const cutout = computeCutout(rect, {
    padding,
    radius,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });

  // A zero-size cutout means we could not place the light. Render nothing
  // rather than dim the screen around an empty rectangle.
  if (cutout.width === 0 || cutout.height === 0) return <style>{OVERLAY_CSS}</style>;

  return (
    <>
      <style>{OVERLAY_CSS}</style>
      <div
        className="cutout"
        data-pointto-cutout=""
        style={{
          left: `${cutout.x}px`,
          top: `${cutout.y}px`,
          width: `${cutout.width}px`,
          height: `${cutout.height}px`,
          borderRadius: `${cutout.radius}px`,
          boxShadow: `0 0 0 9999px rgba(0, 0, 0, ${dimOpacity})`,
          zIndex,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}
