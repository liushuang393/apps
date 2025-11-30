// Jest setup file
// Runs before each test suite

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://triprize:triprize_password@localhost:5432/triprize';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
// Deterministic Stripe test keys for jest environment (dummy, non-secret test values)
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy_key_for_jest_only';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';

// Increase timeout for integration tests
jest.setTimeout(10000);

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
jest.mock('../src/config/redis.config', () => ({
		  getRedisClient: jest.fn(() => ({
		    on: jest.fn(),
		    connect: jest.fn().mockResolvedValue(undefined),
		    isOpen: true,
		    quit: jest.fn().mockResolvedValue(undefined),
		    // Methods used by rate limiting and idempotency logic
		    get: jest.fn().mockResolvedValue(null), // Default to no existing count
		    setEx: jest.fn().mockResolvedValue(true),
		    incr: jest.fn().mockResolvedValue(1),
		    decr: jest.fn().mockResolvedValue(0),
		    expire: jest.fn().mockResolvedValue(true),
		    ttl: jest.fn().mockResolvedValue(100),
		    // Methods used in purchase-validation tests for cleaning idempotency keys
		    keys: jest.fn().mockResolvedValue([]),
		    del: jest.fn().mockResolvedValue(0),
		  })),
		  closeRedis: jest.fn().mockResolvedValue(undefined),
		}));

// NOTE: Avoid console.log here to keep test output clean and respect project logging rules.