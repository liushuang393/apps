import { logger, stream } from '../../../utils/logger';
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

  it('should have http log method', () => {
    expect(logger.http).toBeDefined();
    expect(() => logger.http('HTTP request')).not.toThrow();
  });

  it('should log with metadata', () => {
    expect(() => logger.info('Test with metadata', { userId: '123', action: 'test' })).not.toThrow();
    expect(() => logger.error('Error with metadata', { error: new Error('Test error'), code: 500 })).not.toThrow();
  });

  it('should handle Error objects in logging', () => {
    const error = new Error('Test error message');
    expect(() => logger.error('Caught error', { error })).not.toThrow();
  });
});

describe('Logger Stream', () => {
  it('should be defined', () => {
    expect(stream).toBeDefined();
    expect(stream.write).toBeDefined();
  });

  it('should write messages to http log level', () => {
    const httpSpy = jest.spyOn(logger, 'http').mockImplementation();
    
    stream.write('GET /api/health 200 10ms\n');
    
    expect(httpSpy).toHaveBeenCalledWith('GET /api/health 200 10ms');
    httpSpy.mockRestore();
  });

  it('should trim whitespace from messages', () => {
    const httpSpy = jest.spyOn(logger, 'http').mockImplementation();
    
    stream.write('  Message with whitespace  \n');
    
    expect(httpSpy).toHaveBeenCalledWith('Message with whitespace');
    httpSpy.mockRestore();
  });

  it('should handle empty messages', () => {
    const httpSpy = jest.spyOn(logger, 'http').mockImplementation();
    
    stream.write('\n');
    
    expect(httpSpy).toHaveBeenCalledWith('');
    httpSpy.mockRestore();
  });

  it('should handle messages without newlines', () => {
    const httpSpy = jest.spyOn(logger, 'http').mockImplementation();
    
    stream.write('Simple message');
    
    expect(httpSpy).toHaveBeenCalledWith('Simple message');
    httpSpy.mockRestore();
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

  it('should handle stream write with arbitrary strings', () => {
    const httpSpy = jest.spyOn(logger, 'http').mockImplementation();
    
    fc.assert(
      fc.property(fc.string(), (message) => {
        expect(() => stream.write(message)).not.toThrow();
      })
    );
    
    httpSpy.mockRestore();
  });
});
