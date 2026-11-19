# Step 2: Samsung Tizen TV receiver (plan)

Status: **plan, not built** (2026-11-19). Builds on [Step 1: web signage](step-1-web-signage.md) (`step-1-impl`). The receiver lives in `clients/tizen/` inside `simple-smart-signage` and consumes the existing Step 1 read API (`GET /s/:screenId/playlist.json` and `GET /media/:file`).

---

## 1. App model: Tizen Web Application (`.wgt`)

### Why Web App over Native (C / .NET)

A **Tizen Web Application** (`.wgt`) is the standard choice for Samsung Smart TVs and Samsung Smart Signage Platform (SSSP) displays:

- **Shared playback model**: Uses the same HTML5 + CSS + JS slideshow engine as [`public/player/`](../../public/player/player.js) (`<img>`, `<video>`, CSS opacity cross-fade, `object-fit: contain`), avoiding a separate C/C++ or .NET media pipeline.
- **Zero-SDK build**: A `.wgt` is a standard ZIP archive with `config.xml` at the root. Unsigned `.wgt` packages can be built and verified in pure Node.js without Tizen Studio.
- **Wide hardware coverage**: Targets Tizen TV profile `tv-samsung` (`required_version="4.0"`), covering Samsung Smart TVs (2018+) and SSSP 6+ signage displays.

### Package layout (`clients/tizen/`)

```text
clients/tizen/
├── config.xml                 # Tizen widget manifest (tv-samsung, privileges, WARP, settings)
├── icon.png                   # 117x117 (or 512x512) launcher icon
├── index.html                 # Stage + D-pad setup overlay + optional $WEBAPIS/webapis/webapis.js
├── app.css                    # Full-screen #000 stage, cross-fade, orientation rotation, setup overlay
├── src/
│   ├── main.js                # Entry point, lifecycle, keep-awake, remote key wiring
│   ├── config.js              # localStorage config load/save, URL normalization
│   ├── player.js              # Polling, preloading, cross-fade, version boundary, error/empty handling
│   ├── storage.js             # MediaCache abstraction (TizenFsMediaCache + IndexedDbMediaCache)
│   ├── remote.js              # Tizen tvinputdevice key registration + D-pad / overlay navigation
│   └── orientation.js         # Native vs CSS transform rotation handling
└── scripts/
    └── build-wgt.mjs          # Pure Node.js .wgt (ZIP) builder & manifest validator
```

### `config.xml` specification

```xml
<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets"
        xmlns:tizen="http://tizen.org/ns/widgets"
        id="http://sissi.local/TizenPlayer"
        version="0.1.0"
        viewmodes="maximized">

  <tizen:application id="SiSSiPlayr.TizenPlayer" package="SiSSiPlayr" required_version="4.0"/>
  <content src="index.html"/>
  <icon src="icon.png"/>
  <name>SiSSi Signage</name>

  <!-- Target Samsung TV / Smart Signage Web Runtime -->
  <tizen:profile name="tv-samsung"/>

  <!-- W3C WARP: allow fetch() from file:// to any operator-configured server -->
  <access origin="*" subdomains="true"/>

  <!-- Required privileges -->
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <tizen:privilege name="http://tizen.org/privilege/power"/>
  <tizen:privilege name="http://tizen.org/privilege/filesystem.read"/>
  <tizen:privilege name="http://tizen.org/privilege/filesystem.write"/>

  <!-- Runtime settings -->
  <tizen:setting screen-orientation="landscape"
                 context-menu="disable"
                 background-support="disable"
                 encryption="disable"
                 install-location="auto"
                 hwkey-event="enable"/>
</widget>
```

Notes:
- **`<access origin="*" subdomains="true"/>`** is mandatory in Tizen's Widget Access Requests Policy (WARP); without it, `fetch()` from `file://` to external hosts is blocked at the container level even if the server sends CORS headers.
- **`hwkey-event="enable"`** + `http://tizen.org/privilege/tv.inputdevice` allows capturing remote control keys (`Return`, `Exit`, `Menu`, `Info`, `ColorF0Red`, `ColorF3Blue`).
- **`$WEBAPIS/webapis/webapis.js`**: Loaded in `index.html` via `<script src="$WEBAPIS/webapis/webapis.js"></script>`. On desktop browsers / Playwright this 404s harmlessly (or is stubbed in tests); all `window.webapis` and `window.tizen` accesses are guarded behind feature checks.

---

## 2. Configuration & Remote UX

### Persistent configuration (`localStorage`)

Stored under `sissi:tizen:config` as JSON:

```json
{
  "serverUrl": "https://example.com/signage",
  "screenId": "lobby",
  "rotationMode": "auto"
}
```

- `serverUrl`: Normalized (trimmed, trailing slashes stripped). Playlist endpoint is `${serverUrl}/s/${encodeURIComponent(screenId)}/playlist.json`.
- `screenId`: Validated against `/^[a-z0-9-]{1,40}$/` (matching [`src/api/read.mjs`](../../src/api/read.mjs)).
- `rotationMode`: `'auto' | 'native' | 'cw90' | 'ccw90'` (default `'auto'`).

### D-pad Setup Overlay

- **Hidden during normal playback** (`cursor: none` on `body`).
- **Auto-opens on first boot** when `serverUrl` or `screenId` is missing/invalid.
- **Toggled on demand** with the TV remote:
  - `Info` (keyCode `457`), `Menu` (`10133` / `18`), `ColorF0Red` (`403`), or `ColorF3Blue` (`406`) toggles the overlay.
  - Keyboard fallback for desktop/Playwright testing: `F2` or `m` toggles the overlay; `Escape` closes it.
- **D-pad navigation**:
  - Focusable controls in vertical order: `Server URL` `<input>`, `Screen ID` `<input>`, `Orientation Mode` `<select>`, `Save & Connect` `<button>`, `Clear Cache` `<button>`, `Close` `<button>`.
  - `ArrowUp` / `ArrowDown` moves focus between controls when not editing text; `Enter` activates buttons or opens Tizen's on-screen IME on `<input>` fields.
  - `Return` (`10009` / `Escape`): If the overlay is open, closes it (when config exists). When the overlay is closed, `Return` is ignored (or requires `Exit` key) so an accidental press does not kill unattended signage.
  - `Exit` (`10182`): Calls `tizen.application.getCurrentApplication().exit()`.
- **Key registration** (`src/remote.js`):
  - Calls `tizen.tvinputdevice.registerKeyBatch(['ColorF0Red', 'ColorF3Blue', 'Info', 'Menu'])` inside `try/catch` (some keys vary by remote/model; `Return`, `Exit`, `Arrow*`, and `Enter` are pre-registered by Tizen).
  - Resolves codes dynamically via `tizen.tvinputdevice.getKey(name)?.code` with numeric fallbacks (`10009` Return, `10182` Exit, `457` Info, `403` Red, `406` Blue, `10133` Menu).

### Keep-Awake / Prevent TV Sleep

On startup and on `visibilitychange` (when becoming visible):

1. `webapis.appcommon.setScreenSaver(webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF, onOk, onErr)` — disables Samsung's built-in screen saver during playback.
2. `tizen.power.request('SCREEN', 'SCREEN_NORMAL')` — prevents screen dimming / standby.
3. Both calls are wrapped in feature detection (`typeof webapis !== 'undefined'`, `typeof tizen !== 'undefined'`) and `try/catch` so desktop Chrome / Playwright runs cleanly.

---

## 3. Orientation (`landscape` vs `vertical`)

`playlist.json` returns `orientation: "landscape" | "vertical"`. Samsung displays handle portrait in two ways:

1. **Hardware / OSD Portrait (SSSP signage displays & newer Tizen)**:
   - The display's own OSD / Settings -> Display -> Orientation is set to Portrait (`1080x1920` or `2160x3840`). `window.innerWidth < window.innerHeight`.
   - No CSS rotation is needed; `#stage` fills `100vw x 100vh`.
2. **Consumer TVs mounted vertically (landscape OS viewport `1920x1080` or `3840x2160`)**:
   - The Tizen Web Runtime still reports `window.innerWidth > window.innerHeight` even though the TV is physically rotated 90°.
   - **CSS transform fallback** applied to `#stage` (and setup overlay):
     - `cw90`: `width: 100vh; height: 100vw; transform-origin: top left; transform: rotate(90deg) translateY(-100%); -webkit-backface-visibility: hidden;`
     - `ccw90`: `width: 100vh; height: 100vw; transform-origin: top left; transform: rotate(-90deg) translateX(-100%); -webkit-backface-visibility: hidden;`

### `rotationMode` behavior (`src/orientation.js`)

| `rotationMode` | Condition | Result |
|---|---|---|
| `auto` (default) | `playlist.orientation === 'vertical'` AND `window.innerWidth > window.innerHeight` | Apply `cw90` CSS rotation |
| `auto` | Otherwise | No CSS rotation (`100vw x 100vh`) |
| `native` | Any | Never CSS-rotate (trust display OSD) |
| `cw90` / `ccw90` | Any | Always apply 90° / -90° CSS rotation |

All media uses `object-fit: contain` on `#000` background, matching [`public/player/player.css`](../../public/player/player.css).

---

## 4. Offline & Media Caching on Tizen

### Critical Constraint: `file://` Origin vs Service Worker

Unlike Step 1's web player (served over `https://`), an installed `.wgt` app executes from the device filesystem on a **`file://` origin** (e.g. `file:///opt/usr/home/owner/apps_rw/.../index.html`).

- **Service Workers do NOT register on `file://`**. `navigator.serviceWorker.register()` rejects because Service Workers require `https://` or `http://localhost`.
- Therefore, [`public/player/sw.js`](../../public/player/sw.js) and `CacheStorage` cannot be used in the `.wgt` receiver.

### Storage Comparison

| Mechanism | Works on `file://`? | Video Size & RAM | Range / Streaming | Testable in Chrome/Playwright? |
|---|---|---|---|---|
| **Service Worker + CacheStorage** | No | N/A | N/A | N/A for `.wgt` |
| **`tizen.filesystem` (`wgt-private`)** | Yes (Tizen only) | Disk-backed, no RAM blob copy | Native `file://` URI streaming in `<video>` | Only with mock |
| **IndexedDB (`Blob`) + `URL.createObjectURL`** | Yes (Tizen + Chrome) | In-memory/IDB; cap videos (e.g. 100 MB) to avoid OOM on older TVs | Browser handles seeking on `blob:` URLs | Yes, natively |

### Storage Abstraction (`src/storage.js`)

Define a single `MediaCache` interface used by `player.js`:

```js
// MediaCache contract
// - resolveMediaUrl(entry): Promise<{ src: string, revoke?: () => void }>
// - syncEntries(entries): Promise<void>   // download missing, prune unreferenced
// - clear(): Promise<void>
```

Two drivers implement this interface:

1. **`TizenFsMediaCache`** (selected automatically when `window.tizen?.filesystem` exists):
   - Resolves `wgt-private` and creates `sissi-cache/` directory.
   - Cache key: `${entry.sha256}.${ext}`.
   - Downloads via `fetch(resolvedUrl)` -> `arrayBuffer()` -> writes binary file via `FileStream.writeBytes` (or `tizen.download` if available), and returns `file.toURI()` (`file:///opt/usr/.../sissi-cache/<sha256>.<ext>`).
   - Pruning: lists `sissi-cache/` and deletes files whose `<sha256>.<ext>` is not in the active playlist.
   - Falls back to network URL if download fails or disk write errors.

2. **`IndexedDbMediaCache`** (fallback when `tizen.filesystem` is absent — desktop Chrome, Playwright tests, or Tizen simulator):
   - Opens IndexedDB `sissi-tizen` (object store `media`, keyed by `${sha256}.${ext}`).
   - Stores `{ key, blob, contentType, size, savedAt }`.
   - Enforces `MAX_VIDEO_BYTES` (100 MB, matching Step 1's `SISSI_SW_MAX_VIDEO_MB`) so large videos stream from network rather than exhausting IDB quota.
   - `resolveMediaUrl()` returns `{ src: URL.createObjectURL(record.blob), revoke: () => URL.revokeObjectURL(src) }`; `destroySlideElement()` calls `revoke()` when a slide is removed to prevent memory leaks.

**Playlist metadata** (`last good playlist.json`) is stored in `localStorage` under `sissi:tizen:playlist:${screenId}` so cold boot while offline immediately resumes the last good playlist.

---

## 5. Playback, Sync & Server Compatibility

### URL Resolution on `file://`

In [`src/api/read.mjs`](../../src/api/read.mjs), `playlist.json` returns root-relative `entry.url` values (e.g. `/signage/media/<sha256>.png` when `SISSI_PUBLIC_PATH=/signage`). On `file://`, `new URL(entry.url, window.location.href)` would resolve to `file:///signage/media/...` and fail.

- **Rule**: Resolve `entry.url` against `new URL(config.serverUrl).origin` (unless `entry.url` is already `http://` or `https://`).
  - Example: `serverUrl = "https://example.com/signage"`, `entry.url = "/signage/media/abc.png"` -> `"https://example.com/signage/media/abc.png"`.

### CORS Note for Server

`GET /s/:screenId/playlist.json` and `GET /media/:file` in [`src/api/read.mjs`](../../src/api/read.mjs) do not currently emit `Access-Control-Allow-Origin: *`. On Tizen Chromium (6.5+), `fetch()` from `file://` may require `Access-Control-Allow-Origin: *` on those public read-only routes (or at the reverse proxy). Plan to add `Access-Control-Allow-Origin: *` to public `GET`/`HEAD` responses on `/s/:screenId/playlist.json` and `/media/:file` if direct Tizen `fetch()` requires it in device testing.

### Playback Loop (`src/player.js`)

Port the proven Step 1 state machine from [`public/player/player.js`](../../public/player/player.js):

1. **Polling**: Fetch `playlist.json` (`cache: 'no-store'`) every `60_000` ms, and on any slide load error (debounced >= `1_000` ms).
2. **Version switch at entry boundary**: New `version` is stored in `pendingPlaylist` and applied on the next `advance()`, never mid-slide.
3. **Single-entry steady state**: When `entryId` and `url` match the active slide and no new `pendingPlaylist` exists, re-arm the timer / restart video without DOM teardown or re-fade.
4. **Transitions & timers**:
   - Images: `0.5s` CSS opacity cross-fade, shown for `entry.seconds * 1000`.
   - Videos: `<video muted autoplay playsinline preload="auto">`, completes on `ended` or `(entry.seconds + 5) * 1000` safety net, skips immediately on `error`.
   - Preload next entry (`Image` or `<video preload="auto">`) using `MediaCache.resolveMediaUrl()`.
5. **`webapis.avplay` fallback note**: HTML5 `<video>` is used in v1 because it supports CSS cross-fades, CSS orientation rotation, and identical Playwright testing. `webapis.avplay` renders on a hardware plane behind the WebView (incompatible with CSS `opacity` cross-fade and CSS `rotate(90deg)` without hole-punching); it is only needed if a specific Tizen model lacks HTML5 `<video>` codec support for H.264/AAC MP4s.
6. **Empty / 404 / Offline**:
   - `404`: Fade out to `#000` (or schedule `pendingPlaylist = { entries: [] }` at boundary).
   - Network error on boot: Load last playlist from `localStorage` and play from `MediaCache`.
   - All entries failing: Fade out to `#000` and retry after `min(pollMs, 2000)` ms.

---

## 6. Build, Packaging & Testing

### Pure Node `.wgt` Builder (`clients/tizen/scripts/build-wgt.mjs`)

Builds `dist/sissi-tizen.wgt` without Tizen Studio:

- Uses Node's built-in `node:zlib` (`deflateRawSync` + `crc32` or standard CRC32) to write a valid ZIP archive containing `config.xml`, `icon.png`, `index.html`, `app.css`, and `src/**/*.js`.
- Validates that `config.xml` exists at the archive root, declares `tv-samsung`, `<access origin="*" subdomains="true"/>`, and required privileges.
- Add npm script in [`package.json`](../../package.json): `"build:tizen": "node clients/tizen/scripts/build-wgt.mjs"`.

**Signing for physical TVs**:
- Unsigned `.wgt` archives are suitable for CI verification, build checks, and Tizen Emulator.
- Physical Samsung TVs / SSSP displays require cryptographic signing (Author + Distributor certificates with the TV's DUID). Operators sign the built directory or `.wgt` once using `tizen package -t wgt -s <profile>` (Tizen CLI Certificate Manager) and deploy via `tizen install` or USB (`userwidget/`).

### Tests (`test/tizen/`)

1. **Unit & packaging tests (`test/tizen/build-wgt.test.mjs`)** using `node:test`:
   - Runs `build-wgt.mjs`, verifies the output `.wgt` has valid ZIP local/central headers (`PK\x03\x04` / `PK\x01\x02`), contains `config.xml` at root, and passes manifest checks.
   - Tests `config.js` (URL normalization, `entry.url` origin resolution) and `orientation.js` (`auto` / `native` / `cw90` / `ccw90` matrix).
2. **Playwright integration tests (`test/tizen/tizen-player.test.mjs`)** using `playwright-core` + [`test/helpers/server.mjs`](../../test/helpers/server.mjs):
   - Serves `clients/tizen/` over a local HTTP server (or loads `index.html`) against the real Step 1 `registerReadRoutes` test server.
   - Injects mock `window.tizen` and `window.webapis` via `page.addInitScript()`:
     - Verifies `webapis.appcommon.setScreenSaver(SCREEN_SAVER_OFF)` and `tizen.power.request('SCREEN', 'SCREEN_NORMAL')` are called on startup.
     - Verifies first-boot D-pad setup overlay (Arrow keys + Enter + Save), `localStorage` persistence, and hiding overlay during playback.
     - Verifies remote toggle keys (`Info` 457 / `ColorF0Red` 403) open/close the overlay and `Return` (10009) closes it.
     - Verifies image cross-fade, video playback, and playlist `version` switch at entry boundary.
     - Verifies **offline resilience**: once `IndexedDbMediaCache` caches the playlist's images/videos, stopping the test server keeps the slideshow looping cleanly.
     - Verifies **vertical orientation**: when `playlist.json` returns `orientation: "vertical"` on a `1280x720` viewport in `auto` mode, `#stage` receives `rotate(90deg)` transform.
3. **CI**: Runs automatically under `npm test` (`node --test "test/**/*.test.mjs"`) and verifies `npm run build:tizen`.

---

## 7. Implementation Tasks

| Step | Scope | Files |
|---|---|---|
| 1 | Manifest, icon, HTML/CSS shell, orientation helper | `clients/tizen/config.xml`, `icon.png`, `index.html`, `app.css`, `src/orientation.js` |
| 2 | Config store & D-pad remote UX | `clients/tizen/src/config.js`, `src/remote.js` |
| 3 | Storage abstraction (`TizenFsMediaCache` + `IndexedDbMediaCache`) | `clients/tizen/src/storage.js` |
| 4 | Player engine & `main.js` wiring (keep-awake + polling + playback) | `clients/tizen/src/player.js`, `src/main.js` |
| 5 | Pure Node `.wgt` builder + npm script | `clients/tizen/scripts/build-wgt.mjs`, `package.json` |
| 6 | Unit + Playwright tests (with mocked `tizen`/`webapis`) | `test/tizen/build-wgt.test.mjs`, `test/tizen/tizen-player.test.mjs` |
