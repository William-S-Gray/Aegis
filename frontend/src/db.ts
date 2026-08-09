import Dexie from 'dexie';
import type { Table } from 'dexie';

/** An access decision recorded while the device was offline. */
export interface QueuedAccessLog {
  id?: number;
  plate_number: string;
  action: string;
  timestamp: string;
  details?: unknown;
}

class AegisDatabase extends Dexie {
  // Declared so TypeScript knows the table exists; Dexie populates it at runtime.
  access_logs_queue!: Table<QueuedAccessLog, number>;

  constructor() {
    super('AegisDB');
    this.version(1).stores({
      access_logs_queue: '++id,plate_number,action,timestamp,details',
    });
  }
}

export const db = new AegisDatabase();

export default db;
