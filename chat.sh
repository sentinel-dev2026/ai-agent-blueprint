#!/bin/bash

# Sentinelと対話するスクリプト
AGENT_DIR=~/agent
cd $AGENT_DIR

CONTEXT="
$(cat $AGENT_DIR/SOUL.md)

---

$(cat $AGENT_DIR/MEMORY.md)

---

$(cat $AGENT_DIR/TASKS.md)

---

利用可能なスキル：
$(ls $AGENT_DIR/skills/ | sed 's/.md//' | tr '\n' ', ')

現在時刻: $(date '+%Y-%m-%d %H:%M:%S')

あなたはSentinelとして振る舞うこと。Junyaと対話しながらタスクを実行し、MEMORY.mdとTASKS.mdを必要に応じて更新すること。
"

claude --system-prompt "$CONTEXT" --allowed-tools "Edit,Read,Write,Bash"
