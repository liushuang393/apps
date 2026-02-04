import jwt from 'jsonwebtoken';
import { MagicLinkService, MagicLinkPayload, PortalSession } from '../../../services/MagicLinkService';
import { Customer } from '../../../repositories/CustomerRepository';

// Mock dependencies
jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => ({
    toString: jest.fn(() => 'mock-session-id-hex-string-1234567890abcdef'),
  })),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

jest.mock('jsonwebtoken', () => {
  // Custom JWT error classes for testing (defined inside factory function)
  class MockTokenExpiredError extends Error {
    constructor() {
      super('jwt expired');
      this.name = 'TokenExpiredError';
    }
  }

  class MockJsonWebTokenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'JsonWebTokenError';
    }
  }

  return {
    sign: jest.fn(() => 'mock-jwt-token'),
    verify: jest.fn(),
    TokenExpiredError: MockTokenExpiredError,
    JsonWebTokenError: MockJsonWebTokenError,
  };
});

jest.mock('../../../config', () => ({
  config: {
    jwt: {
      secret: 'test-jwt-secret',
    },
    app: {
      baseUrl: 'http://localhost:3000',
    },
  },
}));

jest.mock('../../../config/redis', () => ({
  redisClient: {
    setEx: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('../../../repositories/CustomerRepository', () => ({
  customerRepository: {
    findByEmail: jest.fn(),
  },
}));

jest.mock('../../../services/EmailService', () => ({
  emailService: {
    send: jest.fn(),
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

import { redisClient } from '../../../config/redis';
import { customerRepository } from '../../../repositories/CustomerRepository';
import { emailService } from '../../../services/EmailService';
import { logger } from '../../../utils/logger';

const mockRedisClient = redisClient as jest.Mocked<typeof redisClient>;
const mockCustomerRepository = customerRepository as jest.Mocked<typeof customerRepository>;
const mockEmailService = emailService as jest.Mocked<typeof emailService>;
const mockJwtVerify = jwt.verify as jest.Mock;
const mockJwtSign = jwt.sign as jest.Mock;

describe('MagicLinkService', () => {
  let service: MagicLinkService;

  const mockCustomer: Customer = {
    id: 'cust-123',
    developerId: 'dev-456',
    stripeCustomerId: 'stripe_cust_789',
    email: 'test@example.com',
    name: 'Test Customer',
    metadata: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockSession: PortalSession = {
    sessionId: 'mock-session-id-hex-string-1234567890abcdef',
    customerId: 'cust-123',
    email: 'test@example.com',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };

  beforeEach(() => {
    service = new MagicLinkService();
    jest.clearAllMocks();
  });

  describe('sendMagicLink', () => {
    it('should send magic link successfully when customer exists', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockRedisClient.setEx.mockResolvedValue('OK');
      mockEmailService.send.mockResolvedValue(true);

      const result = await service.sendMagicLink('test@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toBe('If your email is registered, you will receive a magic link shortly.');
      expect(mockCustomerRepository.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        'magic_link:mock-uuid-v4',
        15 * 60, // 15 minutes
        mockCustomer.id
      );
      expect(mockEmailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: { email: 'test@example.com', name: 'Test Customer' },
          subject: 'Your ForgePay Portal Access Link',
        })
      );
      expect(logger.info).toHaveBeenCalledWith('Magic link sent', { customerId: mockCustomer.id });
    });

    it('should return success but not send email when customer does not exist', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(null);

      const result = await service.sendMagicLink('nonexistent@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toBe('If your email is registered, you will receive a magic link shortly.');
      expect(mockRedisClient.setEx).not.toHaveBeenCalled();
      expect(mockEmailService.send).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Magic link requested for non-existent customer', { email: '***' });
    });

    it('should use email as name fallback when customer has no name', async () => {
      const customerWithoutName = { ...mockCustomer, name: null };
      mockCustomerRepository.findByEmail.mockResolvedValue(customerWithoutName);
      mockRedisClient.setEx.mockResolvedValue('OK');
      mockEmailService.send.mockResolvedValue(true);

      await service.sendMagicLink('test@example.com');

      expect(mockEmailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: { email: 'test@example.com', name: undefined },
        })
      );
    });

    it('should throw error when database query fails', async () => {
      const dbError = new Error('Database connection failed');
      mockCustomerRepository.findByEmail.mockRejectedValue(dbError);

      await expect(service.sendMagicLink('test@example.com')).rejects.toThrow('Database connection failed');
      expect(logger.error).toHaveBeenCalledWith('Error sending magic link', { error: dbError });
    });

    it('should throw error when Redis fails', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      const redisError = new Error('Redis connection failed');
      mockRedisClient.setEx.mockRejectedValue(redisError);

      await expect(service.sendMagicLink('test@example.com')).rejects.toThrow('Redis connection failed');
    });

    it('should throw error when email sending fails', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockRedisClient.setEx.mockResolvedValue('OK');
      const emailError = new Error('Email service unavailable');
      mockEmailService.send.mockRejectedValue(emailError);

      await expect(service.sendMagicLink('test@example.com')).rejects.toThrow('Email service unavailable');
    });

    it('should generate JWT token with correct payload', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockRedisClient.setEx.mockResolvedValue('OK');
      mockEmailService.send.mockResolvedValue(true);

      await service.sendMagicLink('test@example.com');

      expect(mockJwtSign).toHaveBeenCalledWith(
        {
          customerId: mockCustomer.id,
          email: 'test@example.com',
          type: 'portal_access',
          jti: 'mock-uuid-v4',
        },
        'test-jwt-secret_magic_link',
        {
          expiresIn: 15 * 60,
          algorithm: 'HS256',
        }
      );
    });
  });

  describe('verifyMagicLink', () => {
    const validPayload: MagicLinkPayload = {
      customerId: 'cust-123',
      email: 'test@example.com',
      type: 'portal_access',
      jti: 'mock-uuid-v4',
    };

    it('should verify magic link and create session successfully', async () => {
      mockJwtVerify.mockReturnValue(validPayload);
      mockRedisClient.get.mockResolvedValue('cust-123');
      mockRedisClient.del.mockResolvedValue(1);
      mockRedisClient.setEx.mockResolvedValue('OK');

      const result = await service.verifyMagicLink('valid-token');

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session?.customerId).toBe('cust-123');
      expect(result.session?.email).toBe('test@example.com');
      expect(mockRedisClient.del).toHaveBeenCalledWith('magic_link:mock-uuid-v4');
      expect(logger.info).toHaveBeenCalledWith('Magic link verified, session created', expect.any(Object));
    });

    it('should return error when magic link is expired or already used', async () => {
      mockJwtVerify.mockReturnValue(validPayload);
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.verifyMagicLink('used-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Magic link expired or already used');
      expect(result.session).toBeUndefined();
    });

    it('should return error when customer ID does not match', async () => {
      mockJwtVerify.mockReturnValue(validPayload);
      mockRedisClient.get.mockResolvedValue('different-customer-id');

      const result = await service.verifyMagicLink('tampered-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid magic link');
    });

    it('should return error when JWT token is expired', async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new (jwt.TokenExpiredError as any)();
      });

      const result = await service.verifyMagicLink('expired-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Magic link has expired');
    });

    it('should return error when JWT token is invalid', async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new (jwt.JsonWebTokenError as any)('invalid token');
      });

      const result = await service.verifyMagicLink('invalid-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid magic link');
    });

    it('should throw error for unexpected errors', async () => {
      const unexpectedError = new Error('Unexpected error');
      mockJwtVerify.mockImplementation(() => {
        throw unexpectedError;
      });

      await expect(service.verifyMagicLink('token')).rejects.toThrow('Unexpected error');
      expect(logger.error).toHaveBeenCalledWith('Error verifying magic link', { error: unexpectedError });
    });

    it('should delete magic link token after successful verification', async () => {
      mockJwtVerify.mockReturnValue(validPayload);
      mockRedisClient.get.mockResolvedValue('cust-123');
      mockRedisClient.del.mockResolvedValue(1);
      mockRedisClient.setEx.mockResolvedValue('OK');

      await service.verifyMagicLink('valid-token');

      expect(mockRedisClient.del).toHaveBeenCalledWith('magic_link:mock-uuid-v4');
    });
  });

  describe('verifySession', () => {
    it('should return valid session', async () => {
      const sessionData = JSON.stringify(mockSession);
      mockRedisClient.get.mockResolvedValue(sessionData);

      const result = await service.verifySession('mock-session-id-hex-string-1234567890abcdef');

      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe('mock-session-id-hex-string-1234567890abcdef');
      expect(result?.customerId).toBe('cust-123');
      expect(result?.email).toBe('test@example.com');
    });

    it('should return null when session does not exist', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.verifySession('nonexistent-session');

      expect(result).toBeNull();
    });

    it('should return null and destroy expired session', async () => {
      const expiredSession = {
        ...mockSession,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(expiredSession));
      mockRedisClient.del.mockResolvedValue(1);

      const result = await service.verifySession('expired-session');

      expect(result).toBeNull();
      expect(mockRedisClient.del).toHaveBeenCalledWith('portal_session:expired-session');
    });

    it('should return null on Redis error', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

      const result = await service.verifySession('session-id');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Error verifying session', expect.any(Object));
    });

    it('should convert date strings to Date objects', async () => {
      const sessionData = JSON.stringify({
        ...mockSession,
        createdAt: '2024-01-01T00:00:00.000Z',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      mockRedisClient.get.mockResolvedValue(sessionData);

      const result = await service.verifySession('session-id');

      expect(result?.createdAt).toBeInstanceOf(Date);
      expect(result?.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('destroySession', () => {
    it('should destroy session successfully', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      await service.destroySession('session-to-destroy');

      expect(mockRedisClient.del).toHaveBeenCalledWith('portal_session:session-to-destroy');
      expect(logger.info).toHaveBeenCalledWith('Portal session destroyed', { sessionId: 'session-to-destroy' });
    });

    it('should not throw error when session does not exist', async () => {
      mockRedisClient.del.mockResolvedValue(0);

      await expect(service.destroySession('nonexistent-session')).resolves.not.toThrow();
    });
  });

  describe('refreshSession', () => {
    it('should refresh session and extend expiration', async () => {
      const sessionData = JSON.stringify(mockSession);
      mockRedisClient.get.mockResolvedValue(sessionData);
      mockRedisClient.setEx.mockResolvedValue('OK');

      const result = await service.refreshSession('mock-session-id-hex-string-1234567890abcdef');

      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe('mock-session-id-hex-string-1234567890abcdef');
      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        'portal_session:mock-session-id-hex-string-1234567890abcdef',
        24 * 60 * 60, // 24 hours
        expect.any(String)
      );
    });

    it('should return null when session does not exist', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.refreshSession('nonexistent-session');

      expect(result).toBeNull();
    });

    it('should return null for expired session', async () => {
      const expiredSession = {
        ...mockSession,
        expiresAt: new Date(Date.now() - 1000),
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(expiredSession));
      mockRedisClient.del.mockResolvedValue(1);

      const result = await service.refreshSession('expired-session');

      expect(result).toBeNull();
    });

    it('should update expiresAt to new future date', async () => {
      const now = Date.now();
      const sessionData = JSON.stringify(mockSession);
      mockRedisClient.get.mockResolvedValue(sessionData);
      mockRedisClient.setEx.mockResolvedValue('OK');

      const result = await service.refreshSession('session-id');

      // The new expiration should be approximately 24 hours from now
      const expectedMinExpiry = now + 24 * 60 * 60 * 1000 - 1000; // 1 second tolerance
      const expectedMaxExpiry = now + 24 * 60 * 60 * 1000 + 1000;
      
      expect(result?.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(result?.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxExpiry);
    });
  });

  describe('constructor', () => {
    it('should use default dependencies when none provided', () => {
      const defaultService = new MagicLinkService();
      expect(defaultService).toBeDefined();
    });

    it('should accept custom dependencies', () => {
      const customCustomerRepo = { findByEmail: jest.fn() } as any;
      const customEmailService = { send: jest.fn() } as any;
      
      const customService = new MagicLinkService(customCustomerRepo, customEmailService);
      expect(customService).toBeDefined();
    });
  });

  describe('email content generation', () => {
    it('should include magic link URL in email HTML content', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockRedisClient.setEx.mockResolvedValue('OK');
      mockEmailService.send.mockResolvedValue(true);

      await service.sendMagicLink('test@example.com');

      const emailCall = mockEmailService.send.mock.calls[0][0];
      expect(emailCall.html).toContain('http://localhost:3000/portal/auth/verify?token=mock-jwt-token');
      expect(emailCall.html).toContain('Access Portal');
      expect(emailCall.html).toContain('ForgePay Portal');
    });

    it('should include magic link URL in email text content', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockRedisClient.setEx.mockResolvedValue('OK');
      mockEmailService.send.mockResolvedValue(true);

      await service.sendMagicLink('test@example.com');

      const emailCall = mockEmailService.send.mock.calls[0][0];
      expect(emailCall.text).toContain('http://localhost:3000/portal/auth/verify?token=mock-jwt-token');
      expect(emailCall.text).toContain('expires in 15 minutes');
    });

    it('should personalize email with customer name', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockRedisClient.setEx.mockResolvedValue('OK');
      mockEmailService.send.mockResolvedValue(true);

      await service.sendMagicLink('test@example.com');

      const emailCall = mockEmailService.send.mock.calls[0][0];
      expect(emailCall.html).toContain('Hi Test Customer,');
      expect(emailCall.text).toContain('Hi Test Customer,');
    });

    it('should use email as fallback when customer has no name', async () => {
      const customerNoName = { ...mockCustomer, name: null };
      mockCustomerRepository.findByEmail.mockResolvedValue(customerNoName);
      mockRedisClient.setEx.mockResolvedValue('OK');
      mockEmailService.send.mockResolvedValue(true);

      await service.sendMagicLink('test@example.com');

      const emailCall = mockEmailService.send.mock.calls[0][0];
      expect(emailCall.html).toContain('Hi test@example.com,');
      expect(emailCall.text).toContain('Hi test@example.com,');
    });
  });

  describe('TTL constants', () => {
    it('should use correct magic link TTL (15 minutes)', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockRedisClient.setEx.mockResolvedValue('OK');
      mockEmailService.send.mockResolvedValue(true);

      await service.sendMagicLink('test@example.com');

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        expect.any(String),
        15 * 60, // 15 minutes in seconds
        expect.any(String)
      );
    });

    it('should use correct session TTL (24 hours)', async () => {
      const validPayload: MagicLinkPayload = {
        customerId: 'cust-123',
        email: 'test@example.com',
        type: 'portal_access',
        jti: 'mock-uuid-v4',
      };
      mockJwtVerify.mockReturnValue(validPayload);
      mockRedisClient.get.mockResolvedValue('cust-123');
      mockRedisClient.del.mockResolvedValue(1);
      mockRedisClient.setEx.mockResolvedValue('OK');

      await service.verifyMagicLink('valid-token');

      // Find the call for portal_session (not magic_link)
      const sessionSetExCall = mockRedisClient.setEx.mock.calls.find(
        call => (call[0] as string).startsWith('portal_session:')
      );
      expect(sessionSetExCall?.[1]).toBe(24 * 60 * 60); // 24 hours in seconds
    });
  });

  describe('security features', () => {
    it('should use single-use tokens (delete after verification)', async () => {
      const validPayload: MagicLinkPayload = {
        customerId: 'cust-123',
        email: 'test@example.com',
        type: 'portal_access',
        jti: 'mock-uuid-v4',
      };
      mockJwtVerify.mockReturnValue(validPayload);
      mockRedisClient.get.mockResolvedValue('cust-123');
      mockRedisClient.del.mockResolvedValue(1);
      mockRedisClient.setEx.mockResolvedValue('OK');

      await service.verifyMagicLink('token');

      expect(mockRedisClient.del).toHaveBeenCalledWith('magic_link:mock-uuid-v4');
    });

    it('should not reveal if customer exists or not', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(null);

      const result = await service.sendMagicLink('nonexistent@example.com');

      // Message should be the same regardless of whether customer exists
      expect(result.success).toBe(true);
      expect(result.message).toBe('If your email is registered, you will receive a magic link shortly.');
    });

    it('should validate stored customer ID matches token payload', async () => {
      const validPayload: MagicLinkPayload = {
        customerId: 'cust-123',
        email: 'test@example.com',
        type: 'portal_access',
        jti: 'mock-uuid-v4',
      };
      mockJwtVerify.mockReturnValue(validPayload);
      mockRedisClient.get.mockResolvedValue('different-customer');

      const result = await service.verifyMagicLink('token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid magic link');
    });
  });
});
