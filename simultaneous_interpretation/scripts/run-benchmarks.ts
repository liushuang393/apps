/**
 * run-benchmarks.ts
 *
 * 目的: パフォーマンスベンチマークを実行
 *
 * 機能:
 *   - 100サンプル × 5言語のベンチマーク
 *   - 遅延分析 (p50, p90, p95, p99)
 *   - スループット測定
 *   - メモリプロファイリング
 *   - 結果のJSON/HTML出力
 *
 * 使用方法:
 *   ts-node scripts/run-benchmarks.ts --apiKey YOUR_API_KEY
 *
 * 注意:
 *   - OpenAI API キーが必要
 *   - 実行には約30-60分かかる
 */

import { PerformanceTestFramework } from '../src/test/PerformanceTestFramework';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ベンチマーク設定
 */
interface BenchmarkConfig {
    apiKey: string;
    sampleCount: number;
    languagePairs: Array<{ source: string; target: string }>;
    outputDir: string;
}

/**
 * ベンチマーク結果
 */
interface BenchmarkResults {
    timestamp: string;
    config: BenchmarkConfig;
    results: Array<{
        sourceLang: string;
        targetLang: string;
        latency: {
            p50: number;
            p90: number;
            p95: number;
            p99: number;
        };
        throughput: number;
        memory: {
            initial: number;
            peak: number;
            final: number;
            leaked: number;
        };
        quality: {
            cer: number;
            wer: number;
            bleu: number;
        };
    }>;
    summary: {
        totalTests: number;
        totalTime: number;
        averageLatencyP50: number;
        averageThroughput: number;
        averageCER: number;
        averageWER: number;
        averageBLEU: number;
    };
}

/**
 * ベンチマーク実行
 */
async function runBenchmarks(config: BenchmarkConfig): Promise<BenchmarkResults> {
    console.log('='.repeat(80));
    console.log('パフォーマンスベンチマーク開始');
    console.log('='.repeat(80));
    console.log(`サンプル数: ${config.sampleCount}`);
    console.log(`言語ペア数: ${config.languagePairs.length}`);
    console.log(`合計テスト数: ${config.sampleCount * config.languagePairs.length}`);
    console.log('='.repeat(80));

    const framework = new PerformanceTestFramework(config.apiKey);
    const results: BenchmarkResults['results'] = [];
    const startTime = Date.now();

    for (let i = 0; i < config.languagePairs.length; i++) {
        const pair = config.languagePairs[i];
        if (!pair) {
            continue;
        }

        console.log(`\n[${i + 1}/${config.languagePairs.length}] ${pair.source} → ${pair.target}`);
        console.log('-'.repeat(80));

        try {
            const result = await framework.runBenchmark(pair.source, pair.target, config.sampleCount);

            results.push({
                sourceLang: pair.source,
                targetLang: pair.target,
                latency: result.latency,
                throughput: result.throughput,
                memory: result.memory,
                quality: result.quality
            });

            console.log(`✅ 完了`);
            console.log(`  遅延 p50: ${result.latency.p50.toFixed(0)}ms`);
            console.log(`  遅延 p95: ${result.latency.p95.toFixed(0)}ms`);
            console.log(`  スループット: ${result.throughput.toFixed(2)} req/s`);
            console.log(`  CER: ${result.quality.cer.toFixed(1)}%`);
            console.log(`  WER: ${result.quality.wer.toFixed(1)}%`);
            console.log(`  BLEU: ${result.quality.bleu.toFixed(3)}`);
        } catch (error) {
            console.error(`❌ エラー: ${error}`);
        }
    }

    const totalTime = Date.now() - startTime;

    // サマリー計算
    const summary = {
        totalTests: results.length,
        totalTime,
        averageLatencyP50: results.reduce((sum, r) => sum + r.latency.p50, 0) / results.length,
        averageThroughput: results.reduce((sum, r) => sum + r.throughput, 0) / results.length,
        averageCER: results.reduce((sum, r) => sum + r.quality.cer, 0) / results.length,
        averageWER: results.reduce((sum, r) => sum + r.quality.wer, 0) / results.length,
        averageBLEU: results.reduce((sum, r) => sum + r.quality.bleu, 0) / results.length
    };

    console.log('\n' + '='.repeat(80));
    console.log('ベンチマーク完了');
    console.log('='.repeat(80));
    console.log(`合計時間: ${(totalTime / 1000 / 60).toFixed(1)}分`);
    console.log(`平均遅延 p50: ${summary.averageLatencyP50.toFixed(0)}ms`);
    console.log(`平均スループット: ${summary.averageThroughput.toFixed(2)} req/s`);
    console.log(`平均 CER: ${summary.averageCER.toFixed(1)}%`);
    console.log(`平均 WER: ${summary.averageWER.toFixed(1)}%`);
    console.log(`平均 BLEU: ${summary.averageBLEU.toFixed(3)}`);
    console.log('='.repeat(80));

    return {
        timestamp: new Date().toISOString(),
        config,
        results,
        summary
    };
}

/**
 * 結果をJSON出力
 */
function saveResultsJSON(results: BenchmarkResults, outputDir: string): void {
    const filename = `benchmark-${Date.now()}.json`;
    const filepath = path.join(outputDir, filename);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(results, null, 2), 'utf-8');

    console.log(`\n✅ JSON出力: ${filepath}`);
}

/**
 * 結果をHTML出力
 */
function saveResultsHTML(results: BenchmarkResults, outputDir: string): void {
    const filename = `benchmark-${Date.now()}.html`;
    const filepath = path.join(outputDir, filename);

    const html = generateHTML(results);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(filepath, html, 'utf-8');

    console.log(`✅ HTML出力: ${filepath}`);
}

/**
 * HTMLレポート生成
 */
function generateHTML(results: BenchmarkResults): string {
    const rows = results.results
        .map(
            r => `
        <tr>
            <td>${r.sourceLang} → ${r.targetLang}</td>
            <td>${r.latency.p50.toFixed(0)}ms</td>
            <td>${r.latency.p90.toFixed(0)}ms</td>
            <td>${r.latency.p95.toFixed(0)}ms</td>
            <td>${r.latency.p99.toFixed(0)}ms</td>
            <td>${r.throughput.toFixed(2)}</td>
            <td>${r.quality.cer.toFixed(1)}%</td>
            <td>${r.quality.wer.toFixed(1)}%</td>
            <td>${r.quality.bleu.toFixed(3)}</td>
        </tr>
    `
        )
        .join('');

    return `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ベンチマーク結果 - ${results.timestamp}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .summary { background-color: #e7f3fe; padding: 15px; margin-top: 20px; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>パフォーマンスベンチマーク結果</h1>
    <p><strong>実行日時:</strong> ${results.timestamp}</p>
    <p><strong>サンプル数:</strong> ${results.config.sampleCount}</p>
    <p><strong>言語ペア数:</strong> ${results.config.languagePairs.length}</p>

    <h2>詳細結果</h2>
    <table>
        <thead>
            <tr>
                <th>言語ペア</th>
                <th>遅延 p50</th>
                <th>遅延 p90</th>
                <th>遅延 p95</th>
                <th>遅延 p99</th>
                <th>スループット (req/s)</th>
                <th>CER</th>
                <th>WER</th>
                <th>BLEU</th>
            </tr>
        </thead>
        <tbody>
            ${rows}
        </tbody>
    </table>

    <div class="summary">
        <h2>サマリー</h2>
        <p><strong>合計テスト数:</strong> ${results.summary.totalTests}</p>
        <p><strong>合計時間:</strong> ${(results.summary.totalTime / 1000 / 60).toFixed(1)}分</p>
        <p><strong>平均遅延 p50:</strong> ${results.summary.averageLatencyP50.toFixed(0)}ms</p>
        <p><strong>平均スループット:</strong> ${results.summary.averageThroughput.toFixed(2)} req/s</p>
        <p><strong>平均 CER:</strong> ${results.summary.averageCER.toFixed(1)}%</p>
        <p><strong>平均 WER:</strong> ${results.summary.averageWER.toFixed(1)}%</p>
        <p><strong>平均 BLEU:</strong> ${results.summary.averageBLEU.toFixed(3)}</p>
    </div>
</body>
</html>
    `.trim();
}

/**
 * メイン関数
 */
async function main(): Promise<void> {
    // コマンドライン引数解析
    const args = process.argv.slice(2);
    const apiKeyIndex = args.indexOf('--apiKey');
    const apiKey = apiKeyIndex >= 0 ? args[apiKeyIndex + 1] : process.env.OPENAI_API_KEY;

    if (!apiKey) {
        console.error('エラー: API キーが指定されていません');
        console.error('使用方法: ts-node scripts/run-benchmarks.ts --apiKey YOUR_API_KEY');
        process.exit(1);
    }

    const config: BenchmarkConfig = {
        apiKey,
        sampleCount: 100,
        languagePairs: [
            { source: 'ja', target: 'en' },
            { source: 'en', target: 'ja' },
            { source: 'ja', target: 'zh' },
            { source: 'zh', target: 'ja' },
            { source: 'ja', target: 'vi' }
        ],
        outputDir: './benchmark-results'
    };

    try {
        const results = await runBenchmarks(config);
        saveResultsJSON(results, config.outputDir);
        saveResultsHTML(results, config.outputDir);
    } catch (error) {
        console.error('ベンチマーク実行エラー:', error);
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

