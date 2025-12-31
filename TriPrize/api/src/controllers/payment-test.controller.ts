import { Request, Response } from 'express';
import paymentTestSimulator, {
  PaymentFailureReason,
  SimulationResult,
} from '../services/payment-test-simulator.service';
import { asyncHandler, errors } from '../middleware/error.middleware';
import logger from '../utils/logger.util';

/**
 * Payment Test Controller
 * 目的: 提供支付测试模拟的 API 端点
 * 注意点: 仅在开发/测试环境可用，生产环境会被路由中间件阻止
 */
class PaymentTestController {
  /**
   * 模拟支付成功
   * POST /api/test/payments/:paymentIntentId/simulate/succeed
   */
  simulateSucceed = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { paymentIntentId } = req.params;

    logger.info('API: Simulating payment succeed', { paymentIntentId });

    const result: SimulationResult = await paymentTestSimulator.simulatePaymentSucceed(
      paymentIntentId
    );

    res.json({
      success: true,
      message: 'Payment success simulated',
      data: result,
    });
  });

  /**
   * 模拟支付失败
   * POST /api/test/payments/:paymentIntentId/simulate/fail
   * Body: { reason?: PaymentFailureReason }
   */
  simulateFail = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { paymentIntentId } = req.params;
    const { reason } = req.body;

    // 验证 reason 是有效的枚举值
    const validReasons = Object.values(PaymentFailureReason);
    const failureReason: PaymentFailureReason = reason && validReasons.includes(reason)
      ? reason
      : PaymentFailureReason.CARD_DECLINED;

    logger.info('API: Simulating payment failure', { paymentIntentId, reason: failureReason });

    const result: SimulationResult = await paymentTestSimulator.simulatePaymentFailed(
      paymentIntentId,
      failureReason
    );

    res.json({
      success: true,
      message: 'Payment failure simulated',
      data: result,
    });
  });

  /**
   * 模拟支付取消
   * POST /api/test/payments/:paymentIntentId/simulate/cancel
   */
  simulateCancel = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { paymentIntentId } = req.params;

    logger.info('API: Simulating payment cancel', { paymentIntentId });

    const result: SimulationResult = await paymentTestSimulator.simulatePaymentCanceled(
      paymentIntentId
    );

    res.json({
      success: true,
      message: 'Payment cancellation simulated',
      data: result,
    });
  });

  /**
   * 模拟退款
   * POST /api/test/payments/:paymentIntentId/simulate/refund
   * Body: { amount?: number, reason?: string }
   */
  simulateRefund = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { paymentIntentId } = req.params;
    const { amount, reason } = req.body;

    // 验证 amount 是正数
    if (amount !== undefined) {
      if (typeof amount !== 'number' || amount <= 0) {
        throw errors.badRequest('Refund amount must be a positive number');
      }
    }

    logger.info('API: Simulating refund', { paymentIntentId, amount, reason });

    const result: SimulationResult = await paymentTestSimulator.simulateRefund(
      paymentIntentId,
      { amount, reason }
    );

    res.json({
      success: true,
      message: 'Refund simulated',
      data: result,
    });
  });

  /**
   * 模拟便利店支付完成
   * POST /api/test/payments/:paymentIntentId/simulate/konbini-complete
   */
  simulateKonbiniComplete = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { paymentIntentId } = req.params;

    logger.info('API: Simulating konbini complete', { paymentIntentId });

    const result: SimulationResult = await paymentTestSimulator.simulateKonbiniComplete(
      paymentIntentId
    );

    res.json({
      success: true,
      message: 'Konbini payment completion simulated',
      data: result,
    });
  });

  /**
   * 模拟便利店支付过期
   * POST /api/test/payments/:paymentIntentId/simulate/konbini-expire
   */
  simulateKonbiniExpire = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { paymentIntentId } = req.params;

    logger.info('API: Simulating konbini expire', { paymentIntentId });

    const result: SimulationResult = await paymentTestSimulator.simulateKonbiniExpired(
      paymentIntentId
    );

    res.json({
      success: true,
      message: 'Konbini payment expiration simulated',
      data: result,
    });
  });

  /**
   * 获取支付状态
   * GET /api/test/payments/:paymentIntentId/status
   */
  getPaymentStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { paymentIntentId } = req.params;

    const statusInfo = await paymentTestSimulator.getPaymentStatus(paymentIntentId);

    res.json({
      success: true,
      data: statusInfo,
    });
  });

  /**
   * 获取所有可用的测试场景
   * GET /api/test/payments/scenarios
   */
  getScenarios = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const scenarios = paymentTestSimulator.getAvailableScenarios();

    res.json({
      success: true,
      data: scenarios,
    });
  });

  /**
   * 获取所有可用的失败原因
   * GET /api/test/payments/failure-reasons
   */
  getFailureReasons = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const reasons = Object.values(PaymentFailureReason).map((reason) => ({
      code: reason,
      description: getFailureDescription(reason),
    }));

    res.json({
      success: true,
      data: reasons,
    });
  });
}

/**
 * 获取失败原因的描述
 */
function getFailureDescription(reason: PaymentFailureReason): string {
  const descriptions: Record<PaymentFailureReason, string> = {
    [PaymentFailureReason.CARD_DECLINED]: 'カードが拒否されました',
    [PaymentFailureReason.INSUFFICIENT_FUNDS]: '残高不足',
    [PaymentFailureReason.EXPIRED_CARD]: 'カードの有効期限切れ',
    [PaymentFailureReason.PROCESSING_ERROR]: '処理エラー',
    [PaymentFailureReason.INCORRECT_CVC]: 'セキュリティコードが不正',
    [PaymentFailureReason.FRAUD_SUSPECTED]: '不正利用の疑い',
    [PaymentFailureReason.LOST_CARD]: '紛失カード',
    [PaymentFailureReason.STOLEN_CARD]: '盗難カード',
  };
  return descriptions[reason] || reason;
}

export default new PaymentTestController();

