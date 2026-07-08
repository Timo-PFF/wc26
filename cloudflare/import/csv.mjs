/* Minimal CSV parsing shared by the seed + historical builders. */

import { readFileSync, existsSync } from 'node:fs';

// Parse CSV text into an array of string-arrays. Handles quoted fields, escaped
// "" quotes, CRLF, and a leading UTF-8 BOM (Google exports include one).
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Read a CSV file into objects keyed by the `wanted` column names, resolved from
// the header row by name (case-insensitive). A missing/blank header (e.g. the
// Players tab's hash column) falls back to the declared position, so `wanted` must
// be listed in the sheet's real column order. Returns null if the file is absent.
export function readTable(path, wanted) {
  if (!existsSync(path)) return null;
  const rows = parseCSV(readFileSync(path, 'utf8')).filter((r) => r.some((v) => String(v).trim()));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  wanted.forEach((w, i) => { const j = header.indexOf(w.toLowerCase()); idx[w] = j >= 0 ? j : i; });
  return rows.slice(1).map((r) => {
    const o = {};
    wanted.forEach((w) => { o[w] = r[idx[w]] ?? ''; });
    return o;
  });
}
