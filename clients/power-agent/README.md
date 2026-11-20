# SiSSi LAN Power Agent

Lightweight, zero-dependency **Node 24 ESM** agent that runs on a Raspberry Pi (e.g. Pi Zero W / Zero 2 W) or any Linux host on the same LAN as your displays.

It polls the SiSSi server over outbound HTTPS (`GET /api/v1/power/desired`) and controls local displays:

- **Turn ON:** sends 3x Wake-on-LAN (WoL) UDP magic packets to `255.255.255.255:9` (or `SISSI_WOL_BROADCAST`).
- **Turn OFF (Samsung Tizen):** connects over TLS WebSocket (`wss://<ip>:8002`) and sends `KEY_POWER` only when the TV is reachable.
- **Turn OFF (Android TV):** runs `adb connect <ip>:5555` and `adb -s <ip>:5555 shell input keyevent KEYCODE_SLEEP`.

## Prerequisites

- **Node.js 24+** (`node -v`). No `npm install` is required.
- For Android TVs: `adb` installed (`sudo apt install android-tools-adb`).
- On Samsung TVs: enable **Power On with Mobile / Network Standby** (wired Ethernet recommended).

## One-time TV pairing

Run as the same user / `SISSI_POWER_DATA_DIR` that runs the service:

```bash
# Samsung Tizen TV (accept "Allow device?" on the TV remote)
SISSI_POWER_DATA_DIR=/var/lib/sissi-power-agent node src/cli.mjs pair-samsung 192.168.10.42

# Android TV (accept "Always allow from this computer" on the TV)
node src/cli.mjs pair-adb 192.168.10.43
```

## Running with systemd

```bash
sudo useradd -r -s /usr/sbin/nologin sissi || true
sudo mkdir -p /opt/sissi-power-agent /etc/sissi-power-agent /var/lib/sissi-power-agent
sudo cp -r start.mjs src /opt/sissi-power-agent/
sudo cp deploy/power-agent.env.example /etc/sissi-power-agent/power-agent.env
sudo chown -R sissi:sissi /var/lib/sissi-power-agent
sudo chmod 600 /etc/sissi-power-agent/power-agent.env

# Edit /etc/sissi-power-agent/power-agent.env with your SISSI_URL and SISSI_AGENT_TOKEN
sudo cp deploy/sissi-power-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sissi-power-agent
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `SISSI_URL` | *(required)* | SiSSi base URL (e.g. `https://example.org/signage`) |
| `SISSI_AGENT_TOKEN` | *(required)* | Bearer token matching the LAN's `SISSI_AGENT_TOKENS` entry |
| `SISSI_POWER_DATA_DIR` | `/var/lib/sissi-power-agent` | Directory for `tokens.json` |
| `SISSI_POLL_SECONDS` | `60` | Poll interval in seconds (exponential backoff up to 300s on failure) |
| `SISSI_WOL_BROADCAST` | `255.255.255.255` | UDP broadcast address (or comma-separated list) for WoL |
