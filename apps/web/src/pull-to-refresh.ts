import { useEffect, useRef, useState } from 'react';

export const pullRefreshThreshold = 68;
const maximumPull = 96;

export function resistedPullDistance(startY: number, currentY: number) {
  return Math.min(maximumPull, Math.max(0, currentY - startY) * 0.55);
}

export function usePullToRefresh(enabled: boolean, refresh: () => void) {
  const [distance, setDistance] = useState(0);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) { setDistance(0); return; }
    const mobile = matchMedia('(max-width: 700px) and (pointer: coarse)');
    let gesture: { x: number; y: number } | null = null;
    let distance = 0;
    let frame: number | undefined;
    const paint = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => { frame = undefined; setDistance(distance); });
    };
    const cancel = () => {
      gesture = null;
      distance = 0;
      document.removeEventListener('touchmove', move);
      if (frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; }
      setDistance(0);
    };
    const start = (event: TouchEvent) => {
      cancel();
      if (!mobile.matches || scrollY > 0 || event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      // Nested scrollers and interactive controls keep their own gestures.
      if (target?.closest('input, textarea, select, button, a, summary, [role="slider"], [role="tablist"], .maplibregl-map, .table-scroll, .chart-scroll, .search-results')) return;
      const touch = event.touches[0]!;
      gesture = { x: touch.clientX, y: touch.clientY };
      // Ordinary scrolling never keeps a document-wide blocking move listener.
      document.addEventListener('touchmove', move, { passive: false });
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1 || scrollY > 0) { cancel(); return; }
      const touch = event.touches[0]!;
      const vertical = touch.clientY - gesture.y, horizontal = Math.abs(touch.clientX - gesture.x);
      if (vertical <= 0 || horizontal > vertical) { cancel(); return; }
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault();
      distance = resistedPullDistance(gesture.y, touch.clientY);
      paint();
    };
    const finish = () => {
      const shouldRefresh = gesture !== null && distance >= pullRefreshThreshold;
      cancel();
      if (shouldRefresh) refreshRef.current();
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchend', finish, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      cancel();
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', cancel);
    };
  }, [enabled]);

  return { distance, ready: distance >= pullRefreshThreshold };
}
