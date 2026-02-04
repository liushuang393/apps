import { logger } from '../../../utils/logger';
import * as fc from 'fast-check';

describe('Logger', () => {
  it('should be defined', () => {
    expect(logger).toBeDefined();
  });

  it('should have required log methods', () => {
    expect(logger.error).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.debug).toBeDefined();
  });

  it('should not throw when logging messages', () => {
    expect(() => logger.info('Test message')).not.toThrow();
    expect(() => logger.error('Test error')).not.toThrow();
    expect(() => logger.warn('Test warning')).not.toThrow();
    expect(() => logger.debug('Test debug')).not.toThrow();
  });
});

describe('Logger - Property-Based Tests', () => {
  it('should handle arbitrary string messages without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (message) => {
        expect(() => logger.info(message)).not.toThrow();
      })
    );
  });

  it('should handle arbitrary objects in metadata without throwing', () => {
    fc.assert(
      fc.property(fc.string(), fc.object(), (message, metadata) => {
        expect(() => logger.info(message, metadata)).not.toThrow();
      })
    );
  });
});
