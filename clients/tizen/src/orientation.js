(function (root) {
  'use strict';

  function computeRotationClass(rotationMode, playlistOrientation, viewportWidth, viewportHeight) {
    if (rotationMode === 'native') return '';
    if (rotationMode === 'cw90') return 'rotate-cw90';
    if (rotationMode === 'ccw90') return 'rotate-ccw90';

    // 'auto' (default): CSS-rotate only when playlist is vertical on a landscape viewport
    if (playlistOrientation === 'vertical' && viewportWidth > viewportHeight) {
      return 'rotate-cw90';
    }
    return '';
  }

  function applyOrientation(elements, rotationMode, playlistOrientation, win) {
    var w = win || (typeof window !== 'undefined' ? window : { innerWidth: 1920, innerHeight: 1080 });
    var cls = computeRotationClass(rotationMode, playlistOrientation, w.innerWidth, w.innerHeight);
    var list = Array.isArray(elements) ? elements : [elements];
    for (var i = 0; i < list.length; i += 1) {
      var el = list[i];
      if (!el || !el.classList) continue;
      el.classList.remove('rotate-cw90', 'rotate-ccw90');
      if (cls) {
        el.classList.add(cls);
      }
    }
    return cls;
  }

  root.SiSSiOrientation = {
    computeRotationClass: computeRotationClass,
    applyOrientation: applyOrientation,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
