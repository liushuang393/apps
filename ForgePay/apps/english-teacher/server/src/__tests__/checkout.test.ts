/**
 * Checkout エンドポイント E2E テスト
 * /checkout/session, /checkout/success, /checkout/cancel を検証する
 */
import request from 'supertest';
import { createApp } from '../app';
import { initializeSchema, resetDb } from '../db/client';
import { markUserAsPaid } from '../services/userService';

// ForgePay 経由のチェックアウトをモック
jest.mock('../services/forgePayService', () => ({
  createPayment: jest.fn().mockResolvedValue({
    session_id: 'cs_test_checkout_endpoint_001',
    checkout_url: 'https://checkout.example.com/pay/checkout_endpoint',
  }),
  checkPaymentStatus: jest.fn().mockResolvedValue({ active: false, purchase_intent_id: '' }),
}));

const app = createApp();

beforeEach(async () => {
  resetDb();
  await initializeSchema();
});

// ─── POST /checkout/session ─────────────────────────────────────────────────

describe('POST /checkout/session', () => {
  it('未払いユーザーにチェックアウト URL を返す', async () => {
    const res = await request(app)
      .post('/checkout/session')
      .send({ user_id: 'checkout_session_user_001' });

    expect(res.status).toBe(200);
    expect(res.body.already_paid).toBe(false);
    expect(res.body.session_id).toBe('cs_test_checkout_endpoint_001');
    expect(res.body.checkout_url).toContain('checkout.example.com');
  });

  it('有料済みユーザーには already_paid: true を返す（URL なし）', async () => {
    const userId = 'paid_checkout_test';
    await markUserAsPaid(userId, 'cs_already_paid_test');

    const res = await request(app)
      .post('/checkout/session')
      .send({ user_id: userId });

    expect(res.status).toBe(200);
    expect(res.body.already_paid).toBe(true);
    expect(res.body.checkout_url).toBeUndefined();
    expect(res.body.session_id).toBeUndefined();
  });

  it('user_id が空の場合は 400 バリデーションエラー', async () => {
    const res = await request(app)
      .post('/checkout/session')
      .send({ user_id: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('user_id がない場合は 400 バリデーションエラー', async () => {
    const res = await request(app)
      .post('/checkout/session')
      .send({});

    expect(res.status).toBe(400);
  });

  it('ForgePay に user_id のみで決済を依頼する', async () => {
    const { createPayment } = jest.requireMock('../services/forgePayService');

    const res = await request(app)
      .post('/checkout/session')
      .send({ user_id: 'simple_checkout_user' });

    expect(res.status).toBe(200);
    // ForgePay に purchase_intent_id (user_id) だけで呼び出されること
    expect(createPayment).toHaveBeenCalledWith('simple_checkout_user');
  });
});

// ─── GET /checkout/success ──────────────────────────────────────────────────

describe('GET /checkout/success', () => {
  it('支払い成功後のリダイレクト先: 成功メッセージを返す', async () => {
    const res = await request(app)
      .get('/checkout/success')
      .query({ session_id: 'cs_test_success_001', user_id: 'success_user' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('支払いが完了');
    expect(res.body.session_id).toBe('cs_test_success_001');
    expect(res.body.user_id).toBe('success_user');
  });

  it('パラメーターなしでもアクセス可能（コールバック側で処理済みのため）', async () => {
    const res = await request(app).get('/checkout/success');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /checkout/cancel ───────────────────────────────────────────────────

describe('GET /checkout/cancel', () => {
  it('キャンセル後のリダイレクト先: キャンセルメッセージを返す', async () => {
    const res = await request(app).get('/checkout/cancel');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('キャンセル');
  });
});
