# Sample Session: Automated Research with Sentinel

> A real-world example of how Sentinel handles a complex research request — decomposing it into parallel sub-agent tasks, executing 33 queries, and delivering a structured report in 8 minutes.
>
> Sentinelが複雑なリサーチ依頼をどのように処理するかの実例です。タスク分解 → 並列実行 → 結果統合 → 振り返りまでの全フローを示します。

---

## Scenario

**User request:** "Research the AI agent market — trends, key players, and opportunities."

**What Sentinel does:**
1. Decomposes the request into 3 independent research tracks
2. Launches 3 sub-agents in parallel via `claude -p`
3. Aggregates results into a single structured report
4. Runs a PDCA retrospective and records lessons learned

**Total time:** ~8 minutes for 33 search queries across 3 research tracks.

---

## The Session

### Step 1: User gives the instruction（ユーザーが指示を出す）

```
User: AIエージェント市場について調べて。トレンド、主要プレイヤー、
      ビジネスチャンスを知りたい。
      Research the AI agent market — trends, key players, and opportunities.
```

### Step 2: Sentinel decomposes the task（タスクを分解する）

```
Sentinel: 了解しました。このリサーチを3つの調査に分解して並列実行します。

  調査1: AIエージェント市場のトレンドと市場規模（Market Trends）
  調査2: 主要プレイヤーとフレームワーク比較（Key Players）
  調査3: ビジネスチャンスとニッチ機会（Opportunities）

  3つのサブエージェントに委任し、並列で実行します。
  完了まで約8分の見込みです。
```

<!-- 日本語解説: Sentinelは自分で調査せず、まずタスクを分解します。
     これがオーケストレーターパターンの核心です。 -->

### Step 3: Sentinel launches sub-agents（サブエージェントを起動する）

Sentinel executes the following commands:

```bash
# Three sub-agents launched in parallel
# （3つのサブエージェントを並列起動）

claude -p "
You are a research sub-agent. Investigate the following topic and write
your findings to the specified output file.

Topic: AI Agent Market — Trends and Market Size (2024-2026)
Search queries: Use at least 10 queries (mix of English and Japanese).
Output file: ~/agent/logs/market_trends.md
Output format:
  ## Summary (3-5 bullet points)
  ## Key Findings (numbered list with sources)
  ## Data Points (table format: metric | value | source)
  ## Sources (numbered URL list)

Constraints:
  - Do NOT modify MEMORY.md or TASKS.md
  - Write findings in English with Japanese annotations where helpful
  - Include specific numbers (market size, growth rates, adoption stats)
" --dangerously-skip-permissions &

claude -p "
You are a research sub-agent. Investigate the following topic and write
your findings to the specified output file.

Topic: AI Agent Frameworks and Key Players — Comparison Analysis
Search queries: Use at least 10 queries.
Output file: ~/agent/logs/key_players.md
Output format:
  ## Summary (3-5 bullet points)
  ## Framework Comparison (table: name | org | stars | strengths | weaknesses)
  ## Company Profiles (5-8 major players)
  ## Sources (numbered URL list)

Constraints:
  - Do NOT modify MEMORY.md or TASKS.md
" --dangerously-skip-permissions &

claude -p "
You are a research sub-agent. Investigate the following topic and write
your findings to the specified output file.

Topic: AI Agent Business Opportunities and Underserved Niches
Search queries: Use at least 10 queries (include Japanese market queries).
Output file: ~/agent/logs/opportunities.md
Output format:
  ## Summary (3-5 bullet points)
  ## Opportunity Map (table: opportunity | market size | competition | feasibility)
  ## Recommended Top 3 (detailed analysis for each)
  ## Sources (numbered URL list)

Constraints:
  - Do NOT modify MEMORY.md or TASKS.md
" --dangerously-skip-permissions &

# Wait for all three to complete
# （3つ全ての完了を待つ）
wait
```

<!-- 日本語解説: claude -p で起動したサブエージェントは独立プロセスとして動作します。
     & でバックグラウンド実行し、wait で全完了を待ちます。
     これにより3つの調査が同時に進行し、所要時間は最も遅い1つ分だけになります。 -->

### Step 4: Sentinel reports progress（進捗を報告する）

```
Sentinel: 3つの調査を並列実行中です...

  🔍 調査1: 市場トレンド — 実行中（sub-agent #1）
  🔍 調査2: 主要プレイヤー — 実行中（sub-agent #2）
  🔍 調査3: ビジネスチャンス — 実行中（sub-agent #3）

  完了次第、結果を統合して報告します。
```

### Step 5: Results are delivered（結果を報告する）

After ~8 minutes, all three sub-agents complete. Sentinel reads the output files and provides a consolidated summary:

```
Sentinel: 全3調査が完了しました。結果を報告します。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  リサーチ完了: AIエージェント市場調査
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

■ 実行サマリー
  - 検索クエリ数: 33（調査1: 12, 調査2: 11, 調査3: 10）
  - 参照ソース数: 60+
  - 所要時間: 約8分（並列実行）
  - 出力ファイル: logs/market_trends.md, logs/key_players.md, logs/opportunities.md

■ Key Findings

  1. Market Size: The AI agent market is projected to reach $XX billion
     by 2028, growing at 45%+ CAGR.

  2. Dominant Frameworks: LangGraph, CrewAI, and AutoGen lead in GitHub
     stars, but Claude Code's sub-agent pattern is gaining traction for
     its simplicity.

  3. Enterprise Adoption: 67% of Fortune 500 companies have AI agent
     pilots in progress (up from 23% in 2024).

  4. Underserved Niches: Domain-specific agents (legal, medical, finance)
     and Japanese-market agent tooling show low competition with high
     demand signals.

  5. Revenue Models: SaaS wrappers around agent frameworks, consulting,
     and template marketplaces are the top 3 monetization paths.

■ 推奨アクション
  - 詳細は各ファイルを参照してください
  - 特にビジネスチャンスのTOP3推奨は logs/opportunities.md に記載

  次のステップとして何か深掘りしたい分野はありますか？
```

### Step 6: PDCA retrospective runs automatically（PDCAの振り返りを自動実行）

After delivering results, Sentinel automatically runs its retrospective cycle:

```
Sentinel: [PDCA] 振り返りを実行します。

  ✅ Check:
    - 結果の質: 3調査とも要件を満たす出力。数値データも含まれている。
    - 効率性: 並列実行により8分で完了（逐次なら約24分の見込み）。
    - サブエージェント指示: 出力テンプレートを詳細指定したことで手戻りゼロ。
    - 改善点: 調査1のクエリ数が12と多め。10に絞っても同品質だった可能性あり。

  🔄 Act:
    - skills/research.md のクエリ数ガイドラインを更新:
      「初回10クエリ → 不足があれば追加3-5クエリ」に変更。
    - この振り返り結果を MEMORY.md に記録します。
```

### Step 7: Sentinel updates MEMORY.md（MEMORYに記録する）

```markdown
# Added to MEMORY.md automatically:
# （以下がMEMORY.mdに自動追記される）

### 2026-04-01 — AI Agent Market Research (3 parallel sub-agents)
- **What went well:** Parallel execution cut research time from ~24 min to 8 min.
  Detailed output templates eliminated rework. 33 queries across 60+ sources
  produced comprehensive coverage.
- **What could be improved:** Sub-agent #1 used 12 queries where 10 would have
  sufficed. Over-querying wastes API calls without improving quality.
- **Action taken:** Updated research skill to recommend 10 initial queries with
  3-5 supplementary queries only when gaps are identified.
- **Applied to:** skills/research.md
```

<!-- 日本語解説: この振り返りは次回のリサーチタスクに自動的に反映されます。
     エージェントは同じ非効率を二度繰り返しません。これがPDCAの力です。 -->

---

## Key Takeaways

| Aspect | Detail |
|--------|--------|
| **Total time** | ~8 minutes (vs. ~24 min sequential) |
| **Search queries** | 33 queries across English and Japanese |
| **Sources analyzed** | 60+ web pages and articles |
| **Sub-agents used** | 3 (parallel execution) |
| **Human intervention** | 1 message (the initial request) |
| **Self-improvement** | 1 skill file updated automatically |

The user typed **one sentence**. Sentinel handled everything else: task decomposition, parallel execution, result aggregation, and self-improvement.

---

> [Back to README](../README.md)
