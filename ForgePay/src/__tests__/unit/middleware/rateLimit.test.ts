import { Request, Response } from 'express';

// Extended mock request interface to allow reassignment
interface MockRequest {
  headers: Record<string, string | undefined>;
  ip?: string;
  path?: string;
}

// Mock dependencies before imports
const mockMemoryStore = jest.fn().mockImplementation(() => ({
  init: jest.fn(),
  increment: jest.fn(),
  decrement: jest.fn(),
  resetKey: jest.fn(),
}));

const mockRateLimit = jest.fn().mockImplementation((options) => {
  // Store the options so we can test them
  const middleware = jest.fn((_req, _res, next) => next()) as jest.Mock & { options?: any };
  middleware.options = options;
  return middleware;
});

jest.mock('express-rate-limit', () => {
  const actual = {
    __esModule: true,
    default: mockRateLimit,
    MemoryStore: mockMemoryStore,
  };
  return actual;
});

const mockRedisStore = jest.fn().mockImplementation((config) => ({
  init: jest.fn(),
  increment: jest.fn(),
  decrement: jest.fn(),
  resetKey: jest.fn(),
  config,
}));

jest.mock('rate-limit-redis', () => {
  return {
    __esModule: true,
    default: mockRedisStore,
  };
});

jest.mock('../../../config/redis', () => ({
  redisClient: {
    isReady: false,
    sendCommand: jest.fn(),
  },
}));

jest.mock('../../../config', () => ({
  config: {
    rateLimit: {
      windowMs: 60000,
      maxRequests: 100,
    },
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { config } from '../../../config';

const mockConfig = config as jest.Mocked<typeof config>;

describe('Rate Limit Middleware', () => {
  let mockRequest: MockRequest;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      headers: {},
      ip: '127.0.0.1',
      path: '/api/test',
    };

    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };

    jest.clearAllMocks();
  });

  describe('createStore', () => {
    beforeEach(() => {
      // Reset module to test createStore with different Redis states
      jest.resetModules();
    });

    describe('when Redis is ready', () => {
      it('should create RedisStore with correct prefix', () => {
        jest.doMock('../../../config/redis', () => ({
          redisClient: {
            isReady: true,
            sendCommand: jest.fn().mockResolvedValue('OK'),
          },
        }));

        // Re-import to get fresh module with new mock
        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'test',
          });
        });

        expect(mockRedisStore).toHaveBeenCalled();
      });

      it('should configure RedisStore with prefix parameter', () => {
        jest.doMock('../../../config/redis', () => ({
          redisClient: {
            isReady: true,
            sendCommand: jest.fn().mockResolvedValue('OK'),
          },
        }));

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'logging-test',
          });
        });

        // Verify RedisStore was called with the correct prefix
        expect(mockRedisStore).toHaveBeenCalledWith(
          expect.objectContaining({
            prefix: 'rl:logging-test:',
          })
        );
      });

      it('should pass sendCommand function to RedisStore', () => {
        const mockSendCommand = jest.fn().mockResolvedValue('OK');
        jest.doMock('../../../config/redis', () => ({
          redisClient: {
            isReady: true,
            sendCommand: mockSendCommand,
          },
        }));

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'custom',
          });
        });

        expect(mockRedisStore).toHaveBeenCalledWith(
          expect.objectContaining({
            prefix: 'rl:custom:',
          })
        );
      });
    });

    describe('when Redis is not ready', () => {
      it('should create MemoryStore as fallback', () => {
        jest.doMock('../../../config/redis', () => ({
          redisClient: {
            isReady: false,
            sendCommand: jest.fn(),
          },
        }));

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'test',
          });
        });

        expect(mockMemoryStore).toHaveBeenCalled();
      });

      it('should use MemoryStore when Redis is not ready', () => {
        jest.doMock('../../../config/redis', () => ({
          redisClient: {
            isReady: false,
            sendCommand: jest.fn(),
          },
        }));

        // Clear previous calls
        mockMemoryStore.mockClear();

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'fallback-test',
          });
        });

        // Verify MemoryStore was instantiated
        expect(mockMemoryStore).toHaveBeenCalled();
      });
    });
  });

  describe('apiRateLimiter', () => {
    beforeEach(() => {
      jest.isolateModules(() => {
        // Import module to trigger rate limiter creation
        require('../../../middleware/rateLimit');
      });
    });

    describe('configuration', () => {
      it('should use config.rateLimit.windowMs for window', () => {
        expect(mockRateLimit).toHaveBeenCalledWith(
          expect.objectContaining({
            windowMs: mockConfig.rateLimit.windowMs,
          })
        );
      });

      it('should use config.rateLimit.maxRequests for max', () => {
        expect(mockRateLimit).toHaveBeenCalledWith(
          expect.objectContaining({
            max: mockConfig.rateLimit.maxRequests,
          })
        );
      });

      it('should enable standard headers', () => {
        expect(mockRateLimit).toHaveBeenCalledWith(
          expect.objectContaining({
            standardHeaders: true,
          })
        );
      });

      it('should disable legacy headers', () => {
        expect(mockRateLimit).toHaveBeenCalledWith(
          expect.objectContaining({
            legacyHeaders: false,
          })
        );
      });
    });

    describe('keyGenerator', () => {
      it('should use API key when provided', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const keyGenerator = rateLimitCall[0].keyGenerator;

        // API key longer than 20 chars, should be truncated
        mockRequest.headers = { 'x-api-key': 'fpb_test_abc123xyz789def456' };
        const key = keyGenerator(mockRequest as Request);

        // substring(0, 20) gives first 20 characters: 'fpb_test_abc123xyz78'
        expect(key).toBe('key:fpb_test_abc123xyz78');
      });

      it('should truncate API key to 20 characters', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const keyGenerator = rateLimitCall[0].keyGenerator;

        const longApiKey = 'fpb_test_verylongapikeythatexceeds20characters';
        mockRequest.headers = { 'x-api-key': longApiKey };
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe(`key:${longApiKey.substring(0, 20)}`);
        expect(key.length).toBe(24); // 'key:' + 20 chars
      });

      it('should use IP when API key is not provided', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const keyGenerator = rateLimitCall[0].keyGenerator;

        mockRequest.headers = {};
        mockRequest.ip = '192.168.1.100';
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('ip:192.168.1.100');
      });

      it('should handle IPv6 addresses', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const keyGenerator = rateLimitCall[0].keyGenerator;

        mockRequest.headers = {};
        mockRequest.ip = '::1';
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('ip:::1');
      });

      it('should prefer API key over IP', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const keyGenerator = rateLimitCall[0].keyGenerator;

        mockRequest.headers = { 'x-api-key': 'fpb_test_mykey123' };
        mockRequest.ip = '192.168.1.100';
        const key = keyGenerator(mockRequest as Request);

        expect(key).toContain('key:');
        expect(key).not.toContain('ip:');
      });
    });

    describe('handler', () => {
      it('should return 429 status code', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const handler = rateLimitCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(statusMock).toHaveBeenCalledWith(429);
      });

      it('should return rate_limit_exceeded error', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const handler = rateLimitCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'rate_limit_exceeded',
            message: 'Too many requests. Please try again later.',
            type: 'rate_limit_error',
            retryAfter: Math.ceil(mockConfig.rateLimit.windowMs / 1000),
          },
        });
      });

      it('should include retryAfter calculated from windowMs', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const handler = rateLimitCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              retryAfter: Math.ceil(mockConfig.rateLimit.windowMs / 1000),
            }),
          })
        );
      });

      it('should return correct error structure', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const handler = rateLimitCall[0].handler;

        mockRequest.headers = {};
        mockRequest.ip = '127.0.0.1';
        mockRequest.path = '/api/test';

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'rate_limit_exceeded',
            message: 'Too many requests. Please try again later.',
            type: 'rate_limit_error',
            retryAfter: Math.ceil(mockConfig.rateLimit.windowMs / 1000),
          },
        });
      });
    });

    describe('skip', () => {
      it('should skip rate limiting for /health endpoint', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const skip = rateLimitCall[0].skip;

        mockRequest.path = '/health';
        const shouldSkip = skip(mockRequest as Request);

        expect(shouldSkip).toBe(true);
      });

      it('should not skip rate limiting for other endpoints', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const skip = rateLimitCall[0].skip;

        const paths = ['/api/products', '/api/customers', '/admin/users', '/webhooks'];
        
        for (const path of paths) {
          mockRequest.path = path;
          const shouldSkip = skip(mockRequest as Request);
          expect(shouldSkip).toBe(false);
        }
      });

      it('should not skip for paths containing health', () => {
        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const skip = rateLimitCall[0].skip;

        mockRequest.path = '/api/health-check';
        const shouldSkip = skip(mockRequest as Request);

        expect(shouldSkip).toBe(false);
      });
    });
  });

  describe('webhookRateLimiter', () => {
    beforeEach(() => {
      jest.isolateModules(() => {
        require('../../../middleware/rateLimit');
      });
    });

    describe('configuration', () => {
      it('should use 60000ms (1 minute) window', () => {
        const webhookCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 1000
        );
        expect(webhookCall[0].windowMs).toBe(60000);
      });

      it('should allow 1000 requests per window', () => {
        const webhookCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 1000
        );
        expect(webhookCall[0].max).toBe(1000);
      });

      it('should enable standard headers', () => {
        const webhookCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 1000
        );
        expect(webhookCall[0].standardHeaders).toBe(true);
      });

      it('should disable legacy headers', () => {
        const webhookCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 1000
        );
        expect(webhookCall[0].legacyHeaders).toBe(false);
      });
    });

    describe('keyGenerator', () => {
      it('should use IP address for key', () => {
        const webhookCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 1000
        );
        const keyGenerator = webhookCall[0].keyGenerator;

        mockRequest.ip = '10.0.0.1';
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('ip:10.0.0.1');
      });

      it('should ignore API key header', () => {
        const webhookCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 1000
        );
        const keyGenerator = webhookCall[0].keyGenerator;

        mockRequest.headers = { 'x-api-key': 'some-key' };
        mockRequest.ip = '10.0.0.1';
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('ip:10.0.0.1');
        expect(key).not.toContain('key:');
      });
    });

    describe('handler', () => {
      it('should return 429 status code', () => {
        const webhookCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 1000
        );
        const handler = webhookCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(statusMock).toHaveBeenCalledWith(429);
      });

      it('should return webhook-specific error message', () => {
        const webhookCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 1000
        );
        const handler = webhookCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'rate_limit_exceeded',
            message: 'Too many webhook requests.',
            type: 'rate_limit_error',
            retryAfter: 60,
          },
        });
      });

      it('should include fixed 60 second retryAfter', () => {
        const webhookCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 1000
        );
        const handler = webhookCall[0].handler;

        mockRequest.ip = '192.168.1.50';
        mockRequest.path = '/webhooks/stripe';

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              retryAfter: 60,
            }),
          })
        );
      });
    });
  });

  describe('adminRateLimiter', () => {
    beforeEach(() => {
      jest.isolateModules(() => {
        require('../../../middleware/rateLimit');
      });
    });

    describe('configuration', () => {
      it('should use 60000ms (1 minute) window', () => {
        const adminCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 30
        );
        expect(adminCall[0].windowMs).toBe(60000);
      });

      it('should allow only 30 requests per window', () => {
        const adminCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 30
        );
        expect(adminCall[0].max).toBe(30);
      });

      it('should enable standard headers', () => {
        const adminCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 30
        );
        expect(adminCall[0].standardHeaders).toBe(true);
      });

      it('should disable legacy headers', () => {
        const adminCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 30
        );
        expect(adminCall[0].legacyHeaders).toBe(false);
      });
    });

    describe('keyGenerator', () => {
      it('should use API key when provided', () => {
        const adminCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 30
        );
        const keyGenerator = adminCall[0].keyGenerator;

        // API key is 30 chars, substring(0, 20) gives first 20
        mockRequest.headers = { 'x-api-key': 'admin_key_12345678901234567890' };
        const key = keyGenerator(mockRequest as Request);

        // 'admin_key_1234567890' is exactly 20 characters
        expect(key).toBe('key:admin_key_1234567890');
      });

      it('should use IP when API key is not provided', () => {
        const adminCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 30
        );
        const keyGenerator = adminCall[0].keyGenerator;

        mockRequest.headers = {};
        mockRequest.ip = '10.0.0.50';
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('ip:10.0.0.50');
      });
    });

    describe('handler', () => {
      it('should return 429 status code', () => {
        const adminCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 30
        );
        const handler = adminCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(statusMock).toHaveBeenCalledWith(429);
      });

      it('should return admin-specific error message', () => {
        const adminCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 30
        );
        const handler = adminCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'rate_limit_exceeded',
            message: 'Too many admin requests. Please try again later.',
            type: 'rate_limit_error',
            retryAfter: 60,
          },
        });
      });

      it('should include fixed 60 second retryAfter', () => {
        const adminCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 30
        );
        const handler = adminCall[0].handler;

        mockRequest.ip = '192.168.1.100';
        mockRequest.path = '/admin/developers';

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              retryAfter: 60,
            }),
          })
        );
      });
    });
  });

  describe('createRateLimiter', () => {
    describe('basic configuration', () => {
      it('should create rate limiter with custom windowMs', () => {
        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 30000,
            max: 50,
            prefix: 'custom',
          });
        });

        const customCall = mockRateLimit.mock.calls.find(
          (call) => call[0].windowMs === 30000
        );
        expect(customCall).toBeDefined();
      });

      it('should create rate limiter with custom max requests', () => {
        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 200,
            prefix: 'high-limit',
          });
        });

        const customCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === 200
        );
        expect(customCall).toBeDefined();
      });

      it('should enable standard headers', () => {
        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'test',
          });
        });

        const latestCall = mockRateLimit.mock.calls[mockRateLimit.mock.calls.length - 1];
        expect(latestCall[0].standardHeaders).toBe(true);
      });

      it('should disable legacy headers', () => {
        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'test',
          });
        });

        const latestCall = mockRateLimit.mock.calls[mockRateLimit.mock.calls.length - 1];
        expect(latestCall[0].legacyHeaders).toBe(false);
      });
    });

    describe('store creation with prefix', () => {
      it('should create store with prefixed key when Redis is ready', () => {
        jest.doMock('../../../config/redis', () => ({
          redisClient: {
            isReady: true,
            sendCommand: jest.fn().mockResolvedValue('OK'),
          },
        }));

        mockRedisStore.mockClear();

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'checkout',
          });
        });

        // Verify RedisStore was called with correct prefix format
        expect(mockRedisStore).toHaveBeenCalledWith(
          expect.objectContaining({
            prefix: 'rl:checkout:',
          })
        );
      });
    });

    describe('keyGenerator', () => {
      it('should use API key when provided', () => {
        let keyGenerator: any;

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'test',
          });
        });

        const latestCall = mockRateLimit.mock.calls[mockRateLimit.mock.calls.length - 1];
        keyGenerator = latestCall[0].keyGenerator;

        mockRequest.headers = { 'x-api-key': 'fpb_custom_key_12345' };
        const key = keyGenerator(mockRequest as Request);

        expect(key).toContain('key:');
      });

      it('should use IP when API key is not provided', () => {
        let keyGenerator: any;

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'test',
          });
        });

        const latestCall = mockRateLimit.mock.calls[mockRateLimit.mock.calls.length - 1];
        keyGenerator = latestCall[0].keyGenerator;

        mockRequest.headers = {};
        mockRequest.ip = '172.16.0.1';
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('ip:172.16.0.1');
      });

      it('should truncate long API keys', () => {
        let keyGenerator: any;

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'test',
          });
        });

        const latestCall = mockRateLimit.mock.calls[mockRateLimit.mock.calls.length - 1];
        keyGenerator = latestCall[0].keyGenerator;

        // 'this_is_a_very_long_api_key_that_exceeds_limit' - substring(0,20) = 'this_is_a_very_long_'
        mockRequest.headers = { 'x-api-key': 'this_is_a_very_long_api_key_that_exceeds_limit' };
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('key:this_is_a_very_long_');
      });
    });

    describe('handler', () => {
      it('should return 429 status code', () => {
        let handler: any;

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'test',
          });
        });

        const latestCall = mockRateLimit.mock.calls[mockRateLimit.mock.calls.length - 1];
        handler = latestCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(statusMock).toHaveBeenCalledWith(429);
      });

      it('should use default error message when not provided', () => {
        let handler: any;

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'test',
          });
        });

        const latestCall = mockRateLimit.mock.calls[mockRateLimit.mock.calls.length - 1];
        handler = latestCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'rate_limit_exceeded',
            message: 'Too many requests. Please try again later.',
            type: 'rate_limit_error',
            retryAfter: 60,
          },
        });
      });

      it('should use custom error message when provided', () => {
        let handler: any;

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 60000,
            max: 100,
            prefix: 'test',
            message: 'Custom rate limit message',
          });
        });

        const latestCall = mockRateLimit.mock.calls[mockRateLimit.mock.calls.length - 1];
        handler = latestCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'rate_limit_exceeded',
            message: 'Custom rate limit message',
            type: 'rate_limit_error',
            retryAfter: 60,
          },
        });
      });

      it('should calculate retryAfter from windowMs', () => {
        let handler: any;

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 120000, // 2 minutes
            max: 100,
            prefix: 'test',
          });
        });

        const customCall = mockRateLimit.mock.calls.find(
          (call) => call[0].windowMs === 120000
        );
        handler = customCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              retryAfter: 120,
            }),
          })
        );
      });

      it('should round up retryAfter for non-round windowMs', () => {
        let handler: any;

        jest.isolateModules(() => {
          const { createRateLimiter } = require('../../../middleware/rateLimit');
          createRateLimiter({
            windowMs: 90500, // 90.5 seconds
            max: 100,
            prefix: 'test',
          });
        });

        const customCall = mockRateLimit.mock.calls.find(
          (call) => call[0].windowMs === 90500
        );
        handler = customCall[0].handler;

        handler(mockRequest as Request, mockResponse as Response);

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              retryAfter: 91, // Math.ceil(90500 / 1000)
            }),
          })
        );
      });
    });
  });

  describe('error response format', () => {
    it('should always include code field', () => {
      jest.isolateModules(() => {
        require('../../../middleware/rateLimit');
      });

      const rateLimitCall = mockRateLimit.mock.calls.find(
        (call) => call[0].max === mockConfig.rateLimit.maxRequests
      );
      const handler = rateLimitCall[0].handler;

      handler(mockRequest as Request, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'rate_limit_exceeded',
          }),
        })
      );
    });

    it('should always include type field', () => {
      jest.isolateModules(() => {
        require('../../../middleware/rateLimit');
      });

      const rateLimitCall = mockRateLimit.mock.calls.find(
        (call) => call[0].max === mockConfig.rateLimit.maxRequests
      );
      const handler = rateLimitCall[0].handler;

      handler(mockRequest as Request, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            type: 'rate_limit_error',
          }),
        })
      );
    });

    it('should always include retryAfter field', () => {
      jest.isolateModules(() => {
        require('../../../middleware/rateLimit');
      });

      const rateLimitCall = mockRateLimit.mock.calls.find(
        (call) => call[0].max === mockConfig.rateLimit.maxRequests
      );
      const handler = rateLimitCall[0].handler;

      handler(mockRequest as Request, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            retryAfter: expect.any(Number),
          }),
        })
      );
    });
  });

  describe('edge cases', () => {
    describe('undefined IP address', () => {
      it('should handle undefined IP in apiRateLimiter', () => {
        jest.isolateModules(() => {
          require('../../../middleware/rateLimit');
        });

        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const keyGenerator = rateLimitCall[0].keyGenerator;

        mockRequest.headers = {};
        mockRequest.ip = undefined;
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('ip:undefined');
      });
    });

    describe('empty API key', () => {
      it('should use IP when API key is empty string', () => {
        jest.isolateModules(() => {
          require('../../../middleware/rateLimit');
        });

        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const keyGenerator = rateLimitCall[0].keyGenerator;

        mockRequest.headers = { 'x-api-key': '' };
        mockRequest.ip = '1.2.3.4';
        const key = keyGenerator(mockRequest as Request);

        // Empty string is falsy, so it should fall back to IP
        expect(key).toBe('ip:1.2.3.4');
      });
    });

    describe('special characters in API key', () => {
      it('should handle API keys with special characters', () => {
        jest.isolateModules(() => {
          require('../../../middleware/rateLimit');
        });

        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const keyGenerator = rateLimitCall[0].keyGenerator;

        // 'key-with_special.chars!' is 22 chars, substring(0,20) = 'key-with_special.cha'
        mockRequest.headers = { 'x-api-key': 'key-with_special.chars!' };
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('key:key-with_special.cha');
      });
    });

    describe('short API keys', () => {
      it('should handle API keys shorter than 20 characters', () => {
        jest.isolateModules(() => {
          require('../../../middleware/rateLimit');
        });

        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const keyGenerator = rateLimitCall[0].keyGenerator;

        mockRequest.headers = { 'x-api-key': 'short' };
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('key:short');
      });
    });

    describe('exactly 20 character API keys', () => {
      it('should handle API keys exactly 20 characters', () => {
        jest.isolateModules(() => {
          require('../../../middleware/rateLimit');
        });

        const rateLimitCall = mockRateLimit.mock.calls.find(
          (call) => call[0].max === mockConfig.rateLimit.maxRequests
        );
        const keyGenerator = rateLimitCall[0].keyGenerator;

        const exactKey = '12345678901234567890';
        mockRequest.headers = { 'x-api-key': exactKey };
        const key = keyGenerator(mockRequest as Request);

        expect(key).toBe('key:12345678901234567890');
      });
    });
  });

  describe('integration between rate limiters', () => {
    it('should create separate instances for each rate limiter type', () => {
      jest.isolateModules(() => {
        require('../../../middleware/rateLimit');
      });

      // Should have at least 3 calls: apiRateLimiter, webhookRateLimiter, adminRateLimiter
      expect(mockRateLimit.mock.calls.length).toBeGreaterThanOrEqual(3);

      const maxValues = mockRateLimit.mock.calls.map((call) => call[0].max);
      expect(maxValues).toContain(mockConfig.rateLimit.maxRequests); // apiRateLimiter
      expect(maxValues).toContain(1000); // webhookRateLimiter
      expect(maxValues).toContain(30); // adminRateLimiter
    });

    it('should use different configurations for different limiters', () => {
      jest.isolateModules(() => {
        require('../../../middleware/rateLimit');
      });

      const apiCall = mockRateLimit.mock.calls.find(
        (call) => call[0].max === mockConfig.rateLimit.maxRequests
      );
      const webhookCall = mockRateLimit.mock.calls.find(
        (call) => call[0].max === 1000
      );
      const adminCall = mockRateLimit.mock.calls.find(
        (call) => call[0].max === 30
      );

      expect(apiCall[0].windowMs).toBe(mockConfig.rateLimit.windowMs);
      expect(webhookCall[0].windowMs).toBe(60000);
      expect(adminCall[0].windowMs).toBe(60000);
    });
  });
});
