/**
 * API ビジネスロジック E2E テスト
 * /api/ask と /api/status の全シナリオを検証する
 *
 * OpenAI API はモックに置き換えて外部通信を行わない
 */
import request from 'supertest';
import { createApp } from '../app';
import { initializeSchema, resetDb } from '../db/client';
import { markUserAsPaid } from '../services/userService';

jest.mock('../services/openaiService', () => ({
  askEnglishTeacher: jest.fn().mockResolvedValue({
    answer: 'Great question! The answer is: "affect" is a verb and "effect" is a noun.',
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 10, completion_tokens: 50 },
  }),
}));

// ForgePay 経由のチェックアウトをモック
jest.mock('../services/forgePayService', () => ({
  createPayment: jest.fn().mockResolvedValue({
    session_id: 'cs_test_mock_session_001',
    checkout_url: 'https://checkout.example.com/pay/mock_session',
  }),
  checkPaymentStatus: jest.fn().mockResolvedValue({ active: false, purchase_intent_id: '' }),
}));

const app = createApp();

beforeEach(async () => {
  resetDb();
  await initializeSchema();
});

// ─── /api/status テスト ─────────────────────────────────────────────────────

describe('POST /api/status', () => {
  it('新規ユーザーは無料プラン・3回残りのステータスを返す', async () => {
    const res = await request(app)
      .post('/api/status')
      .send({ user_id: 'new_user_001' });

    expect(res.status).toBe(200);
    expect(res.body.paid).toBe(false);
    expect(res.body.plan).toBe('free');
    expect(res.body.free_questions_used).toBe(0);
    expect(res.body.free_limit).toBe(3);
    expect(res.body.remaining_free).toBe(3);
    expect(res.body.can_ask).toBe(true);
  });

  it('有料ユーザーは premium プランを返す', async () => {
    const userId = 'paid_user_status_test';
    await markUserAsPaid(userId, 'cs_test_for_status');

    const res = await request(app)
      .post('/api/status')
      .send({ user_id: userId });

    expect(res.status).toBe(200);
    expect(res.body.paid).toBe(true);
    expect(res.body.plan).toBe('premium');
    expect(res.body.can_ask).toBe(true);
  });

  it('user_id が空の場合は 400 を返す', async () => {
    const res = await request(app)
      .post('/api/status')
      .send({ user_id: '' });

    expect(res.status).toBe(400);
  });

  it('user_id がない場合は 400 を返す', async () => {
    const res = await request(app)
      .post('/api/status')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─── /api/ask - 無料ティアフロー ────────────────────────────────────────────

describe('POST /api/ask - 無料ティアフロー', () => {
  it('1回目の質問: 回答を返し残り2回を表示する', async () => {
    const userId = 'free_flow_user_q1';

    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: userId, question: 'What is the difference between affect and effect?' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBeTruthy();
    expect(res.body.needs_upgrade).toBe(false);
    expect(res.body.is_paid_user).toBe(false);
    expect(res.body.remaining_free).toBe(2);
  });

  it('3回目の質問後: remaining_free が 0 になる', async () => {
    const userId = 'free_flow_user_q3';

    for (let i = 0; i < 2; i++) {
      await request(app)
        .post('/api/ask')
        .send({ user_id: userId, question: `Question ${i + 1}` });
    }

    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: userId, question: 'Third question' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBeTruthy();
    expect(res.body.needs_upgrade).toBe(false);
    expect(res.body.remaining_free).toBe(0);
  });

  it('4回目の質問: アップグレード要求と決済 URL を返す', async () => {
    const userId = 'free_flow_user_q4';

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/ask')
        .send({ user_id: userId, question: `Question ${i + 1}` });
    }

    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: userId, question: 'Fourth question - should be blocked' });

    expect(res.status).toBe(200);
    expect(res.body.needs_upgrade).toBe(true);
    expect(res.body.checkout_url).toBe('https://checkout.example.com/pay/mock_session');
    expect(res.body.answer).toBeUndefined();
    expect(res.body.is_paid_user).toBe(false);
  });

  it('複数ユーザーのカウントは互いに独立している', async () => {
    const userA = 'isolation_test_user_a';
    const userB = 'isolation_test_user_b';

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/ask')
        .send({ user_id: userA, question: `UserA question ${i + 1}` });
    }

    const resB = await request(app)
      .post('/api/ask')
      .send({ user_id: userB, question: 'UserB first question' });

    expect(resB.body.needs_upgrade).toBe(false);
    expect(resB.body.remaining_free).toBe(2);
  });
});

// ─── /api/ask - 有料ユーザーフロー ──────────────────────────────────────────

describe('POST /api/ask - 有料ユーザーフロー', () => {
  it('有料ユーザーは無制限に回答を得られる', async () => {
    const userId = 'paid_user_ask_test';
    await markUserAsPaid(userId, 'cs_test_paid_ask');

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/ask')
        .send({ user_id: userId, question: `Premium question ${i + 1}` });

      expect(res.status).toBe(200);
      expect(res.body.needs_upgrade).toBe(false);
      expect(res.body.is_paid_user).toBe(true);
      expect(res.body.answer).toBeTruthy();
    }
  });

  it('有料ユーザーの回答には remaining_free が含まれない', async () => {
    const userId = 'paid_user_no_remaining';
    await markUserAsPaid(userId, 'cs_test_no_remaining');

    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: userId, question: 'Premium question' });

    expect(res.body.remaining_free).toBeUndefined();
    expect(res.body.is_paid_user).toBe(true);
  });
});

// ─── /api/ask - バリデーション ───────────────────────────────────────────────

describe('POST /api/ask - 入力バリデーション', () => {
  it('user_id がない場合は 400 を返す', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ question: 'test question' });

    expect(res.status).toBe(400);
  });

  it('question がない場合は 400 を返す', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: 'test_user' });

    expect(res.status).toBe(400);
  });

  it('空文字 question は 400 を返す', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: 'test_user', question: '' });

    expect(res.status).toBe(400);
  });

  it('question が 2001 文字以上は 400 を返す', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: 'test_user', question: 'A'.repeat(2001) });

    expect(res.status).toBe(400);
  });

  it('question が 2000 文字は有効（境界値）', async () => {
    const res = await request(app)
      .post('/api/ask')
      .send({ user_id: 'boundary_test_user', question: 'A'.repeat(2000) });

    expect(res.status).toBe(200);
  });
});

// ─── /api/checkout テスト ──────────────────────────────────────────────────

describe('POST /api/checkout', () => {
  it('未払いユーザーにチェックアウト URL を返す', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send({ user_id: 'checkout_test_user' });

    expect(res.status).toBe(200);
    expect(res.body.already_paid).toBe(false);
    expect(res.body.checkout_url).toContain('checkout.example.com');
    expect(res.body.session_id).toBe('cs_test_mock_session_001');
  });

  it('有料ユーザーには already_paid を返す', async () => {
    const userId = 'already_paid_checkout_user';
    await markUserAsPaid(userId, 'cs_already_paid');

    const res = await request(app)
      .post('/api/checkout')
      .send({ user_id: userId });

    expect(res.status).toBe(200);
    expect(res.body.already_paid).toBe(true);
    expect(res.body.checkout_url).toBeUndefined();
  });
});
