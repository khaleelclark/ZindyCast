import { useEffect, useRef, useState } from 'react';

export const pullRefreshThreshold = 68;
const maximumPull = 96;

export function resistedPullDistance(startY: number, currentY: number) {
  return Math.min(maximumPull, Math.max(0, currentY - startY) * 0.55);
}

export function usePullToRefresh(enabled: boolean, refresh: () => void) {
  const [distance, setDistance] = useState(0);
  const distanceRef = useRef(0);
  const gesture = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) { distanceRef.current = 0; setDistance(0); return; }
    const mobile = matchMedia('(max-width: 700px) and (pointer: coarse)');
    const start = (event: TouchEvent) => {
      if (!mobile.matches || scrollY > 0 || event.touches.length !== 1) return;
      const target = event.target as Element | null;
      if (target?.closest('input, textarea, select, [role="slider"], .maplibregl-map')) return;
      const touch = event.touches[0]!;
      gesture.current = { x: touch.clientX, y: touch.clientY, active: true };
    };
    const move = (event: TouchEvent) => {
      const tracked = gesture.current;
      if (!tracked?.active || event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      const vertical = touch.clientY - tracked.y, horizontal = Math.abs(touch.clientX - tracked.x);
      if (vertical <= 0 || horizontal > vertical) { gesture.current = null; distanceRef.current = 0; setDistance(0); return; }
      if (scrollY > 0) { gesture.current = null; distanceRef.current = 0; setDistance(0); return; }
      event.preventDefault();
      const next = resistedPullDistance(tracked.y, touch.clientY);
      distanceRef.current = next; setDistance(next);
    };
    const finish = () => {
      if (!gesture.current) return;
      const shouldRefresh = distanceRef.current >= pullRefreshThreshold;
      gesture.current = null; distanceRef.current = 0; setDistance(0);
      if (shouldRefresh) refreshRef.current();
    };
    const cancel = () => { gesture.current = null; distanceRef.current = 0; setDistance(0); };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', finish, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', cancel);
    };
  }, [enabled]);

  return { distance, ready: distance >= pullRefreshThreshold };
}
