#!/bin/bash
# heartbeat.sh — 定期巡回スクリプト（プロジェクト対応版）
# projects/*/のMEMORY/TASKSを1回のclaude -pでまとめて処理

# スクリプトの場所からエージェントディレクトリを自動決定
AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INBOX_DIR="$AGENT_DIR/inbox"
CONFIG_DIR="$AGENT_DIR/config"
PROJECTS_DIR="$AGENT_DIR/projects"

mkdir -p "$INBOX_DIR"

# --- 再起動フラグチェック ---
RESTART_FLAG="$AGENT_DIR/.restart-sentinel"
if [ -f "$RESTART_FLAG" ]; then
  echo "[heartbeat] 再起動フラグ検出。sentinel brainを再起動します..."
  rm -f "$RESTART_FLAG"
  # restart.batを使用（Windows環境）
  RESTART_BAT="$AGENT_DIR/restart.bat"
  if [ -f "$RESTART_BAT" ]; then
    cmd.exe /c "$(cygpath -w "$RESTART_BAT")" 2>&1
    echo "[heartbeat] restart.bat 実行完了"
  elif pm2 list 2>/dev/null | grep -q "sentinel"; then
    pm2 restart sentinel 2>&1
    echo "[heartbeat] pm2 restart sentinel 完了"
  else
    echo "[heartbeat] 再起動手段が見つからない。手動で起動してください"
  fi
fi

TIMESTAMP=$(date +"%Y-%m-%d_%H%M")

# テンプレート読み込み
TEMPLATE=$(cat "$CONFIG_DIR/heartbeat_prompt.md" 2>/dev/null)
if [ -z "$TEMPLATE" ]; then
  echo "[heartbeat] テンプレートが見つかりません" >&2
  exit 1
fi

# プロジェクト情報を収集
PROJECT_SECTION=""
PROJECT_COUNT=0

# projects/配下のディレクトリをスキャン
if [ -d "$PROJECTS_DIR" ]; then
  for projdir in "$PROJECTS_DIR"/*/; do
    [ -d "$projdir" ] || continue
    projname=$(basename "$projdir")
    proj_memory=$(cat "$projdir/MEMORY.md" 2>/dev/null || echo "(なし)")
    proj_tasks=$(cat "$projdir/TASKS.md" 2>/dev/null || echo "(なし)")
    PROJECT_SECTION="${PROJECT_SECTION}
## プロジェクト: ${projname}
### MEMORY
${proj_memory}
### TASKS
${proj_tasks}

---
"
    PROJECT_COUNT=$((PROJECT_COUNT + 1))
  done
fi

# プロジェクトがなければルートのMEMORY/TASKSを使う
if [ $PROJECT_COUNT -eq 0 ]; then
  ROOT_MEMORY=$(cat "$AGENT_DIR/MEMORY.md" 2>/dev/null || echo "(なし)")
  ROOT_TASKS=$(cat "$AGENT_DIR/TASKS.md" 2>/dev/null || echo "(なし)")
  PROJECT_SECTION="
## プロジェクト: default
### MEMORY
${ROOT_MEMORY}
### TASKS
${ROOT_TASKS}
"
  PROJECT_COUNT=1
fi

# テンプレートの変数を置換
# ${MEMORY}と${TASKS}をプロジェクトセクションに置き換え
PROMPT="${TEMPLATE//\$\{MEMORY\}/$PROJECT_SECTION}"
PROMPT="${PROMPT//\$\{TASKS\}/(上記プロジェクトごとに記載済み)}"

# 複数プロジェクト時は出力形式を指示に追加
if [ $PROJECT_COUNT -gt 1 ]; then
  PROMPT="${PROMPT}

【重要】プロジェクトが複数あるので、出力はプロジェクトごとにセクションを分けること。
フォーマット:
## [プロジェクト名]
### 気づき
### 提案タスク
### Junyaへの質問（あれば）"
fi

# claude -p で実行（使い捨て）
echo "[heartbeat] $TIMESTAMP 実行開始 (${PROJECT_COUNT}プロジェクト)"

cd "$AGENT_DIR"

CLAUDE_PATH=$(which claude 2>/dev/null || echo "$HOME/.local/bin/claude")

RESULT=$("$CLAUDE_PATH" -p \
  --dangerously-skip-permissions \
  --no-session-persistence \
  --output-format text \
  <<< "$PROMPT" 2>/dev/null)

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ] && [ -n "$RESULT" ]; then
  # まとめてinboxに書き込み
  {
    echo "## Heartbeat $TIMESTAMP"
    echo ""
    echo "$RESULT"
  } > "$INBOX_DIR/heartbeat_${TIMESTAMP}.md"
  echo "[heartbeat] 完了 → $INBOX_DIR/heartbeat_${TIMESTAMP}.md"
else
  echo "[heartbeat] 失敗 (exit: $EXIT_CODE)" >&2
fi
