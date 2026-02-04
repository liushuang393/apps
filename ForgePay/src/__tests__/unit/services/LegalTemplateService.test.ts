import {
  LegalTemplateService,
  DEFAULT_TEMPLATES,
} from '../../../services/LegalTemplateService';
import {
  LegalTemplate,
  LegalTemplateType,
  CustomerLegalAcceptance,
} from '../../../repositories/LegalTemplateRepository';

// Mock dependencies
jest.mock('../../../repositories/LegalTemplateRepository', () => ({
  legalTemplateRepository: {
    create: jest.fn(),
    findById: jest.fn(),
    findActiveByDeveloperAndType: jest.fn(),
    findByDeveloperId: jest.fn(),
    findVersionHistory: jest.fn(),
    createNewVersion: jest.fn(),
    update: jest.fn(),
    activate: jest.fn(),
    delete: jest.fn(),
    recordAcceptance: jest.fn(),
    getCustomerAcceptances: jest.fn(),
    hasAcceptedLatest: jest.fn(),
  },
}));

jest.mock('../../../services/EmailService', () => ({
  emailService: {
    send: jest.fn(),
  },
}));

jest.mock('../../../repositories/CustomerRepository', () => ({
  customerRepository: {
    findByDeveloperId: jest.fn(),
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

import { legalTemplateRepository } from '../../../repositories/LegalTemplateRepository';
import { emailService } from '../../../services/EmailService';
import { customerRepository } from '../../../repositories/CustomerRepository';
import { logger } from '../../../utils/logger';

const mockTemplateRepo = legalTemplateRepository as jest.Mocked<typeof legalTemplateRepository>;
const mockEmailService = emailService as jest.Mocked<typeof emailService>;
const mockCustomerRepo = customerRepository as jest.Mocked<typeof customerRepository>;

describe('LegalTemplateService', () => {
  let service: LegalTemplateService;

  const mockTemplate: LegalTemplate = {
    id: 'template-123',
    developerId: 'dev-123',
    type: 'terms_of_service',
    version: 1,
    title: 'Terms of Service',
    content: '# Terms of Service\n\nLast updated: 2024-01-15',
    contentHtml: null,
    language: 'en',
    isActive: true,
    isDefault: true,
    effectiveDate: null,
    metadata: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockPrivacyTemplate: LegalTemplate = {
    ...mockTemplate,
    id: 'template-456',
    type: 'privacy_policy',
    title: 'Privacy Policy',
    content: '# Privacy Policy\n\nLast updated: 2024-01-15',
  };

  const mockRefundTemplate: LegalTemplate = {
    ...mockTemplate,
    id: 'template-789',
    type: 'refund_policy',
    title: 'Refund Policy',
    content: '# Refund Policy\n\nLast updated: 2024-01-15',
  };

  const mockAcceptance: CustomerLegalAcceptance = {
    id: 'acceptance-123',
    customerId: 'cust-123',
    templateId: 'template-123',
    templateType: 'terms_of_service',
    templateVersion: 1,
    acceptedAt: new Date('2024-01-15'),
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
  };

  const mockCustomer = {
    id: 'cust-123',
    developerId: 'dev-123',
    email: 'customer@example.com',
    name: 'Test Customer',
    stripeCustomerId: 'cus_stripe123',
    metadata: {},
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    service = new LegalTemplateService(
      mockTemplateRepo as any,
      mockEmailService as any,
      mockCustomerRepo as any
    );
    jest.clearAllMocks();
  });

  describe('createTemplate', () => {
    it('should create a legal template successfully', async () => {
      mockTemplateRepo.create.mockResolvedValue(mockTemplate);

      const params = {
        developerId: 'dev-123',
        type: 'terms_of_service' as LegalTemplateType,
        title: 'Terms of Service',
        content: '# Terms of Service',
      };

      const result = await service.createTemplate(params);

      expect(result).toEqual(mockTemplate);
      expect(mockTemplateRepo.create).toHaveBeenCalledWith(params);
    });

    it('should pass through all parameters to repository', async () => {
      mockTemplateRepo.create.mockResolvedValue(mockTemplate);

      const params = {
        developerId: 'dev-123',
        type: 'privacy_policy' as LegalTemplateType,
        title: 'Privacy Policy',
        content: '# Privacy Policy',
        contentHtml: '<h1>Privacy Policy</h1>',
        language: 'en',
        isDefault: true,
        effectiveDate: new Date('2024-02-01'),
        metadata: { version: '1.0' },
      };

      await service.createTemplate(params);

      expect(mockTemplateRepo.create).toHaveBeenCalledWith(params);
    });

    it('should propagate repository errors', async () => {
      const error = new Error('Database error');
      mockTemplateRepo.create.mockRejectedValue(error);

      await expect(
        service.createTemplate({
          developerId: 'dev-123',
          type: 'terms_of_service',
          title: 'Terms',
          content: 'Content',
        })
      ).rejects.toThrow('Database error');
    });
  });

  describe('createDefaultTemplates', () => {
    it('should create all three default templates for a developer', async () => {
      mockTemplateRepo.create
        .mockResolvedValueOnce(mockTemplate)
        .mockResolvedValueOnce(mockPrivacyTemplate)
        .mockResolvedValueOnce(mockRefundTemplate);

      const result = await service.createDefaultTemplates('dev-123');

      expect(result).toHaveLength(3);
      expect(mockTemplateRepo.create).toHaveBeenCalledTimes(3);
      expect(logger.info).toHaveBeenCalledWith('Default legal templates created', {
        developerId: 'dev-123',
        count: 3,
      });
    });

    it('should replace {{effective_date}} placeholder in content', async () => {
      mockTemplateRepo.create.mockResolvedValue(mockTemplate);

      await service.createDefaultTemplates('dev-123');

      const createCalls = mockTemplateRepo.create.mock.calls;
      // Each call should have content with a date format (YYYY-MM-DD)
      for (const call of createCalls) {
        expect(call[0].content).not.toContain('{{effective_date}}');
        expect(call[0].content).toMatch(/\d{4}-\d{2}-\d{2}/);
      }
    });

    it('should set isDefault to true for all default templates', async () => {
      mockTemplateRepo.create.mockResolvedValue(mockTemplate);

      await service.createDefaultTemplates('dev-123');

      const createCalls = mockTemplateRepo.create.mock.calls;
      for (const call of createCalls) {
        expect(call[0].isDefault).toBe(true);
      }
    });

    it('should create templates with correct types', async () => {
      mockTemplateRepo.create.mockResolvedValue(mockTemplate);

      await service.createDefaultTemplates('dev-123');

      const types = mockTemplateRepo.create.mock.calls.map((call) => call[0].type);
      expect(types).toContain('terms_of_service');
      expect(types).toContain('privacy_policy');
      expect(types).toContain('refund_policy');
    });

    it('should propagate errors during creation', async () => {
      mockTemplateRepo.create.mockRejectedValue(new Error('Creation failed'));

      await expect(service.createDefaultTemplates('dev-123')).rejects.toThrow('Creation failed');
    });
  });

  describe('getTemplate', () => {
    it('should return template by ID', async () => {
      mockTemplateRepo.findById.mockResolvedValue(mockTemplate);

      const result = await service.getTemplate('template-123');

      expect(result).toEqual(mockTemplate);
      expect(mockTemplateRepo.findById).toHaveBeenCalledWith('template-123');
    });

    it('should return null if template not found', async () => {
      mockTemplateRepo.findById.mockResolvedValue(null);

      const result = await service.getTemplate('nonexistent');

      expect(result).toBeNull();
    });

    it('should propagate repository errors', async () => {
      mockTemplateRepo.findById.mockRejectedValue(new Error('Query failed'));

      await expect(service.getTemplate('template-123')).rejects.toThrow('Query failed');
    });
  });

  describe('getActiveTemplate', () => {
    it('should return active template for developer and type', async () => {
      mockTemplateRepo.findActiveByDeveloperAndType.mockResolvedValue(mockTemplate);

      const result = await service.getActiveTemplate('dev-123', 'terms_of_service');

      expect(result).toEqual(mockTemplate);
      expect(mockTemplateRepo.findActiveByDeveloperAndType).toHaveBeenCalledWith(
        'dev-123',
        'terms_of_service'
      );
    });

    it('should return null if no active template exists', async () => {
      mockTemplateRepo.findActiveByDeveloperAndType.mockResolvedValue(null);

      const result = await service.getActiveTemplate('dev-123', 'privacy_policy');

      expect(result).toBeNull();
    });

    it('should work for all template types', async () => {
      const types: LegalTemplateType[] = ['terms_of_service', 'privacy_policy', 'refund_policy'];
      
      for (const type of types) {
        mockTemplateRepo.findActiveByDeveloperAndType.mockResolvedValue({
          ...mockTemplate,
          type,
        });

        const result = await service.getActiveTemplate('dev-123', type);

        expect(result?.type).toBe(type);
      }
    });
  });

  describe('getActiveTemplates', () => {
    it('should return all active templates organized by type', async () => {
      mockTemplateRepo.findByDeveloperId.mockResolvedValue([
        mockTemplate,
        mockPrivacyTemplate,
        mockRefundTemplate,
      ]);

      const result = await service.getActiveTemplates('dev-123');

      expect(result.terms_of_service).toEqual(mockTemplate);
      expect(result.privacy_policy).toEqual(mockPrivacyTemplate);
      expect(result.refund_policy).toEqual(mockRefundTemplate);
      expect(mockTemplateRepo.findByDeveloperId).toHaveBeenCalledWith('dev-123', {
        activeOnly: true,
      });
    });

    it('should return null for types without active templates', async () => {
      mockTemplateRepo.findByDeveloperId.mockResolvedValue([mockTemplate]);

      const result = await service.getActiveTemplates('dev-123');

      expect(result.terms_of_service).toEqual(mockTemplate);
      expect(result.privacy_policy).toBeNull();
      expect(result.refund_policy).toBeNull();
    });

    it('should return all nulls when no templates exist', async () => {
      mockTemplateRepo.findByDeveloperId.mockResolvedValue([]);

      const result = await service.getActiveTemplates('dev-123');

      expect(result.terms_of_service).toBeNull();
      expect(result.privacy_policy).toBeNull();
      expect(result.refund_policy).toBeNull();
    });
  });

  describe('getDeveloperTemplates', () => {
    it('should return all templates for a developer', async () => {
      const templates = [mockTemplate, mockPrivacyTemplate];
      mockTemplateRepo.findByDeveloperId.mockResolvedValue(templates);

      const result = await service.getDeveloperTemplates('dev-123');

      expect(result).toEqual(templates);
      expect(mockTemplateRepo.findByDeveloperId).toHaveBeenCalledWith('dev-123', {});
    });

    it('should filter by type when provided', async () => {
      mockTemplateRepo.findByDeveloperId.mockResolvedValue([mockTemplate]);

      const result = await service.getDeveloperTemplates('dev-123', 'terms_of_service');

      expect(result).toEqual([mockTemplate]);
      expect(mockTemplateRepo.findByDeveloperId).toHaveBeenCalledWith('dev-123', {
        type: 'terms_of_service',
      });
    });

    it('should return empty array when no templates exist', async () => {
      mockTemplateRepo.findByDeveloperId.mockResolvedValue([]);

      const result = await service.getDeveloperTemplates('dev-123');

      expect(result).toEqual([]);
    });
  });

  describe('getVersionHistory', () => {
    it('should return version history for template type', async () => {
      const versions = [
        { ...mockTemplate, version: 3, isActive: true },
        { ...mockTemplate, version: 2, isActive: false },
        { ...mockTemplate, version: 1, isActive: false },
      ];
      mockTemplateRepo.findVersionHistory.mockResolvedValue(versions);

      const result = await service.getVersionHistory('dev-123', 'terms_of_service');

      expect(result).toEqual(versions);
      expect(mockTemplateRepo.findVersionHistory).toHaveBeenCalledWith(
        'dev-123',
        'terms_of_service'
      );
    });

    it('should return empty array when no versions exist', async () => {
      mockTemplateRepo.findVersionHistory.mockResolvedValue([]);

      const result = await service.getVersionHistory('dev-123', 'privacy_policy');

      expect(result).toEqual([]);
    });
  });

  describe('updateTemplate', () => {
    it('should update template in place when createNewVersion is false', async () => {
      const updatedTemplate = { ...mockTemplate, title: 'Updated Title' };
      mockTemplateRepo.findById.mockResolvedValue(mockTemplate);
      mockTemplateRepo.update.mockResolvedValue(updatedTemplate);

      const result = await service.updateTemplate('template-123', {
        title: 'Updated Title',
      });

      expect(result).toEqual(updatedTemplate);
      expect(mockTemplateRepo.update).toHaveBeenCalledWith('template-123', {
        title: 'Updated Title',
      });
    });

    it('should create new version when content changes and createNewVersion is true', async () => {
      const newVersionTemplate = { ...mockTemplate, version: 2, content: 'New content' };
      mockTemplateRepo.findById.mockResolvedValue(mockTemplate);
      mockTemplateRepo.createNewVersion.mockResolvedValue(newVersionTemplate);

      const result = await service.updateTemplate('template-123', {
        content: 'New content',
        createNewVersion: true,
      });

      expect(result).toEqual(newVersionTemplate);
      expect(mockTemplateRepo.createNewVersion).toHaveBeenCalledWith('template-123', {
        title: undefined,
        content: 'New content',
        contentHtml: undefined,
        effectiveDate: undefined,
      });
      expect(mockTemplateRepo.update).not.toHaveBeenCalled();
    });

    it('should update in place when content changes but createNewVersion is false', async () => {
      const updatedTemplate = { ...mockTemplate, content: 'New content' };
      mockTemplateRepo.findById.mockResolvedValue(mockTemplate);
      mockTemplateRepo.update.mockResolvedValue(updatedTemplate);

      const result = await service.updateTemplate('template-123', {
        content: 'New content',
        createNewVersion: false,
      });

      expect(result).toEqual(updatedTemplate);
      expect(mockTemplateRepo.update).toHaveBeenCalled();
      expect(mockTemplateRepo.createNewVersion).not.toHaveBeenCalled();
    });

    it('should return null if template not found', async () => {
      mockTemplateRepo.findById.mockResolvedValue(null);

      const result = await service.updateTemplate('nonexistent', {
        title: 'Updated',
      });

      expect(result).toBeNull();
      expect(mockTemplateRepo.update).not.toHaveBeenCalled();
    });

    it('should not create new version when content is same', async () => {
      mockTemplateRepo.findById.mockResolvedValue(mockTemplate);
      mockTemplateRepo.update.mockResolvedValue(mockTemplate);

      await service.updateTemplate('template-123', {
        content: mockTemplate.content,
        createNewVersion: true,
      });

      expect(mockTemplateRepo.update).toHaveBeenCalled();
      expect(mockTemplateRepo.createNewVersion).not.toHaveBeenCalled();
    });
  });

  describe('activateTemplate', () => {
    it('should activate a template successfully', async () => {
      const activatedTemplate = { ...mockTemplate, isActive: true };
      mockTemplateRepo.activate.mockResolvedValue(activatedTemplate);

      const result = await service.activateTemplate('template-123');

      expect(result).toEqual(activatedTemplate);
      expect(mockTemplateRepo.activate).toHaveBeenCalledWith('template-123');
      expect(logger.info).toHaveBeenCalledWith('Legal template activated', {
        templateId: 'template-123',
        type: 'terms_of_service',
        version: 1,
      });
    });

    it('should return null if template not found', async () => {
      mockTemplateRepo.activate.mockResolvedValue(null);

      const result = await service.activateTemplate('nonexistent');

      expect(result).toBeNull();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should log template details on activation', async () => {
      const template = { ...mockTemplate, version: 3 };
      mockTemplateRepo.activate.mockResolvedValue(template);

      await service.activateTemplate('template-123');

      expect(logger.info).toHaveBeenCalledWith('Legal template activated', {
        templateId: 'template-123',
        type: template.type,
        version: 3,
      });
    });
  });

  describe('deleteTemplate', () => {
    it('should delete a template successfully', async () => {
      mockTemplateRepo.delete.mockResolvedValue(true);

      const result = await service.deleteTemplate('template-123');

      expect(result).toBe(true);
      expect(mockTemplateRepo.delete).toHaveBeenCalledWith('template-123');
    });

    it('should return false when template cannot be deleted', async () => {
      mockTemplateRepo.delete.mockResolvedValue(false);

      const result = await service.deleteTemplate('active-template');

      expect(result).toBe(false);
    });

    it('should propagate deletion errors', async () => {
      mockTemplateRepo.delete.mockRejectedValue(
        new Error('Cannot delete template with existing acceptances')
      );

      await expect(service.deleteTemplate('template-with-acceptances')).rejects.toThrow(
        'Cannot delete template with existing acceptances'
      );
    });
  });

  describe('recordAcceptance', () => {
    it('should record acceptance for all specified types', async () => {
      mockTemplateRepo.findActiveByDeveloperAndType
        .mockResolvedValueOnce(mockTemplate)
        .mockResolvedValueOnce(mockPrivacyTemplate);
      
      const tosAcceptance = { ...mockAcceptance, templateType: 'terms_of_service' as LegalTemplateType };
      const privacyAcceptance = { ...mockAcceptance, templateId: 'template-456', templateType: 'privacy_policy' as LegalTemplateType };
      
      mockTemplateRepo.recordAcceptance
        .mockResolvedValueOnce(tosAcceptance)
        .mockResolvedValueOnce(privacyAcceptance);

      const result = await service.recordAcceptance(
        'cust-123',
        'dev-123',
        ['terms_of_service', 'privacy_policy'],
        { ipAddress: '192.168.1.1', userAgent: 'Mozilla/5.0' }
      );

      expect(result).toHaveLength(2);
      expect(mockTemplateRepo.recordAcceptance).toHaveBeenCalledTimes(2);
    });

    it('should skip types without active templates', async () => {
      mockTemplateRepo.findActiveByDeveloperAndType
        .mockResolvedValueOnce(mockTemplate)
        .mockResolvedValueOnce(null); // No active privacy policy

      mockTemplateRepo.recordAcceptance.mockResolvedValue(mockAcceptance);

      const result = await service.recordAcceptance(
        'cust-123',
        'dev-123',
        ['terms_of_service', 'privacy_policy'],
        {}
      );

      expect(result).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith('No active template for acceptance', {
        developerId: 'dev-123',
        type: 'privacy_policy',
      });
    });

    it('should pass context information to recordAcceptance', async () => {
      mockTemplateRepo.findActiveByDeveloperAndType.mockResolvedValue(mockTemplate);
      mockTemplateRepo.recordAcceptance.mockResolvedValue(mockAcceptance);

      await service.recordAcceptance('cust-123', 'dev-123', ['terms_of_service'], {
        ipAddress: '10.0.0.1',
        userAgent: 'Chrome/100',
      });

      expect(mockTemplateRepo.recordAcceptance).toHaveBeenCalledWith({
        customerId: 'cust-123',
        templateId: 'template-123',
        templateType: 'terms_of_service',
        templateVersion: 1,
        ipAddress: '10.0.0.1',
        userAgent: 'Chrome/100',
      });
    });

    it('should handle empty types array', async () => {
      const result = await service.recordAcceptance('cust-123', 'dev-123', [], {});

      expect(result).toEqual([]);
      expect(mockTemplateRepo.findActiveByDeveloperAndType).not.toHaveBeenCalled();
    });

    it('should handle missing context properties', async () => {
      mockTemplateRepo.findActiveByDeveloperAndType.mockResolvedValue(mockTemplate);
      mockTemplateRepo.recordAcceptance.mockResolvedValue(mockAcceptance);

      await service.recordAcceptance('cust-123', 'dev-123', ['terms_of_service'], {});

      expect(mockTemplateRepo.recordAcceptance).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: undefined,
          userAgent: undefined,
        })
      );
    });
  });

  describe('getCustomerAcceptances', () => {
    it('should return customer acceptance history', async () => {
      const acceptances = [mockAcceptance];
      mockTemplateRepo.getCustomerAcceptances.mockResolvedValue(acceptances);

      const result = await service.getCustomerAcceptances('cust-123');

      expect(result).toEqual(acceptances);
      expect(mockTemplateRepo.getCustomerAcceptances).toHaveBeenCalledWith('cust-123');
    });

    it('should return empty array when no acceptances exist', async () => {
      mockTemplateRepo.getCustomerAcceptances.mockResolvedValue([]);

      const result = await service.getCustomerAcceptances('cust-new');

      expect(result).toEqual([]);
    });
  });

  describe('hasAcceptedAllTerms', () => {
    it('should return true when all terms are accepted', async () => {
      mockTemplateRepo.hasAcceptedLatest.mockResolvedValue(true);

      const result = await service.hasAcceptedAllTerms('cust-123', 'dev-123');

      expect(result.allAccepted).toBe(true);
      expect(result.status.terms_of_service).toBe(true);
      expect(result.status.privacy_policy).toBe(true);
      expect(result.status.refund_policy).toBe(true);
      expect(mockTemplateRepo.hasAcceptedLatest).toHaveBeenCalledTimes(3);
    });

    it('should return false when some terms are not accepted', async () => {
      mockTemplateRepo.hasAcceptedLatest
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const result = await service.hasAcceptedAllTerms('cust-123', 'dev-123');

      expect(result.allAccepted).toBe(false);
      expect(result.status.terms_of_service).toBe(true);
      expect(result.status.privacy_policy).toBe(false);
      expect(result.status.refund_policy).toBe(true);
    });

    it('should return false when no terms are accepted', async () => {
      mockTemplateRepo.hasAcceptedLatest.mockResolvedValue(false);

      const result = await service.hasAcceptedAllTerms('cust-123', 'dev-123');

      expect(result.allAccepted).toBe(false);
      expect(result.status.terms_of_service).toBe(false);
      expect(result.status.privacy_policy).toBe(false);
      expect(result.status.refund_policy).toBe(false);
    });

    it('should check all three template types', async () => {
      mockTemplateRepo.hasAcceptedLatest.mockResolvedValue(true);

      await service.hasAcceptedAllTerms('cust-123', 'dev-123');

      expect(mockTemplateRepo.hasAcceptedLatest).toHaveBeenCalledWith(
        'cust-123',
        'dev-123',
        'terms_of_service'
      );
      expect(mockTemplateRepo.hasAcceptedLatest).toHaveBeenCalledWith(
        'cust-123',
        'dev-123',
        'privacy_policy'
      );
      expect(mockTemplateRepo.hasAcceptedLatest).toHaveBeenCalledWith(
        'cust-123',
        'dev-123',
        'refund_policy'
      );
    });
  });

  describe('getLegalUrls', () => {
    it('should return URLs for all active templates', async () => {
      mockTemplateRepo.findByDeveloperId.mockResolvedValue([
        mockTemplate,
        mockPrivacyTemplate,
        mockRefundTemplate,
      ]);

      const result = await service.getLegalUrls('dev-123', 'https://example.com');

      expect(result.terms_of_service).toBe('https://example.com/legal/dev-123/terms');
      expect(result.privacy_policy).toBe('https://example.com/legal/dev-123/privacy');
      expect(result.refund_policy).toBe('https://example.com/legal/dev-123/refund');
    });

    it('should return null for types without active templates', async () => {
      mockTemplateRepo.findByDeveloperId.mockResolvedValue([mockTemplate]);

      const result = await service.getLegalUrls('dev-123', 'https://example.com');

      expect(result.terms_of_service).toBe('https://example.com/legal/dev-123/terms');
      expect(result.privacy_policy).toBeNull();
      expect(result.refund_policy).toBeNull();
    });

    it('should return all nulls when no active templates exist', async () => {
      mockTemplateRepo.findByDeveloperId.mockResolvedValue([]);

      const result = await service.getLegalUrls('dev-123', 'https://example.com');

      expect(result.terms_of_service).toBeNull();
      expect(result.privacy_policy).toBeNull();
      expect(result.refund_policy).toBeNull();
    });

    it('should handle base URL without trailing slash', async () => {
      mockTemplateRepo.findByDeveloperId.mockResolvedValue([mockTemplate]);

      const result = await service.getLegalUrls('dev-123', 'https://example.com');

      expect(result.terms_of_service).toBe('https://example.com/legal/dev-123/terms');
    });
  });

  describe('notifyTemplateUpdate', () => {
    it('should notify all customers who accepted the template', async () => {
      const customers = [
        { ...mockCustomer, id: 'cust-1', email: 'customer1@example.com' },
        { ...mockCustomer, id: 'cust-2', email: 'customer2@example.com' },
      ];
      mockCustomerRepo.findByDeveloperId.mockResolvedValue(customers);
      mockTemplateRepo.getCustomerAcceptances
        .mockResolvedValueOnce([{ ...mockAcceptance, templateType: 'terms_of_service' }])
        .mockResolvedValueOnce([{ ...mockAcceptance, templateType: 'terms_of_service' }]);
      mockEmailService.send.mockResolvedValue(true);

      const result = await service.notifyTemplateUpdate('dev-123', 'terms_of_service');

      expect(result).toBe(2);
      expect(mockEmailService.send).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith('Legal update notifications sent', {
        developerId: 'dev-123',
        type: 'terms_of_service',
        notifiedCount: 2,
      });
    });

    it('should not notify customers who have not accepted the template', async () => {
      const customers = [mockCustomer];
      mockCustomerRepo.findByDeveloperId.mockResolvedValue(customers);
      mockTemplateRepo.getCustomerAcceptances.mockResolvedValue([
        { ...mockAcceptance, templateType: 'privacy_policy' as LegalTemplateType },
      ]);

      const result = await service.notifyTemplateUpdate('dev-123', 'terms_of_service');

      expect(result).toBe(0);
      expect(mockEmailService.send).not.toHaveBeenCalled();
    });

    it('should skip customers without email', async () => {
      const customerWithoutEmail = { ...mockCustomer, email: null };
      mockCustomerRepo.findByDeveloperId.mockResolvedValue([customerWithoutEmail as any]);
      mockTemplateRepo.getCustomerAcceptances.mockResolvedValue([mockAcceptance]);

      const result = await service.notifyTemplateUpdate('dev-123', 'terms_of_service');

      expect(result).toBe(0);
      expect(mockEmailService.send).not.toHaveBeenCalled();
    });

    it('should handle email sending failures gracefully', async () => {
      const customers = [mockCustomer];
      mockCustomerRepo.findByDeveloperId.mockResolvedValue(customers);
      mockTemplateRepo.getCustomerAcceptances.mockResolvedValue([mockAcceptance]);
      mockEmailService.send.mockRejectedValue(new Error('Email failed'));

      const result = await service.notifyTemplateUpdate('dev-123', 'terms_of_service');

      expect(result).toBe(0);
      expect(logger.error).toHaveBeenCalledWith('Failed to notify customer of legal update', {
        error: expect.any(Error),
        customerId: 'cust-123',
        type: 'terms_of_service',
      });
    });

    it('should use customer name in email when available', async () => {
      const customerWithName = { ...mockCustomer, name: 'John Doe' };
      mockCustomerRepo.findByDeveloperId.mockResolvedValue([customerWithName]);
      mockTemplateRepo.getCustomerAcceptances.mockResolvedValue([mockAcceptance]);
      mockEmailService.send.mockResolvedValue(true);

      await service.notifyTemplateUpdate('dev-123', 'terms_of_service');

      expect(mockEmailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: { email: 'customer@example.com', name: 'John Doe' },
        })
      );
    });

    it('should use email as fallback when name is not available', async () => {
      const customerWithoutName = { ...mockCustomer, name: null };
      mockCustomerRepo.findByDeveloperId.mockResolvedValue([customerWithoutName]);
      mockTemplateRepo.getCustomerAcceptances.mockResolvedValue([mockAcceptance]);
      mockEmailService.send.mockResolvedValue(true);

      await service.notifyTemplateUpdate('dev-123', 'terms_of_service');

      expect(mockEmailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('customer@example.com'),
          text: expect.stringContaining('customer@example.com'),
        })
      );
    });

    it('should return 0 when no customers exist', async () => {
      mockCustomerRepo.findByDeveloperId.mockResolvedValue([]);

      const result = await service.notifyTemplateUpdate('dev-123', 'terms_of_service');

      expect(result).toBe(0);
    });

    it('should send correct subject for each template type', async () => {
      mockCustomerRepo.findByDeveloperId.mockResolvedValue([mockCustomer]);
      mockTemplateRepo.getCustomerAcceptances.mockResolvedValue([
        { ...mockAcceptance, templateType: 'privacy_policy' as LegalTemplateType },
      ]);
      mockEmailService.send.mockResolvedValue(true);

      await service.notifyTemplateUpdate('dev-123', 'privacy_policy');

      expect(mockEmailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Legal Terms Updated - Privacy Policy',
        })
      );
    });

    it('should send correct subject for refund policy', async () => {
      mockCustomerRepo.findByDeveloperId.mockResolvedValue([mockCustomer]);
      mockTemplateRepo.getCustomerAcceptances.mockResolvedValue([
        { ...mockAcceptance, templateType: 'refund_policy' as LegalTemplateType },
      ]);
      mockEmailService.send.mockResolvedValue(true);

      await service.notifyTemplateUpdate('dev-123', 'refund_policy');

      expect(mockEmailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Legal Terms Updated - Refund Policy',
        })
      );
    });
  });

  describe('DEFAULT_TEMPLATES', () => {
    it('should export default templates constant', () => {
      expect(DEFAULT_TEMPLATES).toBeDefined();
      expect(DEFAULT_TEMPLATES.terms_of_service).toBeDefined();
      expect(DEFAULT_TEMPLATES.privacy_policy).toBeDefined();
      expect(DEFAULT_TEMPLATES.refund_policy).toBeDefined();
    });

    it('should have title and content for each template type', () => {
      const types: LegalTemplateType[] = ['terms_of_service', 'privacy_policy', 'refund_policy'];
      
      for (const type of types) {
        expect(DEFAULT_TEMPLATES[type].title).toBeDefined();
        expect(DEFAULT_TEMPLATES[type].content).toBeDefined();
        expect(DEFAULT_TEMPLATES[type].title.length).toBeGreaterThan(0);
        expect(DEFAULT_TEMPLATES[type].content.length).toBeGreaterThan(0);
      }
    });

    it('should contain effective_date placeholder in all default templates', () => {
      expect(DEFAULT_TEMPLATES.terms_of_service.content).toContain('{{effective_date}}');
      expect(DEFAULT_TEMPLATES.privacy_policy.content).toContain('{{effective_date}}');
      expect(DEFAULT_TEMPLATES.refund_policy.content).toContain('{{effective_date}}');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle concurrent acceptance requests', async () => {
      mockTemplateRepo.findActiveByDeveloperAndType.mockResolvedValue(mockTemplate);
      mockTemplateRepo.recordAcceptance.mockResolvedValue(mockAcceptance);

      const promises = [
        service.recordAcceptance('cust-1', 'dev-123', ['terms_of_service'], {}),
        service.recordAcceptance('cust-2', 'dev-123', ['terms_of_service'], {}),
        service.recordAcceptance('cust-3', 'dev-123', ['terms_of_service'], {}),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r).toHaveLength(1));
    });

    it('should handle very long template content', async () => {
      const longContent = 'A'.repeat(100000);
      const templateWithLongContent = { ...mockTemplate, content: longContent };
      mockTemplateRepo.create.mockResolvedValue(templateWithLongContent);

      const result = await service.createTemplate({
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Terms',
        content: longContent,
      });

      expect(result.content).toBe(longContent);
    });

    it('should handle special characters in template content', async () => {
      const specialContent = '# Terms <script>alert("xss")</script> & "quotes" \'single\' $dollar';
      const templateWithSpecialChars = { ...mockTemplate, content: specialContent };
      mockTemplateRepo.create.mockResolvedValue(templateWithSpecialChars);

      const result = await service.createTemplate({
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Terms',
        content: specialContent,
      });

      expect(result.content).toBe(specialContent);
    });

    it('should handle unicode characters in template content', async () => {
      const unicodeContent = '# Términos de Servicio 服务条款 🔒';
      const templateWithUnicode = { ...mockTemplate, content: unicodeContent };
      mockTemplateRepo.create.mockResolvedValue(templateWithUnicode);

      const result = await service.createTemplate({
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Terms',
        content: unicodeContent,
      });

      expect(result.content).toBe(unicodeContent);
    });

    it('should handle repository timeout errors', async () => {
      const timeoutError = new Error('Connection timeout');
      mockTemplateRepo.findById.mockRejectedValue(timeoutError);

      await expect(service.getTemplate('template-123')).rejects.toThrow('Connection timeout');
    });

    it('should handle all template types in recordAcceptance', async () => {
      const types: LegalTemplateType[] = ['terms_of_service', 'privacy_policy', 'refund_policy'];
      
      mockTemplateRepo.findActiveByDeveloperAndType
        .mockResolvedValueOnce(mockTemplate)
        .mockResolvedValueOnce(mockPrivacyTemplate)
        .mockResolvedValueOnce(mockRefundTemplate);
      
      mockTemplateRepo.recordAcceptance.mockResolvedValue(mockAcceptance);

      const result = await service.recordAcceptance('cust-123', 'dev-123', types, {});

      expect(result).toHaveLength(3);
      expect(mockTemplateRepo.findActiveByDeveloperAndType).toHaveBeenCalledTimes(3);
    });

    it('should handle empty customer list in notifyTemplateUpdate', async () => {
      mockCustomerRepo.findByDeveloperId.mockResolvedValue([]);

      const result = await service.notifyTemplateUpdate('dev-123', 'terms_of_service');

      expect(result).toBe(0);
      expect(mockEmailService.send).not.toHaveBeenCalled();
    });

    it('should continue notifying other customers if one fails', async () => {
      const customers = [
        { ...mockCustomer, id: 'cust-1', email: 'customer1@example.com' },
        { ...mockCustomer, id: 'cust-2', email: 'customer2@example.com' },
        { ...mockCustomer, id: 'cust-3', email: 'customer3@example.com' },
      ];
      mockCustomerRepo.findByDeveloperId.mockResolvedValue(customers);
      mockTemplateRepo.getCustomerAcceptances.mockResolvedValue([mockAcceptance]);
      mockEmailService.send
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce(true);

      const result = await service.notifyTemplateUpdate('dev-123', 'terms_of_service');

      expect(result).toBe(2); // 2 successful notifications
      expect(mockEmailService.send).toHaveBeenCalledTimes(3);
    });
  });

  describe('constructor dependency injection', () => {
    it('should use default repositories when not provided', () => {
      // Just ensure the service can be instantiated with defaults
      const defaultService = new LegalTemplateService();
      expect(defaultService).toBeInstanceOf(LegalTemplateService);
    });

    it('should use injected repositories', () => {
      const customRepo = {
        create: jest.fn(),
        findById: jest.fn(),
      };
      const customEmailService = {
        send: jest.fn(),
      };
      const customCustomerRepo = {
        findByDeveloperId: jest.fn(),
      };

      const customService = new LegalTemplateService(
        customRepo as any,
        customEmailService as any,
        customCustomerRepo as any
      );

      expect(customService).toBeInstanceOf(LegalTemplateService);
    });
  });
});
