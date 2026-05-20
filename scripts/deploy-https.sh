#!/bin/bash
# 给 tendapp.cn 申请 Let's Encrypt 证书 + 配 HTTPS
# 先决条件：HTTP 80 已可访问（执行过 deploy-aliyun-ecs.sh）

set -euo pipefail

DOMAIN="${DOMAIN:-tendapp.cn}"
APP_PORT="${APP_PORT:-3000}"
EMAIL="${EMAIL:-}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }

[ "$(id -u)" -eq 0 ] || { err "请用 root 身份运行"; exit 1; }

if [ -z "$EMAIL" ]; then
  err "需要 EMAIL 环境变量（Let's Encrypt 注册联系邮箱）"
  echo "用法: EMAIL=your@mail.com bash $0"
  exit 1
fi

# 装 certbot
if ! command -v certbot >/dev/null 2>&1; then
  log "装 certbot"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq certbot >/dev/null
fi
ok "certbot $(certbot --version 2>&1 | head -1)"

# 用 webroot 方式，不让 certbot 自己改 nginx 配置（避免跟宝塔冲突）
log "申请证书（webroot 模式）"
mkdir -p /var/www/html
certbot certonly --webroot -w /var/www/html \
  -d "$DOMAIN" -d "www.$DOMAIN" \
  --email "$EMAIL" --agree-tos --non-interactive --keep-until-expiring

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  err "证书未生成: $CERT_DIR"
  exit 1
fi
ok "证书已签发: $CERT_DIR"

# 更新 Nginx 配置加 HTTPS
NGINX_CONF="/etc/nginx/conf.d/${DOMAIN}.conf"
log "更新 Nginx 配置加 443"
cat > "$NGINX_CONF" <<NGINX
# baozupo / 养房 Tend - HTTP + HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
    }

    # 所有 HTTP 流量重定向到 HTTPS
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN} www.${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    client_max_body_size 20m;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
    }

    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log  /var/log/nginx/${DOMAIN}.error.log;
}
NGINX

if nginx -t >/dev/null 2>&1; then
  nginx -s reload 2>/dev/null || systemctl reload nginx
  ok "Nginx HTTPS 配置生效"
else
  err "Nginx 配置语法错误"
  nginx -t
  exit 1
fi

# 自动续签 - certbot 包默认装了 systemd timer，确认在跑
if systemctl list-timers | grep -q certbot; then
  ok "certbot 自动续签 timer 已开启"
else
  warn "certbot 自动续签 timer 未发现，请手动配 cron"
fi

echo
echo "========== HTTPS 部署完成 =========="
ok "URL: https://${DOMAIN}"
echo "证书过期: $(date -d "$(openssl x509 -enddate -noout -in $CERT_DIR/fullchain.pem | cut -d= -f2)" '+%Y-%m-%d')"
echo "续签命令: certbot renew (自动每天检查)"
