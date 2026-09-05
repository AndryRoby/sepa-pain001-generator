// tests.mjs — plain Node test runner for generator-pain001.js (no external
// dependencies). Also cross-checks a handful of generated files against
// doctor-pain001.js (copied unchanged into this repo) to confirm a clean
// input produces a file the sibling diagnostic tool considers clean too.
// Run with: node tests.mjs

import {
  parseRows, mapColumns, buildXml, bicFromIban, parseAmount, parseFlexibleDate,
  buildEndToEndId, resolveEndToEndId, checkIban, transliterate, autoMsgId, defaultExecDate, MAX_PAYMENTS,
  isSepaCharset, sepaCharsetViolations,
} from './generator-pain001.js';
import { diagnose } from './doctor-pain001.js';
import { parse as parseLicence, verify as verifyLicence, isValid as isValidLicence, load as loadLicence, save as saveLicence, clear as clearLicence, todayIso as licenceTodayIso, STORAGE_KEY as LICENCE_STORAGE_KEY, DEFAULT_PLAN, BUNDLE_PLAN, BUNDLE_STORAGE_KEY, ACCEPTED_PLANS, STORAGE_KEYS as LICENCE_STORAGE_KEYS } from './licence.js';
import {
  MAPPING_TEMPLATES, applyTemplate, loadProfiles, addProfile, removeProfile,
  mergeBlockPayments, blockTotals, loadHistory, addHistoryEntry, clearHistory, HISTORY_MAX,
} from './pro.js';
import {
  LANGS, DEFAULT_LANG, STORAGE_KEY as I18N_STORAGE_KEY, DICT, t, tf, formatAmountForLang, formatDateForLang,
  localeTagForLang, ogLocaleForLang, langFromLocale, langFromQueryString, findIncompleteEntries,
} from './i18n.js';

// Minimal in-memory localStorage polyfill: Node has no Web Storage API by
// default (only behind an experimental flag this repo's `node tests.mjs`
// does not pass), and licence.js/pro.js are meant to degrade to a no-op
// when it's absent — so tests that exercise the *storage* path need one
// installed, exactly like a real browser tab would provide.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => { store.clear(); },
  };
}

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  const cond = actual === expected;
  ok(name, cond, cond ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function deepEq(name, actual, expected) {
  const cond = JSON.stringify(actual) === JSON.stringify(expected);
  ok(name, cond, cond ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function includes(name, haystack, needle) {
  const cond = typeof haystack === 'string' && haystack.includes(needle);
  ok(name, cond, cond ? '' : `expected string to include ${JSON.stringify(needle)}`);
}
function notIncludes(name, haystack, needle) {
  const cond = typeof haystack === 'string' && !haystack.includes(needle);
  ok(name, cond, cond ? '' : `did not expect string to include ${JSON.stringify(needle)}`);
}
function throws(name, fn, matcher) {
  try {
    fn();
    ok(name, false, 'expected function to throw, it did not');
  } catch (e) {
    const cond = matcher ? matcher.test(e.message) : true;
    ok(name, cond, cond ? '' : `error message "${e.message}" did not match ${matcher}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Valid Slovak IBANs, generated (not hand-typed) via the real MOD-97
// algorithm so every fixture below is a genuine, checksum-correct IBAN.
// Trailing 10 digits kept at "0000000000" so these also pass the domestic
// modulo-11 check doctor-pain001.js applies on top of MOD-97 (see that
// file's skModulo11Ok): weighted sum of ten zeros is 0, and 0 % 11 === 0.
// ─────────────────────────────────────────────────────────────────────────

function skIbanCheckDigits(bban20) {
  const rearranged = bban20 + 'SK00';
  let numeric = '';
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') numeric += ch;
    else numeric += String(ch.charCodeAt(0) - 55);
  }
  let rem = 0;
  for (let i = 0; i < numeric.length; i++) rem = (rem * 10 + (numeric.charCodeAt(i) - 48)) % 97;
  return String(98 - rem).padStart(2, '0');
}
function skIban(bankCode4, tail16 = '0000000000000000') {
  const bban = bankCode4 + tail16;
  return `SK${skIbanCheckDigits(bban)}${bban}`;
}

const IBAN_TATRA = skIban('1100');
const IBAN_SLSP = skIban('0900');
const IBAN_VUB = skIban('0200');
const IBAN_CSOB = skIban('7500');
const IBAN_VUB_2 = skIban('0200', '1230000000000000');
const IBAN_UNKNOWN_BANK = skIban('9999');

// ═══════════════════════════ A. parseRows ══════════════════════════════

eq('parseRows: empty input', JSON.stringify(parseRows('')), '[]');
eq('parseRows: whitespace-only input', JSON.stringify(parseRows('   \n  \n')), '[]');

{
  const rows = parseRows('IBAN\tSuma\tNázov\nSK123\t450.00\tJozef\n');
  eq('parseRows(TSV): 2 rows', rows.length, 2);
  eq('parseRows(TSV): header cell 0', rows[0][0], 'IBAN');
  eq('parseRows(TSV): data cell 2', rows[1][2], 'Jozef');
}

{
  const rows = parseRows('IBAN;Suma;Nazov\nSK123;450,00;Jozef');
  eq('parseRows(CSV ";"): delimiter detected, 2 rows', rows.length, 2);
  eq('parseRows(CSV ";"): data cell 1', rows[1][1], '450,00');
}

{
  const rows = parseRows('IBAN,Suma,Nazov\nSK123,450.00,Jozef');
  eq('parseRows(CSV ","): delimiter detected, 2 rows', rows.length, 2);
  eq('parseRows(CSV ","): data cell 0', rows[1][0], 'SK123');
}

{
  const rows = parseRows('a;b;c\n"x;y";"line1\nline2";z');
  eq('parseRows: quoted field keeps embedded delimiter', rows[1][0], 'x;y');
  eq('parseRows: quoted field keeps embedded newline', rows[1][1], 'line1\nline2');
  eq('parseRows: cell after quoted field parsed correctly', rows[1][2], 'z');
}

{
  const rows = parseRows('a\tb\n\n\nc\td\n');
  eq('parseRows: blank lines between data rows are dropped', rows.length, 2);
}

{
  const rows = parseRows('a\tb\r\nc\td\r\n');
  eq('parseRows: CRLF line endings handled', rows.length, 2);
  eq('parseRows: CRLF does not leak into cell value', rows[0][1], 'b');
}

// ═══════════════════════════ B. mapColumns ═════════════════════════════

{
  const rows = parseRows('IBAN\tSuma\tNázov\tVS\tSprá va'.replace(' va', 'va') + '\nSK\t1\tX\t1\tY');
  const r = mapColumns(rows);
  ok('mapColumns: recognized Slovak header row as header', r.hasHeader === true);
}

{
  const rows = parseRows('IBAN\tSuma\tNázov príjemcu\tVS\tŠS\tKS\tSpráva\nSK0011\t120.50\tJán Novák\t123\t456\t0308\tFaktúra 1');
  const r = mapColumns(rows);
  eq('mapColumns: iban column detected', r.mapping.iban, 0);
  eq('mapColumns: amount column detected', r.mapping.amount, 1);
  eq('mapColumns: name column detected', r.mapping.name, 2);
  eq('mapColumns: vs column detected', r.mapping.vs, 3);
  eq('mapColumns: ss column detected', r.mapping.ss, 4);
  eq('mapColumns: ks column detected', r.mapping.ks, 5);
  eq('mapColumns: message column detected', r.mapping.message, 6);
  eq('mapColumns: one payment row parsed', r.payments.length, 1);
  eq('mapColumns: parsed payment name', r.payments[0].name, 'Ján Novák');
  eq('mapColumns: parsed payment vs', r.payments[0].vs, '123');
}

{
  // No recognizable header: falls back to the default positional guess
  // (iban, amount, name, vs, ss, ks, message).
  const rows = parseRows(`${IBAN_TATRA}\t45.00\tFirma s.r.o.`);
  const r = mapColumns(rows);
  ok('mapColumns: no header detected for pure data row', r.hasHeader === false);
  eq('mapColumns: positional fallback maps column 0 to iban', r.mapping.iban, 0);
  eq('mapColumns: positional fallback maps column 1 to amount', r.mapping.amount, 1);
  eq('mapColumns: positional fallback maps column 2 to name', r.mapping.name, 2);
  eq('mapColumns: single data row produced', r.payments.length, 1);
}

{
  const rows = parseRows('IBAN\tSuma\tNázov\nSK0011\t10\tX');
  const auto = mapColumns(rows);
  eq('mapColumns: auto-detected name column before override', auto.mapping.name, 2);
  const withOverride = mapColumns(rows, { name: null, message: 2 });
  eq('mapColumns: override removes a field (name -> null)', withOverride.mapping.name, null);
  eq('mapColumns: override reassigns a field (message -> col 2)', withOverride.mapping.message, 2);
  eq('mapColumns: override does not disturb unrelated field (iban)', withOverride.mapping.iban, 0);
}

{
  const rows = [['IBAN', 'Suma', 'Nazov'], ['not-an-iban', '450.00', 'Jozef']];
  const r = mapColumns(rows);
  ok('mapColumns row validation: invalid IBAN flagged', r.payments[0].errors.some((e) => /IBAN/.test(e)));
}

{
  const rows = [['IBAN', 'Suma', 'Nazov'], [IBAN_TATRA, '450.00', '']];
  const r = mapColumns(rows);
  ok('mapColumns row validation: missing name flagged', r.payments[0].errors.some((e) => /názov/i.test(e)));
}

{
  const rows = [['IBAN', 'Suma', 'Nazov'], [IBAN_TATRA, '-5.00', 'Jozef']];
  const r = mapColumns(rows);
  ok('mapColumns row validation: non-positive amount flagged', r.payments[0].errors.some((e) => /kladná/.test(e)));
}

{
  const rows = [['IBAN', 'Suma', 'Nazov', 'VS'], [IBAN_TATRA, '10', 'Jozef', '123456789012']];
  const r = mapColumns(rows);
  ok('mapColumns row validation: VS over 10 digits flagged', r.payments[0].errors.some((e) => /VS/.test(e)));
}

{
  const longMsg = 'x'.repeat(141);
  const rows = [['IBAN', 'Suma', 'Nazov', 'Sprava'], [IBAN_TATRA, '10', 'Jozef', longMsg]];
  const r = mapColumns(rows);
  ok('mapColumns row validation: message over 140 chars flagged', r.payments[0].errors.some((e) => /140/.test(e)));
}

{
  const rows = [['IBAN', 'Suma', 'Nazov'], [IBAN_TATRA, '450.00', 'Jozef Novák']];
  const r = mapColumns(rows);
  eq('mapColumns row validation: fully valid row has no errors', r.payments[0].hasError, false);
}

{
  const rows = [['IBAN', 'Suma', 'Nazov', 'Datum'], [IBAN_TATRA, '10', 'Jozef', '15.9.2026']];
  const r = mapColumns(rows);
  eq('mapColumns: date column parsed to ISO', r.payments[0].dateIso, '2026-09-15');
}

{
  const rows = [['IBAN', 'Suma', 'Nazov', 'Datum'], [IBAN_TATRA, '10', 'Jozef', 'not a date']];
  const r = mapColumns(rows);
  eq('mapColumns: unparsable date does not throw, dateIso is null', r.payments[0].dateIso, null);
  ok('mapColumns: unparsable date recorded as a row error', r.payments[0].errors.some((e) => /dátum/i.test(e)));
}

// ═══════════════════════════ C. bicFromIban ════════════════════════════

eq('bicFromIban: Tatra banka (1100)', bicFromIban(IBAN_TATRA), 'TATRSKBX');
eq('bicFromIban: SLSP (0900)', bicFromIban(IBAN_SLSP), 'GIBASKBX');
eq('bicFromIban: VUB (0200)', bicFromIban(IBAN_VUB), 'SUBASKBX');
eq('bicFromIban: CSOB (7500)', bicFromIban(IBAN_CSOB), 'CEKOSKBX');
eq('bicFromIban: unknown bank code returns null', bicFromIban(IBAN_UNKNOWN_BANK), null);
eq('bicFromIban: non-SK IBAN returns null', bicFromIban('DE89370400440532013000'), null);
eq('bicFromIban: lowercase + spaces normalized', bicFromIban(IBAN_TATRA.toLowerCase().replace(/(.{4})/g, '$1 ').trim()), 'TATRSKBX');

// ═══════════════════════════ D. parseAmount ════════════════════════════

eq('parseAmount: plain decimal dot', parseAmount('450.00'), 450);
eq('parseAmount: Slovak decimal comma', parseAmount('450,00'), 450);
eq('parseAmount: space thousands + comma decimal', parseAmount('1 234,56'), 1234.56);
eq('parseAmount: dot thousands + comma decimal', parseAmount('1.234,56'), 1234.56);
eq('parseAmount: comma thousands + dot decimal', parseAmount('1,234.56'), 1234.56);
eq('parseAmount: negative amount parses (row check flags it separately)', parseAmount('-50.00'), -50);
eq('parseAmount: currency suffix stripped', parseAmount('450 €'), 450);
eq('parseAmount: non-numeric text returns null', parseAmount('abc'), null);
eq('parseAmount: empty string returns null', parseAmount(''), null);
eq('parseAmount: ambiguous multi-dot text returns null (not guessed)', parseAmount('1.234.567'), null);

// ═══════════════════════════ E. parseFlexibleDate ══════════════════════

eq('parseFlexibleDate: ISO', parseFlexibleDate('2026-09-15'), '2026-09-15');
eq('parseFlexibleDate: D.M.YYYY', parseFlexibleDate('15.9.2026'), '2026-09-15');
eq('parseFlexibleDate: DD.MM.YYYY', parseFlexibleDate('15.09.2026'), '2026-09-15');
eq('parseFlexibleDate: D/M/YYYY (same convention as dots)', parseFlexibleDate('15/9/2026'), '2026-09-15');
eq('parseFlexibleDate: nonexistent date rejected', parseFlexibleDate('30.2.2026'), null);
eq('parseFlexibleDate: garbage text returns null', parseFlexibleDate('hello'), null);

// ═══════════════════════════ F. buildEndToEndId ════════════════════════

eq('buildEndToEndId: VS only', buildEndToEndId('123', '', ''), '/VS123');
eq('buildEndToEndId: VS + SS + KS in NBS order', buildEndToEndId('123', '456', '0308'), '/VS123/SS456/KS0308');
eq('buildEndToEndId: none supplied falls back to NOTPROVIDED', buildEndToEndId('', '', ''), 'NOTPROVIDED');
eq('buildEndToEndId: non-digit characters stripped', buildEndToEndId('VS-123', '', ''), '/VS123');
eq('buildEndToEndId: SS without VS keeps only SS segment', buildEndToEndId('', '77', ''), '/SS77');

// ═══════════════════════════ G. buildXml ═══════════════════════════════

throws('buildXml: throws on zero payments', () => buildXml({ payer: { name: 'X', iban: IBAN_TATRA }, payments: [] }), /Žiadne platby/);

{
  const tooMany = Array.from({ length: MAX_PAYMENTS + 1 }, () => ({ iban: IBAN_VUB, amount: 1, name: 'X' }));
  throws('buildXml: throws over MAX_PAYMENTS', () => buildXml({ payer: { name: 'X', iban: IBAN_TATRA }, payments: tooMany }), /5000|Príliš/);
}

{
  const xml = buildXml({ payer: { name: 'Firma s.r.o.', iban: IBAN_TATRA }, payments: [{ iban: IBAN_VUB, amount: 100, name: 'Jozef' }] });
  const m = xml.match(/<MsgId>(.*?)<\/MsgId>/);
  ok('buildXml: auto MsgId matches ARL-YYYYMMDD-HHMMSS pattern', !!m && /^ARL-\d{8}-\d{6}$/.test(m[1]));
}

{
  const xml = buildXml({ payer: { name: 'Firma s.r.o.', iban: IBAN_TATRA }, msgId: 'CUSTOM-ID-1', payments: [{ iban: IBAN_VUB, amount: 100, name: 'Jozef' }] });
  includes('buildXml: explicit msgId used verbatim', xml, '<MsgId>CUSTOM-ID-1</MsgId>');
}

{
  const xml = buildXml({ payer: { name: 'Firma s.r.o.', iban: IBAN_TATRA }, payments: [{ iban: IBAN_VUB, amount: 100, name: 'Jozef' }] });
  const m = xml.match(/<ReqdExctnDt>(.*?)<\/ReqdExctnDt>/);
  eq('buildXml: default execution date is tomorrow', m && m[1], defaultExecDate());
}

{
  const xml = buildXml({
    payer: { name: 'Firma s.r.o.', iban: IBAN_TATRA },
    payments: [
      { iban: IBAN_VUB, amount: 100.5, name: 'Jozef' },
      { iban: IBAN_VUB, amount: 49.5, name: 'Mária' },
    ],
  });
  includes('buildXml: NbOfTxs counts every payment', xml, '<NbOfTxs>2</NbOfTxs>');
  includes('buildXml: CtrlSum sums amounts to 2 decimals', xml, '<CtrlSum>150.00</CtrlSum>');
  includes('buildXml: PmtMtd fixed to TRF', xml, '<PmtMtd>TRF</PmtMtd>');
  includes('buildXml: SvcLvl fixed to SEPA', xml, '<Cd>SEPA</Cd>');
  includes('buildXml: ChrgBr fixed to SLEV', xml, '<ChrgBr>SLEV</ChrgBr>');
  includes('buildXml: currency fixed to EUR', xml, 'Ccy="EUR"');
}

{
  const xml = buildXml({
    payer: { name: 'Firma & Syn "s.r.o."', iban: IBAN_TATRA },
    payments: [{ iban: IBAN_VUB, amount: 10, name: "O'Brien <VIP>", message: 'Faktúra & dobropis' }],
  });
  includes('buildXml: escapes & in payer name', xml, 'Firma &amp; Syn');
  includes('buildXml: escapes " in payer name', xml, '&quot;s.r.o.&quot;');
  includes('buildXml: escapes < > in creditor name', xml, "O&apos;Brien &lt;VIP&gt;");
  includes('buildXml: escapes & in remittance message', xml, 'Faktúra &amp; dobropis');
}

{
  const xmlCsob = buildXml({ bank: 'csob', payer: { name: 'Škoda s.r.o.', iban: IBAN_CSOB }, payments: [{ iban: IBAN_VUB, amount: 10, name: 'Jozef Šťastný', message: 'Faktúra č. 1' }] });
  notIncludes('buildXml: ČSOB profile transliterates diacritics out of payer name', xmlCsob, 'Škoda');
  includes('buildXml: ČSOB profile transliterated payer name present', xmlCsob, 'Skoda');
  notIncludes('buildXml: ČSOB profile transliterates diacritics out of creditor name', xmlCsob, 'Šťastný');
  notIncludes('buildXml: ČSOB profile transliterates diacritics out of message', xmlCsob, 'Faktúra');

  const xmlTatra = buildXml({ bank: 'tatrabanka', payer: { name: 'Škoda s.r.o.', iban: IBAN_TATRA }, payments: [{ iban: IBAN_VUB, amount: 10, name: 'Jozef Šťastný' }] });
  includes('buildXml: non-ČSOB profile keeps diacritics as typed', xmlTatra, 'Škoda');
}

{
  const xml = buildXml({ payer: { name: 'Firma', iban: IBAN_TATRA }, payments: [{ iban: IBAN_VUB, amount: 10, name: 'Jozef' }] });
  includes('buildXml: CdtrAgt/BIC auto-derived from a recognized SK bank code', xml, '<BIC>SUBASKBX</BIC>');
  includes('buildXml: DbtrAgt/BIC auto-derived for the payer', xml, 'TATRSKBX');
}

{
  const xml = buildXml({ payer: { name: 'Firma', iban: IBAN_TATRA }, payments: [{ iban: IBAN_UNKNOWN_BANK, amount: 10, name: 'Jozef' }] });
  notIncludes('buildXml: no CdtrAgt block when BIC cannot be derived and none supplied', xml, 'CdtrAgt');
}

// ── GrpHdr/InitgPty and PmtInf/DbtrAgt: both mandatory (minOccurs unset ->
// 1) in the official pain.001.001.03 XSD (confirmed by validating a
// generated file against the schema published via iso20022.org's message
// archive, mirrored at github.com/raphaelm/python-sepaxml). InitgPty was
// missing outright; DbtrAgt was only written when a BIC could be resolved,
// which never happens for a non-Slovak payer IBAN (bicFromIban() only
// matches ^SK\d{22}$) unless the user fills in the BIC field by hand — the
// exact common case for the "de" profile's German/Austrian/Swiss payers. ──
{
  const xml = buildXml({ payer: { name: 'Firma s.r.o.', iban: IBAN_TATRA }, payments: [{ iban: IBAN_VUB, amount: 10, name: 'Jozef' }] });
  includes('buildXml: GrpHdr carries the mandatory InitgPty element', xml, '<InitgPty>');
  includes('buildXml: InitgPty/Nm uses the payer name (same party as Dbtr)', xml, '<InitgPty>\n        <Nm>Firma s.r.o.</Nm>\n      </InitgPty>');
  ok('buildXml: InitgPty appears inside GrpHdr, before the first PmtInf', xml.indexOf('<InitgPty>') > xml.indexOf('<GrpHdr>') && xml.indexOf('<InitgPty>') < xml.indexOf('<PmtInf>'));
}
{
  // Non-Slovak payer IBAN, no explicit BIC given: bicFromIban() cannot
  // resolve one, so DbtrAgt must still appear (mandatory) with the same
  // ISO 20022 "NOTPROVIDED" placeholder convention buildEndToEndId() uses.
  const IBAN_DE_PAYER = 'DE89370400440532013000';
  const xml = buildXml({ profile: 'de', payer: { name: 'Firma GmbH', iban: IBAN_DE_PAYER }, payments: [{ iban: IBAN_VUB, amount: 10, name: 'Jozef', endToEndId: 'INV-1' }] });
  includes('buildXml: DbtrAgt is always present even when no payer BIC can be resolved', xml, '<DbtrAgt>');
  includes('buildXml: DbtrAgt falls back to Othr/Id NOTPROVIDED, not an empty/omitted BIC', xml, '<Othr>\n            <Id>NOTPROVIDED</Id>\n          </Othr>');
  notIncludes('buildXml: no bare/empty <BIC> element written for the unresolved payer', xml, '<BIC></BIC>');
}
{
  // Payer BIC given explicitly (or resolvable): still exactly one DbtrAgt,
  // using the real BIC, not the NOTPROVIDED fallback.
  const xml = buildXml({ payer: { name: 'Firma', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' }, payments: [{ iban: IBAN_VUB, amount: 10, name: 'Jozef', vs: '1' }] });
  eq('buildXml: exactly one DbtrAgt block per PmtInf', (xml.match(/<DbtrAgt>/g) || []).length, 1);
  includes('buildXml: DbtrAgt uses the explicit payer BIC when given', xml, '<BIC>COBADEFFXXX</BIC>');
  const dbtrAgtBlock = xml.slice(xml.indexOf('<DbtrAgt>'), xml.indexOf('</DbtrAgt>'));
  notIncludes('buildXml: DbtrAgt does not fall back to NOTPROVIDED when a real payer BIC is known', dbtrAgtBlock, 'NOTPROVIDED');
}

{
  const xml = buildXml({
    payer: { name: 'Firma', iban: IBAN_TATRA },
    execDate: '2026-10-01',
    payments: [
      { iban: IBAN_VUB, amount: 10, name: 'A', dateIso: '2026-11-05' },
      { iban: IBAN_VUB_2, amount: 20, name: 'B', dateIso: '2026-10-20' },
      { iban: IBAN_VUB, amount: 5, name: 'C' }, // no per-row date -> falls back to execDate
    ],
  });
  const dates = [...xml.matchAll(/<ReqdExctnDt>(.*?)<\/ReqdExctnDt>/g)].map((m) => m[1]);
  eq('buildXml: distinct payment dates split into 3 PmtInf blocks', dates.length, 3);
  eq('buildXml: PmtInf blocks are sorted by date ascending', JSON.stringify(dates), JSON.stringify(['2026-10-01', '2026-10-20', '2026-11-05']));
}

{
  const xml = buildXml({
    payer: { name: 'Firma', iban: IBAN_TATRA },
    payments: [{ iban: IBAN_VUB, amount: 10, name: 'A' }, { iban: IBAN_VUB_2, amount: 20, name: 'B' }],
  });
  const count = (xml.match(/<PmtInf>/g) || []).length;
  eq('buildXml: same effective date for every row -> single PmtInf block', count, 1);
}

{
  // Amount missing/unparsable must not crash generation; row-level errors
  // (surfaced separately by mapColumns) are what flags it to the user.
  const xml = buildXml({ payer: { name: 'Firma', iban: IBAN_TATRA }, payments: [{ iban: IBAN_VUB, amount: null, name: 'A' }] });
  includes('buildXml: null amount does not throw, renders as 0.00', xml, '<InstdAmt Ccy="EUR">0.00</InstdAmt>');
}

// ═══════════════ H. integration: generated file vs. doctor-pain001.js ═════

{
  const xml = buildXml({
    bank: 'vub',
    payer: { name: 'Firma s.r.o.', iban: IBAN_VUB },
    execDate: defaultExecDate(),
    payments: [
      { iban: IBAN_VUB_2, amount: 450, name: 'Jozef Novak', vs: '123', ss: '456', ks: '0308', message: 'Faktura 2026-1' },
    ],
  });
  const result = diagnose({ xml, bank: 'vub' });
  const highs = result.problems.filter((p) => p.severity === 'high');
  eq('integration (VUB): a clean, fully-specified payment produces zero high-severity Doctor problems', highs.length, 0, JSON.stringify(highs));
  eq('integration (VUB): Doctor status is not "fail"', result.status !== 'fail', true);
}

{
  const xml = buildXml({
    bank: 'tatrabanka',
    payer: { name: 'Firma s.r.o.', iban: IBAN_TATRA },
    execDate: defaultExecDate(),
    payments: [{ iban: IBAN_VUB, amount: 99.9, name: 'Maria Nova', vs: '1', message: 'Test' }],
  });
  const result = diagnose({ xml, bank: 'tatrabanka' });
  const highs = result.problems.filter((p) => p.severity === 'high');
  eq('integration (Tatra banka): clean payment produces zero high-severity Doctor problems', highs.length, 0, JSON.stringify(highs));
}

{
  // Deliberately invalid creditor IBAN must round-trip into the XML as-is
  // (not silently fixed) so Doctor's own check is the one that catches it.
  const rows = [['IBAN', 'Suma', 'Nazov'], ['SK0000000000000000000000', '10', 'Zly Iban']];
  const parsed = mapColumns(rows);
  ok('mapColumns flags the deliberately-broken sample IBAN as invalid', parsed.payments[0].errors.some((e) => /IBAN/.test(e)));
  const xml = buildXml({ payer: { name: 'Firma', iban: IBAN_TATRA }, payments: parsed.payments });
  const result = diagnose({ xml, bank: 'generic' });
  ok('integration: Doctor also catches the same broken IBAN post-generation', result.problems.some((p) => p.code === 'cdtr_iban_invalid'));
}

// ═══════════════════════════ I. licence.js ══════════════════════════════
// licence.js's real verify()/isValid() check every licence against the
// ARLing service's actual public key baked into that file — and this
// repo, correctly, does not hold the matching private key. So every test
// below signs its own fixture licences with a throwaway Ed25519 keypair
// generated right here (Node 20+'s globalThis.crypto.subtle — the exact
// API licence.js itself uses — supports 'Ed25519' natively; confirmed by
// running it, see licence.js's own header comment) and passes that test
// key in as verify()/isValid()'s documented test-only override, so the
// *mechanism* under test is licence.js's real code, not a reimplementation
// of it.

function b64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return Buffer.from(bin, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Same "sorted keys, no separator whitespace" shape as the real licence
// service (app.py: json.dumps(payload, separators=(",", ":"), sort_keys=True))
// — not byte-identical to Python's encoder in general, but identical for
// the plain-string-valued payloads used here and in production.
function stableJson(obj) {
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + JSON.stringify(obj[k])).join(',') + '}';
}

async function signLicence(payloadObj, privateKey) {
  const payloadBytes = new TextEncoder().encode(stableJson(payloadObj));
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, payloadBytes));
  return b64u(payloadBytes) + '.' + b64u(sig);
}

function addDaysIso(iso, days) {
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

await (async () => {
  const testKeyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const testPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', testKeyPair.publicKey));

  const TODAY = licenceTodayIso();
  const TOMORROW = addDaysIso(TODAY, 1);
  const YESTERDAY = addDaysIso(TODAY, -1);
  const basePayload = { p: DEFAULT_PLAN, e: TOMORROW, s: 'abcd1234', m: '0123456789abcdef' };
  const validKey = await signLicence(basePayload, testKeyPair.privateKey);

  // ── parse(): malformed input never throws, always returns null ────────
  eq('licence parse: non-string input returns null', parseLicence(12345), null);
  eq('licence parse: empty string returns null', parseLicence(''), null);
  eq('licence parse: no "." separator returns null', parseLicence('nodothere'), null);
  eq('licence parse: both parts empty returns null', parseLicence('.'), null);
  eq('licence parse: invalid base64url payload returns null', parseLicence('not-base64!!!.AAAA'), null);
  eq('licence parse: valid base64url but non-JSON payload returns null', parseLicence(b64u(new TextEncoder().encode('not json')) + '.AAAA'), null);
  eq('licence parse: JSON missing required "p"/"e" fields returns null', parseLicence(b64u(new TextEncoder().encode(JSON.stringify({ foo: 'bar' }))) + '.AAAA'), null);

  // ── parse(): a well-formed key decodes correctly ────────────────────────
  {
    const parsed = parseLicence(validKey);
    ok('licence parse: well-formed key parses', parsed !== null);
    eq('licence parse: plan field round-trips', parsed.payload.p, DEFAULT_PLAN);
    eq('licence parse: expiry field round-trips', parsed.payload.e, TOMORROW);
  }

  // ── verify(): signature only, no plan/expiry check ──────────────────────
  eq('licence verify: valid signature against the matching (test) pubkey', await verifyLicence(validKey, testPubRaw), true);
  eq('licence verify: signature by a foreign keypair rejected by the real embedded ARLing pubkey', await verifyLicence(validKey), false);

  // ── isValid(): full check (signature + plan + expiry) ───────────────────
  {
    const r = await isValidLicence(validKey, { pubKey: testPubRaw });
    eq('isValid: valid licence -> valid true', r.valid, true);
    eq('isValid: valid licence -> reason "ok"', r.reason, 'ok');
  }
  {
    const key = await signLicence({ ...basePayload, e: YESTERDAY }, testKeyPair.privateKey);
    const r = await isValidLicence(key, { pubKey: testPubRaw });
    eq('isValid: expired licence -> valid false', r.valid, false);
    eq('isValid: expired licence -> reason "expired"', r.reason, 'expired');
  }
  {
    const key = await signLicence({ ...basePayload, e: TODAY }, testKeyPair.privateKey);
    const r = await isValidLicence(key, { pubKey: testPubRaw });
    eq('isValid: expiry == today is still valid (inclusive)', r.valid, true);
  }
  {
    const key = await signLicence({ ...basePayload, p: 'some-other-plan' }, testKeyPair.privateKey);
    const r = await isValidLicence(key, { pubKey: testPubRaw });
    eq('isValid: licence for a different plan -> valid false', r.valid, false);
    eq('isValid: licence for a different plan -> reason "plan"', r.reason, 'plan');
  }
  {
    const [payloadPart, sigPart] = validKey.split('.');
    const flipped = (sigPart[0] === 'A' ? 'B' : 'A') + sigPart.slice(1);
    const r = await isValidLicence(payloadPart + '.' + flipped, { pubKey: testPubRaw });
    eq('isValid: corrupted signature -> valid false', r.valid, false);
    eq('isValid: corrupted signature -> reason "signature"', r.reason, 'signature');
  }
  {
    const r = await isValidLicence('garbage.key', { pubKey: testPubRaw });
    eq('isValid: malformed key -> valid false', r.valid, false);
    eq('isValid: malformed key -> reason "malformed"', r.reason, 'malformed');
  }

  // ── unsupported WebCrypto (older Safari): simulated by making
  // importKey fail, exactly the failure mode a browser without Ed25519
  // in SubtleCrypto would produce ───────────────────────────────────────
  {
    const originalImportKey = crypto.subtle.importKey.bind(crypto.subtle);
    crypto.subtle.importKey = async () => { throw new Error('simulated: no Ed25519 in this WebCrypto'); };
    let threw = false;
    try {
      await verifyLicence(validKey, testPubRaw);
    } catch (e) {
      threw = true;
      eq('verify: unsupported WebCrypto throws Error with code "unsupported"', e.code, 'unsupported');
    }
    ok('verify: unsupported WebCrypto does throw rather than silently pass', threw);
    const r = await isValidLicence(validKey, { pubKey: testPubRaw });
    eq('isValid: unsupported WebCrypto -> valid false (not an unhandled throw)', r.valid, false);
    eq('isValid: unsupported WebCrypto -> reason "unsupported"', r.reason, 'unsupported');
    crypto.subtle.importKey = originalImportKey;
  }

  // ── local storage round-trip ─────────────────────────────────────────
  clearLicence();
  eq('licence load: nothing stored returns null', loadLicence(), null);
  eq('licence save: reports success', saveLicence(validKey), true);
  eq('licence load: round-trips the exact stored string', loadLicence(), validKey);
  eq('licence clear: reports success', clearLicence(), true);
  eq('licence load: returns null again after clear', loadLicence(), null);
  ok('licence STORAGE_KEY: is a non-empty string', typeof LICENCE_STORAGE_KEY === 'string' && LICENCE_STORAGE_KEY.length > 0);

  // ── dual-plan acceptance: "sepa-generator-pro" (this tool's own,
  // historical plan) and "sepa-pro" (the shared bundle plan sold on
  // https://arling.sk/bankove-nastroje/) must both unlock Pro here, each
  // stored under its own localStorage key, so neither purchase path
  // clobbers the other and a bundle key activated on any ARLing tool
  // page (shared arling.sk origin) is picked up automatically ─────────
  ok('ACCEPTED_PLANS: includes this tool\'s own historical plan', ACCEPTED_PLANS.includes(DEFAULT_PLAN));
  ok('ACCEPTED_PLANS: includes the shared bundle plan "sepa-pro"', ACCEPTED_PLANS.includes(BUNDLE_PLAN));
  eq('BUNDLE_PLAN: is exactly "sepa-pro"', BUNDLE_PLAN, 'sepa-pro');
  ok('STORAGE_KEYS: includes both this tool\'s key and the bundle key', LICENCE_STORAGE_KEYS.includes(LICENCE_STORAGE_KEY) && LICENCE_STORAGE_KEYS.includes(BUNDLE_STORAGE_KEY));

  const bundleKey = await signLicence({ ...basePayload, p: BUNDLE_PLAN }, testKeyPair.privateKey);
  {
    const r = await isValidLicence(bundleKey, { pubKey: testPubRaw });
    eq('isValid: a "sepa-pro" bundle licence is accepted under the default (no plan given) check', r.valid, true);
    eq('isValid: a "sepa-pro" bundle licence -> reason "ok"', r.reason, 'ok');
  }

  clearLicence();
  eq('save: a bundle-plan licence is stored under BUNDLE_STORAGE_KEY, not the legacy key', (() => {
    saveLicence(bundleKey);
    return localStorage.getItem(BUNDLE_STORAGE_KEY) === bundleKey && localStorage.getItem(LICENCE_STORAGE_KEY) === null;
  })(), true);
  eq('load: finds the bundle licence when only the bundle key holds a value', loadLicence(), bundleKey);
  eq('clear: removes the bundle key too (not just the legacy key)', (() => {
    clearLicence();
    return localStorage.getItem(BUNDLE_STORAGE_KEY) === null && localStorage.getItem(LICENCE_STORAGE_KEY) === null;
  })(), true);
  eq('load: returns null once both plan keys are cleared', loadLicence(), null);
})();

// ═══════════════════════════════ J. pro.js ═══════════════════════════════

// ── mapping templates: each maps a realistic sample header row ─────────
{
  const rows = [
    ['Účet příkazce', 'Částka', 'Název firmy', 'Variabilní symbol', 'Poznámka'],
    ['SK1234567890', '450.00', 'Firma s.r.o.', '123', 'Faktúra'],
  ];
  const { matchedFields, mapped } = applyTemplate('POHODA', rows);
  ok('applyTemplate(POHODA): matches iban/amount/name/vs/message headers', ['iban', 'amount', 'name', 'vs', 'message'].every((f) => matchedFields.includes(f)));
  eq('applyTemplate(POHODA): iban mapped to its actual column', mapped.mapping.iban, 0);
  eq('applyTemplate(POHODA): amount mapped to its actual column', mapped.mapping.amount, 1);
}
{
  const rows = [
    ['Číslo účtu príjemcu', 'Suma', 'Odberateľ', 'Variabilný symbol', 'Správa pre prijímateľa'],
    ['SK1234567890', '10', 'X', '1', 'Y'],
  ];
  const { matchedFields, mapped } = applyTemplate('OMEGA', rows);
  ok('applyTemplate(OMEGA): matches iban/amount/name/vs/message headers', ['iban', 'amount', 'name', 'vs', 'message'].every((f) => matchedFields.includes(f)));
  eq('applyTemplate(OMEGA): name mapped to its actual column', mapped.mapping.name, 2);
}
{
  const rows = [
    ['Účet', 'Částka', 'Název partnera', 'Variabilní symbol', 'Popis'],
    ['SK1234567890', '10', 'X', '1', 'Y'],
  ];
  const { matchedFields, mapped } = applyTemplate('MONEY_S3', rows);
  ok('applyTemplate(MONEY_S3): matches iban/amount/name/vs/message headers', ['iban', 'amount', 'name', 'vs', 'message'].every((f) => matchedFields.includes(f)));
  eq('applyTemplate(MONEY_S3): message mapped to its actual column', mapped.mapping.message, 4);
}
{
  const rows = [
    ['IBAN', 'Suma', 'Názov', 'VS', 'Správa'],
    ['SK1234567890', '10', 'X', '1', 'Y'],
  ];
  const { matchedFields, mapped } = applyTemplate('EXCEL', rows);
  ok('applyTemplate(EXCEL): matches all 5 common headers', ['iban', 'amount', 'name', 'vs', 'message'].every((f) => matchedFields.includes(f)));
  eq('applyTemplate(EXCEL): vs mapped to its actual column', mapped.mapping.vs, 3);
}
{
  const rows = [['IBAN', 'Suma', 'Nazov'], ['SK1', '1', 'X']];
  const { template, matchedFields, mapped } = applyTemplate('NONEXISTENT', rows);
  eq('applyTemplate: unknown template key -> template is null', template, null);
  eq('applyTemplate: unknown template key -> no matched fields', matchedFields.length, 0);
  eq('applyTemplate: unknown template key falls back to plain mapColumns()', JSON.stringify(mapped.mapping), JSON.stringify(mapColumns(rows).mapping));
}
eq('MAPPING_TEMPLATES: has exactly the 4 documented exporters', Object.keys(MAPPING_TEMPLATES).sort().join(','), 'EXCEL,MONEY_S3,OMEGA,POHODA');
for (const key of Object.keys(MAPPING_TEMPLATES)) {
  ok(`MAPPING_TEMPLATES.${key}: carries a non-empty "heuristic, not a spec" note`, typeof MAPPING_TEMPLATES[key].note === 'string' && MAPPING_TEMPLATES[key].note.length > 0);
}

// ── multi-block payments: merge + totals ────────────────────────────────
{
  const blockA = { payments: [{ amount: 10 }, { amount: 5, hasError: true }] };
  const blockB = { payments: [{ amount: 20 }] };
  const merged = mergeBlockPayments([blockA, blockB]);
  eq('mergeBlockPayments: concatenates every block in order', merged.length, 3);
  eq('mergeBlockPayments: first block\'s rows come first', merged[0].amount, 10);
  eq('mergeBlockPayments: last block\'s rows come last', merged[2].amount, 20);
  const totals = blockTotals(merged);
  eq('blockTotals: sums the valid amounts', totals.sum, 35);
  eq('blockTotals: counts every row, including errored ones', totals.count, 3);
  eq('blockTotals: counts rows flagged hasError', totals.errCount, 1);
}
eq('mergeBlockPayments: invalid/empty input returns an empty array', mergeBlockPayments(null).length, 0);

// ── payer profiles ───────────────────────────────────────────────────────
{
  for (const p of loadProfiles()) removeProfile(p.id);
  eq('loadProfiles: starts empty after cleanup', loadProfiles().length, 0);
  eq('addProfile: missing name/iban is rejected', addProfile({ name: '', iban: '' }).ok, false);
  const r1 = addProfile({ name: 'Firma A', iban: 'SK1234567890', bic: 'TATRSKBX' });
  ok('addProfile: valid profile is accepted', r1.ok === true);
  eq('loadProfiles: stores the added profile', loadProfiles().length, 1);
  addProfile({ id: r1.profile.id, name: 'Firma A (upravená)', iban: 'SK1234567890' });
  eq('addProfile: same id overwrites in place rather than duplicating', loadProfiles().length, 1);
  eq('addProfile: overwrite is reflected on reload', loadProfiles()[0].name, 'Firma A (upravená)');
  eq('removeProfile: removes by id', removeProfile(r1.profile.id).length, 0);
}

// ── history ───────────────────────────────────────────────────────────────
{
  clearHistory();
  eq('loadHistory: starts empty after clear', loadHistory().length, 0);
  for (let i = 0; i < HISTORY_MAX + 5; i++) {
    addHistoryEntry({ count: i, sum: i, bank: 'tatrabanka', filename: `f${i}.xml`, xml: '<xml/>' });
  }
  const hist = loadHistory();
  eq(`addHistoryEntry: caps history length at HISTORY_MAX (${HISTORY_MAX})`, hist.length, HISTORY_MAX);
  eq('addHistoryEntry: most recently added entry is first', hist[0].filename, `f${HISTORY_MAX + 4}.xml`);
  const entry = addHistoryEntry({ count: 1, sum: 1, bank: 'vub', filename: 'big.xml', xml: 'x'.repeat(300 * 1024) });
  eq('addHistoryEntry: XML over the 200 kB cap is not stored inline', entry.xml, null);
  eq('addHistoryEntry: metadata is still recorded for an oversized XML', loadHistory()[0].count, 1);
  clearHistory();
}

// ═══════════════════════════ small extras ══════════════════════════════

eq('checkIban: valid generated IBAN passes', checkIban(IBAN_TATRA).valid, true);
eq('checkIban: empty string is invalid', checkIban('').valid, false);
eq('transliterate: strips Slovak diacritics', transliterate('Žofia Šťastná'), 'Zofia Stastna');
ok('autoMsgId: matches the documented pattern', /^ARL-\d{8}-\d{6}$/.test(autoMsgId(new Date('2026-09-05T09:03:07'))));
eq('defaultExecDate: is exactly one day after the given date', defaultExecDate(new Date('2026-09-04T12:00:00')), '2026-09-05');

// ═══════════════ K. "de" country profile (engine change) ═══════════════
// Slovak "sk" profile behaviour (VS/ŠS/KS -> EndToEndId) is asserted
// exhaustively above and untouched; this section is the "de" profile's own
// new surface: no VS/ŠS/KS, an EndToEndId column instead (default
// NOTPROVIDED), German/English header auto-detection, and a SEPA
// character-set check on Verwendungszweck. Fixture IBANs are the two
// checksum-correct example IBANs German banking documentation itself uses.
const IBAN_DE_1 = 'DE89370400440532013000';
const IBAN_DE_2 = 'DE02120300000000202051';

eq('resolveEndToEndId (de): taken from payment.endToEndId', resolveEndToEndId({ endToEndId: 'INV-2026-01' }, 'de'), 'INV-2026-01');
eq('resolveEndToEndId (de): trims whitespace', resolveEndToEndId({ endToEndId: '  INV-9  ' }, 'de'), 'INV-9');
eq('resolveEndToEndId (de): empty/missing falls back to NOTPROVIDED', resolveEndToEndId({ endToEndId: '' }, 'de'), 'NOTPROVIDED');
eq('resolveEndToEndId (de): vs/ss/ks are ignored outright', resolveEndToEndId({ vs: '123', ss: '456', endToEndId: '' }, 'de'), 'NOTPROVIDED');
eq('resolveEndToEndId (sk, default): still builds from vs/ss/ks, unaffected by the de profile', resolveEndToEndId({ vs: '123' }), '/VS123');
eq('resolveEndToEndId: unknown profile falls back to "sk" behaviour', resolveEndToEndId({ vs: '77' }, 'fr'), '/VS77');

{
  // German headers: IBAN, Betrag, Name, Empfänger, Verwendungszweck,
  // Ausführungsdatum, BIC — per the brief's own header list.
  const rows = parseRows('IBAN\tBetrag\tEmpfänger\tVerwendungszweck\tAusführungsdatum\tBIC\n' + IBAN_DE_1 + '\t123,45\tMax Mustermann\tRechnung 2026-01\t15.9.2026\tCOBADEFFXXX');
  const r = mapColumns(rows, undefined, 'de');
  eq('German headers: IBAN column detected', r.mapping.iban, 0);
  eq('German headers: "Betrag" detected as amount', r.mapping.amount, 1);
  eq('German headers: "Empfänger" detected as name', r.mapping.name, 2);
  eq('German headers: "Verwendungszweck" detected as message', r.mapping.message, 3);
  eq('German headers: "Ausführungsdatum" detected as date', r.mapping.date, 4);
  eq('German headers: BIC column detected', r.mapping.bic, 5);
  eq('German headers: amount "123,45" (decimal comma) parsed correctly', r.payments[0].amount, 123.45);
  eq('German headers: date "15.9.2026" parsed to ISO', r.payments[0].dateIso, '2026-09-15');
}
{
  // English headers: Amount, Beneficiary, Reference, Execution date.
  const rows = parseRows('IBAN\tAmount\tBeneficiary\tReference\tExecution date\tEndToEndId\n' + IBAN_DE_1 + '\t50.00\tJohn Smith\tInvoice ref\t2026-09-15\tINV-42');
  const r = mapColumns(rows, undefined, 'de');
  eq('English headers: "Amount" detected', r.mapping.amount, 1);
  eq('English headers: "Beneficiary" detected as name', r.mapping.name, 2);
  eq('English headers: "Reference" detected as message', r.mapping.message, 3);
  eq('English headers: "Execution date" detected as date', r.mapping.date, 4);
  eq('English headers: "EndToEndId" column detected', r.mapping.endToEndId, 5);
  eq('English headers: EndToEndId value parsed through to the payment row', r.payments[0].endToEndId, 'INV-42');
}
{
  // de profile with no header row: positional fallback is iban, amount,
  // name, message, endToEndId — no vs/ss/ks slots at all.
  const rows = parseRows(`${IBAN_DE_1}\t50.00\tMax Mustermann\tRechnung\tINV-1`);
  const r = mapColumns(rows, undefined, 'de');
  eq('de profile positional fallback: column 3 maps to message, not vs', r.mapping.message, 3);
  eq('de profile positional fallback: column 4 maps to endToEndId', r.mapping.endToEndId, 4);
  eq('de profile positional fallback: vs is not mapped at all', r.mapping.vs, null);
}

{
  const rows = [['IBAN', 'Betrag', 'Empfänger', 'Verwendungszweck', 'EndToEndId'], [IBAN_DE_1, '450,00', 'Max Mustermann', 'Rechnung 2026-01', 'INV-2026-01']];
  const mapped = mapColumns(rows, undefined, 'de');
  const xml = buildXml({ profile: 'de', bank: 'generic', payer: { name: 'Firma GmbH', iban: IBAN_DE_2 }, payments: mapped.payments });
  includes('de profile XML: RmtInf/Ustrd carries the Verwendungszweck text', xml, '<Ustrd>Rechnung 2026-01</Ustrd>');
  includes('de profile XML: EndToEndId taken from the mapped column', xml, '<EndToEndId>INV-2026-01</EndToEndId>');
  notIncludes('de profile XML: no "/VS" reference symbol anywhere in the file', xml, '/VS');
  notIncludes('de profile XML: no "/SS" reference symbol anywhere in the file', xml, '/SS');
  notIncludes('de profile XML: no "/KS" reference symbol anywhere in the file', xml, '/KS');
  includes('de profile XML: stays pain.001.001.03', xml, 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03');
  const result = diagnose({ xml, bank: 'generic' });
  eq('de profile XML: Doctor status is not "fail"', result.status !== 'fail', true);
}
{
  // EndToEndId column left blank -> NOTPROVIDED, per ISO 20022 convention.
  const rows = [['IBAN', 'Betrag', 'Empfänger', 'Verwendungszweck'], [IBAN_DE_1, '10', 'Max Mustermann', 'Test']];
  const mapped = mapColumns(rows, undefined, 'de');
  eq('de profile, no EndToEndId column mapped: payment.endToEndId is empty', mapped.payments[0].endToEndId, '');
  const xml = buildXml({ profile: 'de', bank: 'generic', payer: { name: 'Firma', iban: IBAN_DE_2 }, payments: mapped.payments });
  includes('de profile XML: missing EndToEndId column defaults to NOTPROVIDED', xml, '<EndToEndId>NOTPROVIDED</EndToEndId>');
}
{
  // sk profile (default, unaffected): same fixture columns given a de-style
  // header still round-trips VS as before when profile is omitted.
  const rows = [['IBAN', 'Suma', 'Nazov', 'VS'], [IBAN_TATRA, '10', 'Jozef', '123']];
  const mapped = mapColumns(rows);
  const xml = buildXml({ bank: 'tatrabanka', payer: { name: 'Firma', iban: IBAN_TATRA }, payments: mapped.payments });
  includes('sk profile (default, no profile option given) still builds /VS as before', xml, '<EndToEndId>/VS123</EndToEndId>');
}

// ── SEPA character set (used for de-profile Verwendungszweck) ───────────
eq('isSepaCharset: plain ASCII text is SEPA-safe', isSepaCharset('Rechnung 2026-01 / Invoice No. 5'), true);
eq('isSepaCharset: German umlauts are NOT in the SEPA character set', isSepaCharset('Rechnung für Büro'), false);
eq('isSepaCharset: empty string is trivially SEPA-safe', isSepaCharset(''), true);
deepEq('sepaCharsetViolations: reports each distinct offending character once', sepaCharsetViolations('äöü äöü'), ['ä', 'ö', 'ü']);
deepEq('sepaCharsetViolations: clean text has no violations', sepaCharsetViolations('Invoice 2026-01'), []);
{
  const rows = [['IBAN', 'Betrag', 'Empfänger', 'Verwendungszweck'], [IBAN_DE_1, '10', 'Max Mustermann', 'Rechnung für Büro']];
  const mapped = mapColumns(rows, undefined, 'de');
  ok('de profile row validation: non-SEPA character in Verwendungszweck is flagged', mapped.payments[0].errors.some((e) => /SEPA/.test(e)));
  eq('de profile row validation: same row is fine under the sk profile (no SEPA charset check there)', mapColumns(rows, undefined, 'sk').payments[0].hasError, false);
}
{
  const longE2e = 'X'.repeat(36);
  const rows = [['IBAN', 'Betrag', 'Empfänger', 'Verwendungszweck', 'EndToEndId'], [IBAN_DE_1, '10', 'Max', 'Test', longE2e]];
  const mapped = mapColumns(rows, undefined, 'de');
  ok('de profile row validation: EndToEndId over 35 chars flagged (ISO 20022 Max35Text)', mapped.payments[0].errors.some((e) => /35/.test(e)));
}

// ── de profile: the same DK Anlage 3 charset rule that restricts
// Verwendungszweck also covers Cdtr/Nm, so an ordinary German surname with
// an umlaut or ß (Müller, Schäfer, Groß, ...) must be flagged too — before
// this check existed, a whole batch of perfectly normal German names built
// "clean" (hasError: false) and only bounced individually at the bank. ────
{
  const rows = [['IBAN', 'Betrag', 'Empfänger', 'Verwendungszweck'], [IBAN_DE_1, '10', 'Jürgen Müller', 'Test']];
  const mapped = mapColumns(rows, undefined, 'de');
  ok('de profile row validation: umlaut in creditor name is flagged', mapped.payments[0].errors.some((e) => /SEPA/.test(e)));
  eq('de profile row validation: umlaut name is fine under the sk profile (no SEPA charset check there)', mapColumns(rows, undefined, 'sk').payments[0].hasError, false);
}
{
  const rows = [['IBAN', 'Betrag', 'Empfänger', 'Verwendungszweck'], [IBAN_DE_1, '10', 'Weiß & Groß GmbH', 'Test']];
  const mapped = mapColumns(rows, undefined, 'de');
  ok('de profile row validation: eszett (ß) in creditor name is flagged too', mapped.payments[0].errors.some((e) => /SEPA/.test(e)));
}
{
  const rows = [['IBAN', 'Betrag', 'Empfänger', 'Verwendungszweck'], [IBAN_DE_1, '10', 'Max Mustermann', 'Test']];
  const mapped = mapColumns(rows, undefined, 'de');
  eq('de profile row validation: a plain-ASCII creditor name has no SEPA charset error', mapped.payments[0].hasError, false);
}

// ═══════════════════════════ i18n.js: SK/EN/DE dictionary ═══════════════
// The tool is one page for Slovak accountants and for an English/German
// visitor using the "de" country profile (SK/EN/DE), driven by a single
// dictionary object and pure helpers in i18n.js, following exactly the
// pattern already built for the sibling tool camt053-to-excel. These
// assertions check the dictionary itself, not the DOM wiring (applyI18n/
// setLang), which needs a real browser.

eq('i18n LANGS: exactly [sk, en, de]', LANGS.join(','), 'sk,en,de');
eq('i18n DEFAULT_LANG: "en" (fallback when navigator.language is neither de nor sk/cs)', DEFAULT_LANG, 'en');
eq('i18n STORAGE_KEY: shared "arling_lang" key across every ARLing tool', I18N_STORAGE_KEY, 'arling_lang');

{
  const incomplete = findIncompleteEntries();
  deepEq('i18n dictionary: every DICT entry has a non-empty sk/en/de', incomplete, []);
}
ok('i18n dictionary: has a substantial number of keys (every visible string on the page)', Object.keys(DICT).length >= 150);
ok('i18n dictionary: has exactly 12 FAQ question/answer pairs (11 original + the new de-profile one)', Object.keys(DICT).filter((k) => /^faq\.q\d+$/.test(k)).length === 12 && Object.keys(DICT).filter((k) => /^faq\.a\d+$/.test(k)).length === 12);

// ── t()/tf() lookup ────────────────────────────────────────────────────
eq('t: unknown key returns the key itself (missing translation stays visible, not blank)', t('no.such.key', 'en'), 'no.such.key');
eq('t: falls back to DEFAULT_LANG for an unsupported language code', t('js.status.pass', 'fr'), t('js.status.pass', 'en'));
includes('tf: fills a single {placeholder}', tf('js.download.all', { n: 5 }, 'en'), '5');
includes('tf: fills a {placeholder} used inside a longer German string', tf('js.doctor.execwindow.days', { n: 30 }, 'de'), '30');
eq('t: bank.genericDe carries the DK-Regelwerk German label', t('bank.genericDe', 'de'), 'Bank nach DK-Regelwerk (pain.001.001.03)');
eq('t: profile.de.label is translated per language', t('profile.de.label', 'en'), 'Germany (DK, Verwendungszweck)');

// ── number formatting per language ──────────────────────────────────────
eq('formatAmountForLang: English keeps a decimal point', formatAmountForLang(1234.5, 'en'), '1234.50');
eq('formatAmountForLang: Slovak uses a decimal comma', formatAmountForLang(1234.5, 'sk'), '1234,50');
eq('formatAmountForLang: German uses a decimal comma', formatAmountForLang(1234.5, 'de'), '1234,50');
eq('formatAmountForLang: negative amount, German decimal comma', formatAmountForLang(-89.9, 'de'), '-89,90');
eq('formatAmountForLang: null amount renders as an empty string, not "null"', formatAmountForLang(null, 'en'), '');
eq('formatAmountForLang: NaN renders as an empty string', formatAmountForLang(NaN, 'sk'), '');

// ── per-language number PARSING (the engine's own parseAmount(), which is
// already locale-tolerant — these assert the specific sk/en/de-typical
// input shapes the brief calls out: decimal comma vs. decimal point) ─────
eq('parseAmount: Slovak/German-typical decimal comma "450,00"', parseAmount('450,00'), 450);
eq('parseAmount: Slovak/German-typical thousands dot + decimal comma "1.234,56"', parseAmount('1.234,56'), 1234.56);
eq('parseAmount: English-typical decimal point "450.00"', parseAmount('450.00'), 450);
eq('parseAmount: English-typical thousands comma + decimal point "1,234.56"', parseAmount('1,234.56'), 1234.56);
eq('parseAmount: German "€" currency suffix stripped, decimal comma kept', parseAmount('123,45 €'), 123.45);

// ── date formatting per language ────────────────────────────────────────
eq('formatDateForLang: English keeps ISO yyyy-mm-dd', formatDateForLang('2026-09-02', 'en'), '2026-09-02');
eq('formatDateForLang: Slovak reformats to dd.mm.yyyy', formatDateForLang('2026-09-02', 'sk'), '02.09.2026');
eq('formatDateForLang: German reformats to dd.mm.yyyy', formatDateForLang('2026-09-02', 'de'), '02.09.2026');
eq('formatDateForLang: empty input passes through as an empty string', formatDateForLang('', 'en'), '');
eq('formatDateForLang: non-ISO input passes through unchanged', formatDateForLang('n/a', 'de'), 'n/a');

// ── date PARSING per language (the engine's own parseFlexibleDate(),
// already accepting both ISO and dd.mm.yyyy regardless of UI language) ───
eq('parseFlexibleDate: German/Slovak-typical dd.mm.yyyy "15.09.2026"', parseFlexibleDate('15.09.2026'), '2026-09-15');
eq('parseFlexibleDate: English-typical ISO yyyy-mm-dd "2026-09-15"', parseFlexibleDate('2026-09-15'), '2026-09-15');

// ── locale detection (pure logic; the DOM-facing detectLang() wraps this
// with location.search / localStorage / navigator.language, untestable
// under Node without a browser) ──────────────────────────────────────────
eq('langFromLocale: "de-DE" -> de', langFromLocale('de-DE'), 'de');
eq('langFromLocale: "de-AT" -> de (Austrian German)', langFromLocale('de-AT'), 'de');
eq('langFromLocale: "de-CH" -> de (Swiss German)', langFromLocale('de-CH'), 'de');
eq('langFromLocale: "sk-SK" -> sk', langFromLocale('sk-SK'), 'sk');
eq('langFromLocale: "cs-CZ" -> sk (Czech maps to Slovak, per the brief)', langFromLocale('cs-CZ'), 'sk');
eq('langFromLocale: "fr-FR" -> en (anything else defaults to English)', langFromLocale('fr-FR'), 'en');
eq('langFromQueryString: "?lang=de" -> de', langFromQueryString('?lang=de'), 'de');
eq('langFromQueryString: "?lang=SK" is case-insensitive -> sk', langFromQueryString('?lang=SK'), 'sk');
eq('langFromQueryString: unsupported ?lang= value -> null (caller falls through)', langFromQueryString('?lang=fr'), null);
eq('langFromQueryString: no ?lang= param -> null', langFromQueryString('?other=1'), null);

// ── misc per-language lookups used in the page ───────────────────────────
eq('localeTagForLang: sk -> sk-SK (history timestamp locale)', localeTagForLang('sk'), 'sk-SK');
eq('localeTagForLang: de -> de-DE', localeTagForLang('de'), 'de-DE');
eq('localeTagForLang: en -> en-GB', localeTagForLang('en'), 'en-GB');
eq('ogLocaleForLang: sk -> sk_SK', ogLocaleForLang('sk'), 'sk_SK');
eq('ogLocaleForLang: de -> de_DE', ogLocaleForLang('de'), 'de_DE');
eq('ogLocaleForLang: en -> en_US', ogLocaleForLang('en'), 'en_US');

// ── no leftover Slovak in the English/German copy ────────────────────────
{
  const leftoverWords = ['Máte', 'Dostanete', 'Vložte platby', 'Skopírujte'];
  const offenders = [];
  for (const [key, entry] of Object.entries(DICT)) {
    for (const lang of ['en', 'de']) {
      for (const w of leftoverWords) {
        if (String(entry[lang] || '').includes(w)) offenders.push(`${key}.${lang}`);
      }
    }
  }
  ok('i18n dictionary: no leftover Slovak "Máte"/"Dostanete"/etc. in any English or German value', offenders.length === 0, offenders.join(', '));
}
{
  // No em dash (—) in any translated value (Paper design system rule).
  const emdash = '—';
  const offenders = [];
  for (const [key, entry] of Object.entries(DICT)) {
    for (const lang of LANGS) {
      if (String(entry[lang] || '').includes(emdash)) offenders.push(`${key}.${lang}`);
    }
  }
  ok('i18n dictionary: no em dash in any sk/en/de value', offenders.length === 0, offenders.join(', '));
}

// ═══════════════════════════ summary ═══════════════════════════════════

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total assertions)`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
