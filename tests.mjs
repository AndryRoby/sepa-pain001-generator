// tests.mjs — plain Node test runner for generator-pain001.js (no external
// dependencies). Also cross-checks a handful of generated files against
// doctor-pain001.js (copied unchanged into this repo) to confirm a clean
// input produces a file the sibling diagnostic tool considers clean too.
// Run with: node tests.mjs

import {
  parseRows, mapColumns, buildXml, bicFromIban, parseAmount, parseFlexibleDate,
  buildEndToEndId, checkIban, transliterate, autoMsgId, defaultExecDate, MAX_PAYMENTS,
} from './generator-pain001.js';
import { diagnose } from './doctor-pain001.js';

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

// ═══════════════════════════ small extras ══════════════════════════════

eq('checkIban: valid generated IBAN passes', checkIban(IBAN_TATRA).valid, true);
eq('checkIban: empty string is invalid', checkIban('').valid, false);
eq('transliterate: strips Slovak diacritics', transliterate('Žofia Šťastná'), 'Zofia Stastna');
ok('autoMsgId: matches the documented pattern', /^ARL-\d{8}-\d{6}$/.test(autoMsgId(new Date('2026-09-05T09:03:07'))));
eq('defaultExecDate: is exactly one day after the given date', defaultExecDate(new Date('2026-09-04T12:00:00')), '2026-09-05');

// ═══════════════════════════ summary ═══════════════════════════════════

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total assertions)`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
