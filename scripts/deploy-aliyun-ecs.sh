#!/bin/bash
# 部署 baozupo 到阿里云 ECS（Debian 13 + 宝塔已装 Nginx 1.28 + 已有 c.armorone.cn）
# 用法（root 身份）: bash /opt/baozupo/scripts/deploy-aliyun-ecs.sh

set -euo pipefail

# ===== 配置 =====
DEPLOY_DIR="${DEPLOY_DIR:-/opt/baozupo}"
SERVICE_NAME="baozupo"
APP_PORT="${APP_PORT:-3000}"
DOMAIN="${DOMAIN:-tendapp.cn}"
REPO_URL="${REPO_URL:-https://github.com/KintS-sketch/baozupo.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"

# ===== 颜色 =====
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }

# ===== 0. root + 系统 =====
[ "$(id -u)" -eq 0 ] || { err "请用 root 身份运行"; exit 1; }
log "系统: $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"')"
log "内存: $(free -m | awk '/^Mem:/{print $2"M total, "$7"M available"}')"
log "磁盘: $(df -h / | awk 'NR==2{print $4" available on /"}')"

# ===== 1. 基础依赖 =====
log "更新 apt + 装基础工具"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg lsb-release build-essential >/dev/null
ok "基础工具就绪"

# ===== 2. Node.js 20 =====
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed -E 's/^v([0-9]+).*/\1/')
fi
if [ "$NODE_MAJOR" -lt 20 ]; then
  log "装 Node.js 20（NodeSource 仓库）"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v) / npm $(npm -v)"

# ===== 3. PM2 =====
if ! command -v pm2 >/dev/null 2>&1; then
  log "装 PM2（npm 全局）"
  npm install -g pm2@latest --silent >/dev/null
fi
ok "PM2 $(pm2 -v)"

# ===== 4. 拉代码 =====
if [ ! -d "$DEPLOY_DIR/.git" ]; then
  log "git clone $REPO_URL → $DEPLOY_DIR"
  mkdir -p "$(dirname "$DEPLOY_DIR")"
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$DEPLOY_DIR"
else
  log "代码已存在，pull 最新"
  cd "$DEPLOY_DIR"
  git fetch --quiet origin "$REPO_BRANCH"
  git reset --hard "origin/$REPO_BRANCH"
fi
cd "$DEPLOY_DIR"
ok "代码 → $(git rev-parse --short HEAD) ($(git log -1 --format=%s | head -c 60))"

# ===== 5. .env.production 检查 =====
ENV_FILE="$DEPLOY_DIR/.env.production"
if [ ! -f "$ENV_FILE" ]; then
  err ".env.production 不存在"
  echo
  warn "请先在 ECS 上执行 cat 命令写入 .env.production，再重跑此脚本"
  warn "（具体粘贴指令由部署助手生成）"
  exit 1
fi

# 检查关键变量
REQUIRED_VARS="NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY DASHSCOPE_API_KEY NEXT_PUBLIC_APP_URL"
MISSING=""
for v in $REQUIRED_VARS; do
  if ! grep -qE "^${v}=." "$ENV_FILE"; then
    MISSING="$MISSING $v"
  fi
done
if [ -n "$MISSING" ]; then
  err "缺关键变量:$MISSING"
  exit 1
fi
ok ".env.production 检查通过"

# ===== 6. 装依赖 + build =====
log "npm ci（3-5 分钟）"
npm ci --include=dev --no-audit --no-fund --loglevel=error
ok "依赖就绪 ($(ls node_modules | wc -l) 个包)"

log "npm run build（2-5 分钟）"
NODE_ENV=production npm run build
ok "build 完成"

# ===== 7. PM2 ecosystem =====
cat > "$DEPLOY_DIR/ecosystem.config.cjs" <<ECOSYSTEM
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)\$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"\$/, '\$1').replace(/^'(.*)'\$/, '\$1');
  }
  return env;
}

module.exports = {
  apps: [{
    name: '$SERVICE_NAME',
    cwd: '$DEPLOY_DIR',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p $APP_PORT',
    instances: 1,
    autorestart: true,
    max_memory_restart: '700M',
    env: Object.assign(
      { NODE_ENV: 'production', PORT: '$APP_PORT' },
      loadEnv(path.join('$DEPLOY_DIR', '.env.production'))
    ),
    out_file: '/var/log/$SERVICE_NAME.out.log',
    error_file: '/var/log/$SERVICE_NAME.err.log',
    merge_logs: true,
    time: true
  }]
};
ECOSYSTEM

log "启动/重启 PM2"
pm2 delete "$SERVICE_NAME" >/dev/null 2>&1 || true
pm2 start "$DEPLOY_DIR/ecosystem.config.cjs"
pm2 save
pm2 startup systemd -u root --hp /root 2>&1 | grep -E '^\s*sudo' | bash >/dev/null 2>&1 || true
ok "PM2 已启动（端口 $APP_PORT）"

# 等 3 秒确认进程稳
sleep 3
if curl -fsS --max-time 5 "http://127.0.0.1:$APP_PORT/" >/dev/null 2>&1; then
  ok "应用本地 HTTP 测试通过"
else
  warn "应用本地测试失败，查日志: pm2 logs $SERVICE_NAME --lines 50"
fi

# ===== 8. Nginx 配置（独立 server，不动现有官网）=====
NGINX_CONF="/etc/nginx/conf.d/${DOMAIN}.conf"
log "写 Nginx 配置: $NGINX_CONF"
cat > "$NGINX_CONF" <<NGINX
# baozupo / 养房 Tend - HTTP 80（HTTPS 后续 certbot 加）
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    # ACME challenge 留口（certbot 用）
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
    }

    client_max_body_size 20m;

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
mkdir -p /var/www/html

if nginx -t >/dev/null 2>&1; then
  nginx -s reload 2>/dev/null || systemctl reload nginx
  ok "Nginx 配置生效（HTTP）"
else
  err "Nginx 配置语法错误，未 reload"
  nginx -t
  exit 1
fi

# ===== 9. 总结 =====
echo
echo "========== 部署完成 =========="
ok "URL: http://${DOMAIN}（HTTPS 待 certbot）"
echo "PM2 状态:  pm2 status"
echo "应用日志:  pm2 logs $SERVICE_NAME --lines 50"
echo "Nginx 日志: tail -f /var/log/nginx/${DOMAIN}.access.log"
echo
echo "下一步: 申请 HTTPS 证书 → bash scripts/deploy-https.sh"
