import { config } from './index';

describe('Configuration', () => {
  it('should load configuration', () => {
    expect(config).toBeDefined();
    expect(config.app).toBeDefined();
    expect(config.stripe).toBeDefined();
    expect(config.database).toBeDefined();
    expect(config.redis).toBeDefined();
    expect(config.jwt).toBeDefined();
    expect(config.logging).toBeDefined();
    expect(config.rateLimit).toBeDefined();
  });

  it('should have valid app configuration', () => {
    expect(config.app.env).toBeDefined();
    expect(config.app.port).toBeGreaterThan(0);
    expect(config.app.baseUrl).toBeDefined();
  });

  it('should have valid stripe configuration', () => {
    expect(config.stripe.mode).toMatch(/^(test|live)$/);
    expect(config.stripe.secretKey).toBeDefined();
    expect(config.stripe.publishableKey).toBeDefined();
    expect(config.stripe.webhookSecret).toBeDefined();
  });

  it('should have valid database configuration', () => {
    expect(config.database.url).toBeDefined();
    expect(config.database.poolMin).toBeGreaterThanOrEqual(1);
    expect(config.database.poolMax).toBeGreaterThan(config.database.poolMin);
  });

  it('should have valid redis configuration', () => {
    expect(config.redis.url).toBeDefined();
  });

  it('should have valid jwt configuration', () => {
    expect(config.jwt.secret).toBeDefined();
    expect(config.jwt.expiresIn).toBeDefined();
  });

  it('should have valid logging configuration', () => {
    expect(config.logging.level).toBeDefined();
    expect(config.logging.format).toMatch(/^(json|simple)$/);
  });

  it('should have valid rate limit configuration', () => {
    expect(config.rateLimit.windowMs).toBeGreaterThan(0);
    expect(config.rateLimit.maxRequests).toBeGreaterThan(0);
  });
});
