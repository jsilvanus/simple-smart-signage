(function (root) {
  'use strict';

  function createPlayer(opts) {
    var stage = opts.stageEl;
    var mediaCache = opts.mediaCache;
    var getConfig = opts.getConfig;
    var onOrientationChange = opts.onOrientationChange || function () {};
    var Config = opts.Config || root.SiSSiConfig;
    var storage = opts.localStorage || window.localStorage;
    var pollMs = typeof opts.pollMs === 'number' && opts.pollMs >= 50 ? opts.pollMs : 60000;

    var activePlaylist = null;
    var pendingPlaylist = null;
    var currentIndex = -1;
    var currentEntry = null;
    var currentSlideEl = null;
    var slideTimer = null;
    var retryTimer = null;
    var pollTimer = null;
    var lastErrorPollAt = 0;
    var consecutiveFailures = 0;
    var preloaded = null;
    var transitionToken = 0;
    var running = false;

    function loadStoredPlaylist(screenId) {
      if (!storage || !screenId) return null;
      try {
        var raw = storage.getItem(Config.playlistStorageKey(screenId));
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries)) return parsed;
      } catch (e) {
        // Ignore storage errors
      }
      return null;
    }

    function saveStoredPlaylist(screenId, playlist) {
      if (!storage || !screenId) return;
      try {
        storage.setItem(Config.playlistStorageKey(screenId), JSON.stringify(playlist));
      } catch (e) {
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
      var video = slideEl.querySelector('video');
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      if (typeof slideEl._revokeMedia === 'function') {
        slideEl._revokeMedia();
        slideEl._revokeMedia = null;
      }
      if (slideEl.parentNode) {
        slideEl.parentNode.removeChild(slideEl);
      }
    }

    function fadeOutToBlack() {
      clearSlideTimer();
      currentEntry = null;
      if (!currentSlideEl) return;
      var oldEl = currentSlideEl;
      currentSlideEl = null;
      oldEl.classList.remove('is-visible');
      setTimeout(function () {
        destroySlideElement(oldEl);
      }, 550);
    }

    function clearPreload() {
      if (!preloaded) return;
      if (preloaded.kind === 'video' && preloaded.el) {
        preloaded.el.pause();
        preloaded.el.removeAttribute('src');
        preloaded.el.load();
      }
      if (typeof preloaded.revoke === 'function') {
        preloaded.revoke();
      }
      preloaded = null;
    }

    function getNextEntryForPreload() {
      if (pendingPlaylist && pendingPlaylist.version !== (activePlaylist && activePlaylist.version)) {
        return pendingPlaylist.entries[0] || null;
      }
      if (!activePlaylist || activePlaylist.entries.length <= 1) return null;
      return activePlaylist.entries[(currentIndex + 1) % activePlaylist.entries.length] || null;
    }

    function resolveNetworkUrl(entryUrl) {
      var cfg = getConfig();
      return Config.resolveMediaUrl(entryUrl, cfg.serverUrl);
    }

    function preloadNext() {
      var next = getNextEntryForPreload();
      if (!next) {
        clearPreload();
        return;
      }
      if (preloaded && preloaded.url === next.url && preloaded.kind === next.kind) {
        return;
      }
      clearPreload();
      var networkUrl = resolveNetworkUrl(next.url);
      mediaCache.resolveMediaUrl(next, networkUrl).then(function (resolved) {
        if (!running) {
          if (resolved.revoke) resolved.revoke();
          return;
        }
        var currentNext = getNextEntryForPreload();
        if (!currentNext || currentNext.url !== next.url) {
          if (resolved.revoke) resolved.revoke();
          return;
        }
        if (next.kind === 'video') {
          var video = document.createElement('video');
          video.preload = 'auto';
          video.muted = true;
          video.playsInline = true;
          video.src = resolved.src;
          video.load();
          preloaded = { url: next.url, kind: 'video', el: video, revoke: resolved.revoke };
        } else {
          var img = new Image();
          img.decoding = 'async';
          img.src = resolved.src;
          preloaded = { url: next.url, kind: 'image', el: img, revoke: resolved.revoke };
        }
      });
    }

    function triggerErrorPoll() {
      var now = Date.now();
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
      var total = activePlaylist && activePlaylist.entries ? activePlaylist.entries.length : 0;
      if (total === 0 || consecutiveFailures >= total) {
        fadeOutToBlack();
        clearRetryTimer();
        retryTimer = setTimeout(function () {
          consecutiveFailures = 0;
          advance();
        }, Math.min(pollMs, 2000));
        return;
      }
      advance();
    }

    function crossFadeTo(newSlideEl) {
      var oldEl = currentSlideEl;
      currentSlideEl = newSlideEl;
      stage.appendChild(newSlideEl);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (currentSlideEl === newSlideEl) {
            newSlideEl.classList.add('is-visible');
          }
        });
      });
      if (oldEl) {
        oldEl.classList.remove('is-visible');
        setTimeout(function () {
          destroySlideElement(oldEl);
        }, 550);
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
        (!pendingPlaylist || pendingPlaylist.version === (activePlaylist && activePlaylist.version))
      ) {
        if (entry.kind === 'image') {
          slideTimer = setTimeout(onSlideComplete, entry.seconds * 1000);
          return;
        }
        var existingVideo = currentSlideEl.querySelector('video');
        if (existingVideo) {
          existingVideo.currentTime = 0;
          slideTimer = setTimeout(onSlideComplete, (entry.seconds + 5) * 1000);
          existingVideo.play().catch(function (err) {
            if (!err || err.name !== 'AbortError') onSlideError();
          });
          return;
        }
      }

      var token = ++transitionToken;
      currentEntry = entry;
      var networkUrl = resolveNetworkUrl(entry.url);

      mediaCache.resolveMediaUrl(entry, networkUrl).then(function (resolved) {
        if (!running || token !== transitionToken) {
          if (resolved.revoke) resolved.revoke();
          return;
        }

        var slideEl = document.createElement('div');
        slideEl.className = 'slide';
        if (entry.background) {
          slideEl.style.setProperty('--entry-bg', entry.background);
        }
        slideEl._revokeMedia = resolved.revoke || null;

        if (entry.kind === 'video') {
          var video = document.createElement('video');
          video.className = 'slide-media';
          video.muted = true;
          video.autoplay = true;
          video.playsInline = true;
          video.preload = 'auto';
          video.src = resolved.src;

          var vSettled = false;
          var done = function () {
            if (vSettled || token !== transitionToken) return;
            vSettled = true;
            onSlideComplete();
          };
          var fail = function () {
            if (vSettled || token !== transitionToken) return;
            vSettled = true;
            destroySlideElement(slideEl);
            onSlideError();
          };

          video.addEventListener('ended', done, { once: true });
          video.addEventListener('error', fail, { once: true });

          slideEl.appendChild(video);
          crossFadeTo(slideEl);

          slideTimer = setTimeout(done, (entry.seconds + 5) * 1000);
          video.play().catch(function (err) {
            if (!err || err.name !== 'AbortError') fail();
          });
          return;
        }

        var img = document.createElement('img');
        img.className = 'slide-media';
        img.alt = '';
        img.decoding = 'async';

        var iSettled = false;
        var onLoad = function () {
          if (iSettled || token !== transitionToken) return;
          iSettled = true;
          crossFadeTo(slideEl);
          slideTimer = setTimeout(onSlideComplete, entry.seconds * 1000);
        };
        var onError = function () {
          if (iSettled || token !== transitionToken) return;
          iSettled = true;
          destroySlideElement(slideEl);
          onSlideError();
        };

        img.addEventListener('load', onLoad, { once: true });
        img.addEventListener('error', onError, { once: true });
        img.src = resolved.src;
        slideEl.appendChild(img);

        if (img.complete) {
          if (img.naturalWidth > 0) onLoad();
          else onError();
        }
      });
    }

    function advance() {
      if (!running) return;
      if (pendingPlaylist) {
        activePlaylist = pendingPlaylist;
        pendingPlaylist = null;
        currentIndex = -1;
        consecutiveFailures = 0;
        onOrientationChange(activePlaylist.orientation || 'landscape');
      }

      if (!activePlaylist || activePlaylist.entries.length === 0) {
        fadeOutToBlack();
        clearPreload();
        return;
      }

      currentIndex = (currentIndex + 1) % activePlaylist.entries.length;
      var entry = activePlaylist.entries[currentIndex];
      showEntry(entry);
      preloadNext();
    }

    function applyFetchedPlaylist(screenId, data) {
      saveStoredPlaylist(screenId, data);
      mediaCache.syncEntries(data.entries, resolveNetworkUrl);
      if (data.background) {
        document.documentElement.style.setProperty('--screen-bg', data.background);
      }

      if (!activePlaylist || activePlaylist.entries.length === 0) {
        activePlaylist = data;
        pendingPlaylist = null;
        currentIndex = -1;
        consecutiveFailures = 0;
        onOrientationChange(data.orientation || 'landscape');
        if (data.entries.length > 0) {
          advance();
        } else {
          fadeOutToBlack();
        }
        return;
      }

      if (data.version !== activePlaylist.version || data.orientation !== activePlaylist.orientation) {
        pendingPlaylist = data;
        preloadNext();
      }
    }

    function fetchPlaylist() {
      if (!running) return Promise.resolve();
      var cfg = getConfig();
      if (!Config.isConfigValid(cfg)) return Promise.resolve();
      var playlistUrl = Config.buildPlaylistUrl(cfg);

      return fetch(playlistUrl, { cache: 'no-store' })
        .then(function (res) {
          if (!running) return;
          if (res.ok) {
            return res.json().then(function (data) {
              if (!running) return;
              if (data && Array.isArray(data.entries)) {
                applyFetchedPlaylist(cfg.screenId, data);
              }
            });
          }
          if (res.status === 404) {
            if (!activePlaylist) {
              fadeOutToBlack();
            } else if (activePlaylist.entries.length > 0) {
              pendingPlaylist = { screenId: cfg.screenId, version: -1, orientation: 'landscape', entries: [] };
            }
          }
        })
        .catch(function () {
          // Network error: keep current playlist or fall back to localStorage
        })
        .then(function () {
          if (!running) return;
          if (!activePlaylist) {
            var stored = loadStoredPlaylist(cfg.screenId);
            if (stored && stored.entries.length > 0) {
              activePlaylist = stored;
              currentIndex = -1;
              onOrientationChange(stored.orientation || 'landscape');
              advance();
            }
          }
        });
    }

    function start() {
      if (running) return;
      running = true;
      fetchPlaylist();
      pollTimer = setInterval(fetchPlaylist, pollMs);
    }

    function stop() {
      running = false;
      ++transitionToken;
      clearSlideTimer();
      clearRetryTimer();
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      clearPreload();
      fadeOutToBlack();
      activePlaylist = null;
      pendingPlaylist = null;
      currentIndex = -1;
      consecutiveFailures = 0;
    }

    function restart() {
      stop();
      start();
    }

    return {
      start: start,
      stop: stop,
      restart: restart,
      getActivePlaylist: function () {
        return activePlaylist;
      },
    };
  }

  root.SiSSiPlayer = {
    createPlayer: createPlayer,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
