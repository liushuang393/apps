import { Router, Response } from 'express';
import { invoiceService } from '../services/InvoiceService';
import { AuthenticatedRequest, apiKeyAuth } from '../middleware';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /invoices
 * List invoices for the authenticated developer
 */
router.get('/', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;

    const result = await invoiceService.getDeveloperInvoices(req.developer!.id, {
      limit,
      offset,
      status,
    });

    res.json({
      invoices: result.invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerId: inv.customerId,
        status: inv.status,
        currency: inv.currency,
        subtotal: inv.subtotal,
        taxAmount: inv.taxAmount,
        total: inv.total,
        issuedAt: inv.issuedAt,
        paidAt: inv.paidAt,
        pdfUrl: inv.pdfUrl,
        createdAt: inv.createdAt,
      })),
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    logger.error('Error listing invoices', { error });
    res.status(500).json({ error: 'Failed to list invoices' });
  }
});

/**
 * GET /invoices/:id
 * Get invoice details
 */
router.get('/:id', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invoice = await invoiceService.getInvoice(req.params.id);

    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    // Verify ownership
    if (invoice.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json({ invoice });
  } catch (error) {
    logger.error('Error getting invoice', { error });
    res.status(500).json({ error: 'Failed to get invoice' });
  }
});

/**
 * GET /invoices/:id/pdf
 * Download invoice as PDF
 * 
 * Requirements: 7.5 - PDF Invoice Generation
 */
router.get('/:id/pdf', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invoice = await invoiceService.getInvoice(req.params.id);

    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    if (invoice.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const result = await invoiceService.generateAndSavePdfInvoice(req.params.id);

    if (!result) {
      res.status(500).json({ error: 'Failed to generate PDF' });
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', result.buffer.length);
    res.send(result.buffer);
  } catch (error) {
    logger.error('Error generating invoice PDF', { error });
    res.status(500).json({ error: 'Failed to generate invoice PDF' });
  }
});

/**
 * GET /invoices/:id/html
 * Get invoice as HTML
 */
router.get('/:id/html', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invoice = await invoiceService.getInvoice(req.params.id);

    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    if (invoice.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const html = await invoiceService.generateHtmlInvoice(req.params.id);

    if (!html) {
      res.status(500).json({ error: 'Failed to generate invoice HTML' });
      return;
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logger.error('Error generating invoice HTML', { error });
    res.status(500).json({ error: 'Failed to generate invoice HTML' });
  }
});

/**
 * POST /invoices/:id/send
 * Send invoice by email
 */
router.post('/:id/send', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invoice = await invoiceService.getInvoice(req.params.id);

    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    if (invoice.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const sent = await invoiceService.sendInvoiceEmail(req.params.id);

    if (!sent) {
      res.status(500).json({ error: 'Failed to send invoice email' });
      return;
    }

    res.json({ success: true, message: 'Invoice sent successfully' });
  } catch (error) {
    logger.error('Error sending invoice', { error });
    res.status(500).json({ error: 'Failed to send invoice' });
  }
});

/**
 * POST /invoices/:id/void
 * Void an invoice
 */
router.post('/:id/void', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invoice = await invoiceService.getInvoice(req.params.id);

    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    if (invoice.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const voided = await invoiceService.voidInvoice(req.params.id);

    if (!voided) {
      res.status(400).json({ error: 'Cannot void this invoice' });
      return;
    }

    res.json({ invoice: voided });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot void')) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Error voiding invoice', { error });
    res.status(500).json({ error: 'Failed to void invoice' });
  }
});

/**
 * GET /invoices/customer/:customerId
 * Get invoices for a specific customer
 */
router.get('/customer/:customerId', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const invoices = await invoiceService.getCustomerInvoices(req.params.customerId, {
      limit,
      offset,
    });

    // Filter to only show invoices belonging to this developer
    const filteredInvoices = invoices.filter(
      (inv) => inv.developerId === req.developer!.id
    );

    res.json({
      invoices: filteredInvoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        currency: inv.currency,
        total: inv.total,
        issuedAt: inv.issuedAt,
        paidAt: inv.paidAt,
      })),
    });
  } catch (error) {
    logger.error('Error getting customer invoices', { error });
    res.status(500).json({ error: 'Failed to get customer invoices' });
  }
});

export default router;
