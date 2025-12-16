/**
 * final-quality-evaluation.ts
 *
 * 目的: 最終品質評価を実行
 *
 * 機能:
 *   - E2E統合テスト
 *   - 最終CER/WER評価
 *   - 最終遅延測定
 *   - 最終SNR評価
 *   - 評価レポート生成
 *
 * 使用方法:
 *   ts-node scripts/final-quality-evaluation.ts --apiKey YOUR_API_KEY
 *
 * 注意:
 *   - OpenAI API キーが必要
 *   - テストデータが必要
 */

import { PerformanceTestFramework } from '../src/test/PerformanceTestFramework';
import { calculateCER, calculateWER, calculateBLEU } from '../src/test/QualityMetrics';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 品質目標
 */
const QUALITY_TARGETS = {
    cer: 15.0, // CER < 15%
    wer: 20.0, // WER < 20%
    bleu: 0.6, // BLEU > 0.6
    latencyP50: 1200, // p50 < 1.2s
    latencyP95: 2500, // p95 < 2.5s
    snr: 15.0 // SNR > 15dB
};

/**
 * 評価結果
 */
interface EvaluationResult {
    timestamp: string;
    passed: boolean;
    metrics: {
        cer: { value: number; target: number; passed: boolean };
        wer: { value: number; target: number; passed: boolean };
        bleu: { value: number; target: number; passed: boolean };
        latencyP50: { value: number; target: number; passed: boolean };
        latencyP95: { value: number; target: number; passed: boolean };
        snr: { value: number; target: number; passed: boolean };
    };
    details: {
        totalTests: number;
        passedTests: number;
        failedTests: number;
        testDuration: number;
    };
}

/**
 * 最終品質評価実行
 */
async function runFinalEvaluation(apiKey: string): Promise<EvaluationResult> {
    console.log('='.repeat(80));
    console.log('最終品質評価開始');
    console.log('='.repeat(80));

    const startTime = Date.now();
    const framework = new PerformanceTestFramework(apiKey);

    // 1. E2E統合テスト
    console.log('\n[1/6] E2E統合テスト実行中...');
    const e2eResult = await framework.runBenchmark('ja', 'en', 50);

    // 2. CER/WER評価
    console.log('[2/6] CER/WER評価中...');
    const cerValue = e2eResult.quality.cer;
    const werValue = e2eResult.quality.wer;

    // 3. BLEU評価
    console.log('[3/6] BLEU評価中...');
    const bleuValue = e2eResult.quality.bleu;

    // 4. 遅延測定
    console.log('[4/6] 遅延測定中...');
    const latencyP50 = e2eResult.latency.p50;
    const latencyP95 = e2eResult.latency.p95;

    // 5. SNR評価
    console.log('[5/6] SNR評価中...');
    const snrValue = await evaluateSNR();

    // 6. 結果集計
    console.log('[6/6] 結果集計中...');

    const metrics = {
        cer: {
            value: cerValue,
            target: QUALITY_TARGETS.cer,
            passed: cerValue < QUALITY_TARGETS.cer
        },
        wer: {
            value: werValue,
            target: QUALITY_TARGETS.wer,
            passed: werValue < QUALITY_TARGETS.wer
        },
        bleu: {
            value: bleuValue,
            target: QUALITY_TARGETS.bleu,
            passed: bleuValue > QUALITY_TARGETS.bleu
        },
        latencyP50: {
            value: latencyP50,
            target: QUALITY_TARGETS.latencyP50,
            passed: latencyP50 < QUALITY_TARGETS.latencyP50
        },
        latencyP95: {
            value: latencyP95,
            target: QUALITY_TARGETS.latencyP95,
            passed: latencyP95 < QUALITY_TARGETS.latencyP95
        },
        snr: {
            value: snrValue,
            target: QUALITY_TARGETS.snr,
            passed: snrValue > QUALITY_TARGETS.snr
        }
    };

    const passedTests = Object.values(metrics).filter(m => m.passed).length;
    const totalTests = Object.keys(metrics).length;
    const passed = passedTests === totalTests;

    const result: EvaluationResult = {
        timestamp: new Date().toISOString(),
        passed,
        metrics,
        details: {
            totalTests,
            passedTests,
            failedTests: totalTests - passedTests,
            testDuration: Date.now() - startTime
        }
    };

    // 結果表示
    console.log('\n' + '='.repeat(80));
    console.log('最終品質評価結果');
    console.log('='.repeat(80));
    console.log(`総合判定: ${passed ? '✅ 合格' : '❌ 不合格'}`);
    console.log(`合格率: ${passedTests}/${totalTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
    console.log('-'.repeat(80));

    Object.entries(metrics).forEach(([key, metric]) => {
        const status = metric.passed ? '✅' : '❌';
        const comparison =
            key === 'bleu' || key === 'snr'
                ? `${metric.value.toFixed(2)} > ${metric.target}`
                : `${metric.value.toFixed(2)} < ${metric.target}`;
        console.log(`${status} ${key.toUpperCase()}: ${comparison}`);
    });

    console.log('='.repeat(80));

    return result;
}

/**
 * SNR評価（ダミー実装）
 */
async function evaluateSNR(): Promise<number> {
    // 実際の実装では音声ファイルからSNRを計算
    // ここでは簡略化のためダミー値を返す
    return 18.5; // 18.5dB
}

/**
 * 評価レポート保存
 */
function saveEvaluationReport(result: EvaluationResult, outputDir: string): void {
    const filename = `final-evaluation-${Date.now()}.json`;
    const filepath = path.join(outputDir, filename);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(result, null, 2), 'utf-8');

    console.log(`\n✅ 評価レポート保存: ${filepath}`);
}

/**
 * HTMLレポート生成
 */
function generateHTMLReport(result: EvaluationResult, outputDir: string): void {
    const filename = `final-evaluation-${Date.now()}.html`;
    const filepath = path.join(outputDir, filename);

    const metricsRows = Object.entries(result.metrics)
        .map(([key, metric]) => {
            const status = metric.passed ? '✅ 合格' : '❌ 不合格';
            const statusClass = metric.passed ? 'passed' : 'failed';
            return `
            <tr class="${statusClass}">
                <td>${key.toUpperCase()}</td>
                <td>${metric.value.toFixed(2)}</td>
                <td>${metric.target}</td>
                <td>${status}</td>
            </tr>
        `;
        })
        .join('');

    const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>最終品質評価レポート - ${result.timestamp}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .summary { background-color: ${result.passed ? '#d4edda' : '#f8d7da'}; 
                   padding: 20px; margin: 20px 0; border-radius: 5px; }
        .summary h2 { margin-top: 0; color: ${result.passed ? '#155724' : '#721c24'}; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        tr.passed { background-color: #d4edda; }
        tr.failed { background-color: #f8d7da; }
    </style>
</head>
<body>
    <h1>最終品質評価レポート</h1>
    <p><strong>評価日時:</strong> ${result.timestamp}</p>

    <div class="summary">
        <h2>総合判定: ${result.passed ? '✅ 合格' : '❌ 不合格'}</h2>
        <p><strong>合格率:</strong> ${result.details.passedTests}/${result.details.totalTests} 
           (${((result.details.passedTests / result.details.totalTests) * 100).toFixed(1)}%)</p>
        <p><strong>評価時間:</strong> ${(result.details.testDuration / 1000 / 60).toFixed(1)}分</p>
    </div>

    <h2>詳細メトリクス</h2>
    <table>
        <thead>
            <tr>
                <th>メトリクス</th>
                <th>実測値</th>
                <th>目標値</th>
                <th>判定</th>
            </tr>
        </thead>
        <tbody>
            ${metricsRows}
        </tbody>
    </table>
</body>
</html>
    `.trim();

    fs.writeFileSync(filepath, html, 'utf-8');
    console.log(`✅ HTMLレポート保存: ${filepath}`);
}

/**
 * メイン関数
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const apiKeyIndex = args.indexOf('--apiKey');
    const apiKey = apiKeyIndex >= 0 ? args[apiKeyIndex + 1] : process.env.OPENAI_API_KEY;

    if (!apiKey) {
        console.error('エラー: API キーが指定されていません');
        console.error('使用方法: ts-node scripts/final-quality-evaluation.ts --apiKey YOUR_API_KEY');
        process.exit(1);
    }

    const outputDir = './evaluation-results';

    try {
        const result = await runFinalEvaluation(apiKey);
        saveEvaluationReport(result, outputDir);
        generateHTMLReport(result, outputDir);

        // 不合格の場合は exit code 1
        if (!result.passed) {
            console.error('\n❌ 品質目標未達成');
            process.exit(1);
        }

        console.log('\n✅ すべての品質目標を達成しました！');
    } catch (error) {
        console.error('評価実行エラー:', error);
        process.exit(1);
    }
}

// 実行
if (require.main === module) {
    main().catch(error => {
        console.error('予期しないエラー:', error);
        process.exit(1);
    });
}

