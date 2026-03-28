#!/bin/bash
# サブエージェント実行ラッパー（非同期・リトライ・完了通知付き）
#
# 使い方:
#   ファイル指定:  bash run-sub.sh --file prompt.txt [--job-dir /path/to/jobdir]
#   直接指定:      bash run-sub.sh "プロンプト"
#   非同期:        bash run-sub.sh "プロンプト" --async
#
#   状態確認: bash run-sub.sh --status <ジョブID>
#   結果取得: bash run-sub.sh --result <ジョブID>
#   受信箱:   bash run-sub.sh --inbox

JOBS_DIR=~/agent/jobs
INBOX_DIR=~/agent/inbox
mkdir -p "$JOBS_DIR" "$INBOX_DIR"

# --- デバッグ用: 基本情報出力 ---
echo "[run-sub.sh] 起動: $(date)" >&2
echo "[run-sub.sh] 引数: $@" >&2
echo "[run-sub.sh] claude パス: $(which claude 2>&1)" >&2

# --- サブコマンド ---

# 受信箱チェック
if [ "$1" = "--inbox" ]; then
  MESSAGES=$(ls "$INBOX_DIR"/*.msg 2>/dev/null)
  if [ -z "$MESSAGES" ]; then
    echo "(受信箱は空です)"
    exit 0
  fi
  for MSG in $MESSAGES; do
    cat "$MSG"
    echo "---"
    rm "$MSG"
  done
  exit 0
fi

if [ "$1" = "--status" ]; then
  JOB_ID="$2"
  JOB_DIR="$JOBS_DIR/$JOB_ID"
  if [ ! -d "$JOB_DIR" ]; then
    echo "not_found"
  elif [ -f "$JOB_DIR/done" ]; then
    EXIT_CODE=$(cat "$JOB_DIR/exit_code" 2>/dev/null || echo "?")
    echo "done (exit: $EXIT_CODE)"
  else
    echo "running"
  fi
  exit 0
fi

if [ "$1" = "--result" ]; then
  JOB_ID="$2"
  JOB_DIR="$JOBS_DIR/$JOB_ID"
  if [ ! -f "$JOB_DIR/done" ]; then
    echo "[まだ実行中です]"
    exit 1
  fi
  cat "$JOB_DIR/output"
  exit 0
fi

# --- 引数パース ---
PROMPT=""
PROMPT_FILE=""
EXTERNAL_JOB_DIR=""
ASYNC=false
MAX_RETRIES=3
RETRY_DELAY=30

while [ $# -gt 0 ]; do
  case "$1" in
    --file)
      PROMPT_FILE="$2"
      shift 2
      ;;
    --job-dir)
      EXTERNAL_JOB_DIR="$2"
      shift 2
      ;;
    --async)
      ASYNC=true
      shift
      ;;
    *)
      if [ -z "$PROMPT" ]; then
        PROMPT="$1"
      fi
      shift
      ;;
  esac
done

# プロンプト取得: --file指定があればファイルから読む
if [ -n "$PROMPT_FILE" ]; then
  if [ ! -f "$PROMPT_FILE" ]; then
    echo "[ERROR] プロンプトファイルが見つかりません: $PROMPT_FILE" >&2
    exit 1
  fi
  PROMPT=$(cat "$PROMPT_FILE")
  echo "[run-sub.sh] プロンプトをファイルから読み込み: $PROMPT_FILE (${#PROMPT}文字)" >&2
fi

if [ -z "$PROMPT" ]; then
  echo "[ERROR] プロンプトが空です" >&2
  exit 1
fi

# 実行関数（リトライ + 完了時にinboxへ通知）
run_agent() {
  local PROMPT="$1"
  local MAX_RETRIES="$2"
  local RETRY_DELAY="$3"
  local JOB_DIR="$4"
  local JOB_ID="$5"

  local OUTPUT_FILE="$JOB_DIR/output"
  local EXIT_CODE_FILE="$JOB_DIR/exit_code"
  local DONE_FILE="$JOB_DIR/done"

  echo "[run-sub.sh] claude -p 実行開始 (リトライ上限: $MAX_RETRIES)" >&2

  for i in $(seq 1 $MAX_RETRIES); do
    echo "[run-sub.sh] 試行 $i/$MAX_RETRIES..." >&2
    OUTPUT=$(echo "$PROMPT" | claude -p --dangerously-skip-permissions --no-session-persistence 2>&1)
    EXIT_CODE=$?
    echo "[run-sub.sh] claude 終了コード: $EXIT_CODE, 出力長: ${#OUTPUT}文字" >&2

    if echo "$OUTPUT" | grep -q "overloaded_error"; then
      echo "[RETRY $i/$MAX_RETRIES] API overloaded. ${RETRY_DELAY}秒後にリトライ..." >> "$JOB_DIR/retry.log"
      echo "[run-sub.sh] overloaded — ${RETRY_DELAY}秒待機" >&2
      sleep $RETRY_DELAY
      RETRY_DELAY=$((RETRY_DELAY * 2))
      continue
    fi

    echo "$OUTPUT" > "$OUTPUT_FILE"
    echo "$EXIT_CODE" > "$EXIT_CODE_FILE"
    touch "$DONE_FILE"

    # 完了通知をinboxに投函
    SUMMARY=$(echo "$OUTPUT" | head -c 500)
    cat > "$INBOX_DIR/${JOB_ID}.msg" <<NOTIFY
[完了] ジョブ: $JOB_ID
終了コード: $EXIT_CODE
結果プレビュー:
$SUMMARY
---
全文取得: bash ~/agent/scripts/run-sub.sh --result $JOB_ID
NOTIFY

    # 結果をstdoutにも出力（sentinel.jsのoutput.logに書き込まれる）
    echo "$OUTPUT"
    return $EXIT_CODE
  done

  echo "[ERROR] ${MAX_RETRIES}回リトライしたが全て失敗" > "$OUTPUT_FILE"
  echo "1" > "$EXIT_CODE_FILE"
  touch "$DONE_FILE"

  cat > "$INBOX_DIR/${JOB_ID}.msg" <<NOTIFY
[失敗] ジョブ: $JOB_ID
${MAX_RETRIES}回リトライしたが全て失敗（529 overloaded）
詳細: bash ~/agent/scripts/run-sub.sh --result $JOB_ID
NOTIFY
  return 1
}

# --- メイン実行 ---
if [ -n "$EXTERNAL_JOB_DIR" ]; then
  # sentinel.jsから指定されたジョブディレクトリを使用（二重作成を防止）
  JOB_DIR="$EXTERNAL_JOB_DIR"
  JOB_ID=$(basename "$JOB_DIR")
  mkdir -p "$JOB_DIR"
else
  # 独立実行時は自動生成
  if [ "$ASYNC" = true ]; then
    JOB_ID="job_$(date +%Y%m%d_%H%M%S)_$$"
  else
    JOB_ID="sync_$(date +%Y%m%d_%H%M%S)_$$"
  fi
  JOB_DIR="$JOBS_DIR/$JOB_ID"
  mkdir -p "$JOB_DIR"
  echo "$PROMPT" > "$JOB_DIR/prompt"
fi

if [ "$ASYNC" = true ]; then
  run_agent "$PROMPT" "$MAX_RETRIES" "$RETRY_DELAY" "$JOB_DIR" "$JOB_ID" &
  echo "$JOB_ID"
  exit 0
else
  run_agent "$PROMPT" "$MAX_RETRIES" "$RETRY_DELAY" "$JOB_DIR" "$JOB_ID"
  exit $?
fi
