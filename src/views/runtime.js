/* Sissi view runtime: renders a view's playlist (carousel, single, gallery) into an element or shadow root.
 * Classic script (no imports) so it can be inlined into the frame page and into embed.js.
 * Builds the DOM with createElement and textContent only: entry text is never parsed as HTML. */
(function () {
  'use strict';
  var STYLE = [
    ':host, .sissi-view { display: block; position: relative; width: 100%; font-family: system-ui, sans-serif; color: #111; }',
    '.sissi-view .sv-stage { position: relative; width: 100%; overflow: hidden; background: #f3f3f3; }',
    '.sissi-view .sv-slide { position: absolute; inset: 0; display: none; }',
    '.sissi-view .sv-slide.is-on { display: block; }',
    '.sissi-view figure { margin: 0; height: 100%; display: flex; flex-direction: column; }',
    '.sissi-view .sv-media { position: relative; flex: 1 1 auto; min-height: 0; }',
    '.sissi-view .sv-media img, .sissi-view .sv-media video { width: 100%; height: 100%; display: block; }',
    '.sissi-view .sv-headline { position: absolute; left: 0; right: 0; bottom: 12%; padding: .4em .8em; color: #fff; background: rgba(0,0,0,.45); font-size: clamp(1rem, 3.2vw, 2.4rem); font-weight: 700; text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,.6); }',
    '.sissi-view .sv-caption { margin: 0; padding: .5em .8em; font-size: clamp(.85rem, 1.8vw, 1.2rem); }',
    '.sissi-view a { color: inherit; text-decoration: none; }',
    '.sissi-view .sv-nav { display: flex; align-items: center; justify-content: center; gap: .5em; padding: .4em; }',
    '.sissi-view .sv-nav button { font: inherit; min-width: 2.4em; min-height: 2.4em; border: 1px solid #888; background: #fff; border-radius: 4px; cursor: pointer; }',
    '.sissi-view .sv-dot { width: .7em; height: .7em; border-radius: 50%; border: 1px solid #555; background: #fff; padding: 0; }',
    '.sissi-view .sv-dot.is-on { background: #222; }',
    '.sissi-view .sv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: .6em; padding: .6em; }',
    '.sissi-view .sv-grid figure { height: auto; }',
    '.sissi-view .sv-grid .sv-media { aspect-ratio: 16 / 9; }',
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
    var paused = false;
    var nav = el('div', { class: 'sv-nav' });
    var prev = el('button', { type: 'button', 'aria-label': 'Edellinen' });
    prev.textContent = '‹';
    var next = el('button', { type: 'button', 'aria-label': 'Seuraava' });
    next.textContent = '›';
    var dots = [];

    function stop() { if (timer) { clearTimeout(timer); timer = null; } }

    function show(i) {
      stop();
      index = (i + slides.length) % slides.length;
      slides.forEach(function (s, n) {
        s.classList.toggle('is-on', n === index);
        var v = s.querySelector('video');
        if (v) { if (n === index) { v.currentTime = 0; v.play().catch(function () {}); } else { v.pause(); } }
      });
      dots.forEach(function (d, n) { d.classList.toggle('is-on', n === index); d.setAttribute('aria-current', n === index ? 'true' : 'false'); });
      var entry = entries[index];
      if (!paused && !reduced() && slides.length > 1 && entry.kind !== 'video') {
        timer = setTimeout(function () { show(index + 1); }, Math.max(1, entry.seconds || 10) * 1000);
      }
    }

    prev.addEventListener('click', function () { show(index - 1); });
    next.addEventListener('click', function () { show(index + 1); });
    nav.appendChild(prev);
    if (options.dots && slides.length > 1) {
      entries.forEach(function (_e, n) {
        var d = el('button', { type: 'button', class: 'sv-dot', 'aria-label': String(n + 1) });
        d.addEventListener('click', function () { show(n); });
        dots.push(d);
        nav.appendChild(d);
      });
    }
    nav.appendChild(next);

    stage.addEventListener('mouseenter', function () { paused = true; stop(); });
    stage.addEventListener('mouseleave', function () { paused = false; show(index); });
    stage.addEventListener('focusin', function () { paused = true; stop(); });
    stage.addEventListener('focusout', function () { paused = false; show(index); });
    stage.addEventListener('pointerdown', function (ev) { startX = ev.clientX; });
    var startX = null;
    stage.addEventListener('pointerup', function (ev) {
      if (startX === null) return;
      var dx = ev.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
    });

    root.appendChild(stage);
    if (slides.length > 1) root.appendChild(nav);
    show(0);
    if (entries[0] && entries[0].kind === 'video' && slides.length > 1) {
      // Videos advance when they end, not on a timer.
      slides.forEach(function (s, n) {
        var v = s.querySelector('video');
        if (v) v.addEventListener('ended', function () { if (n === index) show(index + 1); });
      });
    }
  }

  function single(entries, root) {
    var stage = el('div', { class: 'sv-stage' });
    stage.appendChild(el('div', { class: 'sv-slide is-on' }, [figure(entries[0])]));
    root.appendChild(stage);
  }

  function gallery(entries, root) {
    var grid = el('div', { class: 'sv-grid' });
    entries.forEach(function (entry) { grid.appendChild(figure(entry)); });
    root.appendChild(grid);
  }

  /** Renders `playlist` (the view's JSON) into `root` (an element or a shadow root). */
  function render(root, playlist, embed) {
    while (root.firstChild) root.removeChild(root.firstChild);
    var style = el('style');
    style.textContent = STYLE;
    root.appendChild(style);
    var wrap = el('div', { class: 'sissi-view', 'data-type': embed.type || 'carousel' });
    root.appendChild(wrap);
    var entries = (playlist.entries || []).filter(function (e) { return e && e.url; });
    if (!entries.length) {
      wrap.appendChild(text('div', 'sv-empty', 'Ei sisältöä.'));
      return;
    }
    var options = embed.options || {};
    if (embed.type === 'gallery') gallery(entries, wrap);
    else if (embed.type === 'single') single(entries, wrap);
    else carousel(entries, options, wrap);
  }

  /** Fetches the playlist from `url` and renders it; re-checks every `intervalMs`. Returns a stop function. */
  function mount(root, opts) {
    var last = null;
    var stopped = false;
    function load() {
      return fetch(opts.playlistUrl, { cache: 'no-cache', credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (body) {
          if (body === last || stopped) return;
          last = body;
          render(root, JSON.parse(body), opts.embed);
        })
        .catch(function () { /* keep the last good content */ });
    }
    load();
    var timer = setInterval(load, opts.intervalMs || 60000);
    return function stop() { stopped = true; clearInterval(timer); };
  }

  window.SissiViews = { render: render, mount: mount, STYLE: STYLE };
})();
