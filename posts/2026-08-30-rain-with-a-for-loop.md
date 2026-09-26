---
title: How to draw rain with a for-loop
date: 2026-08-30 13:24
---

Every drop falling behind this page is one line: a start point, a length, a speed, and a little wind. A few hundred of them, recycled forever. Weather, it turns out, is mostly a lot of small, simple things agreeing to fall at the same time.

Here's the whole idea, minus the drawing:

```js
for (const drop of drops) {
  drop.y += drop.speed * dt;
  drop.x += drop.speed * wind * dt;
  if (drop.y > height) recycle(drop); // start over
}
```

The part that makes it feel like weather rather than a screensaver is that rain only starts once the clouds are thick enough to hold it. Clouds roll in first, the sky goes gray, and then it rains. Nobody notices that rule until it's missing.
