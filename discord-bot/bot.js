/**
 * Sentinel Discord Bot
 *
 * 機能:
 * - !status  — Sentinelの現在の状態を表示
 * - !tasks   — TASKS.mdの内容を表示
 * - !ask <質問> — Sentinelに質問を投げる（claude -p経由）
 * - !post <テキスト> — @sentinel_dev93でツイート投稿
 * - !schedule — X投稿スケジュール表示
 * - !help    — コマンド一覧
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, Partials } from 'discord.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

const SENTINEL_DIR = process.env.SENTINEL_DIR || 'C:/Users/jtafu/agent';
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS
  ? process.env.ALLOWED_USER_IDS.split(',')
  : []; // 空なら全員許可（プライベートサーバー前提）

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction],
});

client.once('ready', () => {
  console.log(`✅ Sentinel Bot 起動: ${client.user.tag}`);
  console.log(`   サーバー数: ${client.guilds.cache.size}`);
});

/**
 * 権限チェック
 */
function isAllowed(userId) {
  if (ALLOWED_USER_IDS.length === 0) return true;
  return ALLOWED_USER_IDS.includes(userId);
}

/**
 * ファイルを安全に読む
 */
function readSafe(filePath, maxLen = 1800) {
  try {
    const fullPath = path.resolve(SENTINEL_DIR, filePath);
    if (!existsSync(fullPath)) return `(ファイルが見つかりません: ${filePath})`;
    const content = readFileSync(fullPath, 'utf-8');
    return content.length > maxLen ? content.substring(0, maxLen) + '\n...(省略)' : content;
  } catch (e) {
    return `(読み取りエラー: ${e.message})`;
  }
}

/**
 * コマンドハンドラ
 */
const commands = {
  help: async (message) => {
    const embed = new EmbedBuilder()
      .setTitle('Sentinel Bot コマンド一覧')
      .setColor(0x5865F2)
      .addFields(
        { name: '!status', value: 'Sentinelの現在の状態を表示', inline: true },
        { name: '!tasks', value: 'タスク一覧を表示', inline: true },
        { name: '!memory', value: '直近の作業記録を表示', inline: true },
        { name: '!ask <質問>', value: 'Sentinelに質問（claude -p経由）', inline: true },
        { name: '!post <テキスト>', value: '@sentinel_dev93でツイート', inline: true },
        { name: '!schedule', value: 'X投稿スケジュール表示', inline: true },
        { name: '!usage', value: 'トークン使用量を表示', inline: true },
        { name: '!restart', value: 'Sentinelを再起動（次回heartbeatで実行）', inline: true },
      )
      .setFooter({ text: 'Sentinel v1.0' })
      .setTimestamp();
    await message.reply({ embeds: [embed] });
  },

  status: async (message) => {
    const tasks = readSafe('TASKS.md');
    const running = tasks.match(/## 実行中\n([\s\S]*?)(?=\n## )/)?.[1]?.trim() || '（なし）';
    const waiting = (tasks.match(/- \[ \]/g) || []).length;
    const done = (tasks.match(/- \[x\]/g) || []).length;

    const embed = new EmbedBuilder()
      .setTitle('Sentinel ステータス')
      .setColor(0x00FF00)
      .addFields(
        { name: '実行中', value: running.substring(0, 200) || '（なし）', inline: false },
        { name: '待機中', value: `${waiting}件`, inline: true },
        { name: '完了', value: `${done}件`, inline: true },
      )
      .setTimestamp();
    await message.reply({ embeds: [embed] });
  },

  tasks: async (message) => {
    const content = readSafe('TASKS.md');
    await message.reply(`\`\`\`\n${content}\n\`\`\``);
  },

  memory: async (message) => {
    const content = readSafe('MEMORY.md');
    // 直近の作業記録（最後の500文字）を表示
    const recent = content.length > 1500 ? '...' + content.substring(content.length - 1500) : content;
    await message.reply(`\`\`\`\n${recent}\n\`\`\``);
  },

  ask: async (message, args) => {
    if (!args) {
      return message.reply('使い方: `!ask <質問>`');
    }

    const SENTINEL_API = process.env.SENTINEL_API_URL || 'http://localhost:3100';

    try {
      // sentinel.jsの/send APIにメッセージを送信（同じBrainセッションを共有）
      // callback_urlを渡すと、応答がDiscord Webhookで返ってくる
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      const res = await fetch(`${SENTINEL_API}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `【Discordからのメッセージ（${message.author.displayName || message.author.username}）】\n${args}`,
          callback_url: webhookUrl || undefined,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) throw new Error(`API ${res.status}`);

      const replyText = webhookUrl
        ? '✅ sentinel.jsに送信しました。応答はこのチャンネルに返ります。'
        : '✅ sentinel.jsに送信しました。応答はWeb UI (http://localhost:3100) で確認できます。';
      await message.reply(replyText);
    } catch (err) {
      // sentinel.jsが起動していない → claude -p直接実行にフォールバック
      console.log('sentinel.js API不達、フォールバック: claude -p');
      await message.reply('⚠️ sentinel.js未起動。claude -pで直接実行します...');

      try {
        const { stdout } = await execFileAsync(
          'claude',
          ['-p', '--max-turns', '3', args],
          { timeout: 180000, cwd: SENTINEL_DIR, maxBuffer: 1024 * 1024 }
        );
        const response = stdout.trim();
        if (response.length > 1900) {
          const chunks = response.match(/[\s\S]{1,1900}/g) || [];
          for (const chunk of chunks) {
            await message.channel.send(`\`\`\`\n${chunk}\n\`\`\``);
          }
        } else {
          await message.channel.send(response || '(応答なし)');
        }
      } catch (fallbackErr) {
        await message.channel.send(`❌ エラー: ${fallbackErr.message.substring(0, 500)}`);
      }
    }
  },

  post: async (message, args) => {
    if (!args) {
      return message.reply('使い方: `!post <テキスト>`');
    }

    await message.reply('📤 投稿中...');

    try {
      const postScript = path.resolve(SENTINEL_DIR, 'x-autoposter/post.js');
      const { stdout } = await execFileAsync(
        'node',
        [postScript, args],
        {
          timeout: 30000,
          cwd: path.resolve(SENTINEL_DIR, 'x-autoposter'),
        }
      );
      await message.channel.send(stdout.trim() || '✅ 投稿完了');
    } catch (err) {
      await message.channel.send(`❌ 投稿失敗: ${err.message.substring(0, 500)}`);
    }
  },

  schedule: async (message) => {
    try {
      const schedulerScript = path.resolve(SENTINEL_DIR, 'x-autoposter/scheduler.js');
      const { stdout } = await execFileAsync(
        'node',
        [schedulerScript],
        {
          timeout: 10000,
          cwd: path.resolve(SENTINEL_DIR, 'x-autoposter'),
        }
      );
      await message.reply(`\`\`\`\n${stdout.substring(0, 1900)}\n\`\`\``);
    } catch (err) {
      await message.reply(`❌ エラー: ${err.message.substring(0, 500)}`);
    }
  },

  usage: async (message) => {
    const usageLog = path.resolve(SENTINEL_DIR, 'logs', 'token_usage.jsonl');
    try {
      if (!existsSync(usageLog)) {
        return message.reply('トークン使用量のログがまだありません。sentinel.js再起動後に記録が開始されます。');
      }
      const lines = readFileSync(usageLog, 'utf-8').split('\n').filter(l => l.trim());
      const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

      let totalIn = 0, totalOut = 0, totalCacheR = 0, totalCost = 0;
      for (const e of entries) {
        totalIn += e.inputTokens || 0;
        totalOut += e.outputTokens || 0;
        totalCacheR += e.cacheRead || 0;
        totalCost += e.costUSD || 0;
      }

      // 直近5ターンの詳細
      const recent = entries.slice(-5).map(e =>
        `Turn${e.turn} [${e.eventType}] in=${e.inputTokens} out=${e.outputTokens} $${(e.costUSD || 0).toFixed(4)}`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('📊 トークン使用量')
        .setColor(0xFF9900)
        .addFields(
          { name: '累計ターン数', value: `${entries.length}`, inline: true },
          { name: '累計コスト', value: `$${totalCost.toFixed(4)}`, inline: true },
          { name: '入力トークン', value: `${totalIn.toLocaleString()}`, inline: true },
          { name: '出力トークン', value: `${totalOut.toLocaleString()}`, inline: true },
          { name: 'キャッシュ読取', value: `${totalCacheR.toLocaleString()}`, inline: true },
          { name: '直近5ターン', value: `\`\`\`\n${recent || '(なし)'}\n\`\`\``, inline: false },
        )
        .setTimestamp();
      await message.reply({ embeds: [embed] });
    } catch (err) {
      await message.reply(`❌ エラー: ${err.message.substring(0, 500)}`);
    }
  },

  restart: async (message) => {
    const flagPath = path.resolve(SENTINEL_DIR, '.restart-sentinel');
    try {
      writeFileSync(flagPath, `restart requested at ${new Date().toISOString()} by ${message.author.username}`);
      await message.reply('🔄 再起動フラグを設定しました。次のheartbeat（最大30分以内）でsentinelが再起動されます。');
    } catch (err) {
      await message.reply(`❌ フラグ設定失敗: ${err.message}`);
    }
  },
};

/**
 * Discord添付ファイルをダウンロードして保存
 */
async function downloadAttachments(message) {
  if (message.attachments.size === 0) return [];

  const downloadDir = path.resolve(SENTINEL_DIR, 'content', 'discord');
  if (!existsSync(downloadDir)) mkdirSync(downloadDir, { recursive: true });

  const savedFiles = [];
  for (const [, att] of message.attachments) {
    try {
      const response = await fetch(att.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const timestamp = Date.now();
      const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.resolve(downloadDir, `${timestamp}_${safeName}`);
      writeFileSync(filePath, buffer);
      savedFiles.push({ name: att.name, path: filePath, size: buffer.length, contentType: att.contentType });
      console.log(`📎 添付ファイル保存: ${filePath} (${buffer.length} bytes)`);
    } catch (err) {
      console.error(`❌ 添付ファイルDL失敗: ${att.name} - ${err.message}`);
    }
  }
  return savedFiles;
}

/**
 * sentinel.jsの起動チェック & 自動起動
 */
async function ensureSentinelRunning() {
  try {
    const res = await fetch('http://localhost:3100/', { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    // sentinel.jsが起動していない → 自動起動
    console.log('[Bot] sentinel.js未起動。自動起動中...');
    const sentinelScript = path.resolve(SENTINEL_DIR, 'sentinel.js');
    const { spawn: spawnProcess } = await import('child_process');
    const proc = spawnProcess('node', [sentinelScript], {
      cwd: SENTINEL_DIR,
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();
    // 起動待ち（最大10秒）
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const check = await fetch('http://localhost:3100/', { signal: AbortSignal.timeout(1000) });
        if (check.ok) {
          console.log('[Bot] sentinel.js 自動起動完了');
          return true;
        }
      } catch { /* まだ起動中 */ }
    }
    console.log('[Bot] sentinel.js 起動タイムアウト');
    return false;
  }
}

/**
 * メッセージハンドラ
 */
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!isAllowed(message.author.id)) return;

  // エージェントルーティング: チャンネルIDから送信先を決定
  const agentRoutes = {};
  if (process.env.AGENT_ROUTES) {
    for (const entry of process.env.AGENT_ROUTES.split('|')) {
      const [channelId, rest] = entry.split('=');
      const [apiUrl, webhookUrl] = rest.split(',');
      agentRoutes[channelId.trim()] = { apiUrl: apiUrl.trim(), webhookUrl: webhookUrl.trim() };
    }
  }

  // ルーティング対象チャンネルのみ反応
  const route = agentRoutes[message.channelId];
  if (Object.keys(agentRoutes).length > 0 && !route) return;

  // !コマンドの処理
  if (message.content.startsWith('!')) {
    const [cmd, ...argParts] = message.content.slice(1).split(' ');
    const args = argParts.join(' ').trim() || null;
    const handler = commands[cmd.toLowerCase()];

    if (handler) {
      try {
        await handler(message, args);
      } catch (err) {
        console.error(`コマンドエラー [${cmd}]:`, err);
        await message.reply(`❌ 内部エラー: ${err.message.substring(0, 200)}`);
      }
    }
    return;
  }

  // !なしの通常メッセージ → sentinel.jsに送信（!askと同じ動作）
  const text = message.content.trim();

  // 添付ファイルのダウンロード
  const savedFiles = await downloadAttachments(message);

  // テキストも添付もなければスキップ
  if (!text && savedFiles.length === 0) return;

  // メッセージ本文を組み立て
  let msgBody = `【Discordからのメッセージ（${message.author.displayName || message.author.username}）】\n${text}`;
  if (savedFiles.length > 0) {
    const fileInfo = savedFiles.map(f => `- ${f.name} → ${f.path}`).join('\n');
    msgBody += `\n\n【添付ファイル（ダウンロード済み）】\n${fileInfo}`;
    await message.reply(`📎 ${savedFiles.length}件のファイルを保存しました。`);
  }

  const SENTINEL_API = route?.apiUrl || process.env.SENTINEL_API_URL || 'http://localhost:3100';
  const webhookUrl = route?.webhookUrl || process.env.DISCORD_WEBHOOK_URL;

  // sentinel.jsが起動していなければ自動起動
  const running = await ensureSentinelRunning();

  if (running) {
    try {
      const res = await fetch(`${SENTINEL_API}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msgBody,
          callback_url: webhookUrl || undefined,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      if (savedFiles.length === 0 && !text.startsWith('/')) await message.reply('🤔 考え中...');
    } catch (err) {
      await message.reply(`❌ sentinel.js送信エラー: ${err.message}`);
    }
  } else {
    // フォールバック: claude -p直接実行
    await message.reply('⚠️ sentinel.js起動失敗。claude -pで直接実行...');
    try {
      const { stdout } = await execFileAsync(
        'claude',
        ['-p', '--max-turns', '3', text],
        { timeout: 180000, cwd: SENTINEL_DIR, maxBuffer: 1024 * 1024 }
      );
      const response = stdout.trim();
      if (response.length > 1900) {
        const chunks = response.match(/[\s\S]{1,1900}/g) || [];
        for (const chunk of chunks) {
          await message.channel.send(`\`\`\`\n${chunk}\n\`\`\``);
        }
      } else {
        await message.channel.send(response || '(応答なし)');
      }
    } catch (fallbackErr) {
      await message.channel.send(`❌ エラー: ${fallbackErr.message.substring(0, 500)}`);
    }
  }
});

// リアクションでheartbeatチャンネルからメインチャンネルへ転送
const HEARTBEAT_CHANNEL_ID = process.env.HEARTBEAT_CHANNEL_ID;
const MAIN_CHANNEL_ID = process.env.MAIN_CHANNEL_ID;

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  // partialの場合はfetch
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch { return; }
  }

  // heartbeatチャンネルのメッセージのみ対象
  if (!HEARTBEAT_CHANNEL_ID || reaction.message.channelId !== HEARTBEAT_CHANNEL_ID) return;

  // メインチャンネルに転送
  try {
    const mainChannel = await client.channels.fetch(MAIN_CHANNEL_ID);
    if (!mainChannel) return;

    const content = reaction.message.content;
    const msg = `**[Heartbeat転送]**\n${content}`;
    const chunks = [];
    for (let i = 0; i < msg.length; i += 1900) {
      chunks.push(msg.substring(i, i + 1900));
    }
    for (const chunk of chunks) {
      await mainChannel.send(chunk);
    }
  } catch (e) {
    console.error('[Reaction転送エラー]', e.message);
  }
});

client.login(process.env.DISCORD_TOKEN);
