import { InvoiceRepository, CreateInvoiceParams, InvoiceLineItem, InvoiceStatus } from '../../../repositories/InvoiceRepository';

// Mock the logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('InvoiceRepository', () => {
  let mockPool: any;
  let repository: InvoiceRepository;

  const mockLineItems: InvoiceLineItem[] = [
    {
      description: 'Product A',
      quantity: 2,
      unitPrice: 1000,
      amount: 2000,
      productId: 'prod_123',
      priceId: 'price_123',
    },
    {
      description: 'Service B',
      quantity: 1,
      unitPrice: 500,
      amount: 500,
    },
  ];

  const createMockInvoiceRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'inv-123',
    invoice_number: 'INV-2024-000001',
    developer_id: 'dev-123',
    customer_id: 'cust-123',
    stripe_invoice_id: 'in_stripe_123',
    stripe_payment_intent_id: 'pi_stripe_123',
    status: 'draft',
    currency: 'usd',
    subtotal: 2500,
    tax_amount: 250,
    total: 2750,
    line_items: mockLineItems,
    billing_address: { line1: '123 Main St', city: 'NYC' },
    tax_details: { rate: 0.1, jurisdiction: 'NY' },
    pdf_url: null,
    pdf_generated_at: null,
    issued_at: null,
    paid_at: null,
    due_date: new Date('2024-02-01'),
    notes: 'Thank you for your business',
    metadata: { source: 'checkout' },
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
    ...overrides,
  });

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;

    repository = new InvoiceRepository(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new invoice with all fields', async () => {
      const params: CreateInvoiceParams = {
        developerId: 'dev-123',
        customerId: 'cust-123',
        stripeInvoiceId: 'in_stripe_123',
        stripePaymentIntentId: 'pi_stripe_123',
        currency: 'usd',
        subtotal: 2500,
        taxAmount: 250,
        total: 2750,
        lineItems: mockLineItems,
        billingAddress: { line1: '123 Main St', city: 'NYC' },
        taxDetails: { rate: 0.1, jurisdiction: 'NY' },
        dueDate: new Date('2024-02-01'),
        notes: 'Thank you for your business',
        metadata: { source: 'checkout' },
      };

      const mockRow = createMockInvoiceRow();

      // First call: generateInvoiceNumber
      mockPool.query.mockResolvedValueOnce({
        rows: [{ seq: '1' }],
        rowCount: 1,
      } as any);

      // Second call: INSERT
      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result).toEqual({
        id: 'inv-123',
        invoiceNumber: 'INV-2024-000001',
        developerId: params.developerId,
        customerId: params.customerId,
        stripeInvoiceId: params.stripeInvoiceId,
        stripePaymentIntentId: params.stripePaymentIntentId,
        status: 'draft',
        currency: params.currency,
        subtotal: params.subtotal,
        taxAmount: params.taxAmount,
        total: params.total,
        lineItems: mockLineItems,
        billingAddress: { line1: '123 Main St', city: 'NYC' },
        taxDetails: { rate: 0.1, jurisdiction: 'NY' },
        pdfUrl: null,
        pdfGeneratedAt: null,
        issuedAt: null,
        paidAt: null,
        dueDate: new Date('2024-02-01'),
        notes: 'Thank you for your business',
        metadata: { source: 'checkout' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('nextval')
      );
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO invoices'),
        expect.arrayContaining([
          expect.stringMatching(/^INV-\d{4}-\d{6}$/),
          params.developerId,
          params.customerId,
          params.stripeInvoiceId,
          params.stripePaymentIntentId,
          params.currency,
          params.subtotal,
          params.taxAmount,
          params.total,
          JSON.stringify(params.lineItems),
        ])
      );
    });

    it('should create an invoice without optional fields', async () => {
      const params: CreateInvoiceParams = {
        developerId: 'dev-123',
        customerId: 'cust-123',
        currency: 'usd',
        subtotal: 1000,
        total: 1000,
        lineItems: [mockLineItems[0]],
      };

      const mockRow = createMockInvoiceRow({
        stripe_invoice_id: null,
        stripe_payment_intent_id: null,
        tax_amount: 0,
        billing_address: null,
        tax_details: null,
        due_date: null,
        notes: null,
        metadata: null,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [{ seq: '2' }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.stripeInvoiceId).toBeNull();
      expect(result.stripePaymentIntentId).toBeNull();
      expect(result.taxAmount).toBe(0);
      expect(result.billingAddress).toBeNull();
      expect(result.taxDetails).toBeNull();
      expect(result.dueDate).toBeNull();
      expect(result.notes).toBeNull();
      expect(result.metadata).toBeNull();

      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO invoices'),
        expect.arrayContaining([
          null, // stripeInvoiceId
          null, // stripePaymentIntentId
        ])
      );
    });

    it('should throw error on database failure', async () => {
      const params: CreateInvoiceParams = {
        developerId: 'dev-123',
        customerId: 'cust-123',
        currency: 'usd',
        subtotal: 1000,
        total: 1000,
        lineItems: [mockLineItems[0]],
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ seq: '3' }],
        rowCount: 1,
      } as any);

      const dbError = new Error('Database connection failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow('Database connection failed');
    });

    it('should throw error if invoice number generation fails', async () => {
      const params: CreateInvoiceParams = {
        developerId: 'dev-123',
        customerId: 'cust-123',
        currency: 'usd',
        subtotal: 1000,
        total: 1000,
        lineItems: [mockLineItems[0]],
      };

      const dbError = new Error('Sequence error');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow('Sequence error');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const params: CreateInvoiceParams = {
        developerId: 'dev-123',
        customerId: 'cust-123',
        currency: 'usd',
        subtotal: 1000,
        total: 1000,
        lineItems: [mockLineItems[0]],
      };

      const mockRow = createMockInvoiceRow();

      mockClient.query.mockResolvedValueOnce({
        rows: [{ seq: '4' }],
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

    it('should generate correct invoice number format', async () => {
      const params: CreateInvoiceParams = {
        developerId: 'dev-123',
        customerId: 'cust-123',
        currency: 'usd',
        subtotal: 1000,
        total: 1000,
        lineItems: [mockLineItems[0]],
      };

      const mockRow = createMockInvoiceRow({
        invoice_number: `INV-${new Date().getFullYear()}-000042`,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [{ seq: '42' }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.invoiceNumber).toMatch(/^INV-\d{4}-000042$/);
    });
  });

  describe('findById', () => {
    it('should find an invoice by ID', async () => {
      const mockRow = createMockInvoiceRow();

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('inv-123');

      expect(result).toEqual({
        id: 'inv-123',
        invoiceNumber: 'INV-2024-000001',
        developerId: 'dev-123',
        customerId: 'cust-123',
        stripeInvoiceId: 'in_stripe_123',
        stripePaymentIntentId: 'pi_stripe_123',
        status: 'draft',
        currency: 'usd',
        subtotal: 2500,
        taxAmount: 250,
        total: 2750,
        lineItems: mockLineItems,
        billingAddress: { line1: '123 Main St', city: 'NYC' },
        taxDetails: { rate: 0.1, jurisdiction: 'NY' },
        pdfUrl: null,
        pdfGeneratedAt: null,
        issuedAt: null,
        paidAt: null,
        dueDate: new Date('2024-02-01'),
        notes: 'Thank you for your business',
        metadata: { source: 'checkout' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM invoices WHERE id = $1'),
        ['inv-123']
      );
    });

    it('should return null if invoice not found', async () => {
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

      await expect(repository.findById('inv-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = createMockInvoiceRow();

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.findById('inv-123', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByInvoiceNumber', () => {
    it('should find an invoice by invoice number', async () => {
      const mockRow = createMockInvoiceRow();

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findByInvoiceNumber('INV-2024-000001');

      expect(result).not.toBeNull();
      expect(result?.invoiceNumber).toBe('INV-2024-000001');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE invoice_number = $1'),
        ['INV-2024-000001']
      );
    });

    it('should return null if invoice not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByInvoiceNumber('INV-9999-000000');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByInvoiceNumber('INV-2024-000001')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByInvoiceNumber('INV-2024-000001', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('findByCustomerId', () => {
    it('should find all invoices for a customer', async () => {
      const mockRows = [
        createMockInvoiceRow({ id: 'inv-1', invoice_number: 'INV-2024-000001' }),
        createMockInvoiceRow({ id: 'inv-2', invoice_number: 'INV-2024-000002' }),
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      const result = await repository.findByCustomerId('cust-123');

      expect(result).toHaveLength(2);
      expect(result[0].customerId).toBe('cust-123');
      expect(result[1].customerId).toBe('cust-123');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE customer_id = $1'),
        ['cust-123', 50, 0]
      );
    });

    it('should apply pagination options', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByCustomerId('cust-123', { limit: 10, offset: 20 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        ['cust-123', 10, 20]
      );
    });

    it('should filter by status when provided', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByCustomerId('cust-123', { status: 'paid' });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND status = $2'),
        ['cust-123', 'paid', 50, 0]
      );
    });

    it('should return empty array if no invoices found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.findByCustomerId('cust-empty');

      expect(result).toEqual([]);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByCustomerId('cust-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByCustomerId('cust-123', undefined, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should return invoices ordered by created_at descending', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByCustomerId('cust-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Array)
      );
    });
  });

  describe('findByDeveloperId', () => {
    it('should find all invoices for a developer with total count', async () => {
      const mockRows = [
        createMockInvoiceRow({ id: 'inv-1' }),
        createMockInvoiceRow({ id: 'inv-2' }),
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockRows,
        rowCount: 2,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [{ total: '10' }],
        rowCount: 1,
      } as any);

      const result = await repository.findByDeveloperId('dev-123');

      expect(result.invoices).toHaveLength(2);
      expect(result.total).toBe(10);
      expect(result.invoices[0].developerId).toBe('dev-123');
    });

    it('should apply pagination options', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [{ total: '0' }],
        rowCount: 1,
      } as any);

      await repository.findByDeveloperId('dev-123', { limit: 25, offset: 50 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        ['dev-123', 25, 50]
      );
    });

    it('should filter by status when provided', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [{ total: '0' }],
        rowCount: 1,
      } as any);

      await repository.findByDeveloperId('dev-123', { status: 'issued' });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND status = $2'),
        expect.arrayContaining(['dev-123', 'issued'])
      );
    });

    it('should return empty invoices array and zero total if none found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [{ total: '0' }],
        rowCount: 1,
      } as any);

      const result = await repository.findByDeveloperId('dev-empty');

      expect(result.invoices).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByDeveloperId('dev-123')).rejects.toThrow('Query failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      mockClient.query.mockResolvedValueOnce({
        rows: [{ total: '0' }],
        rowCount: 1,
      } as any);

      await repository.findByDeveloperId('dev-123', undefined, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should return invoices ordered by created_at descending', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [{ total: '0' }],
        rowCount: 1,
      } as any);

      await repository.findByDeveloperId('dev-123');

      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Array)
      );
    });
  });

  describe('updateStatus', () => {
    it('should update invoice status to draft', async () => {
      const mockRow = createMockInvoiceRow({ status: 'draft' });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.updateStatus('inv-123', 'draft');

      expect(result?.status).toBe('draft');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE invoices'),
        ['draft', 'inv-123']
      );
    });

    it('should update invoice status to issued and set issued_at', async () => {
      const mockRow = createMockInvoiceRow({
        status: 'issued',
        issued_at: new Date('2024-01-15'),
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.updateStatus('inv-123', 'issued');

      expect(result?.status).toBe('issued');
      expect(result?.issuedAt).toEqual(new Date('2024-01-15'));
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('issued_at = NOW()'),
        ['issued', 'inv-123']
      );
    });

    it('should update invoice status to paid and set paid_at', async () => {
      const mockRow = createMockInvoiceRow({
        status: 'paid',
        paid_at: new Date('2024-01-20'),
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.updateStatus('inv-123', 'paid');

      expect(result?.status).toBe('paid');
      expect(result?.paidAt).toEqual(new Date('2024-01-20'));
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('paid_at = NOW()'),
        ['paid', 'inv-123']
      );
    });

    it('should update invoice status to void', async () => {
      const mockRow = createMockInvoiceRow({ status: 'void' });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.updateStatus('inv-123', 'void');

      expect(result?.status).toBe('void');
    });

    it('should update invoice status to refunded', async () => {
      const mockRow = createMockInvoiceRow({ status: 'refunded' });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.updateStatus('inv-123', 'refunded');

      expect(result?.status).toBe('refunded');
    });

    it('should return null if invoice not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.updateStatus('nonexistent', 'paid');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.updateStatus('inv-123', 'paid')).rejects.toThrow('Update failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const mockRow = createMockInvoiceRow({ status: 'paid' });

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.updateStatus('inv-123', 'paid', mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should always update updated_at field', async () => {
      const mockRow = createMockInvoiceRow({ status: 'void' });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.updateStatus('inv-123', 'void');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('updated_at = NOW()'),
        expect.any(Array)
      );
    });
  });

  describe('updatePdfUrl', () => {
    it('should update PDF URL and set pdf_generated_at', async () => {
      const pdfUrl = 'https://example.com/invoices/inv-123.pdf';
      const mockRow = createMockInvoiceRow({
        pdf_url: pdfUrl,
        pdf_generated_at: new Date('2024-01-15'),
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.updatePdfUrl('inv-123', pdfUrl);

      expect(result?.pdfUrl).toBe(pdfUrl);
      expect(result?.pdfGeneratedAt).toEqual(new Date('2024-01-15'));
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SET pdf_url = $1, pdf_generated_at = NOW()'),
        [pdfUrl, 'inv-123']
      );
    });

    it('should return null if invoice not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const result = await repository.updatePdfUrl('nonexistent', 'https://example.com/pdf.pdf');

      expect(result).toBeNull();
    });

    it('should throw error on database failure', async () => {
      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.updatePdfUrl('inv-123', 'https://example.com/pdf.pdf')).rejects.toThrow('Update failed');
    });

    it('should use provided client for transactions', async () => {
      const mockClient = {
        query: jest.fn(),
      } as any;

      const pdfUrl = 'https://example.com/invoices/inv-123.pdf';
      const mockRow = createMockInvoiceRow({ pdf_url: pdfUrl });

      mockClient.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.updatePdfUrl('inv-123', pdfUrl, mockClient);

      expect(mockClient.query).toHaveBeenCalled();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should always update updated_at field', async () => {
      const pdfUrl = 'https://example.com/invoices/inv-123.pdf';
      const mockRow = createMockInvoiceRow({ pdf_url: pdfUrl });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.updatePdfUrl('inv-123', pdfUrl);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('updated_at = NOW()'),
        expect.any(Array)
      );
    });
  });

  describe('edge cases', () => {
    it('should handle invoice with empty line items array', async () => {
      const params: CreateInvoiceParams = {
        developerId: 'dev-123',
        customerId: 'cust-123',
        currency: 'usd',
        subtotal: 0,
        total: 0,
        lineItems: [],
      };

      const mockRow = createMockInvoiceRow({
        line_items: [],
        subtotal: 0,
        total: 0,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [{ seq: '5' }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.create(params);

      expect(result.lineItems).toEqual([]);
    });

    it('should handle invoice with multiple line items', async () => {
      const multiLineItems: InvoiceLineItem[] = [
        { description: 'Item 1', quantity: 1, unitPrice: 100, amount: 100 },
        { description: 'Item 2', quantity: 2, unitPrice: 200, amount: 400 },
        { description: 'Item 3', quantity: 3, unitPrice: 300, amount: 900 },
        { description: 'Item 4', quantity: 4, unitPrice: 400, amount: 1600 },
        { description: 'Item 5', quantity: 5, unitPrice: 500, amount: 2500 },
      ];

      const mockRow = createMockInvoiceRow({
        line_items: multiLineItems,
        subtotal: 5500,
        total: 5500,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('inv-multi');

      expect(result?.lineItems).toHaveLength(5);
    });

    it('should handle very long PDF URL', async () => {
      const longUrl = 'https://example.com/invoices/' + 'a'.repeat(500) + '.pdf';
      const mockRow = createMockInvoiceRow({ pdf_url: longUrl });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.updatePdfUrl('inv-123', longUrl);

      expect(result?.pdfUrl).toBe(longUrl);
    });

    it('should handle different currency codes', async () => {
      const currencies = ['usd', 'eur', 'gbp', 'jpy', 'cad', 'aud'];

      for (const currency of currencies) {
        jest.clearAllMocks();

        const mockRow = createMockInvoiceRow({ currency });

        mockPool.query.mockResolvedValueOnce({
          rows: [mockRow],
          rowCount: 1,
        } as any);

        const result = await repository.findById('inv-123');

        expect(result?.currency).toBe(currency);
      }
    });

    it('should handle all invoice statuses', async () => {
      const statuses: InvoiceStatus[] = ['draft', 'issued', 'paid', 'void', 'refunded'];

      for (const status of statuses) {
        jest.clearAllMocks();

        const mockRow = createMockInvoiceRow({ status });

        mockPool.query.mockResolvedValueOnce({
          rows: [mockRow],
          rowCount: 1,
        } as any);

        const result = await repository.findById('inv-123');

        expect(result?.status).toBe(status);
      }
    });

    it('should handle complex billing address', async () => {
      const complexAddress = {
        line1: '123 Main St',
        line2: 'Suite 456',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        country: 'US',
        name: 'John Doe',
        phone: '+1-555-555-5555',
      };

      const mockRow = createMockInvoiceRow({
        billing_address: complexAddress,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('inv-123');

      expect(result?.billingAddress).toEqual(complexAddress);
    });

    it('should handle complex tax details', async () => {
      const complexTaxDetails = {
        rate: 0.0875,
        jurisdiction: 'NY',
        taxId: 'VAT123456',
        breakdown: [
          { name: 'State Tax', rate: 0.04, amount: 100 },
          { name: 'City Tax', rate: 0.045, amount: 112.5 },
          { name: 'MTA Surcharge', rate: 0.00375, amount: 9.38 },
        ],
      };

      const mockRow = createMockInvoiceRow({
        tax_details: complexTaxDetails,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('inv-123');

      expect(result?.taxDetails).toEqual(complexTaxDetails);
    });

    it('should handle zero subtotal and total', async () => {
      const mockRow = createMockInvoiceRow({
        subtotal: 0,
        tax_amount: 0,
        total: 0,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('inv-123');

      expect(result?.subtotal).toBe(0);
      expect(result?.taxAmount).toBe(0);
      expect(result?.total).toBe(0);
    });

    it('should handle very large amounts', async () => {
      const mockRow = createMockInvoiceRow({
        subtotal: 99999999.99,
        tax_amount: 9999999.99,
        total: 109999999.98,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('inv-123');

      expect(result?.subtotal).toBe(99999999.99);
      expect(result?.total).toBe(109999999.98);
    });

    it('should handle line items with optional productId and priceId', async () => {
      const mixedLineItems: InvoiceLineItem[] = [
        { description: 'With IDs', quantity: 1, unitPrice: 100, amount: 100, productId: 'prod_1', priceId: 'price_1' },
        { description: 'Without IDs', quantity: 1, unitPrice: 100, amount: 100 },
        { description: 'Only productId', quantity: 1, unitPrice: 100, amount: 100, productId: 'prod_2' },
      ];

      const mockRow = createMockInvoiceRow({
        line_items: mixedLineItems,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('inv-123');

      expect(result?.lineItems[0].productId).toBe('prod_1');
      expect(result?.lineItems[0].priceId).toBe('price_1');
      expect(result?.lineItems[1].productId).toBeUndefined();
      expect(result?.lineItems[1].priceId).toBeUndefined();
      expect(result?.lineItems[2].productId).toBe('prod_2');
      expect(result?.lineItems[2].priceId).toBeUndefined();
    });

    it('should handle unicode characters in notes', async () => {
      const unicodeNotes = '感谢您的惠顾 / Merci pour votre achat / 🎉 Thank you!';

      const mockRow = createMockInvoiceRow({
        notes: unicodeNotes,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('inv-123');

      expect(result?.notes).toBe(unicodeNotes);
    });

    it('should properly map dates with timezone information', async () => {
      const createdAt = new Date('2024-01-15T10:30:00.000Z');
      const updatedAt = new Date('2024-02-20T14:45:00.000Z');
      const issuedAt = new Date('2024-01-16T09:00:00.000Z');
      const paidAt = new Date('2024-01-20T11:30:00.000Z');
      const dueDate = new Date('2024-02-15T00:00:00.000Z');
      const pdfGeneratedAt = new Date('2024-01-16T09:15:00.000Z');

      const mockRow = createMockInvoiceRow({
        created_at: createdAt,
        updated_at: updatedAt,
        issued_at: issuedAt,
        paid_at: paidAt,
        due_date: dueDate,
        pdf_generated_at: pdfGeneratedAt,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('inv-123');

      expect(result?.createdAt).toEqual(createdAt);
      expect(result?.updatedAt).toEqual(updatedAt);
      expect(result?.issuedAt).toEqual(issuedAt);
      expect(result?.paidAt).toEqual(paidAt);
      expect(result?.dueDate).toEqual(dueDate);
      expect(result?.pdfGeneratedAt).toEqual(pdfGeneratedAt);
    });

    it('should handle null date fields', async () => {
      const mockRow = createMockInvoiceRow({
        issued_at: null,
        paid_at: null,
        due_date: null,
        pdf_generated_at: null,
      });

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      const result = await repository.findById('inv-123');

      expect(result?.issuedAt).toBeNull();
      expect(result?.paidAt).toBeNull();
      expect(result?.dueDate).toBeNull();
      expect(result?.pdfGeneratedAt).toBeNull();
    });
  });

  describe('error logging', () => {
    it('should log error when create fails', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateInvoiceParams = {
        developerId: 'dev-123',
        customerId: 'cust-123',
        currency: 'usd',
        subtotal: 1000,
        total: 1000,
        lineItems: [mockLineItems[0]],
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{ seq: '6' }],
        rowCount: 1,
      } as any);

      const dbError = new Error('Insert failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.create(params)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error creating invoice',
        expect.objectContaining({
          error: dbError,
        })
      );
    });

    it('should log error when findById fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findById('inv-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding invoice',
        expect.objectContaining({
          error: dbError,
          id: 'inv-123',
        })
      );
    });

    it('should log error when findByInvoiceNumber fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByInvoiceNumber('INV-2024-000001')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding invoice by number',
        expect.objectContaining({
          error: dbError,
          invoiceNumber: 'INV-2024-000001',
        })
      );
    });

    it('should log error when findByCustomerId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByCustomerId('cust-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding invoices by customer',
        expect.objectContaining({
          error: dbError,
          customerId: 'cust-123',
        })
      );
    });

    it('should log error when findByDeveloperId fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Query failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.findByDeveloperId('dev-123')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error finding invoices by developer',
        expect.objectContaining({
          error: dbError,
          developerId: 'dev-123',
        })
      );
    });

    it('should log error when updateStatus fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.updateStatus('inv-123', 'paid')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error updating invoice status',
        expect.objectContaining({
          error: dbError,
          id: 'inv-123',
          status: 'paid',
        })
      );
    });

    it('should log error when updatePdfUrl fails', async () => {
      const { logger } = require('../../../utils/logger');

      const dbError = new Error('Update failed');
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(repository.updatePdfUrl('inv-123', 'https://example.com/pdf.pdf')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Error updating invoice PDF URL',
        expect.objectContaining({
          error: dbError,
          id: 'inv-123',
        })
      );
    });

    it('should log success when invoice is created', async () => {
      const { logger } = require('../../../utils/logger');

      const params: CreateInvoiceParams = {
        developerId: 'dev-123',
        customerId: 'cust-123',
        currency: 'usd',
        subtotal: 1000,
        total: 1000,
        lineItems: [mockLineItems[0]],
      };

      const mockRow = createMockInvoiceRow();

      mockPool.query.mockResolvedValueOnce({
        rows: [{ seq: '7' }],
        rowCount: 1,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [mockRow],
        rowCount: 1,
      } as any);

      await repository.create(params);

      expect(logger.info).toHaveBeenCalledWith(
        'Invoice created',
        expect.objectContaining({
          invoiceId: 'inv-123',
          invoiceNumber: 'INV-2024-000001',
        })
      );
    });
  });

  describe('pagination edge cases', () => {
    it('should use default limit and offset when not provided for findByCustomerId', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByCustomerId('cust-123');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['cust-123', 50, 0] // default limit=50, offset=0
      );
    });

    it('should use default limit and offset when not provided for findByDeveloperId', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [{ total: '0' }],
        rowCount: 1,
      } as any);

      await repository.findByDeveloperId('dev-123');

      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        ['dev-123', 50, 0] // default limit=50, offset=0
      );
    });

    it('should handle large offset values', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByCustomerId('cust-123', { offset: 10000 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['cust-123', 50, 10000]
      );
    });

    it('should handle small limit values', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      await repository.findByCustomerId('cust-123', { limit: 1 });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['cust-123', 1, 0]
      );
    });
  });
});
