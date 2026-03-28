# Sentinel アーキテクチャドキュメント

## 設計思想

Sentinelは「Junyaの一人目の社員」として自律的に動くAIアシスタント。以下の原則で設計されている。

### 1. Brain/Runtime分離
- **Brain（Claude CLI）**: 思考と判断のみ。常駐プロセスとしてstream-jsonで双方向通信
- **Runtime（sentinel.js）**: 実行を担う。サブエージェント起動、ファイル更新、通知等
- Brainは「何をすべきか」を決め、Runtimeが実行する

### 2. トークンコスト最適化（v2方式）
- v1: 毎ターン`claude -p`を新規spawn → cache_creationが毎回20万トークン（$1.66/ターン）
- v2: CLIを常駐プロセスとして維持 → cache_creationは初回のみ（$0.04〜0.35/ターン）
- **約80〜96%のコスト削減**を実現

### 3. 能動的自律（Heartbeat）
- 30分ごとのcronで「今何をすべきか」を自律的に考える
- cronは提案のみ行い、実行はメインCLIが判断して実施
- タスクがなくても自分で見つけて提案する

### 4. セッション分離
- **メインCLI**: Junyaとの対話・実行用（常駐）
- **圧縮CLI**: 会話履歴の要約専用（常駐）
- **cron（Heartbeat）**: 定期巡回・提案用（使い捨て`claude -p`）
- **サブエージェント**: 重い処理の実行（使い捨て`claude -p`）

---

## システム構成

```
┌─────────────────────────────────────────────────┐
│                  sentinel.js                     │
│              (Runtime / Orchestrator)             │
│                                                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ メインCLI   │  │ 圧縮CLI    │  │ Inbox監視  │ │
│  │ (常駐)      │  │ (常駐)     │  │ (30秒poll) │ │
│  │ stream-json │  │ stream-json│  │            │ │
│  └──────┬─────┘  └─────┬──────┘  └──────┬─────┘ │
│         │              │               │         │
│  ┌──────┴──────────────┴───────────────┴──────┐ │
│  │           イベントキュー (直列化)            │ │
│  └─────────────────────┬──────────────────────┘ │
│                        │                         │
│  ┌─────────���  ┌───────┴──────┐  ┌────────────┐ │
│  │ Web UI  │  │ Action実行    │  │ Discord    │ │
│  │ :3100   │  │ spawn/write   │  │ Webhook通知│ │
│  └─────────┘  └──────────────┘  └────────────┘ │
└─────────────────────────────────────────────────┘
         ▲              │              ▲
         │              ▼              │
    ┌────┴────┐  ┌──────────┐  ┌──────┴──────┐
    │Discord  │  │サブエージェント│  │  cron       │
    │Bot      │  │(使い捨て)  │  │ heartbeat.sh│
    │bot.js   │  │run-sub.sh │  │ (30分間隔)  │
    └─────────┘  └──────────┘  ��─────────────┘
```

---

## コンポーネント詳細

### メインCLI（常駐）

| 項目 | 内容 |
|------|------|
| 起動方法 | `spawn('claude', ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'])` |
| 通信方式 | stdin: JSONLでメッセージ送信 / stdout: JSONLでイベント受信 |
| イベント種別 | `system`(init), `assistant`(応答チャンク), `result`(完了) |
| 完了検知 | `type: "result"` イベントで判定。テキストパースは不要 |
| 自動再起動 | プロセス死亡時、5秒後に自動再起動 |
| タイムアウト | 5分（300秒） |

### 圧縮CLI（常駐）

| 項目 | 内容 |
|------|------|
| 目的 | 会話履歴をLLMで要約（メインの会話コンテキストを汚染しない） |
| system-prompt | 「会話ログの要約専門アシスタント」 |
| 発火条件 | 会話ログが60件を超え、かつ差分が20件以上 |
| 出力先 | `conversation_summary.md`（次回ブート時に注入） |
| アーカイブ | 古いログは `logs/conversation_archive/` に退避 |

### Heartbeat（cron）

| 項目 | 内容 |
|------|------|
| 実行間隔 | 30分（pm2 cron: `*/30 * * * *`） |
| 実行方式 | 使い捨て `claude -p`（heartbeat.sh） |
| 入力 | `config/heartbeat_prompt.md` + MEMORY.md + TASKS.md |
| 出力 | `inbox/heartbeat_YYYY-MM-DD_HHmm.md` |
| 検知 | sentinel.jsが30秒ごとにinboxをpoll |
| 役割 | 状況を俯瞰し「やるべきこと」を提案。実行はしない |

### サブエージェント

| 項目 | 内容 |
|------|------|
| 起動元 | メインCLIの `---ACTIONS---` にある `spawn` 指示 |
| 実行方式 | 使い捨て `claude -p`（scripts/run-sub.sh経由） |
| 並列実行 | 可能（複数サブエージェント同時稼働） |
| 結果通知 | `queueEvent({ type: 'job_complete' })` → メインCLIが処理 |
| ジョブ管理 | `jobs/` ディレクトリに prompt, output, error を記録 |
| リトライ | 最大3回（overloaded_error時） |

### Discord Bot

| 項目 | 内容 |
|------|------|
| ボット名 | Sentinel#9600 |
| 通信先 | `http://localhost:3100/send`（sentinel.js API） |
| フォールバック | sentinel.js未起動時は `claude -p` 直接実行 |
| コマンド | `!help`, `!status`, `!tasks`, `!memory`, `!ask`, `!post`, `!schedule`, `!usage` |
| 通常メッセージ | !なしのテキストもsentinel.jsに送信 |
| 自動起動 | sentinel.js未起動時に自動起動を試みる |

---

## イベントフロー

### ユーザーメッセージ（Discord/Web UI）

```
ユーザー入力
  → handleInput() → queueEvent({ type: 'user_message' })
  → processNextEvent()
  → callBrain(event) → sendToBrain(prompt)
  → メインCLI処理 → handleBrainEvent() で応答受信
  → parseResponse() で ---RESPONSE--- / ---ACTIONS--- をパース
  → 意図-アクション不一致チェック（必要なら自動リトライ）
  → printSentinel() で応答表示
  → Discord callback送信（callback_url付きの場合）
  → executeActions() でspawn/write/append実行
```

### Heartbeat（cron）

```
pm2 cron (30分間隔)
  → heartbeat.sh 実行
  → MEMORY.md + TASKS.md を読み込み
  → claude -p でプロンプト実行（提案のみ）
  → inbox/heartbeat_*.md に書き込み → 終了

sentinel.js (30秒ごとpoll)
  → 新しいheartbeatファイル検知
  → queueEvent({ type: 'heartbeat' })
  → メインCLIが提案を分析・優先度判断
  → 自律実行するもの → executeActions()
  → Junyaに報告 → Discord Webhook通知
```

### サブエージェント

```
メインCLIの応答: ---ACTIONS--- に spawn 指示
  → executeActions() → spawnSubAgent()
  → bash run-sub.sh --file prompt.txt --job-dir /path
  → claude -p で実行（リトライ最大3回）
  → 完了 → jobs/{id}/output.log に結果書き込み
  → queueEvent({ type: 'job_complete' })
  → メインCLIが結果を分析・応答
  → Discord Webhook通知（[Job完了]プレフィックス付き）
```

---

## Brain応答フォーマット

```
---RESPONSE---
Junyaへの応答テキスト
---ACTIONS---
{
  "spawn": [{"id": "一意な名前", "prompt": "作業指示"}],
  "write_files": [{"path": "~/agent/FILE.md", "content": "全文"}],
  "append_files": [{"path": "~/agent/FILE.md", "content": "追記内容"}]
}
---END---
```

- アクション不要時は `{}` のみ
- 意図-アクション不一致検出: `config/intent_patterns.json` のパターンに一致するのにACTIONSが空の場合、自動で再プロンプト

---

## Discord自動通知

以下のイベントはDiscord Webhookに自動通知される：

| イベント | プレフィックス | タイミング |
|----------|---------------|-----------|
| boot | **[起動]** | sentinel.js起動時 |
| heartbeat | **[Heartbeat]** | cron提案をメインCLIが処理した後 |
| job_complete | **[Job完了]** | サブエージェント完了時 |
| job_failed | **[Job失敗]** | サブエージェント失敗時 |

Discordからのメッセージへの応答はcallback_url経由で返送される。

---

## ファイル構成

```
~/agent/
├── sentinel.js           # メインランタイム（v2: 常駐CLI方式）
├── SOUL.md               # Sentinelのアイデンティティ・行動規範
├── MEMORY.md             # 永続メモリ（ユーザー情報、方針、学び）
├── TASKS.md              # タスク管理（実行中・待機中・完了）
├── conversation_history.jsonl  # 直近60件の会話ログ
├── conversation_summary.md     # 古い会話の要約
├── config/
│   ├── heartbeat_prompt.md     # Heartbeatプロンプトテンプレート
│   └── intent_patterns.json    # 意図-アクション不一致検出パターン
├── scripts/
│   ├── heartbeat.sh            # cron実行スクリプト
│   └── run-sub.sh              # サブエージェント実行ラッパー
├── discord-bot/
│   └── bot.js                  # Discord bot
├── x-autoposter/
│   ├── scheduler.js            # X投稿スケジューラ（pm2常駐）
│   └── schedule.json           # 21件の予約投稿データ
├── inbox/                      # Heartbeat提案の受信箱
├── jobs/                       # サブエージェントのジョブディレクトリ
├── logs/
│   ├── token_usage.jsonl       # トークン使用量ログ
│   ├── brain_raw.log           # Brain生レスポンス（デバッグ用）
│   └── conversation_archive/   # 圧縮済み会話ログ
├── content/
│   ├── drafts/                 # 記事ドラフト
│   └── published/              # 公開済みコンテンツ
└── skills/                     # スキル定義ファイル
```

---

## pm2プロセス

| 名前 | 種別 | 説明 |
|------|------|------|
| x-autoposter | 常駐 | X投稿スケジューラ（schedule.jsonに基づき自動投稿） |
| heartbeat | cron | 30分間隔で定期巡回（`*/30 * * * *`） |

sentinel.jsとdiscord-botは手動起動（将来的にpm2管理に移行可能）。

---

## コスト構造

### v2方式のコスト（実測値）

| 項目 | コスト | 備考 |
|------|--------|------|
| メインCLI 1ターン | $0.04〜0.35 | 会話蓄積で徐々に増加（cache_read） |
| Heartbeat 1回 | $0.04程度 | 使い捨て、プロンプトが短い |
| サブエージェント 1回 | $0.5〜2.0 | タスクの重さによる |
| 1日の推定コスト | $3〜5 | 通常利用（対話20ターン + heartbeat 48回 + サブエージェント数回） |

### v1との比較

| | v1 | v2 | 削減率 |
|---|---|---|---|
| メインCLI/ターン | $1.72 | $0.35 | 80% |
| cache_creation/ターン | 220,699 | 3,572 | 98% |
