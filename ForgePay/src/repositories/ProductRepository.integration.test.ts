import { pool } from '../config/database';
import {
  ProductRepository,
  CreateProductParams,
} from './ProductRepository';

/**
 * Integration tests for ProductRepository
 * 
 * These tests run against a real database to verify:
 * - CRUD operations work correctly
 * - Query methods return expected results
 * - Transactions work properly
 * 
 * Requirements: 5.2
 * 
 * NOTE: These tests are skipped by default since they require a running database.
 * Set ENABLE_DB_TESTS=true to run them.
 */
const SKIP_DB_TESTS = process.env.ENABLE_DB_TESTS !== 'true';

(SKIP_DB_TESTS ? describe.skip : describe)('ProductRepository Integration Tests', () => {
  let repository: ProductRepository;
  let testDeveloperId: string;

  beforeAll(async () => {
    repository = new ProductRepository();

    // Create a test developer
    const result = await pool.query(
      `INSERT INTO developers (email, api_key_hash, test_mode)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['test-product-repo@example.com', 'test-hash', true]
    );
    testDeveloperId = result.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM products WHERE developer_id = $1', [
      testDeveloperId,
    ]);
    await pool.query('DELETE FROM developers WHERE id = $1', [testDeveloperId]);
  });

  afterEach(async () => {
    // Clean up products after each test
    await pool.query('DELETE FROM products WHERE developer_id = $1', [
      testDeveloperId,
    ]);
  });

  describe('create', () => {
    it('should create a product with all fields', async () => {
      const params: CreateProductParams = {
        developerId: testDeveloperId,
        stripeProductId: 'prod_test_123',
        name: 'Test Product',
        description: 'Test description',
        type: 'subscription',
        active: true,
        metadata: { test: true },
      };

      const product = await repository.create(params);

      expect(product.id).toBeDefined();
      expect(product.developerId).toBe(testDeveloperId);
      expect(product.stripeProductId).toBe('prod_test_123');
      expect(product.name).toBe('Test Product');
      expect(product.description).toBe('Test description');
      expect(product.type).toBe('subscription');
      expect(product.active).toBe(true);
      expect(product.metadata).toEqual({ test: true });
      expect(product.createdAt).toBeInstanceOf(Date);
      expect(product.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a product with minimal fields', async () => {
      const params: CreateProductParams = {
        developerId: testDeveloperId,
        stripeProductId: 'prod_test_456',
        name: 'Minimal Product',
        type: 'one_time',
      };

      const product = await repository.create(params);

      expect(product.id).toBeDefined();
      expect(product.name).toBe('Minimal Product');
      expect(product.description).toBeNull();
      expect(product.active).toBe(true);
      expect(product.metadata).toBeNull();
    });
  });

  describe('findById', () => {
    it('should find a product by ID', async () => {
      const created = await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_test_789',
        name: 'Find Test',
        type: 'subscription',
      });

      const found = await repository.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Find Test');
    });

    it('should return null for non-existent ID', async () => {
      const found = await repository.findById(
        '00000000-0000-0000-0000-000000000000'
      );

      expect(found).toBeNull();
    });
  });

  describe('findByStripeProductId', () => {
    it('should find a product by Stripe product ID', async () => {
      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_stripe_unique',
        name: 'Stripe Test',
        type: 'subscription',
      });

      const found = await repository.findByStripeProductId('prod_stripe_unique');

      expect(found).not.toBeNull();
      expect(found?.stripeProductId).toBe('prod_stripe_unique');
    });
  });

  describe('findByDeveloperId', () => {
    it('should find all products for a developer', async () => {
      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_1',
        name: 'Product 1',
        type: 'subscription',
        active: true,
      });

      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_2',
        name: 'Product 2',
        type: 'one_time',
        active: false,
      });

      const products = await repository.findByDeveloperId(testDeveloperId);

      expect(products).toHaveLength(2);
    });

    it('should find only active products when activeOnly is true', async () => {
      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_active',
        name: 'Active Product',
        type: 'subscription',
        active: true,
      });

      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_inactive',
        name: 'Inactive Product',
        type: 'one_time',
        active: false,
      });

      const products = await repository.findByDeveloperId(testDeveloperId, true);

      expect(products).toHaveLength(1);
      expect(products[0].active).toBe(true);
    });
  });

  describe('findActiveByDeveloperId', () => {
    it('should find only active products', async () => {
      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_active_1',
        name: 'Active 1',
        type: 'subscription',
        active: true,
      });

      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_inactive_1',
        name: 'Inactive 1',
        type: 'one_time',
        active: false,
      });

      const products = await repository.findActiveByDeveloperId(testDeveloperId);

      expect(products).toHaveLength(1);
      expect(products[0].name).toBe('Active 1');
    });
  });

  describe('update', () => {
    it('should update product fields', async () => {
      const created = await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_update_test',
        name: 'Original Name',
        description: 'Original description',
        type: 'subscription',
      });

      const updated = await repository.update(created.id, {
        name: 'Updated Name',
        description: 'Updated description',
        metadata: { updated: true },
      });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.description).toBe('Updated description');
      expect(updated?.metadata).toEqual({ updated: true });
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime()
      );
    });

    it('should return null for non-existent product', async () => {
      const updated = await repository.update(
        '00000000-0000-0000-0000-000000000000',
        { name: 'New Name' }
      );

      expect(updated).toBeNull();
    });
  });

  describe('archive', () => {
    it('should archive a product', async () => {
      const created = await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_archive_test',
        name: 'Archive Test',
        type: 'subscription',
        active: true,
      });

      const archived = await repository.archive(created.id);

      expect(archived).not.toBeNull();
      expect(archived?.active).toBe(false);

      // Verify it's not in active products
      const activeProducts = await repository.findActiveByDeveloperId(
        testDeveloperId
      );
      expect(activeProducts).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should delete a product', async () => {
      const created = await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_delete_test',
        name: 'Delete Test',
        type: 'subscription',
      });

      const deleted = await repository.delete(created.id);

      expect(deleted).toBe(true);

      // Verify it's gone
      const found = await repository.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent product', async () => {
      const deleted = await repository.delete(
        '00000000-0000-0000-0000-000000000000'
      );

      expect(deleted).toBe(false);
    });
  });

  describe('countByDeveloperId', () => {
    it('should count all products', async () => {
      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_count_1',
        name: 'Count 1',
        type: 'subscription',
        active: true,
      });

      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_count_2',
        name: 'Count 2',
        type: 'one_time',
        active: false,
      });

      const count = await repository.countByDeveloperId(testDeveloperId);

      expect(count).toBe(2);
    });

    it('should count only active products', async () => {
      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_count_active',
        name: 'Active',
        type: 'subscription',
        active: true,
      });

      await repository.create({
        developerId: testDeveloperId,
        stripeProductId: 'prod_count_inactive',
        name: 'Inactive',
        type: 'one_time',
        active: false,
      });

      const count = await repository.countByDeveloperId(testDeveloperId, true);

      expect(count).toBe(1);
    });
  });

  describe('transactions', () => {
    it('should work within a transaction', async () => {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const product = await repository.create(
          {
            developerId: testDeveloperId,
            stripeProductId: 'prod_transaction_test',
            name: 'Transaction Test',
            type: 'subscription',
          },
          client
        );

        const found = await repository.findById(product.id, client);
        expect(found).not.toBeNull();

        await client.query('ROLLBACK');

        // Verify rollback worked
        const foundAfterRollback = await repository.findById(product.id);
        expect(foundAfterRollback).toBeNull();
      } finally {
        client.release();
      }
    });
  });
});
