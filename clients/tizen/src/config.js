(function (root) {
  'use strict';

  var CONFIG_STORAGE_KEY = 'sissi:tizen:config';
  var PLAYLIST_KEY_PREFIX = 'sissi:tizen:playlist:';
  var SCREEN_ID_RE = /^[a-z0-9-]{1,40}$/;
  var ROTATION_MODES = ['auto', 'native', 'cw90', 'ccw90'];

  function normalizeServerUrl(raw) {
    if (typeof raw !== 'string') return '';
    var trimmed = raw.trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    try {
      var parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
      }
      return trimmed;
    } catch (e) {
      return '';
    }
  }

  function isValidScreenId(raw) {
    if (typeof raw !== 'string') return false;
    return SCREEN_ID_RE.test(raw.trim());
  }

  function normalizeRotationMode(raw) {
    if (typeof raw === 'string' && ROTATION_MODES.indexOf(raw) !== -1) {
      return raw;
    }
    return 'auto';
  }

  function normalizeConfig(raw) {
    var obj = raw && typeof raw === 'object' ? raw : {};
    return {
      serverUrl: normalizeServerUrl(obj.serverUrl || ''),
      screenId: typeof obj.screenId === 'string' ? obj.screenId.trim() : '',
      rotationMode: normalizeRotationMode(obj.rotationMode),
    };
  }

  function isConfigValid(cfg) {
    if (!cfg || typeof cfg !== 'object') return false;
    return Boolean(normalizeServerUrl(cfg.serverUrl) && isValidScreenId(cfg.screenId));
  }

  function loadConfig(storage) {
    var store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return normalizeConfig({});
    try {
      var raw = store.getItem(CONFIG_STORAGE_KEY);
      if (!raw) return normalizeConfig({});
      return normalizeConfig(JSON.parse(raw));
    } catch (e) {
      return normalizeConfig({});
    }
  }

  function saveConfig(cfg, storage) {
    var store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    var normalized = normalizeConfig(cfg);
    if (store) {
      try {
        store.setItem(CONFIG_STORAGE_KEY, JSON.stringify(normalized));
      } catch (e) {
        // Ignore storage quota/security errors
      }
    }
    return normalized;
  }

  function playlistStorageKey(screenId) {
    return PLAYLIST_KEY_PREFIX + String(screenId || '');
  }

  function buildPlaylistUrl(cfg) {
    var base = normalizeServerUrl(cfg && cfg.serverUrl);
    var screenId = cfg && typeof cfg.screenId === 'string' ? cfg.screenId.trim() : '';
    if (!base || !isValidScreenId(screenId)) return '';
    return base + '/s/' + encodeURIComponent(screenId) + '/playlist.json';
  }

  function resolveMediaUrl(entryUrl, serverUrl) {
    if (typeof entryUrl !== 'string' || !entryUrl) return '';
    if (/^https?:\/\//i.test(entryUrl)) {
      return entryUrl;
    }
    var base = normalizeServerUrl(serverUrl);
    if (!base) return entryUrl;
    try {
      var parsedBase = new URL(base);
      if (entryUrl.charAt(0) === '/') {
        return parsedBase.origin + entryUrl;
      }
      return new URL(entryUrl, base + '/').href;
    } catch (e) {
      return entryUrl;
    }
  }

  root.SiSSiConfig = {
    CONFIG_STORAGE_KEY: CONFIG_STORAGE_KEY,
    PLAYLIST_KEY_PREFIX: PLAYLIST_KEY_PREFIX,
    SCREEN_ID_RE: SCREEN_ID_RE,
    ROTATION_MODES: ROTATION_MODES,
    normalizeServerUrl: normalizeServerUrl,
    isValidScreenId: isValidScreenId,
    normalizeRotationMode: normalizeRotationMode,
    normalizeConfig: normalizeConfig,
    isConfigValid: isConfigValid,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    playlistStorageKey: playlistStorageKey,
    buildPlaylistUrl: buildPlaylistUrl,
    resolveMediaUrl: resolveMediaUrl,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
