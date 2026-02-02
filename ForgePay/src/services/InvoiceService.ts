import {
  InvoiceRepository,
  invoiceRepository,
  Invoice,
  InvoiceLineItem,
  CreateInvoiceParams,
} from '../repositories/InvoiceRepository';
import { CustomerRepository, customerRepository } from '../repositories/CustomerRepository';
import { ProductRepository, productRepository } from '../repositories/ProductRepository';
import { EmailService, emailService } from './EmailService';
import { CurrencyService, currencyService } from './CurrencyService';
import { config } from '../config';
import { logger } from '../utils/logger';
// @ts-ignore - pdfkit will be installed via npm install
import PDFDocument from 'pdfkit';

/**
 * Invoice generation parameters
 */
export interface GenerateInvoiceParams {
  developerId: string;
  customerId: string;
  paymentIntentId?: string;
  stripeInvoiceId?: string;
  items: {
    productId: string;
    priceId: string;
    quantity: number;
    unitAmount: number;
    description?: string;
  }[];
  currency: string;
  taxAmount?: number;
  billingAddress?: {
    name?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Invoice PDF data structure
 */
export interface InvoicePdfData {
  invoiceNumber: string;
  issuedDate: string;
  dueDate: string | null;
  status: string;
  
  seller: {
    name: string;
    address?: string;
    email?: string;
    taxId?: string;
  };
  
  buyer: {
    name: string;
    email: string;
    address?: string;
    taxId?: string;
  };
  
  items: {
    description: string;
    quantity: number;
    unitPrice: string;
    amount: string;
  }[];
  
  subtotal: string;
  taxAmount: string;
  taxRate?: string;
  total: string;
  currency: string;
  
  notes?: string;
  paymentTerms?: string;
}

/**
 * InvoiceService handles invoice generation and management
 * 
 * Requirements: 11.1, 11.2, 11.3
 */
export class InvoiceService {
  private invoiceRepo: InvoiceRepository;
  private customerRepo: CustomerRepository;
  private productRepo: ProductRepository;
  private emailSvc: EmailService;
  private currencySvc: CurrencyService;

  constructor(
    invoiceRepo: InvoiceRepository = invoiceRepository,
    customerRepo: CustomerRepository = customerRepository,
    productRepo: ProductRepository = productRepository,
    emailSvc: EmailService = emailService,
    currencySvc: CurrencyService = currencyService
  ) {
    this.invoiceRepo = invoiceRepo;
    this.customerRepo = customerRepo;
    this.productRepo = productRepo;
    this.emailSvc = emailSvc;
    this.currencySvc = currencySvc;
  }

  /**
   * Generate invoice from payment
   */
  async generateFromPayment(params: GenerateInvoiceParams): Promise<Invoice> {
    // Build line items
    const lineItems: InvoiceLineItem[] = [];
    
    for (const item of params.items) {
      const product = await this.productRepo.findById(item.productId);
      
      lineItems.push({
        description: item.description || product?.name || 'Product',
        quantity: item.quantity,
        unitPrice: item.unitAmount,
        amount: item.quantity * item.unitAmount,
        productId: item.productId,
        priceId: item.priceId,
      });
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
    const taxAmount = params.taxAmount || 0;
    const total = subtotal + taxAmount;

    // Create invoice
    const createParams: CreateInvoiceParams = {
      developerId: params.developerId,
      customerId: params.customerId,
      stripeInvoiceId: params.stripeInvoiceId,
      stripePaymentIntentId: params.paymentIntentId,
      currency: params.currency,
      subtotal,
      taxAmount,
      total,
      lineItems,
      billingAddress: params.billingAddress,
      metadata: params.metadata,
    };

    const invoice = await this.invoiceRepo.create(createParams);

    // Issue the invoice immediately
    await this.invoiceRepo.updateStatus(invoice.id, 'issued');

    logger.info('Invoice generated from payment', {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      total,
    });

    return invoice;
  }

  /**
   * Get invoice by ID
   */
  async getInvoice(id: string): Promise<Invoice | null> {
    return this.invoiceRepo.findById(id);
  }

  /**
   * Get invoice by number
   */
  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | null> {
    return this.invoiceRepo.findByInvoiceNumber(invoiceNumber);
  }

  /**
   * Get invoices for a customer
   */
  async getCustomerInvoices(
    customerId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<Invoice[]> {
    return this.invoiceRepo.findByCustomerId(customerId, options);
  }

  /**
   * Get invoices for a developer
   */
  async getDeveloperInvoices(
    developerId: string,
    options?: { limit?: number; offset?: number; status?: string }
  ): Promise<{ invoices: Invoice[]; total: number }> {
    return this.invoiceRepo.findByDeveloperId(developerId, options as Parameters<typeof this.invoiceRepo.findByDeveloperId>[1]);
  }

  /**
   * Mark invoice as paid
   */
  async markAsPaid(id: string): Promise<Invoice | null> {
    const invoice = await this.invoiceRepo.updateStatus(id, 'paid');
    
    if (invoice) {
      logger.info('Invoice marked as paid', { invoiceId: id });
    }
    
    return invoice;
  }

  /**
   * Void an invoice
   */
  async voidInvoice(id: string): Promise<Invoice | null> {
    const invoice = await this.invoiceRepo.findById(id);
    
    if (!invoice) {
      return null;
    }
    
    if (invoice.status === 'paid') {
      throw new Error('Cannot void a paid invoice');
    }
    
    return this.invoiceRepo.updateStatus(id, 'void');
  }

  /**
   * Generate PDF data for an invoice
   */
  async generatePdfData(invoiceId: string): Promise<InvoicePdfData | null> {
    const invoice = await this.invoiceRepo.findById(invoiceId);
    if (!invoice) {
      return null;
    }

    const customer = await this.customerRepo.findById(invoice.customerId);
    if (!customer) {
      return null;
    }

    const currency = invoice.currency.toUpperCase();

    // Format amounts
    const formatAmount = (amount: number): string => {
      return this.currencySvc.formatAmount(
        amount / 100, // Convert from cents
        invoice.currency as Parameters<typeof this.currencySvc.formatAmount>[1]
      );
    };

    const pdfData: InvoicePdfData = {
      invoiceNumber: invoice.invoiceNumber,
      issuedDate: invoice.issuedAt?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
      dueDate: invoice.dueDate?.toISOString().split('T')[0] || null,
      status: invoice.status,

      seller: {
        name: 'ForgePay',
        email: config.email?.fromEmail,
      },

      buyer: {
        name: customer.name || customer.email,
        email: customer.email,
        address: invoice.billingAddress
          ? this.formatAddress(invoice.billingAddress)
          : undefined,
      },

      items: invoice.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: formatAmount(item.unitPrice),
        amount: formatAmount(item.amount),
      })),

      subtotal: formatAmount(invoice.subtotal),
      taxAmount: formatAmount(invoice.taxAmount),
      total: formatAmount(invoice.total),
      currency,

      notes: invoice.notes || undefined,
    };

    return pdfData;
  }

  /**
   * Generate HTML invoice (can be converted to PDF)
   */
  async generateHtmlInvoice(invoiceId: string): Promise<string | null> {
    const data = await this.generatePdfData(invoiceId);
    if (!data) {
      return null;
    }

    return this.renderInvoiceHtml(data);
  }

  /**
   * Generate PDF invoice as a Buffer
   * 
   * Uses PDFKit to create a professional invoice PDF
   * Requirements: 7.5 - PDF Invoice Generation
   */
  async generatePdfInvoice(invoiceId: string): Promise<Buffer | null> {
    const data = await this.generatePdfData(invoiceId);
    if (!data) {
      return null;
    }

    return new Promise((resolve, reject) => {
      try {
        const chunks: Buffer[] = [];
        const doc = new PDFDocument({ 
          size: 'A4',
          margin: 50,
          bufferPages: true,
        });

        // Collect PDF chunks
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Colors
        const primaryColor = '#0284c7';
        const textColor = '#333333';
        const lightGray = '#f5f5f5';
        const borderColor = '#e5e5e5';

        // Header
        doc.fontSize(28)
           .fillColor(primaryColor)
           .text('INVOICE', 50, 50);

        doc.fontSize(10)
           .fillColor(textColor)
           .text(data.seller.name, 50, 85);
        
        if (data.seller.email) {
          doc.text(data.seller.email);
        }

        // Invoice details (right side)
        doc.fontSize(10)
           .text(`Invoice: ${data.invoiceNumber}`, 400, 50, { align: 'right' });
        doc.text(`Issued: ${data.issuedDate}`, { align: 'right' });
        if (data.dueDate) {
          doc.text(`Due: ${data.dueDate}`, { align: 'right' });
        }

        // Status badge
        const statusColors: Record<string, string> = {
          paid: '#166534',
          issued: '#1e40af',
          draft: '#374151',
          void: '#991b1b',
          refunded: '#92400e',
        };
        const statusBgColors: Record<string, string> = {
          paid: '#dcfce7',
          issued: '#dbeafe',
          draft: '#f3f4f6',
          void: '#fee2e2',
          refunded: '#fef3c7',
        };

        const statusY = 105;
        const statusText = data.status.toUpperCase();
        const statusWidth = 60;
        
        doc.roundedRect(485 - statusWidth, statusY - 2, statusWidth, 16, 3)
           .fill(statusBgColors[data.status] || lightGray);
        doc.fontSize(8)
           .fillColor(statusColors[data.status] || textColor)
           .text(statusText, 485 - statusWidth, statusY, { width: statusWidth, align: 'center' });

        // Bill To section
        const billToY = 150;
        doc.fontSize(10)
           .fillColor('#666666')
           .text('BILL TO', 50, billToY);
        
        doc.fontSize(12)
           .fillColor(textColor)
           .font('Helvetica-Bold')
           .text(data.buyer.name, 50, billToY + 15);
        
        doc.font('Helvetica')
           .fontSize(10)
           .text(data.buyer.email);
        
        if (data.buyer.address) {
          const addressLines = data.buyer.address.split('\n');
          addressLines.forEach(line => doc.text(line));
        }

        // Line items table
        const tableTop = 250;
        const tableLeft = 50;
        const colWidths = [250, 60, 90, 90];
        const colPositions = [
          tableLeft,
          tableLeft + colWidths[0],
          tableLeft + colWidths[0] + colWidths[1],
          tableLeft + colWidths[0] + colWidths[1] + colWidths[2],
        ];

        // Table header background
        doc.rect(tableLeft, tableTop, 495, 25)
           .fill(lightGray);

        // Table header text
        doc.fontSize(10)
           .fillColor(textColor)
           .font('Helvetica-Bold')
           .text('Description', colPositions[0] + 10, tableTop + 8)
           .text('Qty', colPositions[1] + 10, tableTop + 8, { width: colWidths[1] - 10, align: 'right' })
           .text('Unit Price', colPositions[2] + 10, tableTop + 8, { width: colWidths[2] - 10, align: 'right' })
           .text('Amount', colPositions[3] + 10, tableTop + 8, { width: colWidths[3] - 10, align: 'right' });

        // Table rows
        doc.font('Helvetica');
        let rowY = tableTop + 35;

        data.items.forEach((item, index) => {
          // Alternate row background
          if (index % 2 === 1) {
            doc.rect(tableLeft, rowY - 5, 495, 25)
               .fill('#fafafa');
          }

          doc.fillColor(textColor)
             .text(item.description, colPositions[0] + 10, rowY, { width: colWidths[0] - 20 })
             .text(item.quantity.toString(), colPositions[1] + 10, rowY, { width: colWidths[1] - 10, align: 'right' })
             .text(item.unitPrice, colPositions[2] + 10, rowY, { width: colWidths[2] - 10, align: 'right' })
             .text(item.amount, colPositions[3] + 10, rowY, { width: colWidths[3] - 10, align: 'right' });

          rowY += 25;
        });

        // Table border
        doc.rect(tableLeft, tableTop, 495, rowY - tableTop)
           .stroke(borderColor);

        // Totals section
        const totalsX = 380;
        const totalsWidth = 165;
        let totalsY = rowY + 20;

        // Subtotal
        doc.fontSize(10)
           .text('Subtotal', totalsX, totalsY)
           .text(data.subtotal, totalsX + 80, totalsY, { width: totalsWidth - 80, align: 'right' });
        totalsY += 20;

        // Tax
        doc.text('Tax', totalsX, totalsY)
           .text(data.taxAmount, totalsX + 80, totalsY, { width: totalsWidth - 80, align: 'right' });
        totalsY += 20;

        // Total line
        doc.moveTo(totalsX, totalsY)
           .lineTo(totalsX + totalsWidth, totalsY)
           .stroke(textColor);
        totalsY += 10;

        // Total
        doc.fontSize(14)
           .font('Helvetica-Bold')
           .text(`Total (${data.currency})`, totalsX, totalsY)
           .text(data.total, totalsX + 80, totalsY, { width: totalsWidth - 80, align: 'right' });

        // Notes section
        if (data.notes) {
          const notesY = totalsY + 50;
          doc.roundedRect(50, notesY, 495, 60, 5)
             .fill('#f9fafb');
          doc.font('Helvetica-Bold')
             .fontSize(10)
             .fillColor(textColor)
             .text('Notes', 60, notesY + 10);
          doc.font('Helvetica')
             .text(data.notes, 60, notesY + 25, { width: 475 });
        }

        // Footer
        const footerY = 780;
        doc.fontSize(8)
           .fillColor('#666666')
           .text('Thank you for your business!', 50, footerY, { align: 'center', width: 495 })
           .text(`Generated by ${data.seller.name}`, { align: 'center', width: 495 });

        // Finalize PDF
        doc.end();

      } catch (error) {
        logger.error('Error generating PDF invoice', { error, invoiceId });
        reject(error);
      }
    });
  }

  /**
   * Generate PDF invoice and save URL
   */
  async generateAndSavePdfInvoice(invoiceId: string): Promise<{ buffer: Buffer; filename: string } | null> {
    const pdfBuffer = await this.generatePdfInvoice(invoiceId);
    if (!pdfBuffer) {
      return null;
    }

    const invoice = await this.invoiceRepo.findById(invoiceId);
    if (!invoice) {
      return null;
    }

    const filename = `invoice-${invoice.invoiceNumber}.pdf`;

    // In a production environment, you would upload this to cloud storage (S3, GCS, etc.)
    // and update the invoice.pdfUrl with the storage URL
    // For now, we return the buffer and filename for direct download

    logger.info('PDF invoice generated', {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      size: pdfBuffer.length,
    });

    return { buffer: pdfBuffer, filename };
  }

  /**
   * Send invoice by email
   */
  async sendInvoiceEmail(invoiceId: string): Promise<boolean> {
    const invoice = await this.invoiceRepo.findById(invoiceId);
    if (!invoice) {
      return false;
    }

    const customer = await this.customerRepo.findById(invoice.customerId);
    if (!customer) {
      return false;
    }

    const htmlInvoice = await this.generateHtmlInvoice(invoiceId);
    if (!htmlInvoice) {
      return false;
    }

    try {
      await this.emailSvc.send({
        to: { email: customer.email, name: customer.name || undefined },
        subject: `Invoice ${invoice.invoiceNumber}`,
        html: this.getInvoiceEmailHtml(invoice, customer.name || customer.email, htmlInvoice),
        text: this.getInvoiceEmailText(invoice, customer.name || customer.email),
      });

      logger.info('Invoice email sent', {
        invoiceId,
        customerEmail: customer.email,
      });

      return true;
    } catch (error) {
      logger.error('Failed to send invoice email', { error, invoiceId });
      return false;
    }
  }

  /**
   * Format billing address
   */
  private formatAddress(address: Record<string, unknown>): string {
    const parts: string[] = [];
    
    if (address.line1) parts.push(String(address.line1));
    if (address.line2) parts.push(String(address.line2));
    if (address.city || address.state || address.postalCode) {
      const cityLine = [address.city, address.state, address.postalCode]
        .filter(Boolean)
        .join(', ');
      parts.push(String(cityLine));
    }
    if (address.country) parts.push(String(address.country));
    
    return parts.join('\n');
  }

  /**
   * Render invoice HTML
   */
  private renderInvoiceHtml(data: InvoicePdfData): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${data.invoiceNumber}</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; margin: 0; padding: 40px; }
    .invoice-header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .invoice-title { font-size: 32px; font-weight: bold; color: #0284c7; }
    .invoice-meta { text-align: right; }
    .invoice-meta p { margin: 4px 0; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .party { width: 45%; }
    .party-title { font-weight: bold; color: #666; margin-bottom: 8px; text-transform: uppercase; font-size: 12px; }
    .party-name { font-weight: bold; font-size: 16px; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #f5f5f5; text-align: left; padding: 12px; border-bottom: 2px solid #ddd; }
    td { padding: 12px; border-bottom: 1px solid #eee; }
    .amount { text-align: right; }
    .totals { width: 300px; margin-left: auto; }
    .totals tr td { border: none; padding: 8px 12px; }
    .totals .total-row { font-weight: bold; font-size: 18px; border-top: 2px solid #333; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
    .status-paid { background: #dcfce7; color: #166534; }
    .status-issued { background: #dbeafe; color: #1e40af; }
    .status-draft { background: #f3f4f6; color: #374151; }
    .notes { margin-top: 40px; padding: 20px; background: #f9fafb; border-radius: 8px; }
    .notes-title { font-weight: bold; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="invoice-header">
    <div>
      <div class="invoice-title">INVOICE</div>
      <p>${data.seller.name}</p>
      ${data.seller.email ? `<p>${data.seller.email}</p>` : ''}
    </div>
    <div class="invoice-meta">
      <p><strong>${data.invoiceNumber}</strong></p>
      <p>Issued: ${data.issuedDate}</p>
      ${data.dueDate ? `<p>Due: ${data.dueDate}</p>` : ''}
      <p><span class="status status-${data.status}">${data.status}</span></p>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="party-title">Bill To</div>
      <div class="party-name">${data.buyer.name}</div>
      <p>${data.buyer.email}</p>
      ${data.buyer.address ? `<p>${data.buyer.address.replace(/\n/g, '<br>')}</p>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="amount">Qty</th>
        <th class="amount">Unit Price</th>
        <th class="amount">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${data.items.map(item => `
        <tr>
          <td>${item.description}</td>
          <td class="amount">${item.quantity}</td>
          <td class="amount">${item.unitPrice}</td>
          <td class="amount">${item.amount}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <table class="totals">
    <tr>
      <td>Subtotal</td>
      <td class="amount">${data.subtotal}</td>
    </tr>
    <tr>
      <td>Tax</td>
      <td class="amount">${data.taxAmount}</td>
    </tr>
    <tr class="total-row">
      <td>Total (${data.currency})</td>
      <td class="amount">${data.total}</td>
    </tr>
  </table>

  ${data.notes ? `
    <div class="notes">
      <div class="notes-title">Notes</div>
      <p>${data.notes}</p>
    </div>
  ` : ''}
</body>
</html>
    `;
  }

  /**
   * Get invoice email HTML
   */
  private getInvoiceEmailHtml(invoice: Invoice, customerName: string, _htmlInvoice: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Invoice ${invoice.invoiceNumber}</h2>
    <p>Hi ${customerName},</p>
    <p>Please find your invoice details below.</p>
    
    <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <p><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</p>
      <p><strong>Amount:</strong> ${this.currencySvc.formatAmount(invoice.total / 100, invoice.currency as Parameters<typeof this.currencySvc.formatAmount>[1])}</p>
      <p><strong>Status:</strong> ${invoice.status.toUpperCase()}</p>
    </div>

    <p>Thank you for your business!</p>
  </div>
</body>
</html>
    `;
  }

  /**
   * Get invoice email text
   */
  private getInvoiceEmailText(invoice: Invoice, customerName: string): string {
    return `
Invoice ${invoice.invoiceNumber}

Hi ${customerName},

Invoice Number: ${invoice.invoiceNumber}
Amount: ${this.currencySvc.formatAmount(invoice.total / 100, invoice.currency as Parameters<typeof this.currencySvc.formatAmount>[1])}
Status: ${invoice.status.toUpperCase()}

Thank you for your business!
    `.trim();
  }
}

// Export singleton instance
export const invoiceService = new InvoiceService();
