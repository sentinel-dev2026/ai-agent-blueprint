/**
 * X 投稿スクリプト
 *
 * 使い方:
 *   npm run post -- "投稿テキスト"
 *   node post.js "投稿テキスト"
 *   node post.js --file posts.txt   (1行1投稿)
 *
 * 認証方式:
 *   - OAuth 1.0a: .envのX_API_KEY等が設定されていれば自動使用（トークン期限切れなし）
 *   - OAuth 2.0:  tokens.jsonがあれば使用（自動リフレッシュ付き）
 */

import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const TOKEN_FILE = process.env.X_TOKEN_FILE || './tokens.json';

/**
 * クライアント取得（OAuth 1.0a優先、なければOAuth 2.0）
 */
async function getClient() {
  // OAuth 1.0a: 4つのキーが全て揃っていれば使用（トークン期限切れの心配なし）
  if (process.env.X_API_KEY && process.env.X_API_KEY_SECRET &&
      process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_TOKEN_SECRET) {
    console.log('🔑 OAuth 1.0a で認証');
    return new TwitterApi({
      appKey: process.env.X_API_KEY,
      appSecret: process.env.X_API_KEY_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
    });
  }

  // OAuth 2.0: tokens.jsonから読み込み + 自動リフレッシュ
  if (!existsSync(TOKEN_FILE)) {
    console.error('❌ 認証情報がありません。.envにOAuth 1.0aキーを設定するか、npm run auth でOAuth 2.0認可を実行してください。');
    process.exit(1);
  }

  console.log('🔑 OAuth 2.0 で認証');
  const tokenData = JSON.parse(readFileSync(TOKEN_FILE, 'utf-8'));

  const obtainedAt = new Date(tokenData.obtainedAt).getTime();
  const elapsed = (Date.now() - obtainedAt) / 1000;

  let accessToken = tokenData.accessToken;

  if (elapsed > tokenData.expiresIn - 300) {
    console.log('🔄 Access Token期限切れ。リフレッシュ中...');

    const client = new TwitterApi({
      clientId: process.env.X_CLIENT_ID,
      clientSecret: process.env.X_CLIENT_SECRET,
    });

    try {
      const {
        accessToken: newAccess,
        refreshToken: newRefresh,
        expiresIn,
      } = await client.refreshOAuth2Token(tokenData.refreshToken);

      writeFileSync(TOKEN_FILE, JSON.stringify({
        accessToken: newAccess,
        refreshToken: newRefresh,
        expiresIn,
        obtainedAt: new Date().toISOString(),
      }, null, 2));
      accessToken = newAccess;
      console.log('✅ トークンリフレッシュ完了');
    } catch (err) {
      console.error('❌ トークンリフレッシュ失敗:', err.message);
      console.error('   npm run auth で再認可してください。');
      process.exit(1);
    }
  }

  return new TwitterApi(accessToken);
}

/**
 * ツイート投稿
 */
async function postTweet(text) {
  const client = await getClient();

  try {
    const result = await client.v2.tweet(text);
    console.log(`✅ 投稿成功 (ID: ${result.data.id})`);
    console.log(`   https://x.com/i/status/${result.data.id}`);
    return result.data;
  } catch (err) {
    console.error(`❌ 投稿失敗: ${err.message}`);
    if (err.data) console.error('   詳細:', JSON.stringify(err.data));
    throw err;
  }
}

/**
 * スレッド投稿（配列で渡す）
 */
export async function postThread(tweets) {
  const client = await getClient();
  let lastTweetId = null;

  for (let i = 0; i < tweets.length; i++) {
    const payload = { text: tweets[i] };
    if (lastTweetId) {
      payload.reply = { in_reply_to_tweet_id: lastTweetId };
    }

    try {
      const result = await client.v2.tweet(payload);
      lastTweetId = result.data.id;
      console.log(`✅ [${i + 1}/${tweets.length}] 投稿成功 (ID: ${lastTweetId})`);
    } catch (err) {
      console.error(`❌ [${i + 1}/${tweets.length}] 投稿失敗: ${err.message}`);
      throw err;
    }
  }

  console.log(`\n✅ スレッド完了 (${tweets.length}件)`);
  return lastTweetId;
}

export { postTweet, getClient };

// CLI実行（直接実行時のみ）
const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/post.js');
if (isMain) {
  const args = process.argv.slice(2);

  if (args[0] === '--file') {
    const file = args[1];
    if (!file || !existsSync(file)) {
      console.error('❌ ファイルが見つかりません:', file);
      process.exit(1);
    }
    const lines = readFileSync(file, 'utf-8').split('\n').filter(l => l.trim());
    console.log(`📄 ${lines.length}件の投稿を実行...`);
    for (const line of lines) {
      await postTweet(line);
    }
  } else if (args.length > 0) {
    await postTweet(args.join(' '));
  } else {
    console.log('使い方:');
    console.log('  node post.js "投稿テキスト"');
    console.log('  node post.js --file posts.txt');
  }
}
