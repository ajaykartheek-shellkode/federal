#!/usr/bin/env bash
# Serve GL Portal over HTTPS on a hostname of your own, with a free Let's Encrypt certificate.
#
# Use this instead of tunnel-server.sh when you want an address that never changes — a quick
# Cloudflare tunnel picks its own random four-word hostname and drops it on every restart.
#
# Before running, three things must be true:
#   1. You own a hostname pointing at this instance's PUBLIC IP. No domain? Claim a free one at
#      https://www.duckdns.org (sign in, pick a label, set the IP) — e.g. glportal.duckdns.org.
#   2. Ports 80 and 443 are open to 0.0.0.0/0 in the instance's security group. Let's Encrypt
#      proves you control the host by fetching a file over port 80.
#   3. The portal is already deployed and running (/root/deploy.sh).
#
# Then, as root:
#   bash tls-server.sh glportal.duckdns.org you@example.com
#
# Renewal is automatic (certbot installs a systemd timer). Check it with:
#   certbot renew --dry-run
set -euo pipefail

HOST=${1:-}
EMAIL=${2:-}
PORT=3001   # the Next.js frontend; it proxies /api/* to the backend itself

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash tls-server.sh <hostname> <email>" >&2; exit 1; }
[[ -n "$HOST" && -n "$EMAIL" ]] || { echo "Usage: bash tls-server.sh <hostname> <email>" >&2; exit 1; }

echo "==> Checking that $HOST points here"
RESOLVED=$(getent hosts "$HOST" | awk '{print $1}' | head -1 || true)
PUBLIC=$(curl -fsS --max-time 10 https://checkip.amazonaws.com || true)
echo "    $HOST -> ${RESOLVED:-nothing}   ·   this instance -> ${PUBLIC:-unknown}"
if [[ -n "$RESOLVED" && -n "$PUBLIC" && "$RESOLVED" != "$PUBLIC" ]]; then
  echo "!! $HOST does not resolve to this instance. Fix the DNS record first, then re-run." >&2
  exit 1
fi

echo "==> Installing nginx + certbot"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx

echo "==> Writing the site"
cat > /etc/nginx/sites-available/gl-portal <<NGINX
server {
    listen 80;
    server_name $HOST;

    # Collateral photos and ID proofs: 15 MB per file, up to 3 at a time.
    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";

        # Workflow steps stream progress as Server-Sent Events and a model call can take minutes:
        # never buffer the response, and don't time the connection out mid-step.
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/gl-portal /etc/nginx/sites-enabled/gl-portal
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Requesting the certificate"
certbot --nginx -d "$HOST" --agree-tos -m "$EMAIL" --redirect --non-interactive

echo
echo "  GL Portal is live at:  https://$HOST"
echo "  Camera capture works there, and the address never changes."
echo
echo "  The Cloudflare tunnel is no longer needed — stop it with:"
echo "    systemctl disable --now gl-portal-tunnel"
