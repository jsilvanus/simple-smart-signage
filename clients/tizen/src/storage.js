(function (root) {
  'use strict';

  var MAX_VIDEO_BYTES = 100 * 1024 * 1024;
  var IDB_NAME = 'sissi-tizen';
  var IDB_VERSION = 1;
  var IDB_STORE = 'media';
  var TIZEN_CACHE_DIR = 'sissi-cache';

  function extractExt(url) {
    if (typeof url !== 'string') return 'bin';
    var clean = url.split('?')[0].split('#')[0];
    var m = /\.([a-z0-9]{1,8})$/i.exec(clean);
    return m ? m[1].toLowerCase() : 'bin';
  }

  function mediaCacheKey(entry) {
    if (!entry) return '';
    var ext = extractExt(entry.url);
    if (entry.sha256 && /^[0-9a-f]{64}$/i.test(entry.sha256)) {
      return entry.sha256.toLowerCase() + '.' + ext;
    }
    var clean = String(entry.url || '').replace(/[^a-z0-9._-]/gi, '_');
    return clean || 'unknown.' + ext;
  }

  function isOversizeVideo(entry, sizeBytes) {
    return Boolean(entry && entry.kind === 'video' && sizeBytes > MAX_VIDEO_BYTES);
  }

  /* ------------------------------------------------------------------ *
   * IndexedDbMediaCache (works on file:// in Tizen & desktop Chrome)
   * ------------------------------------------------------------------ */
  function IndexedDbMediaCache(idbFactory) {
    this.idb = idbFactory;
    this._dbPromise = null;
  }

  IndexedDbMediaCache.prototype._open = function () {
    var self = this;
    if (self._dbPromise) return self._dbPromise;
    self._dbPromise = new Promise(function (resolve, reject) {
      var req = self.idb.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        self._dbPromise = null;
        reject(req.error || new Error('IndexedDB open failed'));
      };
    });
    return self._dbPromise;
  };

  IndexedDbMediaCache.prototype._get = function (key) {
    return this._open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var store = tx.objectStore(IDB_STORE);
        var req = store.get(key);
        req.onsuccess = function () {
          resolve(req.result || null);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    });
  };

  IndexedDbMediaCache.prototype._put = function (record) {
    return this._open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        var store = tx.objectStore(IDB_STORE);
        var req = store.put(record);
        req.onsuccess = function () {
          resolve();
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    });
  };

  IndexedDbMediaCache.prototype._delete = function (key) {
    return this._open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        var store = tx.objectStore(IDB_STORE);
        var req = store.delete(key);
        req.onsuccess = function () {
          resolve();
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    });
  };

  IndexedDbMediaCache.prototype._keys = function () {
    return this._open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var store = tx.objectStore(IDB_STORE);
        var req = store.getAllKeys();
        req.onsuccess = function () {
          resolve(req.result || []);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    });
  };

  IndexedDbMediaCache.prototype.resolveMediaUrl = function (entry, networkUrl) {
    var key = mediaCacheKey(entry);
    if (!key) {
      return Promise.resolve({ src: networkUrl, fromCache: false });
    }
    return this._get(key)
      .then(function (record) {
        if (record && record.blob) {
          var objectUrl = URL.createObjectURL(record.blob);
          return {
            src: objectUrl,
            fromCache: true,
            revoke: function () {
              try {
                URL.revokeObjectURL(objectUrl);
              } catch (e) {
                // Ignore revoke errors
              }
            },
          };
        }
        return { src: networkUrl, fromCache: false };
      })
      .catch(function () {
        return { src: networkUrl, fromCache: false };
      });
  };

  IndexedDbMediaCache.prototype.syncEntries = function (entries, resolveUrlFn) {
    var self = this;
    var list = Array.isArray(entries) ? entries : [];
    var activeKeys = {};
    for (var i = 0; i < list.length; i += 1) {
      var k = mediaCacheKey(list[i]);
      if (k) activeKeys[k] = true;
    }

    return self
      ._keys()
      .then(function (existingKeys) {
        var prunePromises = [];
        for (var j = 0; j < existingKeys.length; j += 1) {
          if (!activeKeys[existingKeys[j]]) {
            prunePromises.push(self._delete(existingKeys[j]).catch(function () {}));
          }
        }
        return Promise.all(prunePromises);
      })
      .then(function () {
        var chain = Promise.resolve();
        list.forEach(function (entry) {
          chain = chain.then(function () {
            var key = mediaCacheKey(entry);
            if (!key) return null;
            return self._get(key).then(function (existing) {
              if (existing && existing.blob) return null;
              var url = resolveUrlFn(entry.url);
              if (!url) return null;
              return fetch(url)
                .then(function (res) {
                  if (!res.ok) return null;
                  var len = Number(res.headers.get('content-length') || '0');
                  if (len > 0 && isOversizeVideo(entry, len)) return null;
                  return res.blob().then(function (blob) {
                    if (isOversizeVideo(entry, blob.size)) return null;
                    return self._put({
                      key: key,
                      blob: blob,
                      contentType: blob.type || res.headers.get('content-type') || 'application/octet-stream',
                      size: blob.size,
                      savedAt: Date.now(),
                    });
                  });
                })
                .catch(function () {
                  // Network/IDB errors fall back to live URL
                });
            });
          });
        });
        return chain;
      })
      .catch(function () {
        // Ignore IDB failures
      });
  };

  IndexedDbMediaCache.prototype.clear = function () {
    return this._open()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          var store = tx.objectStore(IDB_STORE);
          var req = store.clear();
          req.onsuccess = function () {
            resolve();
          };
          req.onerror = function () {
            reject(req.error);
          };
        });
      })
      .catch(function () {});
  };

  /* ------------------------------------------------------------------ *
   * TizenFsMediaCache (wgt-private/sissi-cache/<sha256>.<ext>)
   * ------------------------------------------------------------------ */
  function TizenFsMediaCache(fs) {
    this.fs = fs;
    this._dirPromise = null;
  }

  TizenFsMediaCache.prototype._ensureDir = function () {
    var self = this;
    if (self._dirPromise) return self._dirPromise;
    self._dirPromise = new Promise(function (resolve, reject) {
      self.fs.resolve(
        'wgt-private',
        function (rootDir) {
          try {
            var existing = rootDir.resolve(TIZEN_CACHE_DIR);
            resolve(existing);
          } catch (e) {
            try {
              var created = rootDir.createDirectory(TIZEN_CACHE_DIR);
              resolve(created);
            } catch (err) {
              self._dirPromise = null;
              reject(err);
            }
          }
        },
        function (err) {
          self._dirPromise = null;
          reject(err);
        },
        'rw'
      );
    });
    return self._dirPromise;
  };

  TizenFsMediaCache.prototype._listFiles = function (dir) {
    return new Promise(function (resolve, reject) {
      dir.listFiles(resolve, reject);
    });
  };

  TizenFsMediaCache.prototype._deleteFile = function (dir, fullPath) {
    return new Promise(function (resolve) {
      dir.deleteFile(
        fullPath,
        function () {
          resolve();
        },
        function () {
          resolve();
        }
      );
    });
  };

  TizenFsMediaCache.prototype._writeFile = function (dir, key, arrayBuffer) {
    return new Promise(function (resolve, reject) {
      var file;
      try {
        file = dir.resolve(key);
      } catch (e) {
        file = dir.createFile(key);
      }
      file.openStream(
        'w',
        function (stream) {
          try {
            var bytes = Array.from(new Uint8Array(arrayBuffer));
            stream.writeBytes(bytes);
            stream.close();
            resolve(file);
          } catch (err) {
            try {
              stream.close();
            } catch (e2) {
              // ignore
            }
            reject(err);
          }
        },
        reject,
        'UTF-8'
      );
    });
  };

  TizenFsMediaCache.prototype.resolveMediaUrl = function (entry, networkUrl) {
    var key = mediaCacheKey(entry);
    if (!key) return Promise.resolve({ src: networkUrl, fromCache: false });

    return this._ensureDir()
      .then(function (dir) {
        try {
          var file = dir.resolve(key);
          var uri = typeof file.toURI === 'function' ? file.toURI() : '';
          if (uri) {
            return { src: uri, fromCache: true };
          }
        } catch (e) {
          // File not cached yet
        }
        return { src: networkUrl, fromCache: false };
      })
      .catch(function () {
        return { src: networkUrl, fromCache: false };
      });
  };

  TizenFsMediaCache.prototype.syncEntries = function (entries, resolveUrlFn) {
    var self = this;
    var list = Array.isArray(entries) ? entries : [];
    var activeKeys = {};
    for (var i = 0; i < list.length; i += 1) {
      var k = mediaCacheKey(list[i]);
      if (k) activeKeys[k] = true;
    }

    return self
      ._ensureDir()
      .then(function (dir) {
        return self._listFiles(dir).then(function (files) {
          var prune = [];
          for (var j = 0; j < files.length; j += 1) {
            var f = files[j];
            if (!f.isDirectory && !activeKeys[f.name]) {
              prune.push(self._deleteFile(dir, f.fullPath));
            }
          }
          return Promise.all(prune).then(function () {
            var chain = Promise.resolve();
            list.forEach(function (entry) {
              chain = chain.then(function () {
                var key = mediaCacheKey(entry);
                if (!key) return null;
                try {
                  dir.resolve(key);
                  return null;
                } catch (e) {
                  // Not present; download it
                }
                var url = resolveUrlFn(entry.url);
                if (!url) return null;
                return fetch(url)
                  .then(function (res) {
                    if (!res.ok) return null;
                    return res.arrayBuffer().then(function (buf) {
                      return self._writeFile(dir, key, buf);
                    });
                  })
                  .catch(function () {
                    // Fallback to network URL
                  });
              });
            });
            return chain;
          });
        });
      })
      .catch(function () {
        // Ignore filesystem errors
      });
  };

  TizenFsMediaCache.prototype.clear = function () {
    var self = this;
    return self
      ._ensureDir()
      .then(function (dir) {
        return self._listFiles(dir).then(function (files) {
          var tasks = [];
          for (var i = 0; i < files.length; i += 1) {
            if (!files[i].isDirectory) {
              tasks.push(self._deleteFile(dir, files[i].fullPath));
            }
          }
          return Promise.all(tasks);
        });
      })
      .catch(function () {});
  };

  /* ------------------------------------------------------------------ *
   * NoopMediaCache
   * ------------------------------------------------------------------ */
  function NoopMediaCache() {}
  NoopMediaCache.prototype.resolveMediaUrl = function (_entry, networkUrl) {
    return Promise.resolve({ src: networkUrl, fromCache: false });
  };
  NoopMediaCache.prototype.syncEntries = function () {
    return Promise.resolve();
  };
  NoopMediaCache.prototype.clear = function () {
    return Promise.resolve();
  };

  function createMediaCache(win) {
    var w = win || (typeof window !== 'undefined' ? window : {});
    if (w.tizen && w.tizen.filesystem && typeof w.tizen.filesystem.resolve === 'function') {
      return new TizenFsMediaCache(w.tizen.filesystem);
    }
    if (w.indexedDB) {
      return new IndexedDbMediaCache(w.indexedDB);
    }
    return new NoopMediaCache();
  }

  root.SiSSiStorage = {
    MAX_VIDEO_BYTES: MAX_VIDEO_BYTES,
    mediaCacheKey: mediaCacheKey,
    IndexedDbMediaCache: IndexedDbMediaCache,
    TizenFsMediaCache: TizenFsMediaCache,
    NoopMediaCache: NoopMediaCache,
    createMediaCache: createMediaCache,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
