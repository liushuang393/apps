import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock the developerService before importing the router
jest.mock('../../../services/DeveloperService', () => ({
  developerService: {
    register: jest.fn(),
    getOnboardingStatus: jest.fn(),
    regenerateApiKey: jest.fn(),
    switchMode: jest.fn(),
    updateSettings: jest.fn(),
    connectStripeAccount: jest.fn(),
    deleteAccount: jest.fn(),
  },
}));

// Mock the middleware
jest.mock('../../../middleware', () => ({
  apiKeyAuth: jest.fn((req: Request, _res: Response, next: NextFunction) => {
    // Default mock: simulate authenticated developer
    (req as any).developer = {
      id: 'dev-123',
      email: 'developer@example.com',
      testMode: true,
      stripeAccountId: 'acct_123',
      webhookSecret: 'whsec_123',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    };
    next();
  }),
  AuthenticatedRequest: {},
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import onboardingRouter from '../../../routes/onboarding';
import { developerService } from '../../../services/DeveloperService';
import { apiKeyAuth } from '../../../middleware';

describe('Onboarding Routes', () => {
  let app: Express;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create fresh express app with router
    app = express();
    app.use(express.json());
    app.use('/onboarding', onboardingRouter);
  });

  // ==================== POST /onboarding/register ====================
  describe('POST /onboarding/register', () => {
    it('should register a new developer successfully', async () => {
      const mockResult = {
        developer: {
          id: 'dev-new-123',
          email: 'newdev@example.com',
          testMode: true,
          createdAt: new Date('2024-01-15'),
        },
        apiKey: {
          apiKey: 'fpb_test_abc123xyz',
          prefix: 'fpb_test_abc',
        },
      };

      (developerService.register as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'newdev@example.com' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        message: 'Registration successful',
        developer: {
          id: mockResult.developer.id,
          email: mockResult.developer.email,
          testMode: mockResult.developer.testMode,
          createdAt: mockResult.developer.createdAt.toISOString(),
        },
        apiKey: {
          key: mockResult.apiKey.apiKey,
          prefix: mockResult.apiKey.prefix,
        },
        warning: 'Save your API key now. It will not be shown again.',
      });

      expect(developerService.register).toHaveBeenCalledWith('newdev@example.com', {
        testMode: true,
      });
    });

    it('should register with testMode explicitly set to false', async () => {
      const mockResult = {
        developer: {
          id: 'dev-live-123',
          email: 'livedev@example.com',
          testMode: false,
          createdAt: new Date('2024-01-15'),
        },
        apiKey: {
          apiKey: 'fpb_live_abc123xyz',
          prefix: 'fpb_live_abc',
        },
      };

      (developerService.register as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'livedev@example.com', testMode: false });

      expect(response.status).toBe(201);
      expect(response.body.developer.testMode).toBe(false);
      expect(developerService.register).toHaveBeenCalledWith('livedev@example.com', {
        testMode: false,
      });
    });

    it('should register with testMode explicitly set to true', async () => {
      const mockResult = {
        developer: {
          id: 'dev-test-123',
          email: 'testdev@example.com',
          testMode: true,
          createdAt: new Date('2024-01-15'),
        },
        apiKey: {
          apiKey: 'fpb_test_xyz789',
          prefix: 'fpb_test_xyz',
        },
      };

      (developerService.register as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'testdev@example.com', testMode: true });

      expect(response.status).toBe(201);
      expect(developerService.register).toHaveBeenCalledWith('testdev@example.com', {
        testMode: true,
      });
    });

    it('should return 400 when email is missing', async () => {
      const response = await request(app)
        .post('/onboarding/register')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Email is required' });
    });

    it('should return 400 when email is not a string', async () => {
      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 12345 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Email is required' });
    });

    it('should return 400 when email is null', async () => {
      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: null });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Email is required' });
    });

    it('should return 400 when email is empty string', async () => {
      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: '' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Email is required' });
    });

    it('should return 400 for invalid email format - missing @', async () => {
      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'invalidemail.com' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid email format' });
    });

    it('should return 400 for invalid email format - missing domain', async () => {
      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'invalid@' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid email format' });
    });

    it('should return 400 for invalid email format - missing username', async () => {
      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: '@example.com' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid email format' });
    });

    it('should return 400 for invalid email format - with spaces', async () => {
      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'invalid email@example.com' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid email format' });
    });

    it('should return 409 when email is already registered', async () => {
      (developerService.register as jest.Mock).mockRejectedValue(
        new Error('Email already registered')
      );

      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'existing@example.com' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Email already registered' });
    });

    it('should return 500 for internal server errors', async () => {
      (developerService.register as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'valid@example.com' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to register' });
    });

    it('should return 500 for non-Error exceptions', async () => {
      (developerService.register as jest.Mock).mockRejectedValue('Unknown error');

      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'valid@example.com' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to register' });
    });
  });

  // ==================== GET /onboarding/status ====================
  describe('GET /onboarding/status', () => {
    it('should return onboarding status successfully', async () => {
      const mockStatus = {
        developerId: 'dev-123',
        email: 'developer@example.com',
        steps: {
          accountCreated: true,
          apiKeyGenerated: true,
          stripeConnected: true,
          firstProductCreated: false,
          legalTemplatesConfigured: true,
          webhookConfigured: true,
        },
        completedSteps: 5,
        totalSteps: 6,
        isComplete: false,
        nextStep: 'Create your first product',
      };

      (developerService.getOnboardingStatus as jest.Mock).mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/onboarding/status')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: mockStatus });
      expect(developerService.getOnboardingStatus).toHaveBeenCalledWith('dev-123');
    });

    it('should return fully completed onboarding status', async () => {
      const mockStatus = {
        developerId: 'dev-123',
        email: 'developer@example.com',
        steps: {
          accountCreated: true,
          apiKeyGenerated: true,
          stripeConnected: true,
          firstProductCreated: true,
          legalTemplatesConfigured: true,
          webhookConfigured: true,
        },
        completedSteps: 6,
        totalSteps: 6,
        isComplete: true,
        nextStep: null,
      };

      (developerService.getOnboardingStatus as jest.Mock).mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/onboarding/status')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.status.isComplete).toBe(true);
      expect(response.body.status.nextStep).toBeNull();
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key. Include x-api-key header.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app).get('/onboarding/status');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
    });

    it('should return 401 when API key is invalid', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Invalid API key.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app)
        .get('/onboarding/status')
        .set('x-api-key', 'invalid_key');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
    });

    it('should return 404 when developer is not found', async () => {
      (developerService.getOnboardingStatus as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/onboarding/status')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Developer not found' });
    });

    it('should return 500 for internal server errors', async () => {
      (developerService.getOnboardingStatus as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .get('/onboarding/status')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get onboarding status' });
    });
  });

  // ==================== GET /onboarding/me ====================
  describe('GET /onboarding/me', () => {
    it('should return current developer info successfully', async () => {
      const response = await request(app)
        .get('/onboarding/me')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        developer: {
          id: 'dev-123',
          email: 'developer@example.com',
          testMode: true,
          stripeConnected: true,
          webhookConfigured: true,
          createdAt: new Date('2024-01-01').toISOString(),
          updatedAt: new Date('2024-01-02').toISOString(),
        },
      });
    });

    it('should return stripeConnected false when no stripeAccountId', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (req: Request, _res: Response, next: NextFunction) => {
          (req as any).developer = {
            id: 'dev-456',
            email: 'nostripe@example.com',
            testMode: true,
            stripeAccountId: null,
            webhookSecret: 'whsec_123',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-02'),
          };
          next();
        }
      );

      const response = await request(app)
        .get('/onboarding/me')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.developer.stripeConnected).toBe(false);
    });

    it('should return webhookConfigured false when no webhookSecret', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (req: Request, _res: Response, next: NextFunction) => {
          (req as any).developer = {
            id: 'dev-789',
            email: 'nowebhook@example.com',
            testMode: false,
            stripeAccountId: 'acct_123',
            webhookSecret: null,
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-02'),
          };
          next();
        }
      );

      const response = await request(app)
        .get('/onboarding/me')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.developer.webhookConfigured).toBe(false);
      expect(response.body.developer.testMode).toBe(false);
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key. Include x-api-key header.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app).get('/onboarding/me');

      expect(response.status).toBe(401);
    });
  });

  // ==================== POST /onboarding/api-key/regenerate ====================
  describe('POST /onboarding/api-key/regenerate', () => {
    it('should regenerate API key successfully', async () => {
      const mockApiKey = {
        apiKey: 'fpb_test_newkey123',
        prefix: 'fpb_test_new',
      };

      (developerService.regenerateApiKey as jest.Mock).mockResolvedValue(mockApiKey);

      const response = await request(app)
        .post('/onboarding/api-key/regenerate')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'API key regenerated successfully',
        apiKey: {
          key: mockApiKey.apiKey,
          prefix: mockApiKey.prefix,
        },
        warning: 'Save your new API key now. It will not be shown again. Your old key is now invalid.',
      });
      expect(developerService.regenerateApiKey).toHaveBeenCalledWith('dev-123');
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key. Include x-api-key header.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app).post('/onboarding/api-key/regenerate');

      expect(response.status).toBe(401);
    });

    it('should return 500 for internal server errors', async () => {
      (developerService.regenerateApiKey as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .post('/onboarding/api-key/regenerate')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to regenerate API key' });
    });
  });

  // ==================== POST /onboarding/mode ====================
  describe('POST /onboarding/mode', () => {
    it('should switch to test mode successfully', async () => {
      const mockDeveloper = {
        id: 'dev-123',
        email: 'developer@example.com',
        testMode: true,
      };

      (developerService.switchMode as jest.Mock).mockResolvedValue(mockDeveloper);

      const response = await request(app)
        .post('/onboarding/mode')
        .set('x-api-key', 'test_api_key')
        .send({ testMode: true });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Switched to test mode',
        testMode: true,
      });
      expect(developerService.switchMode).toHaveBeenCalledWith('dev-123', true);
    });

    it('should switch to live mode successfully', async () => {
      const mockDeveloper = {
        id: 'dev-123',
        email: 'developer@example.com',
        testMode: false,
      };

      (developerService.switchMode as jest.Mock).mockResolvedValue(mockDeveloper);

      const response = await request(app)
        .post('/onboarding/mode')
        .set('x-api-key', 'test_api_key')
        .send({ testMode: false });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Switched to live mode',
        testMode: false,
      });
      expect(developerService.switchMode).toHaveBeenCalledWith('dev-123', false);
    });

    it('should return 400 when testMode is not provided', async () => {
      const response = await request(app)
        .post('/onboarding/mode')
        .set('x-api-key', 'test_api_key')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'testMode must be a boolean' });
    });

    it('should return 400 when testMode is not a boolean - string', async () => {
      const response = await request(app)
        .post('/onboarding/mode')
        .set('x-api-key', 'test_api_key')
        .send({ testMode: 'true' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'testMode must be a boolean' });
    });

    it('should return 400 when testMode is not a boolean - number', async () => {
      const response = await request(app)
        .post('/onboarding/mode')
        .set('x-api-key', 'test_api_key')
        .send({ testMode: 1 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'testMode must be a boolean' });
    });

    it('should return 400 when testMode is null', async () => {
      const response = await request(app)
        .post('/onboarding/mode')
        .set('x-api-key', 'test_api_key')
        .send({ testMode: null });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'testMode must be a boolean' });
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key. Include x-api-key header.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app)
        .post('/onboarding/mode')
        .send({ testMode: true });

      expect(response.status).toBe(401);
    });

    it('should return 404 when developer is not found', async () => {
      (developerService.switchMode as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/onboarding/mode')
        .set('x-api-key', 'test_api_key')
        .send({ testMode: true });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Developer not found' });
    });

    it('should return 500 for internal server errors', async () => {
      (developerService.switchMode as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .post('/onboarding/mode')
        .set('x-api-key', 'test_api_key')
        .send({ testMode: true });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to switch mode' });
    });
  });

  // ==================== POST /onboarding/webhook-secret ====================
  describe('POST /onboarding/webhook-secret', () => {
    it('should set webhook secret successfully', async () => {
      const mockDeveloper = {
        id: 'dev-123',
        email: 'developer@example.com',
        webhookSecret: 'whsec_new123',
      };

      (developerService.updateSettings as jest.Mock).mockResolvedValue(mockDeveloper);

      const response = await request(app)
        .post('/onboarding/webhook-secret')
        .set('x-api-key', 'test_api_key')
        .send({ webhookSecret: 'whsec_new123' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Webhook secret configured',
        webhookConfigured: true,
      });
      expect(developerService.updateSettings).toHaveBeenCalledWith('dev-123', {
        webhookSecret: 'whsec_new123',
      });
    });

    it('should return 400 when webhookSecret is missing', async () => {
      const response = await request(app)
        .post('/onboarding/webhook-secret')
        .set('x-api-key', 'test_api_key')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'webhookSecret is required' });
    });

    it('should return 400 when webhookSecret is not a string', async () => {
      const response = await request(app)
        .post('/onboarding/webhook-secret')
        .set('x-api-key', 'test_api_key')
        .send({ webhookSecret: 12345 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'webhookSecret is required' });
    });

    it('should return 400 when webhookSecret is null', async () => {
      const response = await request(app)
        .post('/onboarding/webhook-secret')
        .set('x-api-key', 'test_api_key')
        .send({ webhookSecret: null });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'webhookSecret is required' });
    });

    it('should return 400 when webhookSecret is empty string', async () => {
      const response = await request(app)
        .post('/onboarding/webhook-secret')
        .set('x-api-key', 'test_api_key')
        .send({ webhookSecret: '' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'webhookSecret is required' });
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key. Include x-api-key header.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app)
        .post('/onboarding/webhook-secret')
        .send({ webhookSecret: 'whsec_test' });

      expect(response.status).toBe(401);
    });

    it('should return 404 when developer is not found', async () => {
      (developerService.updateSettings as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/onboarding/webhook-secret')
        .set('x-api-key', 'test_api_key')
        .send({ webhookSecret: 'whsec_test' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Developer not found' });
    });

    it('should return 500 for internal server errors', async () => {
      (developerService.updateSettings as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .post('/onboarding/webhook-secret')
        .set('x-api-key', 'test_api_key')
        .send({ webhookSecret: 'whsec_test' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to set webhook secret' });
    });
  });

  // ==================== POST /onboarding/stripe/connect ====================
  describe('POST /onboarding/stripe/connect', () => {
    it('should connect Stripe account successfully', async () => {
      const mockDeveloper = {
        id: 'dev-123',
        email: 'developer@example.com',
        stripeAccountId: 'acct_stripe123',
      };

      (developerService.connectStripeAccount as jest.Mock).mockResolvedValue(mockDeveloper);

      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .set('x-api-key', 'test_api_key')
        .send({ stripeAccountId: 'acct_stripe123' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Stripe account connected',
        stripeConnected: true,
        stripeAccountId: 'acct_stripe123',
      });
      expect(developerService.connectStripeAccount).toHaveBeenCalledWith(
        'dev-123',
        'acct_stripe123'
      );
    });

    it('should return 400 when stripeAccountId is missing', async () => {
      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .set('x-api-key', 'test_api_key')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'stripeAccountId is required' });
    });

    it('should return 400 when stripeAccountId is not a string', async () => {
      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .set('x-api-key', 'test_api_key')
        .send({ stripeAccountId: 12345 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'stripeAccountId is required' });
    });

    it('should return 400 when stripeAccountId is null', async () => {
      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .set('x-api-key', 'test_api_key')
        .send({ stripeAccountId: null });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'stripeAccountId is required' });
    });

    it('should return 400 when stripeAccountId is empty string', async () => {
      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .set('x-api-key', 'test_api_key')
        .send({ stripeAccountId: '' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'stripeAccountId is required' });
    });

    it('should return 400 when stripeAccountId has invalid format - missing acct_ prefix', async () => {
      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .set('x-api-key', 'test_api_key')
        .send({ stripeAccountId: 'invalid_stripe123' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid Stripe account ID format' });
    });

    it('should return 400 when stripeAccountId has invalid format - just acct_', async () => {
      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .set('x-api-key', 'test_api_key')
        .send({ stripeAccountId: 'act_123' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid Stripe account ID format' });
    });

    it('should accept valid stripeAccountId starting with acct_', async () => {
      const mockDeveloper = {
        id: 'dev-123',
        email: 'developer@example.com',
        stripeAccountId: 'acct_1234567890abcdef',
      };

      (developerService.connectStripeAccount as jest.Mock).mockResolvedValue(mockDeveloper);

      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .set('x-api-key', 'test_api_key')
        .send({ stripeAccountId: 'acct_1234567890abcdef' });

      expect(response.status).toBe(200);
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key. Include x-api-key header.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .send({ stripeAccountId: 'acct_test123' });

      expect(response.status).toBe(401);
    });

    it('should return 404 when developer is not found', async () => {
      (developerService.connectStripeAccount as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .set('x-api-key', 'test_api_key')
        .send({ stripeAccountId: 'acct_test123' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Developer not found' });
    });

    it('should return 500 for internal server errors', async () => {
      (developerService.connectStripeAccount as jest.Mock).mockRejectedValue(
        new Error('Stripe API error')
      );

      const response = await request(app)
        .post('/onboarding/stripe/connect')
        .set('x-api-key', 'test_api_key')
        .send({ stripeAccountId: 'acct_test123' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to connect Stripe account' });
    });
  });

  // ==================== DELETE /onboarding/account ====================
  describe('DELETE /onboarding/account', () => {
    it('should delete account successfully when email matches', async () => {
      (developerService.deleteAccount as jest.Mock).mockResolvedValue(true);

      const response = await request(app)
        .delete('/onboarding/account')
        .set('x-api-key', 'test_api_key')
        .send({ confirmEmail: 'developer@example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Account deleted successfully',
      });
      expect(developerService.deleteAccount).toHaveBeenCalledWith('dev-123');
    });

    it('should return 400 when confirmEmail does not match', async () => {
      const response = await request(app)
        .delete('/onboarding/account')
        .set('x-api-key', 'test_api_key')
        .send({ confirmEmail: 'wrong@example.com' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Please confirm your email address to delete your account',
      });
      expect(developerService.deleteAccount).not.toHaveBeenCalled();
    });

    it('should return 400 when confirmEmail is missing', async () => {
      const response = await request(app)
        .delete('/onboarding/account')
        .set('x-api-key', 'test_api_key')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Please confirm your email address to delete your account',
      });
    });

    it('should return 400 when confirmEmail is null', async () => {
      const response = await request(app)
        .delete('/onboarding/account')
        .set('x-api-key', 'test_api_key')
        .send({ confirmEmail: null });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Please confirm your email address to delete your account',
      });
    });

    it('should return 400 when confirmEmail case does not match', async () => {
      const response = await request(app)
        .delete('/onboarding/account')
        .set('x-api-key', 'test_api_key')
        .send({ confirmEmail: 'Developer@Example.com' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Please confirm your email address to delete your account',
      });
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key. Include x-api-key header.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app)
        .delete('/onboarding/account')
        .send({ confirmEmail: 'developer@example.com' });

      expect(response.status).toBe(401);
    });

    it('should return 404 when developer is not found (delete returns false)', async () => {
      (developerService.deleteAccount as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .delete('/onboarding/account')
        .set('x-api-key', 'test_api_key')
        .send({ confirmEmail: 'developer@example.com' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Developer not found' });
    });

    it('should return 500 for internal server errors', async () => {
      (developerService.deleteAccount as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .delete('/onboarding/account')
        .set('x-api-key', 'test_api_key')
        .send({ confirmEmail: 'developer@example.com' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to delete account' });
    });
  });

  // ==================== GET /onboarding/quick-start ====================
  describe('GET /onboarding/quick-start', () => {
    it('should return quick-start guide successfully', async () => {
      const mockStatus = {
        developerId: 'dev-123',
        email: 'developer@example.com',
        steps: {
          accountCreated: true,
          apiKeyGenerated: true,
          stripeConnected: true,
          firstProductCreated: false,
          legalTemplatesConfigured: true,
          webhookConfigured: true,
        },
        completedSteps: 5,
        totalSteps: 6,
        isComplete: false,
        nextStep: 'Create your first product',
      };

      (developerService.getOnboardingStatus as jest.Mock).mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/onboarding/quick-start')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('developer');
      expect(response.body).toHaveProperty('onboardingStatus');
      expect(response.body).toHaveProperty('codeSnippets');
      expect(response.body).toHaveProperty('documentation');

      expect(response.body.developer).toEqual({
        id: 'dev-123',
        email: 'developer@example.com',
        testMode: true,
      });

      expect(response.body.onboardingStatus).toEqual(mockStatus);

      // Check code snippets exist
      expect(response.body.codeSnippets).toHaveProperty('createCheckout');
      expect(response.body.codeSnippets).toHaveProperty('verifyEntitlement');
      expect(response.body.codeSnippets).toHaveProperty('handleWebhook');

      // Check documentation links exist
      expect(response.body.documentation).toHaveProperty('apiReference');
      expect(response.body.documentation).toHaveProperty('webhooks');
      expect(response.body.documentation).toHaveProperty('testing');
    });

    it('should include proper code snippets', async () => {
      const mockStatus = {
        developerId: 'dev-123',
        email: 'developer@example.com',
        steps: {},
        completedSteps: 0,
        totalSteps: 6,
        isComplete: false,
        nextStep: null,
      };

      (developerService.getOnboardingStatus as jest.Mock).mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/onboarding/quick-start')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);

      // Check createCheckout snippet contains expected content
      expect(response.body.codeSnippets.createCheckout).toContain('checkout/sessions');
      expect(response.body.codeSnippets.createCheckout).toContain('X-API-Key');
      expect(response.body.codeSnippets.createCheckout).toContain('product_id');

      // Check verifyEntitlement snippet contains expected content
      expect(response.body.codeSnippets.verifyEntitlement).toContain('entitlements/verify');
      expect(response.body.codeSnippets.verifyEntitlement).toContain('unlock_token');

      // Check handleWebhook snippet contains expected content
      expect(response.body.codeSnippets.handleWebhook).toContain('webhooks/stripe');
      expect(response.body.codeSnippets.handleWebhook).toContain('Stripe-Signature');
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key. Include x-api-key header.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app).get('/onboarding/quick-start');

      expect(response.status).toBe(401);
    });

    it('should return 500 for internal server errors', async () => {
      (developerService.getOnboardingStatus as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .get('/onboarding/quick-start')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get quick-start guide' });
    });
  });

  // ==================== Edge Cases & Response Format ====================
  describe('Edge Cases', () => {
    it('should handle concurrent registration attempts', async () => {
      // First call succeeds
      (developerService.register as jest.Mock)
        .mockResolvedValueOnce({
          developer: {
            id: 'dev-1',
            email: 'concurrent@example.com',
            testMode: true,
            createdAt: new Date('2024-01-15'),
          },
          apiKey: { apiKey: 'fpb_test_1', prefix: 'fpb_test_1' },
        })
        // Second call fails with duplicate
        .mockRejectedValueOnce(new Error('Email already registered'));

      const response1 = await request(app)
        .post('/onboarding/register')
        .send({ email: 'concurrent@example.com' });

      const response2 = await request(app)
        .post('/onboarding/register')
        .send({ email: 'concurrent@example.com' });

      expect(response1.status).toBe(201);
      expect(response2.status).toBe(409);
    });

    it('should handle special characters in email', async () => {
      const mockResult = {
        developer: {
          id: 'dev-special',
          email: 'test+special@example.com',
          testMode: true,
          createdAt: new Date('2024-01-15'),
        },
        apiKey: { apiKey: 'fpb_test_special', prefix: 'fpb_test_sp' },
      };

      (developerService.register as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'test+special@example.com' });

      expect(response.status).toBe(201);
    });

    it('should handle very long webhook secret', async () => {
      const longSecret = 'whsec_' + 'a'.repeat(500);
      const mockDeveloper = {
        id: 'dev-123',
        webhookSecret: longSecret,
      };

      (developerService.updateSettings as jest.Mock).mockResolvedValue(mockDeveloper);

      const response = await request(app)
        .post('/onboarding/webhook-secret')
        .set('x-api-key', 'test_api_key')
        .send({ webhookSecret: longSecret });

      expect(response.status).toBe(200);
    });
  });

  describe('Response Format', () => {
    it('should return correct Content-Type header for success responses', async () => {
      const mockResult = {
        developer: {
          id: 'dev-new',
          email: 'new@example.com',
          testMode: true,
          createdAt: new Date('2024-01-15'),
        },
        apiKey: { apiKey: 'fpb_test_new', prefix: 'fpb_test_ne' },
      };

      (developerService.register as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'new@example.com' });

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return correct Content-Type header for error responses', async () => {
      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return ISO 8601 formatted dates in registration response', async () => {
      const createdAt = new Date('2024-06-15T10:30:45.123Z');
      const mockResult = {
        developer: {
          id: 'dev-date',
          email: 'date@example.com',
          testMode: true,
          createdAt,
        },
        apiKey: { apiKey: 'fpb_test_date', prefix: 'fpb_test_da' },
      };

      (developerService.register as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/onboarding/register')
        .send({ email: 'date@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.developer.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
      );
    });

    it('should return ISO 8601 formatted dates in /me response', async () => {
      const response = await request(app)
        .get('/onboarding/me')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.developer.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
      );
      expect(response.body.developer.updatedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
      );
    });
  });
});
