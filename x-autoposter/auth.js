/**
 * OAuth 2.0 PKCE 認可フロー（初回のみ実行）
 *
 * 使い方: npm run auth
 * → ブラウザで認可URL開く → @sentinel_dev93 でログイン → 許可
 * → tokens.json に保存される
 */

import 'dotenv/config';
import express from 'express';
import { TwitterApi } from 'twitter-api-v2';
import { writeFileSync } from 'fs';

const CLIENT_ID = process.env.X_CLIENT_ID;
const CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const CALLBACK_URL = process.env.X_CALLBACK_URL || 'http://localhost:3000/callback';
const TOKEN_FILE = process.env.X_TOKEN_FILE || './tokens.json';

const app = express();
const port = 3000;

// OAuth 2.0 PKCE用の一時データ
let codeVerifier = '';
let state = '';

const client = new TwitterApi({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});

// Step 1: 認可URLを生成
app.get('/', (req, res) => {
  const { url, codeVerifier: cv, state: st } = client.generateOAuth2AuthLink(
    CALLBACK_URL,
    {
      scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    }
  );

  codeVerifier = cv;
  state = st;

  res.send(`
    <h1>X API OAuth 認可</h1>
    <p><a href="${url}" target="_blank">こちらをクリックして @sentinel_dev93 で認可してください</a></p>
    <p>認可後、自動的にトークンが保存されます。</p>
  `);
});

// Step 2: コールバック受信 → トークン取得 → 保存
app.get('/callback', async (req, res) => {
  const { code, state: returnedState } = req.query;

  if (!code || returnedState !== state) {
    return res.status(400).send('認可エラー: state不一致またはcodeなし');
  }

  try {
    const {
      accessToken,
      refreshToken,
      expiresIn,
    } = await client.loginWithOAuth2({
      code,
      codeVerifier,
      redirectUri: CALLBACK_URL,
    });

    const tokenData = {
      accessToken,
      refreshToken,
      expiresIn,
      obtainedAt: new Date().toISOString(),
    };

    writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));

    console.log('\n✅ トークン取得成功！');
    console.log(`   保存先: ${TOKEN_FILE}`);
    console.log(`   Access Token有効期限: ${expiresIn}秒`);
    console.log(`   Refresh Token: ${refreshToken ? 'あり' : 'なし'}`);

    res.send(`
      <h1>✅ 認可完了！</h1>
      <p>トークンが ${TOKEN_FILE} に保存されました。</p>
      <p>このページを閉じて、ターミナルで Ctrl+C でサーバーを停止してください。</p>
    `);
  } catch (err) {
    console.error('トークン取得エラー:', err);
    res.status(500).send(`エラー: ${err.message}`);
  }
});

app.listen(port, () => {
  console.log(`\n🔐 OAuth認可サーバー起動`);
  console.log(`   http://localhost:${port}/ をブラウザで開いてください`);
  console.log(`   認可完了後、Ctrl+C で停止\n`);
});
