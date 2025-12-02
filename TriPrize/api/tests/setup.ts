/**
 * Jest setup file (runs AFTER modules are loaded)
 * 目的: Jest のモック設定を行う
 * 注意点: 環境変数は setup-env.ts で設定済み（setupFiles で先に実行される）
 */

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock Firebase Admin (used indirectly by firebase.config in non-mocked paths)
jest.mock('firebase-admin', () => {
	  const verifyIdToken = jest.fn(async (token: string) => ({
	    uid: token,
	    email: `${token}@example.com`,
	    email_verified: true,
	  }));

	  return {
	    initializeApp: jest.fn(),
	    credential: {
	      cert: jest.fn(),
	    },
	    auth: jest.fn(() => ({
	      verifyIdToken,
	    })),
	    app: jest.fn(() => ({
	      messaging: jest.fn(() => ({
	        send: jest.fn(),
	      })),
	    })),
	  };
});

// Mock stripe.config.ts to provide deterministic payment behaviour in tests
// 目的: Stripe 設定をモック化し、実際の API キー検証を回避
jest.mock('../src/config/stripe.config', () => {
  return {
    stripe: null, // テストではモック支払いを使用
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_dummy',
    PAYMENT_CONFIG: {
      isProduction: false,
      useMockPayment: true,
      isTestMode: true,
      isLiveMode: false,
    },
    default: null,
  };
});

// Mock firebase.config to provide deterministic auth behaviour in tests
jest.mock('../src/config/firebase.config', () => {
	  const verifyIdToken = jest.fn((token: string) => {
	    const rawToken = token.replace('Bearer ', '');

	    // Simulate invalid token case for specific test values
	    if (rawToken === 'fake-token') {
	      const error: any = new Error('Invalid ID token');
	      error.code = 'auth/invalid-id-token';
	      return Promise.reject(error);
	    }

	    const uid = rawToken.replace('mock-token-', '');
	    return Promise.resolve({
	      uid,
	      email: `${uid}@example.com`,
	      email_verified: true,
	    });
	  });

	  return {
	    initializeFirebase: jest.fn(),
	    getFirebaseApp: jest.fn(() => ({})),
	    getAuth: jest.fn(() => ({ verifyIdToken })),
	    getMessaging: jest.fn(() => ({
	      send: jest.fn(),
	    })),
	  };
});

// Mock Stripe with an in-memory client.
// This mock is shared by unit/integration tests and the Stripe contract tests.
// It simulates the behaviour of Stripe APIs that our code relies on, without
// performing real network calls.
jest.mock('stripe', () => {
	  return jest.fn().mockImplementation(() => {
	    // In-memory stores to simulate Stripe resources
	    const paymentIntentsStore: Record<string, any> = {};
	    const paymentMethodsStore: Record<string, any> = {};
	    const customersStore: Record<string, any> = {};
	    const refundsStore: Record<string, any> = {};

	    const generateId = (prefix: string): string => {
	      const random = Math.random().toString(36).substring(2, 12);
	      return `${prefix}_${random}`;
	    };

		  const crypto = require('crypto');
		  const toPayloadString = (payload: Buffer | string | unknown): string => {
		    if (typeof payload === 'string') {
		      return payload;
		    }
		    if (payload instanceof Buffer) {
		      return payload.toString('utf8');
		    }
		    // When express.json() has already parsed the body, we receive a plain object here.
		    // For signature verification we rebuild the JSON string in a deterministic way.
		    return JSON.stringify(payload);
		  };
		  return {
	      paymentIntents: {
	        create: jest.fn(async (params: any) => {
	          if (typeof params.amount === 'number' && params.amount <= 0) {
	            throw new Error('Invalid amount');
	          }

	          const id = generateId('pi');
	          const latestCharge = generateId('ch');
	          const intent = {
	            id,
	            object: 'payment_intent',
	            amount: params.amount,
	            currency: params.currency,
	            payment_method_types: params.payment_method_types,
	            metadata: params.metadata ?? {},
	            payment_method_options: params.payment_method_options,
	            status: params.confirm ? 'succeeded' : 'requires_payment_method',
	            payment_method: params.payment_method ?? null,
	            latest_charge: latestCharge,
	            created: Math.floor(Date.now() / 1000),
	            next_action: {
	              konbini_display_details: {
	                hosted_voucher_url: 'https://example.com/konbini-voucher',
	              },
	            },
	          };
	          paymentIntentsStore[id] = intent;
	          return intent;
	        }),
	        retrieve: jest.fn(async (id: string) => paymentIntentsStore[id]),
	        cancel: jest.fn(async (id: string) => {
	          const intent = paymentIntentsStore[id];
	          if (!intent) {
	            throw new Error('PaymentIntent not found');
	          }
	          intent.status = 'canceled';
	          return intent;
	        }),
	        confirm: jest.fn(async (id: string, params: any) => {
	          const intent = paymentIntentsStore[id];
	          if (!intent) {
	            throw new Error('PaymentIntent not found');
	          }
	          intent.status = 'succeeded';
	          intent.payment_method = params.payment_method;
	          return intent;
	        }),
	      },
	      paymentMethods: {
	        create: jest.fn(async (params: any) => {
	          const id = generateId('pm');
	          const method = {
	            id,
	            type: params.type,
	            card: params.card ? { token: params.card.token } : undefined,
	            konbini: params.konbini,
	          };
	          paymentMethodsStore[id] = method;
	          return method;
	        }),
	        retrieve: jest.fn(async (id: string) => paymentMethodsStore[id]),
	        attach: jest.fn(async (id: string, params: any) => {
	          const method = paymentMethodsStore[id];
	          if (!method) {
	            throw new Error('PaymentMethod not found');
	          }
	          method.customer = params.customer;
	          return method;
	        }),
	      },
	      customers: {
	        create: jest.fn(async (params: any) => {
	          const id = generateId('cus');
	          const customer = {
	            id,
	            email: params.email,
	            name: params.name,
	            metadata: params.metadata ?? {},
	          };
	          customersStore[id] = customer;
	          return customer;
	        }),
	        update: jest.fn(async (id: string, params: any) => {
	          const customer = customersStore[id];
	          if (!customer) {
	            throw new Error('Customer not found');
	          }
	          if (params.name !== undefined) {
	            customer.name = params.name;
	          }
	          if (params.metadata !== undefined) {
	            customer.metadata = {
	              ...customer.metadata,
	              ...params.metadata,
	            };
	          }
	          return customer;
	        }),
	        del: jest.fn(async (id: string) => {
	          delete customersStore[id];
	          return { id, deleted: true };
	        }),
	      },
	      refunds: {
	        create: jest.fn(async (params: any) => {
	          const id = generateId('re');
	          const refund = {
	            id,
	            amount: params.amount,
	            status: 'succeeded',
	          };
	          refundsStore[id] = refund;
	          return refund;
	        }),
	      },
		      webhooks: {
		        constructEvent: jest.fn((payload: Buffer | string | unknown, signature: string, secret: string) => {
		          const rawPayload = toPayloadString(payload);
		          const timestampPart = signature?.split(',').find((part: string) => part.startsWith('t='));
		          const signaturePart = signature?.split(',').find((part: string) => part.startsWith('v1='));
		          if (!timestampPart || !signaturePart || !secret) {
		            throw new Error('Invalid Stripe webhook signature');
		          }
		          const timestamp = timestampPart.split('=')[1];
		          const receivedSignature = signaturePart.split('=')[1];
		          const expectedSignature = crypto
		            .createHmac('sha256', secret)
		            .update(`${timestamp}.${rawPayload}`)
		            .digest('hex');
		          if (receivedSignature !== expectedSignature) {
		            throw new Error('Invalid Stripe webhook signature');
		          }
		          return JSON.parse(rawPayload);
		        }),
		      },
	    };
	  });
	});

// Mock the entire 'redis' module with a custom implementation
jest.mock('redis', () => {
  const mockRedisClient = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    isOpen: true,
    quit: jest.fn().mockResolvedValue(undefined),
  };
  return {
    createClient: jest.fn().mockReturnValue(mockRedisClient),
  };
});

// Mock redis.config.ts to return a mocked client, overriding its actual connection logic
// 目的: Redis 接続をモック化してテストを高速化
// 注意点: idempotency.service.ts が使用するすべてのメソッドを実装する必要がある
jest.mock('../src/config/redis.config', () => {
  // インメモリストア（テスト間でリセットされる）
  const store: Record<string, { value: string; expireAt?: number }> = {};

  const mockRedisClient = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    isOpen: true,
    quit: jest.fn().mockResolvedValue(undefined),

    // GET - キー取得
    get: jest.fn().mockImplementation(async (key: string) => {
      const item = store[key];
      if (!item) return null;
      if (item.expireAt && Date.now() > item.expireAt) {
        delete store[key];
        return null;
      }
      return item.value;
    }),

    // SET - キー設定（NX, EX オプション対応）
    // idempotency ロック用: redis.set(key, value, {NX: true, EX: ttl})
    set: jest.fn().mockImplementation(async (key: string, value: string, options?: { NX?: boolean; EX?: number }) => {
      if (options?.NX && store[key]) {
        // NX: キーが存在しない場合のみ設定
        return null;
      }
      store[key] = {
        value,
        expireAt: options?.EX ? Date.now() + options.EX * 1000 : undefined,
      };
      return 'OK';
    }),

    // SETEX - TTL 付き設定
    setEx: jest.fn().mockImplementation(async (key: string, ttl: number, value: string) => {
      store[key] = {
        value,
        expireAt: Date.now() + ttl * 1000,
      };
      return 'OK';
    }),

    // INCR - インクリメント
    incr: jest.fn().mockImplementation(async (key: string) => {
      const current = store[key]?.value ? parseInt(store[key].value, 10) : 0;
      store[key] = { ...store[key], value: String(current + 1) };
      return current + 1;
    }),

    // DECR - デクリメント
    decr: jest.fn().mockImplementation(async (key: string) => {
      const current = store[key]?.value ? parseInt(store[key].value, 10) : 0;
      store[key] = { ...store[key], value: String(current - 1) };
      return current - 1;
    }),

    // EXPIRE - TTL 設定
    expire: jest.fn().mockImplementation(async (key: string, ttl: number) => {
      if (store[key]) {
        store[key].expireAt = Date.now() + ttl * 1000;
        return 1;
      }
      return 0;
    }),

    // TTL - 残り時間取得
    ttl: jest.fn().mockImplementation(async (key: string) => {
      const item = store[key];
      if (!item || !item.expireAt) return -1;
      return Math.max(0, Math.floor((item.expireAt - Date.now()) / 1000));
    }),

    // DEL - キー削除
    del: jest.fn().mockImplementation(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      let count = 0;
      for (const k of keys) {
        if (store[k]) {
          delete store[k];
          count++;
        }
      }
      return count;
    }),

    // KEYS - パターンマッチング
    keys: jest.fn().mockImplementation(async (pattern: string) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Object.keys(store).filter(k => regex.test(k));
    }),
  };

  return {
    getRedisClient: jest.fn().mockResolvedValue(mockRedisClient),
    closeRedis: jest.fn().mockResolvedValue(undefined),
  };
});

// NOTE: database.config.ts is NOT mocked - tests connect to real Docker PostgreSQL
// 目的: 統合テストは実際のDocker DBに接続する
// 注意点: docker-compose up で PostgreSQL を起動してからテストを実行すること

// NOTE: Avoid console.log here to keep test output clean and respect project logging rules.