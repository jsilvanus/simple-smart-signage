/* Sissi view runtime: renders a view's playlist (carousel, single, gallery) into an element or shadow root.
 * Classic script (no imports) so it can be inlined into the frame page and into embed.js.
 * Builds the DOM with createElement and textContent only: entry text is never parsed as HTML. */
(function () {
  'use strict';
  var TIMERS = typeof WeakMap === 'function' ? new WeakMap() : null;
  var STYLE = [
    ':host, .sissi-view { display: block; position: relative; width: 100%; font-family: system-ui, sans-serif; color: #111; }',
    '.sissi-view .sv-stage { position: relative; width: 100%; aspect-ratio: var(--sv-aspect, 16 / 9); overflow: hidden; background: #f3f3f3; }',
    '.sissi-view .sv-slide { position: absolute; inset: 0; display: none; }',
    '.sissi-view .sv-slide.is-on { display: block; }',
    '.sissi-view figure { margin: 0; height: 100%; display: flex; flex-direction: column; }',
    '.sissi-view .sv-media { position: relative; flex: 1 1 auto; min-height: 0; }',
    '.sissi-view .sv-media img, .sissi-view .sv-media video { width: 100%; height: 100%; object-fit: var(--sv-fit, contain); display: block; }',
    '.sissi-view .sv-headline { position: absolute; left: 0; right: 0; bottom: 12%; padding: .4em .8em; color: #fff; background: rgba(0,0,0,.45); font-size: clamp(1rem, 3.2vw, 2.4rem); font-weight: 700; text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,.6); }',
    '.sissi-view .sv-caption { margin: 0; padding: .5em .8em; font-size: clamp(.85rem, 1.8vw, 1.2rem); }',
    '.sissi-view a { color: inherit; text-decoration: none; }',
    '.sissi-view .sv-nav { display: flex; align-items: center; justify-content: center; gap: .5em; padding: .4em; }',
    '.sissi-view .sv-nav button { font: inherit; min-width: 2.4em; min-height: 2.4em; border: 1px solid #888; background: #fff; border-radius: 4px; cursor: pointer; }',
    '.sissi-view .sv-nav button.sv-dot { width: .9em; height: .9em; min-width: .9em; min-height: .9em; border-radius: 50%; border: 1px solid #555; background: #fff; padding: 0; }',
    '.sissi-view .sv-nav button.sv-dot.is-on { background: #222; }',
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
      box.appendChild(el('img', { src: entry.url, alt: entry.alt || '', loading: 'lazy' }));
    }
    if (entry.headline) box.appendChild(text('div', 'sv-headline', entry.headline));
    return box;
  }

  function figure(entry) {
    var fig = el('figure', null, [media(entry), entry.caption ? text('p', 'sv-caption', entry.caption) : null]);
    if (entry.link) {
      var a = el('a', { href: entry.link, target: '_blank', rel: 'noopener noreferrer' }, [fig]);
      return a;
    }
    return fig;
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function carousel(entries, options, root) {
    var stage = el('div', { class: 'sv-stage', 'aria-roledescription': 'carousel', 'aria-live': 'off' });
    var slides = entries.map(function (entry) {
      var s = el('div', { class: 'sv-slide', role: 'group', 'aria-roledescription': 'slide' }, [figure(entry)]);
      stage.appendChild(s);
      return s;
    });
    var index = 0;
    var timer = null;
    var hoverPaused = false;
    var focusPaused = false;
    var nav = el('div', { class: 'sv-nav' });
    var prev = el('button', { type: 'button', 'aria-label': 'Edellinen' });
    prev.textContent = '‹';
    var next = el('button', { type: 'button', 'aria-label': 'Seuraava' });
    next.textContent = '›';
    var dots = [];

    function stop() { if (timer) { clearTimeout(timer); timer = null; } }
    function isPaused() { return hoverPaused || focusPaused; }

    function show(i, keepTime) {
      stop();
      index = (i + slides.length) % slides.length;
      slides.forEach(function (s, n) {
        s.classList.toggle('is-on', n === index);
        var v = s.querySelector('video');
        if (v) {
          if (n === index) {
            if (!keepTime) v.currentTime = 0;
            v.play().catch(function () {});
          } else {
            v.pause();
          }
        }
      });
      dots.forEach(function (d, n) { d.classList.toggle('is-on', n === index); d.setAttribute('aria-current', n === index ? 'true' : 'false'); });
      var entry = entries[index];
      if (!isPaused() && !reduced() && slides.length > 1 && entry.kind !== 'video') {
        timer = setTimeout(function () { show(index + 1, false); }, Math.max(1, entry.seconds || 10) * 1000);
      }
    }

    prev.addEventListener('click', function () { show(index - 1, false); });
    next.addEventListener('click', function () { show(index + 1, false); });
    nav.appendChild(prev);
    if (options.dots && slides.length > 1) {
      entries.forEach(function (_e, n) {
        var d = el('button', { type: 'button', class: 'sv-dot', 'aria-label': String(n + 1) });
        d.addEventListener('click', function () { show(n, false); });
        dots.push(d);
        nav.appendChild(d);
      });
    }
    nav.appendChild(next);

    stage.addEventListener('mouseenter', function () { hoverPaused = true; stop(); });
    stage.addEventListener('mouseleave', function () { hoverPaused = false; if (!isPaused()) show(index, true); });
    stage.addEventListener('focusin', function () { focusPaused = true; stop(); });
    stage.addEventListener('focusout', function () { focusPaused = false; if (!isPaused()) show(index, true); });
    var startX = null;
    stage.addEventListener('pointerdown', function (ev) { startX = ev.clientX; });
    stage.addEventListener('pointercancel', function () { startX = null; });
    stage.addEventListener('pointerup', function (ev) {
      if (startX === null) return;
      var dx = ev.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1), false);
    });

    root.appendChild(stage);
    if (slides.length > 1) root.appendChild(nav);
    slides.forEach(function (s, n) {
      var v = s.querySelector('video');
      if (v) v.addEventListener('ended', function () { if (n === index && slides.length > 1) show(index + 1, false); });
    });
    show(0, false);
  }

  function single(entries, root) {
    var stage = el('div', { class: 'sv-stage' });
    var slide = el('div', { class: 'sv-slide is-on' }, [figure(entries[0])]);
    stage.appendChild(slide);
    root.appendChild(stage);
    var v = slide.querySelector('video');
    if (v) { v.loop = true; v.play().catch(function () {}); }
  }

  function gallery(entries, root) {
    var grid = el('div', { class: 'sv-grid' });
    entries.forEach(function (entry) { grid.appendChild(figure(entry)); });
    root.appendChild(grid);
  }

  /** Renders `playlist` (the view's JSON) into `root` (an element or a shadow root). */
  function render(root, playlist, embed) {
    while (root.firstChild) root.removeChild(root.firstChild);
    var cfg = embed || {};
    var options = cfg.options || {};
    var host = root.host || root;
    var entries = (playlist.entries || []).filter(function (e) { return e && e.url; });
    // Nothing live: render nothing at all (no box, no text) so the host page shows no gap.
    if (!entries.length) {
      host.style.display = 'none';
      notifyEmpty(true);
      return;
    }
    host.style.display = '';
    notifyEmpty(false);
    var style = el('style');
    style.textContent = STYLE;
    root.appendChild(style);
    var wrap = el('div', { class: 'sissi-view', 'data-type': cfg.type || 'carousel' });
    wrap.style.setProperty('--sv-aspect', String(options.aspect || '16:9').replace(':', ' / '));
    wrap.style.setProperty('--sv-fit', options.fit === 'cover' ? 'cover' : 'contain');
    root.appendChild(wrap);
    if (cfg.type === 'gallery') gallery(entries, wrap);
    else if (cfg.type === 'single') single(entries, wrap);
    else carousel(entries, options, wrap);
  }

  /** Inside an iframe, tell the host page whether there is anything to show, so it can hide the empty frame. */
  function notifyEmpty(empty) {
    if (window.parent === window) return;
    try { window.parent.postMessage({ sissi: 'empty', empty: empty }, '*'); } catch (e) { /* ignore */ }
  }

  /** Fetches the playlist from `url` and renders it; re-checks every `intervalMs`. Returns a stop function. */
  function mount(root, opts) {
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
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (body) {
          if (stopped) return;
          var parsed = JSON.parse(body);
          scheduleChange(parsed.nextChangeAt);
          if (body === last) return;
          last = body;
          render(root, parsed, parsed.embed || opts.embed);
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
