import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportCSV, formatDate } from '../utils/exporters';

const columns = [
  { key: 'plate_number', label: 'Plate' },
  { key: 'owner', label: 'Owner' },
];

let lastBlobText = '';

beforeEach(() => {
  lastBlobText = '';
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

async function captureCsv(rows: Record<string, unknown>[]) {
  let captured: Blob | undefined;
  (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mockImplementation((blob: Blob) => {
    captured = blob;
    return 'blob:mock';
  });
  exportCSV(rows, 'out.csv', columns);
  lastBlobText = captured === undefined ? '' : await (captured as Blob).text();
  return lastBlobText;
}

describe('exportCSV', () => {
  it('escapes commas and quotes so columns do not shift', async () => {
    const csv = await captureCsv([{ plate_number: 'ABC,123', owner: 'He said "hi"' }]);
    expect(csv).toContain('"ABC,123"');
    expect(csv).toContain('"He said ""hi"""');
  });

  it('neutralises spreadsheet formula injection', async () => {
    const csv = await captureCsv([{ plate_number: '=cmd|calc', owner: '+1' }]);
    // A leading apostrophe forces Excel to treat the cell as text.
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain("'+1");
    expect(csv).not.toMatch(/(^|,)=cmd/m);
  });

  it('writes nothing for an empty dataset', async () => {
    const csv = await captureCsv([]);
    expect(csv).toBe('');
  });
});

describe('formatDate', () => {
  it('returns an empty string for an unparseable value', () => {
    expect(formatDate('not-a-date')).toBe('');
    expect(formatDate(undefined)).toBe('');
  });

  it('formats a valid ISO timestamp', () => {
    expect(formatDate('2024-01-15T10:30:00Z', 'date')).not.toBe('');
  });
});
