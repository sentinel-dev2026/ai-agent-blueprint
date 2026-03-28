#!/bin/bash
# heartbeat.sh — 30分ごとにcronから呼ばれる定期巡回スクリプト
# 状態を確認し、提案をinboxに書いて終了する

AGENT_DIR="$HOME/agent"
INBOX_DIR="$AGENT_DIR/inbox"
CONFIG_DIR="$AGENT_DIR/config"

mkdir -p "$INBOX_DIR"

# 現在時刻
TIMESTAMP=$(date +"%Y-%m-%d_%H%M")
OUTFILE="$INBOX_DIR/heartbeat_${TIMESTAMP}.md"

# ファイル読み込み
MEMORY=$(cat "$AGENT_DIR/MEMORY.md" 2>/dev/null || echo "(なし)")
TASKS=$(cat "$AGENT_DIR/TASKS.md" 2>/dev/null || echo "(なし)")
TEMPLATE=$(cat "$CONFIG_DIR/heartbeat_prompt.md" 2>/dev/null)

if [ -z "$TEMPLATE" ]; then
  echo "[heartbeat] テンプレートが見つかりません" >&2
  exit 1
fi

# テンプレートの変数を置換
PROMPT="${TEMPLATE//\$\{MEMORY\}/$MEMORY}"
PROMPT="${PROMPT//\$\{TASKS\}/$TASKS}"

# claude -p で実行（使い捨て）
echo "[heartbeat] $TIMESTAMP 実行開始"

CLAUDE_PATH=$(which claude 2>/dev/null || echo "$HOME/.local/bin/claude")

RESULT=$("$CLAUDE_PATH" -p \
  --dangerously-skip-permissions \
  --output-format text \
  <<< "$PROMPT" 2>/dev/null)

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ] && [ -n "$RESULT" ]; then
  # ヘッダーを付けてinboxに書き込み
  {
    echo "## Heartbeat $TIMESTAMP"
    echo ""
    echo "$RESULT"
  } > "$OUTFILE"
  echo "[heartbeat] 完了 → $OUTFILE"
else
  echo "[heartbeat] 失敗 (exit: $EXIT_CODE)" >&2
fi
