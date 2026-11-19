(function (root) {
  'use strict';

  var REMOTE_KEYS = ['ColorF0Red', 'ColorF3Blue', 'Info', 'Menu'];

  var DEFAULT_KEY_CODES = {
    Return: 10009,
    Exit: 10182,
    Info: 457,
    Menu: 10133,
    ColorF0Red: 403,
    ColorF3Blue: 406,
  };

  function registerRemoteKeys(tizenObj) {
    if (!tizenObj || !tizenObj.tvinputdevice) return;
    try {
      if (typeof tizenObj.tvinputdevice.registerKeyBatch === 'function') {
        tizenObj.tvinputdevice.registerKeyBatch(REMOTE_KEYS);
      } else if (typeof tizenObj.tvinputdevice.registerKey === 'function') {
        for (var i = 0; i < REMOTE_KEYS.length; i += 1) {
          try {
            tizenObj.tvinputdevice.registerKey(REMOTE_KEYS[i]);
          } catch (e) {
            // Some keys vary by remote model
          }
        }
      }
    } catch (e) {
      // Ignore unsupported key registration
    }
  }

  function resolveKeyCodes(tizenObj) {
    var codes = {
      Return: DEFAULT_KEY_CODES.Return,
      Exit: DEFAULT_KEY_CODES.Exit,
      Info: DEFAULT_KEY_CODES.Info,
      Menu: DEFAULT_KEY_CODES.Menu,
      ColorF0Red: DEFAULT_KEY_CODES.ColorF0Red,
      ColorF3Blue: DEFAULT_KEY_CODES.ColorF3Blue,
    };
    if (!tizenObj || !tizenObj.tvinputdevice || typeof tizenObj.tvinputdevice.getKey !== 'function') {
      return codes;
    }
    var names = Object.keys(codes);
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      try {
        var info = tizenObj.tvinputdevice.getKey(name);
        if (info && typeof info.code === 'number') {
          codes[name] = info.code;
        }
      } catch (e) {
        // Keep fallback numeric code
      }
    }
    return codes;
  }

  function isTextEditingTarget(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function createRemoteController(opts) {
    var win = opts.win || window;
    var overlayEl = opts.overlayEl;
    var isOverlayOpen = opts.isOverlayOpen;
    var onToggleOverlay = opts.onToggleOverlay;
    var onCloseOverlay = opts.onCloseOverlay;
    var onExit = opts.onExit;
    var codes = resolveKeyCodes(win.tizen);

    function getFocusables() {
      if (!overlayEl) return [];
      return Array.prototype.slice.call(overlayEl.querySelectorAll('[data-focusable="true"]'));
    }

    function moveFocus(delta) {
      var items = getFocusables();
      if (items.length === 0) return;
      var active = win.document.activeElement;
      var idx = items.indexOf(active);
      var nextIdx;
      if (idx === -1) {
        nextIdx = delta > 0 ? 0 : items.length - 1;
      } else {
        nextIdx = (idx + delta + items.length) % items.length;
      }
      items[nextIdx].focus();
    }

    function handleKeyDown(ev) {
      var kc = ev.keyCode;
      var key = ev.key;
      var open = isOverlayOpen();

      // Toggle keys: Info, Menu (10133 / 18), ColorF0Red, ColorF3Blue, or desktop F2 / 'm'
      var isToggleKey =
        kc === codes.Info ||
        kc === codes.Menu ||
        kc === 18 ||
        kc === codes.ColorF0Red ||
        kc === codes.ColorF3Blue ||
        key === 'F2' ||
        key === 'ContextMenu' ||
        (!isTextEditingTarget(ev.target) && (key === 'm' || key === 'M'));

      if (isToggleKey) {
        ev.preventDefault();
        onToggleOverlay();
        return;
      }

      if (kc === codes.Return || key === 'Escape') {
        ev.preventDefault();
        if (open) {
          onCloseOverlay();
        }
        return;
      }

      if (kc === codes.Exit) {
        ev.preventDefault();
        onExit();
        return;
      }

      if (!open) return;

      if (key === 'ArrowDown' || kc === 40) {
        ev.preventDefault();
        moveFocus(1);
        return;
      }

      if (key === 'ArrowUp' || kc === 38) {
        ev.preventDefault();
        moveFocus(-1);
        return;
      }

      if (key === 'Enter' || kc === 13) {
        var active = win.document.activeElement;
        if (active && active.tagName && active.tagName.toUpperCase() === 'BUTTON') {
          ev.preventDefault();
          active.click();
        }
      }
    }

    win.addEventListener('keydown', handleKeyDown);

    return {
      focusFirst: function () {
        var items = getFocusables();
        if (items.length > 0) items[0].focus();
      },
      destroy: function () {
        win.removeEventListener('keydown', handleKeyDown);
      },
    };
  }

  root.SiSSiRemote = {
    REMOTE_KEYS: REMOTE_KEYS,
    DEFAULT_KEY_CODES: DEFAULT_KEY_CODES,
    registerRemoteKeys: registerRemoteKeys,
    resolveKeyCodes: resolveKeyCodes,
    createRemoteController: createRemoteController,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
