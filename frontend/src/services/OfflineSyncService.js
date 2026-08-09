import db from '../db';
import api from '../api';

/**
 * Drains the offline queue of access logs. Stops on the first failure so
 * ordering is preserved and entries are never dropped silently.
 */
export async function syncAccessLogsQueue() {
  const logs = await db.access_logs_queue.toArray();
  for (const log of logs) {
    try {
      // The shared client attaches the bearer token, so no manual header here.
      await api.post('/access-logs', log);
      await db.access_logs_queue.delete(log.id);
    } catch (err) {
      // Still offline or the server rejected it: keep the queue intact.
      break;
    }
  }
}

/**
 * Starts periodic sync. Returns a stop function — the previous implementation
 * leaked its interval because it never exposed one.
 */
export function startOfflineSync() {
  const intervalId = setInterval(() => {
    if (navigator.onLine) {
      syncAccessLogsQueue();
    }
  }, 10000);

  return () => clearInterval(intervalId);
}
