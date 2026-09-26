// The site's markdown rules, in one place. build.mjs renders posts with them, and the composer at
// /write/ previews with them, so a preview looks the way the post will. Marked is passed in rather
// than imported: the build gets it from node_modules, the browser from /assets/marked.esm.js.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// base:             the site's base path, added to root-relative links ('' on its own domain)
// resolve(target):  the post that [[target]] names, as { href, title }, or null
// missing(target):  called for a [[target]] that names no post
export function createMarkdown(Marked, { base = '', resolve = () => null, missing = () => {} } = {}) {
  const fixUrl = href => (href && href.startsWith('/') && !href.startsWith('//') ? base + href : href);

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
        const hit = resolve(t.target);
        if (!hit) {
          missing(t.target);
          return `<span class="wikilink-missing" title="No post called “${esc(t.target)}” yet">${esc(t.label || t.target)}</span>`;
        }
        return `<a href="${esc(hit.href)}">${esc(t.label || hit.title)}</a>`;
      },
    }],
  });
  return md;
}

// Demos are same-origin pages, so each frame can grow to fit what it holds. A fitted frame hides its
// scrollbar, which would otherwise narrow the page and change its height. The cap stops a page whose
// height follows its own viewport from growing forever. This runs in the browser: the build inlines it
// into pages with demos, and the composer calls it on its preview.
export function fitDemos(root) {
  for (const f of root.querySelectorAll('.demo iframe')) f.addEventListener('load', () => {
    const d = f.contentDocument?.documentElement;
    if (d) new ResizeObserver(() => {
      const h = d.offsetHeight, max = innerHeight * 3;
      if (!h) return;
      d.style.overflow = h > max ? '' : 'hidden';
      f.style.height = Math.min(h, max) + 'px';
    }).observe(d);
  });
}
