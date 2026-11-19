# Step 3: Pi Zero LAN Power Agent (plan)

Status: **plan, not built** (2026-11-19). Handles scheduled and manual power on/off for TVs on each local network using a single tiny Pi Zero (or any existing Pi) per LAN.

## 1. Why a tiny LAN agent

- **Turning TVs ON** uses Wake-on-LAN (WoL), which is a Layer-2 UDP broadcast (`255.255.255.255:9`). A routed VPN or VPS cannot send Layer-2 broadcasts across the internet.
- **Turning TVs OFF** uses local TCP protocols on the LAN (`wss://<tv-ip>:8002` for Samsung Tizen, `adb <tv-ip>:5555` for Android TV).
- Running one small agent per LAN that **polls SiSSi over outbound HTTPS** requires no VPN, no open firewall ports, and no router configuration.

## 2. SiSSi server additions (small, step-1 compatible)

Each screen in SiSSi gets an optional `power` block (edited on `/admin`, omitted when unused):

```json
{
  "lanId": "church-main",
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

- `driver`: `"none"` | `"samsung-lan"` | `"android-adb"` | `"wol-only"`.
- `override`: `"auto"` (follow schedule) | `"on"` | `"off"` (manual button in `/admin` for special events).

### Agent API (`/api/v1/power/*`)

Auth: static Bearer token (`SISSI_AGENT_TOKENS=<lanId>:<token>,...`), separate from Canva and Admin auth.

- `GET /api/v1/power/desired` → returns only screens matching the token's `lanId`:
  ```json
  {
    "lanId": "church-main",
    "serverTime": "2026-11-19T21:15:00Z",
    "devices": [
      { "screenId": "lobby", "driver": "samsung-lan", "mac": "AA:BB:CC:DD:EE:FF", "ip": "192.168.10.42", "desiredState": "on" }
    ]
  }
  ```
- `POST /api/v1/power/report` → agent reports `{ devices: [{ screenId, reachable, lastAction, error }] }` so `/admin` shows a simple online/standby dot and last wake/sleep time.

## 3. Pi Zero agent (`clients/power-agent/`)

Single small **Node 24 ESM** script (~200–300 lines total, **zero npm dependencies**), running on a Pi Zero W / Zero 2 W (or sharing an existing Pi).

### Loop (every 60 s)
1. `GET <SISSI_URL>/api/v1/power/desired`. If offline, keep retrying with backoff (no state changes while disconnected).
2. For each device:
   - **Probe** current reachability (TCP connect with 1.5 s timeout to port `8001`/`8002` for Samsung, or `5555` for Android ADB).
   - If `desiredState === "on"` and **not reachable**: send 3x UDP WoL magic packets (`6x 0xFF` + `16x MAC`) to `255.255.255.255:9` (and subnet broadcast if configured).
   - If `desiredState === "off"` and **reachable**:
     - `samsung-lan`: connect to `wss://<ip>:8002/api/v2/channels/samsung.remote.control?name=U2lTU2k=&token=<savedToken>` and send `KEY_POWER`. (Never send `KEY_POWER` when already unreachable, so an off TV is never accidentally toggled on.)
     - `android-adb`: run `adb connect <ip>:5555` + `adb -s <ip>:5555 shell input keyevent KEYCODE_SLEEP` (`KEYCODE_SLEEP` is idempotent and will not wake a sleeping device).
3. `POST /api/v1/power/report` with reachability and any action taken.

### One-time TV pairing
Samsung TVs show an "Allow device?" popup on first WebSocket control, and Android TVs show an ADB RSA prompt:
- `node clients/power-agent/cli.mjs pair-samsung <ip>` — connects, waits for user to press Allow on the TV remote, saves the returned Samsung token to `/var/lib/sissi-power-agent/tokens.json`.
- `node clients/power-agent/cli.mjs pair-adb <ip>` — runs `adb connect <ip>:5555` so you can accept "Always allow from this computer" on the TV.

## 4. Packaging & ops on Pi Zero

- `clients/power-agent/deploy/sissi-power-agent.service` (`systemd` unit, `Restart=always`, `User=sissi`).
- `clients/power-agent/deploy/power-agent.env.example`:
  - `SISSI_URL=https://example.org/signage`
  - `SISSI_AGENT_TOKEN=...`
  - `SISSI_POWER_DATA_DIR=/var/lib/sissi-power-agent`
  - `SISSI_POLL_SECONDS=60`
- Memory footprint: ~35 MB RSS, negligible CPU/network. Works on Raspberry Pi OS Lite (32-bit/64-bit).

## 5. Build & verification plan

1. **Server (`src/api/power.mjs` + `src/state/` + `public/admin/`):** schedule evaluator (timezone-aware), `/api/v1/power/*` endpoints, Admin UI power fields & On/Off/Auto override buttons, unit tests.
2. **Agent (`clients/power-agent/`):** WoL packet builder, reachability probe, Samsung WS client, ADB runner, pairing CLI, unit tests with mocked UDP/WebSocket/exec.
3. **Hardware check (manual):**
   - Enable *Network Standby / Power On with Mobile* on Samsung TV (prefer wired Ethernet).
   - Power off TV, wait **10+ minutes** for deep sleep, verify `pair-samsung` + WoL wakes it and `KEY_POWER` turns it off.
   - Verify Android TV `KEYCODE_SLEEP` + WoL (if supported by TV hardware).
