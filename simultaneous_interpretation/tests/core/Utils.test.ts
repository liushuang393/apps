/**
 * Utils.ts のテスト
 */

import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    floatTo16BitPCM,
    formatTime,
    getLanguageName,
    getNativeLanguageName
} from '../../src/core/Utils';

describe('Utils', () => {
    describe('arrayBufferToBase64', () => {
        it('should convert ArrayBuffer to Base64', () => {
            const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
            const base64 = arrayBufferToBase64(buffer);
            expect(base64).toBe('SGVsbG8=');
        });

        it('should handle empty ArrayBuffer', () => {
            const buffer = new Uint8Array([]).buffer;
            const base64 = arrayBufferToBase64(buffer);
            expect(base64).toBe('');
        });
    });

    describe('base64ToArrayBuffer', () => {
        it('should convert Base64 to ArrayBuffer', () => {
            const base64 = 'SGVsbG8=';
            const buffer = base64ToArrayBuffer(base64);
            const bytes = new Uint8Array(buffer);
            expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
        });

        it('should handle empty Base64 string', () => {
            const base64 = '';
            const buffer = base64ToArrayBuffer(base64);
            const bytes = new Uint8Array(buffer);
            expect(bytes.length).toBe(0);
        });
    });

    describe('Base64 round-trip', () => {
        it('should correctly encode and decode', () => {
            const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            const base64 = arrayBufferToBase64(original.buffer);
            const decoded = new Uint8Array(base64ToArrayBuffer(base64));
            expect(Array.from(decoded)).toEqual(Array.from(original));
        });
    });

    describe('floatTo16BitPCM', () => {
        it('should convert Float32Array to PCM16', () => {
            const float32 = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
            const pcm16 = floatTo16BitPCM(float32);
            const view = new DataView(pcm16);

            expect(view.getInt16(0, true)).toBe(0);
            expect(view.getInt16(2, true)).toBe(Math.floor(0.5 * 0x7FFF));
            expect(view.getInt16(4, true)).toBe(Math.floor(-0.5 * 0x8000));
            expect(view.getInt16(6, true)).toBe(0x7FFF);
            expect(view.getInt16(8, true)).toBe(-0x8000);
        });

        it('should clamp values outside [-1, 1]', () => {
            const float32 = new Float32Array([2.0, -2.0]);
            const pcm16 = floatTo16BitPCM(float32);
            const view = new DataView(pcm16);
            
            expect(view.getInt16(0, true)).toBe(0x7FFF);
            expect(view.getInt16(2, true)).toBe(-0x8000);
        });

        it('should handle empty array', () => {
            const float32 = new Float32Array([]);
            const pcm16 = floatTo16BitPCM(float32);
            expect(pcm16.byteLength).toBe(0);
        });
    });

    describe('formatTime', () => {
        it('should format seconds to HH:MM:SS', () => {
            expect(formatTime(0)).toBe('00:00:00');
            expect(formatTime(59)).toBe('00:00:59');
            expect(formatTime(60)).toBe('00:01:00');
            expect(formatTime(3599)).toBe('00:59:59');
            expect(formatTime(3600)).toBe('01:00:00');
            expect(formatTime(3661)).toBe('01:01:01');
        });

        it('should handle large values', () => {
            expect(formatTime(86399)).toBe('23:59:59');
            expect(formatTime(86400)).toBe('24:00:00');
        });
    });

    describe('getLanguageName', () => {
        it('should return English name for known language codes', () => {
            expect(getLanguageName('ja')).toBe('Japanese');
            expect(getLanguageName('en')).toBe('English');
            expect(getLanguageName('zh')).toBe('Chinese');
            expect(getLanguageName('ko')).toBe('Korean');
            expect(getLanguageName('es')).toBe('Spanish');
            expect(getLanguageName('fr')).toBe('French');
            expect(getLanguageName('de')).toBe('German');
            expect(getLanguageName('pt')).toBe('Portuguese');
        });

        it('should return code itself for unknown language codes', () => {
            expect(getLanguageName('unknown')).toBe('unknown');
            expect(getLanguageName('xyz')).toBe('xyz');
        });
    });

    describe('getNativeLanguageName', () => {
        it('should return native name for known language codes', () => {
            expect(getNativeLanguageName('ja')).toBe('日本語');
            expect(getNativeLanguageName('en')).toBe('English');
            expect(getNativeLanguageName('zh')).toBe('中文');
            expect(getNativeLanguageName('ko')).toBe('한국어');
            expect(getNativeLanguageName('es')).toBe('Español');
            expect(getNativeLanguageName('fr')).toBe('Français');
            expect(getNativeLanguageName('de')).toBe('Deutsch');
            expect(getNativeLanguageName('pt')).toBe('Português');
        });

        it('should return code itself for unknown language codes', () => {
            expect(getNativeLanguageName('unknown')).toBe('unknown');
            expect(getNativeLanguageName('xyz')).toBe('xyz');
        });
    });
});

