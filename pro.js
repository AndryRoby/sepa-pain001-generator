// pro.js: SEPA pain.001 Generátor Pro features — payer profiles, exporter
// column-mapping templates, multi-block payments, and command history.
//
// Pure, deterministic, 100% client-side: same "no DOMParser, no npm
// dependency" spirit as generator-pain001.js and doctor-pain001.js. The
// only cross-file dependency is mapColumns() from generator-pain001.js,
// which every mapping template ultimately calls into (a template is just
// a set of column-header guesses fed to mapColumns() as overrides).
//
// Storage (localStorage, wrapped in try/catch throughout — see
// hasLocalStorage below):
//   arling_sepa_pro_profiles  — payer profiles, unbounded array
//   arling_sepa_pro_history   — last HISTORY_MAX generated files
//
// Works as an ES module (import { ... } from './pro.js') and, when loaded
// in a browser via <script type="module">, also publishes
// window.SepaGeneratorPro with the same functions for console/debug use.

import { mapColumns } from './generator-pain001.js';

export const PROFILES_KEY = 'arling_sepa_pro_profiles';
export const HISTORY_KEY = 'arling_sepa_pro_history';
export const HISTORY_MAX = 50;
export const HISTORY_XML_MAX_BYTES = 200 * 1024;

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch (e) {
    return false;
  }
}

function safeStr(v) {
  return typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v));
}

function foldLower(s) {
  const str = safeStr(s);
  try {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  } catch (e) {
    return str.toLowerCase().trim();
  }
}

function randomId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ═══════════════════════ column-mapping templates ══════════════════════════
//
// These are heuristics, not documented CSV specs: Pohoda, Omega (KROS) and
// Money S3 all publish their bank-payment export as XML (SEPA pain) or
// legacy ABO/Multicash/Gemini formats, not a documented CSV column layout,
// so there is no manufacturer spec to cite for exact CSV header text (Web
// search 2026-09: Stormware's own docs describe only the XML/ABO export
// wizard, KROS's own FAQ describes only the IBAN+amount+symbols *fields*
// without naming CSV headers, and Money S3's docs describe only a generic
// "conversion template" step). Each template below is this generator's own
// best-guess header vocabulary for a spreadsheet exported from that
// program, in the language/spelling that program's UI itself uses (Pohoda
// and Money S3 are Czech-first, Omega is Slovak-first) — Doctor and the
// generator's own header-pattern detection (generator-pain001.js
// FIELD_PATTERNS) already cover the header spellings this list doesn't. A
// template is applied by *exact header match* only (never by column
// position — export column order is not something any of these programs
// document as fixed), and every field it does not match falls back to
// mapColumns()'s normal auto-detection. TEMPLATES_ARE_HEURISTIC (below)
// exists so the UI can render an honest "šablóna odhaduje názvy stĺpcov"
// notice next to every one of them, per each template's own `note`.
export const TEMPLATES_ARE_HEURISTIC = true;

export const MAPPING_TEMPLATES = {
  POHODA: {
    label: 'Pohoda (Stormware)',
    note: 'Šablóna odhaduje bežné názvy stĺpcov z exportu Pohody, nie je to oficiálna špecifikácia. Skontrolujte mapovanie pred generovaním.',
    headers: {
      iban: ['iban', 'účet příkazce', 'protiúčet', 'číslo účtu', 'cislo uctu'],
      amount: ['částka', 'čiastka', 'suma'],
      name: ['název', 'název firmy', 'firma', 'partner', 'název partnera'],
      vs: ['variabilní symbol', 'variabilny symbol', 'vs'],
      ss: ['specifický symbol', 'špecifický symbol', 'ss'],
      ks: ['konstantní symbol', 'konštantný symbol', 'ks'],
      message: ['poznámka', 'text pro příjemce', 'zpráva pro příjemce', 'avízo'],
      date: ['datum splatnosti', 'dátum splatnosti', 'splatnost'],
      bic: ['swift', 'bic'],
    },
  },
  OMEGA: {
    label: 'Omega (KROS)',
    note: 'Šablóna odhaduje bežné názvy stĺpcov z exportu Omegy (KROS), nie je to oficiálna špecifikácia. Skontrolujte mapovanie pred generovaním.',
    headers: {
      iban: ['iban', 'účet', 'ucet', 'číslo účtu príjemcu', 'cislo uctu prijemcu'],
      amount: ['suma', 'čiastka', 'ciastka', 'úhrada', 'uhrada'],
      name: ['názov', 'nazov', 'názov firmy', 'odberateľ', 'dodávateľ', 'partner'],
      vs: ['variabilný symbol', 'variabilny symbol', 'vs'],
      ss: ['špecifický symbol', 'specificky symbol', 'ss'],
      ks: ['konštantný symbol', 'konstantny symbol', 'ks'],
      message: ['správa pre prijímateľa', 'sprava pre prijimatela', 'poznámka', 'text platby'],
      date: ['dátum splatnosti', 'datum splatnosti', 'splatnosť'],
      bic: ['bic', 'swift'],
    },
  },
  MONEY_S3: {
    label: 'Money S3 (Seyfor)',
    note: 'Šablóna odhaduje bežné názvy stĺpcov z exportu Money S3, nie je to oficiálna špecifikácia. Skontrolujte mapovanie pred generovaním.',
    headers: {
      iban: ['iban', 'účet', 'ucet', 'číslo účtu', 'cislo uctu'],
      amount: ['částka', 'castka', 'čiastka'],
      name: ['název partnera', 'nazev partnera', 'partner', 'název', 'nazev'],
      vs: ['variabilní symbol', 'variabilni symbol', 'vs'],
      ss: ['specifický symbol', 'specificky symbol', 'ss'],
      ks: ['konstantní symbol', 'konstantni symbol', 'ks'],
      message: ['popis', 'zpráva', 'zprava', 'avízo', 'avizo'],
      date: ['datum splatnosti'],
      bic: ['swift', 'bic'],
    },
  },
  EXCEL: {
    label: 'Excel (univerzálny)',
    note: 'Univerzálna šablóna pre bežný excelový export (IBAN, suma, názov, VS, ŠS, KS, správa, dátum, BIC). Ak hlavičky nesedia presne, generátor sa opiera o vlastné automatické rozpoznanie.',
    headers: {
      iban: ['iban', 'číslo účtu', 'cislo uctu', 'účet', 'ucet'],
      amount: ['suma', 'čiastka', 'ciastka', 'sum', 'amount'],
      name: ['názov', 'nazov', 'meno', 'príjemca', 'prijemca', 'name'],
      vs: ['vs', 'variabilný symbol', 'variabilny symbol'],
      ss: ['ss', 'špecifický symbol', 'specificky symbol'],
      ks: ['ks', 'konštantný symbol', 'konstantny symbol'],
      message: ['správa', 'sprava', 'poznámka', 'poznamka', 'message'],
      date: ['dátum', 'datum', 'splatnosť', 'splatnost', 'date'],
      bic: ['bic', 'swift'],
    },
  },
};

/**
 * Builds mapColumns() overrides for the given template by matching the
 * (first, header) row's cells against the template's header-text guesses
 * — exact match only, diacritics/case-folded, never by column position.
 * Any field the template doesn't match is left for mapColumns()'s own
 * auto-detection to fill in.
 * @param {string} templateKey One of MAPPING_TEMPLATES's keys.
 * @param {string[][]} rows Output of parseRows().
 * @returns {{mapped:Object, template:Object|null, matchedFields:string[]}}
 */
export function applyTemplate(templateKey, rows) {
  const rowsArr = Array.isArray(rows) ? rows : [];
  const template = Object.prototype.hasOwnProperty.call(MAPPING_TEMPLATES, templateKey) ? MAPPING_TEMPLATES[templateKey] : null;
  const overrides = {};
  if (template && rowsArr.length > 0) {
    const headerRow = rowsArr[0];
    const used = new Set();
    for (const field of Object.keys(template.headers)) {
      const candidates = template.headers[field].map(foldLower);
      let found = null;
      headerRow.forEach((cell, idx) => {
        if (found !== null || used.has(idx)) return;
        const folded = foldLower(cell);
        if (folded && candidates.includes(folded)) found = idx;
      });
      if (found !== null) {
        overrides[field] = found;
        used.add(found);
      }
    }
  }
  const mapped = mapColumns(rowsArr, overrides);
  return { mapped, template, matchedFields: Object.keys(overrides) };
}

// ═══════════════════════════ payer profiles ═════════════════════════════════

/** @returns {Array<{id:string,name:string,iban:string,bic:string,bank:string}>} */
export function loadProfiles() {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((p) => p && typeof p === 'object' && typeof p.id === 'string') : [];
  } catch (e) {
    return [];
  }
}

function saveProfilesRaw(list) {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Adds a new profile, or replaces an existing one when `profile.id`
 * matches one already stored (used by the "edit" path in the UI).
 * @returns {{ok:boolean, error?:string, profile?:Object}}
 */
export function addProfile(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const name = safeStr(p.name).trim();
  const iban = safeStr(p.iban).trim();
  if (!name || !iban) return { ok: false, error: 'missing_fields' };
  const entry = {
    id: (typeof p.id === 'string' && p.id) ? p.id : randomId('profile'),
    name, iban,
    bic: safeStr(p.bic).trim(),
    bank: safeStr(p.bank).trim(),
  };
  const list = loadProfiles();
  const idx = list.findIndex((x) => x.id === entry.id);
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  saveProfilesRaw(list);
  return { ok: true, profile: entry };
}

/** @returns {Array} the profile list after removal. */
export function removeProfile(id) {
  const list = loadProfiles().filter((p) => p.id !== id);
  saveProfilesRaw(list);
  return list;
}

// ═══════════════════════ multi-block payments ═══════════════════════════════
//
// A "block" is one pasted/uploaded chunk of payment rows with its own
// column mapping (the UI can offer several such blocks, e.g. one per
// source spreadsheet). Two ways to turn N blocks into files:
//   - one XML per block: call buildXml() once per block's own mapped
//     payments (ordinary generator-pain001.js usage, nothing pro.js needs
//     to add) and offer each download in turn;
//   - merged into one file: mergeBlockPayments() concatenates every
//     block's validated payment rows into a single array, then a single
//     buildXml() call groups them into PmtInf sections by date exactly as
//     it already does for one big block (see generator-pain001.js
//     groupByDate) — merging never changes that per-date grouping rule.

/**
 * @param {Array<{payments:Array}>} blocks
 * @returns {Array} every block's payments, concatenated in block order.
 */
export function mergeBlockPayments(blocks) {
  const arr = Array.isArray(blocks) ? blocks : [];
  return arr.reduce((acc, b) => acc.concat(b && Array.isArray(b.payments) ? b.payments : []), []);
}

/** @returns {{count:number, sum:number, errCount:number}} */
export function blockTotals(payments) {
  const arr = Array.isArray(payments) ? payments : [];
  let sum = 0;
  let errCount = 0;
  arr.forEach((p) => {
    if (p && typeof p.amount === 'number' && Number.isFinite(p.amount)) sum += p.amount;
    if (p && p.hasError) errCount++;
  });
  return { count: arr.length, sum: Math.round(sum * 100) / 100, errCount };
}

// ═══════════════════════════════ history ═════════════════════════════════════

/** @returns {Array} up to HISTORY_MAX entries, most recent first. */
export function loadHistory() {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function writeHistory(list) {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    // Quota exceeded (large XML bodies): retry once with the XML bodies
    // stripped rather than silently losing the whole history entry.
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.map((x) => ({ ...x, xml: null }))));
      return true;
    } catch (e2) {
      return false;
    }
  }
}

/**
 * Prepends one entry (most-recent-first) and trims to HISTORY_MAX. The
 * generated XML is stored inline only up to HISTORY_XML_MAX_BYTES (UTF-8);
 * larger files keep only their metadata (date/count/sum/bank/filename) so
 * "znovu stiahnuť" degrades to "regenerate from your source data" instead
 * of silently blowing up localStorage's quota.
 * @param {{date?:string, count?:number, sum?:number, bank?:string, filename?:string, xml?:string}} entry
 * @returns {Object} the stored entry (with its generated id).
 */
export function addHistoryEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const xmlText = typeof e.xml === 'string' ? e.xml : '';
  const xmlBytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(xmlText).length : xmlText.length;
  const item = {
    id: randomId('h'),
    date: typeof e.date === 'string' && e.date ? e.date : new Date().toISOString(),
    count: Number.isFinite(Number(e.count)) ? Number(e.count) : 0,
    sum: Number.isFinite(Number(e.sum)) ? Number(e.sum) : 0,
    bank: safeStr(e.bank),
    filename: safeStr(e.filename),
    xml: (xmlText && xmlBytes <= HISTORY_XML_MAX_BYTES) ? xmlText : null,
  };
  const list = loadHistory();
  list.unshift(item);
  while (list.length > HISTORY_MAX) list.pop();
  writeHistory(list);
  return item;
}

/** @returns {boolean} true if the history was cleared (or was already empty). */
export function clearHistory() {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.removeItem(HISTORY_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.SepaGeneratorPro = {
    MAPPING_TEMPLATES, applyTemplate,
    loadProfiles, addProfile, removeProfile,
    mergeBlockPayments, blockTotals,
    loadHistory, addHistoryEntry, clearHistory,
  };
}
