/**
 * 適応的VADバッファ管理
 *
 * @description
 * 言語・シナリオ・ユーザーの発話パターンに応じて
 * VADパラメータを動的に調整するモジュール
 *
 * @author VoiceTranslate Pro Team
 * @version 1.0.0
 *
 * @example
 * ```typescript
 * const buffer = new AdaptiveVADBuffer('ja', 'meeting');
 * const params = buffer.calculateOptimalParams();
 * // 発話完了後に記録
 * buffer.recordSpeech(1500, 300);
 * ```
 */

import type { ScenarioPreset, VADParameters, VADHistoryData } from '../types/VADConfig';
import {
    SCENARIO_PRESETS,
    ADAPTIVE_VAD_CONSTRAINTS,
    getLanguageVADConfig
} from '../config/VADPresets';
import { defaultLogger } from '../utils/Logger';

export class AdaptiveVADBuffer {
    private language: string;
    private scenario: ScenarioPreset;
    private history: VADHistoryData;

    /**
     * コンストラクタ
     *
     * @param language 言語コード (e.g., 'ja', 'en', 'zh', 'vi')
     * @param scenario シナリオプリセット
     */
    constructor(language: string, scenario: ScenarioPreset = 'conversation') {
        this.language = language;
        this.scenario = scenario;
        this.history = {
            durations: [],
            silences: [],
            maxHistory: ADAPTIVE_VAD_CONSTRAINTS.MAX_HISTORY_COUNT
        };
    }

    /**
     * 最適パラメータを計算
     *
     * @returns 計算されたVADパラメータ
     *
     * @description
     * ステップ1: 基本値取得（言語 × シナリオ）
     * ステップ2: 適応的調整（履歴がある場合）
     * ステップ3: ガードレール適用（範囲制限）
     */
    calculateOptimalParams(): VADParameters {
        // ステップ1: 基本値取得
        const baseConfig = getLanguageVADConfig(this.language);
        const preset = SCENARIO_PRESETS[this.scenario];

        let minDuration = baseConfig.minSpeechDuration * preset.minMult;
        let silenceDelay = baseConfig.silenceConfirmDelay * preset.silenceMult;
        let adaptiveApplied = false;

        // ステップ2: 適応的調整
        if (this.history.durations.length >= ADAPTIVE_VAD_CONSTRAINTS.MIN_HISTORY_COUNT) {
            const avgDuration = this.average(this.history.durations);
            const avgSilence = this.average(this.history.silences);

            // 平均発話時長の70%を下限とする
            const adaptiveDuration = Math.max(
                minDuration,
                avgDuration * ADAPTIVE_VAD_CONSTRAINTS.AVG_DURATION_FLOOR
            );

            // 平均無声時長の80%を目標とする
            const { min, max, target } = ADAPTIVE_VAD_CONSTRAINTS.AVG_SILENCE_MULTIPLIER;
            const adaptiveSilence = this.clamp(
                avgSilence * target,
                silenceDelay * min,
                silenceDelay * max
            );

            minDuration = adaptiveDuration;
            silenceDelay = adaptiveSilence;
            adaptiveApplied = true;
        }

        // ステップ3: ガードレール適用
        const { MIN_MULTIPLIER, MAX_MULTIPLIER } = ADAPTIVE_VAD_CONSTRAINTS;
        minDuration = this.clamp(
            minDuration,
            baseConfig.minSpeechDuration * MIN_MULTIPLIER,
            baseConfig.minSpeechDuration * MAX_MULTIPLIER
        );

        silenceDelay = this.clamp(
            silenceDelay,
            baseConfig.silenceConfirmDelay * MIN_MULTIPLIER,
            baseConfig.silenceConfirmDelay * MAX_MULTIPLIER
        );

        return {
            minDuration: Math.round(minDuration),
            silenceDelay: Math.round(silenceDelay),
            language: this.language,
            scenario: this.scenario,
            adaptiveApplied
        };
    }

    /**
     * 発話を記録
     *
     * @param duration 発話時長 (ms)
     * @param silenceBefore 発話前の無声時長 (ms)
     *
     * @description
     * 直近の発話データを履歴に記録し、適応的調整に使用
     * 最大履歴件数を超えた場合は古いものを削除
     */
    recordSpeech(duration: number, silenceBefore: number): void {
        // 検証
        if (duration < 0 || silenceBefore < 0) {
            defaultLogger.warn('[AdaptiveVADBuffer] 不正な値:', { duration, silenceBefore });
            return;
        }

        // 履歴に追加
        this.history.durations.push(duration);
        this.history.silences.push(silenceBefore);

        // 最大件数を超えた場合、古いものを削除
        if (this.history.durations.length > this.history.maxHistory) {
            this.history.durations.shift();
            this.history.silences.shift();
        }
    }

    /**
     * 言語を変更
     *
     * @param language 新しい言語コード
     *
     * @description
     * 言語を変更すると、履歴はリセットされる
     */
    setLanguage(language: string): void {
        if (this.language !== language) {
            this.language = language;
            this.resetHistory();
        }
    }

    /**
     * シナリオを変更
     *
     * @param scenario 新しいシナリオ
     */
    setScenario(scenario: ScenarioPreset): void {
        this.scenario = scenario;
    }

    /**
     * 現在の設定を取得
     *
     * @returns 現在の言語とシナリオ
     */
    getSettings(): { language: string; scenario: ScenarioPreset } {
        return {
            language: this.language,
            scenario: this.scenario
        };
    }

    /**
     * 履歴情報を取得
     *
     * @returns 履歴データのコピー
     */
    getHistory(): Readonly<VADHistoryData> {
        return {
            durations: [...this.history.durations],
            silences: [...this.history.silences],
            maxHistory: this.history.maxHistory
        };
    }

    /**
     * 履歴をリセット
     */
    resetHistory(): void {
        this.history.durations = [];
        this.history.silences = [];
    }

    /**
     * 平均値を計算
     *
     * @param arr 数値配列
     * @returns 平均値
     */
    private average(arr: number[]): number {
        if (arr.length === 0) {
            return 0;
        }
        const sum = arr.reduce((acc, val) => acc + val, 0);
        return sum / arr.length;
    }

    /**
     * 値を範囲内に制限
     *
     * @param value 値
     * @param min 最小値
     * @param max 最大値
     * @returns 制限された値
     */
    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}
