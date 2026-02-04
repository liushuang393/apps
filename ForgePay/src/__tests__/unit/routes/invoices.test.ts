import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock the InvoiceService before importing the router
jest.mock('../../../services/InvoiceService', () => ({
  invoiceService: {
    getDeveloperInvoices: jest.fn(),
    getInvoice: jest.fn(),
    generateAndSavePdfInvoice: jest.fn(),
    generateHtmlInvoice: jest.fn(),
    sendInvoiceEmail: jest.fn(),
    voidInvoice: jest.fn(),
    getCustomerInvoices: jest.fn(),
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
      updatedAt: new Date('2024-01-01'),
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

import invoicesRouter from '../../../routes/invoices';
import { invoiceService } from '../../../services/InvoiceService';
import { apiKeyAuth } from '../../../middleware';

describe('Invoices Routes', () => {
  let app: Express;

  const mockDeveloper = {
    id: 'dev-123',
    email: 'developer@example.com',
    testMode: true,
    stripeAccountId: 'acct_123',
    webhookSecret: 'whsec_123',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockInvoice = {
    id: 'inv-123',
    invoiceNumber: 'INV-2024-001',
    developerId: 'dev-123',
    customerId: 'cust-123',
    status: 'paid',
    currency: 'usd',
    subtotal: 10000,
    taxAmount: 800,
    total: 10800,
    issuedAt: new Date('2024-01-15'),
    paidAt: new Date('2024-01-16'),
    pdfUrl: 'https://example.com/invoice.pdf',
    createdAt: new Date('2024-01-15'),
  };

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Reset apiKeyAuth to default behavior
    (apiKeyAuth as jest.Mock).mockImplementation(
      (req: Request, _res: Response, next: NextFunction) => {
        (req as any).developer = mockDeveloper;
        next();
      }
    );

    // Create fresh express app with router
    app = express();
    app.use(express.json());
    app.use('/invoices', invoicesRouter);
  });

  describe('GET /invoices', () => {
    it('should list invoices for authenticated developer', async () => {
      const mockResult = {
        invoices: [mockInvoice],
        total: 1,
      };

      (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/invoices')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        invoices: [
          {
            id: mockInvoice.id,
            invoiceNumber: mockInvoice.invoiceNumber,
            customerId: mockInvoice.customerId,
            status: mockInvoice.status,
            currency: mockInvoice.currency,
            subtotal: mockInvoice.subtotal,
            taxAmount: mockInvoice.taxAmount,
            total: mockInvoice.total,
            issuedAt: mockInvoice.issuedAt.toISOString(),
            paidAt: mockInvoice.paidAt.toISOString(),
            pdfUrl: mockInvoice.pdfUrl,
            createdAt: mockInvoice.createdAt.toISOString(),
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });

      expect(invoiceService.getDeveloperInvoices).toHaveBeenCalledWith('dev-123', {
        limit: 50,
        offset: 0,
        status: undefined,
      });
    });

    it('should use custom limit and offset', async () => {
      const mockResult = {
        invoices: [],
        total: 0,
      };

      (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/invoices?limit=10&offset=20')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(10);
      expect(response.body.offset).toBe(20);

      expect(invoiceService.getDeveloperInvoices).toHaveBeenCalledWith('dev-123', {
        limit: 10,
        offset: 20,
        status: undefined,
      });
    });

    it('should filter by status', async () => {
      const mockResult = {
        invoices: [],
        total: 0,
      };

      (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/invoices?status=paid')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);

      expect(invoiceService.getDeveloperInvoices).toHaveBeenCalledWith('dev-123', {
        limit: 50,
        offset: 0,
        status: 'paid',
      });
    });

    it('should handle invoices with null paidAt', async () => {
      const unpaidInvoice = {
        ...mockInvoice,
        status: 'open',
        paidAt: null,
      };

      const mockResult = {
        invoices: [unpaidInvoice],
        total: 1,
      };

      (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/invoices')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.invoices[0].paidAt).toBeNull();
    });

    it('should return empty array when no invoices exist', async () => {
      const mockResult = {
        invoices: [],
        total: 0,
      };

      (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/invoices')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.invoices).toEqual([]);
      expect(response.body.total).toBe(0);
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

      const response = await request(app).get('/invoices');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
    });

    it('should return 500 on service error', async () => {
      (invoiceService.getDeveloperInvoices as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .get('/invoices')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to list invoices' });
    });

    it('should default to limit 50 and offset 0 for invalid query params', async () => {
      const mockResult = {
        invoices: [],
        total: 0,
      };

      (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/invoices?limit=invalid&offset=invalid')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(50);
      expect(response.body.offset).toBe(0);
    });
  });

  describe('GET /invoices/:id', () => {
    it('should retrieve an invoice by ID', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);

      const response = await request(app)
        .get('/invoices/inv-123')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      // Response body has dates serialized as ISO strings
      expect(response.body.invoice.id).toBe(mockInvoice.id);
      expect(response.body.invoice.invoiceNumber).toBe(mockInvoice.invoiceNumber);
      expect(response.body.invoice.developerId).toBe(mockInvoice.developerId);
      expect(response.body.invoice.customerId).toBe(mockInvoice.customerId);
      expect(response.body.invoice.status).toBe(mockInvoice.status);
      expect(response.body.invoice.currency).toBe(mockInvoice.currency);
      expect(response.body.invoice.total).toBe(mockInvoice.total);

      expect(invoiceService.getInvoice).toHaveBeenCalledWith('inv-123');
    });

    it('should return 404 when invoice is not found', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/invoices/inv-nonexistent')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Invoice not found' });
    });

    it('should return 403 when invoice belongs to different developer', async () => {
      const otherDeveloperInvoice = {
        ...mockInvoice,
        developerId: 'dev-456',
      };

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(otherDeveloperInvoice);

      const response = await request(app)
        .get('/invoices/inv-123')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Access denied' });
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

      const response = await request(app).get('/invoices/inv-123');

      expect(response.status).toBe(401);
    });

    it('should return 500 on service error', async () => {
      (invoiceService.getInvoice as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .get('/invoices/inv-123')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get invoice' });
    });
  });

  describe('GET /invoices/:id/pdf', () => {
    it('should generate and return PDF invoice', async () => {
      const pdfBuffer = Buffer.from('PDF content');
      const mockPdfResult = {
        buffer: pdfBuffer,
        filename: 'invoice-INV-2024-001.pdf',
      };

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.generateAndSavePdfInvoice as jest.Mock).mockResolvedValue(mockPdfResult);

      const response = await request(app)
        .get('/invoices/inv-123/pdf')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="invoice-INV-2024-001.pdf"'
      );
      expect(response.headers['content-length']).toBe(String(pdfBuffer.length));
      expect(response.body).toEqual(pdfBuffer);

      expect(invoiceService.generateAndSavePdfInvoice).toHaveBeenCalledWith('inv-123');
    });

    it('should return 404 when invoice is not found', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/invoices/inv-nonexistent/pdf')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Invoice not found' });
    });

    it('should return 403 when invoice belongs to different developer', async () => {
      const otherDeveloperInvoice = {
        ...mockInvoice,
        developerId: 'dev-456',
      };

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(otherDeveloperInvoice);

      const response = await request(app)
        .get('/invoices/inv-123/pdf')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Access denied' });
    });

    it('should return 500 when PDF generation fails', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.generateAndSavePdfInvoice as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/invoices/inv-123/pdf')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to generate PDF' });
    });

    it('should return 500 on service error', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.generateAndSavePdfInvoice as jest.Mock).mockRejectedValue(
        new Error('PDF generation error')
      );

      const response = await request(app)
        .get('/invoices/inv-123/pdf')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to generate invoice PDF' });
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app).get('/invoices/inv-123/pdf');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /invoices/:id/html', () => {
    it('should generate and return HTML invoice', async () => {
      const mockHtml = '<html><body>Invoice HTML</body></html>';

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.generateHtmlInvoice as jest.Mock).mockResolvedValue(mockHtml);

      const response = await request(app)
        .get('/invoices/inv-123/html')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toBe(mockHtml);

      expect(invoiceService.generateHtmlInvoice).toHaveBeenCalledWith('inv-123');
    });

    it('should return 404 when invoice is not found', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/invoices/inv-nonexistent/html')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Invoice not found' });
    });

    it('should return 403 when invoice belongs to different developer', async () => {
      const otherDeveloperInvoice = {
        ...mockInvoice,
        developerId: 'dev-456',
      };

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(otherDeveloperInvoice);

      const response = await request(app)
        .get('/invoices/inv-123/html')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Access denied' });
    });

    it('should return 500 when HTML generation fails', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.generateHtmlInvoice as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/invoices/inv-123/html')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to generate invoice HTML' });
    });

    it('should return 500 on service error', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.generateHtmlInvoice as jest.Mock).mockRejectedValue(
        new Error('HTML generation error')
      );

      const response = await request(app)
        .get('/invoices/inv-123/html')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to generate invoice HTML' });
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app).get('/invoices/inv-123/html');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /invoices/:id/send', () => {
    it('should send invoice email successfully', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.sendInvoiceEmail as jest.Mock).mockResolvedValue(true);

      const response = await request(app)
        .post('/invoices/inv-123/send')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Invoice sent successfully',
      });

      expect(invoiceService.sendInvoiceEmail).toHaveBeenCalledWith('inv-123');
    });

    it('should return 404 when invoice is not found', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/invoices/inv-nonexistent/send')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Invoice not found' });
    });

    it('should return 403 when invoice belongs to different developer', async () => {
      const otherDeveloperInvoice = {
        ...mockInvoice,
        developerId: 'dev-456',
      };

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(otherDeveloperInvoice);

      const response = await request(app)
        .post('/invoices/inv-123/send')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Access denied' });
    });

    it('should return 500 when email sending fails', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.sendInvoiceEmail as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .post('/invoices/inv-123/send')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to send invoice email' });
    });

    it('should return 500 on service error', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.sendInvoiceEmail as jest.Mock).mockRejectedValue(
        new Error('Email service error')
      );

      const response = await request(app)
        .post('/invoices/inv-123/send')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to send invoice' });
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app).post('/invoices/inv-123/send');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /invoices/:id/void', () => {
    it('should void an invoice successfully', async () => {
      const voidedInvoice = {
        ...mockInvoice,
        status: 'voided',
      };

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.voidInvoice as jest.Mock).mockResolvedValue(voidedInvoice);

      const response = await request(app)
        .post('/invoices/inv-123/void')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      // Response body has dates serialized as ISO strings
      expect(response.body.invoice.id).toBe(voidedInvoice.id);
      expect(response.body.invoice.status).toBe('voided');
      expect(response.body.invoice.developerId).toBe(voidedInvoice.developerId);

      expect(invoiceService.voidInvoice).toHaveBeenCalledWith('inv-123');
    });

    it('should return 404 when invoice is not found', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/invoices/inv-nonexistent/void')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Invoice not found' });
    });

    it('should return 403 when invoice belongs to different developer', async () => {
      const otherDeveloperInvoice = {
        ...mockInvoice,
        developerId: 'dev-456',
      };

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(otherDeveloperInvoice);

      const response = await request(app)
        .post('/invoices/inv-123/void')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Access denied' });
    });

    it('should return 400 when invoice cannot be voided', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.voidInvoice as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/invoices/inv-123/void')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Cannot void this invoice' });
    });

    it('should return 400 with specific message when void throws "Cannot void" error', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.voidInvoice as jest.Mock).mockRejectedValue(
        new Error('Cannot void a paid invoice')
      );

      const response = await request(app)
        .post('/invoices/inv-123/void')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Cannot void a paid invoice' });
    });

    it('should return 500 on other service errors', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.voidInvoice as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .post('/invoices/inv-123/void')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to void invoice' });
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app).post('/invoices/inv-123/void');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /invoices/customer/:customerId', () => {
    it('should get invoices for a specific customer', async () => {
      const customerInvoices = [mockInvoice];

      (invoiceService.getCustomerInvoices as jest.Mock).mockResolvedValue(customerInvoices);

      const response = await request(app)
        .get('/invoices/customer/cust-123')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        invoices: [
          {
            id: mockInvoice.id,
            invoiceNumber: mockInvoice.invoiceNumber,
            status: mockInvoice.status,
            currency: mockInvoice.currency,
            total: mockInvoice.total,
            issuedAt: mockInvoice.issuedAt.toISOString(),
            paidAt: mockInvoice.paidAt.toISOString(),
          },
        ],
      });

      expect(invoiceService.getCustomerInvoices).toHaveBeenCalledWith('cust-123', {
        limit: 50,
        offset: 0,
      });
    });

    it('should use custom limit and offset', async () => {
      (invoiceService.getCustomerInvoices as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/invoices/customer/cust-123?limit=10&offset=5')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);

      expect(invoiceService.getCustomerInvoices).toHaveBeenCalledWith('cust-123', {
        limit: 10,
        offset: 5,
      });
    });

    it('should filter out invoices belonging to other developers', async () => {
      const mixedInvoices = [
        mockInvoice,
        { ...mockInvoice, id: 'inv-456', developerId: 'dev-456' },
      ];

      (invoiceService.getCustomerInvoices as jest.Mock).mockResolvedValue(mixedInvoices);

      const response = await request(app)
        .get('/invoices/customer/cust-123')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.invoices).toHaveLength(1);
      expect(response.body.invoices[0].id).toBe('inv-123');
    });

    it('should return empty array when no invoices belong to developer', async () => {
      const otherDeveloperInvoices = [
        { ...mockInvoice, developerId: 'dev-456' },
      ];

      (invoiceService.getCustomerInvoices as jest.Mock).mockResolvedValue(otherDeveloperInvoices);

      const response = await request(app)
        .get('/invoices/customer/cust-123')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.invoices).toEqual([]);
    });

    it('should handle invoices with null paidAt', async () => {
      const unpaidInvoice = {
        ...mockInvoice,
        status: 'open',
        paidAt: null,
      };

      (invoiceService.getCustomerInvoices as jest.Mock).mockResolvedValue([unpaidInvoice]);

      const response = await request(app)
        .get('/invoices/customer/cust-123')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.invoices[0].paidAt).toBeNull();
    });

    it('should return 500 on service error', async () => {
      (invoiceService.getCustomerInvoices as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app)
        .get('/invoices/customer/cust-123')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get customer invoices' });
    });

    it('should return 401 when API key is missing', async () => {
      (apiKeyAuth as jest.Mock).mockImplementationOnce(
        (_req: Request, res: Response, _next: NextFunction) => {
          res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Missing API key.',
              type: 'authentication_error',
            },
          });
        }
      );

      const response = await request(app).get('/invoices/customer/cust-123');

      expect(response.status).toBe(401);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple invoices in list response', async () => {
      const mockInvoices = [
        mockInvoice,
        { ...mockInvoice, id: 'inv-124', invoiceNumber: 'INV-2024-002' },
        { ...mockInvoice, id: 'inv-125', invoiceNumber: 'INV-2024-003' },
      ];

      const mockResult = {
        invoices: mockInvoices,
        total: 3,
      };

      (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/invoices')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.invoices).toHaveLength(3);
      expect(response.body.total).toBe(3);
    });

    it('should handle invoice with all optional fields as null', async () => {
      const minimalInvoice = {
        id: 'inv-minimal',
        invoiceNumber: 'INV-MIN-001',
        developerId: 'dev-123',
        customerId: 'cust-123',
        status: 'draft',
        currency: 'usd',
        subtotal: 0,
        taxAmount: 0,
        total: 0,
        issuedAt: null,
        paidAt: null,
        pdfUrl: null,
        createdAt: new Date('2024-01-01'),
      };

      const mockResult = {
        invoices: [minimalInvoice],
        total: 1,
      };

      (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/invoices')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.invoices[0].issuedAt).toBeNull();
      expect(response.body.invoices[0].paidAt).toBeNull();
      expect(response.body.invoices[0].pdfUrl).toBeNull();
    });

    it('should handle large PDF buffer', async () => {
      const largePdfBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
      const mockPdfResult = {
        buffer: largePdfBuffer,
        filename: 'large-invoice.pdf',
      };

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.generateAndSavePdfInvoice as jest.Mock).mockResolvedValue(mockPdfResult);

      const response = await request(app)
        .get('/invoices/inv-123/pdf')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.headers['content-length']).toBe(String(largePdfBuffer.length));
    });

    it('should handle special characters in invoice ID', async () => {
      const specialId = 'inv-123-abc-def';

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue({
        ...mockInvoice,
        id: specialId,
      });

      const response = await request(app)
        .get(`/invoices/${specialId}`)
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(invoiceService.getInvoice).toHaveBeenCalledWith(specialId);
    });

    it('should handle HTML with special characters', async () => {
      const mockHtml = '<html><body><p>Invoice &amp; Details &lt;special&gt;</p></body></html>';

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.generateHtmlInvoice as jest.Mock).mockResolvedValue(mockHtml);

      const response = await request(app)
        .get('/invoices/inv-123/html')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.text).toBe(mockHtml);
    });

    it('should handle different invoice statuses correctly', async () => {
      const statuses = ['draft', 'open', 'paid', 'voided', 'uncollectible'];

      for (const status of statuses) {
        const invoiceWithStatus = { ...mockInvoice, status };
        const mockResult = {
          invoices: [invoiceWithStatus],
          total: 1,
        };

        (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

        const response = await request(app)
          .get(`/invoices?status=${status}`)
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(200);
        expect(response.body.invoices[0].status).toBe(status);
      }
    });

    it('should handle different currencies correctly', async () => {
      const currencies = ['usd', 'eur', 'gbp', 'jpy', 'cny'];

      for (const currency of currencies) {
        const invoiceWithCurrency = { ...mockInvoice, currency };
        const mockResult = {
          invoices: [invoiceWithCurrency],
          total: 1,
        };

        (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

        const response = await request(app)
          .get('/invoices')
          .set('x-api-key', 'test_api_key');

        expect(response.status).toBe(200);
        expect(response.body.invoices[0].currency).toBe(currency);
      }
    });
  });

  describe('Response Format', () => {
    it('should return correct Content-Type header for JSON responses', async () => {
      const mockResult = {
        invoices: [],
        total: 0,
      };

      (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/invoices')
        .set('x-api-key', 'test_api_key');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return correct Content-Type header for PDF responses', async () => {
      const pdfBuffer = Buffer.from('PDF content');
      const mockPdfResult = {
        buffer: pdfBuffer,
        filename: 'test.pdf',
      };

      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.generateAndSavePdfInvoice as jest.Mock).mockResolvedValue(mockPdfResult);

      const response = await request(app)
        .get('/invoices/inv-123/pdf')
        .set('x-api-key', 'test_api_key');

      expect(response.headers['content-type']).toBe('application/pdf');
    });

    it('should return correct Content-Type header for HTML responses', async () => {
      (invoiceService.getInvoice as jest.Mock).mockResolvedValue(mockInvoice);
      (invoiceService.generateHtmlInvoice as jest.Mock).mockResolvedValue('<html></html>');

      const response = await request(app)
        .get('/invoices/inv-123/html')
        .set('x-api-key', 'test_api_key');

      expect(response.headers['content-type']).toMatch(/text\/html/);
    });

    it('should format dates as ISO 8601 strings in list response', async () => {
      const mockResult = {
        invoices: [mockInvoice],
        total: 1,
      };

      (invoiceService.getDeveloperInvoices as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/invoices')
        .set('x-api-key', 'test_api_key');

      expect(response.status).toBe(200);
      expect(response.body.invoices[0].issuedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
      );
      expect(response.body.invoices[0].createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
      );
    });
  });
});
