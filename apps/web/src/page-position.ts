/** Reloads (including PWA updates) start at the top, not an old forecast anchor. */
export function initializePagePosition() {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation?.type !== 'reload') return;
  history.scrollRestoration = 'manual';
  if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  // Browser restoration can run after the entry module, when the document is shown.
  window.addEventListener('pageshow', () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, { once: true });
}
