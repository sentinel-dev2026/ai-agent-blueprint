/**
 * X 予約投稿スケジューラー
 *
 * 使い方:
 *   npm run schedule                    — スケジュール一覧表示
 *   npm run schedule -- --start 2026-03-28  — 指定日からスケジュール開始（即時起動・常駐）
 *   npm run schedule -- --post-next     — 次の1件だけ即時投稿（テスト用）
 *   npm run schedule -- --dry-run       — 実際には投稿せずスケジュール確認
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { postTweet } from './post.js';

const SCHEDULE_FILE = './schedule.json';
const STATE_FILE = './schedule-state.json';

/**
 * スケジュールデータ読み込み
 */
function loadSchedule() {
  return JSON.parse(readFileSync(SCHEDULE_FILE, 'utf-8'));
}

/**
 * 投稿済み状態の管理
 */
function loadState() {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  }
  return { posted: [], lastCheck: null };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * 開始日からスケジュールを計算
 */
function buildTimeline(schedule, startDate) {
  const start = new Date(startDate + 'T00:00:00+09:00'); // JST
  const timeline = [];

  for (const item of schedule) {
    const postDate = new Date(start);
    postDate.setDate(postDate.getDate() + item.day - 1);

    const [hours, minutes] = item.time.split(':').map(Number);
    postDate.setHours(hours, minutes, 0, 0);

    timeline.push({
      index: timeline.length,
      scheduledAt: postDate,
      time: item.time,
      day: item.day,
      text: item.text,
    });
  }

  return timeline.sort((a, b) => a.scheduledAt - b.scheduledAt);
}

/**
 * スケジュール一覧表示
 */
function showSchedule(startDate) {
  const schedule = loadSchedule();
  const start = startDate || '2026-03-28';
  const timeline = buildTimeline(schedule, start);
  const state = loadState();

  console.log(`\n📅 投稿スケジュール（開始日: ${start}）\n`);
  console.log('─'.repeat(60));

  for (const item of timeline) {
    const dateStr = item.scheduledAt.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
    const posted = state.posted.includes(item.index) ? '✅' : '⬜';
    const preview = item.text.substring(0, 40).replace(/\n/g, ' ');
    console.log(`${posted} Day${item.day} ${dateStr} ${item.time}  ${preview}...`);
  }

  console.log('─'.repeat(60));
  console.log(`合計: ${timeline.length}件 | 投稿済み: ${state.posted.length}件 | 残り: ${timeline.length - state.posted.length}件\n`);
}

/**
 * 次の未投稿を1件投稿
 */
async function postNext(startDate, dryRun = false) {
  const schedule = loadSchedule();
  const timeline = buildTimeline(schedule, startDate);
  const state = loadState();

  const next = timeline.find(item => !state.posted.includes(item.index));
  if (!next) {
    console.log('✅ 全件投稿済み。');
    return null;
  }

  console.log(`\n📤 次の投稿 (Day${next.day} ${next.time}):`);
  console.log(`   ${next.text.substring(0, 60).replace(/\n/g, ' ')}...`);

  if (dryRun) {
    console.log('   [dry-run] 実際には投稿しません');
    return next;
  }

  try {
    const result = await postTweet(next.text);
    state.posted.push(next.index);
    state.lastCheck = new Date().toISOString();
    saveState(state);
    console.log(`✅ 投稿成功 (${state.posted.length}/${timeline.length})`);
    return result;
  } catch (err) {
    console.error(`❌ 投稿失敗: ${err.message}`);
    return null;
  }
}

/**
 * スケジューラー常駐モード
 * 指定時刻になったら自動投稿
 */
async function startDaemon(startDate, dryRun = false) {
  const schedule = loadSchedule();
  const timeline = buildTimeline(schedule, startDate);
  const state = loadState();

  console.log(`\n🤖 スケジューラー起動（開始日: ${startDate}）`);
  console.log(`   全${timeline.length}件 | 投稿済み: ${state.posted.length}件`);
  console.log(`   Ctrl+C で停止\n`);

  const checkInterval = 60 * 1000; // 1分ごとにチェック

  const check = async () => {
    const now = new Date();
    const currentState = loadState();

    for (const item of timeline) {
      if (currentState.posted.includes(item.index)) continue;
      if (now >= item.scheduledAt) {
        console.log(`\n⏰ 投稿時刻到来: Day${item.day} ${item.time}`);

        if (dryRun) {
          console.log(`   [dry-run] ${item.text.substring(0, 50).replace(/\n/g, ' ')}...`);
          currentState.posted.push(item.index);
          saveState(currentState);
          continue;
        }

        try {
          await postTweet(item.text);
          currentState.posted.push(item.index);
          currentState.lastCheck = now.toISOString();
          saveState(currentState);
          console.log(`✅ 投稿完了 (${currentState.posted.length}/${timeline.length})`);
        } catch (err) {
          console.error(`❌ 投稿失敗: ${err.message} — 次回チェックでリトライ`);
        }
      }
    }

    // 全件投稿済みなら終了
    if (currentState.posted.length >= timeline.length) {
      console.log('\n🎉 全件投稿完了！スケジューラーを停止します。');
      process.exit(0);
    }

    // 次の投稿予定を表示
    const nextItem = timeline.find(item => !currentState.posted.includes(item.index));
    if (nextItem) {
      const diff = nextItem.scheduledAt - now;
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      if (diff > 0) {
        process.stdout.write(`\r⏳ 次の投稿まで: ${hours}h${mins}m (Day${nextItem.day} ${nextItem.time})   `);
      }
    }
  };

  // 初回チェック
  await check();
  // 定期チェック
  setInterval(check, checkInterval);
}

// CLI
const args = process.argv.slice(2);
const startIdx = args.indexOf('--start');
const startDate = startIdx >= 0 ? args[startIdx + 1] : '2026-03-28';
const dryRun = args.includes('--dry-run');

if (args.includes('--post-next')) {
  await postNext(startDate, dryRun);
} else if (startIdx >= 0 || args.includes('--daemon')) {
  await startDaemon(startDate, dryRun);
} else {
  showSchedule(startDate);
}
