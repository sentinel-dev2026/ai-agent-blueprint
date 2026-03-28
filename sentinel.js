// sentinel.js - Sentinel Agent Runtime
// Brain(claude -p)を純粋な思考エンジンとして使い、
// 実行(サブエージェント起動・ファイル更新)はこのランタイムが担う。

const { exec, spawn: spawnChild } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');

// .env読み込み
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    }
  }
} catch (e) {}

const HOME = process.env.HOME || process.env.USERPROFILE;
const AGENT_DIR = path.join(HOME, 'agent');
const JOBS_DIR = path.join(AGENT_DIR, 'jobs');
const SCRIPTS_DIR = path.join(AGENT_DIR, 'scripts');

fs.mkdirSync(JOBS_DIR, { recursive: true });

// ============================================================
// State
// ============================================================
const jobs = new Map();           // id -> { status, prompt, result }
let brainBusy = false;            // Brain呼び出し中フラグ
let brainProc = null;             // 常駐CLIプロセス
const pendingEvents = [];         // Brain処理待ちイベントキュー
let brainSessionId = null;        // Brainのセッション維持用
const SESSION_FILE = path.join(AGENT_DIR, '.brain_session_id');

// ============================================================
// 常駐CLIプロセス管理 (v2方式)
// ============================================================
let brainReady = false;
let brainResolve = null;          // 現在の応答待ちPromise resolver
let brainChunks = [];             // 応答チャンク蓄積

function startBrainProcess() {
  if (brainProc) return;
  printSystem('[v2] Claude CLI 常駐プロセス起動中...');

  const systemPrompt = 'あなたはSentinel。Junyaの自律AIアシスタント。日本語で簡潔に応答する。';

  brainProc = spawnChild('claude', [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--system-prompt', systemPrompt,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: AGENT_DIR,
  });

  const rl = readline.createInterface({ input: brainProc.stdout });
  rl.on('line', (line) => {
    try {
      const data = JSON.parse(line);
      handleBrainEvent(data);
    } catch (e) {
      // non-JSON output, ignore
    }
  });

  brainProc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) printSystem(`[v2] stderr: ${text.substring(0, 200)}`);
  });

  brainProc.on('close', (code) => {
    printSystem(`[v2] CLI プロセス終了 (code: ${code})`);
    brainReady = false;
    brainProc = null;
    // 応答待ち中なら失敗で返す
    if (brainResolve) {
      brainResolve({ text: '[CLIプロセスが終了しました]', usage: {}, cost: 0 });
      brainResolve = null;
    }
    // 自動再起動
    setTimeout(() => {
      printSystem('[v2] 自動再起動...');
      startBrainProcess();
    }, 5000);
  });

  brainProc.on('error', (err) => {
    printSystem(`[v2] CLI 起動エラー: ${err.message}`);
  });
}

function handleBrainEvent(data) {
  switch (data.type) {
    case 'system':
      if (data.subtype === 'init') {
        const isFirst = !brainReady;
        brainSessionId = data.session_id;
        brainReady = true;
        try { fs.writeFileSync(SESSION_FILE, brainSessionId, 'utf8'); } catch (e) {}
        if (isFirst) {
          printSystem(`[v2] 初期化完了 session=${brainSessionId?.slice(0, 8)} model=${data.model}`);
        }
      }
      break;

    case 'assistant':
      if (data.message?.content) {
        for (const block of data.message.content) {
          if (block.type === 'text') {
            brainChunks.push(block.text);
          }
        }
      }
      break;

    case 'result': {
      const fullText = data.result || brainChunks.join('');
      const usage = data.usage || {};
      printSystem(`[v2] 応答完了 (${data.num_turns}ターン, $${(data.total_cost_usd || 0).toFixed(4)})`);

      // トークン使用量ログ
      try {
        const logEntry = {
          timestamp: new Date().toISOString(),
          turn: ++sessionUsage.turns,
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheRead: usage.cache_read_input_tokens || 0,
          cacheCreation: usage.cache_creation_input_tokens || 0,
          costUSD: data.total_cost_usd || 0,
        };
        sessionUsage.inputTokens += logEntry.inputTokens;
        sessionUsage.outputTokens += logEntry.outputTokens;
        sessionUsage.cacheRead += logEntry.cacheRead;
        sessionUsage.cacheCreation += logEntry.cacheCreation;
        sessionUsage.totalCost += logEntry.costUSD;

        sendToUI('usage', { turn: logEntry, session: { ...sessionUsage } });
        printSystem(`📊 Turn ${logEntry.turn}: in=${logEntry.inputTokens} out=${logEntry.outputTokens} cache_r=${logEntry.cacheRead} cache_c=${logEntry.cacheCreation} cost=$${logEntry.costUSD.toFixed(4)} | 累計: $${sessionUsage.totalCost.toFixed(4)}`);
        fs.appendFileSync(USAGE_LOG_FILE, JSON.stringify(logEntry) + '\n');
      } catch (e) {}

      if (brainResolve) {
        brainResolve({ text: fullText, usage, cost: data.total_cost_usd || 0 });
        brainResolve = null;
      }
      brainChunks = [];
      break;
    }

    default:
      break;
  }
}

function sendToBrain(text) {
  return new Promise((resolve, reject) => {
    if (!brainProc) {
      reject(new Error('CLIプロセスが起動していません'));
      return;
    }

    brainResolve = resolve;
    brainChunks = [];

    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text }
    }) + '\n';

    brainProc.stdin.write(msg);

    // タイムアウト (5分)
    setTimeout(() => {
      if (brainResolve === resolve) {
        brainResolve = null;
        resolve({ text: '(タイムアウト)', usage: {}, cost: 0 });
      }
    }, 300000);
  });
}


// トークン使用量追跡
let sessionUsage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, totalCost: 0, turns: 0 };
const USAGE_LOG_FILE = path.join(AGENT_DIR, 'logs', 'token_usage.jsonl');

// ============================================================
// 会話履歴の永続化（2層: サマリー + 直近生ログ）
// ============================================================
const HISTORY_FILE = path.join(AGENT_DIR, 'conversation_history.jsonl');
const HISTORY_ARCHIVE_DIR = path.join(AGENT_DIR, 'logs', 'conversation_archive');
const SUMMARY_FILE = path.join(AGENT_DIR, 'conversation_summary.md');
const MAX_RECENT = 60;            // 直近の生ログ保持件数

// 起動時にファイルから読み込み
function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const lines = fs.readFileSync(HISTORY_FILE, 'utf8').trim().split('\n').filter(Boolean);
    return lines.map(line => JSON.parse(line));
  } catch (e) {
    return [];
  }
}

function loadSummary() {
  try {
    if (!fs.existsSync(SUMMARY_FILE)) return '';
    return fs.readFileSync(SUMMARY_FILE, 'utf8');
  } catch (e) {
    return '';
  }
}

// 1件追記
function appendHistory(entry) {
  const record = { ...entry, timestamp: new Date().toISOString() };
  conversationLog.push(record);
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(record) + '\n', 'utf8');

  // 直近件数を超えたら古い分を要約（非同期、エラーでも止めない）
  if (conversationLog.length > MAX_RECENT) {
    compressHistory().catch(e => printSystem(`圧縮エラー: ${e.message}`));
  }
}

// 古い会話を要約して圧縮（使い捨てclaude -p）
async function compressHistory() {
  const toSummarize = conversationLog.slice(0, -MAX_RECENT);
  if (toSummarize.length < 40) return; // 差分40件（約20往復）未満ならスキップ

  printSystem('会話履歴を圧縮中...');

  const oldSummary = loadSummary();
  const textToCompress = toSummarize.map(e =>
    `[${e.timestamp || ''}] ${e.role}: ${e.content}`
  ).join('\n');

  const compressPrompt = `以下は過去の会話ログと既存のサマリーである。
これらを統合して、重要な情報だけを残した簡潔なサマリーに圧縮せよ。

【ルール】
- 決定事項、指示、方針変更、重要な成果は必ず残す
- 雑談や挨拶は省略する
- 時系列は保持する
- 箇条書きで簡潔に
- 最大2000文字以内

【既存サマリー】
${oldSummary || '(なし)'}

【新しい会話ログ】
${textToCompress}

サマリーだけを出力せよ。余計な前置きは不要。`;

  const result = await new Promise((resolve) => {
    const proc = spawnChild('claude', ['-p', '--dangerously-skip-permissions'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.on('close', (code) => {
      resolve(code === 0 ? stdout.trim() : null);
    });
    proc.on('error', () => resolve(null));
    proc.stdin.write(compressPrompt);
    proc.stdin.end();
  });

  if (result) {
    // サマリーを保存
    fs.writeFileSync(SUMMARY_FILE, result, 'utf8');

    // 古い履歴をアーカイブに保存
    fs.mkdirSync(HISTORY_ARCHIVE_DIR, { recursive: true });
    const archiveName = `archive_${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    const archivePath = path.join(HISTORY_ARCHIVE_DIR, archiveName);
    const archiveLines = toSummarize.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(archivePath, archiveLines, 'utf8');

    // メモリとファイルを直近だけに
    const recent = conversationLog.slice(-MAX_RECENT);
    conversationLog.length = 0;
    recent.forEach(r => conversationLog.push(r));
    const newLines = recent.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(HISTORY_FILE, newLines, 'utf8');

    printSystem(`会話履歴を圧縮完了（${toSummarize.length}件 → サマリー化、アーカイブ: ${archiveName}）`);
  } else {
    printSystem('会話履歴の圧縮に失敗（次回リトライ）');
  }
}

// Brainに渡す会話コンテキストを構築
function buildConversationContext() {
  const summary = loadSummary();
  const recent = conversationLog.slice(-MAX_RECENT).map(e =>
    `${e.role}: ${e.content}`
  ).join('\n');

  let context = '';
  if (summary) {
    context += `【過去の会話サマリー】\n${summary}\n\n`;
  }
  context += `【直近の会話】\n${recent || '(なし)'}`;
  return context;
}

const conversationLog = loadHistory();

// 前回のBrainセッションIDを復元
try {
  if (fs.existsSync(SESSION_FILE)) {
    brainSessionId = fs.readFileSync(SESSION_FILE, 'utf8').trim();
  }
} catch (e) {}

// ============================================================
// Web UI
// ============================================================
const WEB_PORT = 3100;
const sseClients = new Set();  // Server-Sent Events 接続中のクライアント
const pendingCallbacks = [];   // Discord等からのコールバックURL待ち行列

// ブラウザにイベントを送信
function sendToUI(type, data) {
  const msg = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
}

function printSentinel(msg) {
  sendToUI('sentinel', { content: msg });
  console.log(`[Sentinel] ${msg.slice(0, 100)}...`);
}

function printSystem(msg) {
  sendToUI('system', { content: msg });
}

// 思考中インジケーター
let thinkingTimer = null;
let thinkingElapsed = 0;

function startThinking() {
  thinkingElapsed = 0;
  sendToUI('thinking', { active: true, seconds: 0 });
  thinkingTimer = setInterval(() => {
    thinkingElapsed++;
    sendToUI('thinking', { active: true, seconds: thinkingElapsed });
  }, 1000);
}

function stopThinking() {
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
    sendToUI('thinking', { active: false });
  }
}

function updateStatus() {
  const runningJobs = [...jobs.values()].filter(j => j.status === 'running').length;
  sendToUI('status', {
    jobs: runningJobs,
    queue: pendingEvents.length,
    session: brainSessionId ? brainSessionId.slice(0, 8) : null,
    brainBusy
  });
}

// 入力処理
function handleInput(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (trimmed === '/jobs') {
    const list = [];
    for (const [id, job] of jobs) list.push(`${id}: ${job.status}`);
    if (pendingEvents.length > 0) list.push(`処理待ち: ${pendingEvents.length}件`);
    if (brainBusy) list.push('Brain: 思考中');
    if (list.length === 0) list.push('(何も実行していません)');
    sendToUI('info', { content: list.join('\n') });
    return;
  }

  if (trimmed === '/newsession') {
    brainSessionId = null;
    try { fs.unlinkSync(SESSION_FILE); } catch (e) {}
    printSystem('セッションをリセットしました。次の発言でフルコンテキスト再送します。');
    updateStatus();
    return;
  }

  if (trimmed === '/session') {
    sendToUI('info', { content: `Session ID: ${brainSessionId || '(なし)'}` });
    return;
  }

  // Brain思考中ならキューに追加（中断ではなく追加指示として処理）
  if (brainBusy) {
    printSystem(`入力をキューに追加（現在の処理完了後に優先処理します）`);
  }

  queueEvent({ type: 'user_message', content: trimmed });
  updateStatus();
}

// HTTPサーバー
const webServer = http.createServer((req, res) => {
  // SSE エンドポイント
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // メッセージ受信
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { message, callback_url } = JSON.parse(body);
        if (message) {
          // callback_urlが指定されていたら、応答時にWebhookで返す
          if (callback_url) {
            pendingCallbacks.push({ pattern: message.slice(0, 30), url: callback_url });
          }
          handleInput(message);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400);
        res.end('{"error":"invalid request"}');
      }
    });
    return;
  }

  // HTML UI
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHTML());
    return;
  }

  res.writeHead(404);
  res.end();
});

function getHTML() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sentinel</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', 'Meiryo', sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  #header {
    padding: 8px 16px;
    background: #16213e;
    border-bottom: 1px solid #0f3460;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  #header h1 { font-size: 16px; color: #e94560; }
  #status {
    font-size: 12px;
    color: #888;
    display: flex;
    gap: 16px;
  }
  #status .active { color: #4ecca3; }
  #chat {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .msg { padding: 8px 12px; border-radius: 8px; max-width: 90%; white-space: pre-wrap; word-break: break-word; line-height: 1.6; }
  .msg.sentinel { background: #16213e; border-left: 3px solid #e94560; }
  .msg.user { background: #0f3460; border-left: 3px solid #4ecca3; align-self: flex-end; }
  .msg.system { background: transparent; color: #666; font-size: 12px; border-left: 3px solid #333; }
  .msg.info { background: #1a1a2e; border: 1px solid #333; font-size: 13px; }
  .msg .role { font-size: 11px; font-weight: bold; margin-bottom: 4px; }
  .msg.sentinel .role { color: #e94560; }
  .msg.user .role { color: #4ecca3; }
  #thinking {
    padding: 4px 16px;
    font-size: 13px;
    color: #e94560;
    display: none;
  }
  #thinking.active { display: block; }
  #input-area {
    padding: 12px 16px;
    background: #16213e;
    border-top: 1px solid #0f3460;
    display: flex;
    gap: 8px;
  }
  #input {
    flex: 1;
    background: #1a1a2e;
    color: #e0e0e0;
    border: 1px solid #0f3460;
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 14px;
    font-family: inherit;
    resize: none;
    min-height: 44px;
    max-height: 120px;
    outline: none;
  }
  #input:focus { border-color: #4ecca3; }
  #send {
    background: #e94560;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 20px;
    font-size: 14px;
    cursor: pointer;
    align-self: flex-end;
  }
  #send:hover { background: #c73e54; }
  #commands {
    padding: 4px 16px;
    font-size: 11px;
    color: #555;
    background: #16213e;
  }
</style>
</head>
<body>
  <div id="header">
    <h1>Sentinel</h1>
    <div id="status">
      <span id="st-session">Session: -</span>
      <span id="st-jobs">Jobs: 0</span>
      <span id="st-queue">Queue: 0</span>
    </div>
  </div>
  <div id="chat"></div>
  <div id="thinking">Sentinel 思考中...</div>
  <div id="input-area">
    <textarea id="input" rows="1" placeholder="メッセージを入力... (Ctrl+Enter で送信)"></textarea>
    <button id="send">送信</button>
  </div>
  <div id="commands">/jobs /session /newsession</div>

<script>
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const thinkingEl = document.getElementById('thinking');

// 自動リサイズ
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});

// 送信
function send() {
  const text = input.value;
  if (!text.trim()) return;
  addMsg('user', 'Junya', text);
  fetch('/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text })
  });
  input.value = '';
  input.style.height = 'auto';
  input.focus();
}

sendBtn.addEventListener('click', send);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send();
  }
});

// メッセージ追加
function addMsg(type, role, content) {
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  if (role) {
    const r = document.createElement('div');
    r.className = 'role';
    r.textContent = role;
    div.appendChild(r);
  }
  const c = document.createElement('div');
  c.textContent = content;
  div.appendChild(c);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// SSE
const es = new EventSource('/events');
es.onmessage = (e) => {
  const data = JSON.parse(e.data);
  switch (data.type) {
    case 'sentinel':
      addMsg('sentinel', 'Sentinel', data.content);
      break;
    case 'system':
      addMsg('system', null, data.content);
      break;
    case 'info':
      addMsg('info', null, data.content);
      break;
    case 'thinking':
      thinkingEl.className = data.active ? 'active' : '';
      if (data.active) thinkingEl.textContent = 'Sentinel 思考中... (' + data.seconds + '秒)';
      break;
    case 'status':
      document.getElementById('st-session').textContent = 'Session: ' + (data.session || '-');
      document.getElementById('st-session').className = data.session ? 'active' : '';
      document.getElementById('st-jobs').textContent = 'Jobs: ' + data.jobs;
      document.getElementById('st-jobs').className = data.jobs > 0 ? 'active' : '';
      document.getElementById('st-queue').textContent = 'Queue: ' + data.queue;
      break;
  }
};

input.focus();
</script>
</body>
</html>`;
}

webServer.listen(WEB_PORT, '0.0.0.0', () => {
  // ローカルIPを取得して表示
  const nets = require('os').networkInterfaces();
  let lanIP = null;
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        lanIP = addr.address;
        break;
      }
    }
    if (lanIP) break;
  }

  console.log('Sentinel Web UI:');
  console.log('  Local: http://localhost:' + WEB_PORT);
  if (lanIP) console.log('  LAN:   http://' + lanIP + ':' + WEB_PORT);

  // ブラウザを自動で開く
  if (process.platform === 'win32') {
    exec('start http://localhost:' + WEB_PORT);
  }
});

// ============================================================
// Brain (claude -p) — セッション維持型
// 初回: フルコンテキストで起動し session_id を取得
// 2回目以降: --resume で同一セッションに追加メッセージのみ送信
// ============================================================

const RESPONSE_FORMAT = `【応答ルール】
以下のフォーマットで必ず応答せよ。フォーマットを崩すな。

---RESPONSE---
(Junyaへの応答テキスト。サブエージェント完了時は結果の要約を含める。)
---ACTIONS---
(JSON形式。不要なら {} とだけ書く)
使えるアクション:
- spawn: サブエージェント起動。 [{"id": "一意な名前", "prompt": "具体的な作業指示"}]
- write_files: ファイル書き込み。 [{"path": "~/agent/MEMORY.md", "content": "全文"}]
- append_files: ファイル追記。 [{"path": "~/agent/MEMORY.md", "content": "追記内容"}]
---END---`;

function buildBootPrompt() {
  let soul, memory, tasks;
  try {
    soul = fs.readFileSync(path.join(AGENT_DIR, 'SOUL.md'), 'utf8');
    memory = fs.readFileSync(path.join(AGENT_DIR, 'MEMORY.md'), 'utf8');
    tasks = fs.readFileSync(path.join(AGENT_DIR, 'TASKS.md'), 'utf8');
  } catch (e) {
    return null;
  }

  const convoContext = buildConversationContext();

  return `あなたはSentinel。Junyaの自律AIアシスタント（オーケストレーター）。
日本語で応答する。

${soul}

---
${memory}

---
${tasks}

---
${convoContext}

---
${RESPONSE_FORMAT}

---
【起動】初回起動。状態を確認して挨拶せよ。`;
}

function buildEventPrompt(event) {
  let eventDesc = '';
  switch (event.type) {
    case 'user_message':
      if (event.isOverride) {
        eventDesc = `【Junyaからの追加指示（方針変更）】\n※ 前の応答の処理中に送られた指示です。前の応答結果より、この指示を優先してください。\n${event.content}`;
      } else {
        eventDesc = `【Junyaからのメッセージ】\n${event.content}`;
      }
      break;
    case 'job_complete':
      eventDesc = `【サブエージェント完了】\nジョブID: ${event.jobId}\n結果:\n${event.result.slice(0, 3000)}`;
      break;
    case 'job_failed':
      eventDesc = `【サブエージェント失敗】\nジョブID: ${event.jobId}\nエラー:\n${event.error}`;
      break;
    case 'heartbeat':
      eventDesc = `【定期巡回レポート（Heartbeat）】\n以下はcronが自律的に生成した提案です。優先度を判断し、実行すべきものがあればACTIONSで実行せよ。Junyaへの報告も含めること。\n\n${event.content}`;
      break;
    case 'boot':
      return buildBootPrompt();
  }

  // ジョブ状態サマリー
  const jobSummary = {};
  for (const [id, job] of jobs) {
    jobSummary[id] = job.status;
  }
  const jobLine = Object.keys(jobSummary).length > 0
    ? `\n実行中のジョブ: ${JSON.stringify(jobSummary)}`
    : '';

  return `${eventDesc}${jobLine}

${RESPONSE_FORMAT}`;
}

function callBrain(event) {
  return new Promise(async (resolve) => {
    const isBootOrNewSession = event.type === 'boot' || !brainSessionId;
    const prompt = isBootOrNewSession ? buildBootPrompt() : buildEventPrompt(event);

    if (!prompt) {
      resolve({ message: '[ファイル読み込みエラー]', actions: {} });
      return;
    }

    // 常駐CLIが未起動なら起動
    if (!brainProc) {
      startBrainProcess();
      // 起動待ち（最大10秒）
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (brainProc) break;
      }
    }

    try {
      const response = await sendToBrain(prompt);
      resolve(parseResponse(response.text));
    } catch (e) {
      resolve({ message: `[Brain エラー: ${e.message}]`, actions: {} });
    }
  });
}

// Brain応答のパース
function parseResponse(raw) {
  // デバッグ: 生レスポンスをログに記録
  try {
    fs.appendFileSync(path.join(AGENT_DIR, 'logs', 'brain_raw.log'),
      `\n=== ${new Date().toISOString()} ===\n${raw}\n`);
  } catch (e) {}

  const msgMatch = raw.match(/---RESPONSE---([\s\S]*?)---ACTIONS---/);
  const actMatch = raw.match(/---ACTIONS---([\s\S]*?)---END---/);

  let message = msgMatch ? msgMatch[1].trim() : raw.trim();
  let actions = {};

  if (actMatch) {
    try {
      let jsonStr = actMatch[1].trim();
      // ```json ... ``` ブロック内のJSONを抽出
      const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlock) jsonStr = codeBlock[1].trim();
      actions = JSON.parse(jsonStr);
    } catch (e) {
      // JSONパース失敗 → ユーザーに通知
      printSystem(`アクションのパースに失敗（Brainが宣言した操作は実行されません）`);
      printSystem(`生データ: ${actMatch[1].trim().slice(0, 200)}`);
    }
  }

  // 宣言とアクション不一致の検出（パターンは config/intent_patterns.json から読み込み）
  const hasEmptyActions = !actions.spawn && !actions.write_files && !actions.append_files;
  let intentMismatch = false;
  if (hasEmptyActions && message) {
    let intentPatterns = [];
    try {
      const patternsFile = path.join(__dirname, 'config', 'intent_patterns.json');
      const patternsData = JSON.parse(fs.readFileSync(patternsFile, 'utf-8'));
      intentPatterns = patternsData.patterns.map(p => new RegExp(p));
    } catch (e) {
      // フォールバック: 最低限のパターン
      intentPatterns = [/実装(する|に入る|を始める|開始)/, /(始める|進める|着手)/];
    }
    const matched = intentPatterns.find(p => p.test(message));
    if (matched) {
      intentMismatch = true;
      printSystem(`⚠️ 意図-アクション不一致を検出。「${message.match(matched)[0]}」→ ACTIONSを自動補完します。`);
    }
  }

  return { message, actions, intentMismatch };
}

// ============================================================
// アクション実行
// ============================================================
function executeActions(actions, origin) {
  if (!actions || typeof actions !== 'object') return;

  // サブエージェント起動
  if (actions.spawn && Array.isArray(actions.spawn)) {
    for (const sub of actions.spawn) {
      if (sub.id && sub.prompt) {
        spawnSubAgent(sub.id, sub.prompt, origin);
      } else {
        printSystem(`spawn指示が不正（id or promptが欠落）: ${JSON.stringify(sub).slice(0, 200)}`);
      }
    }
  }

  // ファイル書き込み（上書き）
  if (actions.write_files && Array.isArray(actions.write_files)) {
    for (const file of actions.write_files) {
      try {
        const filePath = expandHome(file.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.content, 'utf8');
        printSystem(`ファイル更新: ${file.path}`);
      } catch (e) {
        printSystem(`ファイル書き込みエラー: ${e.message}`);
      }
    }
  }

  // ファイル追記
  if (actions.append_files && Array.isArray(actions.append_files)) {
    for (const file of actions.append_files) {
      try {
        const filePath = expandHome(file.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, file.content, 'utf8');
        printSystem(`ファイル追記: ${file.path}`);
      } catch (e) {
        printSystem(`ファイル追記エラー: ${e.message}`);
      }
    }
  }
}

function expandHome(p) {
  return p.replace(/^~[\\/]/, HOME + '/');
}

// ============================================================
// サブエージェント管理
// ============================================================
function spawnSubAgent(id, prompt, origin) {
  if (jobs.has(id) && jobs.get(id).status === 'running') {
    printSystem(`ジョブ "${id}" は既に実行中です`);
    return;
  }

  jobs.set(id, { status: 'running', prompt, result: null, origin: origin || 'user' });
  printSystem(`サブエージェント "${id}" を起動`);

  // サブエージェントの出力をファイルに閉じ込める（ターミナルに漏らさない）
  const jobDir = path.join(JOBS_DIR, id);
  fs.mkdirSync(jobDir, { recursive: true });
  const outFile = path.join(jobDir, 'output.log');
  const errFile = path.join(jobDir, 'error.log');
  const promptFile = path.join(jobDir, 'prompt.txt');
  fs.writeFileSync(promptFile, prompt, 'utf8');

  const { spawn } = require('child_process');

  // プロンプトはファイルパスで渡す（引数長制限・特殊文字の問題を回避）
  const promptFilePosix = promptFile.replace(/\\/g, '/');
  const jobDirPosix = jobDir.replace(/\\/g, '/');
  const scriptPath = path.join(SCRIPTS_DIR, 'run-sub.sh').replace(/\\/g, '/');

  // Windows環境ではGit Bashのフルパスを指定
  const bashCmd = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
    : 'bash';

  // ファイルディスクリプタの二重close防止フラグ
  let fdsClosed = false;
  const outFd = fs.openSync(outFile, 'w');
  const errFd = fs.openSync(errFile, 'w');

  function closeFds() {
    if (fdsClosed) return;
    fdsClosed = true;
    try { fs.closeSync(outFd); } catch (_) {}
    try { fs.closeSync(errFd); } catch (_) {}
  }

  function handleResult(code, fromError) {
    closeFds();

    // error→close両方で呼ばれる場合があるので、処理済みならスキップ
    if (jobs.get(id)?.status !== 'running') return;

    let result;
    try { result = fs.readFileSync(outFile, 'utf8'); } catch (e) { result = ''; }
    let errOutput;
    try { errOutput = fs.readFileSync(errFile, 'utf8'); } catch (e) { errOutput = ''; }

    if (fromError || code !== 0) {
      const errMsg = fromError || errOutput || result || `exit code: ${code}`;
      jobs.set(id, { status: 'failed', prompt, result: errMsg, origin });
      printSystem(`サブエージェント "${id}" 失敗`);
      queueEvent({ type: 'job_failed', jobId: id, error: errMsg, origin });
    } else {
      jobs.set(id, { status: 'done', prompt, result, origin });
      printSystem(`サブエージェント "${id}" 完了`);
      queueEvent({ type: 'job_complete', jobId: id, result, origin });
    }
  }

  // Windows Git Bash環境ではUnixコマンド(mkdir,cat,date等)のPATHを明示的に設定
  const spawnEnv = process.platform === 'win32'
    ? {
        ...process.env,
        PATH: '/usr/bin:/bin:/mingw64/bin:' + (process.env.PATH || '')
      }
    : process.env;

  const proc = spawn(bashCmd, [
    scriptPath,
    '--file', promptFilePosix,
    '--job-dir', jobDirPosix
  ], {
    stdio: ['ignore', outFd, errFd],
    detached: false,
    env: spawnEnv
  });

  proc.on('close', (code) => handleResult(code, null));
  proc.on('error', (err) => handleResult(1, `プロセス起動エラー: ${err.message}`));
}

// ============================================================
// イベントキュー — Brain呼び出しの直列化
// ============================================================
function queueEvent(event) {
  pendingEvents.push(event);
  processNextEvent();
}

async function processNextEvent() {
  if (brainBusy || pendingEvents.length === 0) return;
  brainBusy = true;

  let event = pendingEvents.shift();

  // user_messageが連続している場合、まとめて1つのイベントにする
  // 思考中に追加された指示は「方針変更」として優先扱い
  if (event.type === 'user_message') {
    const additionalMessages = [];
    while (pendingEvents.length > 0 && pendingEvents[0].type === 'user_message') {
      additionalMessages.push(pendingEvents.shift());
    }

    if (additionalMessages.length > 0) {
      // 複数のuser_messageをまとめる
      const allMessages = [event, ...additionalMessages];
      const combined = allMessages.map(m => m.content).join('\n');
      event = {
        type: 'user_message',
        content: combined,
        isOverride: true  // 方針変更フラグ
      };
      printSystem(`${allMessages.length}件のメッセージをまとめて処理します`);
    }

    appendHistory({ role: 'Junya', content: event.content });
  }

  startThinking();
  const response = await callBrain(event);
  stopThinking();

  // 中断された場合 → キューの次を処理
  if (response.interrupted) {
    brainBusy = false;
    processNextEvent();
    return;
  }

  // リトライ処理（overloaded）
  if (response.retry) {
    printSentinel(response.message);
    setTimeout(() => {
      pendingEvents.unshift(event); // 先頭に戻す
      brainBusy = false;
      processNextEvent();
    }, 30000);
    updateStatus();
    return;
  }

  // 意図-アクション不一致 → 再プロンプトでACTIONSを補完
  if (response.intentMismatch) {
    printSystem('🔄 ACTIONSを自動補完するため再プロンプト中...');
    const retryEvent = {
      type: 'system',
      content: `あなたは直前の応答で「${response.message.substring(0, 100)}」と宣言しましたが、ACTIONSが空（{}）でした。\n\n宣言した内容を実行するためのACTIONSを生成してください。応答テキストは短く「ACTIONSを補完します」程度でOK。ACTIONSにspawn/write_files/append_filesを必ず含めること。`
    };
    startThinking();
    const retryResponse = await callBrain(retryEvent);
    stopThinking();

    if (!retryResponse.interrupted && !retryResponse.retry) {
      // 補完されたACTIONSがあればマージ
      const hasRetryActions = retryResponse.actions?.spawn || retryResponse.actions?.write_files || retryResponse.actions?.append_files;
      if (hasRetryActions) {
        printSystem('✅ ACTIONSの自動補完成功');
        response.actions = retryResponse.actions;
        if (retryResponse.message) {
          response.message += '\n\n' + retryResponse.message;
        }
      } else {
        printSystem('⚠️ 再プロンプトでもACTIONSが空。宣言のみで実行はスキップされます。');
      }
    }
  }

  // 応答表示
  printSentinel(response.message);
  appendHistory({ role: 'Sentinel', content: response.message });

  // 内部イベントのDiscord自動通知（チャンネル分離）
  const WEBHOOK_MAIN = process.env.DISCORD_WEBHOOK_MAIN;
  const WEBHOOK_HEARTBEAT = process.env.DISCORD_WEBHOOK_HEARTBEAT;

  const autoNotifyTypes = ['boot', 'heartbeat', 'job_complete', 'job_failed'];
  if (autoNotifyTypes.includes(event.type) && response.message && (WEBHOOK_MAIN || WEBHOOK_HEARTBEAT)) {
    // boot → メインチャンネル
    // heartbeat → heartbeatチャンネル
    // job: originがheartbeat → heartbeatチャンネル、それ以外 → メインチャンネル
    const isHeartbeatOrigin = event.type === 'heartbeat' || event.origin === 'heartbeat';
    const webhookUrl = (event.type === 'boot' || (!isHeartbeatOrigin)) ? WEBHOOK_MAIN : WEBHOOK_HEARTBEAT;
    if (!webhookUrl) { /* Webhook未設定ならスキップ */ } else {
    const prefix = event.type === 'boot' ? '**[起動]**' :
                   event.type === 'heartbeat' ? '**[Heartbeat]**' :
                   event.type === 'job_complete' ? '**[Job完了]**' : '**[Job失敗]**';
    const msg = `${prefix}\n${response.message}`;
    const chunks = [];
    for (let i = 0; i < msg.length; i += 1900) {
      chunks.push(msg.substring(i, i + 1900));
    }
    for (const chunk of chunks) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chunk })
      }).catch(e => console.error('[Webhook Error]', e.message));
    }
    }
  }

  // コールバック実行（Discord等への応答返送）
  if (pendingCallbacks.length > 0) {
    const cb = pendingCallbacks.shift();
    try {
      const msg = response.message || '';
      // Discord Webhook: contentで送信（Embedより確実、2000文字制限）
      // 長文は分割送信
      const chunks = [];
      for (let i = 0; i < msg.length; i += 1900) {
        chunks.push(msg.substring(i, i + 1900));
      }
      if (chunks.length === 0) chunks.push('(応答なし)');

      for (const chunk of chunks) {
        fetch(cb.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: chunk })
        }).catch(e => console.error('[Callback Error]', e.message));
      }
    } catch (e) {
      console.error('[Callback Error]', e.message);
    }
  }

  // アクション実行
  executeActions(response.actions, event.type);

  brainBusy = false;
  updateStatus();

  // キューに次のイベントがあれば処理
  processNextEvent();
}

// ============================================================
// Inbox監視（Heartbeat等からの提案を検知）
// ============================================================
const INBOX_DIR = path.join(AGENT_DIR, 'inbox');
const processedInbox = new Set();

function startInboxWatcher() {
  // 起動時に既存ファイルをprocessed扱い（再起動で再処理しない）
  try {
    const existing = fs.readdirSync(INBOX_DIR).filter(f => f.startsWith('heartbeat_'));
    existing.forEach(f => processedInbox.add(f));
  } catch (e) {}

  // 30秒ごとにチェック
  setInterval(() => {
    try {
      const files = fs.readdirSync(INBOX_DIR).filter(f => f.startsWith('heartbeat_') && !processedInbox.has(f));
      for (const file of files) {
        processedInbox.add(file);
        const content = fs.readFileSync(path.join(INBOX_DIR, file), 'utf8');
        if (content.trim()) {
          printSystem(`[inbox] Heartbeat検知: ${file}`);
          queueEvent({ type: 'heartbeat', content });
        }
      }
    } catch (e) {}
  }, 30000);
}

// ============================================================
// メイン起動
// ============================================================
console.log('Sentinel Agent Runtime starting... (v2: 常駐CLI方式)');

// 常駐CLIプロセスを事前起動
startBrainProcess();
startInboxWatcher();

// v2では常に新規boot（CLIプロセス内でセッション維持される）
console.log('新規セッションを開始します。');
queueEvent({ type: 'boot' });

// 未処理例外のハンドリング
process.on('uncaughtException', (err) => {
  printSystem(`予期しないエラー: ${err.message}`);
});
