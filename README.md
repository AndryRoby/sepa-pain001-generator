# SEPA pain.001 Generátor: hromadné príkazy pre slovenské banky

Live: https://arling.sk/sepa-pain001-generator/

A free, static, client-side tool that builds a **SEPA pain.001.001.03
XML** batch payment file (hromadný príkaz na úhradu) straight out of
payments you already have in Excel or a CSV export, so you don't have
to hand-assemble XML for import into **Tatra banka, Slovenská
sporiteľňa (SLSP), VÚB, or ČSOB** internet banking.

## What it's for

Companies whose accounting software doesn't produce a SEPA export at
all, or whose payment list actually lives in a spreadsheet (freelance
bookkeepers doing payroll or supplier runs by hand, a small e-shop
paying out a batch of refunds, a director approving a list of
invoices), have no direct route from "rows in Excel" to a file a
bank's internet banking will import. This tool is that route: paste
the rows, fill in the payer's details once, and download a ready
`pain.001` file.

## Input format

1. **Payments.** Paste cells copied straight out of Excel (tab-separated)
   or a CSV file (`;` or `,` delimited) into the textarea, or upload a
   `.csv`, `.txt`, or `.tsv` file with the file picker. An uploaded
   file is read with the browser's own `FileReader` API and never
   leaves the page.

   Column headers are detected automatically by name, in Slovak or
   English:

   | Field | Recognized header names |
   |---|---|
   | IBAN | `iban` |
   | Amount | `suma`, `amount`, `čiastka` |
   | Recipient name | `názov`, `meno`, `príjemca`, `name` |
   | Variabilný symbol | `vs`, `variabilný` |
   | Špecifický symbol | `ss`, `špecifický` |
   | Konštantný symbol | `ks`, `konštantný` |
   | Message / remittance text | `správa`, `poznámka`, `message`, `info` |
   | Date | `dátum`, `date` |
   | BIC | `bic` |

   If the automatic detection gets a column wrong (or your headers
   don't match any of the above), every column has a manual dropdown
   to remap it before generating the file.

2. **Payer (platiteľ).** Company name, debtor IBAN (checked with the
   standard MOD-97 IBAN checksum), and a BIC. The BIC is derived
   automatically from the bank code embedded in the IBAN:

   | Bank code | BIC |
   |---|---|
   | 1100 | TATRSKBX (Tatra banka) |
   | 0900 | GIBASKBX (Slovenská sporiteľňa) |
   | 0200 | SUBASKBX (VÚB) |
   | 7500 | CEKOSKBX (ČSOB) |
   | 8330 | FIOZSKBA (Fio banka) |
   | 0720 | NBSBSKBX (Národná banka Slovenska) |
   | 5600 | KOMASK2X |
   | 6500 | POBNSKBA |
   | 8130 | CITISKBA |
   | 1111 | UNCRSKBX |
   | 3100 | LUBASKBX |
   | 8180 | SPSRSKBA |
   | 8120 | BSLOSK22 |

   For a bank code that isn't in this table, there's a manual BIC
   field instead.

3. **Settings.** Target bank (Tatra banka, SLSP, VÚB, ČSOB, or a
   generic SEPA profile), requested execution date (`ReqdExctnDt`,
   defaults to tomorrow), and the message id (`MsgId`, auto-generated
   as `ARL-YYYYMMDD-HHMMSS`). Charge bearer is fixed to `SLEV` and the
   currency to `EUR`, matching what every SEPA credit-transfer batch
   in Slovakia requires.

Variabilný, špecifický, and konštantný symbol have no dedicated field
in the `pain.001.001.03` schema. Following the National Bank of
Slovakia convention (the same one documented in ČSOB's own SEPA
guide), the generator packs whichever of the three you supplied into
the end-to-end reference as `/VS.../SS.../KS...`, in that exact order.

## How it works (client-side only)

Everything runs in your browser. There is no backend, no account, and
no payment wall. You paste or upload your payments, fill in the payer
fields, and the page builds the `pain.001.001.03` XML entirely with
JavaScript and offers it as a download.

Nothing about your payments is sent anywhere: no IBANs, no amounts, no
names. The only network activity this site generates is:

- loading its own static assets (HTML/CSS/JS) from GitHub Pages,
- anonymous product-analytics events (page view, "generate" clicked,
  etc.) sent to a self-hosted Umami instance: event names and counts
  only, never the content of what you pasted,
- and, only if you type an email into the optional mailing-list form,
  a request to the subscribe endpoint carrying that email address and
  nothing else.

You can verify this yourself: open your browser's network tab while
using the tool, or just read `index.html` and its engine script; it's
static files with no build step.

## Before you upload the file

This tool builds a structurally correct `pain.001` file against the
fixed values every Slovak bank requires (`PmtMtd = TRF`,
`SvcLvl/Cd = SEPA`, `ChrgBr = SLEV`), but each bank still layers its
own extra rules on top: an execution-date window (Tatra banka up to
31 days ahead, VÚB up to 30), a transaction cap (Tatra banka: 500 per
file), and stricter handling of diacritics and length limits at ČSOB.
The sibling tool, **SEPA pain.001 Doctor**
(https://arling.sk/sepa-pain001-doctor/), checks a finished file
against exactly those bank-specific rules before you import it: worth
a quick run, especially the first time you generate a file for a new
bank.

## Privacy

- No account, no login, no cookies for the tool itself.
- No server-side processing of your payment data; the "backend" is
  your own browser's JavaScript engine.
- Analytics (Umami) records that a file was generated, not what was
  in it.
- If you're paranoid (understandable, given the subject matter),
  download the repo and open `index.html` locally with your network
  disconnected; it still works.

## Running it locally

There's no build step. It's static files.

```bash
git clone https://github.com/AndryRoby/sepa-pain001-generator.git
cd sepa-pain001-generator
# any static file server works, e.g.:
npx serve .
# or just open index.html directly in a browser
```

## Reporting a missing case / wrong output

Found a column layout it doesn't detect, a bank code it doesn't
recognize, or an XML field it gets wrong? Please open an issue on the
GitHub repo with:

1. The column headers you used (or a redacted sample row).
2. Which bank you targeted.
3. What the generated XML has, and what it should have instead.

Redact anything sensitive (real IBANs, names, amounts) before posting;
issues are public.

## Disclaimer

This tool is provided **as is**, with no warranty of any kind. It
builds a `pain.001.001.03` file from the data you provide and applies
the fixed values documented above; it does not verify that IBANs
belong to real accounts, that amounts are correct, or that a
particular bank will accept the resulting file. Tatra banka,
Slovenská sporiteľňa, VÚB, and ČSOB are not affiliated with this tool,
and their import requirements may change at any time. Always check a
generated file (this tool's sibling, SEPA pain.001 Doctor, is built
for exactly that) before relying on it for a large or time-sensitive
payment run.

## About

Built by ARLing s. r. o. (Bratislava, Slovakia).
Contact: andrej@arling.sk

Sibling tools in the same "Doctor" family:
- SEPA pain.001 Doctor (checks a finished file against bank-specific rules): https://arling.sk/sepa-pain001-doctor/
- Supabase Auth redirects (Next.js/Vite/SvelteKit): https://arling.sk/supabase-redirect-doctor/
- Supabase Auth redirects (Flutter): https://arling.sk/flutter-supabase-doctor/
- More ARLing tools: https://arling.sk/
