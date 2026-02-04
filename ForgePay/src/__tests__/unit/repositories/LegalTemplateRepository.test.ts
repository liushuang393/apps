import {
  LegalTemplateRepository,
  CreateLegalTemplateParams,
  UpdateLegalTemplateParams,
  RecordAcceptanceParams,
  LegalTemplateType,
} from '../../../repositories/LegalTemplateRepository';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('LegalTemplateRepository', () => {
  let mockPool: any;
  let repository: LegalTemplateRepository;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    repository = new LegalTemplateRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new legal template with all fields', async () => {
      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Terms of Service',
        content: 'These are the terms...',
        contentHtml: '<p>These are the terms...</p>',
        language: 'en',
        isDefault: true,
        effectiveDate: new Date('2024-06-01'),
        metadata: { version: 'v1.0', author: 'Legal Team' },
      };

      const mockRow = {
        id: 'template-123',
        developer_id: params.developerId,
        type: params.type,
        version: 1,
        title: params.title,
        content: params.content,
        content_html: params.contentHtml,
        language: params.language,
        is_active: true,
        is_default: params.isDefault,
        effective_date: params.effectiveDate,
        metadata: params.metadata,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      // First query: get next version
      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      // Second query: insert
      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'template-123',
        developerId: params.developerId,
        type: params.type,
        version: 1,
        title: params.title,
        content: params.content,
        contentHtml: params.contentHtml,
        language: params.language,
        isActive: true,
        isDefault: params.isDefault,
        effectiveDate: params.effectiveDate,
        metadata: params.metadata,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT COALESCE(MAX(version), 0) + 1'),
        [params.developerId, params.type]
      );
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO legal_templates'),
        [
          params.developerId,
          params.type,
          1,
          params.title,
          params.content,
          params.contentHtml,
          params.language,
          true, // isActive (first of type)
          params.isDefault,
          params.effectiveDate,
          JSON.stringify(params.metadata),
        ]
      );
    });

    it('should create a template with minimal fields and default values', async () => {
      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'privacy_policy',
        title: 'Privacy Policy',
        content: 'Privacy content...',
      };

      const mockRow = {
        id: 'template-456',
        developer_id: params.developerId,
        type: params.type,
        version: 1,
        title: params.title,
        content: params.content,
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.contentHtml).toBeNull();
      expect(result.language).toBe('en');
      expect(result.isDefault).toBe(false);
      expect(result.effectiveDate).toBeNull();
      expect(result.metadata).toBeNull();
      expect(result.isActive).toBe(true); // First of type is active
    });

    it('should auto-increment version for existing template type', async () => {
      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Updated Terms',
        content: 'New terms content...',
      };

      const mockRow = {
        id: 'template-789',
        developer_id: params.developerId,
        type: params.type,
        version: 3,
        title: params.title,
        content: params.content,
        content_html: null,
        language: 'en',
        is_active: false, // Not first of type
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 3 }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.version).toBe(3);
      expect(result.isActive).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Terms',
        content: 'Content',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow('Database connection failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'refund_policy',
        title: 'Refund Policy',
        content: 'Refund content...',
      };

      const mockRow = {
        id: 'template-tx',
        developer_id: params.developerId,
        type: params.type,
        version: 1,
        title: params.title,
        content: params.content,
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params, mockClient);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('createNewVersion', () => {
    it('should create a new version of an existing template', async () => {
      const existingTemplate = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Original Terms',
        content: 'Original content',
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: { key: 'value' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      const newVersionRow = {
        id: 'template-124',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 2,
        title: 'Updated Terms',
        content: 'New content',
        content_html: '<p>New content</p>',
        language: 'en',
        is_active: false,
        is_default: false,
        effective_date: new Date('2024-06-01'),
        metadata: { key: 'value' },
        created_at: new Date('2024-02-01'),
        updated_at: new Date('2024-02-01'),
      };

      // findById
      mockPool.query.mockResolvedValueOnce({
        rows: [existingTemplate],
        rowCount: 1,
      } as any);

      // get next version
      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 2 }],
        rowCount: 1,
      } as any);

      // insert
      mockPool.query.mockResolvedValueOnce({
        rows: [newVersionRow],
        rowCount: 1,
      } as any);

      const result = await repository.createNewVersion('template-123', {
        title: 'Updated Terms',
        content: 'New content',
        contentHtml: '<p>New content</p>',
        effectiveDate: new Date('2024-06-01'),
      });

      expect(result.version).toBe(2);
      expect(result.title).toBe('Updated Terms');
      expect(result.content).toBe('New content');
    });

    it('should throw error if template not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await expect(
        repository.createNewVersion('nonexistent', { content: 'New content' })
      ).rejects.toThrow('Template not found');
    });

    it('should preserve original title if not provided', async () => {
      const existingTemplate = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'privacy_policy',
        version: 1,
        title: 'Original Title',
        content: 'Original content',
        content_html: null,
        language: 'fr',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      const newVersionRow = {
        id: 'template-125',
        developer_id: 'dev-123',
        type: 'privacy_policy',
        version: 2,
        title: 'Original Title',
        content: 'Updated content',
        content_html: null,
        language: 'fr',
        is_active: false,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-02-01'),
        updated_at: new Date('2024-02-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [existingTemplate],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 2 }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [newVersionRow],
        rowCount: 1,
      } as any);

      const result = await repository.createNewVersion('template-123', {
        content: 'Updated content',
      });

      expect(result.title).toBe('Original Title');
      expect(result.language).toBe('fr');
    });
  });

  describe('findById', () => {
    it('should find a template by ID', async () => {
      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms of Service',
        content: 'Content here',
        content_html: '<p>Content here</p>',
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: new Date('2024-06-01'),
        metadata: { key: 'value' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('template-123');

      expect(result).toEqual({
        id: 'template-123',
        developerId: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms of Service',
        content: 'Content here',
        contentHtml: '<p>Content here</p>',
        language: 'en',
        isActive: true,
        isDefault: false,
        effectiveDate: new Date('2024-06-01'),
        metadata: { key: 'value' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM legal_templates WHERE id = $1'),
        ['template-123']
      );
    });

    it('should return null if template not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findById('template-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.findById('template-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findActiveByDeveloperAndType', () => {
    it('should find active template by developer and type', async () => {
      const mockRow = {
        id: 'template-active',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 2,
        title: 'Active Terms',
        content: 'Active content',
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findActiveByDeveloperAndType('dev-123', 'terms_of_service');

      expect(result).not.toBeNull();
      expect(result?.isActive).toBe(true);
      expect(result?.type).toBe('terms_of_service');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE developer_id = $1 AND type = $2 AND is_active = true'),
        ['dev-123', 'terms_of_service']
      );
    });

    it('should return null if no active template found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findActiveByDeveloperAndType('dev-123', 'privacy_policy');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(
        repository.findActiveByDeveloperAndType('dev-123', 'terms_of_service')
      ).rejects.toThrow('Query failed');
    });
  });

  describe('findByDeveloperId', () => {
    it('should find all templates for a developer', async () => {
      const mockRows = [
        {
          id: 'template-1',
          developer_id: 'dev-123',
          type: 'terms_of_service',
          version: 2,
          title: 'Terms v2',
          content: 'Content v2',
          content_html: null,
          language: 'en',
          is_active: true,
          is_default: false,
          effective_date: null,
          metadata: null,
          created_at: new Date('2024-02-01'),
          updated_at: new Date('2024-02-01'),
        },
        {
          id: 'template-2',
          developer_id: 'dev-123',
          type: 'terms_of_service',
          version: 1,
          title: 'Terms v1',
          content: 'Content v1',
          content_html: null,
          language: 'en',
          is_active: false,
          is_default: false,
          effective_date: null,
          metadata: null,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
        {
          id: 'template-3',
          developer_id: 'dev-123',
          type: 'privacy_policy',
          version: 1,
          title: 'Privacy',
          content: 'Privacy content',
          content_html: null,
          language: 'en',
          is_active: true,
          is_default: false,
          effective_date: null,
          metadata: null,
          created_at: new Date('2024-01-15'),
          updated_at: new Date('2024-01-15'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 3,
      } as any);

      const result = await repository.findByDeveloperId('dev-123');

      expect(result).toHaveLength(3);
      expect(result[0].developerId).toBe('dev-123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE developer_id = $1'),
        ['dev-123']
      );
    });

    it('should filter by type when option provided', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123', { type: 'privacy_policy' });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND type = $2'),
        ['dev-123', 'privacy_policy']
      );
    });

    it('should filter by active only when option provided', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123', { activeOnly: true });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND is_active = true'),
        ['dev-123']
      );
    });

    it('should filter by both type and activeOnly', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123', {
        type: 'terms_of_service',
        activeOnly: true,
      });

      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('AND type = $2');
      expect(query).toContain('AND is_active = true');
    });

    it('should return empty array if no templates found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByDeveloperId('dev-empty');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByDeveloperId('dev-123')).rejects.toThrow('Query failed');
    });
  });

  describe('findVersionHistory', () => {
    it('should find all versions of a template type', async () => {
      const mockRows = [
        {
          id: 'template-v3',
          developer_id: 'dev-123',
          type: 'terms_of_service',
          version: 3,
          title: 'Terms v3',
          content: 'Content v3',
          content_html: null,
          language: 'en',
          is_active: true,
          is_default: false,
          effective_date: null,
          metadata: null,
          created_at: new Date('2024-03-01'),
          updated_at: new Date('2024-03-01'),
        },
        {
          id: 'template-v2',
          developer_id: 'dev-123',
          type: 'terms_of_service',
          version: 2,
          title: 'Terms v2',
          content: 'Content v2',
          content_html: null,
          language: 'en',
          is_active: false,
          is_default: false,
          effective_date: null,
          metadata: null,
          created_at: new Date('2024-02-01'),
          updated_at: new Date('2024-02-01'),
        },
        {
          id: 'template-v1',
          developer_id: 'dev-123',
          type: 'terms_of_service',
          version: 1,
          title: 'Terms v1',
          content: 'Content v1',
          content_html: null,
          language: 'en',
          is_active: false,
          is_default: false,
          effective_date: null,
          metadata: null,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 3,
      } as any);

      const result = await repository.findVersionHistory('dev-123', 'terms_of_service');

      expect(result).toHaveLength(3);
      expect(result[0].version).toBe(3);
      expect(result[1].version).toBe(2);
      expect(result[2].version).toBe(1);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY version DESC'),
        ['dev-123', 'terms_of_service']
      );
    });

    it('should return empty array if no versions found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findVersionHistory('dev-123', 'refund_policy');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(
        repository.findVersionHistory('dev-123', 'terms_of_service')
      ).rejects.toThrow('Query failed');
    });
  });

  describe('activate', () => {
    it('should activate a template and deactivate others of same type', async () => {
      const mockTemplate = {
        id: 'template-v2',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 2,
        title: 'Terms v2',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: false,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      const activatedTemplate = {
        ...mockTemplate,
        is_active: true,
        updated_at: new Date('2024-02-01'),
      };

      // findById
      mockPool.query.mockResolvedValueOnce({
        rows: [mockTemplate],
        rowCount: 1,
      } as any);

      // deactivate others
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 2,
      } as any);

      // activate this one
      mockPool.query.mockResolvedValueOnce({
        rows: [activatedTemplate],
        rowCount: 1,
      } as any);

      const result = await repository.activate('template-v2');

      expect(result).not.toBeNull();
      expect(result?.isActive).toBe(true);
      expect(mockPool.query).toHaveBeenCalledTimes(3);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SET is_active = false'),
        ['dev-123', 'terms_of_service', 'template-v2']
      );
    });

    it('should return null if template not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.activate('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null if update fails', async () => {
      const mockTemplate = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: false,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockTemplate],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.activate('template-123');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const mockTemplate = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: false,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockTemplate],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.activate('template-123')).rejects.toThrow('Update failed');
    });
  });

  describe('update', () => {
    it('should update template title', async () => {
      const params: UpdateLegalTemplateParams = {
        title: 'Updated Title',
      };

      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Updated Title',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('template-123', params);

      expect(result?.title).toBe('Updated Title');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE legal_templates'),
        ['Updated Title', 'template-123']
      );
    });

    it('should update template content', async () => {
      const params: UpdateLegalTemplateParams = {
        content: 'New content',
        contentHtml: '<p>New content</p>',
      };

      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'New content',
        content_html: '<p>New content</p>',
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('template-123', params);

      expect(result?.content).toBe('New content');
      expect(result?.contentHtml).toBe('<p>New content</p>');
    });

    it('should update template language', async () => {
      const params: UpdateLegalTemplateParams = {
        language: 'fr',
      };

      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'Content',
        content_html: null,
        language: 'fr',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('template-123', params);

      expect(result?.language).toBe('fr');
    });

    it('should update template effectiveDate', async () => {
      const effectiveDate = new Date('2024-06-01');
      const params: UpdateLegalTemplateParams = {
        effectiveDate,
      };

      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: effectiveDate,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('template-123', params);

      expect(result?.effectiveDate).toEqual(effectiveDate);
    });

    it('should update template metadata', async () => {
      const params: UpdateLegalTemplateParams = {
        metadata: { updated: true, version: '2.0' },
      };

      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: { updated: true, version: '2.0' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('template-123', params);

      expect(result?.metadata).toEqual({ updated: true, version: '2.0' });
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE legal_templates'),
        [JSON.stringify(params.metadata), 'template-123']
      );
    });

    it('should update multiple fields at once', async () => {
      const params: UpdateLegalTemplateParams = {
        title: 'New Title',
        content: 'New Content',
        language: 'de',
        metadata: { key: 'value' },
      };

      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'New Title',
        content: 'New Content',
        content_html: null,
        language: 'de',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: { key: 'value' },
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('template-123', params);

      expect(result?.title).toBe('New Title');
      expect(result?.content).toBe('New Content');
      expect(result?.language).toBe('de');
      expect(result?.metadata).toEqual({ key: 'value' });
    });

    it('should return null if template not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.update('nonexistent', { title: 'New Title' });

      expect(result).toBeNull();
    });

    it('should return existing template if no updates provided', async () => {
      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.update('template-123', {});

      expect(result).not.toBeNull();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM legal_templates'),
        ['template-123']
      );
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(
        repository.update('template-123', { title: 'New Title' })
      ).rejects.toThrow('Update failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Updated',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.update('template-123', { title: 'Updated' }, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a template without acceptances', async () => {
      // Check acceptances
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as any);

      // Delete
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      const result = await repository.delete('template-123');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('SELECT COUNT(*) as count FROM customer_legal_acceptances'),
        ['template-123']
      );
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('DELETE FROM legal_templates'),
        ['template-123']
      );
    });

    it('should throw error if template has acceptances', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      } as any);

      await expect(repository.delete('template-123')).rejects.toThrow(
        'Cannot delete template with existing acceptances'
      );
    });

    it('should return false if template not found or is active', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.delete('active-template');

      expect(result).toBe(false);
    });

    it('should handle null rowCount', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: null,
      } as any);

      const result = await repository.delete('template-123');

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as any);

      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('template-123')).rejects.toThrow('Delete failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as any);

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('template-123', mockClient);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('recordAcceptance', () => {
    it('should record customer acceptance with all fields', async () => {
      const params: RecordAcceptanceParams = {
        customerId: 'cust-123',
        templateId: 'template-123',
        templateType: 'terms_of_service',
        templateVersion: 2,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      };

      const mockRow = {
        id: 'acceptance-123',
        customer_id: params.customerId,
        template_id: params.templateId,
        template_type: params.templateType,
        template_version: params.templateVersion,
        accepted_at: new Date('2024-01-15'),
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.recordAcceptance(params);

      expect(result).toEqual({
        id: 'acceptance-123',
        customerId: params.customerId,
        templateId: params.templateId,
        templateType: params.templateType,
        templateVersion: params.templateVersion,
        acceptedAt: new Date('2024-01-15'),
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO customer_legal_acceptances'),
        [
          params.customerId,
          params.templateId,
          params.templateType,
          params.templateVersion,
          params.ipAddress,
          params.userAgent,
        ]
      );
    });

    it('should record acceptance without optional fields', async () => {
      const params: RecordAcceptanceParams = {
        customerId: 'cust-123',
        templateId: 'template-123',
        templateType: 'privacy_policy',
        templateVersion: 1,
      };

      const mockRow = {
        id: 'acceptance-456',
        customer_id: params.customerId,
        template_id: params.templateId,
        template_type: params.templateType,
        template_version: params.templateVersion,
        accepted_at: new Date('2024-01-15'),
        ip_address: null,
        user_agent: null,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.recordAcceptance(params);

      expect(result.ipAddress).toBeNull();
      expect(result.userAgent).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const params: RecordAcceptanceParams = {
        customerId: 'cust-123',
        templateId: 'template-123',
        templateType: 'terms_of_service',
        templateVersion: 1,
      };

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.recordAcceptance(params)).rejects.toThrow('Insert failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: RecordAcceptanceParams = {
        customerId: 'cust-123',
        templateId: 'template-123',
        templateType: 'refund_policy',
        templateVersion: 1,
      };

      const mockRow = {
        id: 'acceptance-tx',
        customer_id: params.customerId,
        template_id: params.templateId,
        template_type: params.templateType,
        template_version: params.templateVersion,
        accepted_at: new Date('2024-01-15'),
        ip_address: null,
        user_agent: null,
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.recordAcceptance(params, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('getCustomerAcceptances', () => {
    it('should get all acceptances for a customer', async () => {
      const mockRows = [
        {
          id: 'acceptance-1',
          customer_id: 'cust-123',
          template_id: 'template-1',
          template_type: 'terms_of_service',
          template_version: 2,
          accepted_at: new Date('2024-02-01'),
          ip_address: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
        },
        {
          id: 'acceptance-2',
          customer_id: 'cust-123',
          template_id: 'template-2',
          template_type: 'privacy_policy',
          template_version: 1,
          accepted_at: new Date('2024-01-15'),
          ip_address: null,
          user_agent: null,
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.getCustomerAcceptances('cust-123');

      expect(result).toHaveLength(2);
      expect(result[0].customerId).toBe('cust-123');
      expect(result[0].templateType).toBe('terms_of_service');
      expect(result[1].templateType).toBe('privacy_policy');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY accepted_at DESC'),
        ['cust-123']
      );
    });

    it('should return empty array if no acceptances found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.getCustomerAcceptances('cust-no-acceptances');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.getCustomerAcceptances('cust-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.getCustomerAcceptances('cust-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('hasAcceptedLatest', () => {
    it('should return true if customer has accepted latest active template', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ accepted: true }],
        rowCount: 1,
      } as any);

      const result = await repository.hasAcceptedLatest(
        'cust-123',
        'dev-123',
        'terms_of_service'
      );

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT EXISTS'),
        ['cust-123', 'dev-123', 'terms_of_service']
      );
    });

    it('should return false if customer has not accepted latest', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ accepted: false }],
        rowCount: 1,
      } as any);

      const result = await repository.hasAcceptedLatest(
        'cust-123',
        'dev-123',
        'privacy_policy'
      );

      expect(result).toBe(false);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(
        repository.hasAcceptedLatest('cust-123', 'dev-123', 'terms_of_service')
      ).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [{ accepted: true }],
        rowCount: 1,
      } as any);

      await repository.hasAcceptedLatest('cust-123', 'dev-123', 'terms_of_service', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle template with null effective date', async () => {
      const mockRow = {
        id: 'template-123',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('template-123');

      expect(result?.effectiveDate).toBeNull();
    });

    it('should handle template with empty metadata object', async () => {
      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Terms',
        content: 'Content',
        metadata: {},
      };

      const mockRow = {
        id: 'template-empty-meta',
        developer_id: params.developerId,
        type: params.type,
        version: 1,
        title: params.title,
        content: params.content,
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.metadata).toEqual({});
    });

    it('should handle template with complex metadata', async () => {
      const complexMetadata = {
        author: 'Legal Team',
        reviewers: ['Alice', 'Bob'],
        nested: {
          key: 'value',
          array: [1, 2, 3],
        },
        approved: true,
        revision: 5,
      };

      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Terms',
        content: 'Content',
        metadata: complexMetadata,
      };

      const mockRow = {
        id: 'template-complex',
        developer_id: params.developerId,
        type: params.type,
        version: 1,
        title: params.title,
        content: params.content,
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: complexMetadata,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.metadata).toEqual(complexMetadata);
    });

    it('should handle unicode content', async () => {
      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: '利用規約 / Terms of Service',
        content: 'これは利用規約です。日本語のテスト。',
        contentHtml: '<p>これは利用規約です。日本語のテスト。</p>',
        language: 'ja',
      };

      const mockRow = {
        id: 'template-unicode',
        developer_id: params.developerId,
        type: params.type,
        version: 1,
        title: params.title,
        content: params.content,
        content_html: params.contentHtml,
        language: params.language,
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.title).toBe('利用規約 / Terms of Service');
      expect(result.content).toBe('これは利用規約です。日本語のテスト。');
      expect(result.language).toBe('ja');
    });

    it('should handle very long content', async () => {
      const longContent = 'A'.repeat(100000);

      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Long Terms',
        content: longContent,
      };

      const mockRow = {
        id: 'template-long',
        developer_id: params.developerId,
        type: params.type,
        version: 1,
        title: params.title,
        content: longContent,
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.content.length).toBe(100000);
    });

    it('should handle all template types', async () => {
      const templateTypes: LegalTemplateType[] = [
        'terms_of_service',
        'privacy_policy',
        'refund_policy',
      ];

      for (const type of templateTypes) {
        mockPool.query.mockResolvedValueOnce({
          rows: [{ next_version: 1 }],
          rowCount: 1,
        } as any);

        const mockRow = {
          id: `template-${type}`,
          developer_id: 'dev-123',
          type,
          version: 1,
          title: `${type} Title`,
          content: 'Content',
          content_html: null,
          language: 'en',
          is_active: true,
          is_default: false,
          effective_date: null,
          metadata: null,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        };

        mockPool.query.mockResolvedValueOnce({
          rows: [mockRow],
          rowCount: 1,
        } as any);

        const result = await repository.create({
          developerId: 'dev-123',
          type,
          title: `${type} Title`,
          content: 'Content',
        });

        expect(result.type).toBe(type);
      }
    });

    it('should properly map dates from database rows', async () => {
      const createdAt = new Date('2024-01-15T10:30:00Z');
      const updatedAt = new Date('2024-02-20T14:45:00Z');
      const effectiveDate = new Date('2024-03-01T00:00:00Z');

      const mockRow = {
        id: 'template-dates',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: effectiveDate.toISOString(),
        metadata: null,
        created_at: createdAt.toISOString(),
        updated_at: updatedAt.toISOString(),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('template-dates');

      expect(result?.createdAt).toEqual(createdAt);
      expect(result?.updatedAt).toEqual(updatedAt);
      expect(result?.effectiveDate).toEqual(effectiveDate);
    });

    it('should handle special characters in HTML content', async () => {
      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Terms with <Special> & Characters',
        content: 'Content with <tags> & entities "quotes"',
        contentHtml: '<p>Content with &lt;tags&gt; &amp; entities &quot;quotes&quot;</p>',
      };

      const mockRow = {
        id: 'template-special',
        developer_id: params.developerId,
        type: params.type,
        version: 1,
        title: params.title,
        content: params.content,
        content_html: params.contentHtml,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.contentHtml).toBe(
        '<p>Content with &lt;tags&gt; &amp; entities &quot;quotes&quot;</p>'
      );
    });
  });

  describe('error logging', () => {
    it('should log error when create fails', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Terms',
        content: 'Content',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating legal template',
        expect.objectContaining({
          error: dbError,
          params,
        })
      );
    });

    it('should log error when findById fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findById('template-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding legal template',
        expect.objectContaining({
          error: dbError,
          id: 'template-123',
        })
      );
    });

    it('should log success when template is created', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateLegalTemplateParams = {
        developerId: 'dev-123',
        type: 'terms_of_service',
        title: 'Terms',
        content: 'Content',
      };

      const mockRow = {
        id: 'template-log',
        developer_id: params.developerId,
        type: params.type,
        version: 1,
        title: params.title,
        content: params.content,
        content_html: null,
        language: 'en',
        is_active: true,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(logger.info).toHaveBeenCalledWith(
        'Legal template created',
        expect.objectContaining({
          templateId: 'template-log',
          type: params.type,
          version: 1,
        })
      );
    });

    it('should log success when template is activated', async () => {
      const { logger } = require('../../../utils/logger');

      const mockTemplate = {
        id: 'template-activate-log',
        developer_id: 'dev-123',
        type: 'terms_of_service',
        version: 1,
        title: 'Terms',
        content: 'Content',
        content_html: null,
        language: 'en',
        is_active: false,
        is_default: false,
        effective_date: null,
        metadata: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockTemplate],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockTemplate, is_active: true }],
        rowCount: 1,
      } as any);

      await repository.activate('template-activate-log');

      expect(logger.info).toHaveBeenCalledWith(
        'Legal template activated',
        expect.objectContaining({
          templateId: 'template-activate-log',
        })
      );
    });

    it('should log success when template is deleted', async () => {
      const { logger } = require('../../../utils/logger');

      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
      } as any);

      await repository.delete('template-delete-log');

      expect(logger.info).toHaveBeenCalledWith(
        'Legal template deleted',
        expect.objectContaining({
          templateId: 'template-delete-log',
        })
      );
    });

    it('should log success when acceptance is recorded', async () => {
      const { logger } = require('../../../utils/logger');

      const params: RecordAcceptanceParams = {
        customerId: 'cust-123',
        templateId: 'template-123',
        templateType: 'terms_of_service',
        templateVersion: 2,
      };

      const mockRow = {
        id: 'acceptance-log',
        customer_id: params.customerId,
        template_id: params.templateId,
        template_type: params.templateType,
        template_version: params.templateVersion,
        accepted_at: new Date('2024-01-15'),
        ip_address: null,
        user_agent: null,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.recordAcceptance(params);

      expect(logger.info).toHaveBeenCalledWith(
        'Legal acceptance recorded',
        expect.objectContaining({
          customerId: params.customerId,
          templateType: params.templateType,
          templateVersion: params.templateVersion,
        })
      );
    });

    it('should log error when recordAcceptance fails', async () => {
      const { logger } = require('../../../utils/logger');

      const params: RecordAcceptanceParams = {
        customerId: 'cust-123',
        templateId: 'template-123',
        templateType: 'terms_of_service',
        templateVersion: 1,
      };

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.recordAcceptance(params)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error recording legal acceptance',
        expect.objectContaining({
          error: dbError,
          params,
        })
      );
    });

    it('should log error when findActiveByDeveloperAndType fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(
        repository.findActiveByDeveloperAndType('dev-123', 'terms_of_service')
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding active legal template',
        expect.objectContaining({
          error: dbError,
          developerId: 'dev-123',
          type: 'terms_of_service',
        })
      );
    });

    it('should log error when findByDeveloperId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByDeveloperId('dev-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding legal templates',
        expect.objectContaining({
          error: dbError,
          developerId: 'dev-123',
        })
      );
    });

    it('should log error when findVersionHistory fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(
        repository.findVersionHistory('dev-123', 'terms_of_service')
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding template version history',
        expect.objectContaining({
          error: dbError,
          developerId: 'dev-123',
          type: 'terms_of_service',
        })
      );
    });

    it('should log error when update fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(
        repository.update('template-123', { title: 'New Title' })
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error updating legal template',
        expect.objectContaining({
          error: dbError,
          id: 'template-123',
        })
      );
    });

    it('should log error when delete fails', async () => {
      const { logger } = require('../../../utils/logger');

      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as any);

      const dbError = new Error('Delete failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.delete('template-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error deleting legal template',
        expect.objectContaining({
          error: dbError,
          id: 'template-123',
        })
      );
    });

    it('should log error when getCustomerAcceptances fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.getCustomerAcceptances('cust-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error getting customer acceptances',
        expect.objectContaining({
          error: dbError,
          customerId: 'cust-123',
        })
      );
    });

    it('should log error when hasAcceptedLatest fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(
        repository.hasAcceptedLatest('cust-123', 'dev-123', 'terms_of_service')
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error checking acceptance',
        expect.objectContaining({
          error: dbError,
          customerId: 'cust-123',
          type: 'terms_of_service',
        })
      );
    });
  });
});
