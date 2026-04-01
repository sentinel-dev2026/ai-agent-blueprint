#!/usr/bin/env node
/**
 * heartbeat-runner.js — 30分間隔でheartbeat.shを実行するラッパー
 * pm2で常駐させる。cron-restartがWindows環境で不安定なため、
 * setIntervalで確実にスケジュールする。
 */

const { execSync } = require('child_process');
const path = require('path');

const INTERVAL_MS = 30 * 60 * 1000; // 30分
const SCRIPT = path.join(__dirname, 'heartbeat.sh');
const BASH = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';

function runHeartbeat() {
  const now = new Date().toISOString().substring(0, 19);
  console.log(`[${now}] heartbeat実行開始`);
  try {
    execSync(`"${BASH}" "${SCRIPT}"`, {
      cwd: path.join(__dirname, '..'),
      timeout: 5 * 60 * 1000, // 5分タイムアウト
      stdio: 'inherit',
      env: {
        ...process.env,
        PATH: '/c/Users/jtafu/.local/bin:/usr/bin:/bin:/mingw64/bin:' + (process.env.PATH || '')
      }
    });
    console.log(`[${now}] heartbeat完了`);
  } catch (err) {
    console.error(`[${now}] heartbeat失敗: ${err.message}`);
  }
}

// 起動時に1回実行
runHeartbeat();

// 以降30分間隔
setInterval(runHeartbeat, INTERVAL_MS);

console.log(`heartbeat-runner起動。${INTERVAL_MS / 60000}分間隔で実行。`);
