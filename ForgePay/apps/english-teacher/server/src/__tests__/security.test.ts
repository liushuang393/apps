/**
 * セキュリティテスト
 * SQL インジェクション・XSS・不正リクエスト・CORS・過大ペイロードを検証する
 */
import request from 'supertest';
import { createApp } from '../app';
import { initializeSchema, resetDb } from '../db/client';
import { getUserStatus } from '../services/userService';

jest.mock('../services/openaiService', () => ({
  askEnglishTeacher: jest.fn().mockResolvedValue({
    answer: 'Safe test answer',
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 5, completion_tokens: 10 },
  }),
}));

// ForgePay 経由のチェックアウトをモック
jest.mock('../services/forgePayService', () => ({
  createPayment: jest.fn().mockResolvedValue({
    session_id: 'cs_sec_test_001',
    checkout_url: 'https://checkout.example.com/test/sec',
  }),
  checkPaymentStatus: jest.fn().mockResolvedValue({ active: false, purchase_intent_id: '' }),
}));

const app = createApp();

beforeEach(async () => {
  resetDb();
  await initializeSchema();
});

// ─── SQL インジェクション対策 ────────────────────────────────────────────────

describe('[SEC] SQL インジェクション対策', () => {
  it('user_id に SQL インジェクションを含んでもサーバーが落ちない', async () => {
    const sqlInjectionUserId = "'; DROP TABLE users; --";

    const res = await request(app)
      .post('/api/status')
      .send({ user_id: sqlInjectionUserId });

    expect(res.status).toBe(200);
    expect(res.body.paid).toBe(false);
  });

  it('question に SQL インジェクションを含んでも安全に処理される', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({
        user_id: 'sql_inject_user',
        question: "'; SELECT * FROM users; DROP TABLE users; --",
      });

    expect(res.status).not.toBe(500);
  });

  it('UNION ベースの SQL インジェクションも無効化される', async () => {
    const res = await request(app)
      .post('/api/status')
      .send({ user_id: "' UNION SELECT user_id, 1, 1, NULL, NULL, NULL, NULL FROM users --" });

    expect(res.status).toBe(200);
    expect(res.body.paid).toBe(false);
  });

  it('NULL バイトを含む user_id は安全に処理される', async () => {
    const res = await request(app)
      .post('/api/status')
      .send({ user_id: 'user\x00injected' });

    expect(res.status).not.toBe(500);
  });
});

// ─── XSS 対策 ────────────────────────────────────────────────────────────────

describe('[SEC] XSS ペイロード処理', () => {
  it('question に XSS スクリプトを含んでも JSON として安全に返される', async () => {
    const xssPayload = '<script>alert("XSS")</script>';

    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: 'xss_test_user', question: xssPayload });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBeDefined();
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('user_id に HTML タグを含んでも安全に処理される', async () => {
    const res = await request(app)
      .post('/api/status')
      .send({ user_id: '<img src=x onerror=alert(1)>' });

    expect(res.status).toBe(200);
    expect(res.body.paid).toBe(false);
  });

  it('question に大量の Unicode 特殊文字を含んでも安全に処理される', async () => {
    const unicodePayload = '🎉'.repeat(100) + '✨特殊文字テスト©®™';

    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: 'unicode_user', question: unicodePayload });

    expect(res.status).toBe(200);
  });
});

// ─── リクエストサイズ制限 ────────────────────────────────────────────────────

describe('[SEC] リクエストサイズ制限', () => {
  it('1MB を超えるリクエストボディは拒否される', async () => {
    const largeBody = { user_id: 'large_body_user', question: 'A'.repeat(1024 * 1024 + 1024) };

    const res = await request(app)
      .post('/api/ask')
      .send(largeBody);

    expect([400, 413]).toContain(res.status);
  });

  it('question 2000 文字制限を超えるリクエストは 400 を返す', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: 'size_limit_user', question: 'B'.repeat(2001) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

// ─── CORS セキュリティ ───────────────────────────────────────────────────────

describe('[SEC] CORS ポリシー', () => {
  it('許可オリジン (chatgpt.com) には CORS ヘッダーが付く', async () => {
    const res = await request(app)
      .post('/api/status')
      .set('Origin', 'https://chatgpt.com')
      .send({ user_id: 'cors_test_user' });

    expect(res.headers['access-control-allow-origin']).toBe('https://chatgpt.com');
  });

  it('許可オリジン (chat.openai.com) には CORS ヘッダーが付く', async () => {
    const res = await request(app)
      .post('/api/status')
      .set('Origin', 'https://chat.openai.com')
      .send({ user_id: 'cors_test_user2' });

    expect(res.headers['access-control-allow-origin']).toBe('https://chat.openai.com');
  });

  it('未許可オリジンには CORS ヘッダーが付かない', async () => {
    const res = await request(app)
      .post('/api/status')
      .set('Origin', 'https://evil-phishing-site.com')
      .send({ user_id: 'cors_test_user3' });

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('OPTIONS プリフライトは CORS ヘッダー付きで応答する', async () => {
    const res = await request(app)
      .options('/api/ask')
      .set('Origin', 'https://chatgpt.com')
      .set('Access-Control-Request-Method', 'POST');

    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBe('https://chatgpt.com');
  });
});

// ─── 異常系リクエスト ────────────────────────────────────────────────────────

describe('[SEC] 異常リクエスト処理', () => {
  it('空のリクエストボディは 400 を返す', async () => {
    const res = await request(app)
      .post('/api/ask')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(400);
  });

  it('JSON でない Content-Type は 400 を返す', async () => {
    const res = await request(app)
      .post('/api/ask')
      .set('Content-Type', 'text/plain')
      .send('user_id=test&question=test');

    expect([400, 422]).toContain(res.status);
  });

  it('不正な JSON ボディは 400 を返す', async () => {
    const res = await request(app)
      .post('/api/ask')
      .set('Content-Type', 'application/json')
      .send('{ invalid json }');

    expect([400, 422]).toContain(res.status);
  });

  it('数値型 user_id も文字列に変換して処理される', async () => {
    const res = await request(app)
      .post('/api/status')
      .send({ user_id: 12345 });

    expect(res.status).not.toBe(500);
  });

  it('非常に長い user_id は安全に処理される', async () => {
    const longUserId = 'u'.repeat(1000);

    const res = await request(app)
      .post('/api/status')
      .send({ user_id: longUserId });

    expect([200, 400]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  it('null user_id は 400 を返す', async () => {
    const res = await request(app)
      .post('/api/status')
      .send({ user_id: null });

    expect(res.status).toBe(400);
  });
});

// ─── ビジネスロジック不正操作防止 ─────────────────────────────────────────

describe('[SEC] ビジネスロジック不正操作防止', () => {
  it('無料制限をリセットしようとする操作は防止される', async () => {
    const userId = 'free_limit_attack_user';

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/ask')
        .send({ user_id: userId, question: `Question ${i + 1}` });
    }

    const blockedRes = await request(app)
      .post('/api/ask')
      .send({ user_id: userId, question: 'Attempt to bypass limit' });

    expect(blockedRes.body.needs_upgrade).toBe(true);
    expect(blockedRes.body.answer).toBeUndefined();
  });

  it('異なる user_id を使った制限回避は機能しない（各ユーザー独立）', async () => {
    const userId1 = 'bypass_attempt_user_1';
    const userId2 = 'bypass_attempt_user_2';

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/ask')
        .send({ user_id: userId1, question: `Q${i + 1}` });
    }

    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: userId2, question: 'Question from different user' });

    expect(res.body.needs_upgrade).toBe(false);
  });

  it('paid フラグはコールバック経由でのみ設定される（API から直接変更不可）', async () => {
    const userId = 'paid_flag_test_user';

    const statusBefore = await request(app)
      .post('/api/status')
      .send({ user_id: userId });

    expect(statusBefore.body.paid).toBe(false);

    const askRes = await request(app)
      .post('/api/ask')
      .send({ user_id: userId, question: 'test', paid: true });

    const statusAfter = await request(app)
      .post('/api/status')
      .send({ user_id: userId });

    expect(statusAfter.body.paid).toBe(false);
  });
});
