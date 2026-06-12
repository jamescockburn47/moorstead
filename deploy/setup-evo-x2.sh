#!/usr/bin/env bash
# Moorstead one-shot setup for the EVO X2 (Ubuntu/Debian, Ryzen AI Max+ 395).
# Run from a directory containing Moorcraft/ and yorkshire_bot/ side by side:
#   sudo bash Moorcraft/deploy/setup-evo-x2.sh
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
SRC_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
echo "==> Source dir: $SRC_DIR"
[ -d "$SRC_DIR/Moorcraft" ] || { echo "Moorcraft/ not found next to yorkshire_bot/"; exit 1; }
[ -d "$SRC_DIR/yorkshire_bot" ] || { echo "yorkshire_bot/ not found"; exit 1; }

echo "==> System packages"
apt-get update -qq
apt-get install -y -qq curl git python3-venv python3-pip debian-keyring debian-archive-keyring apt-transport-https

# --- Node 20 (build the game) -----------------------------------------------
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  echo "==> Installing Node 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

# --- Caddy -------------------------------------------------------------------
if ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi

# --- Ollama ------------------------------------------------------------------
if ! command -v ollama >/dev/null; then
  echo "==> Installing Ollama"
  curl -fsSL https://ollama.com/install.sh | sh
fi
echo "==> Tuning Ollama for multi-player serving"
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/moorstead.conf <<'EOF'
[Service]
Environment="OLLAMA_NUM_PARALLEL=4"
Environment="OLLAMA_KEEP_ALIVE=24h"
Environment="OLLAMA_FLASH_ATTENTION=1"
EOF
systemctl daemon-reload
systemctl enable --now ollama

# --- service user & layout ----------------------------------------------------
id -u moorstead >/dev/null 2>&1 || useradd -r -m -d /var/lib/moorstead -s /usr/sbin/nologin moorstead
mkdir -p /opt/moorstead /etc/moorstead /var/lib/moorstead/brain_memory

echo "==> Installing yorkshire_bot (brain)"
rsync -a --delete \
  --exclude venv --exclude __pycache__ --exclude .pytest_cache \
  --exclude game --exclude game2 --exclude frontend --exclude eval \
  --exclude 'brain_memory*' --exclude '*.log' \
  "$SRC_DIR/yorkshire_bot/" /opt/moorstead/yorkshire_bot/

echo "==> Python venv for t' brain"
python3 -m venv /opt/moorstead/venv
/opt/moorstead/venv/bin/pip install -q --upgrade pip
/opt/moorstead/venv/bin/pip install -q -r /opt/moorstead/yorkshire_bot/requirements.txt

echo "==> Building t' game"
cd "$SRC_DIR/Moorcraft"
sudo -u "${SUDO_USER:-root}" npm ci 2>/dev/null || npm ci
sudo -u "${SUDO_USER:-root}" npm run build 2>/dev/null || npm run build
mkdir -p /opt/moorstead/game
rsync -a --delete dist/ /opt/moorstead/game/

echo "==> Brain config"
if [ ! -f /etc/moorstead/brain.env ]; then
  cat > /etc/moorstead/brain.env <<'EOF'
# Set by deploy/bench_models.py — or pick your own (ollama pull <model> first)
BRAIN_MODEL=llama3.2:3b
BRAIN_MEMORY_DIR=/var/lib/moorstead/brain_memory
PYTHONUTF8=1
EOF
fi
chown -R moorstead:moorstead /opt/moorstead/yorkshire_bot /var/lib/moorstead

echo "==> Services"
cp "$SRC_DIR/Moorcraft/deploy/moorstead-brain.service" /etc/systemd/system/
cp "$SRC_DIR/Moorcraft/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now moorstead-brain
systemctl restart caddy

echo
echo "=============================================================="
echo " Moorstead is up on this box:  http://localhost:8080"
echo
echo " Next steps:"
echo "  1. Pick t' best brain model for this hardware:"
echo "       /opt/moorstead/venv/bin/python $SRC_DIR/Moorcraft/deploy/bench_models.py --apply"
echo "  2. Expose it to t' world (quick tunnel, random URL):"
echo "       cloudflared tunnel --url http://localhost:8080"
echo "     (see deploy/README.md for a permanent named tunnel + domain)"
echo "=============================================================="
