/**
 * QualityMetrics.ts
 *
 * 目的: 翻訳品質評価メトリクスの計算
 *
 * 機能:
 *   - CER (Character Error Rate) 計算
 *   - WER (Word Error Rate) 計算
 *   - BLEU スコア計算
 *   - Levenshtein距離計算
 *
 * 使用方法:
 *   const cer = calculateCER(reference, hypothesis);
 *   const wer = calculateWER(reference, hypothesis);
 *   const bleu = calculateBLEU(references, hypothesis);
 *
 * 注意:
 *   - 日本語、中国語、ベトナム語、英語に対応
 *   - 正規化処理を含む
 */

import { defaultLogger } from '../utils/Logger';

/**
 * Levenshtein距離計算
 *
 * 目的: 2つの文字列間の編集距離を計算
 *
 * @param str1 文字列1
 * @param str2 文字列2
 * @returns Levenshtein距離
 */
export function levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;

    // DP テーブル
    const dp: number[][] = Array(len1 + 1)
        .fill(null)
        .map(() => Array(len2 + 1).fill(0));

    // 初期化
    for (let i = 0; i <= len1; i++) {
        dp[i]![0] = i;
    }
    for (let j = 0; j <= len2; j++) {
        dp[0]![j] = j;
    }

    // DP計算
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            dp[i]![j] = Math.min(
                dp[i - 1]![j]! + 1, // 削除
                dp[i]![j - 1]! + 1, // 挿入
                dp[i - 1]![j - 1]! + cost // 置換
            );
        }
    }

    return dp[len1]![len2]!;
}

/**
 * 文字列正規化
 *
 * 目的: 比較前に文字列を正規化
 *
 * @param text 入力テキスト
 * @param lang 言語コード
 * @returns 正規化されたテキスト
 */
export function normalizeText(text: string, lang: string): string {
    let normalized = text;

    // 小文字化（英語のみ）
    if (lang === 'en') {
        normalized = normalized.toLowerCase();
    }

    // 前後の空白削除
    normalized = normalized.trim();

    // 連続する空白を1つに
    normalized = normalized.replace(/\s+/g, ' ');

    // 句読点の正規化
    normalized = normalized.replace(/[、。！？]/g, ''); // 日本語句読点削除
    normalized = normalized.replace(/[,.!?]/g, ''); // 英語句読点削除

    return normalized;
}

/**
 * CER (Character Error Rate) 計算
 *
 * 目的: 文字レベルの誤り率を計算
 *
 * @param reference 参照テキスト
 * @param hypothesis 仮説テキスト（翻訳結果）
 * @param lang 言語コード
 * @returns CER（0.0-1.0）
 */
export function calculateCER(reference: string, hypothesis: string, lang: string = 'ja'): number {
    // 正規化
    const refNorm = normalizeText(reference, lang);
    const hypNorm = normalizeText(hypothesis, lang);

    // Levenshtein距離計算
    const distance = levenshteinDistance(refNorm, hypNorm);

    // CER = 編集距離 / 参照文字数
    const cer = refNorm.length > 0 ? distance / refNorm.length : 0;

    defaultLogger.debug('[QualityMetrics] CER計算', {
        reference: refNorm,
        hypothesis: hypNorm,
        distance,
        cer: (cer * 100).toFixed(2) + '%'
    });

    return cer;
}

/**
 * WER (Word Error Rate) 計算
 *
 * 目的: 単語レベルの誤り率を計算
 *
 * @param reference 参照テキスト
 * @param hypothesis 仮説テキスト（翻訳結果）
 * @param lang 言語コード
 * @returns WER（0.0-1.0）
 */
export function calculateWER(reference: string, hypothesis: string, lang: string = 'en'): number {
    // 正規化
    const refNorm = normalizeText(reference, lang);
    const hypNorm = normalizeText(hypothesis, lang);

    // 単語分割
    const refWords = tokenizeWords(refNorm, lang);
    const hypWords = tokenizeWords(hypNorm, lang);

    // Levenshtein距離計算（単語レベル）
    const distance = levenshteinDistanceWords(refWords, hypWords);

    // WER = 編集距離 / 参照単語数
    const wer = refWords.length > 0 ? distance / refWords.length : 0;

    defaultLogger.debug('[QualityMetrics] WER計算', {
        reference: refWords.join(' '),
        hypothesis: hypWords.join(' '),
        distance,
        wer: (wer * 100).toFixed(2) + '%'
    });

    return wer;
}

/**
 * 単語分割
 *
 * 目的: 言語に応じて単語を分割
 *
 * @param text テキスト
 * @param lang 言語コード
 * @returns 単語配列
 */
function tokenizeWords(text: string, lang: string): string[] {
    if (lang === 'ja' || lang === 'zh') {
        // 日本語・中国語: 文字単位で分割（簡略化）
        // 実際の実装では形態素解析を使用
        return text.split('');
    } else {
        // 英語・ベトナム語: 空白で分割
        return text.split(/\s+/).filter((word) => word.length > 0);
    }
}

/**
 * Levenshtein距離計算（単語レベル）
 *
 * @param words1 単語配列1
 * @param words2 単語配列2
 * @returns Levenshtein距離
 */
function levenshteinDistanceWords(words1: string[], words2: string[]): number {
    const len1 = words1.length;
    const len2 = words2.length;

    // DP テーブル
    const dp: number[][] = Array(len1 + 1)
        .fill(null)
        .map(() => Array(len2 + 1).fill(0));

    // 初期化
    for (let i = 0; i <= len1; i++) {
        dp[i]![0] = i;
    }
    for (let j = 0; j <= len2; j++) {
        dp[0]![j] = j;
    }

    // DP計算
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = words1[i - 1] === words2[j - 1] ? 0 : 1;
            dp[i]![j] = Math.min(
                dp[i - 1]![j]! + 1, // 削除
                dp[i]![j - 1]! + 1, // 挿入
                dp[i - 1]![j - 1]! + cost // 置換
            );
        }
    }

    return dp[len1]![len2]!;
}

/**
 * BLEU スコア計算
 *
 * 目的: 機械翻訳の品質を評価
 *
 * @param references 参照翻訳配列（複数の参照翻訳）
 * @param hypothesis 仮説翻訳（翻訳結果）
 * @param lang 言語コード
 * @param maxN 最大n-gram（デフォルト: 4）
 * @returns BLEU スコア（0.0-1.0）
 */
export function calculateBLEU(
    references: string[],
    hypothesis: string,
    lang: string = 'en',
    maxN: number = 4
): number {
    // 正規化
    const refNorms = references.map((ref) => normalizeText(ref, lang));
    const hypNorm = normalizeText(hypothesis, lang);

    // 単語分割
    const refWordsList = refNorms.map((ref) => tokenizeWords(ref, lang));
    const hypWords = tokenizeWords(hypNorm, lang);

    // Brevity Penalty計算
    const hypLen = hypWords.length;
    const refLens = refWordsList.map((words) => words.length);
    const closestRefLen = refLens.reduce((prev, curr) =>
        Math.abs(curr - hypLen) < Math.abs(prev - hypLen) ? curr : prev
    );
    const bp = hypLen >= closestRefLen ? 1 : Math.exp(1 - closestRefLen / hypLen);

    // n-gram precision計算
    const precisions: number[] = [];
    for (let n = 1; n <= maxN; n++) {
        const hypNgrams = getNgrams(hypWords, n);
        const refNgramsList = refWordsList.map((words) => getNgrams(words, n));

        let matchCount = 0;
        const totalCount = hypNgrams.length;

        for (const hypNgram of hypNgrams) {
            const maxRefCount = Math.max(
                ...refNgramsList.map(
                    (refNgrams) => refNgrams.filter((refNgram) => refNgram === hypNgram).length
                )
            );
            if (maxRefCount > 0) {
                matchCount++;
            }
        }

        const precision = totalCount > 0 ? matchCount / totalCount : 0;
        precisions.push(precision);
    }

    // BLEU = BP × exp(Σ log(precision_n) / N)
    const logPrecisionSum = precisions.reduce((sum, p) => sum + Math.log(p + 1e-10), 0);
    const bleu = bp * Math.exp(logPrecisionSum / maxN);

    defaultLogger.debug('[QualityMetrics] BLEU計算', {
        hypothesis: hypWords.join(' '),
        precisions,
        bp,
        bleu: bleu.toFixed(4)
    });

    return bleu;
}

/**
 * n-gram生成
 *
 * @param words 単語配列
 * @param n n-gramのn
 * @returns n-gram配列
 */
function getNgrams(words: string[], n: number): string[] {
    const ngrams: string[] = [];
    for (let i = 0; i <= words.length - n; i++) {
        const ngram = words.slice(i, i + n).join(' ');
        ngrams.push(ngram);
    }
    return ngrams;
}

/**
 * バッチCER計算
 *
 * @param pairs 参照-仮説ペア配列
 * @param lang 言語コード
 * @returns 平均CER
 */
export function calculateBatchCER(
    pairs: Array<{ reference: string; hypothesis: string }>,
    lang: string = 'ja'
): number {
    const cers = pairs.map((pair) => calculateCER(pair.reference, pair.hypothesis, lang));
    return cers.reduce((sum, cer) => sum + cer, 0) / cers.length;
}

/**
 * バッチWER計算
 *
 * @param pairs 参照-仮説ペア配列
 * @param lang 言語コード
 * @returns 平均WER
 */
export function calculateBatchWER(
    pairs: Array<{ reference: string; hypothesis: string }>,
    lang: string = 'en'
): number {
    const wers = pairs.map((pair) => calculateWER(pair.reference, pair.hypothesis, lang));
    return wers.reduce((sum, wer) => sum + wer, 0) / wers.length;
}
