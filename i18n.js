// i18n.js: SK/EN/DE dictionary and tiny rendering engine for SEPA pain.001
// Generátor, so the same page works for accountants in Slovakia, and for an
// English- or German-speaking user building a German (Deutsche
// Kreditwirtschaft, "de" profile) pain.001.001.03 file. No framework: every
// visible string lives in one DICT object below, keyed by {sk, en, de};
// index.html marks translatable elements with data-i18n* attributes, and
// applyI18n() below fills them in. Pattern and every exported helper name
// mirror camt053-to-excel's own i18n.js (same repo family) on purpose, so
// the two pages stay maintainable the same way.
//
// Split in two halves on purpose:
//  - pure helpers (t, tf, fieldLabel, bankLabel, profileLabel,
//    formatAmountForLang, formatDateForLang, langFromLocale, detectLang's
//    query/storage logic) never touch the DOM, so tests.mjs can import and
//    assert on them directly under Node, the same way it already does for
//    generator-pain001.js, doctor-pain001.js, licence.js and pro.js.
//  - DOM-touching code (applyI18n, setLang, the bootstrap at the bottom) is
//    guarded behind `typeof document !== 'undefined'` so importing this
//    file under Node never throws.

export const LANGS = ['sk', 'en', 'de'];
export const DEFAULT_LANG = 'en';
export const STORAGE_KEY = 'arling_lang';

// ─────────────────────────────── dictionary ────────────────────────────────
// Every value has all three languages. tests.mjs asserts this exhaustively.

export const DICT = {
  // ── header / nav / language switch ────────────────────────────────────
  'skip': { sk: 'Skočiť na generátor', en: 'Skip to the generator', de: 'Zum Generator springen' },
  'wordmark': { sk: 'SEPA pain.001 Generátor', en: 'SEPA pain.001 Generator', de: 'SEPA-pain.001-Generator' },
  'brand.sub': { sk: 'nástroj ARLing', en: 'an ARLing tool', de: 'ein ARLing-Tool' },
  'nav.how': { sk: 'Ako to funguje', en: 'How it works', de: 'So funktioniert es' },
  'nav.convert': { sk: 'Generátor', en: 'Generator', de: 'Generator' },
  'nav.api': { sk: 'API', en: 'API', de: 'API' },
  'nav.pro': { sk: 'Pro', en: 'Pro', de: 'Pro' },
  'nav.faq': { sk: 'Otázky', en: 'FAQ', de: 'FAQ' },
  'nav.tools': { sk: 'Nástroje', en: 'Tools', de: 'Werkzeuge' },
  'nav.work': { sk: 'Ako pracujeme', en: 'How we work', de: 'Wie wir arbeiten' },
  'nav.contact': { sk: 'Kontakt', en: 'Contact', de: 'Kontakt' },
  'lang.switch.aria': { sk: 'Jazyk stránky', en: 'Page language', de: 'Sprache der Seite' },
  'lang.sk.aria': { sk: 'Slovenčina', en: 'Slovak', de: 'Slowakisch' },
  'lang.en.aria': { sk: 'English', en: 'English', de: 'Englisch' },
  'lang.de.aria': { sk: 'Deutsch', en: 'German', de: 'Deutsch' },

  // ── hero ─────────────────────────────────────────────────────────────
  'hero.h1': {
    sk: 'Zoznam platieb z Excelu na XML pre banku. Skontrolovaný, za minútu.',
    en: 'A payment list from Excel to a bank XML file. Checked, in a minute.',
    de: 'Zahlungsliste aus Excel zur Bank-XML. Geprüft, in einer Minute.',
  },
  'hero.lead': {
    sk: 'Vložte platby skopírované z Excelu alebo CSV, vyplňte IBAN platiteľa a stiahnite pain.001 hromadný príkaz. Súbor sa hneď po vygenerovaní skontroluje cez ten istý engine ako SEPA pain.001 Doctor.',
    en: 'Paste payments copied from Excel or CSV, fill in the payer’s IBAN, and download a pain.001 batch payment file. The file is checked right after generation by the same engine as SEPA pain.001 Doctor.',
    de: 'Fügen Sie aus Excel oder CSV kopierte Zahlungen ein, tragen Sie die IBAN des Zahlers ein und laden Sie eine pain.001-Sammelüberweisung herunter. Die Datei wird direkt nach der Erstellung mit derselben Engine wie SEPA pain.001 Doctor geprüft.',
  },
  'hero.cta': { sk: 'Vytvoriť súbor', en: 'Create a file', de: 'Datei erstellen' },
  'hero.source': { sk: 'Zdrojový kód na GitHube', en: 'Source code on GitHub', de: 'Quellcode auf GitHub' },
  'hero.fact.banks': { sk: '4 banky: Tatra banka, SLSP, VÚB, ČSOB', en: '4 Slovak banks, plus a generic DE (Deutsche Kreditwirtschaft) profile', de: '4 slowakische Banken, plus generisches DE-Profil (Deutsche Kreditwirtschaft)' },
  'hero.fact.tests': { sk: '456 automatizovaných testov', en: '456 automated tests', de: '456 automatisierte Tests' },
  'hero.fact.maxpayments': { sk: 'max. 5000 platieb', en: 'max. 5000 payments', de: 'max. 5000 Zahlungen' },
  'hero.fact.free': { sk: '0 €, bez účtu', en: '€0, no account', de: '0 €, ohne Konto' },
  'hero.fact.browser': { sk: 'beží vo vašom prehliadači', en: 'runs in your browser', de: 'läuft im Browser' },

  // ── section 01: three pitfalls ──────────────────────────────────────
  's1.h2': {
    sk: 'Tri veci, ktoré pri ručnom skladaní XML najčastejšie pokazia súbor.',
    en: 'Three things that most often break a hand-assembled XML file.',
    de: 'Drei Dinge, die eine handgebaute XML-Datei am häufigsten ungültig machen.',
  },
  's1.sub': {
    sk: 'Zložiť pain.001 XML v texťáku alebo vzorci v Exceli sa dá, ale stačí jedna maličkosť a banka súbor odmietne bez vysvetlenia.',
    en: 'Assembling pain.001 XML by hand in a text editor or an Excel formula is possible, but one small mistake is enough for a bank to reject the file without explanation.',
    de: 'Eine pain.001-XML von Hand in einem Texteditor oder einer Excel-Formel zu bauen, ist möglich, aber eine Kleinigkeit genügt, und die Bank lehnt die Datei ohne Erklärung ab.',
  },
  's1.r1.title': { sk: 'Stĺpce sa rozpoznávajú podľa názvu, nie podľa poradia.', en: 'Columns are recognized by name, not by position.', de: 'Spalten werden anhand des Namens erkannt, nicht der Reihenfolge.' },
  's1.r1.body': {
    sk: 'Generátor hľadá „IBAN“, „suma“, „názov“ a podobné hlavičky automaticky. Pri nezvyčajnom Exceli mapovanie skontrolujte a v prípade potreby ho ručne opravte vo výberoch nad náhľadom.',
    en: 'The generator looks for headers like “IBAN”, “Amount”, “Name” automatically, in Slovak, English or German. For an unusual spreadsheet, check the mapping and fix it by hand in the dropdowns above the preview if needed.',
    de: 'Der Generator sucht automatisch nach Spaltenüberschriften wie „IBAN“, „Betrag“, „Name“, auf Slowakisch, Englisch oder Deutsch. Bei einem ungewöhnlichen Excel prüfen Sie die Zuordnung und korrigieren Sie sie bei Bedarf manuell in den Auswahlfeldern über der Vorschau.',
  },
  's1.r2.title': { sk: 'VS, ŠS a KS nemajú v XML vlastné pole.', en: 'VS/SS/KS have no field of their own in the XML.', de: 'VS/SS/KS haben in der XML kein eigenes Feld.' },
  's1.r2.body': {
    sk: 'Musia byť zapísané v <code>EndToEndId</code> v presnom poradí <code>/VS.../SS.../KS...</code>. Zlé poradie prevod nezastaví, ale príjemca si platbu nespáruje s faktúrou.',
    en: 'They have to be written into <code>EndToEndId</code> in the exact order <code>/VS.../SS.../KS...</code> (the “sk” country profile does this automatically). The “de” profile skips VS/SS/KS entirely and uses an unstructured Verwendungszweck instead, since German banks don’t use these Slovak reference symbols.',
    de: 'Sie müssen in genauer Reihenfolge <code>/VS.../SS.../KS...</code> in <code>EndToEndId</code> geschrieben werden (das Länderprofil „sk“ erledigt das automatisch). Das Profil „de“ verzichtet ganz auf VS/SS/KS und nutzt stattdessen einen unstrukturierten Verwendungszweck, da deutsche Banken diese slowakischen Referenzsymbole nicht verwenden.',
  },
  's1.r3.title': { sk: 'Formát je jedna vec, pravidlá banky druhá.', en: 'The format is one thing, a bank’s own rules another.', de: 'Das Format ist die eine Sache, die Regeln der Bank die andere.' },
  's1.r3.body': {
    sk: 'Po vygenerovaní beží nad súborom rovnaký engine ako v <a href="https://arling.sk/sepa-pain001-doctor/">SEPA pain.001 Doctorovi</a>: BIC, dátum splatnosti, diakritika a limit transakcií podľa vybranej banky.',
    en: 'After generation, the same engine as <a href="https://arling.sk/sepa-pain001-doctor/">SEPA pain.001 Doctor</a> runs over the file: BIC, execution date, accented characters, and the transaction cap for the selected bank.',
    de: 'Nach der Erstellung läuft dieselbe Engine wie bei <a href="https://arling.sk/sepa-pain001-doctor/">SEPA pain.001 Doctor</a> über die Datei: BIC, Ausführungsdatum, Sonderzeichen und das Transaktionslimit der gewählten Bank.',
  },

  // ── section 02: playground ──────────────────────────────────────────
  's2.h2': {
    sk: 'Vložte platby, vyplňte platiteľa. Dostanete hotový XML.',
    en: 'Paste payments, fill in the payer. You get a finished XML.',
    de: 'Zahlungen einfügen, Zahler ausfüllen. Sie erhalten die fertige XML.',
  },
  's2.sub': {
    sk: 'Nič z toho, čo vložíte, sa neodosiela. Generovanie aj kontrola bežia vo vašom prehliadači.',
    en: 'Nothing you paste is sent anywhere. Generating and checking both run in your browser.',
    de: 'Nichts von dem, was Sie einfügen, wird versendet. Erstellung und Prüfung laufen im Browser.',
  },
  's2.tab.form': { sk: 'Formulár', en: 'Form', de: 'Formular' },
  's2.tab.json': { sk: 'JSON', en: 'JSON', de: 'JSON' },
  's2.sample.btn': { sk: 'ukážka', en: 'sample', de: 'Beispiel' },
  's2.sample.btn.title': { sk: 'Načítať ukážkové platby (jedna zámerne s neplatným IBAN-om)', en: 'Load sample payments (one deliberately has an invalid IBAN)', de: 'Beispielzahlungen laden (eine mit absichtlich ungültiger IBAN)' },
  's2.generate.btn': { sk: 'Generovať ↵', en: 'Generate ↵', de: 'Erstellen ↵' },
  's2.payer.title': { sk: 'Platiteľ', en: 'Payer', de: 'Zahler' },
  's2.payer.hint': { sk: 'uložené profily', en: 'saved profiles', de: 'gespeicherte Profile' },
  's2.pro.badge': { sk: 'PRO', en: 'PRO', de: 'PRO' },
  's2.profile.select.label': { sk: 'uložený profil platiteľa', en: 'saved payer profile', de: 'gespeichertes Zahlerprofil' },
  's2.profile.select.placeholder': { sk: '(vybrať uložený profil)', en: '(select a saved profile)', de: '(gespeichertes Profil wählen)' },
  's2.profile.save.btn': { sk: 'Uložiť ako profil', en: 'Save as a profile', de: 'Als Profil speichern' },
  's2.profile.delete.btn': { sk: 'Zmazať profil', en: 'Delete profile', de: 'Profil löschen' },
  's2.payer.name.label': { sk: 'názov firmy', en: 'company name', de: 'Firmenname' },
  's2.payer.name.placeholder': { sk: 'Moja firma s. r. o.', en: 'My company Ltd.', de: 'Meine Firma GmbH' },
  's2.payer.iban.label': { sk: 'IBAN debetného účtu', en: 'Debtor IBAN', de: 'IBAN des Zahlerkontos' },
  's2.payer.bic.label': { sk: 'BIC platiteľa', en: 'Payer’s BIC', de: 'BIC des Zahlers' },
  's2.payer.bic.placeholder': { sk: 'odvodí sa z IBAN', en: 'derived from the IBAN', de: 'wird aus der IBAN abgeleitet' },
  's2.payer.bic.hint': {
    sk: 'Pri slovenskom IBAN sa odvodí automaticky zo 4-miestneho kódu banky. Pri IBAN z inej krajiny ho vyplňte ručne.',
    en: 'For a Slovak IBAN, this is derived automatically from the 4-digit bank code. For an IBAN from another country, fill it in by hand. Since February 2016, BIC has been optional for IBANs from EEA/SEPA countries anyway.',
    de: 'Bei einer slowakischen IBAN wird das automatisch aus dem 4-stelligen Bankleitzahl-Code abgeleitet. Bei einer IBAN aus einem anderen Land tragen Sie sie bitte manuell ein. Seit Februar 2016 ist der BIC bei IBANs aus EWR-/SEPA-Ländern ohnehin optional.',
  },
  's2.settings.title': { sk: 'Nastavenia', en: 'Settings', de: 'Einstellungen' },
  's2.bank.label': { sk: 'banka (cieľový import)', en: 'bank (target import)', de: 'Zielbank' },
  's2.payer.address.label': { sk: 'adresa platiteľa', en: 'payer address', de: 'Adresse des Zahlers' },
  's2.payer.address.hint': {
    sk: 'Nepovinná. Keď ju vyplníte, od 15. 11. 2026 musí obsahovať aspoň mesto a krajinu, inak banka platbu odmietne. Krajinu doplníme z IBAN, ak ju necháte prázdnu.',
    en: 'Optional. If you fill it in, from 15 November 2026 it must contain at least the town and the country code, otherwise the bank rejects the payment. We derive the country from the IBAN when you leave it empty.',
    de: 'Optional. Wenn Sie sie ausfüllen, muss sie ab dem 15. November 2026 mindestens Ort und Länderkennzeichen enthalten, sonst weist die Bank die Zahlung zurück. Das Land leiten wir aus der IBAN ab, wenn Sie es leer lassen.',
  },
  's2.payer.street.label': { sk: 'ulica', en: 'street', de: 'Straße' },
  's2.payer.bldgnb.label': { sk: 'číslo domu', en: 'building number', de: 'Hausnummer' },
  's2.payer.postcode.label': { sk: 'PSČ', en: 'postal code', de: 'PLZ' },
  's2.payer.town.label': { sk: 'mesto', en: 'town', de: 'Ort' },
  's2.payer.country.label': { sk: 'krajina', en: 'country', de: 'Land' },
  's2.schema.label': { sk: 'verzia správy', en: 'message version', de: 'Nachrichtenversion' },
  's2.schema.hint': {
    sk: 'Slovenské banky dnes pri hromadnom importe čakajú .03. Od 15. 11. 2026 časť z nich prechádza na .09. Štruktúrovanú adresu zvládnu obe.',
    en: 'Slovak banks currently expect .03 for bulk import. From 15 November 2026 some of them switch to .09. Both versions can carry a structured address.',
    de: 'Slowakische Banken erwarten für den Sammelimport derzeit .03. Ab dem 15. November 2026 stellt ein Teil von ihnen auf .09 um. Eine strukturierte Adresse tragen beide Versionen.',
  },
  's2.execdate.label': { sk: 'dátum splatnosti', en: 'execution date', de: 'Ausführungsdatum' },
  's2.msgid.label': { sk: 'MsgId (nepovinné)', en: 'MsgId (optional)', de: 'MsgId (optional)' },
  's2.msgid.placeholder': { sk: 'auto: ARL-YYYYMMDD-HHMMSS', en: 'auto: ARL-YYYYMMDD-HHMMSS', de: 'automatisch: ARL-YYYYMMDD-HHMMSS' },
  's2.countryprofile.label': { sk: 'profil krajiny', en: 'country profile', de: 'Länderprofil' },
  's2.countryprofile.hint': {
    sk: 'Slovensko: VS/ŠS/KS v EndToEndId. Nemecko (DK): žiadne VS/ŠS/KS, namiesto toho Verwendungszweck a voliteľné EndToEndId.',
    en: 'Slovakia: VS/SS/KS packed into EndToEndId. Germany (DK): no VS/SS/KS, an unstructured Verwendungszweck and an optional EndToEndId column instead.',
    de: 'Slowakei: VS/SS/KS im EndToEndId. Deutschland (DK): kein VS/SS/KS, stattdessen ein unstrukturierter Verwendungszweck und eine optionale EndToEndId-Spalte.',
  },
  's2.payments.title': { sk: 'Platby', en: 'Payments', de: 'Zahlungen' },
  's2.payments.hint': { sk: 'z Excelu (Ctrl+V) alebo súbor .csv/.txt/.tsv', en: 'from Excel (Ctrl+V) or a .csv/.txt/.tsv file', de: 'aus Excel (Strg+V) oder eine .csv/.txt/.tsv-Datei' },
  's2.payments.placeholder': {
    sk: 'Sem vložte platby skopírované z Excelu (IBAN, suma, názov, VS, správa…).',
    en: 'Paste payments copied from Excel here (IBAN, amount, name, reference, message…).',
    de: 'Fügen Sie hier aus Excel kopierte Zahlungen ein (IBAN, Betrag, Name, Verwendungszweck…).',
  },
  's2.template.label': { sk: 'šablóna mapovania stĺpcov', en: 'column-mapping template', de: 'Vorlage für Spaltenzuordnung' },
  's2.template.auto': { sk: '(automatické rozpoznanie)', en: '(automatic detection)', de: '(automatische Erkennung)' },
  's2.map.iban': { sk: 'IBAN', en: 'IBAN', de: 'IBAN' },
  's2.map.amount': { sk: 'Suma', en: 'Amount', de: 'Betrag' },
  's2.map.name': { sk: 'Názov', en: 'Name', de: 'Name' },
  's2.map.vs': { sk: 'VS', en: 'VS', de: 'VS' },
  's2.map.ss': { sk: 'ŠS', en: 'SS', de: 'SS' },
  's2.map.ks': { sk: 'KS', en: 'KS', de: 'KS' },
  's2.map.message': { sk: 'Správa', en: 'Message', de: 'Nachricht' },
  's2.map.message.de': { sk: 'Verwendungszweck', en: 'Verwendungszweck', de: 'Verwendungszweck' },
  's2.map.date': { sk: 'Dátum', en: 'Date', de: 'Datum' },
  's2.map.bic': { sk: 'BIC', en: 'BIC', de: 'BIC' },
  's2.map.street': { sk: 'Ulica', en: 'Street', de: 'Straße' },
  's2.map.buildingnb': { sk: 'Číslo domu', en: 'Building number', de: 'Hausnummer' },
  's2.map.postcode': { sk: 'PSČ', en: 'Postal code', de: 'PLZ' },
  's2.map.town': { sk: 'Mesto', en: 'Town', de: 'Ort' },
  's2.map.country': { sk: 'Krajina', en: 'Country', de: 'Land' },
  's2.map.address': { sk: 'Celá adresa', en: 'Full address', de: 'Ganze Adresse' },
  's2.map.endtoend': { sk: 'EndToEndId', en: 'EndToEndId', de: 'EndToEndId' },
  's2.map.none': { sk: '(žiadny)', en: '(none)', de: '(keine)' },
  's2.blocks.title': { sk: 'Ďalšie bloky platieb', en: 'Additional payment blocks', de: 'Weitere Zahlungsblöcke' },
  's2.blocks.hint': { sk: 'viac súborov naraz', en: 'several files at once', de: 'mehrere Dateien gleichzeitig' },
  's2.blocks.add.btn': { sk: '+ pridať blok platieb', en: '+ add a payment block', de: '+ Zahlungsblock hinzufügen' },
  's2.blocks.merge.label': {
    sk: 'zlúčiť všetky bloky do jedného XML (inak samostatný súbor na blok)',
    en: 'merge every block into one XML (otherwise a separate file per block)',
    de: 'alle Blöcke zu einer XML zusammenführen (sonst separate Datei je Block)',
  },
  's2.output.label': { sk: 'Výsledok', en: 'Result', de: 'Ergebnis' },
  's2.history.btn': { sk: 'história', en: 'history', de: 'Verlauf' },
  's2.copyreport.btn': { sk: 'kopírovať report', en: 'copy report', de: 'Bericht kopieren' },
  's2.output.placeholder.full': {
    sk: 'vyplňte platiteľa a platby, stlačte <span class="kbd">Generovať</span> alebo <span class="kbd">⌘↵</span><span class="blink"></span>',
    en: 'fill in the payer and payments, press <span class="kbd">Generate</span> or <span class="kbd">⌘↵</span><span class="blink"></span>',
    de: 'Zahler und Zahlungen ausfüllen, dann <span class="kbd">Erstellen</span> oder <span class="kbd">⌘↵</span><span class="blink"></span>',
  },
  's2.status.label': { sk: 'status', en: 'status', de: 'Status' },
  's2.permalink.note': {
    sk: 'Nastavenia (banka, dátum splatnosti, MsgId) sa po vygenerovaní uložia do odkazu na stránku. Platiteľ ani platby sa do odkazu neukladajú, takže výsledok cez URL zdieľať nemožno. Na zdieľanie výsledku použite tlačidlo „kopírovať report“ alebo stiahnutý XML súbor.',
    en: 'Settings (bank, execution date, MsgId) are saved into the page link after generating. The payer and payments are never saved into the link, so the result can’t be shared via URL. To share the result, use the “copy report” button or the downloaded XML file.',
    de: 'Einstellungen (Bank, Ausführungsdatum, MsgId) werden nach der Erstellung im Seitenlink gespeichert. Zahler und Zahlungen werden nie im Link gespeichert, das Ergebnis lässt sich also nicht per URL teilen. Zum Teilen nutzen Sie die Schaltfläche „Bericht kopieren“ oder die heruntergeladene XML-Datei.',
  },

  // ── section 03: endpoint / API ───────────────────────────────────────
  's3.h2': {
    sk: 'Dve funkcie. Platby dnu, XML von, hneď skontrolované.',
    en: 'Two functions. Payments in, XML out, checked right away.',
    de: 'Zwei Funktionen. Zahlungen hinein, XML heraus, sofort geprüft.',
  },
  's3.sub': {
    sk: 'Žiadny server, žiadny API kľúč, žiadna registrácia. <code>generator-pain001.js</code> je čistý JavaScript: prečítajte si ho, forknite, alebo ho spustite vo vlastnom kóde či CI.',
    en: 'No server, no API key, no sign-up. <code>generator-pain001.js</code> is plain JavaScript: read it, fork it, or run it in your own code or CI.',
    de: 'Kein Server, kein API-Schlüssel, keine Anmeldung. <code>generator-pain001.js</code> ist reines JavaScript: lesen, forken oder im eigenen Code bzw. in der CI ausführen.',
  },
  's3.codeblock.label': { sk: '0 závislostí', en: '0 dependencies', de: '0 Abhängigkeiten' },
  's3.code.comment1': { sk: 'alebo globálne: const { parseRows, mapColumns, buildXml, bicFromIban } = window.SepaGenerator;', en: 'or globally: const { parseRows, mapColumns, buildXml, bicFromIban } = window.SepaGenerator;', de: 'oder global: const { parseRows, mapColumns, buildXml, bicFromIban } = window.SepaGenerator;' },
  's3.code.comment2': { sk: 'súbor sa hneď kontroluje rovnakým engine ako SEPA pain.001 Doctor:', en: 'the file is checked right away by the same engine as SEPA pain.001 Doctor:', de: 'die Datei wird sofort mit derselben Engine wie SEPA pain.001 Doctor geprüft:' },
  's3.copy.p1': {
    sk: 'Parsovanie Excelu/CSV, mapovanie stĺpcov aj skladanie XML beží presne tak, ako ho volá formulár vyššie, vo vašom prehliadači. Neexistuje backend ani API kľúč, ktorý by obsah vašich platieb odniesol inam.',
    en: 'Parsing Excel/CSV, mapping columns, and building the XML run exactly as the form above calls them, in your browser. There is no backend or API key that could carry your payments’ content anywhere else.',
    de: 'Das Parsen von Excel/CSV, die Spaltenzuordnung und der Aufbau der XML laufen genau so, wie das Formular oben sie aufruft, in Ihrem Browser. Es gibt kein Backend und keinen API-Schlüssel, der den Inhalt Ihrer Zahlungen woandershin übertragen könnte.',
  },
  's3.copy.p2': {
    sk: 'Poradie a povinnosť polí v XML vychádza priamo z technickej dokumentácie Tatra banky (<code>pain.001.001.03</code>, sekcie GroupHeader a PaymentInformation) a z tých istých pravidiel bánk, ktoré overuje SEPA pain.001 Doctor.',
    en: 'The order and mandatory/optional status of every XML field comes directly from Tatra banka’s technical documentation (<code>pain.001.001.03</code>, GroupHeader and PaymentInformation sections) and the same bank-specific rules SEPA pain.001 Doctor checks.',
    de: 'Reihenfolge und Pflicht-/Optional-Status jedes XML-Felds stammen direkt aus der technischen Dokumentation der Tatra banka (<code>pain.001.001.03</code>, Abschnitte GroupHeader und PaymentInformation) sowie denselben bankspezifischen Regeln, die SEPA pain.001 Doctor prüft.',
  },
  's3.copy.p3': {
    sk: 'Zadarmo, otvorené, bez reklamy a bez sledovania nad rámec anonymných počtov použitia. Prípad, ktorý generátor spracuje zle, nahláste ako <a href="https://github.com/AndryRoby/sepa-pain001-generator/issues" target="_blank" rel="noopener">issue na GitHube</a>.',
    en: 'Free, open, no ads, and no tracking beyond anonymous usage counts. If the generator gets a case wrong, please report it as an <a href="https://github.com/AndryRoby/sepa-pain001-generator/issues" target="_blank" rel="noopener">issue on GitHub</a>.',
    de: 'Kostenlos, offen, ohne Werbung und ohne Tracking über anonyme Nutzungszahlen hinaus. Verarbeitet der Generator einen Fall falsch, melden Sie ihn bitte als <a href="https://github.com/AndryRoby/sepa-pain001-generator/issues" target="_blank" rel="noopener">Issue auf GitHub</a>.',
  },
  's3.copy.p4': {
    sk: 'Nástroj nie je prepojený s Tatra bankou, Slovenskou sporiteľňou, VÚB ani ČSOB a nie je banka. Čistý výsledok kontroly nezaručuje, že banka platbu prijme.',
    en: 'This tool is not affiliated with any bank and is not a bank itself. A clean check result does not guarantee a bank will accept the payment.',
    de: 'Dieses Tool ist mit keiner Bank verbunden und ist selbst keine Bank. Ein sauberes Prüfergebnis garantiert nicht, dass eine Bank die Zahlung annimmt.',
  },

  // ── section 04: Pro ──────────────────────────────────────────────────
  's4.h2': { sk: 'Pro pre účtovníka, ktorý to robí každý mesiac.', en: 'Pro for a bookkeeper who does this every month.', de: 'Pro für Buchhalter, die das jeden Monat machen.' },
  's4.sub': {
    sk: 'Bezplatná verzia ostáva bez limitov navždy, na počet platieb, súborov aj stiahnutí. Pro je pohodlie pri opakovanom mesačnom spracovaní, nie odomknutá funkčnosť.',
    en: 'The free version stays unlimited forever: no cap on payments, files, or downloads. Pro is convenience for repeat monthly use, not unlocked core functionality.',
    de: 'Die kostenlose Version bleibt für immer ohne Limits, bei Zahlungen, Dateien und Downloads. Pro ist Komfort für die wiederkehrende monatliche Nutzung, keine freigeschaltete Kernfunktion.',
  },
  's4.r1.title': { sk: 'Uložené profily platiteľov.', en: 'Saved payer profiles.', de: 'Gespeicherte Zahlerprofile.' },
  's4.r1.body': { sk: 'Názov firmy, IBAN, BIC aj banka na jeden klik z výberu, bez prepisovania pri každom hromadnom príkaze.', en: 'Company name, IBAN, BIC and bank in one click from a dropdown, no retyping for every batch.', de: 'Firmenname, IBAN, BIC und Bank mit einem Klick aus der Auswahl, kein erneutes Eintippen bei jeder Sammelüberweisung.' },
  's4.r2.title': { sk: 'Viac súborov naraz.', en: 'Several files at once.', de: 'Mehrere Dateien gleichzeitig.' },
  's4.r2.body': { sk: 'Pridajte viac blokov platieb (napríklad z troch hárkov) a vygenerujte buď samostatný XML pre každý blok, alebo jeden zlúčený súbor.', en: 'Add several payment blocks (e.g. from three spreadsheets) and generate either a separate XML per block, or one merged file.', de: 'Fügen Sie mehrere Zahlungsblöcke hinzu (z. B. aus drei Tabellen) und erstellen Sie entweder eine separate XML je Block oder eine zusammengeführte Datei.' },
  's4.r3.title': { sk: 'Šablóny mapovania stĺpcov.', en: 'Column-mapping templates.', de: 'Vorlagen für Spaltenzuordnung.' },
  's4.r3.body': { sk: 'Predvolené názvy stĺpcov pre exporty z Pohody, Omegy (KROS) alebo Money S3. Mapovanie sa dá aj tak vždy ručne skontrolovať a opraviť.', en: 'Preset column names for exports from Pohoda, Omega (KROS) or Money S3. The mapping can still always be checked and fixed by hand.', de: 'Voreingestellte Spaltennamen für Exporte aus Pohoda, Omega (KROS) oder Money S3. Die Zuordnung lässt sich trotzdem jederzeit manuell prüfen und korrigieren.' },
  's4.cta.p': {
    sk: '<b>Jedna licencia pre štyri nástroje.</b> Pro pre SEPA pain.001 Generátor sa aktivuje rovnakou licenciou ako SEPA pain.001 Doctor, camt.053 do Excelu a Párovač platieb: 9&nbsp;€ mesačne alebo 79&nbsp;€ ročne pre všetky štyri nástroje, DPH v cene, faktúru pošle Stripe.',
    en: '<b>One licence for four tools.</b> Pro for SEPA pain.001 Generator is activated by the same licence as SEPA pain.001 Doctor, camt.053 to Excel and Payment matcher: €9/month or €79/year for all four tools, VAT included, Stripe sends the invoice.',
    de: '<b>Eine Lizenz für vier Tools.</b> Pro für den SEPA-pain.001-Generator wird mit derselben Lizenz aktiviert wie SEPA pain.001 Doctor, camt.053 nach Excel und Zahlungsabgleich: 9&nbsp;€/Monat oder 79&nbsp;€/Jahr für alle vier Tools, inkl. MwSt., die Rechnung stellt Stripe.',
  },
  's4.buy.year.btn': { sk: 'Kúpiť Pro, 79 €/rok', en: 'Buy Pro, €79/year', de: 'Pro kaufen, 79 €/Jahr' },
  's4.buy.month.btn': { sk: 'alebo 9 €/mesiac', en: 'or €9/month', de: 'oder 9 €/Monat' },
  's4.buy.fineprint': {
    sk: 'Platba cez Stripe, DPH v cene, zrušiť môžete kedykoľvek. Licenčný kľúč dostanete hneď po zaplatení na potvrdzovacej stránke.',
    en: 'Payment via Stripe, VAT included, cancel anytime. You get the licence key on the confirmation page right after payment.',
    de: 'Zahlung über Stripe, inkl. MwSt., jederzeit kündbar. Den Lizenzschlüssel erhalten Sie direkt nach der Zahlung auf der Bestätigungsseite.',
  },
  's4.bundle.link': { sk: 'Čo všetko je v balíku', en: 'What is in the bundle', de: 'Was im Paket enthalten ist' },
  's4.sticky.text': { sk: 'Licencia Pro pre všetky štyri nástroje, zrušiť kedykoľvek.', en: 'Pro licence for all four tools, cancel anytime.', de: 'Pro-Lizenz für alle vier Tools, jederzeit kündbar.' },
  's4.r4.title': { sk: 'História príkazov.', en: 'Order history.', de: 'Auftragsverlauf.' },
  's4.r4.body': { sk: 'Posledných 50 vygenerovaných súborov s dátumom, počtom platieb a sumou, uložené len vo vašom prehliadači, vrátane opätovného stiahnutia XML.', en: 'The last 50 generated files with date, payment count and total, stored only in your browser, including re-downloading the XML.', de: 'Die letzten 50 erstellten Dateien mit Datum, Zahlungsanzahl und Summe, nur in Ihrem Browser gespeichert, inklusive erneutem Herunterladen der XML.' },
  's4.r5.title': { sk: 'Prednostná podpora e-mailom.', en: 'Priority email support.', de: 'Bevorzugter E-Mail-Support.' },
  's4.r5.body': { sk: 'Otázka alebo prípad, ktorý si generátor pomýlil? Odpoveď prednostne, priamo od autora nástroja.', en: 'A question, or a case the generator got wrong? A priority reply, directly from the tool’s author.', de: 'Eine Frage oder ein Fall, den der Generator falsch verarbeitet hat? Bevorzugte Antwort, direkt vom Autor des Tools.' },
  's4.licence.manual.label': {
    sk: 'Licenčný kľúč nájdete na potvrdzovacej stránke hneď po zaplatení. Kúpili ste ho na inom počítači alebo v inom nástroji? Vložte ho sem.',
    en: 'The licence key is on the confirmation page right after payment. Bought it on another computer or in another tool? Paste it here.',
    de: 'Den Lizenzschlüssel finden Sie direkt nach der Zahlung auf der Bestätigungsseite. Auf einem anderen Computer oder in einem anderen Tool gekauft? Hier einfügen.',
  },
  's4.licence.input.placeholder': { sk: 'Licenčný kľúč (dlhý reťazec s bodkou uprostred)', en: 'Licence key (a long string with a dot in the middle)', de: 'Lizenzschlüssel (langer Text mit Punkt in der Mitte)' },
  's4.licence.activate.btn': { sk: 'Aktivovať', en: 'Activate', de: 'Aktivieren' },
  's4.licence.remove.btn': { sk: 'Odstrániť licenciu', en: 'Remove licence', de: 'Lizenz entfernen' },

  // ── section 05: pricing / ask ────────────────────────────────────────
  's5.h2': { sk: 'Zadarmo. Bez limitov, natrvalo.', en: 'Free. No limits, for good.', de: 'Kostenlos. Ohne Limits, dauerhaft.' },
  's5.sub': {
    sk: 'Vznikol z vlastnej potreby: previesť zoznam platieb z Excelu na hromadný príkaz bez ručného skladania XML. Bez účtu, bez platby, bez limitu na počet platieb, súborov ani stiahnutí.',
    en: 'Built out of a real need: turn a payment list from Excel into a batch payment file without hand-assembling XML. No account, no payment, no limit on payments, files, or downloads.',
    de: 'Entstanden aus echtem Bedarf: eine Zahlungsliste aus Excel in eine Sammelüberweisung umwandeln, ohne XML von Hand zu bauen. Kein Konto, keine Zahlung, kein Limit bei Zahlungen, Dateien oder Downloads.',
  },
  's5.ask.p': {
    sk: 'Ak vám ušetrí popoludnie, napíšte, čo generátor spracoval zle. <a href="https://github.com/AndryRoby/sepa-pain001-generator/issues" target="_blank" rel="noopener">Otvorte issue na GitHube</a>.',
    en: 'If it saves you an afternoon, let us know what the generator got wrong. <a href="https://github.com/AndryRoby/sepa-pain001-generator/issues" target="_blank" rel="noopener">Open an issue on GitHub</a>.',
    de: 'Wenn es Ihnen einen Nachmittag erspart, sagen Sie uns, was der Generator falsch gemacht hat. <a href="https://github.com/AndryRoby/sepa-pain001-generator/issues" target="_blank" rel="noopener">Issue auf GitHub öffnen</a>.',
  },
  's5.subscribe.p': {
    sk: '<b>Dajte mi vedieť o novom nástroji.</b> Len nové nástroje. Žiadny newsletter, žiadne zdieľanie. Odhlásenie odpoveďou na mail.',
    en: '<b>Let me know about a new tool.</b> New tools only. No newsletter, no sharing. Unsubscribe by replying to the email.',
    de: '<b>Informieren Sie mich über ein neues Tool.</b> Nur neue Tools. Kein Newsletter, keine Weitergabe. Abmeldung per Antwort auf die E-Mail.',
  },
  's5.subscribe.email.placeholder': { sk: 'vas@email.sk', en: 'you@email.com', de: 'ihre@email.de' },
  's5.subscribe.email.aria': { sk: 'E-mailová adresa', en: 'Email address', de: 'E-Mail-Adresse' },
  's5.subscribe.btn': { sk: 'Dať vedieť', en: 'Notify me', de: 'Benachrichtigen' },
  's5.subscribe.thanks': { sk: 'Ďakujeme. Ozveme sa len vtedy, keď bude niečo nové.', en: 'Thanks. We’ll only write when there’s something new.', de: 'Danke. Wir melden uns nur, wenn es etwas Neues gibt.' },
  's5.subscribe.error': {
    sk: 'Nepodarilo sa uložiť. Napíšte na <a href="mailto:andrej@arling.sk">andrej@arling.sk</a>.',
    en: 'Could not save it. Please write to <a href="mailto:andrej@arling.sk">andrej@arling.sk</a>.',
    de: 'Speichern fehlgeschlagen. Bitte schreiben Sie an <a href="mailto:andrej@arling.sk">andrej@arling.sk</a>.',
  },
  's5.subscribe.privacy': { sk: 'Súkromie', en: 'Privacy', de: 'Datenschutz' },
  's5.business.p': {
    sk: '<b>Potrebujete to pre firmu?</b> Hromadné spracovanie, API pre účtovný systém, podpora. Napíšte, čo potrebujete, a odpovieme do 24 hodín.',
    en: '<b>Need this for a business?</b> Bulk processing, an API for your accounting system, support. Tell us what you need and we’ll reply within 24 hours.',
    de: '<b>Brauchen Sie das für Ihr Unternehmen?</b> Massenverarbeitung, eine API für Ihre Buchhaltungssoftware, Support. Schreiben Sie uns Ihren Bedarf, wir antworten innerhalb von 24 Stunden.',
  },
  's5.business.btn': { sk: 'Napísať, čo potrebujem', en: 'Tell us what you need', de: 'Schreiben Sie uns Ihren Bedarf' },
  's5.business.subject': { sk: 'SEPA pain.001 Generátor pre firmu', en: 'SEPA pain.001 Generator for a business', de: 'SEPA pain.001 Generator für ein Unternehmen' },

  // ── FAQ ──────────────────────────────────────────────────────────────
  's6.h2': { sk: 'Otázky, ktoré ľudia naozaj hľadajú.', en: 'Questions people actually search for.', de: 'Fragen, die wirklich gestellt werden.' },
  's6.sub': {
    sk: 'Priame odpovede na otázky o generovaní SEPA pain.001 z Excelu.',
    en: 'Direct answers about generating a SEPA pain.001 file from Excel.',
    de: 'Direkte Antworten zur Erstellung einer SEPA-pain.001-Datei aus Excel.',
  },
  'faq.q1': { sk: 'Ako pripraviť Excel, aby ho generátor prečítal?', en: 'How do I prepare Excel so the generator reads it?', de: 'Wie bereite ich Excel vor, damit der Generator es liest?' },
  'faq.a1': {
    sk: 'Označte stĺpce IBAN, suma a názov príjemcu (ideálne aj s hlavičkou v prvom riadku) a skopírujte bunky priamo do textového poľa (Ctrl+C, Ctrl+V): Excel ich prilepí oddelené tabulátormi a generátor to rozpozná automaticky. Rovnako funguje export do CSV oddeleného bodkočiarkou alebo čiarkou, alebo priame nahratie .csv/.txt/.tsv súboru. Ak automatické rozpoznanie stĺpcov netrafí správne pole, opravte ho ručne vo výberoch nad náhľadom platieb.',
    en: 'Select the IBAN, amount and recipient-name columns (ideally with a header row) and copy the cells straight into the text field (Ctrl+C, Ctrl+V): Excel pastes them tab-separated and the generator detects that automatically, in Slovak, English or German headers. A CSV export delimited with a semicolon or comma works the same way, as does uploading a .csv/.txt/.tsv file directly. If the automatic column detection misses a field, fix it by hand in the dropdowns above the payments preview.',
    de: 'Markieren Sie die Spalten IBAN, Betrag und Empfängername (idealerweise mit Kopfzeile in der ersten Zeile) und kopieren Sie die Zellen direkt in das Textfeld (Strg+C, Strg+V): Excel fügt sie tabulatorgetrennt ein, und der Generator erkennt das automatisch, bei slowakischen, englischen oder deutschen Spaltenüberschriften. Genauso funktioniert ein CSV-Export mit Semikolon oder Komma, oder das direkte Hochladen einer .csv-/.txt-/.tsv-Datei. Erkennt die automatische Spaltenerkennung ein Feld falsch, korrigieren Sie es manuell in den Auswahlfeldern über der Zahlungsvorschau.',
  },
  'faq.q2': { sk: 'Kam sa zapíše variabilný symbol v SEPA XML?', en: 'Where does the payment reference (VS/SS/KS) go in the SEPA XML?', de: 'Wo landet der Verwendungszweck (VS/SS/KS) in der SEPA-XML?' },
  'faq.a2': {
    sk: '<code>pain.001.001.03</code> nemá samostatné pole pre variabilný, špecifický ani konštantný symbol. V profile „Slovensko“ ich generátor zapíše do <code>PmtId/EndToEndId</code> v poradí <code>/VS.../SS.../KS...</code>, presne podľa konvencie Národnej banky Slovenska: rovnakej, akú kontroluje aj sesterský nástroj SEPA pain.001 Doctor. V profile „Nemecko (DK)“ tieto tri polia neexistujú vôbec: text ide do <code>RmtInf/Ustrd</code> (Verwendungszweck) a <code>EndToEndId</code> sa berie zo samostatného mapovaného stĺpca, alebo je „NOTPROVIDED“, ak nie je vyplnený.',
    en: '<code>pain.001.001.03</code> has no dedicated field for the Slovak variabilný/špecifický/konštantný symbol. In the “Slovakia” profile, the generator writes them into <code>PmtId/EndToEndId</code> as <code>/VS.../SS.../KS...</code>, exactly the National Bank of Slovakia convention checked by the sibling tool, SEPA pain.001 Doctor. In the “Germany (DK)” profile, these three fields don’t exist at all: the text goes into <code>RmtInf/Ustrd</code> (Verwendungszweck), and <code>EndToEndId</code> is taken from its own mapped column, or defaults to “NOTPROVIDED” if left empty.',
    de: '<code>pain.001.001.03</code> hat kein eigenes Feld für den slowakischen variabilný/špecifický/konštantný symbol. Im Profil „Slowakei“ schreibt der Generator diese als <code>/VS.../SS.../KS...</code> in <code>PmtId/EndToEndId</code>, genau nach der Konvention der Národná banka Slovenska, die auch das Schwester-Tool SEPA pain.001 Doctor prüft. Im Profil „Deutschland (DK)“ gibt es diese drei Felder gar nicht: Der Text steht in <code>RmtInf/Ustrd</code> (Verwendungszweck), und <code>EndToEndId</code> wird aus einer eigenen zugeordneten Spalte übernommen oder ist „NOTPROVIDED“, wenn sie leer bleibt.',
  },
  'faq.q3': { sk: 'Ako naimportujem XML do internet bankingu?', en: 'How do I import the XML into my bank’s online banking?', de: 'Wie importiere ich die XML in mein Online-Banking?' },
  'faq.a3': {
    sk: 'Stiahnutý .xml súbor nahrajte v internet bankingu do formulára pre hromadný alebo dávkový príkaz (zvyčajne v sekcii Platby → Hromadné platby → Import súboru). Platí to pre Tatra banku, SLSP, VÚB aj ČSOB rovnako ako pre nemecké, rakúske a švajčiarske banky (napríklad Sparkasse, Volksbank, Deutsche Bank, Commerzbank, Raiffeisen, Erste, UBS alebo PostFinance), presné umiestnenie sa medzi bankami líši. Ak import zlyhá, skontrolujte najprv hlásenie od SEPA pain.001 Doctora, ktoré sa zobrazí hneď po vygenerovaní: ukáže presný element, ktorý banka odmietne.',
    en: 'Upload the downloaded .xml file in your bank’s online banking form for a batch/bulk payment (usually under Payments → Bulk payments → Import file). This works the same way at Tatra banka, SLSP, VÚB and ČSOB as at German, Austrian and Swiss banks (for example Sparkasse, Volksbank, Deutsche Bank, Commerzbank, Raiffeisen, Erste, UBS or PostFinance); the exact location differs between banks. If the import fails, check the SEPA pain.001 Doctor report shown right after generation first: it points to the exact element a bank will reject.',
    de: 'Laden Sie die heruntergeladene .xml-Datei im Online-Banking im Formular für Sammel-/Stapelüberweisungen hoch (meist unter Zahlungen → Sammelüberweisungen → Datei importieren). Das funktioniert bei Tatra banka, SLSP, VÚB und ČSOB genauso wie bei deutschen, österreichischen und Schweizer Banken (zum Beispiel Sparkasse, Volksbank, Deutsche Bank, Commerzbank, Raiffeisen, Erste, UBS oder PostFinance); der genaue Ort unterscheidet sich je Bank. Schlägt der Import fehl, prüfen Sie zuerst den SEPA-pain.001-Doctor-Bericht, der direkt nach der Erstellung angezeigt wird: Er zeigt genau das Element, das eine Bank ablehnen wird.',
  },
  'faq.q4': { sk: 'Odosielajú sa moje platby niekam?', en: 'Is my payment data sent anywhere?', de: 'Werden meine Zahlungsdaten irgendwohin gesendet?' },
  'faq.a4': {
    sk: 'Nie. Parsovanie Excelu aj generovanie XML beží celé vo vašom prehliadači. IBAN, sumy ani mená sa nikam neposielajú, nástroj nemá backend. Jedinou sieťovou aktivitou je načítanie statických súborov stránky a anonymné počítadlo použitia (Umami), ktoré zaznamená len to, že prebehlo generovanie a aký bol výsledok kontroly, nikdy obsah platieb.',
    en: 'No. Parsing Excel and generating the XML both run entirely in your browser. IBANs, amounts and names are never sent anywhere; the tool has no backend. The only network activity is loading the page’s static files and an anonymous usage counter (Umami), which records only that generation happened and what the check result was, never the content of the payments.',
    de: 'Nein. Das Parsen von Excel und die XML-Erstellung laufen vollständig im Browser. IBANs, Beträge und Namen werden nie gesendet; das Tool hat kein Backend. Die einzige Netzwerkaktivität ist das Laden der statischen Seitendateien und ein anonymer Nutzungszähler (Umami), der nur erfasst, dass eine Erstellung stattfand und wie das Prüfergebnis ausfiel, nie den Inhalt der Zahlungen.',
  },
  'faq.q5': { sk: 'Koľko platieb môže byť v jednom súbore?', en: 'How many payments can be in one file?', de: 'Wie viele Zahlungen dürfen in einer Datei sein?' },
  'faq.a5': {
    sk: 'Generátor spracuje najviac 5000 platieb naraz. Ak majú platby rôzny dátum splatnosti, generátor ich automaticky rozdelí do samostatných blokov PmtInf podľa dátumu; Tatra banka aj tak obmedzuje jeden takýto blok na 500 transakcií, na čo SEPA pain.001 Doctor po vygenerovaní upozorní.',
    en: 'The generator processes at most 5000 payments at once. If payments have different execution dates, the generator automatically splits them into separate PmtInf blocks by date; Tatra banka still caps one such block at 500 transactions, which SEPA pain.001 Doctor flags after generation.',
    de: 'Der Generator verarbeitet maximal 5000 Zahlungen auf einmal. Haben Zahlungen unterschiedliche Ausführungsdaten, teilt der Generator sie automatisch nach Datum in separate PmtInf-Blöcke auf; Tatra banka begrenzt einen solchen Block trotzdem auf 500 Transaktionen, worauf SEPA pain.001 Doctor nach der Erstellung hinweist.',
  },
  'faq.q6': { sk: 'Prečo banka odmietla súbor aj po kontrole?', en: 'Why did the bank reject the file even after the check?', de: 'Warum hat die Bank die Datei trotz Prüfung abgelehnt?' },
  'faq.a6': {
    sk: 'SEPA pain.001 Doctor kontroluje formátové a bankové pravidlá, ktoré sú verejne zdokumentované, nie stav vášho účtu, existenciu účtu príjemcu ani interné limity banky (napríklad denný limit prevodov). Čistý výsledok kontroly preto nie je zárukou prijatia. Ak banka súbor aj tak odmietne, overte v prvom rade presné znenie chyby v internet bankingu.',
    en: 'SEPA pain.001 Doctor checks publicly documented format and bank-specific rules, not your account’s status, whether the recipient’s account exists, or a bank’s internal limits (e.g. a daily transfer cap). A clean check result is therefore not a guarantee of acceptance. If a bank rejects the file anyway, check the exact error text in internet banking first.',
    de: 'SEPA pain.001 Doctor prüft öffentlich dokumentierte Format- und bankspezifische Regeln, nicht den Status Ihres Kontos, ob das Empfängerkonto existiert, oder interne Limits der Bank (z. B. ein Tageslimit für Überweisungen). Ein sauberes Prüfergebnis ist daher keine Garantie für die Annahme. Lehnt eine Bank die Datei trotzdem ab, prüfen Sie zuerst den genauen Fehlertext im Online-Banking.',
  },
  'faq.q7': { sk: 'Čo dostanem v Pro?', en: 'What do I get with Pro?', de: 'Was bekomme ich mit Pro?' },
  'faq.a7': {
    sk: 'Uložené profily platiteľov (IBAN, BIC, banka na jeden klik), generovanie viacerých súborov platieb naraz, predvolené šablóny mapovania stĺpcov pre Pohodu, Omegu (KROS) a Money S3, históriu posledných 50 vygenerovaných príkazov so spätným stiahnutím a prednostnú e-mailovú podporu. Samotné generovanie a kontrola XML sú aj naďalej úplne zadarmo, bez zmeny. Pozrite si <a href="#pro">sekciu Pro</a>.',
    en: 'Saved payer profiles (IBAN, BIC, bank in one click), generating several payment files at once, preset column-mapping templates for Pohoda, Omega (KROS) and Money S3, a history of the last 50 generated commands with re-download, and priority email support. Generating and checking the XML itself stays completely free, unchanged. See the <a href="#pro">Pro section</a>.',
    de: 'Gespeicherte Zahlerprofile (IBAN, BIC, Bank mit einem Klick), Erstellung mehrerer Zahlungsdateien gleichzeitig, voreingestellte Vorlagen für Spaltenzuordnung für Pohoda, Omega (KROS) und Money S3, einen Verlauf der letzten 50 erstellten Aufträge mit erneutem Download und bevorzugten E-Mail-Support. Die Erstellung und Prüfung der XML selbst bleibt unverändert vollständig kostenlos. Siehe den <a href="#pro">Pro-Abschnitt</a>.',
  },
  'faq.q8': { sk: 'Musím platiť, aby som vygeneroval XML?', en: 'Do I have to pay to generate an XML?', de: 'Muss ich bezahlen, um eine XML zu erstellen?' },
  'faq.a8': {
    sk: 'Nie. Generovanie aj kontrola súboru sú a zostávajú zadarmo, bez limitu na počet platieb, súborov ani stiahnutí. Pro je len pohodlie navyše pre toho, kto hromadné príkazy pripravuje opakovane.',
    en: 'No. Generating and checking a file are, and stay, free, with no limit on payments, files, or downloads. Pro is just extra convenience for someone preparing batch payments repeatedly.',
    de: 'Nein. Erstellung und Prüfung einer Datei sind und bleiben kostenlos, ohne Limit bei Zahlungen, Dateien oder Downloads. Pro ist nur zusätzlicher Komfort für jemanden, der wiederholt Sammelüberweisungen erstellt.',
  },
  'faq.q9': { sk: 'Ako dostanem faktúru?', en: 'How do I get an invoice?', de: 'Wie erhalte ich eine Rechnung?' },
  'faq.a9': {
    sk: 'Faktúru vystaví a pošle na váš e-mail Stripe hneď po zaplatení. Pri tomto predaji je ARLing s. r. o. predajcom cez Stripe Managed Payments: DPH aj vystavenie dokladu rieši priamo Stripe.',
    en: 'The invoice is issued and emailed to you by Stripe right after payment. For this sale, ARLing s. r. o. sells through Stripe Managed Payments: Stripe itself handles VAT and issuing the document.',
    de: 'Die Rechnung wird von Stripe direkt nach der Zahlung erstellt und Ihnen per E-Mail zugesandt. Bei diesem Verkauf handelt ARLing s. r. o. über Stripe Managed Payments: Stripe selbst kümmert sich um Umsatzsteuer und Belegausstellung.',
  },
  'faq.q10': { sk: 'Čo ak zmením počítač?', en: 'What if I change computers?', de: 'Was, wenn ich den Computer wechsle?' },
  'faq.a10': {
    sk: 'Licenčný kľúč nie je viazaný na jedno zariadenie. Nájdete ho v e-maile od Stripe po zaplatení; na novom počítači ho stačí vložiť ručne do poľa pre licenčný kľúč v <a href="#pro">sekcii Pro</a> a Pro sa aktivuje aj tam.',
    en: 'The licence key isn’t tied to one device. You’ll find it in the email from Stripe after payment; on a new computer, just paste it manually into the licence-key field in the <a href="#pro">Pro section</a>, and Pro activates there too.',
    de: 'Der Lizenzschlüssel ist nicht an ein Gerät gebunden. Sie finden ihn in der E-Mail von Stripe nach der Zahlung; auf einem neuen Computer fügen Sie ihn einfach manuell in das Lizenzschlüsselfeld im <a href="#pro">Pro-Abschnitt</a> ein, und Pro wird auch dort aktiviert.',
  },
  'faq.q11': { sk: 'Čo ak Pro nechcem, môžem dostať peniaze naspäť?', en: 'What if I don’t want Pro, can I get a refund?', de: 'Was, wenn ich Pro nicht möchte, bekomme ich mein Geld zurück?' },
  'faq.a11': {
    sk: 'Áno. Ak vám Pro nesadne, napíšte do 14 dní od kúpy na <a href="mailto:andrej@arling.sk?subject=Vr%C3%A1tenie%20Pro%20licencie">andrej@arling.sk</a> a peniaze vrátime bez zbytočných otázok.',
    en: 'Yes. If Pro doesn’t work out for you, write within 14 days of purchase to <a href="mailto:andrej@arling.sk?subject=Vr%C3%A1tenie%20Pro%20licencie">andrej@arling.sk</a> and we’ll refund it, no questions asked.',
    de: 'Ja. Wenn Pro nichts für Sie ist, schreiben Sie innerhalb von 14 Tagen nach dem Kauf an <a href="mailto:andrej@arling.sk?subject=Vr%C3%A1tenie%20Pro%20licencie">andrej@arling.sk</a>, und wir erstatten das Geld ohne unnötige Fragen.',
  },
  'faq.q12': { sk: 'Čím sa líši profil „Nemecko (DK)“ od „Slovensko“?', en: 'How does the “Germany (DK)” profile differ from “Slovakia”?', de: 'Wie unterscheidet sich das Profil „Deutschland (DK)“ von „Slowakei“?' },
  'faq.a12': {
    sk: 'Profil „Nemecko (DK)“ (Deutsche Kreditwirtschaft, pravidlá pre pain.001.001.03 platné v nemeckom bankovníctve) skryje stĺpce VS/ŠS/KS a namiesto nich ponúkne jeden voľný text Verwendungszweck (max. 140 znakov, znaková sada SEPA) a voliteľný stĺpec EndToEndId. Zoznam bánk sa zjednoduší na jednu všeobecnú predlohu „Bank nach DK-Regelwerk (pain.001.001.03)“ namiesto štyroch slovenských bánk, keďže per-bankové pravidlá Tatra banky, SLSP, VÚB a ČSOB sa naň nevzťahujú. BIC zostáva nepovinný, ako pri každom IBAN z krajiny EHP/SEPA.',
    en: 'The “Germany (DK)” profile (Deutsche Kreditwirtschaft, the pain.001.001.03 rules used in German banking) hides the VS/SS/KS columns and offers one free-text Verwendungszweck instead (max. 140 characters, SEPA character set) plus an optional EndToEndId column. The bank list collapses to one generic “Bank nach DK-Regelwerk (pain.001.001.03)” preset instead of the four Slovak banks, since Tatra banka/SLSP/VÚB/ČSOB’s own per-bank rules don’t apply to it. BIC stays optional, as for any IBAN from an EEA/SEPA country.',
    de: 'Das Profil „Deutschland (DK)“ (Deutsche Kreditwirtschaft, die im deutschen Bankwesen geltenden pain.001.001.03-Regeln) blendet die Spalten VS/SS/KS aus und bietet stattdessen einen freien Verwendungszweck (max. 140 Zeichen, SEPA-Zeichensatz) sowie eine optionale EndToEndId-Spalte. Die Bankliste reduziert sich auf eine generische Vorlage „Bank nach DK-Regelwerk (pain.001.001.03)“ statt der vier slowakischen Banken, da die bankspezifischen Regeln von Tatra banka/SLSP/VÚB/ČSOB dafür nicht gelten. Der BIC bleibt optional, wie bei jeder IBAN aus einem EWR-/SEPA-Land.',
  },

  // ── footer ───────────────────────────────────────────────────────────
  'footer.sisters.label': { sk: 'Ďalšie nástroje:', en: 'More tools:', de: 'Weitere Tools:' },
  'footer.all.tools': { sk: 'Všetky nástroje ARLing', en: 'All ARLing tools', de: 'Alle ARLing-Tools' },
  'footer.privacy': { sk: 'Súkromie', en: 'Privacy', de: 'Datenschutz' },
  'footer.tool.doctor': { sk: 'SEPA pain.001 Doctor', en: 'SEPA pain.001 Doctor', de: 'SEPA pain.001 Doctor' },
  'footer.tool.camt': { sk: 'camt.053 do Excelu', en: 'camt.053 to Excel', de: 'camt.053 nach Excel' },
  'footer.tool.matcher': { sk: 'Párovač platieb', en: 'Payment matcher', de: 'Zahlungsabgleich' },
  'footer.bundle.label': { sk: 'Pro pre všetky štyri:', en: 'Pro for all four:', de: 'Pro für alle vier:' },
  'footer.bundle.name': { sk: 'Bankové nástroje pre účtovníkov', en: 'Banking tools for accountants', de: 'Banktools für Buchhalter' },
  'footer.country': { sk: 'Slovensko', en: 'Slovakia', de: 'Slowakei' },
  's2.template.excel': { sk: 'Excel (univerzálny)', en: 'Excel (generic)', de: 'Excel (allgemein)' },
  's3.code.comment.profile': { sk: "'de': Verwendungszweck namiesto VS/SS/KS", en: "'de': Verwendungszweck instead of VS/SS/KS", de: "'de': Verwendungszweck statt VS/SS/KS" },
  's3.code.comment.execdate': { sk: 'predvolené: zajtra', en: 'default: tomorrow', de: 'Standard: morgen' },
  'footer.note': {
    sk: 'Nič neopúšťa váš prehliadač okrem anonymných počtov použitia cez self-hosted Umami (a e-mailu, ak sa prihlásite na odber nižšie).',
    en: 'Nothing leaves your browser except anonymous usage counts via self-hosted Umami (and an email address, if you sign up for updates below).',
    de: 'Nichts verlässt Ihren Browser außer anonymen Nutzungszahlen über das selbst gehostete Umami (und einer E-Mail-Adresse, falls Sie sich unten anmelden).',
  },
  // Samostatné kľúče pre spodnú pätičku stránky (odkazy na právne stránky a
  // veta o zárukách/Umami). Nepoužívať existujúci 'footer.privacy' vyššie -
  // ten patrí inému bloku (odkaz na iné podstránky) a má iný text ("Súkromie"),
  // preplietlo by sa to. GDPR/Impressum/llms.txt necháme bez prekladu, sú
  // jazykovo neutrálne (skratka, nemecký právny pojem, meno súboru).
  'footer.legal.privacy': { sk: 'ochrana údajov', en: 'privacy', de: 'Datenschutz' },
  'footer.legal.terms': { sk: 'podmienky', en: 'terms', de: 'AGB' },
  'footer.legal.sitemap': { sk: 'mapa stránky', en: 'sitemap', de: 'Sitemap' },
  'footer.legal.disclaimer': {
    sk: 'Nástroje sú poskytované tak, ako sú, bez záruky. Anonymné počty návštev cez vlastné Umami.',
    en: 'Tools are provided as-is, without warranty. Anonymous visit counts via our own Umami.',
    de: 'Die Tools werden ohne Gewähr bereitgestellt. Anonyme Besuchszahlen über unser eigenes Umami.',
  },

  // ── meta / SEO ───────────────────────────────────────────────────────
  'meta.title': {
    sk: 'SEPA pain.001 Generátor (slovenské banky)',
    en: 'SEPA pain.001 Generator (SK banks + a German DE profile)',
    de: 'SEPA-pain.001-Generator (slowakische Banken + DE-Profil)',
  },
  'meta.description': {
    sk: 'Vložte platby skopírované z Excelu alebo CSV a vygenerujte SEPA pain.001 XML hromadný príkaz pre Tatra banku, SLSP, VÚB alebo ČSOB. Súbor sa hneď skontroluje. Zadarmo, priamo v prehliadači, nič sa neodosiela.',
    en: 'Paste payments copied from Excel or CSV and generate a SEPA pain.001 XML batch payment file for a Slovak bank, or a generic German (DK) profile with Verwendungszweck instead of VS/SS/KS. The file is checked right away. Free, runs in your browser, nothing is uploaded.',
    de: 'Fügen Sie aus Excel oder CSV kopierte Zahlungen ein und erstellen Sie eine SEPA-pain.001-XML-Sammelüberweisung für eine slowakische Bank, oder ein generisches deutsches (DK-)Profil mit Verwendungszweck statt VS/SS/KS. Die Datei wird sofort geprüft. Kostenlos, läuft im Browser, nichts wird hochgeladen.',
  },
  // Dlhší popis len pre JSON-LD (SoftwareApplication.description), samostatný
  // od meta.description vyššie. Statický <script type="application/ld+json">
  // v index.html a build-i18n.mjs nesmieme meniť (mimo povoleného rozsahu
  // tejto opravy), preto ho tu len prepisujeme za behu v applyI18n() nižšie -
  // rovnako, ako sa už za behu prepisuje meta description a og:description.
  'jsonld.description': {
    sk: 'Bezplatný nástroj, ktorý priamo v prehliadači vytvorí zo skopírovaných alebo nahraných platieb z Excelu či CSV SEPA pain.001.001.03 XML hromadný príkaz na úhradu, pripravený na import do internetbankingu Tatra banky, Slovenskej sporiteľne (SLSP), VÚB alebo ČSOB, prípadne všeobecný nemecký (Deutsche Kreditwirtschaft, profil „de“) pain.001 súbor s poľom Verwendungszweck namiesto VS/ŠS/KS. Na každý vygenerovaný súbor automaticky beží aj engine SEPA pain.001 Doctor. Dostupné po slovensky, anglicky a nemecky.',
    en: 'Free, client-side tool that builds a SEPA pain.001.001.03 XML batch payment file (hromadný príkaz na úhradu) from payments pasted or uploaded from Excel or CSV, ready for import into Tatra banka, Slovenská sporiteľňa (SLSP), VÚB, or ČSOB internet banking, or a generic German (Deutsche Kreditwirtschaft, "de" country profile) pain.001 file with Verwendungszweck instead of VS/SS/KS. Runs the sibling SEPA pain.001 Doctor engine on every generated file automatically. Available in Slovak, English and German.',
    de: 'Kostenloses Tool im Browser, das aus eingefügten oder aus Excel/CSV hochgeladenen Zahlungen eine SEPA-pain.001.001.03-XML-Sammelüberweisung (hromadný príkaz na úhradu) erstellt, bereit zum Import ins Online-Banking von Tatra banka, Slovenská sporiteľňa (SLSP), VÚB oder ČSOB, oder wahlweise eine generische deutsche (Deutsche Kreditwirtschaft, Länderprofil „de“) pain.001-Datei mit Verwendungszweck statt VS/SS/KS. Für jede erzeugte Datei läuft automatisch dieselbe Engine wie bei SEPA pain.001 Doctor. Verfügbar auf Slowakisch, Englisch und Deutsch.',
  },

  // ── dynamic JS strings (status pills, errors, dynamic labels) ──────────
  'js.status.idle': { sk: 'pripravené', en: 'idle', de: 'bereit' },
  'js.status.pass': { sk: 'v poriadku', en: 'pass', de: 'in Ordnung' },
  'js.status.warn': { sk: 'upozornenia', en: 'warnings', de: 'Hinweise' },
  'js.status.fail': { sk: 'chyby', en: 'fail', de: 'Fehler' },
  'js.status.error': { sk: 'chyba', en: 'error', de: 'Fehler' },
  'js.status.activating': { sk: 'aktivujem…', en: 'activating…', de: 'aktiviere…' },
  'js.status.proActive': { sk: 'Pro aktívne', en: 'Pro active', de: 'Pro aktiv' },
  'js.status.noLicence': { sk: 'bez licencie', en: 'no licence', de: 'keine Lizenz' },
  'js.timing.waiting': { sk: 'čaká', en: 'waiting', de: 'wartet' },
  'js.timing.clientSide': { sk: 'klientská strana, 0 requestov', en: 'client-side, 0 requests', de: 'clientseitig, 0 Anfragen' },
  'js.timing.files': { sk: '{n} súborov', en: '{n} files', de: '{n} Dateien' },

  'js.error.invalidJson': { sk: 'Neplatný JSON: opravte syntax a skúste znova.', en: 'Invalid JSON: fix the syntax and try again.', de: 'Ungültiges JSON: Syntax korrigieren und erneut versuchen.' },
  'js.error.noPayments': { sk: 'Vložte aspoň jeden riadok s platbou (skopírovaný z Excelu, alebo nahrajte súbor).', en: 'Paste at least one payment row (copied from Excel, or upload a file).', de: 'Fügen Sie mindestens eine Zahlungszeile ein (aus Excel kopiert, oder laden Sie eine Datei hoch).' },
  'js.error.jsonSwitchFail': { sk: 'Nedá sa prepnúť na Formulár: JSON nie je platný: {msg}', en: 'Can’t switch to Form: JSON is invalid: {msg}', de: 'Wechsel zu Formular nicht möglich: JSON ist ungültig: {msg}' },

  'js.table.row': { sk: '#', en: '#', de: '#' },
  'js.table.iban': { sk: 'IBAN', en: 'IBAN', de: 'IBAN' },
  'js.table.amount': { sk: 'Suma', en: 'Amount', de: 'Betrag' },
  'js.table.name': { sk: 'Názov', en: 'Name', de: 'Name' },
  'js.table.symbols': { sk: 'Symboly', en: 'References', de: 'Referenzsymbole' },
  'js.table.message': { sk: 'Správa', en: 'Message', de: 'Nachricht' },
  'js.table.address': { sk: 'Adresa', en: 'Address', de: 'Adresse' },
  'js.table.errors': { sk: 'Chyby', en: 'Errors', de: 'Fehler' },

  'js.doctor.title': { sk: 'Kontrola (SEPA pain.001 Doctor engine)', en: 'Check (SEPA pain.001 Doctor engine)', de: 'Prüfung (SEPA pain.001 Doctor Engine)' },
  'js.doctor.bank': { sk: 'Banka', en: 'Bank', de: 'Bank' },
  'js.doctor.expectedBic': { sk: 'Očakávaný BIC platiteľa', en: 'Expected payer BIC', de: 'Erwarteter BIC des Zahlers' },
  'js.doctor.namespace': { sk: 'Menný priestor schémy (xmlns)', en: 'Schema namespace (xmlns)', de: 'Schema-Namespace (xmlns)' },
  'js.doctor.execwindow': { sk: 'Max. dní dopredu pre ReqdExctnDt', en: 'Max. days ahead for ReqdExctnDt', de: 'Max. Tage im Voraus für ReqdExctnDt' },
  'js.doctor.execwindow.days': { sk: '{n} dní', en: '{n} days', de: '{n} Tage' },
  'js.doctor.execwindow.undocumented': { sk: 'nezdokumentované pre túto banku', en: 'not documented for this bank', de: 'für diese Bank nicht dokumentiert' },
  'js.doctor.txcount': { sk: 'Počet transakcií (NbOfTxs)', en: 'Transaction count (NbOfTxs)', de: 'Anzahl Transaktionen (NbOfTxs)' },
  'js.doctor.ctrlsum': { sk: 'Súčet súm (CtrlSum)', en: 'Sum of amounts (CtrlSum)', de: 'Summe der Beträge (CtrlSum)' },
  'js.doctor.pmtinfcount': { sk: 'Bloky PmtInf', en: 'PmtInf blocks', de: 'PmtInf-Blöcke' },
  'js.doctor.banksdetected': { sk: 'Banky rozpoznané z IBAN', en: 'Banks detected from IBAN', de: 'Aus IBAN erkannte Banken' },
  'js.doctor.expectedvalues.title': { sk: 'Očakávané hodnoty a štatistika', en: 'Expected values and statistics', de: 'Erwartete Werte und Statistik' },
  'js.doctor.problems.title': { sk: 'Problémy ({n})', en: 'Problems ({n})', de: 'Probleme ({n})' },
  'js.doctor.fixes.title': { sk: 'Opravy', en: 'Fixes', de: 'Korrekturen' },
  'js.doctor.checklist.title': { sk: 'Checklist', en: 'Checklist', de: 'Checkliste' },

  'js.copy.fix': { sk: 'kopírovať', en: 'copy', de: 'kopieren' },
  'js.copy.done': { sk: 'skopírované ✓', en: 'copied ✓', de: 'kopiert ✓' },
  'js.copy.failed': { sk: 'zlyhalo', en: 'failed', de: 'fehlgeschlagen' },
  'js.copy.xml': { sk: 'kopírovať XML', en: 'copy XML', de: 'XML kopieren' },
  'js.download.xml': { sk: 'Stiahnuť XML', en: 'Download XML', de: 'XML herunterladen' },
  'js.download.all': { sk: 'Stiahnuť všetky ({n})', en: 'Download all ({n})', de: 'Alle herunterladen ({n})' },
  'js.preview.title': { sk: 'Náhľad platieb ({n})', en: 'Payments preview ({n})', de: 'Zahlungsvorschau ({n})' },

  'js.banner.rowError': { sk: '{n} {word} chybu v náhľade nižšie (napr. neplatný IBAN alebo neplatná suma). Súbor sa napriek tomu vygeneroval so zadanými hodnotami tak, ako sú: stiahnutie je aktívne, ale opravte dáta pred nahratím do banky.', en: '{n} {word} an error in the preview below (e.g. an invalid IBAN or amount). The file was still generated with the values as given: the download stays active, but fix the data before uploading it to the bank.', de: '{n} {word} in der Vorschau unten einen Fehler (z. B. ungültige IBAN oder ungültiger Betrag). Die Datei wurde trotzdem mit den angegebenen Werten erstellt: der Download bleibt aktiv, korrigieren Sie aber die Daten, bevor Sie sie bei der Bank hochladen.' },
  'js.banner.rowError.word.one': { sk: 'riadok má', en: 'row has', de: 'Zeile hat' },
  'js.banner.rowError.word.other': { sk: 'riadkov má', en: 'rows have', de: 'Zeilen haben' },
  'js.banner.doctorBlocking': { sk: 'Kontrola nižšie našla {n} {word}, ktoré banka pri importe pravdepodobne odmietne. Stiahnutie ostáva aktívne, odporúčame ale najprv opraviť problémy nižšie.', en: 'The check below found {n} {word} a bank will likely reject on import. The download stays active, but fixing the problems below first is recommended.', de: 'Die Prüfung unten fand {n} {word}, die eine Bank beim Import wahrscheinlich ablehnt. Der Download bleibt aktiv, es wird jedoch empfohlen, die Probleme unten zuerst zu beheben.' },
  'js.banner.doctorBlocking.word.one': { sk: 'blokujúcu chybu', en: 'blocking error', de: 'blockierenden Fehler' },
  'js.banner.doctorBlocking.word.few': { sk: 'blokujúce chyby', en: 'blocking errors', de: 'blockierende Fehler' },
  'js.banner.doctorBlocking.word.many': { sk: 'blokujúcich chýb', en: 'blocking errors', de: 'blockierende Fehler' },

  'js.licence.validUntil': { sk: 'Licencia platná do {date}.', en: 'Licence valid until {date}.', de: 'Lizenz gültig bis {date}.' },
  'js.licence.removeConfirm': { sk: 'Odstrániť licenciu z tohto prehliadača?', en: 'Remove the licence from this browser?', de: 'Lizenz aus diesem Browser entfernen?' },
  'js.licence.keyMissing': { sk: 'Vložte licenčný kľúč.', en: 'Paste a licence key.', de: 'Lizenzschlüssel einfügen.' },
  'js.licence.activationFailed': { sk: 'Aktivácia zlyhala. Skúste vložiť kľúč ručne nižšie, alebo napíšte na andrej@arling.sk.', en: 'Activation failed. Try pasting the key manually below, or write to andrej@arling.sk.', de: 'Aktivierung fehlgeschlagen. Versuchen Sie, den Schlüssel unten manuell einzufügen, oder schreiben Sie an andrej@arling.sk.' },
  'js.licence.reason.expired': { sk: 'licencia vypršala', en: 'licence expired', de: 'Lizenz abgelaufen' },
  'js.licence.reason.signature': { sk: 'neplatný kľúč', en: 'invalid key', de: 'ungültiger Schlüssel' },
  'js.licence.reason.plan': { sk: 'kľúč pre iný produkt', en: 'key for a different product', de: 'Schlüssel für ein anderes Produkt' },
  'js.licence.reason.malformed': { sk: 'neplatný kľúč', en: 'invalid key', de: 'ungültiger Schlüssel' },
  'js.licence.reason.unsupported': { sk: 'prehliadač nepodporovaný', en: 'browser not supported', de: 'Browser nicht unterstützt' },
  'js.licence.reason.default': { sk: 'neplatná licencia', en: 'invalid licence', de: 'ungültige Lizenz' },
  'js.licence.detail.unsupported': { sk: 'Pro vyžaduje aktuálny prehliadač s podporou WebCrypto Ed25519 (Chrome, Firefox alebo Safari 17+). Aktualizujte prehliadač a skúste znova.', en: 'Pro needs a current browser with WebCrypto Ed25519 support (Chrome, Firefox or Safari 17+). Update your browser and try again.', de: 'Pro benötigt einen aktuellen Browser mit WebCrypto-Ed25519-Unterstützung (Chrome, Firefox oder Safari 17+). Aktualisieren Sie Ihren Browser und versuchen Sie es erneut.' },
  'js.licence.detail.expired': { sk: 'Táto licencia už vypršala. Kúpou novej licencie ju obnovíte.', en: 'This licence has already expired. Buying a new licence renews it.', de: 'Diese Lizenz ist bereits abgelaufen. Mit dem Kauf einer neuen Lizenz wird sie erneuert.' },
  'js.licence.detail.plan': { sk: 'Tento kľúč platí pre iný produkt ARLing, nie pre SEPA pain.001 Generátor ani balík Bankové nástroje.', en: 'This key is valid for a different ARLing product, not SEPA pain.001 Generator or the Banking tools bundle.', de: 'Dieser Schlüssel gilt für ein anderes ARLing-Produkt, nicht für den SEPA-pain.001-Generator oder das Banktools-Paket.' },
  'js.licence.detail.malformed': { sk: 'Kľúč sa nepodarilo prečítať, skontrolujte, či ste ho skopírovali celý.', en: 'The key could not be read. Check that you copied it in full.', de: 'Der Schlüssel konnte nicht gelesen werden. Prüfen Sie, ob Sie ihn vollständig kopiert haben.' },
  'js.licence.detail.default': { sk: 'Kľúč sa nepodarilo overiť.', en: 'The key could not be verified.', de: 'Der Schlüssel konnte nicht überprüft werden.' },

  'js.profile.save.missing': { sk: 'Vyplňte názov firmy a IBAN platiteľa pred uložením profilu.', en: 'Fill in the company name and payer IBAN before saving a profile.', de: 'Füllen Sie Firmennamen und Zahler-IBAN aus, bevor Sie ein Profil speichern.' },
  'js.profile.save.prompt': { sk: 'Názov profilu (napr. názov firmy):', en: 'Profile name (e.g. the company name):', de: 'Profilname (z. B. Firmenname):' },
  'js.profile.delete.confirm': { sk: 'Zmazať vybraný profil?', en: 'Delete the selected profile?', de: 'Ausgewähltes Profil löschen?' },

  'js.template.note.matched': { sk: '{note} Rozpoznané stĺpce podľa hlavičky: {fields}.', en: '{note} Columns recognized by header: {fields}.', de: '{note} Anhand der Kopfzeile erkannte Spalten: {fields}.' },
  'js.template.note.none': { sk: '{note} Žiadny stĺpec sa nepodarilo rozpoznať podľa presného názvu hlavičky, použilo sa bežné automatické rozpoznanie.', en: '{note} No column could be recognized by exact header text, ordinary automatic detection was used instead.', de: '{note} Es konnte keine Spalte anhand des exakten Spaltennamens erkannt werden, die übliche automatische Erkennung wurde verwendet.' },

  'js.block.label': { sk: 'blok {n}', en: 'block {n}', de: 'Block {n}' },
  'js.block.remove.btn': { sk: 'odstrániť', en: 'remove', de: 'entfernen' },
  'js.block.placeholder': { sk: 'Ďalší blok platieb (rovnaké mapovanie stĺpcov ako vyššie).', en: 'Another payment block (same column mapping as above).', de: 'Ein weiterer Zahlungsblock (gleiche Spaltenzuordnung wie oben).' },
  'js.mergedfile.label': { sk: 'Zlúčený súbor ({n} bloky)', en: 'Merged file ({n} blocks)', de: 'Zusammengeführte Datei ({n} Blöcke)' },
  'js.blockfile.label': { sk: 'Blok {i} z {n}', en: 'Block {i} of {n}', de: 'Block {i} von {n}' },
  // Predpona názvu stiahnutého XML súboru; bez prípony a dátumu, tie si
  // pridáva downloadFilename() v index.html.
  'js.filename.prefix': { sk: 'hromadny-prikaz', en: 'sepa-payments', de: 'sepa-sammelauftrag' },

  'js.history.empty': { sk: 'Zatiaľ žiadna história. Vygenerujte prvý súbor.', en: 'No history yet. Generate your first file.', de: 'Noch kein Verlauf. Erstellen Sie Ihre erste Datei.' },
  'js.history.redownload': { sk: 'stiahnuť znova', en: 'download again', de: 'erneut herunterladen' },
  'js.history.noxml': { sk: 'XML neuložené', en: 'XML not stored', de: 'XML nicht gespeichert' },
  'js.history.noname': { sk: '(bez názvu)', en: '(no name)', de: '(kein Name)' },
  'js.history.payments': { sk: 'platieb', en: 'payments', de: 'Zahlungen' },

  'js.bank.select.iban.recognized': { sk: 'odvodí sa z IBAN', en: 'derived from the IBAN', de: 'wird aus der IBAN abgeleitet' },

  // ── bank select (BANK_OPTIONS in index.html's script), reused by JS for
  // the "Banka" row in the Doctor result table and the history panel ────
  'bank.tatrabanka': { sk: 'Tatra banka', en: 'Tatra banka', de: 'Tatra banka' },
  'bank.slsp': { sk: 'Slovenská sporiteľňa (SLSP)', en: 'Slovenská sporiteľňa (SLSP)', de: 'Slovenská sporiteľňa (SLSP)' },
  'bank.vub': { sk: 'VÚB', en: 'VÚB', de: 'VÚB' },
  'bank.csob': { sk: 'ČSOB', en: 'ČSOB', de: 'ČSOB' },
  'bank.generic': { sk: 'iná / neuvedená banka', en: 'other / unspecified bank', de: 'andere / nicht angegebene Bank' },
  // Shown instead of bank.generic above when the "de" country profile is
  // active: the four Slovak-bank presets don't apply there (see FAQ
  // faq.q3), so the bank select collapses to this one generic DK
  // (Deutsche Kreditwirtschaft) pain.001.001.03 preset.
  'bank.genericDe': {
    sk: 'Banka podľa pravidiel DK (pain.001.001.03)',
    en: 'Bank per DK rules (pain.001.001.03)',
    de: 'Bank nach DK-Regelwerk (pain.001.001.03)',
  },

  // ── country-profile selector: 'sk' (current VS/ŠS/KS behaviour) or
  // 'de' (Verwendungszweck, no VS/ŠS/KS) ─────────────────────────────────
  'profile.sk.label': { sk: 'Slovensko (VS/ŠS/KS)', en: 'Slovakia (VS/SS/KS)', de: 'Slowakei (VS/SS/KS)' },
  'profile.de.label': { sk: 'Nemecko (DK, Verwendungszweck)', en: 'Germany (DK, Verwendungszweck)', de: 'Deutschland (DK, Verwendungszweck)' },
};

// ─────────────────────────────── pure helpers ───────────────────────────────

// The page's "active" language. Every helper below that takes an optional
// `lang` argument falls back to this, NOT to DEFAULT_LANG, when `lang` is
// omitted or unrecognized — see camt053-to-excel's i18n.js for the full
// rationale (identical here). Stays 'en' (DEFAULT_LANG) for the whole
// process under Node (tests.mjs never calls setLang()).
let currentLang = DEFAULT_LANG;

/** Current active language (see currentLang above). */
export function getLang() {
  return currentLang;
}

function resolveLang(lang) {
  return LANGS.includes(lang) ? lang : currentLang;
}

/** True/false without throwing on a non-string. */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Resolves a locale tag (e.g. "de-DE", "cs-CZ", "fr-FR") to one of LANGS. */
export function langFromLocale(tag) {
  const s = String(tag || '').toLowerCase();
  if (s.startsWith('de')) return 'de';
  if (s.startsWith('sk') || s.startsWith('cs')) return 'sk';
  return DEFAULT_LANG;
}

/** Translates one dictionary key. Unknown key returns the key itself so a
 * missing translation is visible instead of silently blank. Omitting
 * `lang` uses the page's current active language (see resolveLang above). */
export function t(key, lang) {
  const l = resolveLang(lang);
  const entry = DICT[key];
  if (!entry) return key;
  return entry[l] || entry.en || entry.sk || key;
}

/** Same lookup, but with {placeholders} filled in from `vars`. */
export function tf(key, vars, lang) {
  let s = t(key, lang);
  if (vars) {
    Object.keys(vars).forEach((k) => {
      s = s.split('{' + k + '}').join(String(vars[k]));
    });
  }
  return s;
}

/** "450.00" -> "450,00" for sk/de, unchanged for en. */
export function formatAmountForLang(amount, lang) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '';
  const fixed = amount.toFixed(2);
  const l = resolveLang(lang);
  return l === 'en' ? fixed : fixed.replace('.', ',');
}

/** "2026-09-02" -> "02.09.2026" for sk/de, unchanged (already ISO) for en. */
export function formatDateForLang(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return iso || '';
  const l = resolveLang(lang);
  return l === 'en' ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}.${m[2]}.${m[1]}`;
}

/** BCP-47 locale tag to pass to toLocaleString() for history timestamps. */
export function localeTagForLang(lang) {
  const l = resolveLang(lang);
  return l === 'sk' ? 'sk-SK' : l === 'de' ? 'de-DE' : 'en-GB';
}

export function ogLocaleForLang(lang) {
  const l = resolveLang(lang);
  return l === 'sk' ? 'sk_SK' : l === 'de' ? 'de_DE' : 'en_US';
}

/** Every DICT entry has a non-empty string for every LANGS member. Used
 * both by tests.mjs and by the verify-i18n check script. */
export function findIncompleteEntries() {
  const bad = [];
  Object.keys(DICT).forEach((key) => {
    const entry = DICT[key];
    LANGS.forEach((l) => {
      if (!isNonEmptyString(entry[l])) bad.push(`${key}.${l}`);
    });
  });
  return bad;
}

/** Reads ?lang= from a query string (no DOM/location dependency), for
 * both the browser bootstrap below and tests.mjs. */
export function langFromQueryString(search) {
  try {
    const params = new URLSearchParams(search || '');
    const q = (params.get('lang') || '').toLowerCase();
    return LANGS.includes(q) ? q : null;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────── DOM engine ────────────────────────────────
// Everything below touches document/window/localStorage/navigator and only
// ever runs in a browser; every access is guarded so importing this module
// under Node (tests.mjs) is side-effect-free beyond the pure helpers above.

function readStoredLang() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    const v = localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(v) ? v : null;
  } catch (e) {
    return null;
  }
}

/** Query param wins, then localStorage, then navigator.language, then
 * DEFAULT_LANG ("en", per the brief: de -> DE, sk/cs -> SK, else EN). */
export function detectLang() {
  try {
    if (typeof location !== 'undefined') {
      const fromQuery = langFromQueryString(location.search);
      if (fromQuery) return fromQuery;
    }
  } catch (e) {}
  const stored = readStoredLang();
  if (stored) return stored;
  try {
    if (typeof navigator !== 'undefined' && navigator.language) return langFromLocale(navigator.language);
  } catch (e) {}
  return DEFAULT_LANG;
}

function setMetaByName(name, value) {
  const el = document.querySelector(`meta[name="${name}"]`);
  if (el) el.setAttribute('content', value);
}
function setMetaByProperty(prop, value) {
  const el = document.querySelector(`meta[property="${prop}"]`);
  if (el) el.setAttribute('content', value);
}

function updateUrlLang(lang) {
  try {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    // The prerendered en/ and de/ folders (build-i18n.mjs) carry the language
    // in their path already; keep those URLs clean.
    if (document.documentElement.hasAttribute('data-lang-static')) return;
    const url = new URL(location.href);
    url.searchParams.set('lang', lang);
    history.replaceState(null, '', url.pathname + '?' + url.searchParams.toString() + url.hash);
  } catch (e) {}
}

/** Fills in every data-i18n* element and the document-level bits (title,
 * meta description/OG, <html lang>, language-switch button state) for the
 * given (already-resolved) language. Pure DOM sync, no persistence. */
export function applyI18n(lang) {
  if (typeof document === 'undefined') return;
  const l = LANGS.includes(lang) ? lang : currentLang;
  currentLang = l;

  document.documentElement.setAttribute('lang', l);

  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n'), l); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.getAttribute('data-i18n-html'), l); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'), l)); });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label'), l)); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'), l)); });

  document.title = t('meta.title', l);
  setMetaByName('description', t('meta.description', l));
  setMetaByProperty('og:title', t('meta.title', l));
  setMetaByProperty('og:description', t('meta.description', l));
  setMetaByProperty('og:locale', ogLocaleForLang(l));

  // JSON-LD description je statická v HTML (build-i18n.mjs ju pre "en" zámerne
  // necháva netknutú, aby zostala zhodná so slovenským zdrojom pri stavaní) -
  // na koreňovej sk stránke preto bez tohto prepisu ostáva po anglicky.
  // Rovnako ako meta description vyššie, prepíšeme ju tu za behu pre všetky
  // tri jazyky, nech čítačka structured data vidí jazyk, v akom sa stránka
  // skutočne zobrazuje.
  document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      const data = JSON.parse(el.textContent);
      if (data['@type'] === 'SoftwareApplication') {
        data.description = t('jsonld.description', l);
        el.textContent = JSON.stringify(data, null, 2);
      }
    } catch (e) {}
  });

  document.querySelectorAll('[data-set-lang]').forEach((btn) => {
    const active = btn.getAttribute('data-set-lang') === l;
    if (btn.tagName === 'A') {
      // Links to the static language folders (./, en/, de/): aria-current
      // marks the one the visitor is reading.
      if (active) btn.setAttribute('aria-current', 'true'); else btn.removeAttribute('aria-current');
    } else {
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    btn.classList.toggle('lang-active', active);
  });

  document.querySelectorAll('form[data-subscribe]').forEach((f) => f.setAttribute('data-lang', l));

  const businessLink = document.getElementById('business-link');
  if (businessLink) {
    businessLink.href = 'mailto:andrej@arling.sk?subject=' + encodeURIComponent(t('s5.business.subject', l));
  }

  // The Pro-section "what is in the bundle" link sends visitors to the
  // bankove-nastroje bundle page in the language they are already reading.
  const bundleLink = document.getElementById('pro-bundle-link');
  if (bundleLink) bundleLink.href = 'https://arling.sk/bankove-nastroje/?lang=' + l;

  try { document.dispatchEvent(new CustomEvent('arling:langchange', { detail: { lang: l } })); } catch (e) {}
}

/** Sets the active language, persists it, syncs the URL and re-renders. */
export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  currentLang = lang;
  try { if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  applyI18n(lang);
  updateUrlLang(lang);
}

function wireLangSwitch() {
  document.querySelectorAll('[data-set-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-set-lang');
      if (btn.tagName === 'A' && btn.getAttribute('href')) {
        // The switcher is a link to the language's own URL (./ for Slovak,
        // en/ and de/ for the prerendered folders): remember the choice so
        // the page the browser is about to load agrees, then let it navigate.
        if (!LANGS.includes(lang)) return;
        try { if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
        return;
      }
      setLang(lang);
    });
  });
}

if (typeof document !== 'undefined') {
  const boot = () => {
    wireLangSwitch();
    setLang(detectLang());
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
