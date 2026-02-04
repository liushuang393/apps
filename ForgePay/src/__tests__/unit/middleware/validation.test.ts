import { Request, Response, NextFunction } from 'express';
import { validate, validateAll, ValidationTarget } from '../../../middleware/validation';

// Mock dependencies
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from '../../../utils/logger';

const mockLogger = logger as jest.Mocked<typeof logger>;

// Mock Zod-like schema interface
interface MockZodSchema<T = unknown> {
  parseAsync: jest.Mock<Promise<T>>;
}

// Helper to create mock Zod schema
function createMockSchema<T = unknown>(resolvedValue?: T): MockZodSchema<T> {
  return {
    parseAsync: jest.fn().mockResolvedValue(resolvedValue),
  };
}

// Helper to create a Zod-like error
function createZodError(errors: Array<{ path: (string | number)[]; message: string }>) {
  const error = {
    errors,
    name: 'ZodError',
  };
  return error;
}

describe('Validation Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      body: {},
      query: {},
      params: {},
      path: '/test',
    };

    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };

    mockNext = jest.fn();

    jest.clearAllMocks();
  });

  describe('validate', () => {
    describe('successful validation', () => {
      it('should call next on successful body validation', async () => {
        const schema = createMockSchema({ name: 'test' });
        mockRequest.body = { name: 'test' };

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(schema.parseAsync).toHaveBeenCalledWith({ name: 'test' });
        expect(mockNext).toHaveBeenCalled();
        expect(statusMock).not.toHaveBeenCalled();
      });

      it('should call next on successful query validation', async () => {
        const schema = createMockSchema({ page: '1', limit: '10' });
        mockRequest.query = { page: '1', limit: '10' };

        const middleware = validate(schema, 'query');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(schema.parseAsync).toHaveBeenCalledWith({ page: '1', limit: '10' });
        expect(mockNext).toHaveBeenCalled();
      });

      it('should call next on successful params validation', async () => {
        const schema = createMockSchema({ id: 'user-123' });
        mockRequest.params = { id: 'user-123' };

        const middleware = validate(schema, 'params');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(schema.parseAsync).toHaveBeenCalledWith({ id: 'user-123' });
        expect(mockNext).toHaveBeenCalled();
      });

      it('should default to body when no target specified', async () => {
        const schema = createMockSchema({ email: 'test@example.com' });
        mockRequest.body = { email: 'test@example.com' };

        const middleware = validate(schema);
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(schema.parseAsync).toHaveBeenCalledWith({ email: 'test@example.com' });
        expect(mockNext).toHaveBeenCalled();
      });

      it('should replace body with parsed data by default', async () => {
        const originalData = { name: 'test', extra: 'field' };
        const parsedData = { name: 'test' }; // Schema strips unknown fields
        const schema = createMockSchema(parsedData);
        mockRequest.body = originalData;

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockRequest.body).toEqual(parsedData);
      });

      it('should replace query with parsed data by default', async () => {
        const originalData = { page: '1', unknown: 'value' };
        const parsedData = { page: 1 }; // Schema transforms and strips
        const schema = createMockSchema(parsedData);
        mockRequest.query = originalData;

        const middleware = validate(schema, 'query');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockRequest.query).toEqual(parsedData);
      });

      it('should replace params with parsed data by default', async () => {
        const originalData = { id: 'test-123' };
        const parsedData = { id: 'test-123' };
        const schema = createMockSchema(parsedData);
        mockRequest.params = originalData;

        const middleware = validate(schema, 'params');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockRequest.params).toEqual(parsedData);
      });
    });

    describe('validation options', () => {
      it('should replace data when stripUnknown is true', async () => {
        const parsedData = { name: 'test' };
        const schema = createMockSchema(parsedData);
        mockRequest.body = { name: 'test', extra: 'field' };

        const middleware = validate(schema, 'body', { stripUnknown: true });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockRequest.body).toEqual(parsedData);
      });

      it('should not replace data when stripUnknown is false', async () => {
        const originalData = { name: 'test', extra: 'field' };
        const parsedData = { name: 'test' };
        const schema = createMockSchema(parsedData);
        mockRequest.body = originalData;

        const middleware = validate(schema, 'body', { stripUnknown: false });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        // Original data should remain unchanged when stripUnknown is false
        expect(mockRequest.body).toEqual(originalData);
      });

      it('should handle empty options object', async () => {
        const schema = createMockSchema({ name: 'test' });
        mockRequest.body = { name: 'test' };

        const middleware = validate(schema, 'body', {});
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalled();
      });
    });

    describe('validation failure with Zod error', () => {
      it('should return 400 with formatted error on validation failure', async () => {
        const zodError = createZodError([
          { path: ['email'], message: 'Invalid email format' },
        ]);
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(zodError);
        mockRequest.body = { email: 'invalid' };

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'invalid_request',
            message: 'Invalid email format',
            param: 'email',
            type: 'invalid_request_error',
            details: [{ path: 'email', message: 'Invalid email format' }],
          },
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should log warning with validation errors', async () => {
        const zodError = createZodError([
          { path: ['name'], message: 'Required' },
        ]);
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(zodError);
        mockRequest.body = {};

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockLogger.warn).toHaveBeenCalledWith('Validation failed', {
          target: 'body',
          errors: zodError.errors,
          path: '/test',
        });
      });

      it('should handle multiple validation errors', async () => {
        const zodError = createZodError([
          { path: ['email'], message: 'Invalid email' },
          { path: ['password'], message: 'Password too short' },
          { path: ['username'], message: 'Username required' },
        ]);
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(zodError);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'invalid_request',
            message: 'Invalid email', // First error message
            param: 'email', // First error path
            type: 'invalid_request_error',
            details: [
              { path: 'email', message: 'Invalid email' },
              { path: 'password', message: 'Password too short' },
              { path: 'username', message: 'Username required' },
            ],
          },
        });
      });

      it('should handle nested path in validation error', async () => {
        const zodError = createZodError([
          { path: ['address', 'street'], message: 'Street is required' },
        ]);
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(zodError);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'invalid_request',
            message: 'Street is required',
            param: 'address.street',
            type: 'invalid_request_error',
            details: [{ path: 'address.street', message: 'Street is required' }],
          },
        });
      });

      it('should handle array index in validation error path', async () => {
        const zodError = createZodError([
          { path: ['items', 0, 'price'], message: 'Price must be positive' },
        ]);
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(zodError);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'invalid_request',
            message: 'Price must be positive',
            param: 'items.0.price',
            type: 'invalid_request_error',
            details: [{ path: 'items.0.price', message: 'Price must be positive' }],
          },
        });
      });

      it('should handle empty path in validation error', async () => {
        const zodError = createZodError([
          { path: [], message: 'Invalid input' },
        ]);
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(zodError);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'invalid_request',
            message: 'Invalid input',
            param: undefined,
            type: 'invalid_request_error',
            details: [{ path: '', message: 'Invalid input' }],
          },
        });
      });

      it('should handle validation error with empty errors array', async () => {
        const zodError = createZodError([]);
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(zodError);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'invalid_request',
            message: 'Validation failed',
            param: undefined,
            type: 'invalid_request_error',
            details: [],
          },
        });
      });

      it('should log target as query when validating query', async () => {
        const zodError = createZodError([
          { path: ['page'], message: 'Must be a number' },
        ]);
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(zodError);

        const middleware = validate(schema, 'query');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockLogger.warn).toHaveBeenCalledWith('Validation failed', {
          target: 'query',
          errors: zodError.errors,
          path: '/test',
        });
      });

      it('should log target as params when validating params', async () => {
        const zodError = createZodError([
          { path: ['id'], message: 'Invalid UUID' },
        ]);
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(zodError);

        const middleware = validate(schema, 'params');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockLogger.warn).toHaveBeenCalledWith('Validation failed', {
          target: 'params',
          errors: zodError.errors,
          path: '/test',
        });
      });
    });

    describe('non-Zod errors', () => {
      it('should pass unexpected errors to next', async () => {
        const unexpectedError = new Error('Unexpected error');
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(unexpectedError);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalledWith(unexpectedError);
        expect(statusMock).not.toHaveBeenCalled();
      });

      it('should pass TypeError to next', async () => {
        const typeError = new TypeError('Cannot read property');
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(typeError);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalledWith(typeError);
      });

      it('should pass string errors to next', async () => {
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue('String error');

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalledWith('String error');
      });

      it('should pass null errors to next', async () => {
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(null);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalledWith(null);
      });

      it('should handle object without errors property', async () => {
        const invalidError = { message: 'Not a zod error' };
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(invalidError);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalledWith(invalidError);
      });

      it('should handle object with non-array errors property', async () => {
        const invalidError = { errors: 'not an array' };
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(invalidError);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalledWith(invalidError);
      });
    });

    describe('edge cases', () => {
      it('should handle undefined body', async () => {
        const schema = createMockSchema(undefined);
        mockRequest.body = undefined;

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(schema.parseAsync).toHaveBeenCalledWith(undefined);
        expect(mockNext).toHaveBeenCalled();
      });

      it('should handle null body', async () => {
        const schema = createMockSchema(null);
        mockRequest.body = null;

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(schema.parseAsync).toHaveBeenCalledWith(null);
        expect(mockNext).toHaveBeenCalled();
      });

      it('should handle empty object body', async () => {
        const schema = createMockSchema({});
        mockRequest.body = {};

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalled();
      });

      it('should handle deeply nested validation', async () => {
        const complexData = {
          user: {
            profile: {
              settings: {
                notifications: true,
              },
            },
          },
        };
        const schema = createMockSchema(complexData);
        mockRequest.body = complexData;

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockRequest.body).toEqual(complexData);
        expect(mockNext).toHaveBeenCalled();
      });

      it('should handle array body', async () => {
        const arrayData = [{ id: 1 }, { id: 2 }];
        const schema = createMockSchema(arrayData);
        mockRequest.body = arrayData;

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockRequest.body).toEqual(arrayData);
        expect(mockNext).toHaveBeenCalled();
      });

      it('should handle request path in error logging', async () => {
        (mockRequest as Record<string, unknown>).path = '/api/v1/users/123';
        const zodError = createZodError([
          { path: ['name'], message: 'Required' },
        ]);
        const schema = createMockSchema();
        schema.parseAsync.mockRejectedValue(zodError);

        const middleware = validate(schema, 'body');
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockLogger.warn).toHaveBeenCalledWith('Validation failed', {
          target: 'body',
          errors: zodError.errors,
          path: '/api/v1/users/123',
        });
      });
    });
  });

  describe('validateAll', () => {
    describe('successful validation', () => {
      it('should validate body only', async () => {
        const bodySchema = createMockSchema({ name: 'test' });
        mockRequest.body = { name: 'test' };

        const middleware = validateAll({ body: bodySchema });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(bodySchema.parseAsync).toHaveBeenCalledWith({ name: 'test' });
        expect(mockNext).toHaveBeenCalled();
      });

      it('should validate query only', async () => {
        const querySchema = createMockSchema({ page: 1 });
        mockRequest.query = { page: '1' };

        const middleware = validateAll({ query: querySchema });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(querySchema.parseAsync).toHaveBeenCalledWith({ page: '1' });
        expect(mockNext).toHaveBeenCalled();
      });

      it('should validate params only', async () => {
        const paramsSchema = createMockSchema({ id: 'user-123' });
        mockRequest.params = { id: 'user-123' };

        const middleware = validateAll({ params: paramsSchema });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(paramsSchema.parseAsync).toHaveBeenCalledWith({ id: 'user-123' });
        expect(mockNext).toHaveBeenCalled();
      });

      it('should validate all targets together', async () => {
        const bodySchema = createMockSchema({ name: 'test' });
        const querySchema = createMockSchema({ page: 1 });
        const paramsSchema = createMockSchema({ id: 'user-123' });

        mockRequest.body = { name: 'test' };
        mockRequest.query = { page: '1' };
        mockRequest.params = { id: 'user-123' };

        const middleware = validateAll({
          body: bodySchema,
          query: querySchema,
          params: paramsSchema,
        });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(bodySchema.parseAsync).toHaveBeenCalledWith({ name: 'test' });
        expect(querySchema.parseAsync).toHaveBeenCalledWith({ page: '1' });
        expect(paramsSchema.parseAsync).toHaveBeenCalledWith({ id: 'user-123' });
        expect(mockNext).toHaveBeenCalled();
      });

      it('should replace request data with parsed values', async () => {
        const bodySchema = createMockSchema({ name: 'parsed-name' });
        const querySchema = createMockSchema({ page: 1, limit: 10 });
        const paramsSchema = createMockSchema({ id: 'parsed-id' });

        mockRequest.body = { name: 'original', extra: 'field' };
        mockRequest.query = { page: '1', limit: '10' };
        mockRequest.params = { id: 'original-id' };

        const middleware = validateAll({
          body: bodySchema,
          query: querySchema,
          params: paramsSchema,
        });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockRequest.body).toEqual({ name: 'parsed-name' });
        expect(mockRequest.query).toEqual({ page: 1, limit: 10 });
        expect(mockRequest.params).toEqual({ id: 'parsed-id' });
      });

      it('should handle body and query without params', async () => {
        const bodySchema = createMockSchema({ name: 'test' });
        const querySchema = createMockSchema({ sort: 'asc' });

        mockRequest.body = { name: 'test' };
        mockRequest.query = { sort: 'asc' };

        const middleware = validateAll({
          body: bodySchema,
          query: querySchema,
        });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(bodySchema.parseAsync).toHaveBeenCalled();
        expect(querySchema.parseAsync).toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalled();
      });

      it('should handle empty schemas object', async () => {
        const middleware = validateAll({});
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalled();
      });
    });

    describe('validation failure with Zod error', () => {
      it('should return 400 on body validation failure', async () => {
        const zodError = createZodError([
          { path: ['email'], message: 'Invalid email' },
        ]);
        const bodySchema = createMockSchema();
        bodySchema.parseAsync.mockRejectedValue(zodError);

        const middleware = validateAll({ body: bodySchema });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: {
            code: 'invalid_request',
            message: 'Invalid email',
            param: 'email',
            type: 'invalid_request_error',
            details: [{ path: 'email', message: 'Invalid email' }],
          },
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should return 400 on query validation failure', async () => {
        const bodySchema = createMockSchema({ name: 'test' });
        const zodError = createZodError([
          { path: ['page'], message: 'Must be positive' },
        ]);
        const querySchema = createMockSchema();
        querySchema.parseAsync.mockRejectedValue(zodError);

        mockRequest.body = { name: 'test' };

        const middleware = validateAll({
          body: bodySchema,
          query: querySchema,
        });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should return 400 on params validation failure', async () => {
        const bodySchema = createMockSchema({ name: 'test' });
        const querySchema = createMockSchema({ page: 1 });
        const zodError = createZodError([
          { path: ['id'], message: 'Invalid UUID format' },
        ]);
        const paramsSchema = createMockSchema();
        paramsSchema.parseAsync.mockRejectedValue(zodError);

        mockRequest.body = { name: 'test' };
        mockRequest.query = { page: '1' };

        const middleware = validateAll({
          body: bodySchema,
          query: querySchema,
          params: paramsSchema,
        });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should log warning without target field', async () => {
        const zodError = createZodError([
          { path: ['name'], message: 'Required' },
        ]);
        const bodySchema = createMockSchema();
        bodySchema.parseAsync.mockRejectedValue(zodError);
        (mockRequest as Record<string, unknown>).path = '/api/users';

        const middleware = validateAll({ body: bodySchema });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockLogger.warn).toHaveBeenCalledWith('Validation failed', {
          errors: zodError.errors,
          path: '/api/users',
        });
      });

      it('should stop validation on first error', async () => {
        const zodError = createZodError([
          { path: ['name'], message: 'Required' },
        ]);
        const bodySchema = createMockSchema();
        bodySchema.parseAsync.mockRejectedValue(zodError);
        const querySchema = createMockSchema({ page: 1 });

        const middleware = validateAll({
          body: bodySchema,
          query: querySchema,
        });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(bodySchema.parseAsync).toHaveBeenCalled();
        expect(querySchema.parseAsync).not.toHaveBeenCalled();
      });
    });

    describe('non-Zod errors', () => {
      it('should pass unexpected errors to next', async () => {
        const unexpectedError = new Error('Database connection failed');
        const bodySchema = createMockSchema();
        bodySchema.parseAsync.mockRejectedValue(unexpectedError);

        const middleware = validateAll({ body: bodySchema });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalledWith(unexpectedError);
        expect(statusMock).not.toHaveBeenCalled();
      });

      it('should pass query schema error to next if not Zod error', async () => {
        const bodySchema = createMockSchema({ name: 'test' });
        const queryError = new Error('Query parsing failed');
        const querySchema = createMockSchema();
        querySchema.parseAsync.mockRejectedValue(queryError);

        mockRequest.body = { name: 'test' };

        const middleware = validateAll({
          body: bodySchema,
          query: querySchema,
        });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalledWith(queryError);
      });

      it('should pass params schema error to next if not Zod error', async () => {
        const bodySchema = createMockSchema({ name: 'test' });
        const querySchema = createMockSchema({ page: 1 });
        const paramsError = new TypeError('Invalid params');
        const paramsSchema = createMockSchema();
        paramsSchema.parseAsync.mockRejectedValue(paramsError);

        mockRequest.body = { name: 'test' };
        mockRequest.query = { page: '1' };

        const middleware = validateAll({
          body: bodySchema,
          query: querySchema,
          params: paramsSchema,
        });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalledWith(paramsError);
      });
    });

    describe('edge cases', () => {
      it('should handle undefined request properties', async () => {
        const bodySchema = createMockSchema(undefined);
        mockRequest.body = undefined;

        const middleware = validateAll({ body: bodySchema });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(bodySchema.parseAsync).toHaveBeenCalledWith(undefined);
        expect(mockNext).toHaveBeenCalled();
      });

      it('should handle empty query object', async () => {
        const querySchema = createMockSchema({});
        mockRequest.query = {};

        const middleware = validateAll({ query: querySchema });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalled();
      });

      it('should handle empty params object', async () => {
        const paramsSchema = createMockSchema({});
        mockRequest.params = {};

        const middleware = validateAll({ params: paramsSchema });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(mockNext).toHaveBeenCalled();
      });

      it('should maintain validation order: body, query, params', async () => {
        const callOrder: string[] = [];

        const bodySchema = createMockSchema({ name: 'test' });
        bodySchema.parseAsync = jest.fn().mockImplementation(async () => {
          callOrder.push('body');
          return { name: 'test' };
        });

        const querySchema = createMockSchema({ page: 1 });
        querySchema.parseAsync = jest.fn().mockImplementation(async () => {
          callOrder.push('query');
          return { page: 1 };
        });

        const paramsSchema = createMockSchema({ id: '123' });
        paramsSchema.parseAsync = jest.fn().mockImplementation(async () => {
          callOrder.push('params');
          return { id: '123' };
        });

        const middleware = validateAll({
          body: bodySchema,
          query: querySchema,
          params: paramsSchema,
        });
        await middleware(
          mockRequest as Request,
          mockResponse as Response,
          mockNext
        );

        expect(callOrder).toEqual(['body', 'query', 'params']);
      });
    });
  });

  describe('isZodError detection', () => {
    it('should detect object with errors array as Zod error', async () => {
      const zodLikeError = { errors: [{ path: ['test'], message: 'Error' }] };
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(zodLikeError);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should be treated as Zod error - returns 400
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should not detect null as Zod error', async () => {
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(null);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should pass to next as non-Zod error
      expect(mockNext).toHaveBeenCalledWith(null);
    });

    it('should not detect undefined as Zod error', async () => {
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(undefined);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should pass to next as non-Zod error
      expect(mockNext).toHaveBeenCalledWith(undefined);
    });

    it('should not detect primitive as Zod error', async () => {
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(42);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should pass to next as non-Zod error
      expect(mockNext).toHaveBeenCalledWith(42);
    });

    it('should not detect object without errors property as Zod error', async () => {
      const notZodError = { name: 'Error', message: 'Something went wrong' };
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(notZodError);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should pass to next as non-Zod error
      expect(mockNext).toHaveBeenCalledWith(notZodError);
    });

    it('should not detect object with non-array errors as Zod error', async () => {
      const notZodError = { errors: 'not an array' };
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(notZodError);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should pass to next as non-Zod error
      expect(mockNext).toHaveBeenCalledWith(notZodError);
    });

    it('should not detect object with errors as null as Zod error', async () => {
      const notZodError = { errors: null };
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(notZodError);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Should pass to next as non-Zod error
      expect(mockNext).toHaveBeenCalledWith(notZodError);
    });
  });

  describe('formatZodError', () => {
    it('should format error with single path segment', async () => {
      const zodError = createZodError([
        { path: ['email'], message: 'Invalid email' },
      ]);
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(zodError);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith({
        error: expect.objectContaining({
          param: 'email',
        }),
      });
    });

    it('should format error with multiple path segments joined by dots', async () => {
      const zodError = createZodError([
        { path: ['user', 'address', 'city'], message: 'City is required' },
      ]);
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(zodError);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith({
        error: expect.objectContaining({
          param: 'user.address.city',
          details: [{ path: 'user.address.city', message: 'City is required' }],
        }),
      });
    });

    it('should handle error with undefined message', async () => {
      // Simulating edge case where message might be undefined
      const zodError = createZodError([
        { path: ['field'], message: undefined as unknown as string },
      ]);
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(zodError);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: expect.objectContaining({
          param: 'field',
          details: [{ path: 'field', message: undefined }],
        }),
      });
    });

    it('should use first error message from multiple errors', async () => {
      const zodError = createZodError([
        { path: ['first'], message: 'First error message' },
        { path: ['second'], message: 'Second error message' },
      ]);
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(zodError);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith({
        error: expect.objectContaining({
          message: 'First error message',
          param: 'first',
        }),
      });
    });

    it('should include all errors in details array', async () => {
      const zodError = createZodError([
        { path: ['a'], message: 'Error A' },
        { path: ['b'], message: 'Error B' },
        { path: ['c'], message: 'Error C' },
      ]);
      const schema = createMockSchema();
      schema.parseAsync.mockRejectedValue(zodError);

      const middleware = validate(schema, 'body');
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith({
        error: expect.objectContaining({
          details: [
            { path: 'a', message: 'Error A' },
            { path: 'b', message: 'Error B' },
            { path: 'c', message: 'Error C' },
          ],
        }),
      });
    });
  });

  describe('ValidationTarget type', () => {
    it('should accept body as valid target', async () => {
      const schema = createMockSchema({ test: true });
      const target: ValidationTarget = 'body';

      const middleware = validate(schema, target);
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should accept query as valid target', async () => {
      const schema = createMockSchema({ test: true });
      const target: ValidationTarget = 'query';

      const middleware = validate(schema, target);
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should accept params as valid target', async () => {
      const schema = createMockSchema({ test: true });
      const target: ValidationTarget = 'params';

      const middleware = validate(schema, target);
      await middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });
  });
});
