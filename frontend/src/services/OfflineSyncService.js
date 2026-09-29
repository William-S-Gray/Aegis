import db from '../db';
import api from '../api';
import { apiMessage } from '../utils/safe';

let syncing = false;

/**
 * Replays one guard's queued decisions, oldest first.
 *
 * Only that guard's entries: the server records the caller as the decision
 * maker, so replaying another guard's queue would falsify the audit trail.
 *
 * A transient failure (offline, 5xx, 401, 429) stops the run so ordering is
 * kept and it retries later. A permanent refusal (e.g. 422) is parked with the
 * server's reason, because stopping on it would block every later entry
 * forever.
 */
export async function syncAccessLogsQueue(userId) {
  if (syncing) return; // one run at a time, or a slow run is sent twice
  syncing = true;
  try {
    const logs = await db.access_logs_queue.where('user_id').equals(userId).sortBy('id');
    for (const log of logs) {
      if (log.failed) continue;
      const { id, user_id: _owner, failed: _failed, ...body } = log;
      try {
        await api.post('/access-logs', body);
        await db.access_logs_queue.delete(id);
      } catch (err) {
        const status = err?.response?.status;
        if (!status || status === 401 || status === 429 || status >= 500) break;
        await db.access_logs_queue.update(id, { failed: apiMessage(err, `HTTP ${status}`) });
      }
    }
  } finally {
    syncing = false;
  }
}

/** Starts periodic sync for one guard. Returns a stop function. */
export function startOfflineSync(userId) {
  const intervalId = setInterval(() => {
    if (navigator.onLine) {
      syncAccessLogsQueue(userId);
    }
  }, 10000);

  return () => clearInterval(intervalId);
}
