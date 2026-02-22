/**
 * ヘルスチェックテスト
 * サーバーの基本的な応答性を確認する
 */
import request from 'supertest';
import { createApp } from '../app';
import { initializeSchema, resetDb } from '../db/client';

const app = createApp();

beforeEach(async () => {
  resetDb();
  await initializeSchema();
});

describe('GET /health', () => {
  it('200 OK とサービス名を返す', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('english-teacher-mcp-server');
    expect(res.body.timestamp).toBeDefined();
    // ISO 8601 形式であることを確認
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it('Content-Type は application/json である', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('存在しないルートは 404 を返す', async () => {
    const res = await request(app).get('/nonexistent-route-xyz');
    expect(res.status).toBe(404);
  });

  it('CORS ヘッダーが許可オリジンに対して設定される', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://chat.openai.com');

    expect(res.headers['access-control-allow-origin']).toBe('https://chat.openai.com');
  });

  it('CORS ヘッダーが未許可オリジンには設定されない', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://malicious-site.example.com');

    // 未許可のオリジンには access-control-allow-origin が付かない
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
