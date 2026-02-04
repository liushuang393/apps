import express, { Express, NextFunction, Response } from 'express';
import request from 'supertest';

// Mock dependencies before importing the router
jest.mock('../../../services/LegalTemplateService', () => ({
  legalTemplateService: {
    getActiveTemplate: jest.fn(),
    getLegalUrls: jest.fn(),
    getDeveloperTemplates: jest.fn(),
    getTemplate: jest.fn(),
    createTemplate: jest.fn(),
    createDefaultTemplates: jest.fn(),
    updateTemplate: jest.fn(),
    activateTemplate: jest.fn(),
    notifyTemplateUpdate: jest.fn(),
    deleteTemplate: jest.fn(),
    getVersionHistory: jest.fn(),
  },
}));

jest.mock('../../../middleware', () => ({
  apiKeyAuth: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import legalRouter from '../../../routes/legal';
import { legalTemplateService } from '../../../services/LegalTemplateService';
import { apiKeyAuth, AuthenticatedRequest } from '../../../middleware';
import { logger } from '../../../utils/logger';
import { LegalTemplate, LegalTemplateType } from '../../../repositories/LegalTemplateRepository';

const mockLegalTemplateService = legalTemplateService as jest.Mocked<typeof legalTemplateService>;
const mockApiKeyAuth = apiKeyAuth as jest.MockedFunction<typeof apiKeyAuth>;
const mockLogger = logger as jest.Mocked<typeof logger>;

// Increase timeout for this test suite due to route compilation overhead
jest.setTimeout(30000);

describe('Legal Routes', () => {
  let app: Express;

  const mockDeveloper = {
    id: 'dev_test123',
    email: 'test@example.com',
    testMode: true,
    stripeAccountId: null,
    webhookSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTemplate: LegalTemplate = {
    id: 'template_123',
    developerId: 'dev_test123',
    type: 'terms_of_service',
    version: 1,
    title: 'Terms of Service',
    content: '# Terms of Service\n\nThis is the content.',
    contentHtml: '<h1>Terms of Service</h1><p>This is the content.</p>',
    language: 'en',
    isActive: true,
    isDefault: false,
    effectiveDate: new Date('2025-01-01'),
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());

    // Mount the legal router
    app.use('/api/v1/legal', legalRouter);

    // Reset all mocks
    jest.clearAllMocks();

    // Reset apiKeyAuth to attach developer and pass through
    mockApiKeyAuth.mockImplementation(async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      req.developer = mockDeveloper;
      return next();
    });
  });

  // ==================== Public Routes ====================

  describe('GET /api/v1/legal/:developerId/:type', () => {
    describe('Successful Responses', () => {
      it('should return template as HTML by default', async () => {
        mockLegalTemplateService.getActiveTemplate.mockResolvedValue(mockTemplate);

        const response = await request(app)
          .get('/api/v1/legal/dev_test123/terms_of_service');

        expect(response.status).toBe(200);
        expect(response.type).toBe('text/html');
        expect(response.text).toContain('<!DOCTYPE html>');
        expect(response.text).toContain('<title>Terms of Service</title>');
        expect(response.text).toContain('Version 1');
      });

      it('should return template as JSON when format=json', async () => {
        mockLegalTemplateService.getActiveTemplate.mockResolvedValue(mockTemplate);

        const response = await request(app)
          .get('/api/v1/legal/dev_test123/terms_of_service?format=json');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          id: mockTemplate.id,
          type: mockTemplate.type,
          title: mockTemplate.title,
          content: mockTemplate.content,
          version: mockTemplate.version,
          effectiveDate: mockTemplate.effectiveDate?.toISOString(),
          language: mockTemplate.language,
        });
      });

      it('should convert markdown to HTML when contentHtml is null', async () => {
        const templateWithoutHtml = { ...mockTemplate, contentHtml: null };
        mockLegalTemplateService.getActiveTemplate.mockResolvedValue(templateWithoutHtml);

        const response = await request(app)
          .get('/api/v1/legal/dev_test123/terms_of_service');

        expect(response.status).toBe(200);
        expect(response.text).toContain('<h1>Terms of Service</h1>');
      });

      it('should use existing contentHtml when available', async () => {
        mockLegalTemplateService.getActiveTemplate.mockResolvedValue(mockTemplate);

        const response = await request(app)
          .get('/api/v1/legal/dev_test123/terms_of_service');

        expect(response.status).toBe(200);
        expect(response.text).toContain(mockTemplate.contentHtml);
      });

      it('should handle template without effectiveDate', async () => {
        const templateNoDate = { ...mockTemplate, effectiveDate: null };
        mockLegalTemplateService.getActiveTemplate.mockResolvedValue(templateNoDate);

        const response = await request(app)
          .get('/api/v1/legal/dev_test123/terms_of_service');

        expect(response.status).toBe(200);
        expect(response.text).toContain('Effective immediately');
      });

      it('should support all valid template types', async () => {
        const types: LegalTemplateType[] = ['terms_of_service', 'privacy_policy', 'refund_policy'];

        for (const type of types) {
          mockLegalTemplateService.getActiveTemplate.mockResolvedValue({ ...mockTemplate, type });

          const response = await request(app)
            .get(`/api/v1/legal/dev_test123/${type}?format=json`);

          expect(response.status).toBe(200);
          expect(response.body.type).toBe(type);
        }
      });

      it('should set correct HTML lang attribute from template language', async () => {
        const frenchTemplate = { ...mockTemplate, language: 'fr' };
        mockLegalTemplateService.getActiveTemplate.mockResolvedValue(frenchTemplate);

        const response = await request(app)
          .get('/api/v1/legal/dev_test123/terms_of_service');

        expect(response.status).toBe(200);
        expect(response.text).toContain('lang="fr"');
      });
    });

    describe('Error Handling', () => {
      it('should return 400 for invalid template type', async () => {
        const response = await request(app)
          .get('/api/v1/legal/dev_test123/invalid_type');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid template type' });
        expect(mockLegalTemplateService.getActiveTemplate).not.toHaveBeenCalled();
      });

      it('should return 404 when template not found', async () => {
        mockLegalTemplateService.getActiveTemplate.mockResolvedValue(null);

        const response = await request(app)
          .get('/api/v1/legal/dev_test123/terms_of_service');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Template not found' });
      });

      it('should return 500 when service throws error', async () => {
        mockLegalTemplateService.getActiveTemplate.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .get('/api/v1/legal/dev_test123/terms_of_service');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to get template' });
        expect(mockLogger.error).toHaveBeenCalledWith('Error getting public template', { error: expect.any(Error) });
      });
    });
  });

  describe('GET /api/v1/legal/:developerId/urls', () => {
    describe('Successful Responses', () => {
      it('should return legal URLs', async () => {
        const mockUrls = {
          terms_of_service: 'http://localhost/api/v1/legal/dev_test123/terms',
          privacy_policy: 'http://localhost/api/v1/legal/dev_test123/privacy',
          refund_policy: null,
        };
        mockLegalTemplateService.getLegalUrls.mockResolvedValue(mockUrls);

        const response = await request(app)
          .get('/api/v1/legal/dev_test123/urls');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ urls: mockUrls });
      });

      it('should pass correct baseUrl to service', async () => {
        mockLegalTemplateService.getLegalUrls.mockResolvedValue({
          terms_of_service: null,
          privacy_policy: null,
          refund_policy: null,
        });

        await request(app)
          .get('/api/v1/legal/dev_test123/urls');

        expect(mockLegalTemplateService.getLegalUrls).toHaveBeenCalledWith(
          'dev_test123',
          expect.stringContaining('/api/v1/legal')
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when service throws error', async () => {
        mockLegalTemplateService.getLegalUrls.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .get('/api/v1/legal/dev_test123/urls');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to get legal URLs' });
        expect(mockLogger.error).toHaveBeenCalledWith('Error getting legal URLs', { error: expect.any(Error) });
      });
    });
  });

  // ==================== Admin Routes (Authenticated) ====================

  describe('GET /api/v1/legal/admin/templates', () => {
    const templatesResponse = [mockTemplate, { ...mockTemplate, id: 'template_456', type: 'privacy_policy' as LegalTemplateType }];

    describe('Authentication', () => {
      it('should call apiKeyAuth middleware', async () => {
        mockLegalTemplateService.getDeveloperTemplates.mockResolvedValue([]);

        await request(app)
          .get('/api/v1/legal/admin/templates');

        expect(mockApiKeyAuth).toHaveBeenCalled();
      });

      it('should return 401 when API key is missing', async () => {
        mockApiKeyAuth.mockImplementation(async (_req, res) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key. Include x-api-key header.',
              type: 'authentication_error',
            },
          });
        });

        const response = await request(app)
          .get('/api/v1/legal/admin/templates');

        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('unauthorized');
      });
    });

    describe('Successful Responses', () => {
      it('should return all templates for developer', async () => {
        mockLegalTemplateService.getDeveloperTemplates.mockResolvedValue(templatesResponse);

        const response = await request(app)
          .get('/api/v1/legal/admin/templates')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(200);
        expect(response.body.templates).toHaveLength(2);
        expect(response.body.templates[0]).toHaveProperty('id');
        expect(response.body.templates[0]).toHaveProperty('type');
        expect(response.body.templates[0]).toHaveProperty('version');
        expect(response.body.templates[0]).toHaveProperty('title');
        expect(response.body.templates[0]).toHaveProperty('isActive');
        expect(response.body.templates[0]).not.toHaveProperty('content'); // Should not include content in list
      });

      it('should filter by type when provided', async () => {
        mockLegalTemplateService.getDeveloperTemplates.mockResolvedValue([mockTemplate]);

        const response = await request(app)
          .get('/api/v1/legal/admin/templates?type=terms_of_service')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(200);
        expect(mockLegalTemplateService.getDeveloperTemplates).toHaveBeenCalledWith(
          mockDeveloper.id,
          'terms_of_service'
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 400 for invalid template type filter', async () => {
        const response = await request(app)
          .get('/api/v1/legal/admin/templates?type=invalid_type')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid template type' });
      });

      it('should return 500 when service throws error', async () => {
        mockLegalTemplateService.getDeveloperTemplates.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .get('/api/v1/legal/admin/templates')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to get templates' });
      });
    });
  });

  describe('GET /api/v1/legal/admin/templates/:id', () => {
    describe('Successful Responses', () => {
      it('should return template by id', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(mockTemplate);

        const response = await request(app)
          .get('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(200);
        expect(response.body.template).toEqual(expect.objectContaining({
          id: mockTemplate.id,
          type: mockTemplate.type,
        }));
      });
    });

    describe('Error Handling', () => {
      it('should return 404 when template not found', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(null);

        const response = await request(app)
          .get('/api/v1/legal/admin/templates/nonexistent')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Template not found' });
      });

      it('should return 403 when template belongs to another developer', async () => {
        const otherDeveloperTemplate = { ...mockTemplate, developerId: 'other_dev_456' };
        mockLegalTemplateService.getTemplate.mockResolvedValue(otherDeveloperTemplate);

        const response = await request(app)
          .get('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Access denied' });
      });

      it('should return 500 when service throws error', async () => {
        mockLegalTemplateService.getTemplate.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .get('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to get template' });
      });
    });
  });

  describe('POST /api/v1/legal/admin/templates', () => {
    const validTemplateData = {
      type: 'terms_of_service',
      title: 'Terms of Service',
      content: '# Terms\n\nContent here.',
    };

    describe('Successful Responses', () => {
      it('should create a new template', async () => {
        mockLegalTemplateService.createTemplate.mockResolvedValue(mockTemplate);

        const response = await request(app)
          .post('/api/v1/legal/admin/templates')
          .set('x-api-key', 'test_api_key')
          .send(validTemplateData);

        expect(response.status).toBe(201);
        expect(response.body.template).toBeDefined();
        expect(mockLegalTemplateService.createTemplate).toHaveBeenCalledWith({
          developerId: mockDeveloper.id,
          type: 'terms_of_service',
          title: 'Terms of Service',
          content: '# Terms\n\nContent here.',
          contentHtml: undefined,
          language: undefined,
          effectiveDate: undefined,
        });
      });

      it('should create template with optional fields', async () => {
        mockLegalTemplateService.createTemplate.mockResolvedValue(mockTemplate);

        const response = await request(app)
          .post('/api/v1/legal/admin/templates')
          .set('x-api-key', 'test_api_key')
          .send({
            ...validTemplateData,
            contentHtml: '<h1>Terms</h1>',
            language: 'fr',
            effectiveDate: '2025-06-01',
          });

        expect(response.status).toBe(201);
        expect(mockLegalTemplateService.createTemplate).toHaveBeenCalledWith(
          expect.objectContaining({
            contentHtml: '<h1>Terms</h1>',
            language: 'fr',
            effectiveDate: expect.any(Date),
          })
        );
      });
    });

    describe('Validation', () => {
      it('should return 400 when type is missing', async () => {
        const response = await request(app)
          .post('/api/v1/legal/admin/templates')
          .set('x-api-key', 'test_api_key')
          .send({ title: 'Title', content: 'Content' });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid or missing template type' });
      });

      it('should return 400 for invalid template type', async () => {
        const response = await request(app)
          .post('/api/v1/legal/admin/templates')
          .set('x-api-key', 'test_api_key')
          .send({ ...validTemplateData, type: 'invalid_type' });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid or missing template type' });
      });

      it('should return 400 when title is missing', async () => {
        const response = await request(app)
          .post('/api/v1/legal/admin/templates')
          .set('x-api-key', 'test_api_key')
          .send({ type: 'terms_of_service', content: 'Content' });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Title and content are required' });
      });

      it('should return 400 when content is missing', async () => {
        const response = await request(app)
          .post('/api/v1/legal/admin/templates')
          .set('x-api-key', 'test_api_key')
          .send({ type: 'terms_of_service', title: 'Title' });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Title and content are required' });
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when service throws error', async () => {
        mockLegalTemplateService.createTemplate.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .post('/api/v1/legal/admin/templates')
          .set('x-api-key', 'test_api_key')
          .send(validTemplateData);

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to create template' });
      });
    });
  });

  describe('POST /api/v1/legal/admin/templates/defaults', () => {
    const defaultTemplates = [
      { ...mockTemplate, id: 'default_1', type: 'terms_of_service' as LegalTemplateType, isDefault: true },
      { ...mockTemplate, id: 'default_2', type: 'privacy_policy' as LegalTemplateType, isDefault: true },
      { ...mockTemplate, id: 'default_3', type: 'refund_policy' as LegalTemplateType, isDefault: true },
    ];

    describe('Successful Responses', () => {
      it('should create default templates', async () => {
        mockLegalTemplateService.createDefaultTemplates.mockResolvedValue(defaultTemplates);

        const response = await request(app)
          .post('/api/v1/legal/admin/templates/defaults')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(201);
        expect(response.body.message).toBe('Default templates created');
        expect(response.body.templates).toHaveLength(3);
        expect(mockLegalTemplateService.createDefaultTemplates).toHaveBeenCalledWith(mockDeveloper.id);
      });

      it('should return template summaries without full content', async () => {
        mockLegalTemplateService.createDefaultTemplates.mockResolvedValue(defaultTemplates);

        const response = await request(app)
          .post('/api/v1/legal/admin/templates/defaults')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(201);
        expect(response.body.templates[0]).toHaveProperty('id');
        expect(response.body.templates[0]).toHaveProperty('type');
        expect(response.body.templates[0]).toHaveProperty('title');
        expect(response.body.templates[0]).toHaveProperty('version');
        expect(response.body.templates[0]).not.toHaveProperty('content');
      });
    });

    describe('Error Handling', () => {
      it('should return 500 when service throws error', async () => {
        mockLegalTemplateService.createDefaultTemplates.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .post('/api/v1/legal/admin/templates/defaults')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to create default templates' });
      });
    });
  });

  describe('PUT /api/v1/legal/admin/templates/:id', () => {
    const updateData = {
      title: 'Updated Terms',
      content: '# Updated Terms\n\nNew content.',
    };

    describe('Successful Responses', () => {
      it('should update template', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(mockTemplate);
        const updatedTemplate = { ...mockTemplate, ...updateData };
        mockLegalTemplateService.updateTemplate.mockResolvedValue(updatedTemplate);

        const response = await request(app)
          .put('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key')
          .send(updateData);

        expect(response.status).toBe(200);
        expect(response.body.template.title).toBe('Updated Terms');
      });

      it('should pass createNewVersion flag to service', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(mockTemplate);
        mockLegalTemplateService.updateTemplate.mockResolvedValue({ ...mockTemplate, version: 2 });

        await request(app)
          .put('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key')
          .send({ ...updateData, createNewVersion: true });

        expect(mockLegalTemplateService.updateTemplate).toHaveBeenCalledWith(
          'template_123',
          expect.objectContaining({ createNewVersion: true })
        );
      });

      it('should handle effectiveDate update', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(mockTemplate);
        mockLegalTemplateService.updateTemplate.mockResolvedValue(mockTemplate);

        await request(app)
          .put('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key')
          .send({ effectiveDate: '2025-12-01' });

        expect(mockLegalTemplateService.updateTemplate).toHaveBeenCalledWith(
          'template_123',
          expect.objectContaining({ effectiveDate: expect.any(Date) })
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 404 when template not found', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(null);

        const response = await request(app)
          .put('/api/v1/legal/admin/templates/nonexistent')
          .set('x-api-key', 'test_api_key')
          .send(updateData);

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Template not found' });
      });

      it('should return 403 when template belongs to another developer', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue({ ...mockTemplate, developerId: 'other_dev' });

        const response = await request(app)
          .put('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key')
          .send(updateData);

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Access denied' });
      });

      it('should return 500 when service throws error', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(mockTemplate);
        mockLegalTemplateService.updateTemplate.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .put('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key')
          .send(updateData);

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to update template' });
      });
    });
  });

  describe('POST /api/v1/legal/admin/templates/:id/activate', () => {
    describe('Successful Responses', () => {
      it('should activate template', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(mockTemplate);
        const activatedTemplate = { ...mockTemplate, isActive: true };
        mockLegalTemplateService.activateTemplate.mockResolvedValue(activatedTemplate);

        const response = await request(app)
          .post('/api/v1/legal/admin/templates/template_123/activate')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(200);
        expect(response.body.template).toBeDefined();
        expect(response.body.notifiedCount).toBe(0);
      });

      it('should notify customers when requested', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(mockTemplate);
        mockLegalTemplateService.activateTemplate.mockResolvedValue(mockTemplate);
        mockLegalTemplateService.notifyTemplateUpdate.mockResolvedValue(5);

        const response = await request(app)
          .post('/api/v1/legal/admin/templates/template_123/activate')
          .set('x-api-key', 'test_api_key')
          .send({ notifyCustomers: true });

        expect(response.status).toBe(200);
        expect(response.body.notifiedCount).toBe(5);
        expect(mockLegalTemplateService.notifyTemplateUpdate).toHaveBeenCalledWith(
          mockDeveloper.id,
          mockTemplate.type
        );
      });

      it('should not notify customers when not requested', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(mockTemplate);
        mockLegalTemplateService.activateTemplate.mockResolvedValue(mockTemplate);

        await request(app)
          .post('/api/v1/legal/admin/templates/template_123/activate')
          .set('x-api-key', 'test_api_key')
          .send({ notifyCustomers: false });

        expect(mockLegalTemplateService.notifyTemplateUpdate).not.toHaveBeenCalled();
      });
    });

    describe('Error Handling', () => {
      it('should return 404 when template not found', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(null);

        const response = await request(app)
          .post('/api/v1/legal/admin/templates/nonexistent/activate')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Template not found' });
      });

      it('should return 403 when template belongs to another developer', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue({ ...mockTemplate, developerId: 'other_dev' });

        const response = await request(app)
          .post('/api/v1/legal/admin/templates/template_123/activate')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Access denied' });
      });

      it('should return 500 when service throws error', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(mockTemplate);
        mockLegalTemplateService.activateTemplate.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .post('/api/v1/legal/admin/templates/template_123/activate')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to activate template' });
      });
    });
  });

  describe('DELETE /api/v1/legal/admin/templates/:id', () => {
    describe('Successful Responses', () => {
      it('should delete inactive template', async () => {
        const inactiveTemplate = { ...mockTemplate, isActive: false };
        mockLegalTemplateService.getTemplate.mockResolvedValue(inactiveTemplate);
        mockLegalTemplateService.deleteTemplate.mockResolvedValue(true);

        const response = await request(app)
          .delete('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
      });
    });

    describe('Error Handling', () => {
      it('should return 404 when template not found', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue(null);

        const response = await request(app)
          .delete('/api/v1/legal/admin/templates/nonexistent')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: 'Template not found' });
      });

      it('should return 403 when template belongs to another developer', async () => {
        mockLegalTemplateService.getTemplate.mockResolvedValue({ ...mockTemplate, developerId: 'other_dev' });

        const response = await request(app)
          .delete('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Access denied' });
      });

      it('should return 400 when trying to delete active template', async () => {
        const activeTemplate = { ...mockTemplate, isActive: true };
        mockLegalTemplateService.getTemplate.mockResolvedValue(activeTemplate);

        const response = await request(app)
          .delete('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Cannot delete active template' });
      });

      it('should return 400 when delete fails (has acceptances)', async () => {
        const inactiveTemplate = { ...mockTemplate, isActive: false };
        mockLegalTemplateService.getTemplate.mockResolvedValue(inactiveTemplate);
        mockLegalTemplateService.deleteTemplate.mockResolvedValue(false);

        const response = await request(app)
          .delete('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Template could not be deleted (may have acceptances)' });
      });

      it('should return 500 when service throws error', async () => {
        const inactiveTemplate = { ...mockTemplate, isActive: false };
        mockLegalTemplateService.getTemplate.mockResolvedValue(inactiveTemplate);
        mockLegalTemplateService.deleteTemplate.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .delete('/api/v1/legal/admin/templates/template_123')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to delete template' });
      });
    });
  });

  describe('GET /api/v1/legal/admin/templates/:type/history', () => {
    const historyTemplates = [
      { ...mockTemplate, version: 2, isActive: true },
      { ...mockTemplate, id: 'template_v1', version: 1, isActive: false },
    ];

    describe('Successful Responses', () => {
      it('should return version history', async () => {
        mockLegalTemplateService.getVersionHistory.mockResolvedValue(historyTemplates);

        const response = await request(app)
          .get('/api/v1/legal/admin/templates/terms_of_service/history')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(200);
        expect(response.body.history).toHaveLength(2);
        expect(response.body.history[0]).toHaveProperty('id');
        expect(response.body.history[0]).toHaveProperty('version');
        expect(response.body.history[0]).toHaveProperty('title');
        expect(response.body.history[0]).toHaveProperty('isActive');
        expect(response.body.history[0]).not.toHaveProperty('content');
      });

      it('should call service with correct parameters', async () => {
        mockLegalTemplateService.getVersionHistory.mockResolvedValue([]);

        await request(app)
          .get('/api/v1/legal/admin/templates/privacy_policy/history')
          .set('x-api-key', 'test_api_key');

        expect(mockLegalTemplateService.getVersionHistory).toHaveBeenCalledWith(
          mockDeveloper.id,
          'privacy_policy'
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 400 for invalid template type', async () => {
        const response = await request(app)
          .get('/api/v1/legal/admin/templates/invalid_type/history')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid template type' });
      });

      it('should return 500 when service throws error', async () => {
        mockLegalTemplateService.getVersionHistory.mockRejectedValue(new Error('Database error'));

        const response = await request(app)
          .get('/api/v1/legal/admin/templates/terms_of_service/history')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: 'Failed to get version history' });
      });
    });
  });

  // ==================== Markdown to HTML Conversion Tests ====================

  describe('Markdown to HTML Conversion', () => {
    beforeEach(() => {
      // Always return template without pre-rendered HTML to test markdown conversion
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue({
        ...mockTemplate,
        contentHtml: null,
      });
    });

    it('should convert h1 markdown to HTML', async () => {
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue({
        ...mockTemplate,
        content: '# Heading 1',
        contentHtml: null,
      });

      const response = await request(app)
        .get('/api/v1/legal/dev_test123/terms_of_service');

      expect(response.text).toContain('<h1>Heading 1</h1>');
    });

    it('should convert h2 markdown to HTML', async () => {
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue({
        ...mockTemplate,
        content: '## Heading 2',
        contentHtml: null,
      });

      const response = await request(app)
        .get('/api/v1/legal/dev_test123/terms_of_service');

      expect(response.text).toContain('<h2>Heading 2</h2>');
    });

    it('should convert h3 markdown to HTML', async () => {
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue({
        ...mockTemplate,
        content: '### Heading 3',
        contentHtml: null,
      });

      const response = await request(app)
        .get('/api/v1/legal/dev_test123/terms_of_service');

      expect(response.text).toContain('<h3>Heading 3</h3>');
    });

    it('should convert bold markdown to HTML', async () => {
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue({
        ...mockTemplate,
        content: '**bold text**',
        contentHtml: null,
      });

      const response = await request(app)
        .get('/api/v1/legal/dev_test123/terms_of_service');

      expect(response.text).toContain('<strong>bold text</strong>');
    });

    it('should convert italic markdown to HTML', async () => {
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue({
        ...mockTemplate,
        content: '*italic text*',
        contentHtml: null,
      });

      const response = await request(app)
        .get('/api/v1/legal/dev_test123/terms_of_service');

      expect(response.text).toContain('<em>italic text</em>');
    });

    it('should convert list items to HTML', async () => {
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue({
        ...mockTemplate,
        content: '- List item 1\n- List item 2',
        contentHtml: null,
      });

      const response = await request(app)
        .get('/api/v1/legal/dev_test123/terms_of_service');

      expect(response.text).toContain('<li>List item 1</li>');
      expect(response.text).toContain('<li>List item 2</li>');
    });

    it('should preserve existing HTML tags in markdown', async () => {
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue({
        ...mockTemplate,
        content: '<div>Existing HTML</div>',
        contentHtml: null,
      });

      const response = await request(app)
        .get('/api/v1/legal/dev_test123/terms_of_service');

      expect(response.text).toContain('<div>Existing HTML</div>');
    });

    it('should wrap plain text in paragraph tags', async () => {
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue({
        ...mockTemplate,
        content: 'Plain text without markdown syntax',
        contentHtml: null,
      });

      const response = await request(app)
        .get('/api/v1/legal/dev_test123/terms_of_service');

      expect(response.text).toContain('<p>Plain text without markdown syntax</p>');
    });
  });

  // ==================== Route Configuration Tests ====================

  describe('Route Configuration', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/api/v1/legal/unknown/route/here');

      expect(response.status).toBe(404);
    });

    it('should handle OPTIONS requests for CORS preflight', async () => {
      const response = await request(app)
        .options('/api/v1/legal/dev_test123/terms_of_service');

      // Express default behavior - either 200 or 204 depending on CORS setup
      expect([200, 204, 404]).toContain(response.status);
    });
  });

  // ==================== Edge Cases ====================

  describe('Edge Cases', () => {
    it('should handle template with special characters in content', async () => {
      const specialTemplate = {
        ...mockTemplate,
        title: 'Terms & Conditions <script>',
        content: '# Terms & Conditions\n\nContent with <html> tags & special "chars"',
        contentHtml: null,
      };
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue(specialTemplate);

      const response = await request(app)
        .get('/api/v1/legal/dev_test123/terms_of_service');

      expect(response.status).toBe(200);
      // HTML should still be rendered
      expect(response.type).toBe('text/html');
    });

    it('should handle empty developer ID parameter', async () => {
      const response = await request(app)
        .get('/api/v1/legal//terms_of_service');

      // Express will match this as developerId="" which may 404 or return error
      expect([400, 404]).toContain(response.status);
    });

    it('should handle concurrent requests to same endpoint', async () => {
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue(mockTemplate);

      const requests = Array(5).fill(null).map(() =>
        request(app)
          .get('/api/v1/legal/dev_test123/terms_of_service?format=json')
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.type).toBe('terms_of_service');
      });

      expect(mockLegalTemplateService.getActiveTemplate).toHaveBeenCalledTimes(5);
    });

    it('should handle very long content', async () => {
      const longContent = '# Terms\n\n' + 'Lorem ipsum '.repeat(10000);
      mockLegalTemplateService.getActiveTemplate.mockResolvedValue({
        ...mockTemplate,
        content: longContent,
        contentHtml: null,
      });

      const response = await request(app)
        .get('/api/v1/legal/dev_test123/terms_of_service');

      expect(response.status).toBe(200);
      expect(response.text.length).toBeGreaterThan(100000);
    });
  });
});
