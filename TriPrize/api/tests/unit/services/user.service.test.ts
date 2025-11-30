import { UserService } from '../../../src/services/user.service';
import { pool } from '../../../src/config/database.config';
import { CreateUserDto, UpdateUserDto } from '../../../src/models/user.entity';

// Mock dependencies
jest.mock('../../../src/config/database.config');
jest.mock('../../../src/utils/logger.util', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService();
    (pool.query as jest.Mock) = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    const validDto: CreateUserDto = {
      user_id: 'firebase-123',
      email: 'test@example.com',
      display_name: 'Test User',
    };

    it('should create user successfully', async () => {
      const mockUser = {
        user_id: 'firebase-123',
        email: 'test@example.com',
        display_name: 'Test User',
        role: 'user',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockUser] });

      const result = await service.createUser(validDto);

      expect(result).toBeDefined();
      expect(result.user_id).toBe('firebase-123');
      expect(result.email).toBe('test@example.com');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining(['firebase-123', 'test@example.com', 'Test User'])
      );
    });

    it('should throw error on database failure', async () => {
      (pool.query as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

      await expect(service.createUser(validDto)).rejects.toThrow('DB error');
    });

    it('should throw USER_ALREADY_EXISTS on unique constraint violation', async () => {
      const dbError = new Error('duplicate key value violates unique constraint');
      (dbError as any).code = '23505';
      (pool.query as jest.Mock).mockRejectedValueOnce(dbError);

      await expect(service.createUser(validDto)).rejects.toThrow('USER_ALREADY_EXISTS');
    });
  });

  describe('getUserById', () => {
    it('should return user when found', async () => {
      const mockUser = {
        user_id: 'user-123',
        email: 'test@example.com',
        display_name: 'Test User',
        role: 'user',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockUser] });

      const result = await service.getUserById('user-123');

      expect(result).toBeDefined();
      expect(result?.user_id).toBe('user-123');
    });

    it('should return null when user not found', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const result = await service.getUserById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('updateUser', () => {
    const updateDto: UpdateUserDto = {
      display_name: 'Updated Name',
      avatar_url: 'http://example.com/avatar.png',
    };

    it('should update user successfully', async () => {
      const mockUser = {
        user_id: 'user-123',
        email: 'test@example.com',
        display_name: 'Updated Name',
	        // DBカラム photo_url を利用して avatar_url にマッピングされるため、テスト行でも photo_url を指定する
	        photo_url: 'http://example.com/avatar.png',
        role: 'user',
        created_at: new Date(),
        updated_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockUser] });

      const result = await service.updateUser('user-123', updateDto);

      expect(result.display_name).toBe('Updated Name');
      expect(result.avatar_url).toBe('http://example.com/avatar.png');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.arrayContaining(['Updated Name', 'http://example.com/avatar.png', 'user-123'])
      );
    });

    it('should throw error if user not found', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await expect(service.updateUser('non-existent', updateDto)).rejects.toThrow('USER_NOT_FOUND');
    });
  });

  describe('deleteUser', () => {
    it('should soft delete user successfully', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ user_id: 'user-123' }] });

      await service.deleteUser('user-123');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        ['user-123']
      );
    });
  });
});

