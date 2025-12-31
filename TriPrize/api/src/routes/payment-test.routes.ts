import { Router, Request, Response, NextFunction } from 'express';
import paymentTestController from '../controllers/payment-test.controller';
import { errors } from '../middleware/error.middleware';
import logger from '../utils/logger.util';

const router = Router();

/**
 * 测试环境检查中间件
 * 目的: 确保这些端点只在开发/测试环境可用
 * 注意点: 生产环境请求会直接返回 403 Forbidden
 */
const ensureTestEnvironment = (req: Request, res: Response, next: NextFunction): void => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    logger.warn('Attempted to access payment test API in production', {
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    throw errors.forbidden('Payment test API is not available in production environment');
  }

  next();
};

// 应用环境检查到所有路由
router.use(ensureTestEnvironment);

// 记录所有测试 API 调用
router.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info('Payment Test API called', {
    method: req.method,
    path: req.path,
    params: req.params,
    body: req.body,
  });
  next();
});

/**
 * 获取所有可用的测试场景
 * GET /api/test/payments/scenarios
 * 返回: 所有可用的模拟操作及其说明
 */
router.get('/scenarios', paymentTestController.getScenarios);

/**
 * 获取所有可用的失败原因
 * GET /api/test/payments/failure-reasons
 * 返回: 可用于 simulate/fail 的失败原因列表
 */
router.get('/failure-reasons', paymentTestController.getFailureReasons);

/**
 * 获取支付状态及可用操作
 * GET /api/test/payments/:paymentIntentId/status
 * 返回: 当前交易状态和可执行的模拟操作
 */
router.get('/:paymentIntentId/status', paymentTestController.getPaymentStatus);

/**
 * 模拟支付成功
 * POST /api/test/payments/:paymentIntentId/simulate/succeed
 * 触发: payment_intent.succeeded webhook 处理
 */
router.post('/:paymentIntentId/simulate/succeed', paymentTestController.simulateSucceed);

/**
 * 模拟支付失败
 * POST /api/test/payments/:paymentIntentId/simulate/fail
 * Body: { reason?: "card_declined" | "insufficient_funds" | ... }
 * 触发: payment_intent.payment_failed webhook 处理
 */
router.post('/:paymentIntentId/simulate/fail', paymentTestController.simulateFail);

/**
 * 模拟支付取消
 * POST /api/test/payments/:paymentIntentId/simulate/cancel
 * 触发: payment_intent.canceled webhook 处理
 */
router.post('/:paymentIntentId/simulate/cancel', paymentTestController.simulateCancel);

/**
 * 模拟退款
 * POST /api/test/payments/:paymentIntentId/simulate/refund
 * Body: { amount?: number, reason?: string }
 * 触发: charge.refunded webhook 处理
 */
router.post('/:paymentIntentId/simulate/refund', paymentTestController.simulateRefund);

/**
 * 模拟便利店支付完成
 * POST /api/test/payments/:paymentIntentId/simulate/konbini-complete
 * 用于: Konbini 支付测试 - 模拟用户在便利店付款后的通知
 */
router.post('/:paymentIntentId/simulate/konbini-complete', paymentTestController.simulateKonbiniComplete);

/**
 * 模拟便利店支付过期
 * POST /api/test/payments/:paymentIntentId/simulate/konbini-expire
 * 用于: Konbini 支付测试 - 模拟 4 天后未付款的过期场景
 */
router.post('/:paymentIntentId/simulate/konbini-expire', paymentTestController.simulateKonbiniExpire);

export default router;

