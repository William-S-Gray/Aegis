/*
 * exceljs and jspdf together are ~1.3 MB. They are only needed when a user
 * clicks an export button, so they are imported dynamically to keep them out
 * of the initial bundle.
 */

export interface ExportColumn {
  key: string;
  label: string;
}

export type CellFormatter = (row: Record<string, unknown>, column: ExportColumn) => string;

const defaultFormatter: CellFormatter = (row, column) => {
  const value = row[column.key];
  return value === null || value === undefined ? '' : String(value);
};

export function formatDate(date: unknown, format?: string): string {
  const d = new Date(date as string);
  if (Number.isNaN(d.getTime())) return '';
  if (format === 'date') return d.toLocaleDateString();
  if (format === 'time') return d.toLocaleTimeString();
  return d.toLocaleString();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

/**
 * Neutralises spreadsheet formula injection. A cell beginning with =, +, -, @
 * or a control character is executed as a formula by Excel and Google Sheets,
 * which turns exported plate/owner text into an attack vector.
 */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvEscape(value: string): string {
  const safe = neutralizeFormula(value);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function exportCSV(
  data: Record<string, unknown>[],
  filename: string,
  columns: ExportColumn[],
  format: CellFormatter = defaultFormatter
) {
  if (!data.length) return;
  const header = columns.map(c => csvEscape(c.label)).join(',');
  const rows = data.map(row => columns.map(c => csvEscape(format(row, c))).join(','));
  // Prepend a BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(['﻿' + [header, ...rows].join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  downloadBlob(blob, filename);
}

export async function exportExcel(
  data: Record<string, unknown>[],
  filename: string,
  columns: ExportColumn[],
  sheetName = 'Export',
  format: CellFormatter = defaultFormatter
) {
  if (!data.length) return;
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map(c => ({ header: c.label, key: c.key, width: 20 }));
  data.forEach(row => {
    const record: Record<string, string> = {};
    columns.forEach(c => {
      record[c.key] = neutralizeFormula(format(row, c));
    });
    sheet.addRow(record);
  });
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename
  );
}

export async function exportPDF(
  data: Record<string, unknown>[],
  filename: string,
  columns: ExportColumn[],
  format: CellFormatter = defaultFormatter
) {
  if (!data.length) return;
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF();
  // jspdf-autotable v5 is a standalone function rather than a prototype patch.
  autoTable(doc, {
    head: [columns.map(c => c.label)],
    body: data.map(row => columns.map(c => format(row, c))),
  });
  doc.save(filename);
}
