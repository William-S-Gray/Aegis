import Dexie from 'dexie';
import type { Table } from 'dexie';

/** An access decision recorded while the device was offline. */
export interface QueuedAccessLog {
  id?: number;
  /** The guard who made the decision; only they may replay it. */
  user_id: string;
  /** Sent to the API so a replay can never record the decision twice. */
  client_ref: string;
  plate_number: string;
  action: string;
  timestamp: string;
  details?: unknown;
  /** The server's reason, once it has permanently refused the entry. */
  failed?: string;
}

/**
 * A random UUID. crypto.randomUUID exists only in secure contexts (https or
 * localhost); getRandomValues is available everywhere, so a console served over
 * plain http on a LAN can still record decisions.
 */
export function newClientRef(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class AegisDatabase extends Dexie {
  // Declared so TypeScript knows the table exists; Dexie populates it at runtime.
  access_logs_queue!: Table<QueuedAccessLog, number>;

  constructor() {
    super('AegisDB');
    this.version(1).stores({
      access_logs_queue: '++id,plate_number,action,timestamp,details',
    });
    this.version(2)
      .stores({ access_logs_queue: '++id,user_id' })
      .upgrade((tx) =>
        // Entries queued before this version carry no owner. Replaying them as
        // whoever is signed in would attribute one guard's decisions to
        // another, so they are parked for an administrator instead.
        tx
          .table('access_logs_queue')
          .toCollection()
          .modify((row: QueuedAccessLog) => {
            row.user_id ??= 'unknown';
            row.client_ref ??= newClientRef();
            row.failed ??= 'Queued before per-user attribution; review manually';
          })
      );
  }
}

export const db = new AegisDatabase();

export default db;
