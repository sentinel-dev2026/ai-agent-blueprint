#!/bin/bash

# ログ設定
AGENT_DIR=~/agent
LOG=$AGENT_DIR/logs/run.log
mkdir -p $AGENT_DIR/logs

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting agent run" >> $LOG

# エージェントのディレクトリに移動（CLAUDE.mdを自動読み込み）
cd $AGENT_DIR

# メインエージェントがタスクを確認し、サブエージェントに委任して実行
claude -p "
現在時刻: $(date '+%Y-%m-%d %H:%M:%S')

定期実行モードで起動した。以下を実行せよ：
1. SOUL.md, MEMORY.md, TASKS.md を読む
2. 待機中タスクがあれば、サブエージェント（claude -p）に委任して実行する
3. サブエージェントの結果を確認し、MEMORY.mdとTASKS.mdを更新する
4. Discord通知が必要ならnotify.shを使う（未設定ならスキップ）
" --dangerously-skip-permissions >> $LOG 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Agent run complete" >> $LOG
