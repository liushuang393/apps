import {
  hashPassword,
  verifyPassword,
  sha256,
  generateUUID,
  generateToken,
} from '../../../src/utils/crypto.util';

describe('Crypto Utils', () => {
  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'test-password-123';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'test-password-123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2); // bcrypt uses random salt
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const password = 'test-password-123';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'test-password-123';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword('wrong-password', hash);
      expect(isValid).toBe(false);
    });
  });

  describe('sha256', () => {
    it('should generate SHA-256 hash', () => {
      const data = 'test-data';
      const hash = sha256(data);

      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256 is 64 hex characters
    });

    it('should generate consistent hashes', () => {
      const data = 'test-data';
      const hash1 = sha256(data);
      const hash2 = sha256(data);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different data', () => {
      const hash1 = sha256('data1');
      const hash2 = sha256('data2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateUUID', () => {
    it('should generate valid UUID', () => {
      const uuid = generateUUID();

      expect(uuid).toBeDefined();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique UUIDs', () => {
      const uuid1 = generateUUID();
      const uuid2 = generateUUID();

      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateToken', () => {
    it('should generate token of default length', () => {
      const token = generateToken();

      expect(token).toBeDefined();
      expect(token.length).toBe(64); // 32 bytes = 64 hex characters
    });

    it('should generate token of custom length', () => {
      const token = generateToken(16);

      expect(token).toBeDefined();
      expect(token.length).toBe(32); // 16 bytes = 32 hex characters
    });

    it('should generate unique tokens', () => {
      const token1 = generateToken();
      const token2 = generateToken();

      expect(token1).not.toBe(token2);
    });
  });
});
