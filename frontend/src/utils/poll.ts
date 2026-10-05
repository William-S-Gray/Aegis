/**
 * Runs `fn` now, then again `ms` after each run settles. Never two at once, so
 * a stalled network cannot pile requests up; when the network changes and the
 * browser aborts them (ERR_NETWORK_CHANGED) there is one failure, not a burst.
 * Skips while the tab is hidden or the browser is offline, and runs at once
 * when either comes back. Returns the stop function for useEffect cleanup.
 */
export function poll(fn: () => unknown, ms: number): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => !document.hidden && navigator.onLine;

  const tick = async () => {
    clearTimeout(timer);
    if (stopped || running) return;
    if (active()) {
      running = true;
      try {
        await fn();
      } catch {
        // Callers handle their own errors; the loop must survive any that escape.
      } finally {
        running = false;
      }
    }
    if (!stopped) timer = setTimeout(tick, ms);
  };
  const wake = () => {
    if (active()) tick();
  };

  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener('online', wake);
    document.removeEventListener('visibilitychange', wake);
  };
}
