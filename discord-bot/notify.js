/**
 * Discord Webhook通知スクリプト
 *
 * 使い方:
 *   node notify.js "通知メッセージ"
 *   node notify.js --title "タイトル" --body "本文"
 *
 * sentinel.jsやcronから呼び出して、Discordに通知を送る。
 * WebhookのURLは.envのDISCORD_WEBHOOK_URLに設定。
 */

import 'dotenv/config';

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function sendNotification(title, body, color = 0x00FF00) {
  if (!WEBHOOK_URL) {
    console.error('❌ DISCORD_WEBHOOK_URL が設定されていません。');
    console.error('   Discordサーバーの設定 → 連携サービス → ウェブフック → 新しいウェブフック → URLをコピー');
    process.exit(1);
  }

  const payload = {
    embeds: [{
      title,
      description: body,
      color,
      timestamp: new Date().toISOString(),
      footer: { text: 'Sentinel Notification' },
    }],
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      console.log('✅ 通知送信完了');
    } else {
      console.error(`❌ 通知失敗: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`❌ 通知エラー: ${err.message}`);
  }
}

// CLI
const args = process.argv.slice(2);

if (args[0] === '--title') {
  const title = args[1] || 'Sentinel';
  const bodyIdx = args.indexOf('--body');
  const body = bodyIdx >= 0 ? args[bodyIdx + 1] : '';
  await sendNotification(title, body);
} else if (args.length > 0) {
  await sendNotification('Sentinel', args.join(' '));
} else {
  console.log('使い方:');
  console.log('  node notify.js "通知メッセージ"');
  console.log('  node notify.js --title "タイトル" --body "本文"');
}

export { sendNotification };
