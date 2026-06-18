/**
 * 音声ユーティリティ関数
 *
 * @description
 * 音声データの変換、エンコード、デコード機能を提供
 *
 * @author VoiceTranslate Pro Team
 * @version 2.0.0
 */

/**
 * 音声ユーティリティクラス
 */
export class AudioUtils {
    /**
     * ArrayBuffer を Base64 にエンコード
     *
     * 目的:
     *   ブラウザ/Node.js/Electron 全環境で動作する Base64 変換
     *
     * I/O:
     *   - 入力: ArrayBuffer
     *   - 出力: Base64文字列
     *
     * 注意点:
     *   - ブラウザ環境では btoa を使用
     *   - Node.js/Electron では Buffer を使用
     */
    static arrayBufferToBase64(buffer: ArrayBuffer): string {
        // Node.js/Electron 環境対応
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(new Uint8Array(buffer)).toString('base64');
        }

        // ブラウザ環境（btoa使用）
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        return btoa(binary);
    }

    /**
     * Base64 を ArrayBuffer にデコード
     */
    static base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * Float32Array を PCM16 にエンコード
     */
    static floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
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
     * PCM16 を Float32Array にデコード
     */
    static pcm16ToFloat(buffer: ArrayBuffer): Float32Array {
        const view = new DataView(buffer);
        const float32 = new Float32Array(buffer.byteLength / 2);

        for (let i = 0; i < float32.length; i++) {
            const int16 = view.getInt16(i * 2, true);
            float32[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
        }

        return float32;
    }

    /**
     * 音声データを結合
     */
    static concatenateAudioBuffers(buffers: Float32Array[]): Float32Array {
        const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
        const result = new Float32Array(totalLength);

        let offset = 0;
        for (const buffer of buffers) {
            result.set(buffer, offset);
            offset += buffer.length;
        }

        return result;
    }

    /**
     * 音声データを正規化
     */
    static normalizeAudio(samples: Float32Array): Float32Array {
        const max = Math.max(...Array.from(samples).map(Math.abs));

        if (max === 0) {
            return samples;
        }

        const normalized = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            normalized[i] = samples[i]! / max;
        }

        return normalized;
    }

    /**
     * RMS (Root Mean Square) を計算
     */
    static calculateRMS(samples: Float32Array): number {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i]! * samples[i]!;
        }
        return Math.sqrt(sum / samples.length);
    }

    /**
     * ピーク値を計算
     */
    static calculatePeak(samples: Float32Array): number {
        let peak = 0;
        for (let i = 0; i < samples.length; i++) {
            const abs = Math.abs(samples[i]!);
            if (abs > peak) {
                peak = abs;
            }
        }
        return peak;
    }

    /**
     * 無音を検出
     */
    static isSilence(samples: Float32Array, threshold = 0.01): boolean {
        const rms = this.calculateRMS(samples);
        return rms < threshold;
    }

    /**
     * 音声データをトリミング（無音部分を削除）
     */
    static trimSilence(samples: Float32Array, threshold = 0.01): Float32Array {
        let start = 0;
        let end = samples.length - 1;

        // 開始位置を検索
        while (start < samples.length && Math.abs(samples[start]!) < threshold) {
            start++;
        }

        // 終了位置を検索
        while (end > start && Math.abs(samples[end]!) < threshold) {
            end--;
        }

        return samples.slice(start, end + 1);
    }

    /**
     * 音声データにフェードイン/フェードアウトを適用
     */
    static applyFade(
        samples: Float32Array,
        fadeInSamples: number,
        fadeOutSamples: number
    ): Float32Array {
        const result = new Float32Array(samples);

        // フェードイン
        for (let i = 0; i < Math.min(fadeInSamples, samples.length); i++) {
            result[i]! *= i / fadeInSamples;
        }

        // フェードアウト
        const fadeOutStart = samples.length - fadeOutSamples;
        for (let i = fadeOutStart; i < samples.length; i++) {
            result[i]! *= (samples.length - i) / fadeOutSamples;
        }

        return result;
    }
}
