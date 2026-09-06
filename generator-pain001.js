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

// ─────────────────────── SEPA character set (profile "de") ────────────────
// Same allowed set doctor-pain001.js already checks generically (its own
// SEPA_CHARSET_RE, sourced from ČSOB's published character-set list): a-z
// A-Z 0-9, space, and / - – ? : ( ) . , ' +. Kept as its own small export
// here (not imported from doctor-pain001.js, to keep this module's "zero
// cross-file dependency" property from the header comment) so the "de"
// country profile can flag a Verwendungszweck that would fail a strict
// Deutsche Kreditwirtschaft (DK) import validator instead of only Doctor's
// post-generation pass catching it.
export const SEPA_CHARSET_RE = /^[A-Za-z0-9 \/\-–?:().,'+]*$/;

export function isSepaCharset(str) {
  return SEPA_CHARSET_RE.test(safeStr(str));
}

/** @returns {string[]} the distinct characters in `str` outside the SEPA set. */
export function sepaCharsetViolations(str) {
  const bad = [];
  const seen = new Set();
  for (const ch of safeStr(str)) {
    if (!SEPA_CHARSET_RE.test(ch) && !seen.has(ch)) { seen.add(ch); bad.push(ch); }
  }
  return bad;
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

// "endToEndId" is only ever populated by the "de" country profile (see
// buildXml()'s `profile` option below): pain.001.001.03 already carries it
// for every profile (PmtId/EndToEndId), but the "sk" profile keeps building
// it from vs/ss/ks (buildEndToEndId(), unchanged), so a mapped column here
// is only consulted by resolveEndToEndId() when profile === 'de'.
// Adresné stĺpce pribudli kvôli termínu 15. 11. 2026 (pozri TERMIN_ADRESY
// nižšie): od neho SEPA schémy neprijmú platbu s čisto neštruktúrovanou
// adresou. Sú nepovinné a nemapujú sa, keď v hárku nie sú. Buď sa použijú
// samostatné stĺpce (street/buildingNumber/postCode/town/country), alebo
// jeden spoločný stĺpec "address", ktorý rozoberie parseAddressLine();
// samostatný stĺpec má vždy prednosť pred tým, čo sa vyčítalo zo spoločného.
const FIELD_LIST = ['iban', 'amount', 'name', 'vs', 'ss', 'ks', 'message', 'date', 'bic', 'endToEndId',
  'street', 'buildingNumber', 'postCode', 'town', 'country', 'address'];

function foldLower(s) {
  const str = safeStr(s);
  try {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  } catch (e) {
    return str.toLowerCase().trim();
  }
}

// Tested in this order per column (first match wins); order matters so the
// narrow VS/ŠS/KS/EndToEndId codes are checked before the broader
// name/message ones.
const FIELD_DETECT_ORDER = ['iban', 'bic', 'endToEndId', 'vs', 'ss', 'ks', 'date', 'amount',
  'postCode', 'buildingNumber', 'street', 'town', 'country', 'address', 'message', 'name'];

// Header vocabulary covers Slovak (the "sk" profile's own export headers),
// German (Deutsche Kreditwirtschaft / Excel-DE headers: IBAN, Betrag, Name,
// Empfänger, Verwendungszweck, Ausführungsdatum, BIC — diacritics are
// stripped by foldLower() before this regex runs, so "Empfänger" folds to
// "empfanger" and "Ausführungsdatum" to "ausfuhrungsdatum", already caught
// by /datum/) and English (Amount, Beneficiary, Reference, Execution date —
// "Reference" already matches the existing /referenc/ alternative below).
const FIELD_PATTERNS = {
  iban: /iban/,
  bic: /^bic$|swift/,
  endToEndId: /endtoend|e2e/,
  amount: /suma|amount|ciastka|castka|betrag/,
  vs: /^vs$|variabiln/,
  ss: /^ss$|specifick/,
  ks: /^ks$|konstantn/,
  date: /datum|date|splatnost/,
  message: /sprava|poznamk|message|\binfo\b|popis|referenc|verwendungszweck/,
  name: /nazov|meno|prijemc|name|dodavat|odberat|firma|empfanger|beneficiary/,
  // Adresné stĺpce. Krátke slová sú zámerne ukotvené na celý názov stĺpca
  // (^...$), inak by /ort/ chytilo "Sortiment" a /str/ hocijaké "Stredisko".
  street: /ulica|street|strasse|strase|^str$|^ul$/,
  buildingNumber: /cislo\s*domu|^cd$|supisn|orientacn|hausnummer|hausnr|building\s*(number|no|nr)|house\s*(number|no|nr)|^bldgnb$/,
  postCode: /^psc$|^zip$|zip\s*code|postal\s*code|postcode|^plz$|^pstcd$/,
  town: /mesto|obec|^town$|^city$|^ort$|ortschaft|^stadt$|^twnnm$/,
  country: /krajina|^stat$|^staat$|^country$|^land$|^ctry$/,
  address: /^adresa$|^address$|^anschrift$|^sidlo$|^adr$/,
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
// order IBAN, suma, názov, VS, ŠS, KS, správa (only as many as exist) for
// the "sk" profile, or IBAN, Betrag, Name, Verwendungszweck, EndToEndId for
// "de" (no VS/ŠS/KS columns in that profile — see FIELD_LIST's comment).
function defaultPositionalMapping(columnCount, profile) {
  const order = profile === 'de'
    ? ['iban', 'amount', 'name', 'message', 'endToEndId']
    : ['iban', 'amount', 'name', 'vs', 'ss', 'ks', 'message'];
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

function buildPaymentRow(cells, mapping, rowNumber, profile) {
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
  const endToEndId = get('endToEndId');
  const dateRaw = get('date');
  const dateIso = dateRaw ? parseFlexibleDate(dateRaw) : null;

  const address = zostavAdresu(get);

  const errors = [];
  const warnings = [];
  if (!ibanRaw) errors.push('Chýba IBAN.');
  else if (!checkIban(iban).valid) errors.push('Neplatný IBAN.');
  if (!amountRaw) errors.push('Chýba suma.');
  else if (amount === null) errors.push('Suma nie je platné číslo.');
  else if (amount <= 0) errors.push('Suma musí byť kladná.');
  if (!name) errors.push('Chýba názov príjemcu.');
  else if (name.length > 70) errors.push(`Názov má ${name.length} znakov, maximum je 70.`);
  if (message.length > 140) errors.push(`Správa má ${message.length} znakov, maximum je 140.`);
  if (dateRaw && !dateIso) errors.push('Dátum sa nepodarilo rozpoznať, použije sa predvolený dátum splatnosti.');

  if (profile === 'de') {
    // "de" country profile: no VS/ŠS/KS fields at all (Verwendungszweck
    // carries the whole remittance text instead), so those two length
    // checks below are skipped; EndToEndId and the SEPA character set on
    // Verwendungszweck are checked instead — see FIELD_LIST's comment and
    // resolveEndToEndId() further down.
    if (endToEndId.length > 35) errors.push(`EndToEndId má ${endToEndId.length} znakov, maximum je 35.`);
    if (message) {
      const bad = sepaCharsetViolations(message);
      if (bad.length) errors.push(`Verwendungszweck obsahuje znak mimo znakovej sady SEPA: ${bad.join(' ')}.`);
    }
    // The same DK (Deutsche Kreditwirtschaft) Anlage 3 character-set rule
    // that restricts Verwendungszweck applies to the whole message, Cdtr/Nm
    // included — German umlauts (ä/ö/ü) and ß are not in the permitted SEPA
    // set and must be transliterated (ä->ae, ö->oe, ü->ue, ß->ss) before
    // submission, exactly like Verwendungszweck above. Names are exactly
    // where a German-market user is most likely to hit this (Müller,
    // Schäfer, Groß, ...), so this is checked here too, not only on the
    // free-text message: without it, a payment batch of ordinary German
    // names would build "clean" (hasError: false) and then bounce, silently
    // and individually, per creditor at the bank.
    if (name) {
      const badName = sepaCharsetViolations(name);
      if (badName.length) errors.push(`Názov príjemcu obsahuje znak mimo znakovej sady SEPA: ${badName.join(' ')}.`);
    }
  } else {
    if (vs.length > 10) errors.push(`VS má ${vs.length} číslic, maximum je 10.`);
    if (ss.length > 10) errors.push(`ŠS má ${ss.length} číslic, maximum je 10.`);
    if (ks.length > 4) errors.push(`KS má ${ks.length} číslice, maximum je 4.`);
  }

  if (address.hasAny) {
    if (address.countryRaw && !address.country) {
      errors.push(`Krajinu „${address.countryRaw}" nevieme priradiť ku kódu podľa ISO 3166-1. Napíšte dvojpísmenový kód, napríklad SK.`);
    } else if (!address.country) {
      // Krajinu nikto neuviedol. Dopĺňame ju z IBAN-u príjemcu, lebo adresa
      // bez <Ctry> je po 15. 11. 2026 dôvod na odmietnutie celej platby a
      // krajina banky je pri bežnom SEPA príkaze tá istá ako krajina
      // príjemcu. Isté to nie je, preto to hlásime a v tabuľke to vidno.
      address.country = countryFromIban(iban);
      if (address.country) warnings.push(`Krajina adresy nebola uvedená, doplnili sme ${address.country} podľa IBAN-u. Skontrolujte to.`);
    }
    for (const pole of ['street', 'buildingNumber', 'postCode', 'town']) {
      const dlzka = address[pole].length;
      if (dlzka > ADRESA_LIMITY[pole]) {
        errors.push(`${ADRESA_NAZVY[pole]} má ${dlzka} znakov, maximum je ${ADRESA_LIMITY[pole]}.`);
      }
    }
    if (!address.town) warnings.push('Adresa nemá mesto. Od 15. 11. 2026 banka platbu s takouto adresou odmietne.');
    if (!address.country) warnings.push('Adresa nemá kód krajiny. Od 15. 11. 2026 banka platbu s takouto adresou odmietne.');
    if (address.addressRaw && !address.parsedAddress && !address.town) {
      warnings.push(`Adresu „${address.addressRaw}" sa nepodarilo rozobrať na mesto a krajinu. Rozdeľte ju do stĺpcov, alebo píšte „Ulica 1, 821 04 Mesto, SK".`);
    }
  }

  return {
    row: rowNumber, iban, ibanRaw, amount, amountRaw, name, vs, ss, ks, message, bic, endToEndId,
    date: dateRaw, dateIso, address, errors, hasError: errors.length > 0,
    warnings, hasWarning: warnings.length > 0,
  };
}

/**
 * Poskladá adresu príjemcu z jedného riadka hárku. Samostatný stĺpec má
 * prednosť pred tým, čo sa vyčítalo zo spoločného stĺpca "address".
 */
function zostavAdresu(get) {
  const spojenaRaw = get('address');
  const spojena = spojenaRaw ? parseAddressLine(spojenaRaw) : null;
  const vyber = (pole) => get(pole) || (spojena ? spojena[pole] : '') || '';
  const countryRaw = get('country') || (spojena ? spojena.country : '') || '';
  const a = {
    street: vyber('street'),
    buildingNumber: vyber('buildingNumber'),
    postCode: vyber('postCode'),
    town: vyber('town'),
    countryRaw,
    country: normalizeCountry(countryRaw),
    addressRaw: spojenaRaw,
    parsedAddress: !!(spojena && spojena.parsed),
  };
  a.hasAny = !!(a.street || a.buildingNumber || a.postCode || a.town || countryRaw);
  return a;
}

/**
 * Detects (or applies manually-overridden) column meaning and builds the
 * validated payment list from parsed rows.
 * @param {string[][]} rows Output of parseRows().
 * @param {Object<string, number|null>} [overrides] Manual column index per
 *   field (iban/amount/name/vs/ss/ks/message/date/bic/endToEndId); any
 *   field present here overrides auto-detection, `null` means "no column".
 * @param {'sk'|'de'} [profile] Country profile: 'sk' (default, current
 *   behaviour) or 'de' (no VS/ŠS/KS, EndToEndId column instead — see
 *   buildXml()'s own `profile` option for what this changes in the XML).
 */
export function mapColumns(rows, overrides, profile) {
  const prof = profile === 'de' ? 'de' : 'sk';
  const allRows = Array.isArray(rows) ? rows : [];
  const columnCount = allRows.reduce((max, r) => Math.max(max, Array.isArray(r) ? r.length : 0), 0);
  const hasHeader = allRows.length > 0 && looksLikeHeader(allRows[0]);
  const headerRow = hasHeader ? allRows[0] : [];
  const dataRows = hasHeader ? allRows.slice(1) : allRows;

  const detectedMapping = hasHeader ? detectMapping(headerRow) : defaultPositionalMapping(columnCount, prof);
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

  const payments = dataRows.map((cells, i) => buildPaymentRow(cells, mapping, i + 1, prof));

  return { hasHeader, headerLabels, columnCount, detectedMapping, mapping, payments, rowCount: dataRows.length, profile: prof };
}

// ────────────────────────────── poštová adresa ─────────────────────────────
//
// Od 15. 11. 2026 platí v SEPA schémach (SCT, SCT Inst, SDD Core aj B2B), že
// keď je v správe uvedená poštová adresa, nesmie byť čisto neštruktúrovaná:
// musí mať aspoň mesto (TwnNm) a kód krajiny (Ctry). Adresa samotná zostáva
// nepovinná, takže súbor úplne bez adries prejde aj po termíne.
//
// Upresnenie, ktoré sa na internete píše často nesprávne: pain.001.001.03
// štruktúrovanú adresu unesie. Jej PostalAddress6 má StrtNm, BldgNb, PstCd,
// TwnNm, CtrySubDvsn aj Ctry. Novšia PostalAddress24 z pain.001.001.09
// pridáva len jemnejšie polia (BldgNm, Flr, PstBx, Room, TwnLctnNm, DstrctNm)
// a obmedzuje AdrLine na dva riadky. Dôvod prechodu na .09 teda nie je "03 to
// neunesie", ale to, že banky k termínu prestávajú .03 prijímať. Preto vieme
// štruktúrovanú adresu zapísať do oboch verzií a verziu si vyberá používateľ.
//
// Poradie prvkov StrtNm, BldgNb, PstCd, TwnNm, Ctry je v PostalAddress6 aj
// PostalAddress24 rovnaké, takže buildPstlAdr() stačí jedna.
//
// Zdroje overené 6. 9. 2026: European Payments Council (zosúladenie schém na
// 15. 11. 2026), ECB/PMPG vzorový list o hybridnej adrese (2025-10-22),
// Komerční banka (pain.001.001.03 sa od 15. 11. 2026 prestane používať).
export const TERMIN_ADRESY = '2026-11-15';

// Dĺžky podľa ISO 20022. Prekročenie hlásime ako chybu riadka, netichým
// orezaním: skrátená adresa je nesprávna adresa.
const ADRESA_LIMITY = { street: 70, buildingNumber: 16, postCode: 16, town: 35 };
const ADRESA_NAZVY = { street: 'Ulica', buildingNumber: 'Číslo domu', postCode: 'PSČ', town: 'Mesto' };

// Kódy alpha-3 a názvy krajín, ktoré sa v slovenských, českých a nemeckých
// exportoch reálne objavia. Čokoľvek iné musí prísť ako dvojpísmenový kód.
// Kľúče sú už prehnané cez foldLower(), takže bez diakritiky a malými
// písmenami: "Německo" aj "Nemecko" vyjdú na to isté "nemecko".
const KRAJINY = {
  svk: 'SK', cze: 'CZ', aut: 'AT', deu: 'DE', hun: 'HU', pol: 'PL', ukr: 'UA',
  gbr: 'GB', usa: 'US', fra: 'FR', ita: 'IT', esp: 'ES', nld: 'NL', bel: 'BE',
  che: 'CH', svn: 'SI', hrv: 'HR', rou: 'RO', bgr: 'BG', irl: 'IE', prt: 'PT',
  dnk: 'DK', swe: 'SE', fin: 'FI', nor: 'NO', est: 'EE', lva: 'LV', ltu: 'LT',
  lux: 'LU', grc: 'GR', cyp: 'CY', mlt: 'MT', isl: 'IS', srb: 'RS',
  slovensko: 'SK', 'slovenska republika': 'SK', slovakia: 'SK', slowakei: 'SK',
  cesko: 'CZ', 'ceska republika': 'CZ', czechia: 'CZ', 'czech republic': 'CZ', tschechien: 'CZ',
  rakusko: 'AT', rakousko: 'AT', austria: 'AT', osterreich: 'AT',
  nemecko: 'DE', germany: 'DE', deutschland: 'DE',
  madarsko: 'HU', hungary: 'HU', ungarn: 'HU',
  polsko: 'PL', poland: 'PL', polen: 'PL',
  svajciarsko: 'CH', svycarsko: 'CH', switzerland: 'CH', schweiz: 'CH',
  holandsko: 'NL', nizozemsko: 'NL', netherlands: 'NL', niederlande: 'NL',
  'velka britania': 'GB', 'united kingdom': 'GB', 'great britain': 'GB', grossbritannien: 'GB',
  slovinsko: 'SI', slovenia: 'SI', chorvatsko: 'HR', croatia: 'HR',
  taliansko: 'IT', italy: 'IT', italien: 'IT',
  francuzsko: 'FR', francie: 'FR', france: 'FR', frankreich: 'FR',
  spanielsko: 'ES', spain: 'ES', spanien: 'ES',
  belgicko: 'BE', belgium: 'BE', belgien: 'BE',
  rumunsko: 'RO', romania: 'RO', bulharsko: 'BG', bulgaria: 'BG',
  ukrajina: 'UA', ukraine: 'UA', srbsko: 'RS', serbia: 'RS',
};

/**
 * Prevedie zápis krajiny na dvojpísmenový kód podľa ISO 3166-1 alpha-2.
 * Vráti '' keď to nevie, aby volajúci mohol rozlíšiť "nezadané" od "nezrozumiteľné".
 */
export function normalizeCountry(value) {
  const raw = safeStr(value).trim();
  if (!raw) return '';
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const key = foldLower(raw).replace(/[.\-,]/g, ' ').replace(/\s+/g, ' ').trim();
  return KRAJINY[key] || '';
}

/** Krajina podľa prvých dvoch písmen IBAN-u. Použije sa len ako záloha. */
export function countryFromIban(iban) {
  const s = normalizeIban(iban);
  return /^[A-Z]{2}/.test(s) ? s.slice(0, 2) : '';
}

// PSČ: slovenské a české "821 04" aj "82104", nemecké päťmiestne, poľské
// "00-950" a všeobecne štyri až šesť číslic.
const PSC_VZOR = /^(?:\d{3}\s?\d{2}|\d{2}-\d{3}|\d{4,6})$/;

/**
 * Rozoberie jeden spoločný stĺpec s adresou, napríklad
 * "Ivanská cesta 32E, 821 04 Bratislava, SK".
 *
 * Zámerne konzervatívne: rozoznáva len tvar oddelený čiarkami, kde PSČ stojí
 * pred mestom (alebo za ním, ako sa píše v nemecky hovoriacich krajinách).
 * Keď tvar nesedí, vráti parsed:false a zvyšok sa nedopĺňa. Hádanie by tu
 * bolo horšie než nič: zle rozobratá adresa prejde ticho až do banky.
 *
 * @returns {{street:string, buildingNumber:string, postCode:string, town:string, country:string, parsed:boolean}}
 */
export function parseAddressLine(value) {
  const prazdna = { street: '', buildingNumber: '', postCode: '', town: '', country: '', parsed: false };
  const raw = safeStr(value).trim();
  if (!raw) return prazdna;

  const casti = raw.split(',').map((c) => c.trim()).filter(Boolean);
  if (casti.length === 0) return prazdna;

  let country = '';
  if (casti.length > 1) {
    const kod = normalizeCountry(casti[casti.length - 1]);
    if (kod) { country = kod; casti.pop(); }
  }

  let postCode = '';
  let town = '';
  for (let i = casti.length - 1; i >= 0; i--) {
    const c = casti[i];
    let m = c.match(/^(\d{3}\s?\d{2}|\d{2}-\d{3}|\d{4,6})\s+(.{2,})$/);
    if (m) { postCode = m[1]; town = m[2].trim(); casti.splice(i, 1); break; }
    m = c.match(/^(.{2,}?)\s+(\d{3}\s?\d{2}|\d{2}-\d{3}|\d{4,6})$/);
    if (m) { town = m[1].trim(); postCode = m[2]; casti.splice(i, 1); break; }
  }
  if (!town && casti.length > 1 && !PSC_VZOR.test(casti[casti.length - 1])) {
    town = casti.pop();
  }

  let street = casti.join(' ').trim();
  let buildingNumber = '';
  if (street) {
    // Číslo domu je posledný kus s číslicou: "32E", "12/4", "1234/56a".
    const m = street.match(/^(.+?)[\s,]+(\d+[A-Za-z]?(?:\s?\/\s?\d+[A-Za-z]?)?)$/);
    if (m) { street = m[1].trim(); buildingNumber = m[2].replace(/\s/g, ''); }
  }

  return { street, buildingNumber, postCode, town, country, parsed: !!town };
}

/**
 * Poskladá <PstlAdr>. Vráti '' keď nie je čo zapísať, aby sa prázdny prvok
 * do súboru nedostal: prázdny <PstlAdr> je podľa schémy chyba.
 */
function buildPstlAdr(addr, indent) {
  if (!addr) return '';
  const riadky = [];
  const pridaj = (tag, v) => {
    const t = safeStr(v).trim();
    if (t) riadky.push(indent + '  <' + tag + '>' + xmlEscape(t) + '</' + tag + '>');
  };
  pridaj('StrtNm', addr.street);
  pridaj('BldgNb', addr.buildingNumber);
  pridaj('PstCd', addr.postCode);
  pridaj('TwnNm', addr.town);
  pridaj('Ctry', addr.country);
  if (!riadky.length) return '';
  return '\n' + indent + '<PstlAdr>\n' + riadky.join('\n') + '\n' + indent + '</PstlAdr>';
}

/** Prepíše adresu do znakovej sady SEPA (pre ČSOB, rovnako ako názvy). */
function transliterateAddress(addr) {
  if (!addr) return addr;
  return {
    street: transliterate(safeStr(addr.street)),
    buildingNumber: transliterate(safeStr(addr.buildingNumber)),
    postCode: transliterate(safeStr(addr.postCode)),
    town: transliterate(safeStr(addr.town)),
    country: safeStr(addr.country),
  };
}

// ──────────────────────────────── XML building ─────────────────────────────

// Dve verzie správy, medzi ktorými sa vyberá. Rozdiely, ktoré sa nás týkajú,
// nie sú len v mennom priestore, preto ich nesie celý generátor:
//   1. <ReqdExctnDt> je v .09 typu DateAndDateTime2Choice, čiže dátum musí byť
//      zabalený do <Dt>. Toto je najčastejšia príčina odmietnutého .09 súboru.
//   2. Kód banky sa v .09 volá <BICFI>, nie <BIC>
//      (FinancialInstitutionIdentification18 oproti ...8).
//   3. Poštová adresa je v .09 PostalAddress24 namiesto PostalAddress6, ale
//      polia, ktoré zapisujeme, majú v oboch rovnaké názvy aj poradie.
// Zvyšok súboru je pre naše potreby zhodný: poradie prvkov v GrpHdr, PmtInf aj
// CdtTrfTxInf je v oboch verziách rovnaké.
export const PAIN_NAMESPACES = {
  '03': 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03',
  '09': 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09',
};
const PAIN_NAMESPACE = PAIN_NAMESPACES['03'];
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

/**
 * Picks PmtId/EndToEndId's value for one payment, per country profile:
 *  - "sk" (default): same as always, built from vs/ss/ks (buildEndToEndId()
 *    above) — the NBS "/VS.../SS.../KS..." convention.
 *  - "de": taken directly from the payment's own `endToEndId` field (an
 *    optional mapped column — see FIELD_LIST's comment), trimmed, or the
 *    ISO fallback "NOTPROVIDED" when that column is empty/unmapped. vs/ss/
 *    ks are ignored outright: the "de" profile has no such columns.
 */
export function resolveEndToEndId(p, profile) {
  if (profile === 'de') {
    const v = safeStr(p && p.endToEndId).trim();
    return v || 'NOTPROVIDED';
  }
  return buildEndToEndId(p && p.vs, p && p.ss, p && p.ks);
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

/** V .09 sa kód banky volá BICFI, v .03 BIC. Inak je to ten istý údaj. */
function bicTag(schema) {
  return schema === '09' ? 'BICFI' : 'BIC';
}

/**
 * Adresa platiteľa z formulára. Krajinu prevedie na kód, a keď ju
 * používateľ nevyplnil, doplní ju z IBAN-u platiteľa — bez <Ctry> by bola
 * adresa po 15. 11. 2026 dôvodom na odmietnutie celého súboru.
 */
function normalizePayerAddress(address, payerIban, csob) {
  if (!address || typeof address !== 'object') return null;
  const a = {
    street: safeStr(address.street).trim(),
    buildingNumber: safeStr(address.buildingNumber).trim(),
    postCode: safeStr(address.postCode).trim(),
    town: safeStr(address.town).trim(),
    country: normalizeCountry(address.country),
  };
  if (!a.street && !a.buildingNumber && !a.postCode && !a.town && !a.country) return null;
  if (!a.country) a.country = countryFromIban(payerIban);
  return csob ? transliterateAddress(a) : a;
}

function buildTx(p, transliterateValues, profile, schema) {
  const name = transliterateValues ? transliterate(safeStr(p.name)) : safeStr(p.name);
  const address = transliterateValues ? transliterateAddress(p.address) : p.address;
  const pstlAdr = buildPstlAdr(address, '          ');
  const message = transliterateValues ? transliterate(safeStr(p.message)) : safeStr(p.message);
  const amount = isNum(p.amount) ? p.amount : 0;
  const bic = (safeStr(p.bic).toUpperCase() || bicFromIban(p.iban) || '').trim();
  const endToEndId = resolveEndToEndId(p, profile);

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
            <${bicTag(schema)}>${xmlEscape(bic)}</${bicTag(schema)}>
          </FinInstnId>
        </CdtrAgt>`;
  }
  if (name || pstlAdr) {
    xml += `
        <Cdtr>${name ? `
          <Nm>${xmlEscape(name)}</Nm>` : ''}${pstlAdr}
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

// DbtrAgt is mandatory (minOccurs unset -> defaults to 1) in
// PaymentInstructionInformation3 per the official pain.001.001.03 XSD, so it
// must always be written, unlike CdtrAgt (creditor's own agent) a few lines
// below in buildTx(), which really is optional (minOccurs="0") in
// CreditTransferTransactionInformation10 and stays conditional. When no BIC
// is known for the payer (bicFromIban() only resolves Slovak IBANs, so this
// is the normal case for the "de" country profile's foreign payer IBANs
// unless the user fills in the BIC field), FinInstnId falls back to
// Othr/Id = "NOTPROVIDED", the same ISO 20022 placeholder convention this
// file already uses for a missing EndToEndId (see buildEndToEndId()) —
// every child of FinancialInstitutionIdentification7 is itself optional, so
// this still validates, whereas omitting the element outright does not.
function buildPmtInf({ index, msgId, date, payerName, payerIban, payerBic, payerAddress, txXml, schema }) {
  const pmtInfId = `${msgId}-P${index + 1}`;
  const pstlAdr = buildPstlAdr(payerAddress, '        ');
  let xml = `    <PmtInf>
      <PmtInfId>${xmlEscape(pmtInfId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
      </PmtTpInf>
      ${schema === '09' ? `<ReqdExctnDt>
        <Dt>${date}</Dt>
      </ReqdExctnDt>` : `<ReqdExctnDt>${date}</ReqdExctnDt>`}
      <Dbtr>
        <Nm>${xmlEscape(payerName)}</Nm>${pstlAdr}
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${xmlEscape(payerIban)}</IBAN>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>${payerBic ? `
          <${bicTag(schema)}>${xmlEscape(payerBic)}</${bicTag(schema)}>` : `
          <Othr>
            <Id>NOTPROVIDED</Id>
          </Othr>`}
        </FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${txXml}
    </PmtInf>`;
  return xml;
}

/**
 * Builds the full pain.001 XML document, in version .03 or .09.
 * @param {{
 *   payer: {name:string, iban:string, bic?:string, address?:{street?:string, buildingNumber?:string, postCode?:string, town?:string, country?:string}},
 *   schema?: '03'|'09', // verzia správy; predvolene '03'. Po 15. 11. 2026 chcú banky '09' — dátum vyhodnocuje volajúci, aby táto funkcia zostala bez hodín
 *   bank?: 'tatrabanka'|'slsp'|'vub'|'csob'|'generic',
 *   profile?: 'sk'|'de', // country profile for PmtId/EndToEndId (see resolveEndToEndId()); default 'sk'
 *   execDate?: string,   // YYYY-MM-DD fallback for rows with no usable date
 *   msgId?: string,      // auto-generated (ARL-YYYYMMDD-HHMMSS) if omitted
 *   now?: Date,          // for deterministic tests; defaults to current time
 *   payments: Array<{iban:string, amount:number|null, name:string, vs?:string, ss?:string, ks?:string, message?:string, bic?:string, endToEndId?:string, dateIso?:string|null, address?:object}>
 * }} config
 * @returns {string} pain.001 XML
 */
export function buildXml(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  const payer = cfg.payer && typeof cfg.payer === 'object' ? cfg.payer : {};
  const payments = Array.isArray(cfg.payments) ? cfg.payments : [];
  const bankKey = ['tatrabanka', 'slsp', 'vub', 'csob', 'generic'].includes(cfg.bank) ? cfg.bank : 'generic';
  const profile = cfg.profile === 'de' ? 'de' : 'sk';
  const schema = cfg.schema === '09' ? '09' : '03';

  if (payments.length === 0) throw new Error('Žiadne platby na spracovanie. Vložte aspoň jeden riadok s platbou.');
  if (payments.length > MAX_PAYMENTS) throw new Error(`Príliš veľa platieb (${payments.length}). Maximum je ${MAX_PAYMENTS} v jednom súbore: rozdeľte platby do viacerých súborov.`);

  const csob = bankKey === 'csob';
  const payerNameRaw = safeStr(payer.name);
  const payerName = csob ? transliterate(payerNameRaw) : payerNameRaw;
  const payerIban = normalizeIban(payer.iban);
  const payerBic = (safeStr(payer.bic).toUpperCase() || bicFromIban(payerIban) || '').trim();
  const payerAddress = normalizePayerAddress(payer.address, payerIban, csob);

  const fallbackDate = isValidIsoDateStr(cfg.execDate) ? cfg.execDate : defaultExecDate(cfg.now);
  const msgId = safeStr(cfg.msgId).trim() || autoMsgId(cfg.now);

  const groups = groupByDate(payments, fallbackDate);

  let totalCount = 0;
  let totalSum = 0;
  const pmtInfBlocks = groups.map((g, gi) => {
    const txXml = g.payments.map((p) => {
      totalCount++;
      if (isNum(p.amount)) totalSum += p.amount;
      return buildTx(p, csob, profile, schema);
    }).join('\n');
    return buildPmtInf({ index: gi, msgId, date: g.date, payerName, payerIban, payerBic, payerAddress, txXml, schema });
  }).join('\n');

  const creDtTm = nowCreDtTm(cfg.now);
  const ctrlSum = totalSum.toFixed(2);

  // InitgPty (Initiating Party) is mandatory (minOccurs unset -> defaults to
  // 1) in GroupHeader32 per the official pain.001.001.03 XSD
  // (urn:iso:std:iso:20022:tech:xsd:pain.001.001.03, checked against the copy
  // published via iso20022.org's message archive): a file without it fails
  // strict schema validation, even though the Slovak banks this tool was
  // first built for tolerate its absence. Modelled as the payer/debtor
  // initiating their own payment, i.e. the same party as Dbtr.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${PAIN_NAMESPACES[schema]}">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xmlEscape(msgId)}</MsgId>
      <CreDtTm>${creDtTm}</CreDtTm>
      <NbOfTxs>${totalCount}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <InitgPty>${payerName ? `
        <Nm>${xmlEscape(payerName)}</Nm>` : ''}
      </InitgPty>
    </GrpHdr>
${pmtInfBlocks}
  </CstmrCdtTrfInitn>
</Document>
`;
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.SepaGenerator = { parseRows, mapColumns, buildXml, bicFromIban, resolveEndToEndId, isSepaCharset, sepaCharsetViolations,
    normalizeCountry, countryFromIban, parseAddressLine, TERMIN_ADRESY, PAIN_NAMESPACES };
}
