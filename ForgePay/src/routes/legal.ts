import { Router, Request, Response } from 'express';
import { legalTemplateService } from '../services/LegalTemplateService';
import { LegalTemplateType } from '../repositories/LegalTemplateRepository';
import { AuthenticatedRequest, apiKeyAuth } from '../middleware';
import { logger } from '../utils/logger';

const router = Router();

// Valid template types
const VALID_TYPES: LegalTemplateType[] = ['terms_of_service', 'privacy_policy', 'refund_policy'];

const isValidType = (type: string): type is LegalTemplateType => {
  return VALID_TYPES.includes(type as LegalTemplateType);
};

// ==================== Public Routes ====================

// Simple markdown to HTML converter (basic implementation)
function markdownToHtml(markdown: string): string {
  return markdown
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/^- (.*$)/gim, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (match) => {
      if (match.startsWith('<')) return match;
      return `<p>${match}</p>`;
    });
}

/**
 * GET /legal/:developerId/:type
 * Get active legal template for public viewing
 */
router.get('/:developerId/:type', async (req: Request, res: Response) => {
  try {
    const { developerId, type } = req.params;
    const format = req.query.format as string || 'html';

    if (!isValidType(type)) {
      res.status(400).json({ error: 'Invalid template type' });
      return;
    }

    const template = await legalTemplateService.getActiveTemplate(developerId, type);

    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    if (format === 'json') {
      res.json({
        id: template.id,
        type: template.type,
        title: template.title,
        content: template.content,
        version: template.version,
        effectiveDate: template.effectiveDate,
        language: template.language,
      });
    } else {
      // Return as HTML page
      const contentHtml = template.contentHtml || markdownToHtml(template.content);
      res.send(`
<!DOCTYPE html>
<html lang="${template.language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${template.title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2, h3 { color: #1a1a1a; }
    h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }
    .meta { color: #666; font-size: 14px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>${template.title}</h1>
  <div class="meta">Version ${template.version} | ${template.effectiveDate ? new Date(template.effectiveDate).toLocaleDateString() : 'Effective immediately'}</div>
  <div class="content">
    ${contentHtml}
  </div>
</body>
</html>
      `);
    }
  } catch (error) {
    logger.error('Error getting public template', { error });
    res.status(500).json({ error: 'Failed to get template' });
  }
});

/**
 * GET /legal/:developerId/urls
 * Get URLs for all legal templates
 */
router.get('/:developerId/urls', async (req: Request, res: Response) => {
  try {
    const { developerId } = req.params;
    const baseUrl = `${req.protocol}://${req.get('host')}/api/v1/legal`;

    const urls = await legalTemplateService.getLegalUrls(developerId, baseUrl);

    res.json({ urls });
  } catch (error) {
    logger.error('Error getting legal URLs', { error });
    res.status(500).json({ error: 'Failed to get legal URLs' });
  }
});

// ==================== Admin Routes (Authenticated) ====================

/**
 * GET /legal/admin/templates
 * Get all templates for the authenticated developer
 */
router.get('/admin/templates', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const type = req.query.type as LegalTemplateType | undefined;
    
    if (type && !isValidType(type)) {
      res.status(400).json({ error: 'Invalid template type' });
      return;
    }

    const templates = await legalTemplateService.getDeveloperTemplates(
      req.developer!.id,
      type
    );

    res.json({
      templates: templates.map(t => ({
        id: t.id,
        type: t.type,
        version: t.version,
        title: t.title,
        language: t.language,
        isActive: t.isActive,
        isDefault: t.isDefault,
        effectiveDate: t.effectiveDate,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (error) {
    logger.error('Error getting admin templates', { error });
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

/**
 * GET /legal/admin/templates/:id
 * Get a specific template
 */
router.get('/admin/templates/:id', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const template = await legalTemplateService.getTemplate(req.params.id);

    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    // Verify ownership
    if (template.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json({ template });
  } catch (error) {
    logger.error('Error getting template', { error });
    res.status(500).json({ error: 'Failed to get template' });
  }
});

/**
 * POST /legal/admin/templates
 * Create a new template
 */
router.post('/admin/templates', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, title, content, contentHtml, language, effectiveDate } = req.body;

    if (!type || !isValidType(type)) {
      res.status(400).json({ error: 'Invalid or missing template type' });
      return;
    }

    if (!title || !content) {
      res.status(400).json({ error: 'Title and content are required' });
      return;
    }

    const template = await legalTemplateService.createTemplate({
      developerId: req.developer!.id,
      type,
      title,
      content,
      contentHtml,
      language,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
    });

    res.status(201).json({ template });
  } catch (error) {
    logger.error('Error creating template', { error });
    res.status(500).json({ error: 'Failed to create template' });
  }
});

/**
 * POST /legal/admin/templates/defaults
 * Create default templates for the developer
 */
router.post('/admin/templates/defaults', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const templates = await legalTemplateService.createDefaultTemplates(req.developer!.id);

    res.status(201).json({
      message: 'Default templates created',
      templates: templates.map(t => ({
        id: t.id,
        type: t.type,
        title: t.title,
        version: t.version,
      })),
    });
  } catch (error) {
    logger.error('Error creating default templates', { error });
    res.status(500).json({ error: 'Failed to create default templates' });
  }
});

/**
 * PUT /legal/admin/templates/:id
 * Update a template
 */
router.put('/admin/templates/:id', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, contentHtml, language, effectiveDate, createNewVersion } = req.body;

    // Verify ownership
    const existing = await legalTemplateService.getTemplate(id);
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    if (existing.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const template = await legalTemplateService.updateTemplate(id, {
      title,
      content,
      contentHtml,
      language,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
      createNewVersion,
    });

    res.json({ template });
  } catch (error) {
    logger.error('Error updating template', { error });
    res.status(500).json({ error: 'Failed to update template' });
  }
});

/**
 * POST /legal/admin/templates/:id/activate
 * Activate a template version
 */
router.post('/admin/templates/:id/activate', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { notifyCustomers } = req.body;

    // Verify ownership
    const existing = await legalTemplateService.getTemplate(id);
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    if (existing.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const template = await legalTemplateService.activateTemplate(id);

    // Optionally notify customers
    let notifiedCount = 0;
    if (notifyCustomers && template) {
      notifiedCount = await legalTemplateService.notifyTemplateUpdate(
        req.developer!.id,
        template.type
      );
    }

    res.json({
      template,
      notifiedCount,
    });
  } catch (error) {
    logger.error('Error activating template', { error });
    res.status(500).json({ error: 'Failed to activate template' });
  }
});

/**
 * DELETE /legal/admin/templates/:id
 * Delete a template (only inactive with no acceptances)
 */
router.delete('/admin/templates/:id', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const existing = await legalTemplateService.getTemplate(id);
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    if (existing.developerId !== req.developer!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (existing.isActive) {
      res.status(400).json({ error: 'Cannot delete active template' });
      return;
    }

    const deleted = await legalTemplateService.deleteTemplate(id);

    if (!deleted) {
      res.status(400).json({ error: 'Template could not be deleted (may have acceptances)' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting template', { error });
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

/**
 * GET /legal/admin/templates/:type/history
 * Get version history for a template type
 */
router.get('/admin/templates/:type/history', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type } = req.params;

    if (!isValidType(type)) {
      res.status(400).json({ error: 'Invalid template type' });
      return;
    }

    const history = await legalTemplateService.getVersionHistory(req.developer!.id, type);

    res.json({
      history: history.map(t => ({
        id: t.id,
        version: t.version,
        title: t.title,
        isActive: t.isActive,
        effectiveDate: t.effectiveDate,
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    logger.error('Error getting version history', { error });
    res.status(500).json({ error: 'Failed to get version history' });
  }
});

export default router;
