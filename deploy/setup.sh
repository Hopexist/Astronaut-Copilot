#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 22.04/24.04 Vultr instance. Run as root.
#   1. copy the app to /opt/copilot (see the tar/scp commands in CLAUDE.md, "Deploy")
#   2. create /opt/copilot/.env with GEMINI_API_KEY and ELEVENLABS_API_KEY
#   3. bash /opt/copilot/deploy/setup.sh [hostname]
# Without a hostname it uses <ip>.sslip.io, which resolves to the server's IP and gets a free HTTPS cert.
# HTTPS is required: browsers only allow the microphone on secure origins.
set -euo pipefail
APP=/opt/copilot
[ -f "$APP/.env" ] || { echo "Missing $APP/.env (GEMINI_API_KEY, ELEVENLABS_API_KEY)"; exit 1; }
IP=$(curl -s4 https://ifconfig.me)
HOST=${1:-${IP//./-}.sslip.io}

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3-venv python3-pip curl gpg ufw debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y && apt-get install -y caddy

id copilot >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin copilot
python3 -m venv "$APP/.venv"
"$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"
chown -R copilot:copilot "$APP"; chmod 600 "$APP/.env"

# One worker only: the telemetry simulator and the rate limiter live in process memory.
# --proxy-headers makes request.client the real visitor (from Caddy's X-Forwarded-For), so the
# per-client rate limit works behind the proxy.
cat > /etc/systemd/system/copilot.service <<UNIT
[Unit]
Description=Astronaut Copilot
After=network.target
[Service]
User=copilot
WorkingDirectory=$APP
ExecStart=$APP/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=always
[Install]
WantedBy=multi-user.target
UNIT

printf '%s {\n\treverse_proxy 127.0.0.1:8000\n}\n' "$HOST" > /etc/caddy/Caddyfile

ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable
systemctl daemon-reload
systemctl enable --now copilot
systemctl restart caddy
echo "Live at https://$HOST (the certificate can take about a minute the first time)"
