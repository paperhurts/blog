#!/usr/bin/env node
// Daybook: markdown posts in, a blog with a living sky out.
//
//   npm run build   writes the site to dist/
//   npm run dev     builds with drafts, watches for changes, serves on http://localhost:4321
//
// Everything the site does is in this file, src/sky.js, and src/style.css.

import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { Marked } from 'marked';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const P = (...parts) => path.join(DIR, ...parts);
const OUT = P('dist');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 4321;

const DEFAULTS = {
  title: 'Daybook',
  tagline: '',
  description: '',
  url: 'http://localhost:4321',
  basePath: '',
  homeLimit: 30,
  dawn: 4.75,
  night: 23.6,
  interludes: [],
  closing: { title: 'Goodnight.', line: 'Scroll back up and the sun comes back. Same as always.' },
};

/* ---------------------------------------------------------------- helpers */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
const pad = n => String(n).padStart(2, '0');
const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function fmtHour(h) {
  const total = Math.round((((h % 24) + 24) % 24) * 60);
  const H = Math.floor(total / 60) % 24, m = total % 60;
  return `${H % 12 || 12}:${pad(m)} ${H < 12 ? 'am' : 'pm'}`;
}

// Dates are wall-clock time as written. "2026-03-03 06:24" means 6:24 on your clock, no timezone math.
function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) {
    const hh = v.getUTCHours(), mm = v.getUTCMinutes();
    return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate(), hh, mm, hasTime: hh + mm > 0 };
  }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?\s*$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  let hh = m[4] ? +m[4] : 0;
  const ap = m[6]?.toLowerCase();
  if (ap === 'pm' && hh < 12) hh += 12;
  if (ap === 'am' && hh === 12) hh = 0;
  const w = { y: +m[1], m: +m[2], d: +m[3], hh, mm: m[5] ? +m[5] : 0, hasTime: !!m[4] };
  if (w.m < 1 || w.m > 12 || w.d < 1 || w.d > 31 || w.hh > 23 || w.mm > 59) return null;
  return w;
}

// "hour:" accepts 6.4, "6:24", "6:24 am". Unquoted 6:24 arrives from YAML as 384 (base-60 minutes).
function parseHour(v) {
  if (typeof v === 'number') return v >= 24 ? v / 60 : v;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(v).trim());
  if (!m) return NaN;
  let h = +m[1];
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h + (m[2] ? +m[2] / 60 : 0);
}

async function loadConfig() {
  let user = {};
  try { user = JSON.parse(await fs.readFile(P('site.config.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error(`site.config.json: ${e.message}`); }
  const site = { ...DEFAULTS, ...user, closing: { ...DEFAULTS.closing, ...(user.closing || {}) } };
  site.url = String(site.url).replace(/\/+$/, '');
  site.basePath = site.basePath ? '/' + String(site.basePath).replace(/^\/+|\/+$/g, '') : '';
  return site;
}

/* ------------------------------------------------------------------ posts */

async function loadPosts({ drafts, warn }) {
  let files = [];
  try { files = (await fs.readdir(P('posts'))).filter(f => f.endsWith('.md')).sort(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }

  const posts = [], slugs = new Set();
  for (const file of files) {
    const raw = await fs.readFile(P('posts', file), 'utf8');
    let data, content;
    try { ({ data, content } = matter(raw)); }
    catch (e) { warn(`${file}: front matter couldn't be read (${e.reason || e.message}). Skipped.`); continue; }
    if (data.draft && !drafts) continue;

    // Filenames like 2026-03-03-slug.md or 2026-03-03-0624-slug.md work as a fallback for date and slug.
    const base = file.replace(/\.md$/, '');
    const fromName = /^(\d{4}-\d{2}-\d{2})(?:-(\d{2})(\d{2}))?-(.+)$/.exec(base);

    let body = content;
    let title = data.title;
    if (!title) {
      const h1 = /^[ \t]*#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body);
      if (h1) { title = h1[1]; body = body.replace(h1[0], ''); }
    }
    if (!title) title = (fromName ? fromName[4] : base).replace(/-/g, ' ');

    const when = parseDate(data.date)
      || (fromName && parseDate(fromName[1] + (fromName[2] ? ` ${fromName[2]}:${fromName[3]}` : '')));
    if (!when) { warn(`${file}: no date. Add "date: YYYY-MM-DD HH:MM" to the front matter. Skipped.`); continue; }

    let hour = data.hour != null ? parseHour(data.hour) : when.hasTime ? when.hh + when.mm / 60 : NaN;
    if (!Number.isFinite(hour) || hour < 0 || hour >= 24) {
      warn(`${file}: no time of day, so it sits at noon. Add a time to the date, like "${when.y}-${pad(when.m)}-${pad(when.d)} 21:40".`);
      hour = 12;
    }
    if (!when.hasTime) { const mins = Math.min(1439, Math.round(hour * 60)); when.hh = Math.floor(mins / 60); when.mm = mins % 60; }
    if (hour < 4) hour += 24; // after midnight still belongs to the night before

    let slug = slugify(data.slug || (fromName ? fromName[4] : base)) || hash(file);
    if (slugs.has(slug)) { warn(`${file}: another post already uses the slug "${slug}". Renamed to "${slug}-2".`); slug += '-2'; }
    slugs.add(slug);

    posts.push({
      file, slug, body, when, hour,
      title: String(title).trim(),
      draft: !!data.draft,
      excerptSrc: data.excerpt,
      key: when.y * 1e8 + when.m * 1e6 + when.d * 1e4 + when.hh * 100 + when.mm,
    });
  }
  return posts;
}

/* ------------------------------------------------------------------ build */

let servedBase = '';

async function build({ drafts = false, dev = false } = {}) {
  const started = Date.now();
  const warnings = [];
  const warn = msg => warnings.push(msg);

  const site = await loadConfig();
  const base = site.basePath;
  servedBase = base;
  const url = p => base + p;
  const abs = p => site.url + base + p;
  const fixUrl = href => (href && href.startsWith('/') && !href.startsWith('//') ? base + href : href);

  const posts = await loadPosts({ drafts, warn });
  const postUrl = p => url(`/posts/${p.slug}/`);

  // [[wikilinks]] resolve by slug or by title, and every link is remembered for "Linked from"
  const lookup = new Map();
  for (const p of posts) { lookup.set(p.slug, p); lookup.set(p.title.toLowerCase(), p); }
  const backlinks = new Map(posts.map(p => [p, new Set()]));
  let current = null;

  // ![caption](/demos/plasma.html) embeds a live page instead of an image
  const isDemo = href => /\.html?(?:[?#].*)?$/i.test(href || '');
  const demo = (href, text) => {
    const src = esc(fixUrl(href));
    return `<figure class="demo"><iframe src="${src}" title="${esc(text || 'Demo')}" loading="lazy"></iframe>` +
      `<figcaption>${text ? `${esc(text)}. ` : ''}<a href="${src}">Open it on its own page</a></figcaption></figure>`;
  };

  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth }) {
        const d = Math.min(6, depth + 1); // the post title is the page's h1
        return `<h${d}>${this.parser.parseInline(tokens)}</h${d}>\n`;
      },
      paragraph({ tokens }) {
        // a demo on a line by itself is a figure, and a figure can't sit inside <p>
        const solo = tokens.filter(t => t.type !== 'text' || t.text.trim());
        if (solo.length === 1 && solo[0].type === 'image' && isDemo(solo[0].href)) return this.parser.parseInline(solo) + '\n';
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      link({ href, title, tokens }) {
        return `<a href="${esc(fixUrl(href))}"${title ? ` title="${esc(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href, title, text }) {
        if (isDemo(href)) return demo(href, text);
        return `<img src="${esc(fixUrl(href))}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`;
      },
    },
    extensions: [{
      name: 'wikilink',
      level: 'inline',
      start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: m[2]?.trim() };
      },
      renderer(t) {
        // [[https://...]] points somewhere else entirely, so it's an ordinary link
        if (/^(https?:)?\/\//i.test(t.target)) return `<a href="${esc(t.target)}">${esc(t.label || t.target)}</a>`;
        const hit = lookup.get(t.target.toLowerCase()) || lookup.get(slugify(t.target));
        if (!hit) {
          if (current) warn(`${current.file}: [[${t.target}]] doesn't match any post yet.`);
          return `<span class="wikilink-missing" title="No post called “${esc(t.target)}” yet">${esc(t.label || t.target)}</span>`;
        }
        if (current && hit !== current) backlinks.get(hit).add(current);
        return `<a href="${postUrl(hit)}">${esc(t.label || hit.title)}</a>`;
      },
    }],
  });

  for (const p of posts) {
    current = p;
    p.html = md.parse(p.body);
    current = null;
    const blocks = md.lexer(p.body).filter(t => t.type !== 'space');
    const first = blocks.find(t => t.type === 'paragraph');
    p.excerpt = p.excerptSrc ? `<p>${md.parseInline(String(p.excerptSrc))}</p>` : first ? md.parser([first]) : '';
    p.hasMore = !!p.excerptSrc || blocks.length > 1;
    p.minutes = Math.max(1, Math.round(p.body.split(/\s+/).filter(Boolean).length / 230));
  }

  const byDate = [...posts].sort((a, b) => b.key - a.key);
  const byHour = [...posts].sort((a, b) => a.hour - b.hour || a.key - b.key);
  const newestYear = byDate[0]?.when.y;
  const iso = w => `${w.y}-${pad(w.m)}-${pad(w.d)}T${pad(w.hh)}:${pad(w.mm)}`;
  const dateText = (w, year) => `${MONTHS[w.m - 1]} ${w.d}${year || w.y !== newestYear ? `, ${w.y}` : ''}`;
  const hourAttr = h => +h.toFixed(3);

  const whenLine = (p, { year = false, extra = '' } = {}) =>
    `<p class="when"><span class="hour">${fmtHour(p.hour)}</span>, <time datetime="${iso(p.when)}">${dateText(p.when, year)}</time>${extra}${p.draft ? ', <span class="draft">draft</span>' : ''}</p>`;

  /* assets */
  const css = await fs.readFile(P('src', 'style.css'), 'utf8');
  const js = await fs.readFile(P('src', 'sky.js'), 'utf8');
  const cssHref = `${url('/assets/style.css')}?v=${hash(css)}`;
  const jsHref = `${url('/assets/sky.js')}?v=${hash(js)}`;

  // Demos are same-origin pages, so each frame can grow to fit what it holds. A fitted
  // frame hides its scrollbar, which would otherwise narrow the page and change its
  // height. The cap stops a page whose height follows its own viewport from growing forever.
  const fitDemos = `for (const f of document.querySelectorAll('.demo iframe')) f.addEventListener('load', () => {
  const d = f.contentDocument?.documentElement;
  if (d) new ResizeObserver(() => {
    const h = d.offsetHeight, max = innerHeight * 3;
    if (!h) return;
    d.style.overflow = h > max ? '' : 'hidden';
    f.style.height = Math.min(h, max) + 'px';
  }).observe(d);
});`;

  const page = ({ title, description = site.description || site.tagline, at, hour, body, type = 'website' }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070b1f">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">\n` : ''}<link rel="canonical" href="${abs(at)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${abs(at)}">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)}" href="${abs('/feed.xml')}">
<link rel="icon" href="${url('/favicon.svg')}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap">
<link rel="stylesheet" href="${cssHref}">
</head>
<body>
<canvas id="sky" aria-hidden="true"></canvas>
<div class="hud">
  <span class="chip" id="hudTime" aria-hidden="true">${fmtHour(hour)}</span>
  <button class="chip" id="hudWx" type="button" title="Change the weather">Clear</button>
</div>
<main class="page">
${body}
</main>${body.includes('class="demo"') ? `\n<script>${fitDemos}</script>` : ''}
<script src="${jsHref}" defer></script>${dev ? `\n<script>new EventSource('/__reload').onmessage = () => location.reload();</script>` : ''}
</body>
</html>
`;

  const siteNav = `<a href="${url('/')}">Home</a>\n    <a href="${url('/archive/')}">Archive</a>\n    <a href="${url('/feed.xml')}">Feed</a>`;
  const topbar = `<nav class="topbar col" aria-label="Site"><a href="${url('/')}">${esc(site.title)}</a></nav>`;

  /* ----------------------------------------------------------- home page */
  const home = byDate.slice(0, site.homeLimit > 0 ? site.homeLimit : undefined)
    .sort((a, b) => a.hour - b.hour || a.key - b.key);
  const dawn = Math.min(site.dawn, (home[0]?.hour ?? site.dawn) - 0.3);
  const night = Math.max(site.night, (home.at(-1)?.hour ?? site.night) + 0.35);
  const older = posts.length - home.length;

  const card = p => `  <article class="post" id="${p.slug}" data-hour="${hourAttr(p.hour)}">
    ${whenLine(p)}
    <h3><a href="${postUrl(p)}">${esc(p.title)}</a></h3>
    ${p.excerpt.trim()}${p.hasMore ? `\n    <p><a class="more" href="${postUrl(p)}">Keep reading</a></p>` : ''}
  </article>`;

  const items = [
    ...home.map(p => ({ hour: p.hour, order: 1, html: card(p) })),
    ...site.interludes.filter(i => i.hour > dawn && i.hour < night).map(i => ({ hour: i.hour, order: 0, interlude: i })),
  ].sort((a, b) => a.hour - b.hour || a.order - b.order);

  let stream = '', pane = [];
  const flush = () => { if (pane.length) stream += `<div class="pane col">\n${pane.join('\n')}\n</div>\n`; pane = []; };
  for (const it of items) {
    if (!it.interlude) { pane.push(it.html); continue; }
    flush();
    stream += `<section class="interlude col" data-hour="${hourAttr(it.hour)}">
  <h2>${esc(it.interlude.title)}</h2>${it.interlude.line ? `\n  <p>${esc(it.interlude.line)}</p>` : ''}
</section>\n`;
  }
  flush();
  if (!posts.length) {
    stream = `<div class="pane col" data-hour="9"><p>No posts yet. Add a markdown file to the <code>posts</code> folder and it will appear here at the hour you wrote it.</p></div>\n`;
  }

  const homeBody = `<header class="hero col" id="top" data-hour="${hourAttr(dawn)}">
  <h1>${esc(site.title)}</h1>${site.tagline ? `\n  <p class="lede">${esc(site.tagline)}</p>` : ''}
  <p class="hint">Scroll to bring the sun up.</p>
</header>
${stream}<footer class="night col" data-hour="${hourAttr(night)}">
  <h2>${esc(site.closing.title)}</h2>
  <p>${esc(site.closing.line)}</p>
  <nav aria-label="Site">
    <a href="#top">Back to morning</a>
    <a href="${url('/archive/')}">Archive</a>
    <a href="${url('/feed.xml')}">Feed</a>
  </nav>
  <small>${esc(site.title)}. Posts sit at the hour they were written.${older > 0 ? ` ${older} older ${older === 1 ? 'post is' : 'posts are'} in the archive.` : ''}</small>
</footer>`;

  /* -------------------------------------------------------------- write */
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  try { await fs.cp(P('public'), OUT, { recursive: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const write = async (rel, content) => {
    const file = path.join(OUT, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };

  await write('assets/style.css', css);
  await write('assets/sky.js', js);
  await write('.nojekyll', '');
  await write('index.html', page({ title: site.title, at: '/', hour: dawn, body: homeBody }));

  /* ---------------------------------------------------------- post pages */
  for (let i = 0; i < byHour.length; i++) {
    const p = byHour[i], earlier = byHour[i - 1], later = byHour[i + 1];
    const from = [...backlinks.get(p)].sort((a, b) => a.hour - b.hour);
    const neighbor = (q, cls, label) => q
      ? `<a class="${cls}" href="${postUrl(q)}"><small>${label}, ${fmtHour(q.hour)}</small><span>${esc(q.title)}</span></a>`
      : '';
    const body = `${topbar}
<article class="pane col article" data-hour="${hourAttr(p.hour)}">
  ${whenLine(p, { year: true, extra: `, ${p.minutes} minute read` })}
  <h1>${esc(p.title)}</h1>
  <div class="prose">
${p.html.trim()}
  </div>${from.length ? `
  <aside class="backlinks">
    <h2>Linked from</h2>
    <ul>${from.map(q => `<li><a href="${postUrl(q)}">${esc(q.title)}</a></li>`).join('')}</ul>
  </aside>` : ''}
</article>
${earlier || later ? `<nav class="daynav col" aria-label="Elsewhere in the day">
  ${neighbor(earlier, 'earlier', 'Earlier in the day')}
  ${neighbor(later, 'later', 'Later in the day')}
</nav>\n` : ''}<footer class="foot col">
    ${siteNav}
</footer>`;
    const description = p.excerptSrc ? String(p.excerptSrc) : p.excerpt.replace(/<[^>]+>/g, '').trim().slice(0, 200);
    await write(`posts/${p.slug}/index.html`, page({ title: `${p.title} | ${site.title}`, description, at: `/posts/${p.slug}/`, hour: p.hour, body, type: 'article' }));
  }

  /* ------------------------------------------------------------- archive */
  const years = new Map();
  for (const p of byDate) { if (!years.has(p.when.y)) years.set(p.when.y, []); years.get(p.when.y).push(p); }
  const archiveBody = `${topbar}
<section class="pane col archive" data-hour="21">
  <h1>Archive</h1>
  <p class="when">${posts.length} ${posts.length === 1 ? 'post' : 'posts'}, newest first.</p>
${[...years].map(([y, list]) => `  <h2>${y}</h2>
  <ol>
${list.map(p => `    <li><a href="${postUrl(p)}"><span class="t">${esc(p.title)}</span><span class="d">${MONTHS[p.when.m - 1]} ${p.when.d}, <span class="hour">${fmtHour(p.hour)}</span></span></a></li>`).join('\n')}
  </ol>`).join('\n')}
</section>
<footer class="foot col">
    ${siteNav}
</footer>`;
  await write('archive/index.html', page({ title: `Archive | ${site.title}`, at: '/archive/', hour: 21, body: archiveBody }));

  /* ----------------------------------------------------------------- 404 */
  await write('404.html', page({
    title: `Not found | ${site.title}`, at: '/404.html', hour: site.night,
    body: `<section class="night col" data-hour="${site.night}">
  <h1>Nothing out here.</h1>
  <p>This page doesn't exist, but the sky is still nice. <a href="${url('/')}">Go to the home page</a>.</p>
</section>`,
  }));

  /* ---------------------------------------------------------------- feed */
  const cdata = s => `<![CDATA[${s.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
  const absolutize = html => html.replace(/(href|src)="\/(?!\/)/g, `$1="${site.url}/`);
  const rfc822 = w => new Date(Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm)).toUTCString();
  await write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(site.title)}</title>
  <link>${abs('/')}</link>
  <description>${esc(site.description || site.tagline || site.title)}</description>
  <atom:link href="${abs('/feed.xml')}" rel="self" type="application/rss+xml"/>
${byDate.filter(p => !p.draft).slice(0, 20).map(p => `  <item>
    <title>${esc(p.title)}</title>
    <link>${abs(`/posts/${p.slug}/`)}</link>
    <guid>${abs(`/posts/${p.slug}/`)}</guid>
    <pubDate>${rfc822(p.when)}</pubDate>
    <description>${cdata(absolutize(p.html))}</description>
  </item>`).join('\n')}
</channel>
</rss>
`);

  const drafted = posts.filter(p => p.draft).length;
  console.log(`  Built ${posts.length} ${posts.length === 1 ? 'post' : 'posts'}${drafted ? ` (${drafted} ${drafted === 1 ? 'draft' : 'drafts'})` : ''} in ${Date.now() - started} ms`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

/* ------------------------------------------------------------- dev server */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4',
};

function serve() {
  const clients = new Set();
  http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/__reload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 500\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    let p = decodeURIComponent(u.pathname);
    if (servedBase && p.startsWith(servedBase)) p = p.slice(servedBase.length) || '/';
    let file = path.join(OUT, p);
    if (!file.startsWith(OUT)) { res.writeHead(403).end(); return; }
    try { if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html'); } catch { /* falls through to 404 */ }
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      const notFound = await fs.readFile(path.join(OUT, '404.html')).catch(() => 'Not found');
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(notFound);
    }
  }).listen(PORT, () => console.log(`\n  Daybook is running at http://localhost:${PORT}${servedBase}/\n  Drafts are shown. Save a post and the page reloads.\n`));
  return () => { for (const c of clients) c.write('data: reload\n\n'); };
}

/* ------------------------------------------------------------------- main */

if (DEV) {
  try { await build({ drafts: true, dev: true }); } catch (e) { console.error(`\n  Build failed: ${e.message}\n`); }
  const notify = serve();
  let timer = null, running = false, again = false;
  const rebuild = async () => {
    if (running) { again = true; return; }
    running = true;
    try { await build({ drafts: true, dev: true }); notify(); }
    catch (e) { console.error(`\n  Build failed: ${e.message}\n`); }
    running = false;
    if (again) { again = false; rebuild(); }
  };
  for (const target of ['posts', 'src', 'public', 'site.config.json']) {
    try { watch(P(target), { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(rebuild, 150); }); }
    catch { /* folder may not exist yet */ }
  }
} else {
  try { await build(); }
  catch (e) { console.error(`\n  Build failed: ${e.message}\n`); process.exit(1); }
}
