# Deploy & run

Single-owner inventory system. One Node process serves the API **and** the web UI on
one port. Default datastore is embedded PGlite (a file directory) — no separate database
server needed. Node 20.12+ required.

---

## 1. First-time setup

```bash
npm ci
npm run build            # builds shared + server + web
cp .env.example .env
```

Edit `.env`:

| key | what to set |
| --- | --- |
| `PORT` | port to listen on (default 4000) |
| `PGLITE_DATA_DIR` | database directory, relative to `packages/server` (default `./data`). **This folder is your data — back it up.** |
| `BACKUP_PASSPHRASE` | a long random string. Backups are AES-256-GCM encrypted with it. **Store it separately — lost passphrase = unrecoverable backups.** |
| `APP_PIN` | leave blank for an open app (localhost, single user), or set a PIN to require unlock on load |
| `WEB_DIST_DIR` | absolute path to `packages/web/dist` (or leave unset and use `./run.sh`, which fills it in) |
| `DATABASE_URL` | optional — point at a real PostgreSQL instead of PGlite |

## 2. Run

```bash
./run.sh
```

Then open **http://localhost:PORT** (default http://localhost:4000).

`./run.sh` loads `.env` via `node --env-file` and starts `packages/server/dist/index.js`.
Migrations run automatically on boot. To rebuild first: `./run.sh --build`.

### Run it as an always-on service (WSL + systemd)

WSL on Windows 11 runs systemd. Install the bundled unit once:

```bash
sudo cp deploy/inventory.service /etc/systemd/system/inventory.service
sudo systemctl daemon-reload
sudo systemctl enable --now inventory
systemctl status inventory --no-pager        # expect: active (running)
journalctl -u inventory -f                    # live logs
```

It restarts on crash (`Restart=always`) and starts whenever WSL boots.
After a code change: `npm run build && sudo systemctl restart inventory`.

To bring WSL (and the service) up at Windows login — PowerShell **as admin**, once:

```powershell
$a = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d Ubuntu --exec /bin/true"
Register-ScheduledTask -TaskName "Start WSL Inventory" -Action $a `
  -Trigger (New-ScheduledTaskTrigger -AtLogOn) -RunLevel Highest
```

Edit `deploy/inventory.service` if your Linux username, repo path, or Node path differ
(`whoami`, `pwd`, `which node`).

### Or run it in Docker

`Dockerfile` + `docker-compose.yml` are in the repo. One container serves the API + web
UI; the database and backups live in named volumes.

```bash
cp .env.example .env      # edit APP_PIN and BACKUP_PASSPHRASE
docker compose up -d --build
docker compose logs -f    # watch it come up
```

Open **http://localhost:4000**. `restart: unless-stopped` brings it back after a crash or
a Docker restart; enable "start Docker on login" for boot.

- `.env` supplies `APP_PIN` / `BACKUP_PASSPHRASE`; compose fixes `HOST`, `PORT`,
  and the `/data` + `/backups` paths. `.env` is **not** copied into the image.
- **Rebuild after a code change:** `docker compose up -d --build`.
- **Reuse an existing `packages/server/data`** instead of a fresh volume — either swap the
  compose volumes for bind mounts (`- ./packages/server/data:/data`,
  `- ./packages/server/backups:/backups`) or seed the named volume once:
  `docker run --rm -v inventory-data:/data -v "$(pwd)/packages/server/data":/src alpine sh -c 'cp -a /src/. /data/'`
- **LAN access:** with Docker Desktop the published port lands on the Windows host, so
  other machines reach `http://<this-PC-LAN-IP>:4000` after the firewall rule (no WSL
  networking config needed). Docker running *inside* WSL has the same
  mirrored-networking / portproxy caveat as the bare-metal setup.
- **Back up the volumes:** `docker run --rm -v inventory-data:/data -v "$(pwd)":/out alpine tar czf /out/inventory-data.tgz -C /data .`

## 3. Data & backups

- **Database:** everything lives in `PGLITE_DATA_DIR` (`packages/server/data` by default).
  Copy that folder to back up the raw store.
- **App backups:** the UI's **สำรองข้อมูล** tab (or `POST /api/backups`) writes a verified,
  encrypted `.invbak` file to `BACKUP_DIR` (`packages/server/backups`). Restore from the
  same tab — it takes a pre-restore auto-backup, checks the sha256 + passphrase, and
  refuses a backup newer than the running app.
- Schedule a daily backup with cron / Task Scheduler:
  `curl -s -X POST http://localhost:4000/api/backups -H 'content-type: application/json' -d '{}'`
  (add the unlock cookie / `-d '{"passphrase":"..."}'` if a PIN is set and you didn't set `BACKUP_PASSPHRASE`).

## 4. Importing your stock file

**นำเข้า/ส่งออก** tab → pick **ยอดยกมา (Master Stock 68)** → choose the `.xlsx`/`.csv`.
Recognised column headers (Thai or English, any order):

- SKU: `รหัสสินค้า` / `sku` / `code`
- name: `ชื่อสินค้า` / `name`
- opening qty: `ยอดคงเหลือ` / `คงเหลือ` / `ยอดยกมา` / `stock_68`
- unit (optional): `หน่วยนับ` / `หน่วย` / `unit` — unknown labels import as `piece` with a warning
- opening cost (optional): `ราคา` / `ต้นทุน` / `unit_cost`
- min stock (optional): `ขั้นต่ำ` / `min_stock`

Rows with a blank SKU or an unparseable number are skipped; use **PARTIAL** mode to
commit the good rows, then download the invalid-rows file, fix, and re-import (unchanged
rows are detected as duplicates and not re-posted).

## 5. Health & ops

- `GET /api/health` — liveness + schema version.
- `POST /api/reconcile {"autoHeal":true}` — replays the ledger and repairs the
  `stock_state` cache if it ever drifts.
- Logs go to stdout (pino JSON). `LOG_LEVEL=info` is a good default.

## 6. Known gaps (see `PROGRESS.md` §24.1)

- No cloud backup / off-machine copy yet — copy `BACKUP_DIR` somewhere safe yourself.
- `APP_PIN` is a single shared PIN, not multi-user (by design — see spec non-goals).
- `xlsx` parser has a known advisory; only feed it files you trust (your own exports).
- Bind to `127.0.0.1` (the default `HOST`) unless you add TLS + a stronger auth layer.
