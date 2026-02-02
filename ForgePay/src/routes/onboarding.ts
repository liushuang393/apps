import { Router, Request, Response } from 'express';
import { developerService } from '../services/DeveloperService';
import { AuthenticatedRequest, apiKeyAuth } from '../middleware';
import { logger } from '../utils/logger';

const router = Router();

// ==================== Public Routes ====================

/**
 * POST /onboarding/register
 * Register a new developer account
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, testMode } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const result = await developerService.register(email, {
      testMode: testMode !== false, // Default to test mode
    });

    res.status(201).json({
      message: 'Registration successful',
      developer: {
        id: result.developer.id,
        email: result.developer.email,
        testMode: result.developer.testMode,
        createdAt: result.developer.createdAt,
      },
      apiKey: {
        key: result.apiKey.apiKey,
        prefix: result.apiKey.prefix,
      },
      warning: 'Save your API key now. It will not be shown again.',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Email already registered') {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    logger.error('Error registering developer', { error });
    res.status(500).json({ error: 'Failed to register' });
  }
});

// ==================== Authenticated Routes ====================

/**
 * GET /onboarding/status
 * Get onboarding status for authenticated developer
 */
router.get('/status', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await developerService.getOnboardingStatus(req.developer!.id);

    if (!status) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({ status });
  } catch (error) {
    logger.error('Error getting onboarding status', { error });
    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
});

/**
 * GET /onboarding/me
 * Get current developer info
 */
router.get('/me', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developer = req.developer!;

    res.json({
      developer: {
        id: developer.id,
        email: developer.email,
        testMode: developer.testMode,
        stripeConnected: !!developer.stripeAccountId,
        webhookConfigured: !!developer.webhookSecret,
        createdAt: developer.createdAt,
        updatedAt: developer.updatedAt,
      },
    });
  } catch (error) {
    logger.error('Error getting developer info', { error });
    res.status(500).json({ error: 'Failed to get developer info' });
  }
});

/**
 * POST /onboarding/api-key/regenerate
 * Regenerate API key
 */
router.post('/api-key/regenerate', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const apiKey = await developerService.regenerateApiKey(req.developer!.id);

    res.json({
      message: 'API key regenerated successfully',
      apiKey: {
        key: apiKey.apiKey,
        prefix: apiKey.prefix,
      },
      warning: 'Save your new API key now. It will not be shown again. Your old key is now invalid.',
    });
  } catch (error) {
    logger.error('Error regenerating API key', { error });
    res.status(500).json({ error: 'Failed to regenerate API key' });
  }
});

/**
 * POST /onboarding/mode
 * Switch between test and live mode
 */
router.post('/mode', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { testMode } = req.body;

    if (typeof testMode !== 'boolean') {
      res.status(400).json({ error: 'testMode must be a boolean' });
      return;
    }

    const developer = await developerService.switchMode(req.developer!.id, testMode);

    if (!developer) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({
      message: `Switched to ${testMode ? 'test' : 'live'} mode`,
      testMode: developer.testMode,
    });
  } catch (error) {
    logger.error('Error switching mode', { error });
    res.status(500).json({ error: 'Failed to switch mode' });
  }
});

/**
 * POST /onboarding/webhook-secret
 * Set webhook secret
 */
router.post('/webhook-secret', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { webhookSecret } = req.body;

    if (!webhookSecret || typeof webhookSecret !== 'string') {
      res.status(400).json({ error: 'webhookSecret is required' });
      return;
    }

    const developer = await developerService.updateSettings(req.developer!.id, {
      webhookSecret,
    });

    if (!developer) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({
      message: 'Webhook secret configured',
      webhookConfigured: true,
    });
  } catch (error) {
    logger.error('Error setting webhook secret', { error });
    res.status(500).json({ error: 'Failed to set webhook secret' });
  }
});

/**
 * POST /onboarding/stripe/connect
 * Connect Stripe account (simplified - in production, use Stripe Connect OAuth)
 */
router.post('/stripe/connect', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { stripeAccountId } = req.body;

    if (!stripeAccountId || typeof stripeAccountId !== 'string') {
      res.status(400).json({ error: 'stripeAccountId is required' });
      return;
    }

    // Validate Stripe account ID format
    if (!stripeAccountId.startsWith('acct_')) {
      res.status(400).json({ error: 'Invalid Stripe account ID format' });
      return;
    }

    const developer = await developerService.connectStripeAccount(
      req.developer!.id,
      stripeAccountId
    );

    if (!developer) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({
      message: 'Stripe account connected',
      stripeConnected: true,
      stripeAccountId: developer.stripeAccountId,
    });
  } catch (error) {
    logger.error('Error connecting Stripe account', { error });
    res.status(500).json({ error: 'Failed to connect Stripe account' });
  }
});

/**
 * DELETE /onboarding/account
 * Delete developer account
 */
router.delete('/account', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { confirmEmail } = req.body;

    // Require email confirmation for account deletion
    if (confirmEmail !== req.developer!.email) {
      res.status(400).json({ 
        error: 'Please confirm your email address to delete your account' 
      });
      return;
    }

    const deleted = await developerService.deleteAccount(req.developer!.id);

    if (!deleted) {
      res.status(404).json({ error: 'Developer not found' });
      return;
    }

    res.json({
      message: 'Account deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting account', { error });
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

/**
 * GET /onboarding/quick-start
 * Get quick-start guide data
 */
router.get('/quick-start', apiKeyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developer = req.developer!;
    const status = await developerService.getOnboardingStatus(developer.id);

    // Generate code snippets
    const codeSnippets = {
      createCheckout: `
// Create a checkout session
const response = await fetch('${req.protocol}://${req.get('host')}/api/v1/checkout/sessions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'YOUR_API_KEY',
  },
  body: JSON.stringify({
    product_id: 'YOUR_PRODUCT_ID',
    price_id: 'YOUR_PRICE_ID',
    purchase_intent_id: 'unique-purchase-id',
    success_url: 'https://your-app.com/success',
    cancel_url: 'https://your-app.com/cancel',
  }),
});

const { checkout_url } = await response.json();
// Redirect user to checkout_url
      `.trim(),

      verifyEntitlement: `
// Verify entitlement after payment
const response = await fetch('${req.protocol}://${req.get('host')}/api/v1/entitlements/verify?unlock_token=TOKEN', {
  headers: {
    'X-API-Key': 'YOUR_API_KEY',
  },
});

const { entitlement } = await response.json();
if (entitlement.status === 'active') {
  // Grant access to the user
}
      `.trim(),

      handleWebhook: `
// Handle Stripe webhooks
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = req.body;
  
  // Forward to ForgePay
  await fetch('${req.protocol}://${req.get('host')}/api/v1/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': req.headers['stripe-signature'],
    },
    body: req.body,
  });
  
  res.json({ received: true });
});
      `.trim(),
    };

    res.json({
      developer: {
        id: developer.id,
        email: developer.email,
        testMode: developer.testMode,
      },
      onboardingStatus: status,
      codeSnippets,
      documentation: {
        apiReference: `${req.protocol}://${req.get('host')}/docs/api`,
        webhooks: `${req.protocol}://${req.get('host')}/docs/webhooks`,
        testing: `${req.protocol}://${req.get('host')}/docs/testing`,
      },
    });
  } catch (error) {
    logger.error('Error getting quick-start guide', { error });
    res.status(500).json({ error: 'Failed to get quick-start guide' });
  }
});

export default router;
