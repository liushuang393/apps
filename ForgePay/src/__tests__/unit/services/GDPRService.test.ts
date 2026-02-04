import { GDPRService, GDPRRequestType, GDPRRequestStatus } from '../../../services/GDPRService';
import { EntitlementStatus } from '../../../types';

// Mock pool
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockPool = {
  query: jest.fn(),
  connect: jest.fn().mockResolvedValue(mockClient),
};

jest.mock('../../../config/database', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

// Mock dependencies
jest.mock('../../../repositories/CustomerRepository', () => ({
  customerRepository: {
    findByEmail: jest.fn(),
    findById: jest.fn(),
  },
}));

jest.mock('../../../repositories/EntitlementRepository', () => ({
  entitlementRepository: {
    findByCustomerId: jest.fn(),
  },
}));

jest.mock('../../../repositories/AuditLogRepository', () => ({
  auditLogRepository: {
    create: jest.fn(),
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

import { customerRepository } from '../../../repositories/CustomerRepository';
import { entitlementRepository } from '../../../repositories/EntitlementRepository';
import { auditLogRepository } from '../../../repositories/AuditLogRepository';
import { emailService } from '../../../services/EmailService';
import { logger } from '../../../utils/logger';

const mockCustomerRepository = customerRepository as jest.Mocked<typeof customerRepository>;
const mockEntitlementRepository = entitlementRepository as jest.Mocked<typeof entitlementRepository>;
const mockAuditLogRepository = auditLogRepository as jest.Mocked<typeof auditLogRepository>;
const mockEmailService = emailService as jest.Mocked<typeof emailService>;

describe('GDPRService', () => {
  let service: GDPRService;

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

  const mockEntitlement = {
    id: 'ent-123',
    customerId: 'cust-123',
    productId: 'prod-123',
    purchaseIntentId: 'pi_123',
    paymentId: 'pay_123',
    subscriptionId: 'sub_123',
    status: 'active' as EntitlementStatus,
    expiresAt: new Date('2025-01-01'),
    revokedReason: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(() => {
    service = new GDPRService(
      mockPool as any,
      mockCustomerRepository as any,
      mockEntitlementRepository as any,
      mockAuditLogRepository as any,
      mockEmailService as any
    );
    jest.clearAllMocks();

    // Setup default mock for pool.connect
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('createRequest', () => {
    const createParams = {
      developerId: 'dev-123',
      customerEmail: 'customer@example.com',
      requestType: 'data_export' as GDPRRequestType,
      requestedBy: 'customer@example.com',
      reason: 'Customer requested data export',
      dataCategories: ['personal', 'transactions'],
    };

    it('should create a GDPR request successfully with existing customer', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'gdpr-req-123',
          developer_id: 'dev-123',
          customer_id: 'cust-123',
          customer_email: 'customer@example.com',
          request_type: 'data_export',
          status: 'pending',
          requested_by: 'customer@example.com',
          reason: 'Customer requested data export',
          data_categories: ['personal', 'transactions'],
          export_file_url: null,
          export_file_expires_at: null,
          processed_at: null,
          completed_at: null,
          error_message: null,
          metadata: null,
          created_at: '2024-01-15',
          updated_at: '2024-01-15',
        }],
      });
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.createRequest(createParams);

      expect(result.id).toBe('gdpr-req-123');
      expect(result.customerId).toBe('cust-123');
      expect(result.requestType).toBe('data_export');
      expect(result.status).toBe('pending');
      expect(mockCustomerRepository.findByEmail).toHaveBeenCalledWith('customer@example.com');
      expect(mockAuditLogRepository.create).toHaveBeenCalledWith({
        developerId: 'dev-123',
        action: 'gdpr.request_created',
        resourceType: 'gdpr_request',
        resourceId: 'gdpr-req-123',
        changes: {
          requestType: 'data_export',
          customerEmail: 'customer@example.com',
        },
      });
    });

    it('should create a GDPR request with null customerId if customer not found', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(null);
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'gdpr-req-124',
          developer_id: 'dev-123',
          customer_id: null,
          customer_email: 'newcustomer@example.com',
          request_type: 'data_export',
          status: 'pending',
          requested_by: 'newcustomer@example.com',
          reason: null,
          data_categories: null,
          export_file_url: null,
          export_file_expires_at: null,
          processed_at: null,
          completed_at: null,
          error_message: null,
          metadata: null,
          created_at: '2024-01-15',
          updated_at: '2024-01-15',
        }],
      });
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.createRequest({
        ...createParams,
        customerEmail: 'newcustomer@example.com',
        requestedBy: 'newcustomer@example.com',
        reason: undefined,
        dataCategories: undefined,
      });

      expect(result.customerId).toBeNull();
    });

    it('should create a data_deletion request', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'gdpr-req-125',
          developer_id: 'dev-123',
          customer_id: 'cust-123',
          customer_email: 'customer@example.com',
          request_type: 'data_deletion',
          status: 'pending',
          requested_by: 'customer@example.com',
          reason: 'Right to be forgotten',
          data_categories: null,
          export_file_url: null,
          export_file_expires_at: null,
          processed_at: null,
          completed_at: null,
          error_message: null,
          metadata: null,
          created_at: '2024-01-15',
          updated_at: '2024-01-15',
        }],
      });
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.createRequest({
        ...createParams,
        requestType: 'data_deletion',
        reason: 'Right to be forgotten',
      });

      expect(result.requestType).toBe('data_deletion');
    });

    it('should throw and log error on database failure', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValue(dbError);

      await expect(service.createRequest(createParams)).rejects.toThrow('Database connection failed');
      expect(logger.error).toHaveBeenCalledWith('Error creating GDPR request', { error: dbError });
    });
  });

  describe('processRequest', () => {
    it('should process a data_export request successfully', async () => {
      // First query: getRequest
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_export',
            status: 'pending',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: null,
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        })
        // Second query: updateRequestStatus to processing
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_export',
            status: 'processing',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: '2024-01-15T10:00:00Z',
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        })
        // Third query: exportCustomerData - invoices
        .mockResolvedValueOnce({ rows: [] })
        // Fourth query: exportCustomerData - legal acceptances
        .mockResolvedValueOnce({ rows: [] })
        // Fifth query: exportCustomerData - audit logs
        .mockResolvedValueOnce({ rows: [] })
        // Sixth query: update export URL
        .mockResolvedValueOnce({ rows: [] })
        // Seventh query: updateRequestStatus to completed
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_export',
            status: 'completed',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: 'data:application/json;base64,...',
            export_file_expires_at: '2024-01-22',
            processed_at: '2024-01-15T10:00:00Z',
            completed_at: '2024-01-15T10:01:00Z',
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        });

      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockEntitlementRepository.findByCustomerId.mockResolvedValue([mockEntitlement]);
      mockEmailService.send.mockResolvedValue(true);

      const result = await service.processRequest('gdpr-req-123');

      expect(result.status).toBe('completed');
      expect(mockEmailService.send).toHaveBeenCalledWith({
        to: { email: 'customer@example.com' },
        subject: 'Your Data Export is Ready',
        html: expect.stringContaining('Your Data Export is Ready'),
        text: expect.stringContaining('Your data export request has been processed'),
      });
    });

    it('should process a data_deletion request successfully', async () => {
      // First query: getRequest
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_deletion',
            status: 'pending',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: null,
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        })
        // Second query: updateRequestStatus to processing
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_deletion',
            status: 'processing',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: '2024-01-15T10:00:00Z',
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        })
        // Third query: updateRequestStatus to completed
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_deletion',
            status: 'completed',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: '2024-01-15T10:00:00Z',
            completed_at: '2024-01-15T10:01:00Z',
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        });

      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      // Mock client queries for deleteCustomerData transaction
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rowCount: 2 }) // DELETE entitlements
        .mockResolvedValueOnce({ rowCount: 1 }) // DELETE legal acceptances
        .mockResolvedValueOnce({ rowCount: 0 }) // UPDATE invoices (anonymize)
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE customer (anonymize)
        .mockResolvedValueOnce({ rows: [] }); // COMMIT
      mockAuditLogRepository.create.mockResolvedValue({} as any);
      mockEmailService.send.mockResolvedValue(true);

      const result = await service.processRequest('gdpr-req-123');

      expect(result.status).toBe('completed');
      expect(mockEmailService.send).toHaveBeenCalledWith({
        to: { email: 'customer@example.com' },
        subject: 'Your Data Has Been Deleted',
        html: expect.stringContaining('Your Data Has Been Deleted'),
        text: expect.stringContaining('your personal data has been deleted'),
      });
    });

    it('should throw error for data_rectification request', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_rectification',
            status: 'pending',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: null,
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_rectification',
            status: 'processing',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: '2024-01-15T10:00:00Z',
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_rectification',
            status: 'failed',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: '2024-01-15T10:00:00Z',
            completed_at: null,
            error_message: 'Error: Data rectification requires manual handling',
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        });

      await expect(service.processRequest('gdpr-req-123')).rejects.toThrow('Data rectification requires manual handling');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should throw error if request not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.processRequest('invalid-id')).rejects.toThrow('GDPR request not found');
    });

    it('should update status to failed on processing error', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_export',
            status: 'pending',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: null,
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_export',
            status: 'processing',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: '2024-01-15T10:00:00Z',
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_export',
            status: 'failed',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: '2024-01-15T10:00:00Z',
            completed_at: null,
            error_message: 'Error: Customer not found',
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        });

      mockCustomerRepository.findByEmail.mockResolvedValue(null);

      await expect(service.processRequest('gdpr-req-123')).rejects.toThrow('Customer not found');
    });
  });

  describe('exportCustomerData', () => {
    it('should export all customer data successfully', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockEntitlementRepository.findByCustomerId.mockResolvedValue([mockEntitlement]);
      
      mockPool.query
        // Invoices query
        .mockResolvedValueOnce({
          rows: [
            {
              invoice_number: 'INV-001',
              amount: 9900,
              currency: 'usd',
              status: 'paid',
              created_at: '2024-01-10',
            },
          ],
        })
        // Legal acceptances query
        .mockResolvedValueOnce({
          rows: [
            {
              template_type: 'terms_of_service',
              template_version: 1,
              accepted_at: '2024-01-01',
            },
          ],
        })
        // Audit logs query
        .mockResolvedValueOnce({
          rows: [
            {
              action: 'customer.created',
              timestamp: '2024-01-01',
            },
          ],
        });

      const result = await service.exportCustomerData('dev-123', 'customer@example.com');

      expect(result.customer.id).toBe('cust-123');
      expect(result.customer.email).toBe('customer@example.com');
      expect(result.entitlements).toHaveLength(1);
      expect(result.invoices).toHaveLength(1);
      expect(result.legalAcceptances).toHaveLength(1);
      expect(result.auditLogs).toHaveLength(1);
      expect(result.exportedAt).toBeInstanceOf(Date);
      expect(logger.info).toHaveBeenCalledWith('Customer data exported', {
        customerId: 'cust-123',
        email: 'customer@example.com',
      });
    });

    it('should throw error if customer not found', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(null);

      await expect(service.exportCustomerData('dev-123', 'unknown@example.com')).rejects.toThrow('Customer not found');
    });

    it('should handle customer with no entitlements, invoices, or legal acceptances', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockEntitlementRepository.findByCustomerId.mockResolvedValue([]);
      
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.exportCustomerData('dev-123', 'customer@example.com');

      expect(result.entitlements).toHaveLength(0);
      expect(result.invoices).toHaveLength(0);
      expect(result.legalAcceptances).toHaveLength(0);
      expect(result.auditLogs).toHaveLength(0);
    });

    it('should correctly map entitlement type based on subscriptionId', async () => {
      const oneTimeEntitlement = {
        ...mockEntitlement,
        id: 'ent-456',
        subscriptionId: null,
        status: 'active' as EntitlementStatus,
      };
      
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockEntitlementRepository.findByCustomerId.mockResolvedValue([mockEntitlement, oneTimeEntitlement]);
      
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.exportCustomerData('dev-123', 'customer@example.com');

      expect(result.entitlements).toHaveLength(2);
      expect(result.entitlements[0].type).toBe('subscription');
      expect(result.entitlements[1].type).toBe('one_time');
    });
  });

  describe('deleteCustomerData', () => {
    it('should delete all customer data without keeping transaction records', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rowCount: 3 }) // DELETE entitlements
        .mockResolvedValueOnce({ rowCount: 2 }) // DELETE legal acceptances
        .mockResolvedValueOnce({ rowCount: 5 }) // DELETE invoices
        .mockResolvedValueOnce({ rowCount: 10 }) // DELETE checkout_sessions
        .mockResolvedValueOnce({ rowCount: 1 }) // DELETE customer
        .mockResolvedValueOnce({ rows: [] }); // COMMIT
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.deleteCustomerData('dev-123', 'customer@example.com');

      expect(result.deletedRecords).toBe(21); // 3 + 2 + 5 + 10 + 1
      expect(result.anonymizedRecords).toBe(0);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Customer data deleted', {
        customerId: 'cust-123',
        deletedRecords: 21,
        anonymizedRecords: 0,
      });
    });

    it('should anonymize records when keepTransactionRecords is true', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rowCount: 3 }) // DELETE entitlements
        .mockResolvedValueOnce({ rowCount: 2 }) // DELETE legal acceptances
        .mockResolvedValueOnce({ rowCount: 5 }) // UPDATE invoices (anonymize)
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE customer (anonymize)
        .mockResolvedValueOnce({ rows: [] }); // COMMIT
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.deleteCustomerData('dev-123', 'customer@example.com', {
        keepTransactionRecords: true,
      });

      expect(result.deletedRecords).toBe(5); // 3 + 2
      expect(result.anonymizedRecords).toBe(1);
      expect(mockAuditLogRepository.create).toHaveBeenCalledWith({
        developerId: 'dev-123',
        action: 'gdpr.data_deleted',
        resourceType: 'customer',
        resourceId: 'cust-123',
        changes: {
          deletedRecords: 5,
          anonymizedRecords: 1,
          keepTransactionRecords: true,
        },
      });
    });

    it('should throw error if customer not found', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(null);

      await expect(service.deleteCustomerData('dev-123', 'unknown@example.com')).rejects.toThrow('Customer not found');
    });

    it('should rollback transaction on error', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rowCount: 3 }) // DELETE entitlements
        .mockRejectedValueOnce(new Error('Foreign key constraint violation')); // Error on DELETE legal acceptances

      await expect(
        service.deleteCustomerData('dev-123', 'customer@example.com')
      ).rejects.toThrow('Foreign key constraint violation');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should release client even on error', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('Database error'));

      await expect(
        service.deleteCustomerData('dev-123', 'customer@example.com')
      ).rejects.toThrow('Database error');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getRequest', () => {
    it('should return GDPR request by ID', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'gdpr-req-123',
          developer_id: 'dev-123',
          customer_id: 'cust-123',
          customer_email: 'customer@example.com',
          request_type: 'data_export',
          status: 'completed',
          requested_by: 'customer@example.com',
          reason: 'Data export request',
          data_categories: ['personal'],
          export_file_url: 'https://example.com/export.json',
          export_file_expires_at: '2024-01-22',
          processed_at: '2024-01-15T10:00:00Z',
          completed_at: '2024-01-15T10:01:00Z',
          error_message: null,
          metadata: { source: 'portal' },
          created_at: '2024-01-15',
          updated_at: '2024-01-15',
        }],
      });

      const result = await service.getRequest('gdpr-req-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('gdpr-req-123');
      expect(result?.status).toBe('completed');
      expect(result?.exportFileUrl).toBe('https://example.com/export.json');
      expect(result?.exportFileExpiresAt).toBeInstanceOf(Date);
      expect(result?.processedAt).toBeInstanceOf(Date);
      expect(result?.completedAt).toBeInstanceOf(Date);
    });

    it('should return null if request not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await service.getRequest('invalid-id');

      expect(result).toBeNull();
    });

    it('should throw and log error on database failure', async () => {
      const dbError = new Error('Connection timeout');
      mockPool.query.mockRejectedValue(dbError);

      await expect(service.getRequest('gdpr-req-123')).rejects.toThrow('Connection timeout');
      expect(logger.error).toHaveBeenCalledWith('Error getting GDPR request', {
        error: dbError,
        requestId: 'gdpr-req-123',
      });
    });
  });

  describe('listRequests', () => {
    it('should return paginated list of GDPR requests', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'gdpr-req-123',
              developer_id: 'dev-123',
              customer_id: 'cust-123',
              customer_email: 'customer@example.com',
              request_type: 'data_export',
              status: 'completed',
              requested_by: 'customer@example.com',
              reason: null,
              data_categories: null,
              export_file_url: null,
              export_file_expires_at: null,
              processed_at: null,
              completed_at: null,
              error_message: null,
              metadata: null,
              created_at: '2024-01-15',
              updated_at: '2024-01-15',
            },
            {
              id: 'gdpr-req-124',
              developer_id: 'dev-123',
              customer_id: 'cust-456',
              customer_email: 'other@example.com',
              request_type: 'data_deletion',
              status: 'pending',
              requested_by: 'other@example.com',
              reason: null,
              data_categories: null,
              export_file_url: null,
              export_file_expires_at: null,
              processed_at: null,
              completed_at: null,
              error_message: null,
              metadata: null,
              created_at: '2024-01-16',
              updated_at: '2024-01-16',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ total: '2' }],
        });

      const result = await service.listRequests('dev-123');

      expect(result.requests).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by status', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-124',
            developer_id: 'dev-123',
            customer_id: 'cust-456',
            customer_email: 'other@example.com',
            request_type: 'data_deletion',
            status: 'pending',
            requested_by: 'other@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: null,
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-16',
            updated_at: '2024-01-16',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ total: '1' }],
        });

      const result = await service.listRequests('dev-123', { status: 'pending' });

      expect(result.requests).toHaveLength(1);
      expect(result.requests[0].status).toBe('pending');
      expect(result.total).toBe(1);
    });

    it('should apply pagination options', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      await service.listRequests('dev-123', { limit: 10, offset: 20 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining(['dev-123', 10, 20])
      );
    });

    it('should use default pagination values', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      await service.listRequests('dev-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['dev-123', 50, 0]) // default limit=50, offset=0
      );
    });

    it('should throw and log error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValue(dbError);

      await expect(service.listRequests('dev-123')).rejects.toThrow('Query failed');
      expect(logger.error).toHaveBeenCalledWith('Error listing GDPR requests', {
        error: dbError,
        developerId: 'dev-123',
      });
    });
  });

  describe('cancelRequest', () => {
    it('should cancel a pending request', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_export',
            status: 'pending',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: null,
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'gdpr-req-123',
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: 'data_export',
            status: 'cancelled',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: null,
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        });

      const result = await service.cancelRequest('gdpr-req-123');

      expect(result).not.toBeNull();
      expect(result?.status).toBe('cancelled');
    });

    it('should return null if request not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.cancelRequest('invalid-id');

      expect(result).toBeNull();
    });

    it('should return null if request is not pending', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'gdpr-req-123',
          developer_id: 'dev-123',
          customer_id: 'cust-123',
          customer_email: 'customer@example.com',
          request_type: 'data_export',
          status: 'processing', // Not pending
          requested_by: 'customer@example.com',
          reason: null,
          data_categories: null,
          export_file_url: null,
          export_file_expires_at: null,
          processed_at: '2024-01-15T10:00:00Z',
          completed_at: null,
          error_message: null,
          metadata: null,
          created_at: '2024-01-15',
          updated_at: '2024-01-15',
        }],
      });

      const result = await service.cancelRequest('gdpr-req-123');

      expect(result).toBeNull();
    });

    it('should return null for completed request', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'gdpr-req-123',
          developer_id: 'dev-123',
          customer_id: 'cust-123',
          customer_email: 'customer@example.com',
          request_type: 'data_export',
          status: 'completed',
          requested_by: 'customer@example.com',
          reason: null,
          data_categories: null,
          export_file_url: 'https://example.com/export.json',
          export_file_expires_at: '2024-01-22',
          processed_at: '2024-01-15T10:00:00Z',
          completed_at: '2024-01-15T10:01:00Z',
          error_message: null,
          metadata: null,
          created_at: '2024-01-15',
          updated_at: '2024-01-15',
        }],
      });

      const result = await service.cancelRequest('gdpr-req-123');

      expect(result).toBeNull();
    });

    it('should return null for failed request', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'gdpr-req-123',
          developer_id: 'dev-123',
          customer_id: 'cust-123',
          customer_email: 'customer@example.com',
          request_type: 'data_export',
          status: 'failed',
          requested_by: 'customer@example.com',
          reason: null,
          data_categories: null,
          export_file_url: null,
          export_file_expires_at: null,
          processed_at: '2024-01-15T10:00:00Z',
          completed_at: null,
          error_message: 'Customer not found',
          metadata: null,
          created_at: '2024-01-15',
          updated_at: '2024-01-15',
        }],
      });

      const result = await service.cancelRequest('gdpr-req-123');

      expect(result).toBeNull();
    });
  });

  describe('mapRowToRequest', () => {
    it('should correctly map database row to GDPRRequest object', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'gdpr-req-123',
          developer_id: 'dev-123',
          customer_id: 'cust-123',
          customer_email: 'customer@example.com',
          request_type: 'data_export',
          status: 'completed',
          requested_by: 'admin@example.com',
          reason: 'Customer requested export',
          data_categories: ['personal', 'transactions'],
          export_file_url: 'https://storage.example.com/export.json',
          export_file_expires_at: '2024-01-22T00:00:00Z',
          processed_at: '2024-01-15T10:00:00Z',
          completed_at: '2024-01-15T10:05:00Z',
          error_message: null,
          metadata: { source: 'api', version: '1.0' },
          created_at: '2024-01-15T09:00:00Z',
          updated_at: '2024-01-15T10:05:00Z',
        }],
      });

      const result = await service.getRequest('gdpr-req-123');

      expect(result).toEqual({
        id: 'gdpr-req-123',
        developerId: 'dev-123',
        customerId: 'cust-123',
        customerEmail: 'customer@example.com',
        requestType: 'data_export',
        status: 'completed',
        requestedBy: 'admin@example.com',
        reason: 'Customer requested export',
        dataCategories: ['personal', 'transactions'],
        exportFileUrl: 'https://storage.example.com/export.json',
        exportFileExpiresAt: expect.any(Date),
        processedAt: expect.any(Date),
        completedAt: expect.any(Date),
        errorMessage: null,
        metadata: { source: 'api', version: '1.0' },
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('should handle null date fields correctly', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'gdpr-req-123',
          developer_id: 'dev-123',
          customer_id: null,
          customer_email: 'customer@example.com',
          request_type: 'data_export',
          status: 'pending',
          requested_by: 'customer@example.com',
          reason: null,
          data_categories: null,
          export_file_url: null,
          export_file_expires_at: null,
          processed_at: null,
          completed_at: null,
          error_message: null,
          metadata: null,
          created_at: '2024-01-15T09:00:00Z',
          updated_at: '2024-01-15T09:00:00Z',
        }],
      });

      const result = await service.getRequest('gdpr-req-123');

      expect(result?.customerId).toBeNull();
      expect(result?.reason).toBeNull();
      expect(result?.dataCategories).toBeNull();
      expect(result?.exportFileUrl).toBeNull();
      expect(result?.exportFileExpiresAt).toBeNull();
      expect(result?.processedAt).toBeNull();
      expect(result?.completedAt).toBeNull();
      expect(result?.errorMessage).toBeNull();
      expect(result?.metadata).toBeNull();
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('should handle empty string email gracefully in findByEmail', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(null);

      await expect(service.exportCustomerData('dev-123', '')).rejects.toThrow('Customer not found');
    });

    it('should handle concurrent requests to same customer', async () => {
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'gdpr-req-123',
          developer_id: 'dev-123',
          customer_id: 'cust-123',
          customer_email: 'customer@example.com',
          request_type: 'data_export',
          status: 'pending',
          requested_by: 'customer@example.com',
          reason: null,
          data_categories: null,
          export_file_url: null,
          export_file_expires_at: null,
          processed_at: null,
          completed_at: null,
          error_message: null,
          metadata: null,
          created_at: '2024-01-15',
          updated_at: '2024-01-15',
        }],
      });
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      // Simulate concurrent requests
      const [result1, result2] = await Promise.all([
        service.createRequest({
          developerId: 'dev-123',
          customerEmail: 'customer@example.com',
          requestType: 'data_export',
          requestedBy: 'customer@example.com',
        }),
        service.createRequest({
          developerId: 'dev-123',
          customerEmail: 'customer@example.com',
          requestType: 'data_export',
          requestedBy: 'customer@example.com',
        }),
      ]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });

    it('should handle very long reason strings', async () => {
      const longReason = 'A'.repeat(10000);
      mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'gdpr-req-123',
          developer_id: 'dev-123',
          customer_id: 'cust-123',
          customer_email: 'customer@example.com',
          request_type: 'data_export',
          status: 'pending',
          requested_by: 'customer@example.com',
          reason: longReason,
          data_categories: null,
          export_file_url: null,
          export_file_expires_at: null,
          processed_at: null,
          completed_at: null,
          error_message: null,
          metadata: null,
          created_at: '2024-01-15',
          updated_at: '2024-01-15',
        }],
      });
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.createRequest({
        developerId: 'dev-123',
        customerEmail: 'customer@example.com',
        requestType: 'data_export',
        requestedBy: 'customer@example.com',
        reason: longReason,
      });

      expect(result.reason).toBe(longReason);
    });

    it('should handle special characters in customer email', async () => {
      const specialEmail = "customer+test@example.com";
      const customerWithSpecialEmail = { ...mockCustomer, email: specialEmail };
      
      mockCustomerRepository.findByEmail.mockResolvedValue(customerWithSpecialEmail);
      mockPool.query.mockResolvedValue({
        rows: [{
          id: 'gdpr-req-123',
          developer_id: 'dev-123',
          customer_id: 'cust-123',
          customer_email: specialEmail,
          request_type: 'data_export',
          status: 'pending',
          requested_by: specialEmail,
          reason: null,
          data_categories: null,
          export_file_url: null,
          export_file_expires_at: null,
          processed_at: null,
          completed_at: null,
          error_message: null,
          metadata: null,
          created_at: '2024-01-15',
          updated_at: '2024-01-15',
        }],
      });
      mockAuditLogRepository.create.mockResolvedValue({} as any);

      const result = await service.createRequest({
        developerId: 'dev-123',
        customerEmail: specialEmail,
        requestType: 'data_export',
        requestedBy: specialEmail,
      });

      expect(result.customerEmail).toBe(specialEmail);
    });

    it('should handle all GDPR request types', async () => {
      const requestTypes: GDPRRequestType[] = ['data_export', 'data_deletion', 'data_rectification'];
      
      for (const requestType of requestTypes) {
        mockCustomerRepository.findByEmail.mockResolvedValue(mockCustomer);
        mockPool.query.mockResolvedValue({
          rows: [{
            id: `gdpr-req-${requestType}`,
            developer_id: 'dev-123',
            customer_id: 'cust-123',
            customer_email: 'customer@example.com',
            request_type: requestType,
            status: 'pending',
            requested_by: 'customer@example.com',
            reason: null,
            data_categories: null,
            export_file_url: null,
            export_file_expires_at: null,
            processed_at: null,
            completed_at: null,
            error_message: null,
            metadata: null,
            created_at: '2024-01-15',
            updated_at: '2024-01-15',
          }],
        });
        mockAuditLogRepository.create.mockResolvedValue({} as any);

        const result = await service.createRequest({
          developerId: 'dev-123',
          customerEmail: 'customer@example.com',
          requestType: requestType,
          requestedBy: 'customer@example.com',
        });

        expect(result.requestType).toBe(requestType);
      }
    });

    it('should handle all GDPR request statuses in listRequests', async () => {
      const statuses: GDPRRequestStatus[] = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
      
      for (const status of statuses) {
        mockPool.query
          .mockResolvedValueOnce({
            rows: [{
              id: `gdpr-req-${status}`,
              developer_id: 'dev-123',
              customer_id: 'cust-123',
              customer_email: 'customer@example.com',
              request_type: 'data_export',
              status: status,
              requested_by: 'customer@example.com',
              reason: null,
              data_categories: null,
              export_file_url: null,
              export_file_expires_at: null,
              processed_at: null,
              completed_at: null,
              error_message: null,
              metadata: null,
              created_at: '2024-01-15',
              updated_at: '2024-01-15',
            }],
          })
          .mockResolvedValueOnce({
            rows: [{ total: '1' }],
          });

        const result = await service.listRequests('dev-123', { status });

        expect(result.requests).toHaveLength(1);
        expect(result.requests[0].status).toBe(status);
      }
    });
  });
});
