import { DeveloperService } from '../../../services/DeveloperService';
import { Developer } from '../../../repositories/DeveloperRepository';

// Mock dependencies
jest.mock('../../../repositories/DeveloperRepository', () => ({
  developerRepository: {
    create: jest.fn(),
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findByApiKeyHash: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../../services/LegalTemplateService', () => ({
  legalTemplateService: {
    createDefaultTemplates: jest.fn(),
    getActiveTemplates: jest.fn(),
  },
}));

jest.mock('../../../services/EmailService', () => ({
  emailService: {
    send: jest.fn(),
  },
}));

jest.mock('../../../config', () => ({
  config: {
    app: {
      baseUrl: 'http://localhost:3000',
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

import { developerRepository } from '../../../repositories/DeveloperRepository';
import { legalTemplateService } from '../../../services/LegalTemplateService';
import { emailService } from '../../../services/EmailService';

const mockDeveloperRepository = developerRepository as jest.Mocked<typeof developerRepository>;
const mockLegalTemplateService = legalTemplateService as jest.Mocked<typeof legalTemplateService>;
const mockEmailService = emailService as jest.Mocked<typeof emailService>;

describe('DeveloperService', () => {
  let service: DeveloperService;

  const mockDeveloper: Developer = {
    id: 'dev-123',
    email: 'test@example.com',
    apiKeyHash: 'hashed-key',
    testMode: true,
    stripeAccountId: null,
    webhookSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    service = new DeveloperService();
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new developer successfully', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(null);
      mockDeveloperRepository.create.mockResolvedValue(mockDeveloper);
      (mockLegalTemplateService.createDefaultTemplates as jest.Mock).mockResolvedValue([]);
      (mockEmailService.send as jest.Mock).mockResolvedValue(true);

      const result = await service.register('test@example.com');

      expect(result.developer).toEqual(mockDeveloper);
      expect(result.apiKey.apiKey).toContain('fpb_test_');
      expect(result.apiKey.prefix).toHaveLength(12);
      expect(mockDeveloperRepository.create).toHaveBeenCalled();
    });

    it('should throw error if email already registered', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(mockDeveloper);

      await expect(service.register('test@example.com')).rejects.toThrow(
        'Email already registered'
      );
    });

    it('should register in live mode when specified', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(null);
      mockDeveloperRepository.create.mockResolvedValue({
        ...mockDeveloper,
        testMode: false,
      });
      (mockLegalTemplateService.createDefaultTemplates as jest.Mock).mockResolvedValue([]);
      (mockEmailService.send as jest.Mock).mockResolvedValue(true);

      const result = await service.register('test@example.com', { testMode: false });

      expect(result.apiKey.apiKey).toContain('fpb_live_');
    });

    it('should continue if legal template creation fails', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(null);
      mockDeveloperRepository.create.mockResolvedValue(mockDeveloper);
      (mockLegalTemplateService.createDefaultTemplates as jest.Mock).mockRejectedValue(
        new Error('Template error')
      );
      (mockEmailService.send as jest.Mock).mockResolvedValue(true);

      const result = await service.register('test@example.com');

      expect(result.developer).toEqual(mockDeveloper);
    });

    it('should continue if email sending fails', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(null);
      mockDeveloperRepository.create.mockResolvedValue(mockDeveloper);
      (mockLegalTemplateService.createDefaultTemplates as jest.Mock).mockResolvedValue([]);
      (mockEmailService.send as jest.Mock).mockRejectedValue(new Error('Email error'));

      const result = await service.register('test@example.com');

      expect(result.developer).toEqual(mockDeveloper);
    });
  });

  describe('regenerateApiKey', () => {
    it('should regenerate API key successfully', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(mockDeveloper);
      mockDeveloperRepository.update.mockResolvedValue(mockDeveloper);

      const result = await service.regenerateApiKey('dev-123');

      expect(result.apiKey).toContain('fpb_test_');
      expect(mockDeveloperRepository.update).toHaveBeenCalled();
    });

    it('should throw error if developer not found', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(null);

      await expect(service.regenerateApiKey('invalid-id')).rejects.toThrow(
        'Developer not found'
      );
    });

    it('should generate live mode key for live developer', async () => {
      mockDeveloperRepository.findById.mockResolvedValue({
        ...mockDeveloper,
        testMode: false,
      });
      mockDeveloperRepository.update.mockResolvedValue(mockDeveloper);

      const result = await service.regenerateApiKey('dev-123');

      expect(result.apiKey).toContain('fpb_live_');
    });
  });

  describe('validateApiKey', () => {
    it('should return developer for valid API key', async () => {
      mockDeveloperRepository.findByApiKeyHash.mockResolvedValue(mockDeveloper);

      const result = await service.validateApiKey('fpb_test_abc123');

      expect(result).toEqual(mockDeveloper);
    });

    it('should return null for invalid API key', async () => {
      mockDeveloperRepository.findByApiKeyHash.mockResolvedValue(null);

      const result = await service.validateApiKey('invalid-key');

      expect(result).toBeNull();
    });
  });

  describe('getDeveloper', () => {
    it('should return developer by ID', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(mockDeveloper);

      const result = await service.getDeveloper('dev-123');

      expect(result).toEqual(mockDeveloper);
    });

    it('should return null if not found', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(null);

      const result = await service.getDeveloper('invalid-id');

      expect(result).toBeNull();
    });
  });

  describe('getDeveloperByEmail', () => {
    it('should return developer by email', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(mockDeveloper);

      const result = await service.getDeveloperByEmail('test@example.com');

      expect(result).toEqual(mockDeveloper);
    });
  });

  describe('updateSettings', () => {
    it('should update developer settings', async () => {
      const updatedDeveloper = { ...mockDeveloper, webhookSecret: 'secret-123' };
      mockDeveloperRepository.update.mockResolvedValue(updatedDeveloper);

      const result = await service.updateSettings('dev-123', {
        webhookSecret: 'secret-123',
      });

      expect(result?.webhookSecret).toBe('secret-123');
    });
  });

  describe('connectStripeAccount', () => {
    it('should connect Stripe account', async () => {
      const updatedDeveloper = {
        ...mockDeveloper,
        stripeAccountId: 'acct_123',
      };
      mockDeveloperRepository.update.mockResolvedValue(updatedDeveloper);

      const result = await service.connectStripeAccount('dev-123', 'acct_123');

      expect(result?.stripeAccountId).toBe('acct_123');
    });
  });

  describe('getOnboardingStatus', () => {
    it('should return onboarding status with incomplete steps', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(mockDeveloper);
      (mockLegalTemplateService.getActiveTemplates as jest.Mock).mockResolvedValue({
        terms_of_service: null,
        privacy_policy: null,
        refund_policy: null,
      });

      const result = await service.getOnboardingStatus('dev-123');

      expect(result?.isComplete).toBe(false);
      expect(result?.steps.accountCreated).toBe(true);
      expect(result?.steps.apiKeyGenerated).toBe(true);
      expect(result?.steps.stripeConnected).toBe(false);
      expect(result?.nextStep).toBe('Connect your Stripe account');
    });

    it('should return null if developer not found', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(null);

      const result = await service.getOnboardingStatus('invalid-id');

      expect(result).toBeNull();
    });

    it('should show correct next step when Stripe is connected', async () => {
      mockDeveloperRepository.findById.mockResolvedValue({
        ...mockDeveloper,
        stripeAccountId: 'acct_123',
      });
      (mockLegalTemplateService.getActiveTemplates as jest.Mock).mockResolvedValue({
        terms_of_service: null,
        privacy_policy: null,
        refund_policy: null,
      });

      const result = await service.getOnboardingStatus('dev-123');

      expect(result?.nextStep).toBe('Create your first product');
    });
  });

  describe('switchMode', () => {
    it('should switch to live mode', async () => {
      const updatedDeveloper = { ...mockDeveloper, testMode: false };
      mockDeveloperRepository.update.mockResolvedValue(updatedDeveloper);

      const result = await service.switchMode('dev-123', false);

      expect(result?.testMode).toBe(false);
    });

    it('should switch to test mode', async () => {
      mockDeveloperRepository.update.mockResolvedValue(mockDeveloper);

      const result = await service.switchMode('dev-123', true);

      expect(result?.testMode).toBe(true);
    });
  });

  describe('deleteAccount', () => {
    it('should delete developer account', async () => {
      mockDeveloperRepository.delete.mockResolvedValue(true);

      const result = await service.deleteAccount('dev-123');

      expect(result).toBe(true);
    });

    it('should return false if deletion fails', async () => {
      mockDeveloperRepository.delete.mockResolvedValue(false);

      const result = await service.deleteAccount('invalid-id');

      expect(result).toBe(false);
    });
  });

  describe('API key format', () => {
    it('should generate valid test mode API key format', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(null);
      mockDeveloperRepository.create.mockResolvedValue(mockDeveloper);
      (mockLegalTemplateService.createDefaultTemplates as jest.Mock).mockResolvedValue([]);
      (mockEmailService.send as jest.Mock).mockResolvedValue(true);

      const result = await service.register('test@example.com', { testMode: true });

      expect(result.apiKey.apiKey).toMatch(/^fpb_test_[A-Za-z0-9_-]+$/);
    });

    it('should generate valid live mode API key format', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(null);
      mockDeveloperRepository.create.mockResolvedValue({
        ...mockDeveloper,
        testMode: false,
      });
      (mockLegalTemplateService.createDefaultTemplates as jest.Mock).mockResolvedValue([]);
      (mockEmailService.send as jest.Mock).mockResolvedValue(true);

      const result = await service.register('test@example.com', { testMode: false });

      expect(result.apiKey.apiKey).toMatch(/^fpb_live_[A-Za-z0-9_-]+$/);
    });
  });
});
