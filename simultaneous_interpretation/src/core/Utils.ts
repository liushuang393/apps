/**
 * VoiceTranslate Pro - ユーティリティ関数
 *
 * 目的: アプリケーション全体で使用する汎用的なユーティリティ関数を提供
 *
 * 機能:
 * - Base64エンコード/デコード
 * - Float32 to PCM16変換
 * - 時間フォーマット
 * - 言語名取得
 *
 * 注意点:
 * - ブラウザ環境とNode.js環境の両方で動作可能
 */

/**
 * ArrayBufferをBase64文字列に変換
 *
 * @param buffer - 変換するArrayBuffer
 * @returns Base64エンコードされた文字列
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
}

/**
 * Base64文字列をArrayBufferに変換
 *
 * @param base64 - Base64エンコードされた文字列
 * @returns デコードされたArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Float32配列をPCM16形式のArrayBufferに変換
 *
 * @param float32Array - 変換するFloat32Array (-1.0 ~ 1.0)
 * @returns PCM16形式のArrayBuffer
 */
export function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, float32Array[i]!));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
}

/**
 * 秒数を HH:MM:SS 形式にフォーマット
 *
 * @param seconds - フォーマットする秒数
 * @returns HH:MM:SS 形式の文字列
 */
export function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * 言語コードマッピング（英語名）
 * 対応言語: 英語、日本語、簡体中文、ベトナム語のみ
 */
const LANGUAGE_NAMES: Record<string, string> = {
    ja: 'Japanese',
    en: 'English',
    zh: 'Simplified Chinese',
    vi: 'Vietnamese'
};

/**
 * 言語コードマッピング（ネイティブ名）
 * 対応言語: 英語、日本語、簡体中文、ベトナム語のみ
 */
const NATIVE_LANGUAGE_NAMES: Record<string, string> = {
    ja: '日本語',
    en: 'English',
    zh: '简体中文',
    vi: 'Tiếng Việt'
};

/**
 * 言語コードから英語名を取得
 *
 * @param code - 言語コード (例: 'ja', 'en')
 * @returns 言語の英語名 (例: 'Japanese', 'English')
 */
export function getLanguageName(code: string): string {
    return LANGUAGE_NAMES[code] || code;
}

/**
 * 言語コードからネイティブ名を取得
 *
 * @param code - 言語コード (例: 'ja', 'en')
 * @returns 言語のネイティブ名 (例: '日本語', 'English')
 */
export function getNativeLanguageName(code: string): string {
    return NATIVE_LANGUAGE_NAMES[code] || code;
}

/**
 * ユーティリティ関数をまとめたオブジェクト（後方互換性のため）
 *
 * @deprecated 個別の関数をインポートして使用してください
 */
export const Utils = {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    floatTo16BitPCM,
    formatTime,
    getLanguageName,
    getNativeLanguageName
};
