#!/bin/bash
# ============================================================
# Sentinel Agent セットアップスクリプト
# 複数エージェント対応。対話形式で設定を行う。
# ============================================================

set -e

echo "========================================"
echo "  Sentinel Agent セットアップ"
echo "========================================"
echo ""

# ---- エージェント名・ディレクトリ ----
read -p "エージェント名（例: sentinel-a）: " AGENT_NAME
AGENT_NAME=${AGENT_NAME:-sentinel}

DEFAULT_DIR="$HOME/$AGENT_NAME"
read -p "インストール先 [$DEFAULT_DIR]: " AGENT_DIR
AGENT_DIR=${AGENT_DIR:-$DEFAULT_DIR}

if [ -d "$AGENT_DIR/sentinel.js" ] || [ -f "$AGENT_DIR/sentinel.js" ]; then
  echo "⚠️  $AGENT_DIR には既にsentinel.jsが存在します。上書きしますか？"
  read -p "(y/N): " OVERWRITE
  if [ "$OVERWRITE" != "y" ] && [ "$OVERWRITE" != "Y" ]; then
    echo "中断しました。"
    exit 1
  fi
fi

# ---- ポート番号 ----
read -p "Web UIポート番号 [3100]: " WEB_PORT
WEB_PORT=${WEB_PORT:-3100}

# ---- Discord設定 ----
echo ""
echo "--- Discord設定 ---"
read -p "Discord Botトークン: " DISCORD_TOKEN
read -p "メインチャンネルID: " MAIN_CHANNEL_ID
read -p "Heartbeatチャンネル ID（空欄でスキップ）: " HEARTBEAT_CHANNEL_ID
read -p "メインチャンネルのWebhook URL: " WEBHOOK_MAIN
read -p "HeartbeatチャンネルのWebhook URL（空欄でスキップ）: " WEBHOOK_HEARTBEAT
read -p "許可するユーザーID（カンマ区切り、空欄で全員許可）: " ALLOWED_USER_IDS

# ---- オプション: X (Twitter) ----
echo ""
read -p "X (Twitter) 自動投稿を設定しますか？ (y/N): " SETUP_X
if [ "$SETUP_X" = "y" ] || [ "$SETUP_X" = "Y" ]; then
  echo "--- X API設定 ---"
  read -p "X API Key: " X_API_KEY
  read -p "X API Key Secret: " X_API_KEY_SECRET
  read -p "X Client ID: " X_CLIENT_ID
  read -p "X Client Secret: " X_CLIENT_SECRET
  read -p "X Callback URL [http://localhost:3000/callback]: " X_CALLBACK_URL
  X_CALLBACK_URL=${X_CALLBACK_URL:-http://localhost:3000/callback}
fi

# ---- オプション: Qiita ----
echo ""
read -p "Qiita APIトークンを設定しますか？ (y/N): " SETUP_QIITA
if [ "$SETUP_QIITA" = "y" ] || [ "$SETUP_QIITA" = "Y" ]; then
  read -p "Qiita APIトークン: " QIITA_API_TOKEN
fi

# ============================================================
# ディレクトリ作成・ファイルコピー
# ============================================================
echo ""
echo "--- セットアップ開始 ---"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$AGENT_DIR"
mkdir -p "$AGENT_DIR/config"
mkdir -p "$AGENT_DIR/scripts"
mkdir -p "$AGENT_DIR/skills"
mkdir -p "$AGENT_DIR/logs"
mkdir -p "$AGENT_DIR/jobs"
mkdir -p "$AGENT_DIR/inbox"
mkdir -p "$AGENT_DIR/content/drafts"
mkdir -p "$AGENT_DIR/discord-bot"

# コアファイル
cp "$SCRIPT_DIR/sentinel.js" "$AGENT_DIR/"
cp "$SCRIPT_DIR/SOUL.md" "$AGENT_DIR/"
cp "$SCRIPT_DIR/CLAUDE.md" "$AGENT_DIR/"
cp "$SCRIPT_DIR/package.json" "$AGENT_DIR/"
cp "$SCRIPT_DIR/run.sh" "$AGENT_DIR/"
cp "$SCRIPT_DIR/chat.sh" "$AGENT_DIR/"
[ -f "$SCRIPT_DIR/chat.bat" ] && cp "$SCRIPT_DIR/chat.bat" "$AGENT_DIR/"

# Config
cp "$SCRIPT_DIR/config/heartbeat_prompt.md" "$AGENT_DIR/config/"
cp "$SCRIPT_DIR/config/intent_patterns.json" "$AGENT_DIR/config/"

# Scripts
cp "$SCRIPT_DIR/scripts/heartbeat.sh" "$AGENT_DIR/scripts/"
cp "$SCRIPT_DIR/scripts/run-sub.sh" "$AGENT_DIR/scripts/"
chmod +x "$AGENT_DIR/scripts/"*.sh
chmod +x "$AGENT_DIR/run.sh" "$AGENT_DIR/chat.sh"

# Skills
cp "$SCRIPT_DIR/skills/"*.md "$AGENT_DIR/skills/"

# Docs
mkdir -p "$AGENT_DIR/docs"
cp "$SCRIPT_DIR/docs/architecture.md" "$AGENT_DIR/docs/"

# MEMORY.md / TASKS.md テンプレート
cp "$SCRIPT_DIR/MEMORY.md.example" "$AGENT_DIR/MEMORY.md"
cp "$SCRIPT_DIR/TASKS.md.example" "$AGENT_DIR/TASKS.md"

# Discord bot
cp "$SCRIPT_DIR/discord-bot/bot.js" "$AGENT_DIR/discord-bot/"
cp "$SCRIPT_DIR/discord-bot/notify.js" "$AGENT_DIR/discord-bot/"
cp "$SCRIPT_DIR/discord-bot/package.json" "$AGENT_DIR/discord-bot/"
cp "$SCRIPT_DIR/discord-bot/.gitignore" "$AGENT_DIR/discord-bot/"

# X autoposter（オプション）
if [ "$SETUP_X" = "y" ] || [ "$SETUP_X" = "Y" ]; then
  mkdir -p "$AGENT_DIR/x-autoposter"
  cp "$SCRIPT_DIR/x-autoposter/auth.js" "$AGENT_DIR/x-autoposter/"
  cp "$SCRIPT_DIR/x-autoposter/post.js" "$AGENT_DIR/x-autoposter/"
  cp "$SCRIPT_DIR/x-autoposter/scheduler.js" "$AGENT_DIR/x-autoposter/"
  cp "$SCRIPT_DIR/x-autoposter/package.json" "$AGENT_DIR/x-autoposter/"
  cp "$SCRIPT_DIR/x-autoposter/.gitignore" "$AGENT_DIR/x-autoposter/"
fi

# ============================================================
# .env ファイル生成
# ============================================================

# sentinel.js用
cat > "$AGENT_DIR/.env" << ENVEOF
WEB_PORT=${WEB_PORT}
DISCORD_WEBHOOK_MAIN=${WEBHOOK_MAIN}
DISCORD_WEBHOOK_HEARTBEAT=${WEBHOOK_HEARTBEAT}
ENVEOF

if [ -n "$QIITA_API_TOKEN" ]; then
  echo "QIITA_API_TOKEN=${QIITA_API_TOKEN}" >> "$AGENT_DIR/.env"
fi

# Discord bot用
cat > "$AGENT_DIR/discord-bot/.env" << ENVEOF
DISCORD_TOKEN=${DISCORD_TOKEN}
ALLOWED_USER_IDS=${ALLOWED_USER_IDS}
SENTINEL_DIR=${AGENT_DIR}
DISCORD_WEBHOOK_URL=${WEBHOOK_MAIN}
MAIN_CHANNEL_ID=${MAIN_CHANNEL_ID}
HEARTBEAT_CHANNEL_ID=${HEARTBEAT_CHANNEL_ID}
ENVEOF

# X autoposter用
if [ "$SETUP_X" = "y" ] || [ "$SETUP_X" = "Y" ]; then
  cat > "$AGENT_DIR/x-autoposter/.env" << ENVEOF
X_API_KEY=${X_API_KEY}
X_API_KEY_SECRET=${X_API_KEY_SECRET}
X_CLIENT_ID=${X_CLIENT_ID}
X_CLIENT_SECRET=${X_CLIENT_SECRET}
X_CALLBACK_URL=${X_CALLBACK_URL}
X_TOKEN_FILE=./tokens.json
ENVEOF
fi

# ============================================================
# npm install
# ============================================================
echo ""
echo "--- 依存パッケージのインストール ---"

cd "$AGENT_DIR" && npm install 2>/dev/null || true
cd "$AGENT_DIR/discord-bot" && npm install 2>/dev/null || true

if [ "$SETUP_X" = "y" ] || [ "$SETUP_X" = "Y" ]; then
  cd "$AGENT_DIR/x-autoposter" && npm install 2>/dev/null || true
fi

# ============================================================
# 完了
# ============================================================
echo ""
echo "========================================"
echo "  セットアップ完了!"
echo "========================================"
echo ""
echo "エージェント: $AGENT_NAME"
echo "ディレクトリ: $AGENT_DIR"
echo "Web UIポート: $WEB_PORT"
echo ""
echo "--- 起動方法 ---"
echo ""
echo "1. Sentinel起動:"
echo "   cd $AGENT_DIR && node sentinel.js"
echo ""
echo "2. Discord bot起動:"
echo "   cd $AGENT_DIR/discord-bot && node bot.js"
echo ""
echo "3. Heartbeat cron登録 (30分間隔):"
echo "   pm2 start $AGENT_DIR/scripts/heartbeat.sh --name ${AGENT_NAME}-heartbeat --cron '*/30 * * * *' --no-autorestart --interpreter bash"
echo ""
if [ "$SETUP_X" = "y" ] || [ "$SETUP_X" = "Y" ]; then
  echo "4. X OAuth認証:"
  echo "   cd $AGENT_DIR/x-autoposter && node auth.js"
  echo ""
  echo "5. X自動投稿起動:"
  echo "   pm2 start $AGENT_DIR/x-autoposter/scheduler.js --name ${AGENT_NAME}-x-autoposter"
  echo ""
fi
echo "--- 次のステップ ---"
echo "1. MEMORY.md にユーザー情報・方針を記入"
echo "2. TASKS.md にタスクを記入"
echo "3. SOUL.md をプロジェクトに合わせてカスタマイズ"
echo ""
