# Deploying VGCtool (OVH VPS, Ubuntu + Docker Compose + Caddy)

This stack runs two containers:

- **web** (Caddy) — serves the built frontend, reverse-proxies `/api` and
  `/sprites` to the backend, and gets **HTTPS automatically**. This is the only
  thing exposed to the internet (ports 80/443).
- **backend** (Node) — Express + Socket.IO + sql.js. Not exposed directly; only
  reachable inside Docker as `backend:3001`. Its data lives in two host folders
  so redeploys never wipe it.

Redeploying a new version is **one command** (see step 7).

---

## 1. Get the code onto GitHub (one time, from your Windows machine)

Your project isn't a git repo yet. In the project folder (`pokemon-vgc`):

```bash
git init
git add .
git commit -m "Initial commit"
```

Create an **empty private repo** on github.com, then:

```bash
git remote add origin https://github.com/<you>/pokemon-vgc.git
git branch -M main
git push -u origin main
```

The `.gitignore` already excludes `node_modules`, the DB, sprites, and `.env`,
so none of that (or your secrets) gets pushed.

---

## 2. Point your domain at the VPS (DNS)

In your domain registrar's DNS settings, add an **A record**:

| Type | Name | Value |
|------|------|-------|
| A | `@` (or `vgctool`, for a subdomain) | your VPS public IPv4 |

Use `@` for `yourdomain.com`, or a subdomain label like `vgctool` for
`vgctool.yourdomain.com`. DNS can take a few minutes to a few hours to
propagate. **Caddy can't issue the HTTPS certificate until this resolves**, so
do this before step 6.

Check it from your machine: `nslookup yourdomain.com` should return the VPS IP.

---

## 3. Connect to the VPS and install Docker

SSH in (OVH emails you the IP and root/ubuntu credentials):

```bash
ssh ubuntu@<vps-ip>      # or root@<vps-ip>
```

Install Docker Engine + the Compose plugin (official convenience script):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER        # run docker without sudo
```

Log out and back in (so the group change applies), then verify:

```bash
docker --version
docker compose version
```

---

## 4. Open the firewall (if UFW is enabled)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable          # skip if you don't use ufw
```

---

## 5. Clone the project and set the domain

```bash
git clone https://github.com/<you>/pokemon-vgc.git
cd pokemon-vgc
cp .env.example .env
nano .env                # set DOMAIN=yourdomain.com  (no https://, no slash)
```

---

## 6. Build and launch

```bash
docker compose up -d --build
```

First boot does two slow things, both normal:

1. Builds the images (a few minutes).
2. The backend runs its **startup data sync** (Smogon/Showdown). Until it
   finishes, API calls may return errors and the page will look empty. Watch it:

   ```bash
   docker compose logs -f backend
   ```

   Wait for `[app] Running on http://localhost:3001`. Caddy will also log when it
   obtains the TLS certificate.

Then open `https://yourdomain.com` — you should have a working, HTTPS site.

---

## 7. Deploying a new version (the everyday command)

From your machine: commit and push as usual. Then on the server:

```bash
cd pokemon-vgc
git pull
docker compose up -d --build
```

This rebuilds only what changed and swaps the containers in place. **Your DB and
sprites are untouched** (they live in bind-mounted folders, not the images).

To roll back: `git checkout <previous-commit> && docker compose up -d --build`.

---

## 8. Backups (do this — the DB is a single file)

Everything important is in `backend/data/` (the `vgc.db` file + caches). Back it
up on a schedule:

```bash
# manual snapshot
cp backend/data/vgc.db ~/backups/vgc-$(date +%F-%H%M).db
```

A simple daily cron (run `crontab -e`):

```
0 4 * * * cp /home/ubuntu/pokemon-vgc/backend/data/vgc.db /home/ubuntu/backups/vgc-$(date +\%F).db
```

This is **separate from** OVH's daily VPS snapshot — keep both. Live tournament
state is in this file, so frequent copies are cheap insurance.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| HTTPS doesn't come up / cert error | DNS not pointing at the VPS yet, or port 80/443 blocked. Confirm `nslookup yourdomain.com` returns the VPS IP; check `docker compose logs web`. |
| Site loads but data is empty | Startup sync still running or failed. `docker compose logs -f backend`. |
| WebSocket / live tournament not updating | Make sure you're on `https://` and the domain matches `DOMAIN` in `.env` (the Socket origin check uses it). |
| Backend keeps restarting | `docker compose logs backend` — usually an env or data-folder permission issue. |
| Changed the domain | Edit `.env`, then `docker compose up -d --build` (the frontend bundle bakes in the API URL, so it must rebuild). |
| Out of memory during sync | You're likely on too small a VPS — 8 GB (OVH VPS-2) is the recommended floor. |

## Useful commands

```bash
docker compose ps                 # what's running
docker compose logs -f backend    # follow backend logs
docker compose logs -f web        # follow Caddy logs
docker compose restart backend    # restart just the backend
docker compose down               # stop everything (data is preserved)
```
