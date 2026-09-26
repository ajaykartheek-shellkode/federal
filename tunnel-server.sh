#!/usr/bin/env bash
# Put GL Portal behind a public HTTPS URL with a Cloudflare quick tunnel.
#
# Why: browsers only hand a page the camera on a *secure origin* (HTTPS, or localhost), so on the
# plain-HTTP EC2 address "Capture" can never work. The tunnel gives the portal a real certificate
# without a domain, DNS records or an open inbound port — cloudflared dials out.
#
# Install once on the EC2 instance, as root:
#   bash tunnel-server.sh
#
# Afterwards:
#   /root/tunnel-url.sh                      the current public URL
#   systemctl status gl-portal-tunnel        is it up
#   journalctl -u gl-portal-tunnel -n 50     why not
#
# NOTE: a quick tunnel's hostname is random and changes every time cloudflared restarts. Run
# /root/tunnel-url.sh before a demo to read the current one. For a hostname that never changes,
# put a domain on Cloudflare and swap this for a named tunnel (see the README).
set -euo pipefail

BIN=/usr/local/bin/cloudflared
LOG=/var/log/gl-portal-tunnel.log
PORT=3001   # the Next.js frontend; it proxies /api/* to the backend itself, so one tunnel is enough

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash tunnel-server.sh" >&2; exit 1; }

if ! command -v cloudflared >/dev/null; then
  ARCH=$(dpkg --print-architecture)   # amd64 | arm64
  echo "==> Installing cloudflared ($ARCH)"
  curl -fsSL -o /tmp/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}"
  install -m 0755 /tmp/cloudflared "$BIN"
fi
echo "    $($BIN --version)"

echo "==> Installing the service"
cat > /etc/systemd/system/gl-portal-tunnel.service <<UNIT
[Unit]
Description=GL Portal public HTTPS tunnel (Cloudflare)
After=network-online.target gl-portal-frontend.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BIN tunnel --no-autoupdate --url http://localhost:$PORT
Restart=always
RestartSec=5
StandardOutput=append:$LOG
StandardError=append:$LOG

[Install]
WantedBy=multi-user.target
UNIT

cat > /root/tunnel-url.sh <<URL
#!/usr/bin/env bash
# The public HTTPS address GL Portal is currently reachable on.
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' $LOG | tail -1
URL
chmod 700 /root/tunnel-url.sh

: > "$LOG"
systemctl daemon-reload
systemctl enable gl-portal-tunnel >/dev/null
systemctl restart gl-portal-tunnel

echo "==> Waiting for the public URL"
for _ in {1..40}; do
  URL=$(/root/tunnel-url.sh || true)
  [[ -n "${URL:-}" ]] && break
  sleep 2
done

if [[ -z "${URL:-}" ]]; then
  echo "!! No URL yet. Check: journalctl -u gl-portal-tunnel -n 50 --no-pager" >&2
  exit 1
fi

echo
echo "  GL Portal is live at:  $URL"
echo "  Camera capture works there; the plain http://<ip>:$PORT address stays camera-less."
echo "  Re-read it any time with: /root/tunnel-url.sh"
