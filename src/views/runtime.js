/* Sissi view runtime: renders a view's playlist (carousel, single, gallery) into an element or shadow root.
 * Classic script (no imports) so it can be inlined into the frame page and into embed.js.
 * Builds the DOM with createElement and textContent only: entry text is never parsed as HTML. */
(function () {
  'use strict';
  var TIMERS = typeof WeakMap === 'function' ? new WeakMap() : null;
  var STYLE = [
    ':host, .sissi-view { display: block; position: relative; width: var(--sissi-width, 100%); height: var(--sissi-height, auto); min-width: var(--sissi-min-width, none); max-width: var(--sissi-max-width, none); min-height: var(--sissi-min-height, none); max-height: var(--sissi-max-height, none); font-family: system-ui, sans-serif; color: #111; }',
    '.sissi-view .sv-stage { position: relative; width: 100%; aspect-ratio: var(--sv-aspect, 16 / 9); overflow: hidden; background: var(--sv-bg, var(--sissi-bg, transparent)); }',
    '.sissi-view .sv-slide { position: absolute; inset: 0; display: none; }',
    '.sissi-view .sv-slide.is-on { display: block; }',
    '.sissi-view figure { margin: 0; height: 100%; display: flex; flex-direction: column; }',
    '.sissi-view .sv-media { position: relative; flex: 1 1 auto; min-height: 0; }',
    '.sissi-view .sv-media img, .sissi-view .sv-media video { width: 100%; height: 100%; object-fit: var(--sv-fit, contain); display: block; }',
    '.sissi-view .sv-text { padding: .6em .9em; font-family: "Martti Sissi", system-ui, sans-serif; }',
    '.sissi-view .sv-stage .sv-text { position: absolute; left: 0; right: 0; bottom: 0; padding: 1.6em .9em .7em; color: #fff; background: linear-gradient(to top, rgba(0,0,0,.75), rgba(0,0,0,0)); text-shadow: 0 1px 2px rgba(0,0,0,.5); }',
    '.sissi-view .sv-headline { margin: 0; font-size: clamp(1.1rem, 2.6vw, 1.9rem); font-weight: 700; line-height: 1.2; }',
    '.sissi-view .sv-caption { margin: .25em 0 0; font-size: clamp(.85rem, 1.7vw, 1.15rem); font-weight: 400; line-height: 1.35; }',
    '.sissi-view.is-fit .sv-stage { transition: aspect-ratio .3s ease; }',
    '@media (prefers-reduced-motion: reduce) { .sissi-view.is-fit .sv-stage { transition: none; } }',
    '.sissi-view.is-fit .sv-grid .sv-media { aspect-ratio: auto; }',
    '.sissi-view.is-fit .sv-grid .sv-media img, .sissi-view.is-fit .sv-grid .sv-media video { height: auto; }',
    '.sissi-view a { color: inherit; text-decoration: none; }',
    '.sissi-view .sv-arrow { position: absolute; top: 50%; z-index: 2; width: 2.75rem; height: 2.75rem; margin: 0; padding: 0; transform: translateY(-50%); display: grid; place-items: center; border: 0; border-radius: 50%; color: #fff; background: rgba(20,20,20,.5); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); box-shadow: 0 2px 8px rgba(0,0,0,.3); cursor: pointer; opacity: .85; transition: background .15s, opacity .15s, transform .15s; }',
    '.sissi-view .sv-arrow.sv-prev { left: .6rem; } .sissi-view .sv-arrow.sv-next { right: .6rem; }',
    '.sissi-view .sv-arrow svg { width: 1.4rem; height: 1.4rem; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }',
    '.sissi-view .sv-arrow:hover { background: rgba(20,20,20,.75); opacity: 1; transform: translateY(-50%) scale(1.06); }',
    '.sissi-view .sv-arrow:active { transform: translateY(-50%) scale(.96); }',
    '@media (hover: hover) { .sissi-view .sv-arrow { opacity: 0; } .sissi-view .sv-stage:hover .sv-arrow, .sissi-view .sv-arrow:focus-visible { opacity: .9; } }',
    '@media (prefers-reduced-motion: reduce) { .sissi-view .sv-arrow { transition: none; } }',
    '.sissi-view .sv-nav button.sv-dot { width: .6rem; height: .6rem; min-width: .6rem; min-height: .6rem; border-radius: 999px; border: 0; background: rgba(0,0,0,.25); padding: 0; transition: width .2s, background .2s; }',
    '.sissi-view .sv-nav button.sv-dot.is-on { width: 1.5rem; background: #222; }',
    '.sissi-view .sv-nav { display: flex; align-items: center; justify-content: center; gap: .4rem; padding: .6rem; }',
    '.sissi-view .sv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: .6em; padding: .6em; }',
    '.sissi-view .sv-grid figure { height: auto; }',
    '.sissi-view .sv-grid .sv-media { aspect-ratio: var(--sv-aspect, 16 / 9); }',
    '.sissi-view .sv-empty { padding: 2em; text-align: center; color: #666; }',
    '.sissi-view button:focus-visible, .sissi-view a:focus-visible { outline: 3px solid #1a5fb4; outline-offset: 2px; }'
  ].join('\n');

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function text(tag, cls, value) {
    var node = el(tag, cls ? { class: cls } : null);
    node.textContent = value;
    return node;
  }

  function media(entry) {
    var box = el('div', { class: 'sv-media' });
    if (entry.kind === 'video') {
      var v = el('video', { src: entry.url, muted: '', playsinline: '', preload: 'auto', 'aria-label': entry.alt || '' });
      v.muted = true;
      box.appendChild(v);
    } else {
      var imgAttrs = { src: entry.url, alt: entry.alt || '', loading: 'eager', decoding: 'async' };
      if (entry.srcset) {
        imgAttrs.srcset = entry.srcset;
        imgAttrs.sizes = entry.sizes || '(max-width: 600px) 480px, (max-width: 900px) 720px, 1080px';
      }
      box.appendChild(el('img', imgAttrs));
    }
    return box;
  }

  function figure(entry) {
    var block = null;
    if (entry.headline || entry.caption) {
      block = el('div', { class: 'sv-text' }, [entry.headline ? text('div', 'sv-headline', entry.headline) : null, entry.caption ? text('p', 'sv-caption', entry.caption) : null]);
    }
    var fig = el('figure', null, [media(entry), block]);
    if (entry.link) {
      var a = el('a', { href: entry.link, target: '_blank', rel: 'noopener noreferrer' }, [fig]);
      return a;
    }
    return fig;
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** Round overlay arrow with an inline SVG chevron (built with createElementNS: nothing is parsed as HTML). */
  function arrowButton(dir, label) {
    var b = el('button', { type: 'button', class: 'sv-arrow sv-' + dir, 'aria-label': label });
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7');
    svg.appendChild(path);
    b.appendChild(svg);
    return b;
  }

  function carousel(entries, options, root) {
    var stage = el('div', { class: 'sv-stage', 'aria-roledescription': 'carousel', 'aria-live': 'off' });
    var slides = entries.map(function (entry) {
      var s = el('div', { class: 'sv-slide', role: 'group', 'aria-roledescription': 'slide' }, [figure(entry)]);
      if (entry.background) {
        var itemBg = cssColor(entry.background);
        if (itemBg) s.style.background = itemBg;
      }
      stage.appendChild(s);
      return s;
    });
    var index = 0;
    var timer = null;
    var hoverPaused = false;
    var focusPaused = false;
    var nav = el('div', { class: 'sv-nav' });
    // `controls` (arrows, dots, swipe) belong to the carousel; `autoplay` is an option of it. The `single` type is autoplay without controls.
    var controls = options.controls !== false && slides.length > 1;
    var autoplay = options.autoplay !== false;
    var prev = arrowButton('prev', 'Edellinen');
    var next = arrowButton('next', 'Seuraava');
    var dots = [];

    function stop() { if (timer) { clearTimeout(timer); timer = null; } }
    function isPaused() { return hoverPaused || focusPaused; }

    // Clock: every visitor (and the admin "now playing" marker) derives the slide from the server clock and the
    // entries' seconds. Autoplay follows it until the visitor navigates by hand; after that the carousel drifts on its own timer.
    var ms = entries.map(function (e) { return Math.max(0, Number(e.seconds) || 0) * 1000; });
    var cycle = ms.reduce(function (a, b) { return a + b; }, 0);
    var onClock = autoplay && cycle > 0 && slides.length > 1;
    function clockPos() {
      var pos = (((Date.now() + (options.clockOffsetMs || 0)) % cycle) + cycle) % cycle;
      var start = 0;
      for (var i = 0; i < ms.length; i++) {
        if (ms[i] <= 0) continue;
        if (pos < start + ms[i]) return { index: i, remaining: start + ms[i] - pos };
        start += ms[i];
      }
      return { index: 0, remaining: 1000 };
    }
    function sync() {
      var c = clockPos();
      show(c.index, c.index === index, c.remaining);
    }
    function go(i) { onClock = false; show(i, false); }

    function show(i, keepTime, remaining) {
      stop();
      index = (i + slides.length) % slides.length;
      if (options.fitContent) fitStage(stage, slides[index], entries[index]);
      slides.forEach(function (s, n) {
        s.classList.toggle('is-on', n === index);
        var v = s.querySelector('video');
        if (v) {
          v.loop = onClock || !autoplay || slides.length < 2;
          if (n === index) {
            if (!keepTime) v.currentTime = 0;
            v.play().catch(function () {});
          } else {
            v.pause();
          }
        }
      });
      if (slides.length > 1) {
        var nextEntry = entries[(index + 1) % entries.length];
        if (nextEntry && nextEntry.url && nextEntry.kind === 'image' && !nextEntry._aspect) {
          if (nextEntry.width && nextEntry.height) {
            nextEntry._aspect = nextEntry.width + ' / ' + nextEntry.height;
          } else {
            var nImg = new Image();
            if (nextEntry.srcset) {
              nImg.srcset = nextEntry.srcset;
              if (nextEntry.sizes) nImg.sizes = nextEntry.sizes;
            }
            nImg.onload = function () {
              if (nImg.naturalWidth > 0 && nImg.naturalHeight > 0) nextEntry._aspect = nImg.naturalWidth + ' / ' + nImg.naturalHeight;
            };
            nImg.src = nextEntry.url;
          }
        }
      }
      dots.forEach(function (d, n) { d.classList.toggle('is-on', n === index); d.setAttribute('aria-current', n === index ? 'true' : 'false'); });
      var entry = entries[index];
      if (autoplay && !isPaused() && !reduced() && slides.length > 1) {
        if (onClock) {
          timer = setTimeout(sync, (remaining == null ? clockPos().remaining : remaining) + 30);
        } else if (entry.kind !== 'video') {
          timer = setTimeout(function () { show(index + 1, false); }, Math.max(1, entry.seconds || 10) * 1000);
        }
      }
    }
    function resume() { if (onClock) sync(); else show(index, true); }

    prev.addEventListener('click', function () { go(index - 1); });
    next.addEventListener('click', function () { go(index + 1); });
    if (controls) {
      stage.appendChild(prev);
      stage.appendChild(next);
      if (options.dots) {
        entries.forEach(function (_e, n) {
          var d = el('button', { type: 'button', class: 'sv-dot', 'aria-label': String(n + 1) });
          d.addEventListener('click', function () { go(n); });
          dots.push(d);
          nav.appendChild(d);
        });
      }
    }

    stage.addEventListener('mouseenter', function () { hoverPaused = true; stop(); });
    stage.addEventListener('mouseleave', function () { hoverPaused = false; if (!isPaused()) resume(); });
    stage.addEventListener('focusin', function () { focusPaused = true; stop(); });
    stage.addEventListener('focusout', function () { focusPaused = false; if (!isPaused()) resume(); });
    var startX = null;
    stage.addEventListener('pointerdown', function (ev) { startX = ev.clientX; });
    stage.addEventListener('pointercancel', function () { startX = null; });
    stage.addEventListener('pointerup', function (ev) {
      if (startX === null || !controls) return;
      var dx = ev.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
    });

    root.appendChild(stage);
    if (dots.length) root.appendChild(nav);
    slides.forEach(function (s, n) {
      var v = s.querySelector('video');
      if (!v) return;
      v.addEventListener('ended', function () { if (!onClock && autoplay && n === index && slides.length > 1) show(index + 1, false); });
    });
    if (onClock) sync(); else show(0, false);
  }

  /** Preloads all image entries so slide transitions and fit-to-content resizing are instant. */
  function preloadEntries(entries) {
    if (!entries || !entries.length) return;
    entries.forEach(function (e) {
      if (!e || !e.url) return;
      if (e.width && e.height && !e._aspect) {
        e._aspect = e.width + ' / ' + e.height;
      }
      if (e.kind === 'image') {
        var img = new Image();
        if (e.srcset) {
          img.srcset = e.srcset;
          if (e.sizes) img.sizes = e.sizes;
        }
        img.onload = function () {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            e._aspect = img.naturalWidth + ' / ' + img.naturalHeight;
          }
        };
        img.src = e.url;
      }
    });
  }

  /** Fit to content: sizes the stage to the natural ratio of the slide's media, now and once it has loaded. */
  function fitStage(stage, slide, entry) {
    var m = slide.querySelector('img, video');
    if (!m) return;
    function apply() {
      var w = m.naturalWidth || m.videoWidth;
      var h = m.naturalHeight || m.videoHeight;
      if (w > 0 && h > 0) {
        if (entry) entry._aspect = w + ' / ' + h;
        if (slide.classList.contains('is-on')) stage.style.setProperty('--sv-aspect', w + ' / ' + h);
      }
    }
    if (entry && entry._aspect && slide.classList.contains('is-on')) {
      stage.style.setProperty('--sv-aspect', entry._aspect);
    }
    apply();
    if (!m.getAttribute('data-sv-fit')) {
      m.setAttribute('data-sv-fit', '1');
      m.addEventListener(m.tagName === 'VIDEO' ? 'loadedmetadata' : 'load', apply);
    }
  }

  function gallery(entries, root) {
    var grid = el('div', { class: 'sv-grid' });
    entries.forEach(function (entry) {
      var fig = figure(entry);
      if (entry.background) {
        var itemBg = cssColor(entry.background);
        if (itemBg) fig.style.background = itemBg;
      }
      grid.appendChild(fig);
    });
    root.appendChild(grid);
  }

  /** Renders `playlist` (the view's JSON) into `root` (an element or a shadow root). */
  /** Host-page settings (from data-sissi-* attributes or frame URL parameters). Anything that is not a plain CSS length or colour is ignored. */
  function cssLength(v) {
    var s = String(v == null ? '' : v).trim();
    if (/^\d+(\.\d+)?$/.test(s)) return s + 'px';
    return /^\d+(\.\d+)?(px|rem|em|%|vw|vh|ch)$/.test(s) ? s : null;
  }
  function cssColor(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || s.length > 64) return null;
    return (window.CSS && CSS.supports && CSS.supports('color', s)) ? s : null;
  }

  function render(root, playlist, embed, ext) {
    while (root.firstChild) root.removeChild(root.firstChild);
    var cfg = embed || {};
    var options = Object.assign({}, cfg.options || {}, { clockOffsetMs: (ext && ext.clockOffsetMs) || 0 });
    var host = root.host || root;
    var entries = (playlist.entries || []).filter(function (e) { return e && e.url; });
    // Nothing live: render nothing at all (no box, no text) so the host page shows no gap.
    if (!entries.length) {
      host.style.display = 'none';
      notifyEmpty(true);
      return;
    }
    host.style.display = '';
    preloadEntries(entries);
    var w = cssLength(ext && ext.width);
    if (w) host.style.width = w;
    var h = cssLength(ext && ext.height);
    if (h) host.style.height = h;
    var minW = cssLength(ext && ext.minWidth);
    if (minW) host.style.minWidth = minW;
    var maxW = cssLength(ext && ext.maxWidth);
    if (maxW) host.style.maxWidth = maxW;
    var minH = cssLength(ext && ext.minHeight);
    if (minH) host.style.minHeight = minH;
    var maxH = cssLength(ext && ext.maxHeight);
    if (maxH) host.style.maxHeight = maxH;
    notifyEmpty(false);
    var style = el('style');
    style.textContent = STYLE;
    root.appendChild(style);
    var wrap = el('div', { class: 'sissi-view', 'data-type': cfg.type || 'carousel' });
    wrap.style.setProperty('--sv-aspect', String(options.aspect || '16:9').replace(':', ' / '));
    wrap.style.setProperty('--sv-fit', options.fit === 'cover' ? 'cover' : 'contain');
    if (options.fitContent) wrap.classList.add('is-fit');
    var bg = cssColor(ext && ext.background) || cssColor(playlist && playlist.background);
    if (bg) wrap.style.setProperty('--sv-bg', bg);
    root.appendChild(wrap);
    if (cfg.type === 'gallery') gallery(entries, wrap);
    else if (cfg.type === 'single') carousel(entries, Object.assign({}, options, { controls: false, autoplay: true }), wrap);
    else carousel(entries, options, wrap);
  }

  /** Inside an iframe, tell the host page whether there is anything to show, so it can hide the empty frame. */
  function notifyEmpty(empty) {
    if (window.parent === window) return;
    try { window.parent.postMessage({ sissi: 'empty', empty: empty }, '*'); } catch (e) { /* ignore */ }
  }

  /** Fetches the playlist from `url` and renders it; re-checks every `intervalMs`. Returns a stop function. */
  /** Martti (the parish font) is served by Sissi. @font-face has to live in the host document: it is ignored inside a shadow root. */
  function loadFont(playlistUrl) {
    if (document.getElementById('sissi-martti-font')) return;
    try {
      var base = new URL('../fonts/', new URL(playlistUrl, location.href));
      var css = [['Martti-Regular.ttf', 400], ['Martti-Bold.ttf', 700]].map(function (f) {
        return '@font-face { font-family: "Martti Sissi"; font-weight: ' + f[1] + '; font-display: swap; src: url("' + new URL(f[0], base).href + '") format("truetype"); }';
      }).join('\n');
      var style = document.createElement('style');
      style.id = 'sissi-martti-font';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch (e) { /* fall back to the system font */ }
  }

  function mount(root, opts) {
    loadFont(opts.playlistUrl);
    if (TIMERS && TIMERS.has(root)) {
      TIMERS.get(root)();
    }
    var last = null;
    var stopped = false;
    var changeTimer = null;
    // Re-check right when a scheduled entry goes live or expires, not only on the regular interval.
    function scheduleChange(iso) {
      if (changeTimer) { clearTimeout(changeTimer); changeTimer = null; }
      var at = iso ? Date.parse(iso) : NaN;
      if (isNaN(at)) return;
      var wait = at - Date.now() + 500;
      if (wait < 500 || wait > 2147483000) return;
      changeTimer = setTimeout(load, wait);
    }
    function load() {
      return fetch(opts.playlistUrl, { cache: 'no-cache', credentials: 'omit' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          // Server clock (Date header, exposed by CORS) so every visitor shows the same slide as the screens do.
          var serverNow = Date.parse(r.headers.get('date') || '');
          if (!isNaN(serverNow)) opts.clockOffsetMs = serverNow - Date.now();
          return r.text();
        })
        .then(function (body) {
          if (stopped) return;
          var parsed = JSON.parse(body);
          // Entry URLs are root-relative (/sissi/media/...). On a host page that would resolve against the
          // host's origin, so resolve them (and their srcset/variants) against the playlist URL (Sissi's origin) instead.
          try {
            var base = new URL(opts.playlistUrl, location.href);
            (parsed.entries || []).forEach(function (e) {
              if (!e) return;
              if (e.url) e.url = new URL(e.url, base).href;
              if (e.srcset) {
                e.srcset = e.srcset.split(',').map(function (part) {
                  var trimmed = part.trim();
                  var space = trimmed.lastIndexOf(' ');
                  if (space === -1) return new URL(trimmed, base).href;
                  var u = trimmed.slice(0, space);
                  var desc = trimmed.slice(space);
                  return new URL(u, base).href + desc;
                }).join(', ');
              }
              if (Array.isArray(e.variants)) {
                e.variants.forEach(function (v) {
                  if (v && v.url) v.url = new URL(v.url, base).href;
                });
              }
            });
          } catch (e) { /* keep URLs as served */ }
          scheduleChange(parsed.nextChangeAt);
          if (body === last) return;
          last = body;
          render(root, parsed, parsed.embed || opts.embed, opts);
        })
        .catch(function () { /* keep the last good content */ });
    }
    load();
    var timer = setInterval(load, opts.intervalMs || 60000);
    function stop() {
      stopped = true;
      clearInterval(timer);
      if (changeTimer) clearTimeout(changeTimer);
      if (TIMERS && TIMERS.get(root) === stop) TIMERS.delete(root);
    }
    if (TIMERS) TIMERS.set(root, stop);
    return stop;
  }

  window.SissiViews = { render: render, mount: mount, STYLE: STYLE };
})();
