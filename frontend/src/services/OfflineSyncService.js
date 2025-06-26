import db from '../db';
import axios from 'axios';

export async function syncAccessLogsQueue(token) {
  const logs = await db.access_logs_queue.toArray();
  for (const log of logs) {
    try {
      await axios.post('/api/v1/access-logs', log, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await db.access_logs_queue.delete(log.id);
    } catch (err) {
      // If still offline or error, keep in queue
      break;
    }
  }
}

export function startOfflineSync(token) {
  setInterval(() => {
    if (navigator.onLine && token) {
      syncAccessLogsQueue(token);
    }
  }, 10000); // every 10 seconds
} 