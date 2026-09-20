describe('アプリケーション設定の本番安全性', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it('本番環境でモック認証を有効にすると起動を拒否する', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      USE_MOCK_AUTH: 'true',
      JWT_SECRET: 'a'.repeat(32),
    };

    expect(() => require('../../../src/config/app.config')).toThrow(
      'USE_MOCK_AUTHは本番環境で有効化できません'
    );
  });
});
