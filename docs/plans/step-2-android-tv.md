# Step 2: Native Android TV Receiver (plan)

Status: **plan, not built** (2026-11-19). Builds on [Step 1: web signage](step-1-web-signage.md) without changing the server API.

## 1. Goal & Scope

Build a native Android TV receiver app (Option 2: **no WebView**) under `clients/android/` inside `simple-smart-signage`.

Why native instead of WebView:
- Deterministic offline playback from `filesDir` without browser Service Worker / Cache API quota or `Range` request quirks.
- Hardware-accelerated video decoding via **Media3 ExoPlayer** playing directly from local files (`Uri.fromFile(...)`).
- First-class D-pad / TV remote UX (`SettingsScreen`, `KEYCODE_MENU`, `KEYCODE_SETTINGS`, long-press `KEYCODE_BACK`, Leanback launcher banner).

Out of scope for Step 2:
- Device enrolment / pairing codes (uses public `screenId` + server URL, matching Step 1).
- Server-side changes (consumes Step 1's existing `GET /s/:screenId/playlist.json` and `GET /media/:file`).

---

## 2. Architecture & Gradle / SDK Setup

The project mirrors `fi.lcyt.tv` (`live-captions-yt/android/lcyt-tv`) in toolchain versions, Compose for TV setup, and ViewModel/StateFlow structure.

### 2.1 Environment & Wrapper Requirements

Verified on the local Windows dev environment:
- **Android SDK**: `C:\Users\jsilv\AppData\Local\Android\Sdk` (contains `platforms/android-35` and `build-tools/34.0.0`, `36.1.0`, `37.0.0`).
- **JDK**: OpenJDK `17.0.21` (Temurin).
- **Gradle**: Not installed globally on `PATH`. Therefore `clients/android/` **must include** the Gradle Wrapper (`gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`, `gradle/wrapper/gradle-wrapper.properties` pinned to Gradle `8.7` or `8.9`).
- `local.properties` (gitignored) sets `sdk.dir=C\:\\Users\\jsilv\\AppData\\Local\\Android\\Sdk` (or `ANDROID_HOME` is set in CI/shell).

### 2.2 SDK & Version Catalog (`clients/android/gradle/libs.versions.toml`)

- `compileSdk = 35`, `targetSdk = 35`, `minSdk = 21` (Media3 `1.5.1` supports `minSdk = 21` and targets `compileSdk = 35`).
- `JavaVersion.VERSION_11`, `jvmTarget = "11"`.

```toml
[versions]
agp = "8.5.2"
kotlin = "2.0.21"
coreKtx = "1.13.1"
lifecycleRuntime = "2.8.6"
activityCompose = "1.9.2"
composeBom = "2024.10.00"
tvCompose = "1.0.0"
okhttp = "4.12.0"
kotlinxCoroutines = "1.8.1"
gson = "2.11.0"
media3 = "1.5.1"
coil = "2.7.0"
junit = "4.13.2"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-lifecycle-runtime-ktx = { group = "androidx.lifecycle", name = "lifecycle-runtime-ktx", version.ref = "lifecycleRuntime" }
androidx-lifecycle-viewmodel-compose = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-compose", version.ref = "lifecycleRuntime" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-ui-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }
androidx-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-ui-tooling = { group = "androidx.compose.ui", name = "ui-tooling" }
androidx-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-tv-foundation = { group = "androidx.tv", name = "tv-foundation", version.ref = "tvCompose" }
androidx-tv-material = { group = "androidx.tv", name = "tv-material", version.ref = "tvCompose" }
androidx-media3-exoplayer = { group = "androidx.media3", name = "media3-exoplayer", version.ref = "media3" }
androidx-media3-ui = { group = "androidx.media3", name = "media3-ui", version.ref = "media3" }
coil-compose = { group = "io.coil-kt", name = "coil-compose", version.ref = "coil" }
okhttp = { group = "com.squareup.okhttp3", name = "okhttp", version.ref = "okhttp" }
kotlinx-coroutines-android = { group = "org.jetbrains.kotlinx", name = "kotlinx-coroutines-android", version.ref = "kotlinxCoroutines" }
gson = { group = "com.google.code.gson", name = "gson", version.ref = "gson" }
junit = { group = "junit", name = "junit", version.ref = "junit" }
okhttp-mockwebserver = { group = "com.squareup.okhttp3", name = "mockwebserver", version.ref = "okhttp" }
kotlinx-coroutines-test = { group = "org.jetbrains.kotlinx", name = "kotlinx-coroutines-test", version.ref = "kotlinxCoroutines" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
```

### 2.3 Directory & Package Layout (`fi.sissi.tv`)

```text
clients/android/
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
├── gradlew
├── gradlew.bat
├── gradle/
│   ├── libs.versions.toml
│   └── wrapper/
│       ├── gradle-wrapper.jar
│       └── gradle-wrapper.properties
└── app/
    ├── build.gradle.kts
    ├── proguard-rules.pro
    └── src/
        ├── main/
        │   ├── AndroidManifest.xml
        │   ├── res/
        │   │   ├── drawable/ic_banner.xml      # 320x180dp Leanback banner
        │   │   ├── mipmap-hdpi/ic_launcher.png
        │   │   └── values/
        │   │       ├── strings.xml
        │   │       └── themes.xml              # Theme.AppCompat.Leanback, black windowBackground
        │   └── java/fi/sissi/tv/
        │       ├── MainActivity.kt             # Entry point, deep-links, key handling, immersive + keep-screen-on
        │       ├── SettingsScreen.kt           # First-launch & Menu configuration UI
        │       ├── PlayerScreen.kt             # Crossfade image + Media3 PlayerView video + black idle state
        │       ├── SignageViewModel.kt         # Playback state machine, SharedPreferences, sync orchestration
        │       ├── data/
        │       │   ├── PlaylistModels.kt       # Playlist, PlaylistEntry, MediaKind, Orientation
        │       │   ├── PlaylistParser.kt       # Gson parser + root-relative media URL resolution
        │       │   ├── MediaCacheManager.kt    # Atomic SHA-256 streaming download + pruning
        │       │   └── PlaylistSyncer.kt       # Polling loop + backoff + filesDir/playlist.json persistence
        └── test/java/fi/sissi/tv/
            └── data/
                ├── PlaylistParserTest.kt
                ├── MediaCacheManagerTest.kt
                └── PlaylistSyncerTest.kt
```

Keeping `PlaylistModels`, `PlaylistParser`, `MediaCacheManager`, and `PlaylistSyncer` free of Android framework types (`Context` replaced by `File` / `filesDir` constructor injection) allows all sync/cache/parser logic to run as fast JVM unit tests with `MockWebServer` and `TemporaryFolder`.

---

## 3. Server API Contract

Consumes the read-only endpoints implemented in `src/api/read.mjs`:

1. **`GET <serverUrl>/s/<screenId>/playlist.json`**
   - `screenId` must match `^[a-z0-9-]{1,40}$`.
   - `200 OK` (`Cache-Control: no-cache`):
     ```json
     {
       "screenId": "lobby",
       "version": 12,
       "orientation": "landscape",
       "entries": [
         {
           "entryId": "ent_abc123",
           "kind": "image",
           "url": "/signage/media/<64-hex>.png",
           "sha256": "<64-hex>",
           "seconds": 10
         }
       ]
     }
     ```
   - `404` (`SCREEN_NOT_FOUND`): screen does not exist yet or was deleted. Player stays on neutral black screen (or keeps playing last cached playlist if any? See §5.3) and continues polling with backoff.

2. **`GET <resolvedEntryUrl>`** (e.g. `https://host/signage/media/<sha256>.<ext>`)
   - `Cache-Control: public, max-age=31536000, immutable`.
   - **URL resolution rule**: `src/api/read.mjs` emits `url` as a root-relative path including `SISSI_PUBLIC_PATH` (e.g. `/signage/media/<sha256>.png`). Resolving `entry.url` with `serverUrl.toHttpUrl().resolve(entry.url)` (OkHttp `HttpUrl.resolve`) resolves leading-`/` paths against the origin (`https://host`), avoiding double-prefix bugs like `/signage/signage/media/...` when `serverUrl` is `https://host/signage`.

---

## 4. Configuration, Manifest & UX

### 4.1 `AndroidManifest.xml`

- Permissions: `<uses-permission android:name="android.permission.INTERNET" />`
- Features:
  - `<uses-feature android:name="android.hardware.touchscreen" android:required="false" />`
  - `<uses-feature android:name="android.software.leanback" android:required="false" />` — explicitly `required="false"` so the APK also installs on standard Android tablets, phones, and non-Leanback vertical Android signage boxes.
- `<application>`:
  - `android:theme="@style/Theme.SissiTv"` (parent `@style/Theme.AppCompat.Leanback`, `android:windowBackground` = `@android:color/black`).
  - `android:banner="@drawable/ic_banner"` (320×180dp drawable for Android TV home screen).
- `<activity android:name=".MainActivity">`:
  - `android:launchMode="singleTask"`
  - `android:exported="true"`
  - `android:configChanges="keyboard|keyboardHidden|navigation|orientation|screenLayout|screenSize|smallestScreenSize"`
  - Intent filters:
    1. `MAIN` + `LEANBACK_LAUNCHER`
    2. `MAIN` + `LAUNCHER`
    3. `VIEW` + `DEFAULT` + `BROWSABLE` for `sissi-tv://screen` (`android:scheme="sissi-tv"`, `android:host="screen"`).

### 4.2 Window Flags & Key Handling (`MainActivity.kt`)

- In `onCreate`:
  - `window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)` so the TV/box never sleeps during playback.
  - Enable sticky immersive fullscreen (`WindowCompat.setDecorFitsSystemWindows(window, false)` + `WindowInsetsControllerCompat` hiding status & navigation bars with `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`).
  - Handle deep-link in both `onCreate` (`intent?.data`) and `onNewIntent(intent)` (`sissi-tv://screen?server=...&screen=...`).
- Key events:
  - `KEYCODE_MENU` or `KEYCODE_SETTINGS` in `onKeyDown` → `viewModel.openSettings()`.
  - Long-press `KEYCODE_BACK`: in `onKeyDown`, if `keyCode == KeyEvent.KEYCODE_BACK && !state.needsSetup`, call `event?.startTracking()` and return `true`; in `onKeyLongPress`, open settings (`viewModel.openSettings()`). A short Back press during playback is ignored so accidental remote presses do not interrupt public signage.

### 4.3 `SettingsScreen` & Persistence

- Persisted in `SharedPreferences("sissi_tv_prefs", MODE_PRIVATE)`:
  - `server_url` (e.g. `https://host/signage`)
  - `screen_id` (e.g. `lobby`)
- On launch: if both `server_url` and `screen_id` are non-blank, `needsSetup = false` and playback starts immediately (from disk cache if offline). Otherwise show `SettingsScreen`.
- `SettingsScreen` fields (D-pad navigable Compose `OutlinedTextField`s + `Button`, matching `lcyt-tv`):
  - **Server URL**: validated as `http://` or `https://` via `HttpUrl.parse(...)`, normalized with `trim().trimEnd('/')`.
  - **Screen ID**: validated against `^[a-z0-9-]{1,40}$` (exact match to `SCREEN_ID_RE` in `src/api/read.mjs`).
  - **Save & Start** button (plus `ImeAction.Done` on the last field).

### 4.4 Orientation & Vertical Display Support

- `playlist.json` carries `"orientation": "landscape" | "vertical"`.
- Standard Android TV devices have fixed landscape HDMI panels and ignore or letterbox `SCREEN_ORIENTATION_PORTRAIT`, while commercial vertical signage boxes either rotate at the OS/firmware level or feed a physically rotated 90°/270° monitor.
- Therefore, `MainActivity` does **not** force `requestedOrientation` from `playlist.json`:
  - Images render with `ContentScale.Fit` on a `Color.Black` background.
  - Videos render in Media3 `PlayerView` with `resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT` and `setShutterBackgroundColor(android.graphics.Color.BLACK)`.
  - This matches `object-fit: contain` on black from Step 1 (§5): portrait assets center cleanly on landscape TVs and fill portrait-configured Android displays without distortion.

---

## 5. Playlist Sync & Offline Disk Cache

### 5.1 Disk Layout (`context.filesDir`)

```text
filesDir/
├── playlist.json              # Last complete, fully-cached playlist JSON
├── playlist.json.tmp          # Atomic write staging
└── media/
    ├── <sha256>.png           # Verified immutable media files
    ├── <sha256>.mp4
    └── <sha256>.mp4.tmp       # In-flight download staging (cleaned on startup)
```

### 5.2 Atomic Media Download & Verification (`MediaCacheManager`)

For each entry in a fetched `Playlist`:
1. Target path: `filesDir/media/<sha256>.<ext>` (extension extracted from `entry.url` path, e.g. `png`, `jpg`, `webp`, `mp4`, validated as `[a-z0-9]+`).
2. If the target file already exists and `length() > 0`, skip download (content-addressed immutability).
3. Otherwise stream `GET <resolvedUrl>` via OkHttp into `filesDir/media/<sha256>.<ext>.tmp` while feeding bytes into `MessageDigest.getInstance("SHA-256")`.
4. After stream EOF, compare computed lowercase hex digest against `entry.sha256`:
   - **Mismatch** or **I/O error** or **non-2xx HTTP**: delete `.tmp` and fail the sync attempt for that file.
   - **Match**: `tmpFile.renameTo(targetFile)` (atomic rename on the same filesystem).
5. On app startup, delete any leftover `*.tmp` files in `filesDir/` and `filesDir/media/`.

### 5.3 Sync Loop, Offline Persistence & Pruning (`PlaylistSyncer`)

1. **Cold boot / offline startup**:
   - `SignageViewModel` immediately reads `filesDir/playlist.json` on `Dispatchers.IO`. If present and valid, playback starts right away without waiting for the network.
2. **Polling & backoff**:
   - Poll `GET <serverUrl>/s/<screenId>/playlist.json` every **60 s** on success.
   - On network failure or non-200 HTTP response, retry with exponential backoff: `5s → 10s → 20s → 40s → 60s` (capped at 60 s), resetting to 60 s on the next 200 OK.
3. **Commit & prune rule**:
   - When a new `playlist.json` arrives (with `version != lastSyncedVersion`, or when local `playlist.json` is missing):
     - Download all missing media files for its entries.
     - **Only if all entries succeed**: atomically write `filesDir/playlist.json`, emit the new `Playlist` to `SignageViewModel` as `pendingPlaylist`, and prune any file in `filesDir/media/` whose filename is not referenced by either the currently playing playlist or `pendingPlaylist`.
     - **If any entry fails mid-sync** (e.g. network drops): do **not** overwrite `filesDir/playlist.json` and do **not** prune `filesDir/media/`. The player keeps looping the last complete cached playlist and retries on the next backoff tick.
   - Note on `404 SCREEN_NOT_FOUND`: do not prune or clear `filesDir/playlist.json` automatically on transient 404s; keep polling with backoff. (If an operator switches screens in `SettingsScreen`, `SignageViewModel` clears `filesDir/playlist.json` and resets state.)

---

## 6. Playback State Machine

### 6.1 State & Version Transitions (`SignageViewModel`)

- `activePlaylist: Playlist?` — currently looping playlist.
- `pendingPlaylist: Playlist?` — newly synced playlist waiting for an entry boundary.
- `currentIndex: Int` — index in `activePlaylist.entries`.
- **Entry boundary rule**:
  - When the current slide/video finishes (or errors/times out), `advanceToNext()`:
    - If `pendingPlaylist != null`, promote `activePlaylist = pendingPlaylist`, set `pendingPlaylist = null`, and set `currentIndex = 0`.
    - Otherwise advance `currentIndex = (currentIndex + 1) % activePlaylist.entries.size`.
  - If `activePlaylist` is empty or `null` (neutral black screen), a newly arrived `pendingPlaylist` with entries is promoted immediately.
- **Defense-in-depth**: if the resolved local file `filesDir/media/<sha256>.<ext>` is missing on disk when an entry's turn starts, skip immediately to the next entry (with a short `100ms` guard delay if all entries are missing so the coroutine never busy-spins).

### 6.2 Image Playback & Preloading

- Rendered with Compose `Crossfade(targetState = activeSlideKey, animationSpec = tween(500))` over a `Color.Black` `Box` (`Modifier.fillMaxSize()`), using Coil `AsyncImage` with `ContentScale.Fit` loading `File(mediaDir, filename)`.
- While the current image is displayed for `entry.seconds * 1000L` ms:
  - If the next entry is an image, preload it into Coil's memory cache via `imageLoader.enqueue(ImageRequest.Builder(context).data(nextFile).build())`.

### 6.3 Video Playback (`Media3 ExoPlayer`)

- A single `ExoPlayer` instance is owned by `SignageViewModel` (or `PlayerScreen` via `DisposableEffect`, released on `onCleared()` / dispose) to avoid repeated hardware codec allocation.
- Rendered via `AndroidView` hosting `PlayerView(context)` with:
  - `useController = false`
  - `resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT`
  - `setShutterBackgroundColor(android.graphics.Color.BLACK)`
  - `repeatMode = Player.REPEAT_MODE_OFF`
- When a video entry starts:
  1. Set `MediaItem.fromUri(Uri.fromFile(mediaFile))`, `prepare()`, `playWhenReady = true`.
  2. Start a safety timeout coroutine for `(entry.seconds + 5) * 1000L` ms (cancels if the entry advances earlier).
  3. Advance to next entry on whichever happens first:
     - `Player.Listener.onPlaybackStateChanged(Player.STATE_ENDED)`
     - `Player.Listener.onPlayerError(...)` (immediate skip, no error text on screen)
     - Safety timeout expiring.
- **Single-video playlist optimization**: if `activePlaylist.entries.size == 1` and `pendingPlaylist == null`, on `STATE_ENDED` simply `seekTo(0); play()` without recreating the `MediaItem`.

### 6.4 Empty / Unready State

- When `activePlaylist == null` or `activePlaylist.entries.isEmpty()`, `PlayerScreen` renders only `Box(Modifier.fillMaxSize().background(Color.Black))` — **no status text, spinners, or error messages** on the public display.

---

## 7. Testing & Verification Plan

### 7.1 JVM Unit Tests (`app/src/test/java/fi/sissi/tv/data/`)

1. **`PlaylistParserTest`**:
   - Parses valid `playlist.json` (`screenId`, `version`, `orientation`, `entries`).
   - Resolves root-relative `url` (`/signage/media/<sha>.png`) against `https://host/signage` → `https://host/signage/media/<sha>.png`.
   - Rejects malformed JSON / invalid `screenId` cleanly without throwing uncaught exceptions.
2. **`MediaCacheManagerTest`** (with `MockWebServer` + `@Rule TemporaryFolder`):
   - Downloads media, verifies SHA-256, atomically renames `.tmp` → `<sha256>.<ext>`.
   - Rejects SHA-256 mismatch, deletes `.tmp`, returns failure.
   - Skips network request when `<sha256>.<ext>` already exists.
   - `prune(keepFilenames)` deletes unreferenced files and preserves referenced ones.
3. **`PlaylistSyncerTest`** (with `MockWebServer` + `@Rule TemporaryFolder`):
   - `200 OK` → downloads all media → persists `playlist.json` → emits playlist → prunes stale media.
   - Network error / `500` / `404` → preserves existing `playlist.json` and existing media files.
   - Partial media download failure → does **not** overwrite `playlist.json` and does **not** prune existing media.

### 7.2 Build & Lint Verification

Run from `clients/android/`:
```bash
./gradlew testDebugUnitTest
./gradlew assembleDebug
./gradlew lintDebug
```

### 7.3 Manual Device / Emulator Verification

- Install `app-debug.apk` on Android TV emulator (API 34/35) or physical TV box (`adb install`).
- Verify first-launch `SettingsScreen` D-pad navigation, validation, and `SharedPreferences` persistence across app restart.
- Verify deep-link launch: `adb shell am start -a android.intent.action.VIEW -d "sissi-tv://screen?server=https://...&screen=lobby"`.
- Verify `KEYCODE_MENU` and long-press `KEYCODE_BACK` open `SettingsScreen`.
- Verify image crossfade timing, video `STATE_ENDED` advance, `version` update at entry boundary (not mid-slide), and offline reboot looping with Wi-Fi/Ethernet disconnected.
