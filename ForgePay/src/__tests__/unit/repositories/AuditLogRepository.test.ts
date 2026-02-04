import { AuditLogRepository, CreateAuditLogParams, AuditLogFilter } from '../../../repositories/AuditLogRepository';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('AuditLogRepository', () => {
  let mockPool: any;
  let repository: AuditLogRepository;

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    repository = new AuditLogRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new audit log with all fields', async () => {
      const params: CreateAuditLogParams = {
        developerId: 'dev-123',
        userId: 'user-456',
        action: 'CREATE',
        resourceType: 'product',
        resourceId: 'prod-789',
        changes: { name: 'New Product', price: 100 },
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      };

      const mockRow = {
        id: 'audit-123',
        developer_id: params.developerId,
        user_id: params.userId,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: params.changes,
        ip_address: params.ipAddress,
        user_agent: params.userAgent,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'audit-123',
        developerId: params.developerId,
        userId: params.userId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        changes: params.changes,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        createdAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        [
          params.developerId,
          params.userId,
          params.action,
          params.resourceType,
          params.resourceId,
          JSON.stringify(params.changes),
          params.ipAddress,
          params.userAgent,
        ]
      );
    });

    it('should create an audit log without optional fields', async () => {
      const params: CreateAuditLogParams = {
        action: 'DELETE',
        resourceType: 'subscription',
        resourceId: 'sub-123',
      };

      const mockRow = {
        id: 'audit-456',
        developer_id: null,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: null,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.developerId).toBeNull();
      expect(result.userId).toBeNull();
      expect(result.changes).toBeNull();
      expect(result.ipAddress).toBeNull();
      expect(result.userAgent).toBeNull();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        [
          null,
          null,
          params.action,
          params.resourceType,
          params.resourceId,
          null,
          null,
          null,
        ]
      );
    });

    it('should throw error on database failure', async () => {
      const params: CreateAuditLogParams = {
        action: 'CREATE',
        resourceType: 'product',
        resourceId: 'prod-error',
      };

      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow('Database connection failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: CreateAuditLogParams = {
        developerId: 'dev-tx',
        action: 'UPDATE',
        resourceType: 'customer',
        resourceId: 'cust-tx',
      };

      const mockRow = {
        id: 'audit-tx',
        developer_id: params.developerId,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: null,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should stringify changes object to JSON', async () => {
      const changes = { oldValue: 'old', newValue: 'new', nested: { key: 'value' } };
      const params: CreateAuditLogParams = {
        action: 'UPDATE',
        resourceType: 'product',
        resourceId: 'prod-changes',
        changes,
      };

      const mockRow = {
        id: 'audit-changes',
        developer_id: null,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining([JSON.stringify(changes)])
      );
    });
  });

  describe('findById', () => {
    it('should find an audit log by ID', async () => {
      const mockRow = {
        id: 'audit-123',
        developer_id: 'dev-123',
        user_id: 'user-456',
        action: 'CREATE',
        resource_type: 'product',
        resource_id: 'prod-789',
        changes: { name: 'Product Name' },
        ip_address: '10.0.0.1',
        user_agent: 'Chrome/100',
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('audit-123');

      expect(result).toEqual({
        id: 'audit-123',
        developerId: 'dev-123',
        userId: 'user-456',
        action: 'CREATE',
        resourceType: 'product',
        resourceId: 'prod-789',
        changes: { name: 'Product Name' },
        ipAddress: '10.0.0.1',
        userAgent: 'Chrome/100',
        createdAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM audit_logs'),
        ['audit-123']
      );
    });

    it('should return null if audit log not found', async () => {
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

      await expect(repository.findById('audit-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = {
        id: 'audit-123',
        developer_id: 'dev-123',
        user_id: null,
        action: 'UPDATE',
        resource_type: 'product',
        resource_id: 'prod-123',
        changes: null,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.findById('audit-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('find', () => {
    it('should find audit logs without filters', async () => {
      const mockRows = [
        {
          id: 'audit-1',
          developer_id: 'dev-123',
          user_id: null,
          action: 'CREATE',
          resource_type: 'product',
          resource_id: 'prod-1',
          changes: null,
          ip_address: null,
          user_agent: null,
          created_at: new Date('2024-02-01'),
        },
        {
          id: 'audit-2',
          developer_id: 'dev-123',
          user_id: 'user-456',
          action: 'UPDATE',
          resource_type: 'product',
          resource_id: 'prod-1',
          changes: { price: 200 },
          ip_address: '192.168.1.1',
          user_agent: 'Firefox/120',
          created_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.find({});

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('audit-1');
      expect(result[1].id).toBe('audit-2');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM audit_logs'),
        [100, 0] // default limit and offset
      );
    });

    it('should find audit logs with developerId filter', async () => {
      const filter: AuditLogFilter = { developerId: 'dev-123' };

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find(filter);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE developer_id = $1'),
        ['dev-123', 100, 0]
      );
    });

    it('should find audit logs with userId filter', async () => {
      const filter: AuditLogFilter = { userId: 'user-456' };

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find(filter);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1'),
        ['user-456', 100, 0]
      );
    });

    it('should find audit logs with action filter', async () => {
      const filter: AuditLogFilter = { action: 'DELETE' };

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find(filter);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE action = $1'),
        ['DELETE', 100, 0]
      );
    });

    it('should find audit logs with resourceType filter', async () => {
      const filter: AuditLogFilter = { resourceType: 'subscription' };

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find(filter);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE resource_type = $1'),
        ['subscription', 100, 0]
      );
    });

    it('should find audit logs with resourceId filter', async () => {
      const filter: AuditLogFilter = { resourceId: 'prod-123' };

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find(filter);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE resource_id = $1'),
        ['prod-123', 100, 0]
      );
    });

    it('should find audit logs with startDate filter', async () => {
      const startDate = new Date('2024-01-01');
      const filter: AuditLogFilter = { startDate };

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find(filter);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE created_at >= $1'),
        [startDate, 100, 0]
      );
    });

    it('should find audit logs with endDate filter', async () => {
      const endDate = new Date('2024-12-31');
      const filter: AuditLogFilter = { endDate };

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find(filter);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE created_at <= $1'),
        [endDate, 100, 0]
      );
    });

    it('should find audit logs with multiple filters', async () => {
      const filter: AuditLogFilter = {
        developerId: 'dev-123',
        action: 'UPDATE',
        resourceType: 'product',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find(filter);

      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[0]).toContain('developer_id = $1');
      expect(queryCall[0]).toContain('action = $2');
      expect(queryCall[0]).toContain('resource_type = $3');
      expect(queryCall[1]).toEqual(['dev-123', 'UPDATE', 'product', 100, 0]);
    });

    it('should find audit logs with all filters combined', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const filter: AuditLogFilter = {
        developerId: 'dev-123',
        userId: 'user-456',
        action: 'CREATE',
        resourceType: 'product',
        resourceId: 'prod-789',
        startDate,
        endDate,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find(filter);

      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[1]).toEqual([
        'dev-123',
        'user-456',
        'CREATE',
        'product',
        'prod-789',
        startDate,
        endDate,
        100,
        0,
      ]);
    });

    it('should respect custom limit and offset', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find({}, 50, 25);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1 OFFSET $2'),
        [50, 25]
      );
    });

    it('should order results by created_at descending', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find({});

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Array)
      );
    });

    it('should return empty array if no audit logs found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.find({ developerId: 'nonexistent' });

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.find({})).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find({}, 100, 0, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('count', () => {
    it('should count audit logs without filters', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '42' }],
        rowCount: 1,
      } as any);

      const result = await repository.count({});

      expect(result).toBe(42);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) as count FROM audit_logs'),
        []
      );
    });

    it('should count audit logs with developerId filter', async () => {
      const filter: AuditLogFilter = { developerId: 'dev-123' };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '10' }],
        rowCount: 1,
      } as any);

      const result = await repository.count(filter);

      expect(result).toBe(10);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE developer_id = $1'),
        ['dev-123']
      );
    });

    it('should count audit logs with userId filter', async () => {
      const filter: AuditLogFilter = { userId: 'user-456' };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      } as any);

      const result = await repository.count(filter);

      expect(result).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1'),
        ['user-456']
      );
    });

    it('should count audit logs with action filter', async () => {
      const filter: AuditLogFilter = { action: 'DELETE' };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '3' }],
        rowCount: 1,
      } as any);

      const result = await repository.count(filter);

      expect(result).toBe(3);
    });

    it('should count audit logs with resourceType filter', async () => {
      const filter: AuditLogFilter = { resourceType: 'subscription' };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '15' }],
        rowCount: 1,
      } as any);

      const result = await repository.count(filter);

      expect(result).toBe(15);
    });

    it('should count audit logs with resourceId filter', async () => {
      const filter: AuditLogFilter = { resourceId: 'prod-123' };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '8' }],
        rowCount: 1,
      } as any);

      const result = await repository.count(filter);

      expect(result).toBe(8);
    });

    it('should count audit logs with date range filters', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-06-30');
      const filter: AuditLogFilter = { startDate, endDate };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '100' }],
        rowCount: 1,
      } as any);

      const result = await repository.count(filter);

      expect(result).toBe(100);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('created_at >= $1'),
        [startDate, endDate]
      );
    });

    it('should count audit logs with multiple filters', async () => {
      const filter: AuditLogFilter = {
        developerId: 'dev-123',
        action: 'UPDATE',
        resourceType: 'product',
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '25' }],
        rowCount: 1,
      } as any);

      const result = await repository.count(filter);

      expect(result).toBe(25);
      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[1]).toEqual(['dev-123', 'UPDATE', 'product']);
    });

    it('should return 0 when no matching audit logs', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '0' }],
        rowCount: 1,
      } as any);

      const result = await repository.count({ developerId: 'nonexistent' });

      expect(result).toBe(0);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Count query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.count({})).rejects.toThrow('Count query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [{ count: '20' }],
        rowCount: 1,
      } as any);

      await repository.count({}, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByDeveloperId', () => {
    it('should find audit logs by developer ID', async () => {
      const mockRows = [
        {
          id: 'audit-1',
          developer_id: 'dev-123',
          user_id: null,
          action: 'CREATE',
          resource_type: 'product',
          resource_id: 'prod-1',
          changes: null,
          ip_address: null,
          user_agent: null,
          created_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 1,
      } as any);

      const result = await repository.findByDeveloperId('dev-123');

      expect(result).toHaveLength(1);
      expect(result[0].developerId).toBe('dev-123');
    });

    it('should use default limit of 100', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([100])
      );
    });

    it('should respect custom limit', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123', 50);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([50])
      );
    });

    it('should return empty array if no audit logs found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByDeveloperId('nonexistent');

      expect(result).toEqual([]);
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDeveloperId('dev-123', 100, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByResource', () => {
    it('should find audit logs by resource type and ID', async () => {
      const mockRows = [
        {
          id: 'audit-1',
          developer_id: 'dev-123',
          user_id: null,
          action: 'CREATE',
          resource_type: 'product',
          resource_id: 'prod-456',
          changes: null,
          ip_address: null,
          user_agent: null,
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'audit-2',
          developer_id: 'dev-123',
          user_id: 'user-789',
          action: 'UPDATE',
          resource_type: 'product',
          resource_id: 'prod-456',
          changes: { price: 150 },
          ip_address: '10.0.0.1',
          user_agent: 'Safari/17',
          created_at: new Date('2024-01-02'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByResource('product', 'prod-456');

      expect(result).toHaveLength(2);
      expect(result[0].resourceType).toBe('product');
      expect(result[0].resourceId).toBe('prod-456');
    });

    it('should use default limit of 100', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByResource('product', 'prod-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([100])
      );
    });

    it('should respect custom limit', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByResource('product', 'prod-123', 25);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([25])
      );
    });

    it('should return empty array if no audit logs found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByResource('unknown', 'unknown-id');

      expect(result).toEqual([]);
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByResource('product', 'prod-123', 100, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByAction', () => {
    it('should find audit logs by action', async () => {
      const mockRows = [
        {
          id: 'audit-1',
          developer_id: 'dev-123',
          user_id: null,
          action: 'DELETE',
          resource_type: 'subscription',
          resource_id: 'sub-1',
          changes: null,
          ip_address: null,
          user_agent: null,
          created_at: new Date('2024-01-01'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 1,
      } as any);

      const result = await repository.findByAction('DELETE');

      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('DELETE');
    });

    it('should use default limit of 100', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByAction('CREATE');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([100])
      );
    });

    it('should respect custom limit', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByAction('UPDATE', 10);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([10])
      );
    });

    it('should return empty array if no audit logs found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByAction('UNKNOWN_ACTION');

      expect(result).toEqual([]);
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByAction('CREATE', 100, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByDateRange', () => {
    it('should find audit logs within date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-06-30');

      const mockRows = [
        {
          id: 'audit-1',
          developer_id: 'dev-123',
          user_id: null,
          action: 'CREATE',
          resource_type: 'product',
          resource_id: 'prod-1',
          changes: null,
          ip_address: null,
          user_agent: null,
          created_at: new Date('2024-03-15'),
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 1,
      } as any);

      const result = await repository.findByDateRange(startDate, endDate);

      expect(result).toHaveLength(1);
      expect(result[0].createdAt >= startDate).toBe(true);
      expect(result[0].createdAt <= endDate).toBe(true);
    });

    it('should use default limit of 100', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDateRange(startDate, endDate);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([100])
      );
    });

    it('should respect custom limit', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDateRange(startDate, endDate, 200);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([200])
      );
    });

    it('should return empty array if no audit logs found', async () => {
      const startDate = new Date('1990-01-01');
      const endDate = new Date('1990-12-31');

      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByDateRange(startDate, endDate);

      expect(result).toEqual([]);
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByDateRange(startDate, endDate, 100, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle audit log with null changes', async () => {
      const mockRow = {
        id: 'audit-null',
        developer_id: 'dev-123',
        user_id: null,
        action: 'READ',
        resource_type: 'product',
        resource_id: 'prod-123',
        changes: null,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('audit-null');

      expect(result?.changes).toBeNull();
    });

    it('should handle audit log with complex changes object', async () => {
      const complexChanges = {
        before: { price: 100, name: 'Old Name' },
        after: { price: 150, name: 'New Name' },
        diff: ['price', 'name'],
        metadata: {
          changedBy: 'admin',
          reason: 'Price adjustment',
          nested: { level1: { level2: 'value' } },
        },
      };

      const params: CreateAuditLogParams = {
        action: 'UPDATE',
        resourceType: 'product',
        resourceId: 'prod-complex',
        changes: complexChanges,
      };

      const mockRow = {
        id: 'audit-complex',
        developer_id: null,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: complexChanges,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.changes).toEqual(complexChanges);
    });

    it('should handle audit log with empty changes object', async () => {
      const params: CreateAuditLogParams = {
        action: 'UPDATE',
        resourceType: 'product',
        resourceId: 'prod-empty-changes',
        changes: {},
      };

      const mockRow = {
        id: 'audit-empty-changes',
        developer_id: null,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: {},
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.changes).toEqual({});
    });

    it('should handle audit log with array in changes', async () => {
      const changesWithArray = {
        addedItems: ['item1', 'item2', 'item3'],
        removedItems: [],
      };

      const params: CreateAuditLogParams = {
        action: 'UPDATE',
        resourceType: 'cart',
        resourceId: 'cart-123',
        changes: changesWithArray,
      };

      const mockRow = {
        id: 'audit-array',
        developer_id: null,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: changesWithArray,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.changes).toEqual(changesWithArray);
    });

    it('should handle special characters in action', async () => {
      const params: CreateAuditLogParams = {
        action: 'USER_LOGIN_2FA_SUCCESS',
        resourceType: 'auth',
        resourceId: 'session-123',
      };

      const mockRow = {
        id: 'audit-special',
        developer_id: null,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: null,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.action).toBe('USER_LOGIN_2FA_SUCCESS');
    });

    it('should handle IPv6 addresses', async () => {
      const params: CreateAuditLogParams = {
        action: 'CREATE',
        resourceType: 'product',
        resourceId: 'prod-ipv6',
        ipAddress: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      };

      const mockRow = {
        id: 'audit-ipv6',
        developer_id: null,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: null,
        ip_address: params.ipAddress,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.ipAddress).toBe('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    });

    it('should handle long user agent strings', async () => {
      const longUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0 ' + 'a'.repeat(200);

      const params: CreateAuditLogParams = {
        action: 'CREATE',
        resourceType: 'product',
        resourceId: 'prod-ua',
        userAgent: longUserAgent,
      };

      const mockRow = {
        id: 'audit-ua',
        developer_id: null,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: null,
        ip_address: null,
        user_agent: longUserAgent,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.userAgent).toBe(longUserAgent);
    });

    it('should handle unicode characters in resourceId', async () => {
      const params: CreateAuditLogParams = {
        action: 'CREATE',
        resourceType: 'product',
        resourceId: 'prod-日本語-émoji-🎉',
      };

      const mockRow = {
        id: 'audit-unicode',
        developer_id: null,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: null,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.resourceId).toBe('prod-日本語-émoji-🎉');
    });

    it('should properly convert date strings from database', async () => {
      const createdAt = new Date('2024-06-15T14:30:45.123Z');

      const mockRow = {
        id: 'audit-date',
        developer_id: 'dev-123',
        user_id: null,
        action: 'CREATE',
        resource_type: 'product',
        resource_id: 'prod-123',
        changes: null,
        ip_address: null,
        user_agent: null,
        created_at: createdAt,
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('audit-date');

      expect(result?.createdAt).toEqual(createdAt);
      expect(result?.createdAt instanceof Date).toBe(true);
    });

    it('should handle pagination with large offset', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find({}, 100, 10000);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET'),
        expect.arrayContaining([10000])
      );
    });

    it('should handle zero limit gracefully', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.find({}, 0);

      expect(result).toEqual([]);
    });
  });

  describe('error logging', () => {
    it('should log error when create fails', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateAuditLogParams = {
        action: 'CREATE',
        resourceType: 'product',
        resourceId: 'prod-error',
      };

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating audit log',
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

      await expect(repository.findById('audit-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding audit log by ID',
        expect.objectContaining({
          error: dbError,
          auditLogId: 'audit-123',
        })
      );
    });

    it('should log error when find fails', async () => {
      const { logger } = require('../../../utils/logger');

      const filter: AuditLogFilter = { developerId: 'dev-123' };
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.find(filter)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding audit logs',
        expect.objectContaining({
          error: dbError,
          filter,
        })
      );
    });

    it('should log error when count fails', async () => {
      const { logger } = require('../../../utils/logger');

      const filter: AuditLogFilter = { action: 'DELETE' };
      const dbError = new Error('Count failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.count(filter)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error counting audit logs',
        expect.objectContaining({
          error: dbError,
          filter,
        })
      );
    });

    it('should log debug when audit log is created', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateAuditLogParams = {
        developerId: 'dev-log',
        action: 'CREATE',
        resourceType: 'product',
        resourceId: 'prod-log',
      };

      const mockRow = {
        id: 'audit-log',
        developer_id: params.developerId,
        user_id: null,
        action: params.action,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        changes: null,
        ip_address: null,
        user_agent: null,
        created_at: new Date('2024-01-01'),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(logger.debug).toHaveBeenCalledWith(
        'Audit log created',
        expect.objectContaining({
          auditLogId: 'audit-log',
          action: params.action,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
        })
      );
    });
  });

  describe('query building', () => {
    it('should build correct query with no WHERE clause when no filters', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find({});

      const query = mockPool.query.mock.calls[0][0];
      expect(query).not.toContain('WHERE');
      expect(query).toContain('ORDER BY created_at DESC');
      expect(query).toContain('LIMIT');
      expect(query).toContain('OFFSET');
    });

    it('should build correct query with single WHERE condition', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find({ developerId: 'dev-123' });

      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('WHERE developer_id = $1');
      expect(query).not.toContain(' AND ');
    });

    it('should build correct query with multiple WHERE conditions joined by AND', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.find({
        developerId: 'dev-123',
        action: 'CREATE',
        resourceType: 'product',
      });

      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('WHERE');
      expect(query).toContain(' AND ');
      expect(query).toContain('developer_id = $1');
      expect(query).toContain('action = $2');
      expect(query).toContain('resource_type = $3');
    });

    it('should use correct parameter indices in count query', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      } as any);

      await repository.count({
        developerId: 'dev-123',
        userId: 'user-456',
        action: 'UPDATE',
      });

      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[0]).toContain('$1');
      expect(queryCall[0]).toContain('$2');
      expect(queryCall[0]).toContain('$3');
      expect(queryCall[1]).toEqual(['dev-123', 'user-456', 'UPDATE']);
    });
  });
});
