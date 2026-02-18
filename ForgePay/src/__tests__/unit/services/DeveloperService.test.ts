import { DeveloperService } from '../../../services/DeveloperService';
import { Developer } from '../../../repositories/DeveloperRepository';

// 依存関係のモック
jest.mock('../../../repositories/DeveloperRepository', () => ({
  developerRepository: {
    create: jest.fn(),
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findByApiKeyHash: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../../repositories/ProductRepository', () => ({
  productRepository: {
    findByDeveloperId: jest.fn(),
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { developerRepository } from '../../../repositories/DeveloperRepository';
import { productRepository } from '../../../repositories/ProductRepository';

const mockDeveloperRepository = developerRepository as jest.Mocked<typeof developerRepository>;
const mockProductRepository = productRepository as jest.Mocked<typeof productRepository>;

describe('DeveloperService', () => {
  let service: DeveloperService;

  const mockDeveloper: Developer = {
    id: 'dev-123',
    email: 'test@example.com',
    apiKeyHash: 'hashed-key',
    testMode: true,
    stripeAccountId: null,
    webhookSecret: null,
    defaultSuccessUrl: null,
    defaultCancelUrl: null,
    defaultLocale: 'auto',
    defaultCurrency: 'usd',
    defaultPaymentMethods: ['card'],
    callbackUrl: null,
    callbackSecret: null,
    companyName: null,
    stripeSecretKeyEnc: null,
    stripePublishableKey: null,
    stripeWebhookEndpointSecret: null,
    stripeConfigured: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    service = new DeveloperService();
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('新規開発者を正常に登録できること', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(null);
      mockDeveloperRepository.create.mockResolvedValue(mockDeveloper);

      const result = await service.register('test@example.com');

      expect(result.developer).toEqual(mockDeveloper);
      expect(result.apiKey.apiKey).toContain('fpb_test_');
      expect(result.apiKey.prefix).toHaveLength(12);
      expect(mockDeveloperRepository.create).toHaveBeenCalled();
    });

    it('既存メールアドレスでエラーになること', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(mockDeveloper);

      await expect(service.register('test@example.com')).rejects.toThrow(
        'Email already registered'
      );
    });

    it('liveモードで登録できること', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(null);
      mockDeveloperRepository.create.mockResolvedValue({
        ...mockDeveloper,
        testMode: false,
      });

      const result = await service.register('test@example.com', { testMode: false });

      expect(result.apiKey.apiKey).toContain('fpb_live_');
    });
  });

  describe('regenerateApiKey', () => {
    it('APIキーを正常に再生成できること', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(mockDeveloper);
      mockDeveloperRepository.update.mockResolvedValue(mockDeveloper);

      const result = await service.regenerateApiKey('dev-123');

      expect(result.apiKey).toContain('fpb_test_');
      expect(mockDeveloperRepository.update).toHaveBeenCalled();
    });

    it('存在しない開発者でエラーになること', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(null);

      await expect(service.regenerateApiKey('invalid-id')).rejects.toThrow(
        'Developer not found'
      );
    });

    it('liveモードの開発者にはliveキーが生成されること', async () => {
      mockDeveloperRepository.findById.mockResolvedValue({
        ...mockDeveloper,
        testMode: false,
      });
      mockDeveloperRepository.update.mockResolvedValue(mockDeveloper);

      const result = await service.regenerateApiKey('dev-123');

      expect(result.apiKey).toContain('fpb_live_');
    });
  });

  describe('validateApiKey', () => {
    it('有効なAPIキーで開発者を返すこと', async () => {
      mockDeveloperRepository.findByApiKeyHash.mockResolvedValue(mockDeveloper);

      const result = await service.validateApiKey('fpb_test_abc123');

      expect(result).toEqual(mockDeveloper);
    });

    it('無効なAPIキーでnullを返すこと', async () => {
      mockDeveloperRepository.findByApiKeyHash.mockResolvedValue(null);

      const result = await service.validateApiKey('invalid-key');

      expect(result).toBeNull();
    });
  });

  describe('getDeveloper', () => {
    it('IDで開発者を取得できること', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(mockDeveloper);

      const result = await service.getDeveloper('dev-123');

      expect(result).toEqual(mockDeveloper);
    });

    it('存在しない場合nullを返すこと', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(null);

      const result = await service.getDeveloper('invalid-id');

      expect(result).toBeNull();
    });
  });

  describe('getDeveloperByEmail', () => {
    it('メールで開発者を取得できること', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(mockDeveloper);

      const result = await service.getDeveloperByEmail('test@example.com');

      expect(result).toEqual(mockDeveloper);
    });
  });

  describe('updateSettings', () => {
    it('開発者設定を更新できること', async () => {
      const updatedDeveloper = { ...mockDeveloper, webhookSecret: 'secret-123' };
      mockDeveloperRepository.update.mockResolvedValue(updatedDeveloper);

      const result = await service.updateSettings('dev-123', {
        webhookSecret: 'secret-123',
      });

      expect(result?.webhookSecret).toBe('secret-123');
    });
  });

  describe('connectStripeAccount', () => {
    it('Stripeアカウントを接続できること', async () => {
      const updatedDeveloper = {
        ...mockDeveloper,
        stripeAccountId: 'acct_123',
      };
      mockDeveloperRepository.update.mockResolvedValue(updatedDeveloper);

      const result = await service.connectStripeAccount('dev-123', 'acct_123');

      expect(result?.stripeAccountId).toBe('acct_123');
    });
  });

  describe('getOnboardingStatus', () => {
    it('未完了ステップのオンボーディング状態を返すこと', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(mockDeveloper);
      mockProductRepository.findByDeveloperId.mockResolvedValue([]);

      const result = await service.getOnboardingStatus('dev-123');

      expect(result?.isComplete).toBe(false);
      expect(result?.steps.accountCreated).toBe(true);
      expect(result?.steps.apiKeyGenerated).toBe(true);
      expect(result?.steps.stripeConnected).toBe(false);
      expect(result?.steps.firstProductCreated).toBe(false);
      expect(result?.nextStep).toBe('Stripe アカウントを接続してください');
    });

    it('存在しない開発者でnullを返すこと', async () => {
      mockDeveloperRepository.findById.mockResolvedValue(null);

      const result = await service.getOnboardingStatus('invalid-id');

      expect(result).toBeNull();
    });

    it('Stripe接続済みで次のステップが商品作成になること', async () => {
      mockDeveloperRepository.findById.mockResolvedValue({
        ...mockDeveloper,
        stripeAccountId: 'acct_123',
      });
      mockProductRepository.findByDeveloperId.mockResolvedValue([]);

      const result = await service.getOnboardingStatus('dev-123');

      expect(result?.steps.stripeConnected).toBe(true);
      expect(result?.nextStep).toBe('最初の商品を作成してください');
    });

    it('stripeSecretKeyEncでもStripe接続と判定されること', async () => {
      mockDeveloperRepository.findById.mockResolvedValue({
        ...mockDeveloper,
        stripeSecretKeyEnc: 'encrypted-key',
      });
      mockProductRepository.findByDeveloperId.mockResolvedValue([]);

      const result = await service.getOnboardingStatus('dev-123');

      expect(result?.steps.stripeConnected).toBe(true);
    });

    it('商品が存在する場合firstProductCreatedがtrueになること', async () => {
      mockDeveloperRepository.findById.mockResolvedValue({
        ...mockDeveloper,
        stripeAccountId: 'acct_123',
      });
      mockProductRepository.findByDeveloperId.mockResolvedValue([
        { id: 'prod-1', name: 'Test Product' } as any,
      ]);

      const result = await service.getOnboardingStatus('dev-123');

      expect(result?.steps.firstProductCreated).toBe(true);
    });

    it('callbackUrlでもwebhook設定済みと判定されること', async () => {
      mockDeveloperRepository.findById.mockResolvedValue({
        ...mockDeveloper,
        stripeAccountId: 'acct_123',
        callbackUrl: 'https://example.com/callback',
      });
      mockProductRepository.findByDeveloperId.mockResolvedValue([
        { id: 'prod-1', name: 'Test Product' } as any,
      ]);

      const result = await service.getOnboardingStatus('dev-123');

      expect(result?.steps.webhookConfigured).toBe(true);
    });
  });

  describe('switchMode', () => {
    it('liveモードに切替できること', async () => {
      const updatedDeveloper = { ...mockDeveloper, testMode: false };
      mockDeveloperRepository.update.mockResolvedValue(updatedDeveloper);

      const result = await service.switchMode('dev-123', false);

      expect(result?.testMode).toBe(false);
    });

    it('testモードに切替できること', async () => {
      mockDeveloperRepository.update.mockResolvedValue(mockDeveloper);

      const result = await service.switchMode('dev-123', true);

      expect(result?.testMode).toBe(true);
    });
  });

  describe('deleteAccount', () => {
    it('開発者アカウントを削除できること', async () => {
      mockDeveloperRepository.delete.mockResolvedValue(true);

      const result = await service.deleteAccount('dev-123');

      expect(result).toBe(true);
    });

    it('削除失敗時にfalseを返すこと', async () => {
      mockDeveloperRepository.delete.mockResolvedValue(false);

      const result = await service.deleteAccount('invalid-id');

      expect(result).toBe(false);
    });
  });

  describe('APIキー形式', () => {
    it('testモードのAPIキー形式が正しいこと', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(null);
      mockDeveloperRepository.create.mockResolvedValue(mockDeveloper);

      const result = await service.register('test@example.com', { testMode: true });

      expect(result.apiKey.apiKey).toMatch(/^fpb_test_[A-Za-z0-9_-]+$/);
    });

    it('liveモードのAPIキー形式が正しいこと', async () => {
      mockDeveloperRepository.findByEmail.mockResolvedValue(null);
      mockDeveloperRepository.create.mockResolvedValue({
        ...mockDeveloper,
        testMode: false,
      });

      const result = await service.register('test@example.com', { testMode: false });

      expect(result.apiKey.apiKey).toMatch(/^fpb_live_[A-Za-z0-9_-]+$/);
    });
  });
});
