# Step 3 (Push-Style): Server-Side Power Manager (plan)

Status: **implemented** (2026-11-20). Alternative / complement to the [Pi Zero LAN Power Agent](step-3-pi-zero-power.md) when the VPS already reaches the local network over a site-to-site VPN (e.g., WireGuard) and the site router exposes a Wake-on-LAN API or SSH command.

## 1. Why a push-style option

- **No extra on-site hardware:** Sites with a WireGuard/VPN tunnel back to the VPS and a router (MikroTik, OpenWrt, UniFi, etc.) that can send Layer-2 WoL packets do not need a dedicated Pi Zero.
- **Turning TVs ON:** The VPS cannot send a Layer-2 UDP broadcast across a routed VPN, so it asks the site's router (`webhook` HTTP call or `ssh` command) to broadcast the WoL magic packet for `mac`.
- **Turning TVs OFF:** Over the VPN/LAN, the VPS connects directly to each TV (`wss://<ip>:8002` for Samsung Tizen `KEY_POWER`, or `adb <ip>:5555` `KEYCODE_SLEEP` for Android TV) — and only when a TCP probe confirms the TV is currently reachable, so an off TV is never toggled back on.
- **Shared data model:** Both pull-style (Pi Zero agent) and push-style (VPS manager) read the exact same `screen.power` schedule, `override` (`auto` | `on` | `off`), and `driver` fields, and both update the same per-screen power status (`reachable`, `lastAction`, `error`, `updatedAt`) shown in `/admin`.

## 2. Screen `power` model & router config

Each screen has an optional `power` object:

```json
{
  "lanId": "church-main",
  "routerId": "mikrotik-main",
  "driver": "samsung-lan",
  "mac": "AA:BB:CC:DD:EE:FF",
  "ip": "192.168.10.42",
  "override": "auto",
  "schedule": {
    "timezone": "Europe/Helsinki",
    "windows": [
      { "days": ["mon","tue","wed","thu","fri","sat","sun"], "start": "08:00", "end": "20:00" }
    ]
  }
}
```

- `driver`: `"none"` | `"pull"` | `"samsung-lan"` | `"android-adb"` | `"wol-only"` | `"router-wol"`.
- `routerId`: when set (non-empty), the server's push-style `PowerManager` owns this screen; when omitted, a pull-style LAN agent matching `lanId` owns it.

### Environment variables (`src/config.mjs`)

- `SISSI_POWER_ROUTERS`: JSON object mapping `routerId` to:
  - `type: "webhook"` — `url`, optional `method` (default `POST`), `headers`, `bodyTemplate` (supports `${mac}`, `${ip}`, `${screenId}` substitution).
  - `type: "ssh"` — `host`, optional `user`, optional `port`, `commandTemplate` (supports `${mac}`, `${ip}`, `${screenId}`).
- `SISSI_POWER_POLL_SECONDS`: poll interval in seconds (default `60`).
- `SISSI_POWER_DATA_DIR`: directory for persisted Samsung WS pairing tokens (`tokens.json`) on the VPS.
- `SISSI_AGENT_TOKENS`: comma-separated `lanId:token` pairs for pull-style LAN agents.

## 3. Server components

- `src/power/schedule.mjs`: `evaluateSchedule(power, now)` → `'on' | 'off' | null` (handles `override`, `Intl.DateTimeFormat` timezones, and standard + overnight `HH:MM` windows).
- `src/power/drivers.mjs`: TCP reachability probe, router WoL (`webhook` via `fetch`, `ssh` via `execFile`), Samsung TLS WebSocket `KEY_POWER` + token persistence, and Android ADB `KEYCODE_SLEEP`.
- `src/power/manager.mjs`: `createPowerManager({ config, state, fetch?, execFile?, now? })` polling loop wired into `src/start.mjs`.
- `src/api/power.mjs`: `GET /api/v1/power/desired` and `POST /api/v1/power/report` for pull-style agents.
- `src/api/admin.mjs` + `public/admin/`: screen `power` editing, `POST /api/v1/admin/screens/:screenId/power/override`, and live reachability badge.
