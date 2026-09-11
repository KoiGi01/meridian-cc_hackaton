import { computeCutout, observeRect, type Rect } from '@pointto/core';
import { useEffect, useState } from 'react';
import { OVERLAY_CSS } from './overlay-styles';

export interface SpotlightOverlayProps {
  target: HTMLElement | null;
  zIndex: number;
  padding: number;
  radius: number;
  dimOpacity: number;
}

export function SpotlightOverlay({ target, zIndex, padding, radius, dimOpacity }: SpotlightOverlayProps) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    return observeRect(target, setRect);
  }, [target]);

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
