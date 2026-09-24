// Small dependency-free download helpers for exporting real generated evidence.

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function toCsv(
  rows: Array<Record<string, unknown>>,
  columns: string[],
): string {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = rows.map((row) =>
    columns.map((column) => escape(row[column])).join(','),
  );
  return [columns.join(','), ...lines].join('\n');
}

export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, `${JSON.stringify(data, null, 2)}\n`, 'application/json');
}

export function downloadCsv(
  filename: string,
  rows: Array<Record<string, unknown>>,
  columns: string[],
): void {
  downloadText(filename, `${toCsv(rows, columns)}\n`, 'text/csv;charset=utf-8');
}
