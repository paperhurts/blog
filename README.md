# blog

The paperhurts dev blog, headed for **paperhurts.com**: a post for each project, why it happened, and tips picked up along the way.

It's built on Daybook, a blog with a living sky. Posts are markdown files; the home page is a single day, and each post sits at the hour it was written. Scroll from sunrise to stars. Weather rolls through on its own.

## Run it

Needs Node 20 or newer.

```sh
npm install
npm run dev      # http://localhost:4321, shows drafts, reloads when you save
npm run build    # writes the finished site to dist/
```

The posts in `posts/` right now are the design's samples. They're marked `draft: true`, so they show up in `npm run dev` and stay out of the published site. Delete them once real posts exist.

## Write a post

Add a markdown file to `posts/`. The filename becomes the URL, so `posts/2026-09-09-after-the-storm.md` lives at `/posts/after-the-storm/`.

```md
---
title: The ten minutes after a storm
date: 2026-09-09 19:24
---

The best air of the day comes right after the rain quits.
```

The time in `date` decides where the post sits in the day. Write it the way your clock showed it, without a timezone. Everything else is optional:

| Field | What it does |
| --- | --- |
| `title` | Falls back to the first `# Heading` in the file, then to the filename. |
| `date` | `YYYY-MM-DD HH:MM`. Also accepts `7:24 pm`. If it's missing, the date in the filename is used. |
| `hour` | Places the post at a different time of day than `date` says. Use `19.4` or `"7:24 pm"` (quote it). |
| `slug` | Changes the URL. |
| `excerpt` | Replaces the first paragraph on the home page. |
| `draft: true` | Shows up in `npm run dev`, stays out of the published site. |

Posts written between midnight and 4 am stay at the end of the night before, instead of jumping to the top of the next morning.

### Linking between posts

`[[How to draw rain with a for-loop]]` or `[[rain-with-a-for-loop]]` links by title or slug. `[[rain-with-a-for-loop|the rain post]]` sets the link text. Every post shows the posts that link to it under "Linked from". A link to a post that doesn't exist yet builds fine, shows as dotted text, and gets a warning in the terminal.

### Images and files

Put them in `public/` and link from the site root: `![Porch at dusk](/images/porch.jpg)` for `public/images/porch.jpg`. Everything in `public/` is copied into the site as-is.

### Demos

A little project that's a single HTML page can run inside a post. Put the page in `public/demos/` and embed it with image syntax on a line by itself:

```md
![Plasma, 320×240, 256 colors](/demos/plasma.html)
```

It renders as a live frame across the full width of the pane, sized to fit the page, with the alt text as its caption and a link to open it on its own. The demo page doesn't need any changes. It just has to live on the same site, which is what lets the frame measure it. Everything in `public/demos/` publishes even when the post that embeds it is still a draft.

## Configure

`site.config.json`:

- `title`, `tagline`, `description`: the name and the lines under it.
- `url`: the site's address (used by the feed and link previews).
- `basePath`: leave empty for your own domain. Use `"/blog"` if the site lives at a subpath.
- `homeLimit`: how many of the newest posts appear on the home page. The rest are in the archive. `0` shows all of them.
- `interludes`: the parts of the day set in large type between posts. Change, add, or remove them.
- `dawn`, `night`: where the home page's day begins and ends.
- `closing`: the goodnight at the bottom.

## Publish

`.github/workflows/deploy.yml` builds the site on every push to `main`. It doesn't publish until launch. To launch:

1. In the repo, go to Settings > Pages, set Source to "GitHub Actions", and set the custom domain to `paperhurts.com`.
2. Run `gh variable set PAGES_LIVE --body true --repo paperhurts/blog`. From then on, every push to `main` publishes.
3. Point paperhurts.com's DNS at GitHub Pages.

## Domains

paperhurts.com currently hosts the landing page for the reader app. That page is moving to its own subdomain so the blog can take the apex:

| Address | Serves | Source |
|---|---|---|
| paperhurts.com | this blog | `paperhurts/blog` |
| reader.paperhurts.dev | reader landing page | `paperhurts/paperhurts-site` (GitHub Pages) |
| paperhurts.dev | studio homepage | `paperhurts/paperhurts.github.io` |

The landing page has to be live at reader.paperhurts.dev before paperhurts.com switches over, so the reader never goes dark. The ordered checklist is in the admin repo's `TODO.md`.

## What's where

- `build.mjs`: the generator and dev server. Reads posts, renders markdown, writes pages, archive, feed, and 404.
- `src/sky.js`: the sky. Maps scroll position to time of day, runs the weather, and sets the page's colors from the light.
- `src/style.css`: all styles.
- The weather picker is `stepWeather()` in `src/sky.js`. Swap its random choice for real conditions and the sky follows the actual weather.
