// generator-pain001.js: SEPA pain.001 Generátor (slovenské banky) core logic.
//
// Pure, deterministic, 100% client-side: turns a list of payments (pasted
// from Excel as TSV, or a CSV/TSV file read locally) plus a payer IBAN into
// a pain.001.001.03 XML batch payment file (hromadný príkaz na úhradu).
// Works identically in Node (tests.mjs) and in the browser: no DOMParser, no
// npm dependency, no network request of any kind.
//
// Field order and "must be" values below follow the same source used by the
// sibling diagnostic tool, so a file this module builds is checked by
// exactly the rules that will flag it:
//
//  - Element order and mandatory/optional status of every GrpHdr/PmtInf/
//    CdtTrfTxInf field: Tatra banka, "Prenosový formát pain.001.001.03 v
//    štruktúre XML" (C:\Users\User\Downloads\prenosovy_formatpain001.pdf,
//    read in full, sections 1.1 GroupHeader and 1.2 PaymentInformation) —
//    in particular the field ORDER used here (PmtId, then Amt, then
//    CdtrAgt, then Cdtr, then CdtrAcct, then RmtInf inside CdtTrfTxInf; and
//    PmtInfId, PmtMtd, PmtTpInf/SvcLvl, ReqdExctnDt, Dbtr, DbtrAcct,
//    DbtrAgt, ChrgBr inside PmtInf) reproduces that document's own field
//    table order exactly.
//  - Fixed values PmtMtd=TRF, SvcLvl/Cd=SEPA, ChrgBr=SLEV, currency EUR,
//    and the "posledných 10 miest čísla IBAN musí vyhovovať algoritmu
//    modulo11" / BIC-from-IBAN derivation rule: same Tatra banka document.
//  - Per-bank BIC table (Tatra banka TATRSKBX, SLSP GIBASKBX, VÚB SUBASKBX,
//    ČSOB CEKOSKBX) and the ČSOB diacritics/character-set restriction:
//    ./doctor-pain001.js (this repo's sibling tool, itself sourced from
//    each bank's own published import documentation — see that file's own
//    header for the primary citations) and ./llms-full.txt.
//  - VS/ŠS/KS packed into EndToEndId as "/VS.../SS.../KS..." in that exact
//    order: National Bank of Slovakia convention, as documented (with
//    worked wrong-order examples) in ČSOB's SEPA guide; see
//    ./doctor-pain001.js for the same convention used to *check* it.
//  - Base schema: ISO 20022 pain.001.001.03
//    (urn:iso:std:iso:20022:tech:xsd:pain.001.001.03, https://www.iso20022.org/).
//
// This module only ever builds a string from the data it is given. It does
// not itself verify the result against any bank's rules — that is what
// doctor-pain001.js (copied unchanged into this repo) is for, and the page
// runs it automatically on every generated file.
//
// Works as an ES module (import { parseRows, mapColumns, buildXml,
// bicFromIban } from './generator-pain001.js') and, when loaded with
// <script type="module">, also publishes window.SepaGenerator = {
// parseRows, mapColumns, buildXml, bicFromIban } for console/debug use.

// ───────────────────────────── small helpers ─────────────────────────────

function safeStr(v) {
  return typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v));
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ───────────────────────────── IBAN helpers ───────────────────────────────
// Same MOD-97 / length-table approach as doctor-pain001.js's checkIban(),
// kept independent here so this module has zero cross-file dependency.

const IBAN_LENGTH_BY_COUNTRY = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GI: 23, GL: 18, GR: 27,
  HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21,
  MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19,
  SK: 24, SM: 27, VA: 22,
};

export function normalizeIban(raw) {
  return safeStr(raw).replace(/\s+/g, '').toUpperCase();
}

function ibanMod97(numericStr) {
  let rem = 0;
  for (let k = 0; k < numericStr.length; k++) {
    rem = (rem * 10 + (numericStr.charCodeAt(k) - 48)) % 97;
  }
  return rem;
}

function ibanNumericString(iban) {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let out = '';
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') out += ch;
    else out += String(ch.charCodeAt(0) - 55); // A=10 .. Z=35
  }
  return out;
}

/** @returns {{valid:boolean, country:string, lengthOk:boolean, checksumOk:boolean, formatOk:boolean}} */
export function checkIban(rawIban) {
  const iban = normalizeIban(rawIban);
  const result = { valid: false, country: '', lengthOk: false, checksumOk: false, formatOk: false };
  if (!iban) return result;
  const m = iban.match(/^([A-Z]{2})(\d{2})([A-Z0-9]+)$/);
  if (!m) return result;
  result.formatOk = true;
  result.country = m[1];
  const expectedLen = IBAN_LENGTH_BY_COUNTRY[result.country];
  result.lengthOk = expectedLen ? iban.length === expectedLen : (iban.length >= 15 && iban.length <= 34);
  try {
    result.checksumOk = ibanMod97(ibanNumericString(iban)) === 1;
  } catch (e) {
    result.checksumOk = false;
  }
  result.valid = result.formatOk && result.lengthOk && result.checksumOk;
  return result;
}

// ─────────────────────────────── BIC helpers ───────────────────────────────
// Slovak domestic bank code (first 4 digits of the BBAN, i.e. IBAN chars
// 5-8) → BIC. Covers the four target banks plus every other Slovak bank
// code documented in doctor-pain001.js's own reference material.

const SK_BANK_CODE_TO_BIC = {
  '1100': 'TATRSKBX', // Tatra banka
  '0900': 'GIBASKBX', // Slovenská sporiteľňa
  '0200': 'SUBASKBX', // VÚB
  '7500': 'CEKOSKBX', // ČSOB
  '8330': 'FIOZSKBA', // Fio banka
  '0720': 'NBSBSKBX', // Národná banka Slovenska
  '5600': 'KOMASK2X', // Prima banka
  '6500': 'POBNSKBA', // 365.bank / Poštová banka
  '8130': 'CITISKBA', // Citibank Europe
  '1111': 'UNCRSKBX', // UniCredit Bank Czech Republic and Slovakia
  '3100': 'LUBASKBX', // ING Bank
  '8180': 'SPSRSKBA', // Fio (Sberbank legacy code, kept for older exports)
  '8120': 'BSLOSK22', // Across Private Investments (ex Bank of China)
};

/**
 * Derives a BIC from a Slovak IBAN's embedded bank code. Returns null for a
 * non-Slovak IBAN or an unrecognized bank code (the UI shows a manual field
 * in that case, per the spec).
 */
export function bicFromIban(rawIban) {
  const iban = normalizeIban(rawIban);
  if (!/^SK\d{22}$/.test(iban)) return null;
  const bankCode = iban.slice(4, 8);
  return SK_BANK_CODE_TO_BIC[bankCode] || null;
}

// ─────────────────────── diacritics / SEPA character set ──────────────────
// Same table as doctor-pain001.js, duplicated here so this module stays
// dependency-free. Used to transliterate names/messages automatically only
// for the ČSOB profile, which documents that diacritics break its import
// outright; other banks keep whatever the user typed (Doctor will flag it
// as a "medium" recommendation, not silently rewrite the user's data).

const DIACRITIC_MAP = {
  á: 'a', ä: 'a', č: 'c', ď: 'd', é: 'e', í: 'i', ľ: 'l', ĺ: 'l', ň: 'n',
  ó: 'o', ô: 'o', ŕ: 'r', š: 's', ť: 't', ú: 'u', ý: 'y', ž: 'z',
  ě: 'e', ř: 'r', ů: 'u',
  Á: 'A', Ä: 'A', Č: 'C', Ď: 'D', É: 'E', Í: 'I', Ľ: 'L', Ĺ: 'L', Ň: 'N',
  Ó: 'O', Ô: 'O', Ŕ: 'R', Š: 'S', Ť: 'T', Ú: 'U', Ý: 'Y', Ž: 'Z',
  Ě: 'E', Ř: 'R', Ů: 'U',
};

export function transliterate(str) {
  let out = '';
  for (const ch of safeStr(str)) {
    out += Object.prototype.hasOwnProperty.call(DIACRITIC_MAP, ch) ? DIACRITIC_MAP[ch] : ch;
  }
  return out;
}

// ──────────────────────────────── XML escape ───────────────────────────────

function xmlEscape(s) {
  return safeStr(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// ─────────────────────────── delimited-text parsing ───────────────────────
// Handles both a block pasted straight out of Excel (tab-separated) and a
// CSV/TSV file (";" or "," delimited), including quoted fields with
// embedded delimiters/newlines and doubled-quote escaping, in one
// character-by-character pass (not line-by-line, so a quoted field may
// safely contain a literal newline).

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') || '';
  if (firstLine.includes('\t')) return '\t';
  const semi = (firstLine.match(/;/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  if (semi > 0 && semi >= comma) return ';';
  if (comma > 0) return ',';
  return '\t';
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let touched = false;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') { inQuotes = true; touched = true; continue; }
    if (c === delimiter) { row.push(field); field = ''; touched = true; continue; }
    if (c === '\r') { continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; touched = false; continue; }
    field += c; touched = true;
  }
  if (touched || field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Parses a pasted Excel block or CSV/TSV text into rows of trimmed string
 * cells. Delimiter (tab, ";" or ",") is auto-detected from the first
 * non-blank line. Fully blank rows are dropped.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseRows(text) {
  const src = safeStr(text).replace(/^\uFEFF/, '');
  if (!src.trim()) return [];
  const delimiter = detectDelimiter(src);
  const raw = parseDelimited(src, delimiter);
  return raw
    .map((row) => row.map((cell) => safeStr(cell).trim()))
    .filter((row) => row.some((cell) => cell !== ''));
}

// ───────────────────────── column auto-detection ──────────────────────────

const FIELD_LIST = ['iban', 'amount', 'name', 'vs', 'ss', 'ks', 'message', 'date', 'bic'];

function foldLower(s) {
  const str = safeStr(s);
  try {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  } catch (e) {
    return str.toLowerCase().trim();
  }
}

// Tested in this order per column (first match wins); order matters so the
// narrow VS/ŠS/KS codes are checked before the broader name/message ones.
const FIELD_DETECT_ORDER = ['iban', 'bic', 'vs', 'ss', 'ks', 'date', 'amount', 'message', 'name'];

const FIELD_PATTERNS = {
  iban: /iban/,
  bic: /^bic$|swift/,
  amount: /suma|amount|ciastka|castka/,
  vs: /^vs$|variabiln/,
  ss: /^ss$|specifick/,
  ks: /^ks$|konstantn/,
  date: /datum|date|splatnost/,
  message: /sprava|poznamk|message|\binfo\b|popis|referenc/,
  name: /nazov|meno|prijemc|name|dodavat|odberat|firma/,
};

function emptyMapping() {
  const m = {};
  for (const f of FIELD_LIST) m[f] = null;
  return m;
}

function detectMapping(headerRow) {
  const mapping = emptyMapping();
  const used = new Set();
  headerRow.forEach((cell, colIdx) => {
    const folded = foldLower(cell);
    if (!folded) return;
    for (const field of FIELD_DETECT_ORDER) {
      if (mapping[field] !== null || used.has(colIdx)) continue;
      if (FIELD_PATTERNS[field].test(folded)) {
        mapping[field] = colIdx;
        used.add(colIdx);
        break;
      }
    }
  });
  return mapping;
}

function looksLikeHeader(row) {
  let matches = 0;
  for (const cell of row) {
    const folded = foldLower(cell);
    if (!folded) continue;
    for (const field of FIELD_DETECT_ORDER) {
      if (FIELD_PATTERNS[field].test(folded)) { matches++; break; }
    }
  }
  return matches >= 2;
}

// Fallback when no header row is recognized: assume the common Excel export
// order IBAN, suma, názov, VS, ŠS, KS, správa (only as many as exist).
function defaultPositionalMapping(columnCount) {
  const order = ['iban', 'amount', 'name', 'vs', 'ss', 'ks', 'message'];
  const mapping = emptyMapping();
  for (let i = 0; i < order.length && i < columnCount; i++) mapping[order[i]] = i;
  return mapping;
}

// ──────────────────────────────── amount / date ────────────────────────────

/**
 * Loosely parses an amount cell: strips spaces/NBSP (thousands grouping)
 * and "€"/"EUR", and accepts either "." or "," as the decimal separator
 * (when both are present, the rightmost one wins and the other is treated
 * as a thousands separator) — covers both a raw accounting export
 * ("450.00") and an Excel cell in Slovak locale ("1 234,56").
 * @returns {number|null}
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  let s = safeStr(raw).trim();
  if (!s) return null;
  s = s.replace(/[\s\u00A0]/g, '').replace(/€|eur/gi, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    s = parts.length > 2 ? parts.join('') : s.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isoIfValidDate(y, mo, d) {
  if (!(y >= 1000 && y <= 9999 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${pad2(mo)}-${pad2(d)}`;
}

/**
 * Parses a date cell in ISO (YYYY-MM-DD), Slovak (D.M.YYYY / DD.MM.YYYY) or
 * slash (D/M/YYYY) form into an ISO YYYY-MM-DD string, or null if none of
 * these match / the date doesn't exist (e.g. 2026-02-30).
 * @returns {string|null}
 */
export function parseFlexibleDate(raw) {
  const s = safeStr(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoIfValidDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  if (m) return isoIfValidDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return isoIfValidDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

function isValidIsoDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return parseFlexibleDate(s) === s;
}

function onlyDigits(s) {
  return safeStr(s).replace(/[^0-9]/g, '');
}

/** Requested execution date default: tomorrow (local time), as YYYY-MM-DD. */
export function defaultExecDate(base) {
  const d = base instanceof Date ? new Date(base.getTime()) : new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Auto MsgId: "ARL-YYYYMMDD-HHMMSS" from the given (or current) time. */
export function autoMsgId(base) {
  const d = base instanceof Date ? base : new Date();
  return `ARL-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function nowCreDtTm(base) {
  const d = base instanceof Date ? base : new Date();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ─────────────────────────── row build + validation ────────────────────────

function buildPaymentRow(cells, mapping, rowNumber) {
  const get = (field) => {
    const idx = mapping[field];
    if (idx === null || idx === undefined || idx < 0) return '';
    const v = cells[idx];
    return typeof v === 'string' ? v.trim() : '';
  };

  const ibanRaw = get('iban');
  const iban = normalizeIban(ibanRaw);
  const amountRaw = get('amount');
  const amount = amountRaw ? parseAmount(amountRaw) : null;
  const name = get('name');
  const vs = onlyDigits(get('vs'));
  const ss = onlyDigits(get('ss'));
  const ks = onlyDigits(get('ks'));
  const message = get('message');
  const bic = get('bic').toUpperCase();
  const dateRaw = get('date');
  const dateIso = dateRaw ? parseFlexibleDate(dateRaw) : null;

  const errors = [];
  if (!ibanRaw) errors.push('Chýba IBAN.');
  else if (!checkIban(iban).valid) errors.push('Neplatný IBAN.');
  if (!amountRaw) errors.push('Chýba suma.');
  else if (amount === null) errors.push('Suma nie je platné číslo.');
  else if (amount <= 0) errors.push('Suma musí byť kladná.');
  if (!name) errors.push('Chýba názov príjemcu.');
  else if (name.length > 70) errors.push(`Názov má ${name.length} znakov, maximum je 70.`);
  if (vs.length > 10) errors.push(`VS má ${vs.length} číslic, maximum je 10.`);
  if (ss.length > 10) errors.push(`ŠS má ${ss.length} číslic, maximum je 10.`);
  if (ks.length > 4) errors.push(`KS má ${ks.length} číslice, maximum je 4.`);
  if (message.length > 140) errors.push(`Správa má ${message.length} znakov, maximum je 140.`);
  if (dateRaw && !dateIso) errors.push('Dátum sa nepodarilo rozpoznať, použije sa predvolený dátum splatnosti.');

  return {
    row: rowNumber, iban, ibanRaw, amount, amountRaw, name, vs, ss, ks, message, bic,
    date: dateRaw, dateIso, errors, hasError: errors.length > 0,
  };
}

/**
 * Detects (or applies manually-overridden) column meaning and builds the
 * validated payment list from parsed rows.
 * @param {string[][]} rows Output of parseRows().
 * @param {Object<string, number|null>} [overrides] Manual column index per
 *   field (iban/amount/name/vs/ss/ks/message/date/bic); any field present
 *   here overrides auto-detection, `null` means "no column".
 */
export function mapColumns(rows, overrides) {
  const allRows = Array.isArray(rows) ? rows : [];
  const columnCount = allRows.reduce((max, r) => Math.max(max, Array.isArray(r) ? r.length : 0), 0);
  const hasHeader = allRows.length > 0 && looksLikeHeader(allRows[0]);
  const headerRow = hasHeader ? allRows[0] : [];
  const dataRows = hasHeader ? allRows.slice(1) : allRows;

  const detectedMapping = hasHeader ? detectMapping(headerRow) : defaultPositionalMapping(columnCount);
  let mapping = Object.assign({}, detectedMapping);
  if (overrides && typeof overrides === 'object') {
    for (const field of FIELD_LIST) {
      if (Object.prototype.hasOwnProperty.call(overrides, field)) {
        const v = overrides[field];
        mapping[field] = (v === null || v === undefined || v === '') ? null : Number(v);
      }
    }
  }

  const headerLabels = [];
  for (let c = 0; c < columnCount; c++) headerLabels.push(hasHeader && headerRow[c] ? headerRow[c] : `Stĺpec ${c + 1}`);

  const payments = dataRows.map((cells, i) => buildPaymentRow(cells, mapping, i + 1));

  return { hasHeader, headerLabels, columnCount, detectedMapping, mapping, payments, rowCount: dataRows.length };
}

// ──────────────────────────────── XML building ─────────────────────────────

const PAIN_NAMESPACE = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';
export const MAX_PAYMENTS = 5000;

/**
 * Builds "/VS.../SS.../KS..." (NBS convention, segments included only when
 * that symbol has a value) — or the ISO fallback "NOTPROVIDED" when none of
 * the three were supplied. Digits are passed through as given (no silent
 * truncation of a payment reference): a value over the documented 10/10/4
 * digit limit is left for Doctor to flag rather than corrupted here.
 */
export function buildEndToEndId(vs, ss, ks) {
  const v = onlyDigits(vs);
  const s = onlyDigits(ss);
  const k = onlyDigits(ks);
  let out = '';
  if (v) out += '/VS' + v;
  if (s) out += '/SS' + s;
  if (k) out += '/KS' + k;
  return out || 'NOTPROVIDED';
}

function groupByDate(payments, fallbackDate) {
  const map = new Map();
  payments.forEach((p) => {
    const d = (p && isValidIsoDateStr(p.dateIso)) ? p.dateIso : fallbackDate;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(p);
  });
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, pays]) => ({ date, payments: pays }));
}

function buildTx(p, transliterateValues) {
  const name = transliterateValues ? transliterate(safeStr(p.name)) : safeStr(p.name);
  const message = transliterateValues ? transliterate(safeStr(p.message)) : safeStr(p.message);
  const amount = isNum(p.amount) ? p.amount : 0;
  const bic = (safeStr(p.bic).toUpperCase() || bicFromIban(p.iban) || '').trim();
  const endToEndId = buildEndToEndId(p.vs, p.ss, p.ks);

  let xml = `      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${xmlEscape(endToEndId)}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="EUR">${amount.toFixed(2)}</InstdAmt>
        </Amt>`;
  if (bic) {
    xml += `
        <CdtrAgt>
          <FinInstnId>
            <BIC>${xmlEscape(bic)}</BIC>
          </FinInstnId>
        </CdtrAgt>`;
  }
  if (name) {
    xml += `
        <Cdtr>
          <Nm>${xmlEscape(name)}</Nm>
        </Cdtr>`;
  }
  xml += `
        <CdtrAcct>
          <Id>
            <IBAN>${xmlEscape(p.iban)}</IBAN>
          </Id>
        </CdtrAcct>`;
  if (message) {
    xml += `
        <RmtInf>
          <Ustrd>${xmlEscape(message)}</Ustrd>
        </RmtInf>`;
  }
  xml += `
      </CdtTrfTxInf>`;
  return xml;
}

function buildPmtInf({ index, msgId, date, payerName, payerIban, payerBic, txXml }) {
  const pmtInfId = `${msgId}-P${index + 1}`;
  let xml = `    <PmtInf>
      <PmtInfId>${xmlEscape(pmtInfId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${date}</ReqdExctnDt>
      <Dbtr>
        <Nm>${xmlEscape(payerName)}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${xmlEscape(payerIban)}</IBAN>
        </Id>
      </DbtrAcct>`;
  if (payerBic) {
    xml += `
      <DbtrAgt>
        <FinInstnId>
          <BIC>${xmlEscape(payerBic)}</BIC>
        </FinInstnId>
      </DbtrAgt>`;
  }
  xml += `
      <ChrgBr>SLEV</ChrgBr>
${txXml}
    </PmtInf>`;
  return xml;
}

/**
 * Builds the full pain.001.001.03 XML document.
 * @param {{
 *   payer: {name:string, iban:string, bic?:string},
 *   bank?: 'tatrabanka'|'slsp'|'vub'|'csob'|'generic',
 *   execDate?: string,   // YYYY-MM-DD fallback for rows with no usable date
 *   msgId?: string,      // auto-generated (ARL-YYYYMMDD-HHMMSS) if omitted
 *   now?: Date,          // for deterministic tests; defaults to current time
 *   payments: Array<{iban:string, amount:number|null, name:string, vs?:string, ss?:string, ks?:string, message?:string, bic?:string, dateIso?:string|null}>
 * }} config
 * @returns {string} pain.001.001.03 XML
 */
export function buildXml(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  const payer = cfg.payer && typeof cfg.payer === 'object' ? cfg.payer : {};
  const payments = Array.isArray(cfg.payments) ? cfg.payments : [];
  const bankKey = ['tatrabanka', 'slsp', 'vub', 'csob', 'generic'].includes(cfg.bank) ? cfg.bank : 'generic';

  if (payments.length === 0) throw new Error('Žiadne platby na spracovanie. Vložte aspoň jeden riadok s platbou.');
  if (payments.length > MAX_PAYMENTS) throw new Error(`Príliš veľa platieb (${payments.length}). Maximum je ${MAX_PAYMENTS} v jednom súbore: rozdeľte platby do viacerých súborov.`);

  const csob = bankKey === 'csob';
  const payerNameRaw = safeStr(payer.name);
  const payerName = csob ? transliterate(payerNameRaw) : payerNameRaw;
  const payerIban = normalizeIban(payer.iban);
  const payerBic = (safeStr(payer.bic).toUpperCase() || bicFromIban(payerIban) || '').trim();

  const fallbackDate = isValidIsoDateStr(cfg.execDate) ? cfg.execDate : defaultExecDate(cfg.now);
  const msgId = safeStr(cfg.msgId).trim() || autoMsgId(cfg.now);

  const groups = groupByDate(payments, fallbackDate);

  let totalCount = 0;
  let totalSum = 0;
  const pmtInfBlocks = groups.map((g, gi) => {
    const txXml = g.payments.map((p) => {
      totalCount++;
      if (isNum(p.amount)) totalSum += p.amount;
      return buildTx(p, csob);
    }).join('\n');
    return buildPmtInf({ index: gi, msgId, date: g.date, payerName, payerIban, payerBic, txXml });
  }).join('\n');

  const creDtTm = nowCreDtTm(cfg.now);
  const ctrlSum = totalSum.toFixed(2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${PAIN_NAMESPACE}">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xmlEscape(msgId)}</MsgId>
      <CreDtTm>${creDtTm}</CreDtTm>
      <NbOfTxs>${totalCount}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
    </GrpHdr>
${pmtInfBlocks}
  </CstmrCdtTrfInitn>
</Document>
`;
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.SepaGenerator = { parseRows, mapColumns, buildXml, bicFromIban };
}
