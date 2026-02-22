/**
 * ForgePay コールバック E2E テスト
 * POST /callback/forgepay の各イベントタイプを検証する
 */
import request from 'supertest';
import { createApp } from '../app';
import { initializeSchema, resetDb } from '../db/client';
import { getUserStatus } from '../services/userService';

// OpenAI / ForgePay は使わないがモック必須（app 起動時にインポートされるため）
jest.mock('../services/openaiService', () => ({
  askEnglishTeacher: jest.fn(),
}));

jest.mock('../services/forgePayService', () => ({
  createPayment: jest.fn(),
  checkPaymentStatus: jest.fn(),
}));

const app = createApp();

beforeEach(async () => {
  resetDb();
  await initializeSchema();
});

// ─── 正常系: payment.completed ──────────────────────────────────────────────

describe('POST /callback/forgepay - payment.completed', () => {
  it('有効なコールバックでユーザーを有料にマークする', async () => {
    const userId = 'callback_happy_path_user';

    const res = await request(app)
      .post('/callback/forgepay')
      .send({
        event_id: 'evt_test_001',
        event_type: 'payment.completed',
        timestamp: new Date().toISOString(),
        metadata: {
          purchase_intent_id: userId,
          session_id: 'cs_test_callback_001',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const status = await getUserStatus(userId);
    expect(status.paid).toBe(true);
    expect(status.can_ask).toBe(true);
  });

  it('session_id なしでも paid にマークされる', async () => {
    const userId = 'callback_no_session_user';

    const res = await request(app)
      .post('/callback/forgepay')
      .send({
        event_id: 'evt_test_002',
        event_type: 'payment.completed',
        timestamp: new Date().toISOString(),
        metadata: {
          purchase_intent_id: userId,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const status = await getUserStatus(userId);
    expect(status.paid).toBe(true);
  });

  it('purchase_intent_id がない場合は 400 を返す', async () => {
    const res = await request(app)
      .post('/callback/forgepay')
      .send({
        event_id: 'evt_test_003',
        event_type: 'payment.completed',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('同じコールバックを2回受け取っても安全（冪等性）', async () => {
    const userId = 'callback_idempotent_user';
    const payload = {
      event_id: 'evt_test_idempotent',
      event_type: 'payment.completed',
      timestamp: new Date().toISOString(),
      metadata: {
        purchase_intent_id: userId,
        session_id: 'cs_test_idem',
      },
    };

    await request(app).post('/callback/forgepay').send(payload);
    await request(app).post('/callback/forgepay').send(payload);

    const status = await getUserStatus(userId);
    expect(status.paid).toBe(true);
  });
});

// ─── その他のイベントタイプ ─────────────────────────────────────────────────

describe('POST /callback/forgepay - その他', () => {
  it('refund.completed は 200 で受け付ける（ユーザー状態は変更しない）', async () => {
    const userId = 'callback_refund_user';

    const res = await request(app)
      .post('/callback/forgepay')
      .send({
        event_id: 'evt_test_refund',
        event_type: 'refund.completed',
        timestamp: new Date().toISOString(),
        metadata: { purchase_intent_id: userId },
      });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('未知のイベントタイプも 200 で受け付ける', async () => {
    const res = await request(app)
      .post('/callback/forgepay')
      .send({
        event_id: 'evt_test_unknown',
        event_type: 'subscription.renewed',
        timestamp: new Date().toISOString(),
        metadata: {},
      });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('空ボディでもサーバーがクラッシュしない', async () => {
    const res = await request(app)
      .post('/callback/forgepay')
      .send({});

    // event_type が undefined でも default に流れて 200 を返す
    expect(res.status).toBe(200);
  });
});
