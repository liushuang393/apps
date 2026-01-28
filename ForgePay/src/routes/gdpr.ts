import { Router, Response } from 'express';
import { gdprService, GDPRRequestType, GDPRRequestStatus } from '../services/GDPRService';
import { AuthenticatedRequest, apiKeyAuth } from '../middleware';
import { logger } from '../utils/logger';

const router = Router();

const VALID_REQUEST_TYPES: GDPRRequestType[] = ['data_export', 'data_deletion', 'data_rectification'];

/**
 * POST /gdpr/requests
 * Create a GDPR request
 */
router.post('/requests', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customerEmail, requestType, reason, dataCategories } = req.body;

    if (!customerEmail || typeof customerEmail !== 'string') {
      res.status(400).json({ error: 'customerEmail is required' });
      return;
    }

    if (!requestType || !VALID_REQUEST_TYPES.includes(requestType)) {
      res.status(400).json({
        error: `Invalid requestType. Must be one of: ${VALID_REQUEST_TYPES.join(', ')}`,
      });
      return;
    }

    const request = await gdprService.createRequest({
      developerId: req.developer!.id,
      customerEmail,
      requestType,
      requestedBy: req.developer!.email,
      reason,
      dataCategories,
    });

    res.status(201).json({
      request: {
        id: request.id,
        customerEmail: request.customerEmail,
        requestType: request.requestType,
        status: request.status,
        createdAt: request.createdAt,
      },
    });
  } catch (error) {
    logger.error('Error creating GDPR request', { error });
    res.status(500).json({ error: 'Failed to create GDPR request' });
  }
});

/**
 * GET /gdpr/requests
 * List GDPR requests
 */
router.get('/requests', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;

    const result = await gdprService.listRequests(req.developer!.id, {
      limit,
      offset,
      status: status as GDPRRequestStatus | undefined,
    });

    res.json({
      requests: result.requests.map((r) => ({
        id: r.id,
        customerEmail: r.customerEmail,
        requestType: r.requestType,
        status: r.status,
        createdAt: r.createdAt,
        processedAt: r.processedAt,
        completedAt: r.completedAt,
      })),
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    logger.error('Error listing GDPR requests', { error });
    res.status(500).json({ error: 'Failed to list GDPR requests' });
  }
});

/**
 * GET /gdpr/requests/:id
 * Get GDPR request details
 */
router.get('/requests/:id', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const request = await gdprService.getRequest(req.params.id);

    if (!request) {
      res.status(404).json({ error: 'GDPR request not found' });
      return;
    }

    if (request.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json({ request });
  } catch (error) {
    logger.error('Error getting GDPR request', { error });
    res.status(500).json({ error: 'Failed to get GDPR request' });
  }
});

/**
 * POST /gdpr/requests/:id/process
 * Process a GDPR request
 */
router.post('/requests/:id/process', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const request = await gdprService.getRequest(req.params.id);

    if (!request) {
      res.status(404).json({ error: 'GDPR request not found' });
      return;
    }

    if (request.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (request.status !== 'pending') {
      res.status(400).json({ error: 'Request has already been processed' });
      return;
    }

    const processed = await gdprService.processRequest(req.params.id);

    res.json({
      request: {
        id: processed.id,
        status: processed.status,
        completedAt: processed.completedAt,
        exportFileUrl: processed.exportFileUrl,
        exportFileExpiresAt: processed.exportFileExpiresAt,
      },
    });
  } catch (error) {
    logger.error('Error processing GDPR request', { error });
    res.status(500).json({ error: 'Failed to process GDPR request' });
  }
});

/**
 * POST /gdpr/requests/:id/cancel
 * Cancel a pending GDPR request
 */
router.post('/requests/:id/cancel', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const request = await gdprService.getRequest(req.params.id);

    if (!request) {
      res.status(404).json({ error: 'GDPR request not found' });
      return;
    }

    if (request.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const cancelled = await gdprService.cancelRequest(req.params.id);

    if (!cancelled) {
      res.status(400).json({ error: 'Cannot cancel this request' });
      return;
    }

    res.json({ request: cancelled });
  } catch (error) {
    logger.error('Error cancelling GDPR request', { error });
    res.status(500).json({ error: 'Failed to cancel GDPR request' });
  }
});

/**
 * POST /gdpr/export
 * Quick data export (creates and processes request immediately)
 */
router.post('/export', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customerEmail } = req.body;

    if (!customerEmail || typeof customerEmail !== 'string') {
      res.status(400).json({ error: 'customerEmail is required' });
      return;
    }

    const exportData = await gdprService.exportCustomerData(
      req.developer!.id,
      customerEmail
    );

    res.json({ data: exportData });
  } catch (error) {
    if (error instanceof Error && error.message === 'Customer not found') {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    logger.error('Error exporting customer data', { error });
    res.status(500).json({ error: 'Failed to export customer data' });
  }
});

/**
 * DELETE /gdpr/customer
 * Quick data deletion
 */
router.delete('/customer', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customerEmail, keepTransactionRecords } = req.body;

    if (!customerEmail || typeof customerEmail !== 'string') {
      res.status(400).json({ error: 'customerEmail is required' });
      return;
    }

    const result = await gdprService.deleteCustomerData(
      req.developer!.id,
      customerEmail,
      { keepTransactionRecords: keepTransactionRecords !== false }
    );

    res.json({
      success: true,
      deletedRecords: result.deletedRecords,
      anonymizedRecords: result.anonymizedRecords,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Customer not found') {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    logger.error('Error deleting customer data', { error });
    res.status(500).json({ error: 'Failed to delete customer data' });
  }
});

export default router;
