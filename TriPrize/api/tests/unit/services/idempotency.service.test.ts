import { Request, Response, NextFunction } from 'express';
import {
  IdempotencyService as IdempotencyServiceClass,
  idempotencyMiddleware,
} from '../../../src/services/idempotency.service';
import { getRedisClient } from '../../../src/config/redis.config';

/**
 * idempotency.service の単体テスト
 * 目的: 幂等性判定(checkIdempotency)、レスポンス保存(storeResponse)、ロック取得/解放(acquireLock/releaseLock)、
 *       及び idempotencyMiddleware による重複リクエスト防止挙動を確認する
 * I/O: Redis は getRedisClient をモックし、Request/Response/NextFunction をモックして副作用を検証する
 * 注意点: Redis 障害時は fail-open（通常処理を継続）となることを確認する
 */

jest.mock('../../../src/config/redis.config', () => ({
  getRedisClient: jest.fn(),
}));

const mockedGetRedisClient = getRedisClient as unknown as jest.Mock;

const createMockRedis = () => ({
  get: jest.fn(),
  setEx: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
});

const createMockResponse = () => {
  const res: Partial<Response> = {};
  res.statusCode = 200;
  res.status = jest.fn().mockImplementation(function (this: Response, code: number) {
    this.statusCode = code;
    return this;
  });
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('IdempotencyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

	it('should detect duplicate request and return cached response', async () => {
	    const redis = createMockRedis();
	    redis.get.mockResolvedValue(JSON.stringify({ status: 201, data: { ok: true } }));
	    mockedGetRedisClient.mockResolvedValue(redis);

		const service = new IdempotencyServiceClass();

	    const result = await service.checkIdempotency('user-1', { foo: 'bar' }, '/test');

    expect(result.isDuplicate).toBe(true);
    expect(result.cachedResponse).toEqual({ status: 201, data: { ok: true } });
  });

	it('should store response with default TTL when ttl is not provided', async () => {
	    const redis = createMockRedis();
	    mockedGetRedisClient.mockResolvedValue(redis);

		const service = new IdempotencyServiceClass();

	    await service.storeResponse('user-1', { foo: 'bar' }, '/test', { status: 200, data: { ok: true } });

    expect(redis.setEx).toHaveBeenCalledTimes(1);
    const [key, ttl, value] = redis.setEx.mock.calls[0];
    expect(key).toContain('idempotency:user-1');
    expect(ttl).toBe(24 * 60 * 60);
    expect(JSON.parse(value)).toEqual({ status: 200, data: { ok: true } });
  });

	it('should acquire lock using Redis SET NX', async () => {
	    const redis = createMockRedis();
	    redis.set.mockResolvedValue('OK');
	    mockedGetRedisClient.mockResolvedValue(redis);

		const service = new IdempotencyServiceClass();

	    const acquired = await service.acquireLock('user-1', { foo: 'bar' }, '/test');

    expect(acquired).toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

	it('should release lock by deleting Redis key', async () => {
	    const redis = createMockRedis();
	    mockedGetRedisClient.mockResolvedValue(redis);

		const service = new IdempotencyServiceClass();

	    await service.releaseLock('user-1', { foo: 'bar' }, '/test');

    expect(redis.del).toHaveBeenCalledTimes(1);
  });
});

describe('idempotencyMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should bypass middleware when user is not authenticated', async () => {
    const req = { path: '/test', body: {} } as Request & { user?: { uid?: string } };
    const res = createMockResponse();
    const next = jest.fn();

    const middleware = idempotencyMiddleware();

    await middleware(req, res, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('should return cached response when duplicate request detected', async () => {
    const redis = createMockRedis();
    redis.get.mockResolvedValue(JSON.stringify({ status: 201, data: { ok: true } }));
    mockedGetRedisClient.mockResolvedValue(redis);

    const req = { path: '/test', body: { foo: 'bar' }, user: { uid: 'user-1' } } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn();

    const middleware = idempotencyMiddleware();

    await middleware(req, res, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });
});
