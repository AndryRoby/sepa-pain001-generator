// doctor-pain001.js: SEPA pain.001 Doctor (slovenské banky) core logic.
//
// Pure, deterministic, 100% client-side: given the text of a SEPA
// pain.001.001.03 XML batch payment file (hromadný príkaz na úhradu) and the
// target Slovak bank, parses the XML with a small dependency-free tolerant
// parser (works identically in the browser and in Node: no DOMParser, no
// npm dependency) and cross-checks it against that bank's own published
// import requirements, returning concrete problems + copy-paste fixes.
//
// Nothing in this file makes a network request. It only reads the string /
// object you pass to diagnose().
//
// Sources (fetched directly, quoted/paraphrased inline near each check):
//  - Tatra banka: "Prenosový formát pain.001.001.03 v štruktúre XML"
//      C:\Users\User\Downloads\prenosovy_formatpain001.pdf (read in full,
//      pages 1-8): GrpHdr/PmtInf field tables, "Max. 500 transakcií v
//      súbore", ReqdExctnDt "Nesmie byť spätný dátum a dopredný dátum viac
//      ako 31 dní", DbtrAgt/BIC "Musí byť iba TATRSKBX", CdtrAgt/BIC
//      derivation-from-IBAN rule, Slovak BBAN modulo-11 check on the last 10
//      digits of a Slovak creditor IBAN, "Povolená je iba jedna inštancia
//      Ustrd."
//  - VÚB, a.s.: "Popis formátu pre SEPA úhrady - SCT"
//      https://app.vub.sk/source/files/vubweb/sekundarna-navigacia/informacny-servis/sepa-aplikacie/sct_klient_f.pdf
//      (fetched directly): "VÚB akceptuje platby s požadovaným dátumom
//      zaúčtovania platby max +30 dní vopred", DbtrAgt BIC "SUBASKBX",
//      Creditor Agent BIC AT23 marked Mandatory ("M"), PmtMtd "TRF", SvcLvl
//      Cd "SEPA", ChrgBr "SLEV", InstrPrty NORM/HIGH with HIGH processed as
//      a priority/fee-bearing payment instead of standard SEPA.
//  - ČSOB: "BusinessBanking Lite a SEPA" (20.08.2015)
//      https://www.csob.sk/documents/11005/123723/BB_SEPA_01022016.pdf
//      (fetched directly): "SEPA XML s diakritikou nie je možné do
//      BusinessBanking Lite importovať", exact allowed character set
//      (a-z, A-Z, 0-9, / – ? : ( ) . , ' +), BIC banky príjemcu "od 1.2.2016
//      bude BIC nepovinný", VS/ŠS/KS convention "/VS.../SS.../KS..." in
//      that exact order with worked wrong-order examples.
//  - ISO 20022 pain.001.001.03 (base schema referenced by all of the above;
//      https://www.iso20022.org/) and the EPC SEPA Credit Transfer scheme
//      rulebook (https://www.europeanpaymentscouncil.eu/): general
//      Max35Text/Max70Text/Max140Text field-length conventions, EUR-only
//      InstdAmt, PmtMtd=TRF / ChrgBr=SLEV as scheme-level fixed values.
//  - Slovenská sporiteľňa (SLSP): no field-level pain.001 spec is published
//      the way the three above are; the one documented, checkable rule used
//      here is Business24's requirement of PmtTpInf/LclInstrm/Cd = "INST"
//      to route a payment as an instant SEPA transfer instead of a standard
//      one (SLSP's own public Business24 documentation).
//
// Works as an ES module (import { diagnose, expectedValues } from
// './doctor-pain001.js') and, when loaded with <script type="module">, also
// publishes window.SepaDoctor = { diagnose, expectedValues } for
// console/debug use.

// ───────────────────────────── small helpers ─────────────────────────────

function safeStr(v) {
  return typeof v === 'string' ? v : '';
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ───────────────────────── tolerant XML → tree parser ─────────────────────
// Deliberately not DOMParser (unavailable in Node, and we want byte-for-byte
// identical behaviour in the browser and in tests.mjs). Handles elements,
// attributes, text, CDATA, comments, and the XML declaration / DOCTYPE
// (skipped). Tracks well-formedness (unclosed / mismatched tags) without
// giving up on the rest of the document: a bank's own import will refuse a
// malformed file outright, but we still want to report every other problem
// we can find in what we did manage to parse.

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITY_MAP, body) ? ENTITY_MAP[body] : m;
  });
}

function localName(tag) {
  const i = tag.lastIndexOf(':');
  return i === -1 ? tag : tag.slice(i + 1);
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([^\s=\/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(str))) {
    attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
  }
  return attrs;
}

function makeNode(tag, attrs, parent) {
  return { tag: localName(tag), rawTag: tag, attrs: attrs || {}, children: [], parent: parent || null };
}

function parseXml(text) {
  const src = safeStr(text).replace(/^\uFEFF/, '');
  const errors = [];
  const root = makeNode('#root', {}, null);
  let current = root;
  const stack = [root];
  let i = 0;
  const len = src.length;
  let sawAnyElement = false;

  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      const text = src.slice(i);
      if (text.trim()) current.children.push({ type: 'text', text: decodeEntities(text) });
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      if (text.trim()) current.children.push({ type: 'text', text: decodeEntities(text) });
    }

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      const content = end === -1 ? src.slice(lt + 9) : src.slice(lt + 9, end);
      current.children.push({ type: 'text', text: content });
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      // DOCTYPE or similar: skip to next '>' (no nested-bracket support, fine for pain.001 files)
      const end = src.indexOf('>', lt + 2);
      i = end === -1 ? len : end + 1;
      continue;
    }

    // find end of this tag, respecting quoted attribute values
    let j = lt + 1;
    let inQuote = null;
    while (j < len) {
      const c = src[j];
      if (inQuote) {
        if (c === inQuote) inQuote = null;
      } else if (c === '"' || c === "'") {
        inQuote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    if (j >= len) {
      errors.push('Nezatvorený tag na pozícii ' + lt + ' (chýba ">").');
      break;
    }
    const inner = src.slice(lt + 1, j);
    i = j + 1;

    if (inner.startsWith('/')) {
      const closeName = inner.slice(1).trim();
      // pop stack looking for a matching open tag (tolerant of a bad nesting)
      let foundIdx = -1;
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].rawTag === closeName) { foundIdx = k; break; }
      }
      if (foundIdx === -1) {
        errors.push(`Zatvárací tag </${closeName}> nemá zodpovedajúci otvárací tag.`);
      } else {
        if (foundIdx !== stack.length - 1) {
          errors.push(`Tag <${stack[stack.length - 1].rawTag}> nebol správne zatvorený pred </${closeName}>.`);
        }
        stack.length = foundIdx;
        current = stack[stack.length - 1];
      }
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = (selfClosing ? inner.slice(0, -1) : inner).trim();
    const nameMatch = body.match(/^([^\s\/]+)/);
    if (!nameMatch) continue;
    const tagName = nameMatch[1];
    const attrs = parseAttrs(body.slice(nameMatch[0].length));
    const node = makeNode(tagName, attrs, current);
    current.children.push({ type: 'element', node });
    sawAnyElement = true;
    if (!selfClosing) {
      stack.push(node);
      current = node;
    }
  }

  if (stack.length > 1) {
    errors.push('Nasledovné tagy neboli zatvorené: ' + stack.slice(1).map((n) => n.rawTag).join(', '));
  }
  if (!sawAnyElement) {
    errors.push('V súbore sa nenašiel žiadny XML element.');
  }

  return { root, malformed: errors.length > 0, errors };
}

// ── tree query helpers (operate on the {tag, attrs, children} node shape) ──

function elementChildren(node) {
  if (!node) return [];
  return node.children.filter((c) => c.type === 'element').map((c) => c.node);
}

function firstChild(node, tag) {
  if (!node) return null;
  const found = node.children.find((c) => c.type === 'element' && c.node.tag === tag);
  return found ? found.node : null;
}

function allChildren(node, tag) {
  if (!node) return [];
  return node.children.filter((c) => c.type === 'element' && c.node.tag === tag).map((c) => c.node);
}

function findAll(node, tag, out) {
  out = out || [];
  if (!node) return out;
  for (const c of node.children) {
    if (c.type === 'element') {
      if (c.node.tag === tag) out.push(c.node);
      findAll(c.node, tag, out);
    }
  }
  return out;
}

function textOf(node) {
  if (!node) return '';
  let out = '';
  for (const c of node.children) {
    if (c.type === 'text') out += c.text;
  }
  return out.trim();
}

function path(node, tag) {
  return node ? firstChild(node, tag) : null;
}

// ───────────────────────────── IBAN helpers ────────────────────────────────

const IBAN_LENGTH_BY_COUNTRY = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GI: 23, GL: 18, GR: 27,
  HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21,
  MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19,
  SK: 24, SM: 27, VA: 22,
};

// Countries in the SEPA scheme geographical scope (EU/EEA + a handful of
// participating non-EU countries) per the EPC SEPA scheme rulebooks.
const SEPA_COUNTRIES = new Set([
  'AD', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE',
  'GI', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'MC',
  'NL', 'NO', 'PL', 'PT', 'RO', 'SM', 'SK', 'SI', 'ES', 'SE', 'CH', 'GB',
  'VA',
]);

function normalizeIban(raw) {
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

function checkIban(rawIban) {
  const iban = normalizeIban(rawIban);
  const result = { raw: rawIban, value: iban, present: iban.length > 0, formatOk: false, checksumOk: false, country: '', lengthOk: false, isSepaCountry: false };
  if (!iban) return result;
  const m = iban.match(/^([A-Z]{2})(\d{2})([A-Z0-9]+)$/);
  if (!m) return result;
  result.country = m[1];
  result.formatOk = true;
  result.isSepaCountry = SEPA_COUNTRIES.has(result.country);
  const expectedLen = IBAN_LENGTH_BY_COUNTRY[result.country];
  result.lengthOk = expectedLen ? iban.length === expectedLen : iban.length >= 15 && iban.length <= 34;
  try {
    result.checksumOk = ibanMod97(ibanNumericString(iban)) === 1;
  } catch (e) {
    result.checksumOk = false;
  }
  return result;
}

// Slovak domestic BBAN check ("posledných 10 miest čísla IBAN musí
// vyhovovať algoritmu modulo11": Tatra banka spec, section 2.80): the last
// 10 digits of the IBAN (the "základné číslo účtu") weighted from the left
// by [6,3,7,9,10,5,8,4,2,1] must sum to a multiple of 11.
const SK_MOD11_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

function skModulo11Ok(iban) {
  const last10 = iban.slice(-10);
  if (!/^\d{10}$/.test(last10)) return null; // not applicable / can't check
  let sum = 0;
  for (let k = 0; k < 10; k++) sum += (last10.charCodeAt(k) - 48) * SK_MOD11_WEIGHTS[k];
  return sum % 11 === 0;
}

// ─────────────────────────────── BIC helpers ───────────────────────────────

const BIC_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

function bicFormatOk(bic) {
  return BIC_RE.test(safeStr(bic).toUpperCase());
}

// Four-digit Slovak domestic bank codes → BIC, for the four banks this tool
// targets (embedded in every Slovak IBAN's BBAN as the first 4 digits).
const SK_BANK_CODE_TO_BIC = {
  '1100': 'TATRSKBX',
  '0900': 'GIBASKBX',
  '0200': 'SUBASKBX',
  '7500': 'CEKOSKBX',
};

const BANKS = {
  tatrabanka: { label: 'Tatra banka', bic: 'TATRSKBX', execWindowDays: 31, cdtrBicPolicy: 'derivable' },
  slsp: { label: 'Slovenská sporiteľňa', bic: 'GIBASKBX', execWindowDays: null, cdtrBicPolicy: 'unspecified' },
  vub: { label: 'VÚB', bic: 'SUBASKBX', execWindowDays: 30, cdtrBicPolicy: 'mandatory' },
  csob: { label: 'ČSOB', bic: 'CEKOSKBX', execWindowDays: null, cdtrBicPolicy: 'optional' },
  generic: { label: 'iná / neuvedená banka', bic: null, execWindowDays: null, cdtrBicPolicy: 'unspecified' },
};

function bankInfo(bankKey) {
  return BANKS[bankKey] || BANKS.generic;
}

// ─────────────────────── SEPA character set / diacritics ──────────────────
// ČSOB's own document spells out the allowed set exactly (see file header);
// used here as the general SEPA-safe character set for every bank, per the
// same convention EPC's implementation guidelines describe informally.

const SEPA_CHARSET_RE = /^[A-Za-z0-9 \/\-–?:().,'+]*$/;

const DIACRITIC_MAP = {
  á: 'a', ä: 'a', č: 'c', ď: 'd', é: 'e', í: 'i', ľ: 'l', ĺ: 'l', ň: 'n',
  ó: 'o', ô: 'o', ŕ: 'r', š: 's', ť: 't', ú: 'u', ý: 'y', ž: 'z',
  ě: 'e', ř: 'r', ů: 'u',
  Á: 'A', Ä: 'A', Č: 'C', Ď: 'D', É: 'E', Í: 'I', Ľ: 'L', Ĺ: 'L', Ň: 'N',
  Ó: 'O', Ô: 'O', Ŕ: 'R', Š: 'S', Ť: 'T', Ú: 'U', Ý: 'Y', Ž: 'Z',
  Ě: 'E', Ř: 'R', Ů: 'U',
};

function hasDiacritics(str) {
  for (const ch of str) if (Object.prototype.hasOwnProperty.call(DIACRITIC_MAP, ch)) return true;
  return false;
}

function transliterate(str) {
  let out = '';
  for (const ch of str) out += Object.prototype.hasOwnProperty.call(DIACRITIC_MAP, ch) ? DIACRITIC_MAP[ch] : ch;
  return out;
}

function otherInvalidChars(str) {
  const bad = new Set();
  for (const ch of str) {
    if (!SEPA_CHARSET_RE.test(ch) && !Object.prototype.hasOwnProperty.call(DIACRITIC_MAP, ch)) bad.add(ch);
  }
  return Array.from(bad);
}

// ────────────────────────────── date helpers ───────────────────────────────

function parseIsoDate(str) {
  const s = safeStr(str).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null; // e.g. 2024-02-30
  return d;
}

function daysBetweenUtcDates(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  const da = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((db - da) / MS);
}

// ─────────────────────────── VS/ŠS/KS reference symbols ───────────────────
// National Bank of Slovakia convention, packed into EndToEndId in the exact
// order /VS.../SS.../KS... (ČSOB's guide, see file header, with worked
// examples of the wrong order breaking counterparty reconciliation).

function analyzeReferenceSymbols(endToEndId) {
  const s = safeStr(endToEndId);
  const re = /\/(VS|SS|KS)(\d*)/gi;
  const found = [];
  let m;
  while ((m = re.exec(s))) found.push({ kind: m[1].toUpperCase(), value: m[2], index: m.index });
  if (found.length === 0) return null;

  const order = found.map((f) => f.kind);
  const rank = { VS: 0, SS: 1, KS: 2 };
  let orderOk = true;
  for (let k = 1; k < order.length; k++) {
    if (rank[order[k]] < rank[order[k - 1]]) orderOk = false;
  }
  const maxLen = { VS: 10, SS: 10, KS: 4 };
  const lengthIssues = found.filter((f) => f.value.length > maxLen[f.kind]);
  const nonNumeric = /\/(VS|SS|KS)([^\/]*)/gi;
  let m2;
  const nonNumericIssues = [];
  while ((m2 = nonNumeric.exec(s))) {
    if (m2[2] && !/^\d*$/.test(m2[2])) nonNumericIssues.push({ kind: m2[1].toUpperCase(), value: m2[2] });
  }

  const by = {};
  for (const f of found) by[f.kind] = f.value;
  const canonical = '/VS' + (by.VS || '') + '/SS' + (by.SS || '') + '/KS' + (by.KS || '');

  return { found, order, orderOk, lengthIssues, nonNumericIssues, canonical };
}

// ────────────────────────────── amount helpers ─────────────────────────────

function parseAmountText(str) {
  const s = safeStr(str).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// ──────────────────────────────── main logic ───────────────────────────────

const PAIN_NAMESPACE = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function sortProblems(problems) {
  return problems
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => (SEVERITY_ORDER[a.p.severity] - SEVERITY_ORDER[b.p.severity]) || (a.idx - b.idx))
    .map((x) => x.p);
}

function fmtAmount(n) {
  return n.toFixed(2);
}

/**
 * @param {{xml?: string, bank?: 'tatrabanka'|'slsp'|'vub'|'csob'|'generic', expectedTxCount?: number|null}} input
 * @returns {{status:'pass'|'warn'|'fail', summary:string, bank:string, expected:object, stats:object, problems:Array, fixes:Array, checklist:string[], disclaimer:string}}
 */
export function diagnose(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  const xmlText = safeStr(cfg.xml);
  const bankKey = ['tatrabanka', 'slsp', 'vub', 'csob', 'generic'].includes(cfg.bank) ? cfg.bank : 'generic';
  const bank = bankInfo(bankKey);
  const expectedTxCount = isNum(cfg.expectedTxCount) ? cfg.expectedTxCount : null;

  const problems = [];
  const checklist = [];

  function addProblem(p) {
    problems.push({ code: p.code, severity: p.severity, message: p.message, path: p.path || '', value: p.value === undefined ? '' : String(p.value), fix: p.fix === undefined ? '' : String(p.fix) });
  }

  const expected = {
    bank: bankKey,
    bankLabel: bank.label,
    bankBic: bank.bic,
    schemaNamespace: PAIN_NAMESPACE,
    execWindowDays: bank.execWindowDays,
    nbOfTxsShouldBe: null,
    ctrlSumShouldBe: null,
  };
  const stats = { txCount: 0, pmtInfCount: 0, sum: '0.00', currencies: [], banksDetected: [] };

  if (!xmlText.trim()) {
    addProblem({
      code: 'xml_empty',
      severity: 'high',
      message: 'Nebol vložený žiadny XML obsah. Vložte celý súbor pain.001, ktorý ste exportovali z účtovného softvéru.',
      path: '',
    });
    return finish();
  }

  const parsed = parseXml(xmlText);
  if (parsed.malformed) {
    addProblem({
      code: 'xml_not_well_formed',
      severity: 'high',
      message: 'XML nie je správne formované (well-formed): ' + parsed.errors[0] + (parsed.errors.length > 1 ? ` (a ${parsed.errors.length - 1} ďalších problémov so štruktúrou.)` : '') + ' Banka takýto súbor odmietne skôr, než sa dostane k obsahu platieb.',
      path: '',
    });
  }

  const documentEl = elementChildren(parsed.root).find((n) => n.tag === 'Document');
  if (!documentEl) {
    addProblem({
      code: 'root_missing',
      severity: 'high',
      message: 'Koreňový element <Document> sa v súbore nenašiel. Toto nie je platný pain.001 súbor (alebo XML je natoľko poškodené, že sa element nedá nájsť).',
      path: '',
    });
    return finish();
  }

  const ns = documentEl.attrs.xmlns || '';
  if (!ns) {
    addProblem({
      code: 'schema_namespace_missing',
      severity: 'medium',
      message: 'Element <Document> nemá nastavený menný priestor (xmlns). Všetky štyri banky spracúvajú pain.001.001.03 s menným priestorom "' + PAIN_NAMESPACE + '": bez neho môže import zlyhať alebo byť interpretovaný nesprávne.',
      path: 'Document',
      fix: `xmlns="${PAIN_NAMESPACE}"`,
    });
  } else if (ns !== PAIN_NAMESPACE) {
    const looksNewer = /pain\.001\.001\.0[4-9]|pain\.001\.001\.1\d/.test(ns);
    addProblem({
      code: 'schema_namespace_unexpected',
      severity: 'medium',
      message: `Menný priestor "${ns}" nie je pain.001.001.03. ${looksNewer ? 'Vyzerá to na novšiu verziu pain.001, ktorú tieto banky pri importe hromadného príkazu nepodporujú' : 'Tatra banka, SLSP, VÚB aj ČSOB pri importe hromadného príkazu spracúvajú pain.001.001.03'}: súbor s iným menným priestorom banka odmietne alebo import zlyhá bez jasnej príčiny.`,
      path: 'Document',
      value: ns,
      fix: `xmlns="${PAIN_NAMESPACE}"`,
    });
  }

  const cstmr = firstChild(documentEl, 'CstmrCdtTrfInitn');
  if (!cstmr) {
    addProblem({
      code: 'root_missing',
      severity: 'high',
      message: '<Document> neobsahuje <CstmrCdtTrfInitn>. Bez tohto elementu súbor nemá žiadnu platbu na spracovanie.',
      path: 'Document',
    });
    return finish();
  }

  // ── GrpHdr ──────────────────────────────────────────────────────────────
  const grpHdr = firstChild(cstmr, 'GrpHdr');
  const pmtInfList = allChildren(cstmr, 'PmtInf');
  const allTx = findAll(cstmr, 'CdtTrfTxInf');
  const actualTxCount = allTx.length;
  const actualSum = allTx.reduce((sum, tx) => {
    const amtEl = path(path(tx, 'Amt'), 'InstdAmt');
    const n = amtEl ? parseAmountText(textOf(amtEl)) : null;
    return sum + (n || 0);
  }, 0);

  expected.nbOfTxsShouldBe = actualTxCount;
  expected.ctrlSumShouldBe = fmtAmount(actualSum);
  stats.txCount = actualTxCount;
  stats.pmtInfCount = pmtInfList.length;
  stats.sum = fmtAmount(actualSum);

  if (pmtInfList.length === 0) {
    addProblem({ code: 'pmt_inf_missing', severity: 'high', message: 'Súbor neobsahuje žiadny blok <PmtInf>. Bez neho nie je čo spracovať.', path: 'CstmrCdtTrfInitn' });
  }
  if (actualTxCount === 0 && pmtInfList.length > 0) {
    addProblem({ code: 'cdt_trf_tx_inf_missing', severity: 'high', message: 'Ani jeden blok <PmtInf> neobsahuje transakciu <CdtTrfTxInf>. Súbor neprenáša žiadnu platbu.', path: 'CstmrCdtTrfInitn/PmtInf' });
  }

  if (grpHdr) {
    const msgIdEl = firstChild(grpHdr, 'MsgId');
    if (msgIdEl) {
      const msgId = textOf(msgIdEl);
      if (msgId.length > 35) {
        addProblem({ code: 'msg_id_too_long', severity: 'medium', message: `GrpHdr/MsgId má ${msgId.length} znakov, maximum je 35 (Max35Text). Banka môže hodnotu skrátiť alebo súbor odmietnuť.`, path: 'CstmrCdtTrfInitn/GrpHdr/MsgId', value: msgId, fix: msgId.slice(0, 35) });
      }
      if (msgId && !SEPA_CHARSET_RE.test(msgId)) {
        addProblem({ code: 'invalid_sepa_character', severity: 'low', message: 'GrpHdr/MsgId obsahuje znaky mimo bežnej SEPA znakovej sady (a-z A-Z 0-9 / - ? : ( ) . , \' + medzera). Odporúčame používať len tieto znaky pre istotu naprieč bankami.', path: 'CstmrCdtTrfInitn/GrpHdr/MsgId', value: msgId, fix: transliterate(msgId) });
      }
    } else {
      checklist.push('GrpHdr/MsgId nie je vyplnené: nepovinné pre Tatra banku, no odporúčame vlastný jedinečný identifikátor súboru pre spätné dohľadanie.');
    }

    const creDtTmEl = firstChild(grpHdr, 'CreDtTm');
    if (creDtTmEl) {
      const creDtTm = textOf(creDtTmEl);
      if (!parseIsoDate(creDtTm)) {
        addProblem({ code: 'cre_dt_tm_invalid_format', severity: 'medium', message: `GrpHdr/CreDtTm "${creDtTm}" nie je platný ISO dátum/čas (napr. 2026-09-04T09:00:00).`, path: 'CstmrCdtTrfInitn/GrpHdr/CreDtTm', value: creDtTm });
      }
    }

    const nbOfTxsEl = firstChild(grpHdr, 'NbOfTxs');
    if (nbOfTxsEl) {
      const declared = Number(textOf(nbOfTxsEl));
      if (!Number.isFinite(declared) || declared !== actualTxCount) {
        addProblem({
          code: 'nb_of_txs_mismatch',
          severity: 'high',
          message: `GrpHdr/NbOfTxs uvádza ${textOf(nbOfTxsEl) || '(prázdne)'}, ale súbor obsahuje ${actualTxCount} transakcií <CdtTrfTxInf>. Nezhoda počtu transakcií je jeden z najčastejších dôvodov zamietnutia importu.`,
          path: 'CstmrCdtTrfInitn/GrpHdr/NbOfTxs',
          value: textOf(nbOfTxsEl),
          fix: String(actualTxCount),
        });
      }
    } else {
      checklist.push(`GrpHdr/NbOfTxs nie je vyplnené: odporúčame doplniť presnú hodnotu ${actualTxCount}, aj keď Tatra banka toto pole nevyžaduje, iné importy naň spoliehajú.`);
    }

    const ctrlSumEl = firstChild(grpHdr, 'CtrlSum');
    if (ctrlSumEl) {
      const declared = parseAmountText(textOf(ctrlSumEl));
      if (declared === null || Math.abs(declared - actualSum) > 0.005) {
        addProblem({
          code: 'ctrl_sum_mismatch',
          severity: 'high',
          message: `GrpHdr/CtrlSum uvádza ${textOf(ctrlSumEl) || '(prázdne)'}, súčet InstdAmt všetkých transakcií je však ${fmtAmount(actualSum)}.`,
          path: 'CstmrCdtTrfInitn/GrpHdr/CtrlSum',
          value: textOf(ctrlSumEl),
          fix: fmtAmount(actualSum),
        });
      }
    } else {
      checklist.push(`GrpHdr/CtrlSum nie je vyplnené: odporúčame doplniť presnú hodnotu ${fmtAmount(actualSum)}.`);
    }

    const initgPty = firstChild(grpHdr, 'InitgPty');
    if (initgPty) {
      const nmEl = firstChild(initgPty, 'Nm');
      if (nmEl) {
        const nm = textOf(nmEl);
        if (bankKey === 'tatrabanka' && nm && !/^[A-Za-z0-9]{1,10}\/[A-Z]{2}$/.test(nm)) {
          addProblem({
            code: 'initg_pty_name_pattern',
            severity: 'low',
            message: `Tatra banka očakáva GrpHdr/InitgPty/Nm vo formáte [A-Za-z0-9]{1,10}/[A-Z]{2} (napr. "ABC1234567/SK"), ak je toto pole vyplnené. Hodnota "${nm}" tomuto vzoru nezodpovedá: pole je však celkovo nepovinné, takže ho pokojne aj úplne vynechajte.`,
            path: 'CstmrCdtTrfInitn/GrpHdr/InitgPty/Nm',
            value: nm,
          });
        }
        if (hasDiacritics(nm) || otherInvalidChars(nm).length) {
          reportCharset(nm, 'CstmrCdtTrfInitn/GrpHdr/InitgPty/Nm');
        }
      }
    }
  }

  // ── character-set scan helper (used across Dbtr/Cdtr/RmtInf/AdrLine) ───
  function reportCharset(value, elPath) {
    if (!value) return;
    if (hasDiacritics(value)) {
      addProblem({
        code: 'diacritics_in_field',
        severity: bankKey === 'csob' ? 'high' : 'medium',
        message: bankKey === 'csob'
          ? `"${value}" obsahuje diakritiku. ČSOB výslovne uvádza, že SEPA XML súbor s diakritikou sa do BusinessBanking Lite nedá importovať vôbec.`
          : `"${value}" obsahuje diakritiku. SEPA XML znaková sada (podľa dokumentácie ČSOB, platí všeobecne) povoľuje len a-z A-Z 0-9 / - ? : ( ) . , ' + a medzeru: diakritika môže spôsobiť odmietnutie importu.`,
        path: elPath,
        value,
        fix: transliterate(value),
      });
    }
    const other = otherInvalidChars(value);
    if (other.length) {
      addProblem({
        code: 'invalid_sepa_character',
        severity: bankKey === 'csob' ? 'high' : 'medium',
        message: `"${value}" obsahuje znak(y) mimo povolenej SEPA znakovej sady: ${other.map((c) => `"${c}"`).join(', ')}.`,
        path: elPath,
        value,
      });
    }
  }

  // ── walk each PmtInf block ───────────────────────────────────────────────
  let prevExecDate = null;

  pmtInfList.forEach((pmtInf, pmtIdx) => {
    const pmtPath = `CstmrCdtTrfInitn/PmtInf[${pmtIdx + 1}]`;
    const txList = allChildren(pmtInf, 'CdtTrfTxInf');

    if (bankKey === 'tatrabanka' && txList.length > 500) {
      addProblem({ code: 'pmt_inf_tx_count_exceeded', severity: 'high', message: `PmtInf[${pmtIdx + 1}] obsahuje ${txList.length} transakcií. Tatra banka povoľuje maximálne 500 transakcií v jednom bloku PmtInf ("Max. 500 transakcií v súbore"): súbor rozdeľte na viac blokov/súborov.`, path: pmtPath, value: String(txList.length) });
    } else if (bankKey !== 'tatrabanka' && txList.length > 500) {
      addProblem({ code: 'pmt_inf_tx_count_exceeded_generic', severity: 'low', message: `PmtInf[${pmtIdx + 1}] obsahuje ${txList.length} transakcií. Tatra banka má zdokumentovaný limit 500 transakcií na blok: aj iné banky bežne obmedzujú veľkosť dávky, overte limit vašej banky.`, path: pmtPath, value: String(txList.length) });
    }

    const pmtMtdEl = firstChild(pmtInf, 'PmtMtd');
    const pmtMtd = pmtMtdEl ? textOf(pmtMtdEl) : '';
    if (pmtMtd !== 'TRF') {
      addProblem({ code: 'pmt_mtd_invalid', severity: 'high', message: `PmtInf[${pmtIdx + 1}]/PmtMtd je "${pmtMtd || '(chýba)'}", musí byť "TRF" pre SEPA úhradu.`, path: `${pmtPath}/PmtMtd`, value: pmtMtd, fix: 'TRF' });
    }

    // PmtInf-level PmtTpInf/ChrgBr take precedence over the per-transaction
    // ones (VÚB spec: "Vyplnený môže byť element 2.6 ... alebo element 2.31
    // ... nie oba súčasne" / "hodnoty na úrovni Transaction information
    // nebudú spracované" when the PmtInf-level ones are present).
    const pmtTpInf = firstChild(pmtInf, 'PmtTpInf');
    const pmtInfInstrPrty = pmtTpInf ? textOf(firstChild(pmtTpInf, 'InstrPrty')) : '';
    const pmtInfSvcLvl = pmtTpInf ? textOf(path(pmtTpInf, 'SvcLvl') && firstChild(path(pmtTpInf, 'SvcLvl'), 'Cd')) : '';
    const pmtInfChrgBr = textOf(firstChild(pmtInf, 'ChrgBr'));

    const reqdExctnDtEl = firstChild(pmtInf, 'ReqdExctnDt');
    const reqdExctnDtRaw = reqdExctnDtEl ? textOf(reqdExctnDtEl) : '';
    if (!reqdExctnDtEl || !reqdExctnDtRaw) {
      addProblem({ code: 'exec_date_missing', severity: 'high', message: `PmtInf[${pmtIdx + 1}]/ReqdExctnDt chýba. Toto pole je povinné.`, path: `${pmtPath}/ReqdExctnDt` });
    } else {
      const d = parseIsoDate(reqdExctnDtRaw);
      if (!d) {
        addProblem({ code: 'exec_date_invalid_format', severity: 'high', message: `PmtInf[${pmtIdx + 1}]/ReqdExctnDt "${reqdExctnDtRaw}" nie je platný dátum vo formáte YYYY-MM-DD.`, path: `${pmtPath}/ReqdExctnDt`, value: reqdExctnDtRaw });
      } else {
        const now = new Date();
        const diffDays = daysBetweenUtcDates(now, d);
        if (diffDays < 0) {
          addProblem({ code: 'exec_date_in_past', severity: 'medium', message: `PmtInf[${pmtIdx + 1}]/ReqdExctnDt (${reqdExctnDtRaw}) je v minulosti. Banky spätný dátum požadovanej splatnosti neakceptujú.`, path: `${pmtPath}/ReqdExctnDt`, value: reqdExctnDtRaw });
        } else if (bank.execWindowDays != null && diffDays > bank.execWindowDays) {
          addProblem({ code: 'exec_date_too_far_future', severity: 'high', message: `PmtInf[${pmtIdx + 1}]/ReqdExctnDt (${reqdExctnDtRaw}) je ${diffDays} dní dopredu. ${bank.label} akceptuje maximálne ${bank.execWindowDays} dní vopred.`, path: `${pmtPath}/ReqdExctnDt`, value: reqdExctnDtRaw });
        } else if (bank.execWindowDays == null && diffDays > 31) {
          addProblem({ code: 'exec_date_too_far_future', severity: 'low', message: `PmtInf[${pmtIdx + 1}]/ReqdExctnDt (${reqdExctnDtRaw}) je ${diffDays} dní dopredu. Tatra banka aj VÚB majú zdokumentovaný limit 31, resp. 30 dní: overte limit vašej banky, ak nie je vybraná vyššie.`, path: `${pmtPath}/ReqdExctnDt`, value: reqdExctnDtRaw });
        }
        if (bankKey === 'tatrabanka') {
          if (prevExecDate && prevExecDate !== reqdExctnDtRaw) {
            addProblem({ code: 'exec_date_differs_across_pmtinf', severity: 'medium', message: `PmtInf[${pmtIdx + 1}]/ReqdExctnDt (${reqdExctnDtRaw}) sa líši od predchádzajúceho bloku PmtInf (${prevExecDate}). Tatra banka vyžaduje rovnaký dátum pre všetky platby v súbore.`, path: `${pmtPath}/ReqdExctnDt`, value: reqdExctnDtRaw });
          }
          prevExecDate = reqdExctnDtRaw;
        }
      }
    }

    const dbtr = firstChild(pmtInf, 'Dbtr');
    const dbtrNmEl = dbtr ? firstChild(dbtr, 'Nm') : null;
    const dbtrNm = dbtrNmEl ? textOf(dbtrNmEl) : '';
    if (!dbtrNm) {
      addProblem({ code: 'dbtr_name_missing', severity: 'high', message: `PmtInf[${pmtIdx + 1}]/Dbtr/Nm chýba. Meno platiteľa je povinné.`, path: `${pmtPath}/Dbtr/Nm` });
    } else {
      if (dbtrNm.length > 70) addProblem({ code: 'dbtr_name_too_long', severity: 'high', message: `PmtInf[${pmtIdx + 1}]/Dbtr/Nm má ${dbtrNm.length} znakov, maximum je 70.`, path: `${pmtPath}/Dbtr/Nm`, value: dbtrNm, fix: dbtrNm.slice(0, 70) });
      reportCharset(dbtrNm, `${pmtPath}/Dbtr/Nm`);
    }

    const dbtrAcctIban = textOf(path(path(pmtInf, 'DbtrAcct'), 'Id') && firstChild(path(path(pmtInf, 'DbtrAcct'), 'Id'), 'IBAN'));
    if (!dbtrAcctIban) {
      addProblem({ code: 'dbtr_iban_missing', severity: 'high', message: `PmtInf[${pmtIdx + 1}]/DbtrAcct/Id/IBAN chýba. IBAN debetného účtu je povinný.`, path: `${pmtPath}/DbtrAcct/Id/IBAN` });
    } else {
      const ibanCheck = checkIban(dbtrAcctIban);
      if (!ibanCheck.formatOk || !ibanCheck.lengthOk || !ibanCheck.checksumOk) {
        addProblem({ code: 'dbtr_iban_invalid', severity: 'high', message: `PmtInf[${pmtIdx + 1}]/DbtrAcct/Id/IBAN "${dbtrAcctIban}" nie je platný IBAN (${!ibanCheck.formatOk ? 'nesprávny formát' : !ibanCheck.lengthOk ? 'nesprávna dĺžka pre krajinu ' + ibanCheck.country : 'zlyhal kontrolný súčet MOD-97'}).`, path: `${pmtPath}/DbtrAcct/Id/IBAN`, value: dbtrAcctIban });
      } else if (dbtrAcctIban.replace(/\s+/g, '') !== dbtrAcctIban) {
        addProblem({ code: 'dbtr_iban_has_spaces', severity: 'low', message: `PmtInf[${pmtIdx + 1}]/DbtrAcct/Id/IBAN obsahuje medzery. IBAN v XML sa zapisuje bez medzier.`, path: `${pmtPath}/DbtrAcct/Id/IBAN`, value: dbtrAcctIban, fix: normalizeIban(dbtrAcctIban) });
      }
      recordDetectedBank(ibanCheck.value);
    }

    const dbtrAgtBic = textOf(path(path(pmtInf, 'DbtrAgt'), 'FinInstnId') && firstChild(path(path(pmtInf, 'DbtrAgt'), 'FinInstnId'), 'BIC'));
    if (!dbtrAgtBic) {
      addProblem({ code: 'dbtr_bic_missing', severity: 'medium', message: `PmtInf[${pmtIdx + 1}]/DbtrAgt/FinInstnId/BIC chýba. ${bank.bic ? `${bank.label} vyžaduje presne "${bank.bic}".` : 'Odporúčame BIC banky platiteľa vyplniť.'}`, path: `${pmtPath}/DbtrAgt/FinInstnId/BIC`, fix: bank.bic || undefined });
    } else if (bank.bic && dbtrAgtBic.toUpperCase() !== bank.bic) {
      addProblem({ code: 'dbtr_bic_mismatch', severity: 'high', message: `PmtInf[${pmtIdx + 1}]/DbtrAgt/FinInstnId/BIC je "${dbtrAgtBic}", ale pre ${bank.label} musí byť presne "${bank.bic}". Súbor s účtom vedeným v inej banke bude bankou pri importe zamietnutý.`, path: `${pmtPath}/DbtrAgt/FinInstnId/BIC`, value: dbtrAgtBic, fix: bank.bic });
    } else if (!bicFormatOk(dbtrAgtBic)) {
      addProblem({ code: 'dbtr_bic_format_invalid', severity: 'medium', message: `PmtInf[${pmtIdx + 1}]/DbtrAgt/FinInstnId/BIC "${dbtrAgtBic}" nemá platný formát BIC (8 alebo 11 znakov).`, path: `${pmtPath}/DbtrAgt/FinInstnId/BIC`, value: dbtrAgtBic });
    }

    if (txList.length === 0) {
      addProblem({ code: 'cdt_trf_tx_inf_missing', severity: 'high', message: `PmtInf[${pmtIdx + 1}] neobsahuje žiadnu transakciu <CdtTrfTxInf>.`, path: `${pmtPath}` });
    }

    const seenEndToEnd = new Map();

    txList.forEach((tx, txIdx) => {
      const txPath = `${pmtPath}/CdtTrfTxInf[${txIdx + 1}]`;
      const txPmtTpInf = firstChild(tx, 'PmtTpInf');
      const txInstrPrty = txPmtTpInf ? textOf(firstChild(txPmtTpInf, 'InstrPrty')) : '';
      const txSvcLvl = txPmtTpInf ? textOf(path(txPmtTpInf, 'SvcLvl') && firstChild(path(txPmtTpInf, 'SvcLvl'), 'Cd')) : '';
      const txChrgBr = textOf(firstChild(tx, 'ChrgBr'));

      const effInstrPrty = pmtInfInstrPrty || txInstrPrty;
      const effSvcLvl = pmtInfSvcLvl || txSvcLvl;
      const effChrgBr = pmtInfChrgBr || txChrgBr;

      if (effInstrPrty && effInstrPrty !== 'NORM') {
        addProblem({ code: 'instr_prty_not_norm', severity: 'medium', message: `${txPath}: InstrPrty je "${effInstrPrty}". Pre SEPA úhradu musí byť "NORM": hodnota "HIGH" spôsobí, že banka platbu spracuje ako prioritnú/spoplatnenú, nie ako štandardnú SEPA úhradu.`, path: `${txPath}/PmtTpInf/InstrPrty`, value: effInstrPrty, fix: 'NORM' });
      }
      if (!effSvcLvl) {
        addProblem({ code: 'svc_lvl_missing_or_invalid', severity: 'high', message: `${txPath}: PmtTpInf/SvcLvl/Cd chýba (na úrovni PmtInf aj transakcie). Musí byť "SEPA".`, path: `${txPath}/PmtTpInf/SvcLvl/Cd`, fix: 'SEPA' });
      } else if (effSvcLvl !== 'SEPA') {
        addProblem({ code: 'svc_lvl_missing_or_invalid', severity: 'high', message: `${txPath}: PmtTpInf/SvcLvl/Cd je "${effSvcLvl}", musí byť "SEPA".`, path: `${txPath}/PmtTpInf/SvcLvl/Cd`, value: effSvcLvl, fix: 'SEPA' });
      }
      if (!effChrgBr) {
        addProblem({ code: 'chrg_br_missing', severity: 'medium', message: `${txPath}: ChrgBr chýba (na úrovni PmtInf aj transakcie). Pre SEPA úhradu musí byť "SLEV": bez neho ho banka síce zvyčajne doplní sama (VÚB), ale spoliehať sa na to nie je bezpečné naprieč bankami.`, path: `${txPath}/ChrgBr`, fix: 'SLEV' });
      } else if (effChrgBr !== 'SLEV') {
        addProblem({ code: 'chrg_br_invalid', severity: 'high', message: `${txPath}: ChrgBr je "${effChrgBr}", musí byť "SLEV" pre SEPA úhradu.`, path: `${txPath}/ChrgBr`, value: effChrgBr, fix: 'SLEV' });
      }

      const pmtId = firstChild(tx, 'PmtId');
      const endToEndEl = pmtId ? firstChild(pmtId, 'EndToEndId') : null;
      const endToEndId = endToEndEl ? textOf(endToEndEl) : '';
      if (!endToEndId) {
        addProblem({ code: 'end_to_end_id_missing', severity: 'high', message: `${txPath}: PmtId/EndToEndId chýba. Toto pole je povinné a zároveň jediné miesto pre VS/ŠS/KS.`, path: `${txPath}/PmtId/EndToEndId` });
      } else {
        if (endToEndId.length > 35) {
          addProblem({ code: 'end_to_end_id_too_long', severity: 'high', message: `${txPath}: PmtId/EndToEndId má ${endToEndId.length} znakov, maximum je 35.`, path: `${txPath}/PmtId/EndToEndId`, value: endToEndId, fix: endToEndId.slice(0, 35) });
        }
        const refs = analyzeReferenceSymbols(endToEndId);
        if (refs) {
          if (!refs.orderOk) {
            addProblem({ code: 'reference_symbol_order', severity: 'medium', message: `${txPath}: EndToEndId "${endToEndId}" má VS/ŠS/KS v nesprávnom poradí. Konvencia NBS vyžaduje presne /VS/SS/KS: inak si protistrana platbu nevie automaticky spárovať s faktúrou (samotný prevod prejde v poriadku).`, path: `${txPath}/PmtId/EndToEndId`, value: endToEndId, fix: refs.canonical });
          }
          if (refs.lengthIssues.length) {
            const limits = { VS: 10, SS: 10, KS: 4 };
            for (const li of refs.lengthIssues) {
              addProblem({ code: 'reference_symbol_too_long', severity: 'medium', message: `${txPath}: EndToEndId: ${li.kind}="${li.value}" má ${li.value.length} číslic, maximum je ${limits[li.kind]}.`, path: `${txPath}/PmtId/EndToEndId`, value: endToEndId });
            }
          }
          if (refs.nonNumericIssues.length) {
            for (const ni of refs.nonNumericIssues) {
              addProblem({ code: 'reference_symbol_non_numeric', severity: 'medium', message: `${txPath}: EndToEndId: ${ni.kind}="${ni.value}" obsahuje nečíselné znaky. VS/ŠS/KS sú vždy len číslice.`, path: `${txPath}/PmtId/EndToEndId`, value: endToEndId });
            }
          }
        }
        if (seenEndToEnd.has(endToEndId)) {
          addProblem({ code: 'duplicate_end_to_end_id', severity: 'medium', message: `${txPath}: EndToEndId "${endToEndId}" sa v súbore opakuje (prvýkrát v ${seenEndToEnd.get(endToEndId)}). Duplicitné EndToEndId sťažujú párovanie platieb a niektoré banky ich odmietajú.`, path: `${txPath}/PmtId/EndToEndId`, value: endToEndId });
        } else {
          seenEndToEnd.set(endToEndId, txPath);
        }
      }

      const amtEl = firstChild(tx, 'Amt');
      const instdAmtEl = amtEl ? firstChild(amtEl, 'InstdAmt') : null;
      if (!instdAmtEl) {
        addProblem({ code: 'amount_missing', severity: 'high', message: `${txPath}: Amt/InstdAmt chýba. Suma platby je povinná.`, path: `${txPath}/Amt/InstdAmt` });
      } else {
        const ccy = instdAmtEl.attrs.Ccy || instdAmtEl.attrs.ccy || '';
        const amtText = textOf(instdAmtEl);
        const amtVal = parseAmountText(amtText);
        if (ccy !== 'EUR') {
          addProblem({ code: 'amount_currency_invalid', severity: 'high', message: `${txPath}: Amt/InstdAmt má menu "${ccy || '(chýba)'}", pre SEPA úhradu musí byť "EUR".`, path: `${txPath}/Amt/InstdAmt/@Ccy`, value: ccy, fix: 'EUR' });
        }
        if (amtVal === null) {
          addProblem({ code: 'amount_format_invalid', severity: 'medium', message: `${txPath}: Amt/InstdAmt "${amtText}" nemá platný formát čísla (očakáva sa napr. "450.00", bodka ako desatinný oddeľovač).`, path: `${txPath}/Amt/InstdAmt`, value: amtText });
        } else {
          if (amtVal <= 0) {
            addProblem({ code: 'amount_non_positive', severity: 'high', message: `${txPath}: Amt/InstdAmt je ${amtText}. Suma platby musí byť kladná.`, path: `${txPath}/Amt/InstdAmt`, value: amtText });
          }
          const decMatch = amtText.match(/\.(\d+)$/);
          if (decMatch && decMatch[1].length > 2) {
            addProblem({ code: 'amount_format_invalid', severity: 'medium', message: `${txPath}: Amt/InstdAmt "${amtText}" má viac ako 2 desatinné miesta. EUR sumy sa zapisujú s presne 2 desatinnými miestami.`, path: `${txPath}/Amt/InstdAmt`, value: amtText, fix: fmtAmount(amtVal) });
          }
        }
      }

      const cdtr = firstChild(tx, 'Cdtr');
      const cdtrNmEl = cdtr ? firstChild(cdtr, 'Nm') : null;
      const cdtrNm = cdtrNmEl ? textOf(cdtrNmEl) : '';
      if (!cdtrNm) {
        const severity = bankKey === 'tatrabanka' ? 'medium' : 'high';
        const msg = bankKey === 'tatrabanka'
          ? `${txPath}: Cdtr/Nm chýba. Tatra banka ho pri spracovaní doplní z účtu príjemcu, ak je vedený v Tatra banke: ak nie, doplní hodnotu "NOTPROVIDED", čo protistrana uvidí namiesto skutočného mena.`
          : `${txPath}: Cdtr/Nm chýba. Meno príjemcu je povinné.`;
        addProblem({ code: 'cdtr_name_missing', severity, message: msg, path: `${txPath}/Cdtr/Nm` });
      } else {
        if (cdtrNm.length > 70) addProblem({ code: 'cdtr_name_too_long', severity: 'high', message: `${txPath}: Cdtr/Nm má ${cdtrNm.length} znakov, maximum je 70.`, path: `${txPath}/Cdtr/Nm`, value: cdtrNm, fix: cdtrNm.slice(0, 70) });
        reportCharset(cdtrNm, `${txPath}/Cdtr/Nm`);
      }

      const cdtrAcctIban = textOf(path(path(tx, 'CdtrAcct'), 'Id') && firstChild(path(path(tx, 'CdtrAcct'), 'Id'), 'IBAN'));
      let cdtrIbanCheck = null;
      if (!cdtrAcctIban) {
        addProblem({ code: 'cdtr_iban_missing', severity: 'high', message: `${txPath}: CdtrAcct/Id/IBAN chýba. IBAN účtu príjemcu je povinný.`, path: `${txPath}/CdtrAcct/Id/IBAN` });
      } else {
        cdtrIbanCheck = checkIban(cdtrAcctIban);
        if (!cdtrIbanCheck.formatOk || !cdtrIbanCheck.lengthOk || !cdtrIbanCheck.checksumOk) {
          addProblem({ code: 'cdtr_iban_invalid', severity: 'high', message: `${txPath}: CdtrAcct/Id/IBAN "${cdtrAcctIban}" nie je platný IBAN (${!cdtrIbanCheck.formatOk ? 'nesprávny formát' : !cdtrIbanCheck.lengthOk ? 'nesprávna dĺžka pre krajinu ' + cdtrIbanCheck.country : 'zlyhal kontrolný súčet MOD-97'}).`, path: `${txPath}/CdtrAcct/Id/IBAN`, value: cdtrAcctIban });
        } else {
          if (cdtrIbanCheck.country === 'SK') {
            const mod11 = skModulo11Ok(cdtrIbanCheck.value);
            if (mod11 === false) {
              addProblem({
                code: 'cdtr_iban_sk_modulo11_failed',
                severity: bankKey === 'tatrabanka' ? 'high' : 'low',
                message: `${txPath}: CdtrAcct/Id/IBAN "${cdtrAcctIban}" má platný medzinárodný kontrolný súčet (MOD-97), ale posledných 10 číslic neprejde slovenskou kontrolou modulo-11 na základné číslo účtu. ${bankKey === 'tatrabanka' ? 'Tatra banka túto kontrolu vykonáva pri slovenských kreditných IBAN a platbu by zamietla.' : 'Túto dodatočnú kontrolu dokumentuje Tatra banka; pri inej banke overte, či ju tiež vykonáva.'} Skontrolujte prepis čísla účtu.`,
                path: `${txPath}/CdtrAcct/Id/IBAN`,
                value: cdtrAcctIban,
              });
            }
          } else if (!cdtrIbanCheck.isSepaCountry) {
            addProblem({ code: 'cdtr_iban_outside_sepa', severity: 'medium', message: `${txPath}: CdtrAcct/Id/IBAN "${cdtrAcctIban}" patrí krajine "${cdtrIbanCheck.country}", ktorá nie je v SEPA priestore. SEPA úhrada mimo SEPA priestoru bude bankou spracovaná ako cezhraničná platba (iné poplatky) alebo odmietnutá.`, path: `${txPath}/CdtrAcct/Id/IBAN`, value: cdtrAcctIban });
          }
        }
        recordDetectedBank(cdtrIbanCheck.value);
      }

      const cdtrAgt = firstChild(tx, 'CdtrAgt');
      const cdtrAgtBic = textOf(path(cdtrAgt, 'FinInstnId') && firstChild(path(cdtrAgt, 'FinInstnId'), 'BIC'));
      if (!cdtrAgtBic) {
        if (bank.cdtrBicPolicy === 'mandatory') {
          addProblem({ code: 'cdtr_bic_missing_required', severity: 'high', message: `${txPath}: CdtrAgt/FinInstnId/BIC chýba. VÚB vo vlastnej špecifikácii (Creditor Agent BIC, AT23) označuje toto pole ako povinné (Mandatory): na rozdiel od Tatra banky, ktorá ho vie odvodiť z IBAN.`, path: `${txPath}/CdtrAgt/FinInstnId/BIC` });
        } else if (bank.cdtrBicPolicy === 'derivable') {
          if (cdtrIbanCheck && cdtrIbanCheck.formatOk && !cdtrIbanCheck.isSepaCountry) {
            addProblem({ code: 'cdtr_bic_missing_required', severity: 'high', message: `${txPath}: CdtrAgt/FinInstnId/BIC chýba a IBAN príjemcu nepatrí do SEPA priestoru. Tatra banka BIC odvodí z IBAN len ak IBAN patrí banke zo SEPA priestoru: inak platbu zamietne.`, path: `${txPath}/CdtrAgt/FinInstnId/BIC` });
          } else {
            checklist.push(`${bank.label} vie CdtrAgt/BIC odvodiť z platného SEPA IBAN príjemcu (${txPath}): chýbajúci BIC tu nie je chyba, len uistite sa, že IBAN je správny.`);
          }
        } else if (bank.cdtrBicPolicy === 'optional') {
          checklist.push(`ČSOB robí CdtrAgt/BIC od 1.2.2016 nepovinným pre SEPA platby (${txPath}): chýbajúci BIC tu nie je chyba.`);
        }
      } else {
        if (!bicFormatOk(cdtrAgtBic)) {
          addProblem({ code: 'cdtr_bic_format_invalid', severity: 'medium', message: `${txPath}: CdtrAgt/FinInstnId/BIC "${cdtrAgtBic}" nemá platný formát BIC (8 alebo 11 znakov).`, path: `${txPath}/CdtrAgt/FinInstnId/BIC`, value: cdtrAgtBic });
        } else if (cdtrIbanCheck && cdtrIbanCheck.country === 'SK') {
          const bban = cdtrIbanCheck.value.slice(4);
          const bankCode = bban.slice(0, 4);
          const derivedBic = SK_BANK_CODE_TO_BIC[bankCode];
          if (derivedBic && derivedBic.slice(0, 6) !== cdtrAgtBic.toUpperCase().slice(0, 6)) {
            addProblem({ code: 'cdtr_bic_mismatch_iban', severity: 'medium', message: `${txPath}: CdtrAgt/FinInstnId/BIC "${cdtrAgtBic}" sa nezhoduje s bankou odvodenou z IBAN (kód banky ${bankCode} → ${derivedBic}). Tatra banka porovnáva prvých 6 znakov zadaného a vypočítaného BIC: pri nezhode platbu zamietne.`, path: `${txPath}/CdtrAgt/FinInstnId/BIC`, value: cdtrAgtBic, fix: derivedBic });
          }
        }
      }

      const rmtInf = firstChild(tx, 'RmtInf');
      if (rmtInf) {
        const ustrdList = allChildren(rmtInf, 'Ustrd');
        if (ustrdList.length > 1) {
          addProblem({ code: 'rmt_inf_multiple_ustrd', severity: 'low', message: `${txPath}: RmtInf obsahuje ${ustrdList.length} elementov Ustrd. Povolená je iba jedna inštancia: nadbytočné banka pri spracovaní odstráni.`, path: `${txPath}/RmtInf/Ustrd` });
        }
        if (ustrdList[0]) {
          const ustrd = textOf(ustrdList[0]);
          if (ustrd.length > 140) {
            addProblem({ code: 'rmt_inf_too_long', severity: 'medium', message: `${txPath}: RmtInf/Ustrd má ${ustrd.length} znakov, maximum je 140.`, path: `${txPath}/RmtInf/Ustrd`, value: ustrd, fix: ustrd.slice(0, 140) });
          }
          reportCharset(ustrd, `${txPath}/RmtInf/Ustrd`);
        }
      }

      if (bankKey === 'slsp') {
        const lclInstrmCd = textOf(path(txPmtTpInf, 'LclInstrm') && firstChild(path(txPmtTpInf, 'LclInstrm'), 'Cd')) || textOf(path(pmtTpInf, 'LclInstrm') && firstChild(path(pmtTpInf, 'LclInstrm'), 'Cd'));
        if (!lclInstrmCd) {
          addProblem({ code: 'slsp_instant_flag_absent', severity: 'low', message: `${txPath}: PmtTpInf/LclInstrm/Cd nie je nastavené. Ak má byť táto platba spracovaná ako okamžitá (instant), Business24 vyžaduje hodnotu "INST": bez nej sa platba spracuje ako bežná SEPA úhrada, bez chybového hlásenia.`, path: `${txPath}/PmtTpInf/LclInstrm/Cd` });
        }
      }
    });
  });

  function recordDetectedBank(iban) {
    if (!iban || iban.slice(0, 2) !== 'SK') return;
    const bankCode = iban.slice(4, 8);
    const bic = SK_BANK_CODE_TO_BIC[bankCode];
    const label = Object.values(BANKS).find((b) => b.bic === bic);
    const name = label ? label.label : null;
    if (name && !stats.banksDetected.includes(name)) stats.banksDetected.push(name);
  }

  // currencies actually used
  const currencySet = new Set();
  for (const tx of allTx) {
    const amt = path(firstChild(tx, 'Amt'), 'InstdAmt');
    if (amt && amt.attrs.Ccy) currencySet.add(amt.attrs.Ccy);
  }
  stats.currencies = Array.from(currencySet);

  if (expectedTxCount !== null && expectedTxCount !== actualTxCount) {
    addProblem({
      code: 'expected_tx_count_mismatch',
      severity: 'high',
      message: `Očakávali ste ${expectedTxCount} transakcií, súbor však obsahuje ${actualTxCount}. Skontrolujte, či ste nahrali správny/celý súbor, alebo či export z účtovníctva nevynechal/zdvojil platby.`,
      path: 'CstmrCdtTrfInitn',
      value: String(actualTxCount),
      fix: undefined,
    });
  }

  if (xmlText.length > 1_000_000) {
    addProblem({ code: 'file_too_large', severity: 'low', message: `Súbor má približne ${(xmlText.length / 1024 / 1024).toFixed(2)} MB. Veľmi veľké súbory môžu importný formulár banky spomaliť alebo prekročiť jeho limit: zvážte rozdelenie do viacerých súborov.`, path: '' });
  }
  if (actualTxCount > 5000) {
    addProblem({ code: 'too_many_transactions_generic', severity: 'low', message: `Súbor obsahuje ${actualTxCount} transakcií. Aj mimo Tatra banky (limit 500/PmtInf) je bežné, že banky obmedzujú veľkosť jednej dávky: pri veľkých súboroch overte limit vopred.`, path: '' });
  }

  checklist.push('Po každej úprave XML spustite kontrolu znova: banka validuje súbor nanovo pri každom importe.');
  checklist.push('Skontrolujte, že účtovný softvér (Pohoda, Money S3, KROS Omega, vlastný export...) generuje presne pain.001.001.03, nie novšiu verziu.');
  if (bankKey === 'generic') {
    checklist.push('Bez vybranej konkrétnej banky sa neoverujú BIC banky, limit počtu transakcií ani okno dátumu splatnosti: vyberte banku pre presnejšiu diagnózu.');
  }

  return finish();

  function finish() {
    const sorted = sortProblems(problems);
    const highCount = sorted.filter((p) => p.severity === 'high').length;
    const medCount = sorted.filter((p) => p.severity === 'medium').length;
    const lowCount = sorted.filter((p) => p.severity === 'low').length;

    let status = 'pass';
    if (highCount > 0) status = 'fail';
    else if (medCount > 0 || lowCount > 0) status = 'warn';

    let summary;
    if (status === 'pass') {
      summary = `Žiadne problémy sa nenašli. Súbor vyzerá formátovo v poriadku pre ${bank.label}.`;
    } else if (status === 'fail') {
      const top = sorted.find((p) => p.severity === 'high');
      summary = `${highCount} blokujúc${highCount === 1 ? 'a chyba' : highCount < 5 ? 'e chyby' : 'ich chýb'}. Najzávažnejšie: ${top.message}`;
    } else {
      const top = sorted[0];
      summary = `Nič blokujúce, ale ${medCount + lowCount} vec${medCount + lowCount === 1 ? '' : medCount + lowCount < 5 ? 'i' : 'í'} stojí za opravu. Najvyššie: ${top ? top.message : ''}`;
    }

    const fixes = sorted
      .filter((p) => p.fix)
      .map((p) => ({ title: p.message.length > 90 ? p.message.slice(0, 87) + '…' : p.message, value: p.fix, where: p.path }));

    return {
      status,
      summary,
      bank: bankKey,
      expected,
      stats,
      problems: sorted,
      fixes,
      checklist: Array.from(new Set(checklist)),
      disclaimer:
        'Tento nástroj nie je banka a nič neoveruje voči vášmu skutočnému bankovému účtu ani voči systémom Tatra banky, SLSP, VÚB či ČSOB. Ide o čisto formátovú, klientskú kontrolu XML podľa verejne publikovaných špecifikácií týchto bánk a normy ISO 20022 / EPC SEPA Credit Transfer: nič z obsahu súboru sa nikam neodosiela. Čistý výsledok nie je zárukou, že banka platbu prijme; banky môžu svoje požiadavky kedykoľvek zmeniť.',
    };
  }
}

/**
 * Standalone helper: the bank-specific expected values without running the
 * full diagnosis (used for a live "expected values" preview as the user
 * picks a bank, before pasting XML).
 */
export function expectedValues(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  const bankKey = ['tatrabanka', 'slsp', 'vub', 'csob', 'generic'].includes(cfg.bank) ? cfg.bank : 'generic';
  const bank = bankInfo(bankKey);
  return {
    bank: bankKey,
    bankLabel: bank.label,
    bankBic: bank.bic,
    schemaNamespace: PAIN_NAMESPACE,
    execWindowDays: bank.execWindowDays,
  };
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.SepaDoctor = { diagnose, expectedValues };
}
