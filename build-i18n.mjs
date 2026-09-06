// build-i18n.mjs - prerenders en/index.html and de/index.html from index.html
// and the DICT in i18n.js, so Google indexes one URL per language:
//   https://arling.sk/<tool>/      Slovak (the root page, unchanged runtime)
//   https://arling.sk/<tool>/en/   English
//   https://arling.sk/<tool>/de/   German
//
// Run after every change to index.html or i18n.js:  node build-i18n.mjs
// tests.mjs fails when the committed en/ and de/ files are stale.
//
// What the prerender does, with plain string transforms (no dependencies):
//   - fills every data-i18n / data-i18n-html / data-i18n-placeholder /
//     data-i18n-aria-label / data-i18n-title element exactly like
//     applyI18n() in i18n.js does at runtime (textContent, innerHTML,
//     attribute), so the static HTML already reads in the folder's language;
//   - sets <html lang>, <title>, meta description, og:title / og:description /
//     og:url / og:locale, the canonical URL, the hreflang set (sk = root,
//     en, de, x-default = root) and the JSON-LD strings (SoftwareApplication
//     name/url/description/offer names, FAQPage from faq.qN / faq.aN);
//   - rewrites relative asset URLs (favicon, manifest, subscribe.js, the
//     module imports, llms.txt) one folder up, so the tool's own scripts and
//     icons load unchanged from the repo root. No <base href> on purpose: a
//     base URL would also re-resolve in-page "#anchor" links and the
//     history.replaceState('#c=...') permalink against the root folder and
//     send a /de/ visitor back to the Slovak URL;
//   - adds a one-line bootstrap that stores the folder's language in
//     localStorage (arling_lang) before i18n.js boots, so the runtime
//     switcher, the sample statement and the per-language defaults agree with
//     the static text, and marks <html data-lang-static> so i18n.js does not
//     append ?lang= to the folder URL.
// The tool's runtime (parsing, conversion, download, Pro) is not touched.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICT, LANGS, STORAGE_KEY, ogLocaleForLang } from './i18n.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://arling.sk';
export const TOOL = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).name;
export const ROOT_URL = `${SITE}/${TOOL}/`;
export const STATIC_LANGS = ['en', 'de'];

/** JSON-LD Offer names of the Slovak source, translated for the static pages. */
const OFFER_NAMES = {
  'Zadarmo': { en: 'Free', de: 'Kostenlos' },
  'Pro (cez balík Bankové nástroje)': { en: 'Pro (via the Banking Tools bundle)', de: 'Pro (über das Paket Banking Tools)' },
  'Pro mesačne (balík Bankové nástroje, štyri nástroje)': { en: 'Pro monthly (Banking Tools bundle, four tools)', de: 'Pro monatlich (Paket Banking Tools, vier Tools)' },
  'Pro ročne (balík Bankové nástroje, štyri nástroje)': { en: 'Pro yearly (Banking Tools bundle, four tools)', de: 'Pro jährlich (Paket Banking Tools, vier Tools)' },
};

const I18N_ATTRS = {
  'data-i18n': null,
  'data-i18n-html': null,
  'data-i18n-placeholder': 'placeholder',
  'data-i18n-alt': 'alt',
  'data-i18n-aria-label': 'aria-label',
  'data-i18n-title': 'title',
};
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);

export function langUrl(lang) {
  return lang === 'sk' ? ROOT_URL : `${ROOT_URL}${lang}/`;
}

export function hreflangBlock() {
  return LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${langUrl(l)}" />`).join('\n')
    + `\n<link rel="alternate" hreflang="x-default" href="${ROOT_URL}" />`;
}

function tr(key, lang, problems) {
  const entry = DICT[key];
  const v = entry && entry[lang];
  if (typeof v !== 'string' || !v.trim()) {
    problems.push(`missing ${lang} translation for ${key}`);
    return key;
  }
  return v;
}

export function escText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** innerHTML -> plain text, the way a JSON-LD answer wants it. */
export function textOf(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────── tiny HTML scanner ───────────────────────────

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`=]+))?)*)\s*(\/?)>/y;

function parseTag(html, at) {
  TAG_RE.lastIndex = at;
  const m = TAG_RE.exec(html);
  if (!m) return null;
  return { closing: m[1] === '/', name: m[2], attrs: m[3] || '', selfClosing: m[4] === '/', raw: m[0], start: at, end: at + m[0].length };
}

function rawEnd(html, from, name) {
  const re = new RegExp(`</${name}\\s*>`, 'ig');
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m) throw new Error(`unclosed <${name}>`);
  return m.index;
}

/** Index range of the closing tag matching an element opened just before `from`. */
function matchingClose(html, from, name) {
  let depth = 1;
  let pos = from;
  const lname = name.toLowerCase();
  while (pos < html.length) {
    const lt = html.indexOf('<', pos);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4);
      pos = e < 0 ? html.length : e + 3;
      continue;
    }
    const tag = parseTag(html, lt);
    if (!tag) { pos = lt + 1; continue; }
    const tn = tag.name.toLowerCase();
    if (!tag.closing && RAW.has(tn)) { pos = rawEnd(html, tag.end, tn); continue; }
    if (tn === lname) {
      if (tag.closing) {
        depth--;
        if (depth === 0) return { start: tag.start, end: tag.end };
      } else if (!tag.selfClosing && !VOID.has(tn)) {
        depth++;
      }
    }
    pos = tag.end;
  }
  throw new Error(`no closing tag for <${name}>`);
}

function getAttr(attrs, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  if (!m) return null;
  return m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
}

function setAttr(attrs, name, escapedValue) {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s"'>]+)`, 'i');
  if (re.test(attrs)) return attrs.replace(re, `$1"${escapedValue}"`);
  return `${attrs} ${name}="${escapedValue}"`;
}

function removeAttr(attrs, name) {
  return attrs.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>]+)`, 'ig'), '');
}

function collectI18n(attrs) {
  const out = [];
  const re = /\s(data-i18n(?:-html|-placeholder|-alt|-aria-label|-title)?)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrs))) out.push({ attr: m[1], key: m[2] });
  return out;
}

function isRelativeUrl(v) {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i.test(v) && v !== '';
}

/** Walks the markup once; `onTag` may return a replacement for an opening
 * tag ({attrs, content}) where content (string) replaces the element body. */
function walk(html, onTag) {
  let out = '';
  let pos = 0;
  while (pos < html.length) {
    const lt = html.indexOf('<', pos);
    if (lt < 0) { out += html.slice(pos); break; }
    out += html.slice(pos, lt);
    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4);
      const stop = e < 0 ? html.length : e + 3;
      out += html.slice(lt, stop);
      pos = stop;
      continue;
    }
    const tag = parseTag(html, lt);
    if (!tag) { out += '<'; pos = lt + 1; continue; }
    const tn = tag.name.toLowerCase();
    if (tag.closing) { out += tag.raw; pos = tag.end; continue; }
    if (RAW.has(tn)) {
      const e = rawEnd(html, tag.end, tn);
      const r = onTag(tag, tn);
      out += (r ? `<${tag.name}${r.attrs}${tag.selfClosing ? ' /' : ''}>` : tag.raw) + html.slice(tag.end, e);
      pos = e;
      continue;
    }
    const r = onTag(tag, tn);
    if (!r) { out += tag.raw; pos = tag.end; continue; }
    const open = `<${tag.name}${r.attrs}${tag.selfClosing ? ' /' : ''}>`;
    if (r.content === undefined || tag.selfClosing || VOID.has(tn)) { out += open; pos = tag.end; continue; }
    const close = matchingClose(html, tag.end, tag.name);
    out += open + r.content + html.slice(close.start, close.end);
    pos = close.end;
  }
  return out;
}

/** Same DOM sync as applyI18n(), on the markup string. */
export function translateMarkup(html, lang, problems) {
  return walk(html, (tag, tn) => {
    const found = collectI18n(tag.attrs);
    let attrs = tag.attrs;
    let content;
    for (const { attr, key } of found) {
      const value = tr(key, lang, problems);
      const target = I18N_ATTRS[attr];
      if (target) attrs = setAttr(attrs, target, escAttr(value));
      else content = attr === 'data-i18n' ? escText(value) : value;
    }
    if (tn === 'form' && /\sdata-subscribe\b/.test(attrs)) attrs = setAttr(attrs, 'data-lang', lang);
    if (getAttr(attrs, 'id') === 'business-link') {
      attrs = setAttr(attrs, 'href', escAttr('mailto:andrej@arling.sk?subject=' + encodeURIComponent(tr('s5.business.subject', lang, problems))));
    }
    if (getAttr(attrs, 'id') === 'pro-bundle-link') attrs = setAttr(attrs, 'href', `https://arling.sk/bankove-nastroje/?lang=${lang}`);
    const setLangAttr = getAttr(attrs, 'data-set-lang');
    if (setLangAttr) {
      attrs = removeAttr(attrs, 'aria-current');
      attrs = removeAttr(attrs, 'aria-pressed');
      const cls = (getAttr(attrs, 'class') || '').split(/\s+/).filter((c) => c && c !== 'lang-active');
      if (setLangAttr === lang) cls.push('lang-active');
      attrs = cls.length ? setAttr(attrs, 'class', cls.join(' ')) : removeAttr(attrs, 'class');
      if (setLangAttr === lang) attrs = setAttr(attrs, 'aria-current', 'true');
    }
    if (found.length === 0 && attrs === tag.attrs) return null;
    return { attrs, content };
  });
}

/** Relative href/src one folder up; the tool's own absolute URL in <a> links -> language URL
 * (never in <link>, so canonical and hreflang keep pointing where they must). */
export function relocateUrls(html, lang) {
  const out = walk(html, (tag, tn) => {
    let attrs = tag.attrs;
    for (const name of ['href', 'src']) {
      const v = getAttr(attrs, name);
      if (v === null) continue;
      if (v === ROOT_URL) { if (tn === 'a') attrs = setAttr(attrs, name, langUrl(lang)); }
      else if (isRelativeUrl(v)) {
        const clean = v.replace(/^\.\//, '');
        attrs = setAttr(attrs, name, `../${clean}`);
      }
    }
    return attrs === tag.attrs ? null : { attrs };
  });
  // Module imports inside inline scripts: './x.js' -> '../x.js'.
  return out.replace(/(from\s+|import\s*\(\s*)(['"])\.\//g, '$1$2../');
}

function transformJsonLd(html, lang, problems) {
  const faqCount = (html.match(/data-i18n="faq\.q\d+"/g) || []).length;
  return html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (m, open, body, close) => {
    let obj;
    try { obj = JSON.parse(body); } catch (e) { problems.push('JSON-LD does not parse: ' + e.message); return m; }
    if (obj['@type'] === 'SoftwareApplication') {
      obj.name = tr('meta.title', lang, problems);
      obj.url = langUrl(lang);
      if (lang !== 'en') obj.description = tr('meta.description', lang, problems);
      if (Array.isArray(obj.offers)) {
        obj.offers.forEach((o) => {
          const tl = OFFER_NAMES[o.name];
          if (tl && tl[lang]) o.name = tl[lang];
          else problems.push(`no ${lang} name for JSON-LD offer "${o.name}"`);
        });
      }
    } else if (obj['@type'] === 'FAQPage') {
      const items = [];
      for (let n = 1; n <= faqCount; n++) {
        if (!DICT[`faq.q${n}`]) break;
        items.push({
          '@type': 'Question',
          name: tr(`faq.q${n}`, lang, problems),
          acceptedAnswer: { '@type': 'Answer', text: textOf(tr(`faq.a${n}`, lang, problems)) },
        });
      }
      obj.mainEntity = items;
    }
    return open + '\n' + JSON.stringify(obj, null, 2).replace(/<\//g, '<\\/') + '\n' + close;
  });
}

function replaceOnce(html, re, replacement, what, problems) {
  if (!re.test(html)) { problems.push(`${what} not found in index.html`); return html; }
  return html.replace(re, replacement);
}

/** Builds the static page for one language and returns its HTML. */
export function build(lang, sourceHtml) {
  if (!STATIC_LANGS.includes(lang)) throw new Error(`build(): unsupported language ${lang}`);
  const problems = [];
  const src = sourceHtml === undefined ? readFileSync(join(HERE, 'index.html'), 'utf8') : sourceHtml;
  let html = src;

  const title = tr('meta.title', lang, problems);
  const description = tr('meta.description', lang, problems);
  const url = langUrl(lang);

  html = replaceOnce(html, /<html lang="[a-z-]+">/, `<html lang="${lang}" data-lang-static="${lang}">`, '<html lang>', problems);
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${escText(title)}</title>`, '<title>', problems);
  html = replaceOnce(html, /(<meta name="description" content=")[^"]*(")/, `$1${escAttr(description)}$2`, 'meta description', problems);
  html = replaceOnce(html, /(<meta property="og:title" content=")[^"]*(")/, `$1${escAttr(title)}$2`, 'og:title', problems);
  html = replaceOnce(html, /(<meta property="og:description" content=")[^"]*(")/, `$1${escAttr(description)}$2`, 'og:description', problems);
  html = replaceOnce(html, /(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`, 'og:url', problems);
  html = replaceOnce(html, /(<meta property="og:locale" content=")[^"]*(")/, `$1${ogLocaleForLang(lang)}$2`, 'og:locale', problems);
  html = replaceOnce(html, /(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`, 'canonical', problems);
  html = html.replace(/<link rel="alternate" hreflang="[^"]*" href="[^"]*" \/>\n?/g, '');
  html = replaceOnce(html, /(<link rel="canonical" href="[^"]*" \/>\n)/, `$1${hreflangBlock()}\n`, 'canonical (hreflang insert)', problems);

  // Bootstrap: the folder's language wins in localStorage before i18n.js boots.
  const bootstrap = `<script>try{localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(lang)})}catch(e){}</script>`;
  html = replaceOnce(html, /(<meta http-equiv="Content-Security-Policy"[^>]*>\n)/, `$1${bootstrap}\n`, 'CSP meta (bootstrap insert)', problems);

  html = transformJsonLd(html, lang, problems);
  html = translateMarkup(html, lang, problems);
  html = relocateUrls(html, lang);

  if (problems.length) throw new Error(`build-i18n (${lang}):\n - ` + problems.join('\n - '));
  return prepocitajCsp(html);
}

/** Re-scans a built page: every data-i18n* element must carry the
 * translation of its key for `lang` (nothing left in Slovak, no raw key). */
export function verify(html, lang) {
  const problems = [];
  walk(html, (tag) => {
    for (const { attr, key } of collectI18n(tag.attrs)) {
      const entry = DICT[key];
      const value = entry && entry[lang];
      if (typeof value !== 'string' || !value.trim()) { problems.push(`${key}: no ${lang} translation`); continue; }
      const target = I18N_ATTRS[attr];
      if (target) {
        const got = getAttr(tag.attrs, target);
        if (got !== escAttr(value)) problems.push(`${key}: ${target} is ${JSON.stringify(got)}`);
      } else {
        const close = matchingClose(html, tag.end, tag.name);
        const got = html.slice(tag.end, close.start);
        const want = attr === 'data-i18n' ? escText(value) : value;
        if (got !== want) problems.push(`${key}: content is ${JSON.stringify(got.slice(0, 80))}`);
      }
    }
    return null;
  });
  return problems;
}

// ─────────────────────── CSP odtlačky vlastnej stránky ───────────────────────
//
// Táto stránka vzniká z index.html, ale nie je s ním zhodná: build do nej
// pridáva vlastný vložený skript, ktorý uloží jazyk priečinka. Odtlačok
// zdroja preto nesedí a prehliadač zablokuje VŠETKY vložené skripty na
// stránke, potichu a bez viditeľného príznaku. 6. 9. 2026 boli takto naživo
// nefunkčné anglické aj nemecké verzie camt.053 a SEPA Generátora.
//
// Prepočet je tu zámerne, nie až v ops/design/csp-hash.mjs: keby ho robil až
// ten, výsledok by sa rozišiel s tým, čo vyrobí `node build-i18n.mjs`, a test
// na zastarané súbory by padal. Takto je výstup buildu sám v sebe konzistentný
// a csp-hash na ňom nemá čo opravovať.
function prepocitajCsp(html) {
  const csp = html.match(/(<meta[^>]*Content-Security-Policy"[^>]*content=")([^"]+)(")/i);
  if (!csp) return html;
  const src = csp[2].match(/script-src ([^;]+)/);
  if (!src) return html;
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const potrebne = [...new Set(inline.map((s) => "'sha256-" + createHash('sha256').update(s, 'utf8').digest('base64') + "'"))];
  const ostatne = src[1].split(/\s+/).filter((x) => x && !x.startsWith("'sha256-"));
  const novy = [...ostatne, ...potrebne].join(' ');
  if (novy === src[1].trim()) return html;
  const novaPolicy = csp[2].replace(/script-src [^;]+/, 'script-src ' + novy);
  return html.slice(0, csp.index) + csp[1] + novaPolicy + csp[3] + html.slice(csp.index + csp[0].length);
}

export function outputPath(lang) {
  return join(HERE, lang, 'index.html');
}

export function buildAll(write) {
  const out = {};
  for (const lang of STATIC_LANGS) {
    out[lang] = build(lang);
    if (write) {
      mkdirSync(dirname(outputPath(lang)), { recursive: true });
      writeFileSync(outputPath(lang), out[lang], 'utf8');
    }
  }
  return out;
}

const here = fileURLToPath(import.meta.url);
const argv1 = process.argv[1] ? resolve(process.argv[1]) : '';
const isMain = argv1 && (process.platform === 'win32' ? argv1.toLowerCase() === here.toLowerCase() : argv1 === here);
if (isMain) {
  const out = buildAll(true);
  for (const lang of STATIC_LANGS) {
    const rel = `${lang}/index.html`;
    const left = verify(out[lang], lang);
    console.log(`${rel}: ${(out[lang].length / 1024).toFixed(1)} kB, ${left.length} problems${existsSync(outputPath(lang)) ? '' : ' (not written)'}`);
    left.forEach((p) => console.log('  - ' + p));
  }
}
