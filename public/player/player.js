(() => {
  const stage = document.getElementById('stage');
  const pathParts = window.location.pathname.replace(/\/+$/, '').split('/');
  const screenId = pathParts[pathParts.length - 1] || '';
  const playlistUrl = `${encodeURIComponent(screenId)}/playlist.json`;
  const storageKey = `sissi:playlist:${screenId}`;

  const rawPoll = Number(new URLSearchParams(window.location.search).get('pollMs'));
  const pollMs = Number.isFinite(rawPoll) && rawPoll >= 50 ? rawPoll : 60000;

  let activePlaylist = null;
  let pendingPlaylist = null;
  let currentIndex = -1;
  let currentEntry = null;
  let currentSlideEl = null;
  let slideTimer = null;
  let retryTimer = null;
  let pollTimer = null;
  let lastErrorPollAt = 0;
  let consecutiveFailures = 0;
  let preloaded = null;
  let transitionToken = 0;
  // Server clock minus local clock (ms), from the last live playlist fetch. Shared playback
  // position = (Date.now() + clockOffsetMs) mod cycle, so all screens show the same item.
  let clockOffsetMs = 0;
  // Newest server time accepted. A playlist served from the service-worker cache while offline
  // carries an old serverTime; it must not move the offset, or the schedule freezes.
  let lastServerTime = -Infinity;
  // True while the current slot is set by the shared schedule. A video that ends early then
  // holds its last frame until the slot ends, so every screen still switches together.
  let slotIsScheduled = false;

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }

  function syncPlaylistWithSw(entries) {
    if (!('serviceWorker' in navigator)) return;
    const msg = { type: 'SYNC_PLAYLIST', screenId, entries };
    const ctrl = navigator.serviceWorker.controller;
    if (ctrl) {
      ctrl.postMessage(msg);
    } else {
      navigator.serviceWorker.ready
        .then((reg) => {
          reg.active?.postMessage(msg);
        })
        .catch(() => {});
    }
  }

  function loadStoredPlaylist() {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries)) return parsed;
    } catch {
      // Ignore storage errors
    }
    return null;
  }

  function saveStoredPlaylist(playlist) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(playlist));
    } catch {
      // Ignore storage errors
    }
  }

  function clearSlideTimer() {
    if (slideTimer !== null) {
      clearTimeout(slideTimer);
      slideTimer = null;
    }
  }

  function clearRetryTimer() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function destroySlideElement(slideEl) {
    if (!slideEl) return;
    const video = slideEl.querySelector('video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    slideEl.remove();
  }

  function fadeOutToBlack() {
    clearSlideTimer();
    currentEntry = null;
    if (!currentSlideEl) return;
    const oldEl = currentSlideEl;
    currentSlideEl = null;
    oldEl.classList.remove('is-visible');
    setTimeout(() => destroySlideElement(oldEl), 550);
  }

  function clearPreload() {
    if (!preloaded) return;
    if (preloaded.kind === 'video' && preloaded.el) {
      preloaded.el.pause();
      preloaded.el.removeAttribute('src');
      preloaded.el.load();
    }
    preloaded = null;
  }

  function getNextEntryForPreload() {
    if (pendingPlaylist && pendingPlaylist.version !== activePlaylist?.version) {
      return pendingPlaylist.entries[0] || null;
    }
    if (!activePlaylist || activePlaylist.entries.length <= 1) return null;
    return activePlaylist.entries[(currentIndex + 1) % activePlaylist.entries.length] || null;
  }

  function preloadNext() {
    const next = getNextEntryForPreload();
    if (!next) {
      clearPreload();
      return;
    }
    if (preloaded && preloaded.url === next.url && preloaded.kind === next.kind) {
      return;
    }
    clearPreload();
    if (next.kind === 'video') {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = next.url;
      video.load();
      preloaded = { url: next.url, kind: 'video', el: video };
    } else {
      const img = new Image();
      img.decoding = 'async';
      img.src = next.url;
      preloaded = { url: next.url, kind: 'image', el: img };
    }
  }

  function triggerErrorPoll() {
    const now = Date.now();
    if (now - lastErrorPollAt < 1000) return;
    lastErrorPollAt = now;
    fetchPlaylist();
  }

  function onSlideComplete() {
    clearSlideTimer();
    consecutiveFailures = 0;
    advance();
  }

  function onSlideError() {
    clearSlideTimer();
    triggerErrorPoll();
    consecutiveFailures += 1;
    const total = activePlaylist?.entries?.length || 0;
    if (total === 0 || consecutiveFailures >= total) {
      fadeOutToBlack();
      clearRetryTimer();
      retryTimer = setTimeout(() => {
        consecutiveFailures = 0;
        advance();
      }, Math.min(pollMs, 2000));
      return;
    }
    advance();
  }

  function crossFadeTo(newSlideEl) {
    const oldEl = currentSlideEl;
    currentSlideEl = newSlideEl;
    stage.appendChild(newSlideEl);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (currentSlideEl === newSlideEl) {
          newSlideEl.classList.add('is-visible');
        }
      });
    });
    if (oldEl) {
      oldEl.classList.remove('is-visible');
      setTimeout(() => destroySlideElement(oldEl), 550);
    }
  }

  function showEntry(entry) {
    clearSlideTimer();
    clearRetryTimer();

    // Single-entry steady state when version has not changed: avoid flicker/re-fade.
    if (
      currentSlideEl &&
      currentEntry &&
      currentEntry.entryId === entry.entryId &&
      currentEntry.url === entry.url &&
      (!pendingPlaylist || pendingPlaylist.version === activePlaylist?.version)
    ) {
      if (entry.kind === 'image') {
        slideTimer = setTimeout(onSlideComplete, entry.seconds * 1000);
        return;
      }
      const existingVideo = currentSlideEl.querySelector('video');
      if (existingVideo) {
        const rate = Number(entry.playbackRate) || 1.0;
        existingVideo.playbackRate = rate;
        existingVideo.defaultPlaybackRate = rate;
        existingVideo.currentTime = Number(entry.clipStart) || 0;
        slideTimer = setTimeout(onSlideComplete, (entry.playForSeconds ? entry.seconds : (entry.seconds + 5)) * 1000);
        existingVideo.play().catch((err) => {
          if (err?.name !== 'AbortError') onSlideError();
        });
        return;
      }
    }

    const token = ++transitionToken;
    currentEntry = entry;

    const slideEl = document.createElement('div');
    slideEl.className = 'slide';
    if (entry.background) {
      slideEl.style.setProperty('--entry-bg', entry.background);
    }

    if (entry.kind === 'video') {
      const video = document.createElement('video');
      video.className = 'slide-media';
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'auto';
      const rate = Number(entry.playbackRate) || 1.0;
      video.playbackRate = rate;
      video.defaultPlaybackRate = rate;
      video.src = entry.url;

      const clipStart = Number(entry.clipStart) || 0;
      const clipEnd = entry.clipEnd != null ? Number(entry.clipEnd) : null;
      if (clipStart > 0) {
        video.currentTime = clipStart;
      }

      let settled = false;
      let loopsDone = 0;
      const playCount = entry.playForSeconds ? null : Math.max(1, Number(entry.playCount) || 1);

      const done = () => {
        if (settled || token !== transitionToken) return;
        settled = true;
        if (slotIsScheduled) return; // the schedule timer ends the slot
        onSlideComplete();
      };
      const fail = () => {
        if (settled || token !== transitionToken) return;
        settled = true;
        onSlideError();
      };

      const loopOrDone = () => {
        if (settled || token !== transitionToken) return;
        loopsDone += 1;
        if (entry.playForSeconds) {
          // Play for X seconds: loop continuously until slotTimer / schedule timer ends slot
          video.currentTime = clipStart;
          video.play().catch(() => {});
          return;
        }
        if (loopsDone < playCount) {
          video.currentTime = clipStart;
          video.play().catch(() => {});
          return;
        }
        done();
      };

      video.addEventListener('ended', loopOrDone);
      video.addEventListener('error', fail, { once: true });

      if (clipEnd !== null) {
        const onTimeUpdate = () => {
          if (video.currentTime >= clipEnd) {
            loopOrDone();
          }
        };
        video.addEventListener('timeupdate', onTimeUpdate);
      }

      slideEl.appendChild(video);
      crossFadeTo(slideEl);

      slideTimer = setTimeout(done, (entry.playForSeconds ? entry.seconds : (entry.seconds + 5)) * 1000);
      video.play().catch((err) => {
        if (err?.name !== 'AbortError') fail();
      });
      return;
    }

    const img = document.createElement('img');
    img.className = 'slide-media';
    img.alt = '';
    img.decoding = 'async';

    let settled = false;
    const onLoad = () => {
      if (settled || token !== transitionToken) return;
      settled = true;
      crossFadeTo(slideEl);
      slideTimer = setTimeout(onSlideComplete, entry.seconds * 1000);
    };
    const onError = () => {
      if (settled || token !== transitionToken) return;
      settled = true;
      onSlideError();
    };

    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
    img.src = entry.url;
    slideEl.appendChild(img);

    if (img.complete) {
      if (img.naturalWidth > 0) onLoad();
      else onError();
    }
  }

  /** Entry and time left in its slot at the shared position, or null when nothing plays. */
  function scheduledPosition(entries) {
    let total = 0;
    for (const e of entries) total += Math.max(0, Number(e.seconds) || 0) * 1000;
    if (total <= 0) return null;
    const pos = (((Date.now() + clockOffsetMs) % total) + total) % total;
    let start = 0;
    for (let i = 0; i < entries.length; i += 1) {
      const len = Math.max(0, Number(entries[i].seconds) || 0) * 1000;
      if (len <= 0) continue;
      if (pos < start + len) return { index: i, remainingMs: start + len - pos };
      start += len;
    }
    return null;
  }

  function advance() {
    if (pendingPlaylist) {
      activePlaylist = pendingPlaylist;
      pendingPlaylist = null;
      currentIndex = -1;
      consecutiveFailures = 0;
    }

    if (!activePlaylist || activePlaylist.entries.length === 0) {
      fadeOutToBlack();
      clearPreload();
      return;
    }

    // After a failed slide, step to the next entry instead of retrying the scheduled one.
    // The next successful slide re-enters the shared schedule (consecutiveFailures resets there).
    const sched = consecutiveFailures === 0 ? scheduledPosition(activePlaylist.entries) : null;
    if (sched) {
      currentIndex = sched.index;
      slotIsScheduled = true;
      showEntry(activePlaylist.entries[currentIndex]);
      // Switch exactly when the shared slot ends, not after a fixed per-device timer.
      clearSlideTimer();
      slideTimer = setTimeout(onSlideComplete, Math.max(50, sched.remainingMs));
      preloadNext();
      return;
    }

    slotIsScheduled = false;
    currentIndex = (currentIndex + 1) % activePlaylist.entries.length;
    const entry = activePlaylist.entries[currentIndex];
    showEntry(entry);
    preloadNext();
  }

  function applyFetchedPlaylist(data) {
    saveStoredPlaylist(data);
    syncPlaylistWithSw(data.entries);
    if (data.background) {
      document.documentElement.style.setProperty('--screen-bg', data.background);
    }

    if (!activePlaylist || activePlaylist.entries.length === 0) {
      activePlaylist = data;
      pendingPlaylist = null;
      currentIndex = -1;
      consecutiveFailures = 0;
      if (data.entries.length > 0) {
        advance();
      } else {
        fadeOutToBlack();
      }
      return;
    }

    if (data.version !== activePlaylist.version) {
      pendingPlaylist = data;
      preloadNext();
    }
  }

  async function fetchPlaylist() {
    if (!screenId) return;
    try {
      const res = await fetch(playlistUrl, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.entries)) {
          if (Number.isFinite(data.serverTime) && data.serverTime > lastServerTime) {
            lastServerTime = data.serverTime;
            clockOffsetMs = data.serverTime - Date.now();
          }
          applyFetchedPlaylist(data);
          return;
        }
      } else if (res.status === 404) {
        if (!activePlaylist) fadeOutToBlack();
        else if (activePlaylist.entries.length > 0) {
          pendingPlaylist = { screenId, version: -1, entries: [] };
        }
        return;
      }
    } catch {
      // Network error: keep current playlist or fall back to localStorage
    }

    if (!activePlaylist) {
      const stored = loadStoredPlaylist();
      if (stored && stored.entries.length > 0) {
        activePlaylist = stored;
        currentIndex = -1;
        advance();
      }
    }
  }

  function startPolling() {
    fetchPlaylist();
    pollTimer = setInterval(fetchPlaylist, pollMs);
  }

  registerServiceWorker();
  startPolling();

  window.addEventListener('beforeunload', () => {
    clearSlideTimer();
    clearRetryTimer();
    if (pollTimer !== null) clearInterval(pollTimer);
  });
})();
