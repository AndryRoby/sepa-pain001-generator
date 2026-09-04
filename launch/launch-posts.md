# Launch: SEPA pain.001 Generátor (slovenské banky)

Tool: https://arling.sk/sepa-pain001-generator/
Repo: https://github.com/AndryRoby/sepa-pain001-generator
Researched: 2026-09-05 (WebSearch + WebFetch + GitHub REST search API).

## 1) Live-thread research: what was actually found

Rule applied throughout: **closed + last human activity older than 12 months (before
2025-09-05) -> skip.** Beyond that literal rule, a thread only gets marked **post** if replying
with this specific tool would give the poster real, on-topic help (their bank is Tatra banka,
SLSP, VÚB, or ČSOB, and their problem is actually "get my Excel payments into a pain.001 file",
not a generic non-Slovak SEPA/library question), not just keyword overlap.

**Bottom line up front: nothing found qualifies for "post" today.** Every real candidate is
either closed and stale, unreachable, or targets a bank/audience this tool doesn't serve. That
is a genuine finding, not a placeholder: see the fallback plan after the table.

| Query / source | What came back | URL | Status | Date | Verdict |
|---|---|---|---|---|---|
| GitHub issue search: `repo:php-sepa-xml/php-sepa-xml csv` | Issue #103, "Question about this project": the author literally asks: *"Is there already something like an open source (command line) tool `csv2sepa` that converts CSV files to SEPA XML credit transfers? That would be very helpful."* This is the single closest on-topic hit in the entire search. | https://github.com/php-sepa-xml/php-sepa-xml/issues/103 | Closed | Opened 2020-07-06, closed 2020-07-15 (one maintainer reply: "I don't know about a tool like this") | **skip**: 6+ years stale, already closed with a reply, no live audience left to help |
| GitHub issue search: `repo:raphaelm/python-sepaxml csv` + full open-issues list (14 checked) | No issue about generating from CSV/Excel or about a Slovak bank. Closest topics: `camt.053` bank-statement support (#58, a different message type), a namespace-prefix bug rejected by a **German** bank (#78), `Comdirect`/`CBI` (German/Italian) compatibility (#73, #34), a structured-reference-field question (#52, generic ISO 20022, no country named). | https://github.com/raphaelm/python-sepaxml/issues | Open (various) | 2021-12 to 2026-08 | **skip (all)**: none is a CSV-import question, none names a Slovak bank |
| `site:porada.sk hromadný príkaz XML excel` | Only unrelated archived threads (`t-6563` cestovný príkaz, `t-75592` Excel súčet, `t-25925` Excel minikurz). No thread about generating pain.001/hromadný príkaz XML from Excel. Direct fetch of `porada.sk` returns HTTP 403 to automated requests, so any thread that exists outside search-indexed snippets couldn't be verified either. | https://www.porada.sk/ | n/a | n/a | **skip**: nothing on-topic found, and the site itself blocks direct fetch |
| `Pohoda Money S3 KROS Omega hromadný príkaz import xml excel fórum stormware` | Only Stormware's/KROS's own KB and product pages (`stormware.cz/podpora/faq`, `stormware.sk/prirucka-pohoda-online`, `stormware.cz/videonavody`). No open community forum thread turned up; this matches the same finding already recorded for the sibling SEPA pain.001 Doctor launch research (`kros.sk/forum/*` redirects to a static FAQ; no `fórum.stormware.cz` thread is indexed). | https://www.stormware.cz/podpora/ | n/a | n/a | **skip**: vendor docs only, no thread to reply to |
| `reddit excel to SEPA xml payment generator`, `"pain.001" "excel" stackoverflow generate` | No Reddit or Stack Overflow thread at all. Results are entirely vendor/product pages for existing generic SEPA-from-Excel tools (see "market context" below) plus two older Windows/Office community threads. | n/a | n/a | n/a | **skip**: no discussion thread found |
| Excel VBA/Office community threads: "Create xml payment file (sepa) from excel." | Found via search on `excelforum.com` and mirrored on `social.technet.microsoft.com`. Both returned **HTTP 403** on direct fetch, so freshness and resolution status could not be confirmed. Even if reachable: the poster's country/bank is unspecified generic-EU SEPA, not one of the four Slovak banks this tool derives BIC/profile logic for, so replying here would be keyword-matching, not genuine help. | https://www.excelforum.com/excel-programming-vba-macros/1220176-create-xml-payment-file-sepa-from-excel.html | Unknown (403, unverifiable) | Unknown | **skip**: inaccessible, and audience mismatch even if it were live |

### Market context (not a thread, but relevant to positioning)

Search turned up an active, crowded space of **generic** Excel/CSV-to-SEPA-XML converters:
jam-software's Pain-Converter, treasuryhost.eu, filetailored.com, validatefin.com (also
browser-local/no-upload), generatesepa.com, exceltopain001.com, iso20022generator.com,
xaviesteve.com, and open-source repos `pierrecariou/SEPA-generator`, `unichor/csv2pain`, and
`sebastienrousseau/pain001` (PyPI package + CLI). None of these derive a BIC from a **Slovak**
bank code, pack **VS/ŠS/KS** into the reference per the National Bank of Slovakia convention, or
offer fixed-value profiles for **Tatra banka / SLSP / VÚB / ČSOB** specifically: they solve the
generic ISO 20022 schema problem, not the Slovak business-rule layer on top of it. That gap is
this tool's actual differentiation, and it's a fact worth using in the owner's own post (see
FACTS section below), not something to lead a forum reply with.

## Why nothing scored "post", and what to do instead

Same shape of finding as the sibling SEPA pain.001 Doctor launch research: this is a narrow,
Slovak-specific niche, and the people who hit "I have payments in Excel, I need a hromadný
príkaz XML" mostly solve it by asking their accountant, their bank's business-banking hotline,
or a closed Facebook/WhatsApp group, none of which are search-indexed. The generic
Excel-to-SEPA question does get asked in English-language dev/Office forums, but not by anyone
whose bank this tool actually knows about.

**Standing watch (2 minutes to set up, zero cost):** save these searches and check them weekly
for the first month:
- Google/Bing Alerts: `hromadný príkaz XML excel banka`, `pain.001 excel generátor Slovensko`,
  `"pain.001" Tatra banka OR SLSP OR VÚB OR ČSOB export`
- GitHub: watch `php-sepa-xml/php-sepa-xml` and `raphaelm/python-sepaxml` issues for anything
  naming Slovakia/Tatra/VÚB/SLSP/ČSOB or asking "how do I generate from a spreadsheet"
- The moment a genuinely matching thread appears, use the reply pattern below.

## 2) Reply template for the first genuinely matching thread

No thread qualified today, so this is a template to fill in once one does, not a post to send
now.

**English (GitHub issue / dev forum, generic SEPA-from-Excel question where a Slovak bank is
named):**

> [1-2 sentences of concrete, on-topic help for their exact column/field problem, citing the
> relevant part of the pain.001.001.03 schema if that's what's tripping them up.]
>
> By the way, I built a small free tool that does exactly this for Slovak banks specifically
> (Tatra banka/SLSP/VÚB/ČSOB profiles, BIC derived from the IBAN's bank code, VS/ŠS/KS packed
> into the reference): https://arling.sk/sepa-pain001-generator/ (static, runs in the browser,
> nothing you paste is uploaded).

**Slovak (porada.sk / KROS-Omega / Pohoda-Money S3 fóra, ak sa objaví reálna vlákno):**

> [1-2 vety konkrétnej pomoci k ich presnému stĺpcu/poľu, s odkazom na časť pain.001.001.03
> schémy, ak je to jadro problému.]
>
> Mimochodom, spravil som si na presne toto malý bezplatný nástroj pre slovenské banky (profily
> pre Tatra banku/SLSP/VÚB/ČSOB, BIC odvodený z kódu banky v IBAN, VS/ŠS/KS v poradí podľa
> NBS): https://arling.sk/sepa-pain001-generator/ (statická stránka, beží v prehliadači, nič sa
> neodosiela).

## 3) FACTS for the owner (not ready-made text): for your own Show HN / Reddit / FB post

1. It turns payments pasted from Excel (tab-separated) or uploaded as a `.csv`/`.txt`/`.tsv`
   file into a `pain.001.001.03` XML file, entirely in the browser. There is no backend; the
   file never leaves the visitor's machine except as the download it produces.
2. It auto-detects IBAN, amount, recipient name, variabilný/špecifický/konštantný symbol,
   message, date, and BIC columns by common Slovak and English header names, and every column
   also has a manual dropdown so a mismatch can be fixed by hand.
3. It derives the payer's BIC automatically from the 4-digit bank code inside their IBAN, for
   13 bank codes (Tatra banka, Slovenská sporiteľňa, VÚB, ČSOB, Fio banka, NBS, and others). An
   unrecognized code falls back to a manual BIC field instead of blocking the file.
4. It packs variabilný/špecifický/konštantný symbol into the end-to-end reference as
   `/VS.../SS.../KS...`, the National Bank of Slovakia convention, because `pain.001.001.03`
   itself has no dedicated fields for these three Slovak-specific payment symbols.
5. It writes the fixed values every SEPA batch credit transfer in Slovakia needs
   (`PmtMtd = TRF`, `SvcLvl/Cd = SEPA`, `ChrgBr = SLEV`, currency `EUR`), and lets you pick a
   target-bank profile: Tatra banka, SLSP, VÚB, ČSOB, or a generic SEPA profile.
6. It does **not** check the finished file against each bank's own extra rules on top of the
   shared schema (execution-date window, transaction cap, diacritics handling). That's a
   separate, already-live sibling tool, SEPA pain.001 Doctor
   (https://arling.sk/sepa-pain001-doctor/), built to be run on the output afterward.
7. It does **not** connect to any bank, verify that an IBAN belongs to a real account, or check
   that amounts are correct. It is a one-way, offline XML builder: nothing round-trips to a
   bank, and it cannot tell you whether a payment will actually succeed.
8. It is not the first free tool that turns Excel/CSV into SEPA XML: several generic converters
   already exist (see "market context" above). None of them is Slovak-bank specific: none
   derives a BIC from a Slovak bank code, packs VS/ŠS/KS per the NBS convention, or offers
   per-bank profiles for Tatra banka/SLSP/VÚB/ČSOB.

## 4) Article outline

**Title (SK):** *Generický SEPA generátor vám hromadný príkaz spraví. Slovenskú banku už nie.*
**Title (EN alt, dev.to):** *SEPA pain.001 has a dozen free Excel converters. None of them know
what a slovenský bankový kód is.*

1. **The setup.** You have a list of payments in Excel and need a `pain.001` file for Tatra
   banka/SLSP/VÚB/ČSOB internet banking. A search turns up plenty of free "Excel to SEPA XML"
   converters (link a couple from the market-context list). They all work, for the schema.
2. **What "the schema" doesn't cover.** `pain.001.001.03` is a shared ISO 20022 format, but it
   has no field at all for variabilný/špecifický/konštantný symbol, and no concept of "which
   Slovak bank's own extra rules apply." A generic converter can produce valid XML that's still
   wrong for the bank you're about to import it into.
3. **The two Slovak-specific gaps, concretely.** BIC has to match the actual bank behind the
   IBAN's 4-digit code (worked example: `1100` -> `TATRSKBX`); VS/ŠS/KS have to be packed into
   the end-to-end reference in exactly `/VS/SS/KS` order per the NBS convention, or the transfer
   goes through but nobody can reconcile it against an invoice (reuse the citation already
   sourced for SEPA pain.001 Doctor's `README.md`/`llms-full.txt`).
4. **What I built, and why it's paired with a checker, not a validator.** SEPA pain.001
   Generátor builds the file with those two gaps closed; SEPA pain.001 Doctor
   (https://arling.sk/sepa-pain001-doctor/) checks a finished file against each bank's own
   published rules (execution-date window, transaction cap, diacritics). Two small static
   tools instead of one tool trying to both build and fully validate.
5. **How it works.** Paste/upload, auto-detected columns with manual override, one XML
   download, no account, no server round-trip (link the README's privacy section).
6. **Open call.** If a bank code isn't recognized, or a column layout the tool should detect
   isn't, here's how to report it (link the README's "reporting a missing case" section).

## 5) Fakty pre majiteľa: Pro (39 €/12 mesiacov)

1. Pro je voliteľná platená vrstva len pre toho, kto hromadné príkazy generuje
   opakovane (typicky mesačne): uložené profily platiteľa, viac súborov naraz,
   šablóny mapovania stĺpcov pre Pohodu/Omegu (KROS)/Money S3, história
   posledných 50 príkazov so spätným stiahnutím, prednostná e-mailová podpora.
   Samotné generovanie a kontrola XML ostávajú bez zmeny úplne zadarmo, bez
   limitu na počet platieb, súborov ani stiahnutí.
2. Cena je 39 € jednorazovo na 12 mesiacov, DPH v cene. Predaj beží cez
   Stripe Checkout / Managed Payments (Stripe je merchant of record, rieši
   DPH aj faktúru na e-mail; ARLing s. r. o. je predávajúci): platobný odkaz
   https://buy.stripe.com/3cIaER9M63hNeFcg8B4ko00. Vrátenie peňazí do 14 dní
   bez otázok.
3. Licencia je podpísaný Ed25519 kľúč (payload s plánom a dátumom expirácie),
   overovaný priamo v prehliadači cez WebCrypto; po aktivácii nie je potrebné
   žiadne ďalšie serverové volanie a kľúč sa dá ručne preniesť na iný
   počítač. Vydáva ho homelab endpoint `/licence/api/claim` po overení
   zaplatenej Stripe Checkout Session.

### Kde osloviť SK účtovníka bez Facebooku a bez cold e-mailu

**Vyhľadávanie (SEO, do title/h1/FAQ oboch nástrojov).** Toto je najlacnejší a
najškálovateľnejší kanál: účtovník, ktorý má konkrétny problém, si ho vygoogli
po slovensky. Kľúčové frázy, ktoré sa oplatí mať doslovne v title, h1 alebo vo
FAQ otázke (nie len rozhádzané v texte):
- „hromadný príkaz XML“
- „pain.001 generátor“
- „import platieb do internet bankingu z Excelu“
- „SEPA XML z Excelu“

Toto je pasívny kanál (žiadny cold e-mail, žiadny cold DM), funguje ale len po
týždňoch, keď stránku Google zaindexuje a vyhodnotí ako relevantnú, nie hneď.

**porada.sk.** Overené priamym vyhľadávaním: existuje konkrétne, tematicky
presné vlákno *„Pohoda a import príkazov na úhradu VÚB“*
(https://www.porada.sk/t238735-pohoda-a-import-prikazov-na-uhradu-vub.html),
teda porada.sk je reálny, aktívny priestor, kde sa táto presná téma (import
platobného príkazu z účtovného softvéru do internet bankingu VÚB) rieši.
Priamy fetch stránky (aj tohto konkrétneho vlákna) ale vracia HTTP 403
automatizovaným požiadavkám, rovnako ako pri predchádzajúcom výskume pre
tento launch: dátum vlákna, stav (otvorené/zatvorené) a to, či by odpoveď
dnes ešte dávala zmysel, sa nedá overiť bez ručného otvorenia v prehliadači.
Odporúčanie: Andrej si vlákno otvorí ručne (prihlásený účet, nie Claude) a
posúdi, či je aktuálne dosť živé na odpoveď; ak áno, je to presne cieľová
skupina pre tento nástroj aj pre Pro.

**„ekonomickeforum“.** Doména `ekonomickeforum.sk` sa pri overení ukázala byť
Oravské ekonomické fórum, teda konferencia/podujatie, nie diskusné fórum pre
účtovníkov. Najbližšia reálne overená náhrada je **BizFórum**
(https://www.bizforum.sk/diskusia/uctovnictvo/): skutočná diskusná sekcia pre
slovenské účtovníctvo (vlákna o jednoduchom/podvojnom účtovníctve, odpisoch,
čistej mzde), ale najnovšie viditeľné vlákna sú z rokov 2018 – 2020, takže
aktivita pôsobí utlmene. Zaradiť ako sekundárny, nie primárny kanál: skúsiť,
ale nečakať rovnaký zásah ako od SEO alebo porada.sk.

**GitHub issues účtovných knižníc.** Pokrýva už časť 1 vyššie (Standing
watch): `php-sepa-xml/php-sepa-xml` a `raphaelm/python-sepaxml` sú jediné
relevantné, aktívne udržiavané open-source SEPA/pain.001 knižnice, ktoré
výskum našiel; žiadna slovenská účtovná knižnica na GitHube (Pohoda/Omega/
Money S3 sú uzavretý komerčný softvér bez verejného issue trackera). Nechať
bežať uložené vyhľadávania z časti 1, odpovedať len na prvé skutočne
zodpovedajúce vlákno (nie na keyword match).

**YouTube: nie.** Vynechať ako kanál. Účtovník s problémom „mám platby v
Exceli, potrebujem XML pre banku“ hľadá text a rýchlu odpoveď (Google,
fórum), nie video; výskum ani v tomto, ani v predchádzajúcom kole nenašiel
žiadny YouTube kanál ani komentár, ktorý by bol na tento problém naviazaný.

## Files referenced

- README's "reporting a missing case / wrong output" section: `../README.md`
- Bank-rule and NBS VS/ŠS/KS citations reused above are the ones already sourced for the
  sibling SEPA pain.001 Doctor project (`../../sepa-pain001-doctor/README.md` and
  `../../sepa-pain001-doctor/llms-full.txt`), not re-verified here since they were already
  sourced from each bank's own documentation.
