import Dexie from 'dexie';

export const db = new Dexie('AegisDB');
db.version(1).stores({
  access_logs_queue: '++id,plate_number,action,timestamp,details',
});

export default db; 