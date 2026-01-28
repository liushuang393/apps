import { Router } from 'express';
import checkoutRoutes from './checkout';
import entitlementRoutes from './entitlements';
import webhookRoutes from './webhooks';
import adminRoutes from './admin';
import portalRoutes from './portal';
import currencyRoutes from './currency';
import legalRoutes from './legal';
import onboardingRoutes from './onboarding';
import invoiceRoutes from './invoices';
import gdprRoutes from './gdpr';
import monitoringRoutes from './monitoring';
import couponRoutes from './coupons';

const router = Router();

// Mount routes
router.use('/checkout', checkoutRoutes);
router.use('/entitlements', entitlementRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/admin', adminRoutes);
router.use('/portal', portalRoutes);
router.use('/currencies', currencyRoutes);
router.use('/legal', legalRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/gdpr', gdprRoutes);
router.use('/coupons', couponRoutes);
router.use('/', monitoringRoutes); // Health checks at root level

export default router;
