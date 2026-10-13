/** Small RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF, BOM. Returns rows of strings. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Parses CSV with a header row into objects keyed by lower-cased, trimmed header names. */
export function parseCsvObjects(input: string): Record<string, string>[] {
  const [head, ...rest] = parseCsv(input);
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
