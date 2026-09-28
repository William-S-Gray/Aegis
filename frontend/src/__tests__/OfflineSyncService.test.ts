import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rows, table, post } = vi.hoisted(() => {
  const rows: Record<string, unknown>[] = [];
  const table = {
    where: vi.fn(() => ({
      equals: (userId: string) => ({
        sortBy: async () => rows.filter((row) => row.user_id === userId),
      }),
    })),
    delete: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
  };
  return { rows, table, post: vi.fn() };
});

vi.mock('../db', () => ({ default: { access_logs_queue: table } }));
vi.mock('../api', () => ({ default: { post } }));

import { syncAccessLogsQueue } from '../services/OfflineSyncService';

const entry = (id: number, user_id = 'guard-a', extra = {}) => ({
  id,
  user_id,
  client_ref: `ref-${id}`,
  plate_number: `P${id}`,
  action: 'approve',
  timestamp: '2026-09-28T10:00:00Z',
  ...extra,
});

beforeEach(() => {
  rows.length = 0;
  vi.clearAllMocks();
});

describe('offline sync', () => {
  it('a permanently rejected entry is parked and does not block the rest', async () => {
    rows.push(entry(1), entry(2));
    post
      .mockRejectedValueOnce({ response: { status: 422, data: { detail: 'timestamp is too old' } } })
      .mockResolvedValueOnce({});

    await syncAccessLogsQueue('guard-a');

    expect(table.update).toHaveBeenCalledWith(1, { failed: 'timestamp is too old' });
    expect(table.delete).toHaveBeenCalledWith(2);
  });

  it('a transient failure stops the run and keeps the entry', async () => {
    rows.push(entry(1), entry(2));
    post.mockRejectedValueOnce({ response: { status: 503 } });

    await syncAccessLogsQueue('guard-a');

    expect(post).toHaveBeenCalledTimes(1);
    expect(table.delete).not.toHaveBeenCalled();
    expect(table.update).not.toHaveBeenCalled();
  });

  it("never replays another guard's decisions", async () => {
    rows.push(entry(1, 'guard-a'), entry(2, 'guard-b'));
    post.mockResolvedValue({});

    await syncAccessLogsQueue('guard-b');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].plate_number).toBe('P2');
  });

  it('sends the idempotency key but not local bookkeeping', async () => {
    rows.push(entry(1));
    post.mockResolvedValue({});

    await syncAccessLogsQueue('guard-a');

    const body = post.mock.calls[0][1];
    expect(body.client_ref).toBe('ref-1');
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('user_id');
  });

  it('skips entries already parked', async () => {
    rows.push(entry(1, 'guard-a', { failed: 'bad' }));

    await syncAccessLogsQueue('guard-a');

    expect(post).not.toHaveBeenCalled();
  });
});
