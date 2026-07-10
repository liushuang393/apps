const base = require('./jest.config');

module.exports = {
    ...base,
    displayName: 'runtime-electron',
    testMatch: [
        '**/tests/electron/**/*.test.ts',
        '**/tests/runtime/**/*.test.js',
        '**/tests/audio/AudioQueue.test.js',
        '**/tests/audio/WorkletDownmix.test.js'
    ],
    collectCoverageFrom: [
        'electron/{CredentialService,OpenAIConfigService,TranslationGateway,realtimeWebSocket}.ts',
        'voicetranslate-{utils,audio-queue,platform-adapter}.js',
        'audio-processor-worklet.js'
    ],
    coverageThreshold: {
        './electron/': {
            branches: 60,
            functions: 70,
            lines: 70,
            statements: 70
        },
        './electron/CredentialService.ts': {
            branches: 60,
            functions: 70,
            lines: 70,
            statements: 70
        },
        './electron/OpenAIConfigService.ts': {
            branches: 60,
            functions: 70,
            lines: 70,
            statements: 70
        },
        './electron/TranslationGateway.ts': {
            branches: 60,
            functions: 70,
            lines: 70,
            statements: 70
        },
        './electron/realtimeWebSocket.ts': {
            branches: 60,
            functions: 70,
            lines: 70,
            statements: 70
        }
    }
};
