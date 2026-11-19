(function (root) {
  'use strict';

  var Config = root.SiSSiConfig;
  var Orientation = root.SiSSiOrientation;
  var Storage = root.SiSSiStorage;
  var Remote = root.SiSSiRemote;
  var Player = root.SiSSiPlayer;

  var stageEl = document.getElementById('stage');
  var overlayEl = document.getElementById('setup-overlay');
  var serverUrlInput = document.getElementById('cfg-server-url');
  var screenIdInput = document.getElementById('cfg-screen-id');
  var rotationSelect = document.getElementById('cfg-rotation-mode');
  var statusEl = document.getElementById('cfg-status');
  var saveBtn = document.getElementById('cfg-save');
  var clearCacheBtn = document.getElementById('cfg-clear-cache');
  var closeBtn = document.getElementById('cfg-close');

  var currentConfig = Config.loadConfig();
  var currentPlaylistOrientation = 'landscape';

  var rawPoll = Number(new URLSearchParams(window.location.search).get('pollMs'));
  var pollMs = isFinite(rawPoll) && rawPoll >= 50 ? rawPoll : 60000;

  function keepAwake() {
    try {
      if (
        window.webapis &&
        window.webapis.appcommon &&
        typeof window.webapis.appcommon.setScreenSaver === 'function'
      ) {
        var stateEnum = window.webapis.appcommon.AppCommonScreenSaverState;
        var offVal = stateEnum && typeof stateEnum.SCREEN_SAVER_OFF !== 'undefined' ? stateEnum.SCREEN_SAVER_OFF : 0;
        window.webapis.appcommon.setScreenSaver(
          offVal,
          function () {},
          function () {}
        );
      }
    } catch (e) {
      // Ignore on non-Tizen runtimes
    }

    try {
      if (window.tizen && window.tizen.power && typeof window.tizen.power.request === 'function') {
        window.tizen.power.request('SCREEN', 'SCREEN_NORMAL');
      }
    } catch (e) {
      // Ignore on non-Tizen runtimes
    }
  }

  function applyCurrentOrientation() {
    Orientation.applyOrientation([stageEl, overlayEl], currentConfig.rotationMode, currentPlaylistOrientation, window);
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    if (isError) {
      statusEl.classList.add('is-error');
    } else {
      statusEl.classList.remove('is-error');
    }
  }

  function isOverlayOpen() {
    return Boolean(overlayEl && !overlayEl.classList.contains('is-hidden'));
  }

  function openOverlay() {
    if (!overlayEl) return;
    serverUrlInput.value = currentConfig.serverUrl || '';
    screenIdInput.value = currentConfig.screenId || '';
    rotationSelect.value = currentConfig.rotationMode || 'auto';
    setStatus('', false);
    overlayEl.classList.remove('is-hidden');
    document.body.classList.add('overlay-open');
    remote.focusFirst();
  }

  function closeOverlay() {
    if (!overlayEl) return;
    if (!Config.isConfigValid(currentConfig)) {
      setStatus('Please configure a valid Server URL and Screen ID first.', true);
      return;
    }
    overlayEl.classList.add('is-hidden');
    document.body.classList.remove('overlay-open');
  }

  function toggleOverlay() {
    if (isOverlayOpen()) {
      closeOverlay();
    } else {
      openOverlay();
    }
  }

  function exitApp() {
    try {
      if (window.tizen && window.tizen.application && typeof window.tizen.application.getCurrentApplication === 'function') {
        window.tizen.application.getCurrentApplication().exit();
      }
    } catch (e) {
      // Ignore on desktop browsers
    }
  }

  var mediaCache = Storage.createMediaCache(window);

  var player = Player.createPlayer({
    stageEl: stageEl,
    mediaCache: mediaCache,
    pollMs: pollMs,
    getConfig: function () {
      return currentConfig;
    },
    onOrientationChange: function (orientation) {
      currentPlaylistOrientation = orientation || 'landscape';
      applyCurrentOrientation();
    },
  });

  var remote = Remote.createRemoteController({
    win: window,
    overlayEl: overlayEl,
    isOverlayOpen: isOverlayOpen,
    onToggleOverlay: toggleOverlay,
    onCloseOverlay: closeOverlay,
    onExit: exitApp,
  });

  saveBtn.addEventListener('click', function () {
    var next = Config.normalizeConfig({
      serverUrl: serverUrlInput.value,
      screenId: screenIdInput.value,
      rotationMode: rotationSelect.value,
    });
    if (!next.serverUrl) {
      setStatus('Invalid Server URL (must start with http:// or https://).', true);
      serverUrlInput.focus();
      return;
    }
    if (!Config.isValidScreenId(next.screenId)) {
      setStatus('Invalid Screen ID (1-40 lowercase letters, digits, or hyphens).', true);
      screenIdInput.focus();
      return;
    }
    currentConfig = Config.saveConfig(next);
    applyCurrentOrientation();
    closeOverlay();
    player.restart();
  });

  clearCacheBtn.addEventListener('click', function () {
    mediaCache.clear().then(function () {
      try {
        if (currentConfig.screenId) {
          window.localStorage.removeItem(Config.playlistStorageKey(currentConfig.screenId));
        }
      } catch (e) {
        // Ignore
      }
      setStatus('Media cache cleared.', false);
    });
  });

  closeBtn.addEventListener('click', function () {
    closeOverlay();
  });

  window.addEventListener('resize', applyCurrentOrientation);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) keepAwake();
  });
  window.addEventListener('beforeunload', function () {
    player.stop();
    remote.destroy();
  });

  Remote.registerRemoteKeys(window.tizen);
  keepAwake();
  applyCurrentOrientation();

  if (Config.isConfigValid(currentConfig)) {
    player.start();
  } else {
    openOverlay();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
