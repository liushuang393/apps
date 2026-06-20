/**
 * GA Realtime API イベント名 実測プローブ
 *
 * 目的:
 *   設定中のモデル（CONFIG/.env の OPENAI_REALTIME_MODEL）に実接続し、
 *   サーバーが返す「全イベント名」と output_modalities / server_vad 自動応答の
 *   実挙動をそのまま標準出力に表示する。推測を排し、拡張機能の
 *   voicetranslate-path-processors.js が待つイベント名が正しいかを確定する。
 *
 * 使い方（あなたのOpenAI実キーで実行）:
 *   PowerShell:  $env:OPENAI_API_KEY="sk-..."; node scripts/probe-realtime-ga.js
 *   またはClaude Code内:  ! OPENAI_API_KEY=sk-... node scripts/probe-realtime-ga.js
 *
 * 注意: 実APIに接続するため少額の課金が発生します（テキスト1往復のみ）。
 */

const WebSocket = require('ws');

const API_KEY =
    process.env.OPENAI_REALTIME_API_KEY ||
    process.env.VOICETRANSLATE_API_KEY ||
    process.env.OPENAI_API_KEY;

const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2025-08-28';
const URL_BASE = process.env.OPENAI_REALTIME_URL || 'wss://api.openai.com/v1/realtime';

if (!API_KEY || API_KEY.length < 30 || API_KEY.startsWith('your-')) {
    console.error('❌ 実キーが未設定です。OPENAI_API_KEY に sk-... を設定して実行してください。');
    console.error('   例: ! OPENAI_API_KEY=sk-xxxx node scripts/probe-realtime-ga.js');
    process.exit(1);
}

const url = `${URL_BASE}?model=${MODEL}`;
console.log(`▶ 接続: ${url}`);
console.log(`▶ モデル: ${MODEL}`);

const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${API_KEY}` }
});

// 受信した全イベント種別を集計
const seenTypes = new Set();
let sawAudioDelta = false; // GA: response.output_audio.delta
let sawLegacyAudioDelta = false; // 旧: response.audio.delta
let sawTranscriptDelta = false; // GA: response.output_audio_transcript.delta
let sawLegacyTranscriptDelta = false; // 旧: response.audio_transcript.delta
let sawError = false;
const loggedDelta = new Set();

const finish = () => {
    console.log('\n================ 実測結果サマリ ================');
    console.log('受信した全イベント種別:');
    [...seenTypes]
        .filter((t) => !t.startsWith('__logged_'))
        .sort()
        .forEach((t) => console.log('   - ' + t));
    console.log('\n判定:');
    console.log(
        `   音声delta  GA(response.output_audio.delta)            : ${sawAudioDelta ? '✅ 来た' : '— 来ず'}`
    );
    console.log(
        `   音声delta  旧(response.audio.delta)                   : ${sawLegacyAudioDelta ? '⚠️ 来た' : '— 来ず'}`
    );
    console.log(
        `   字幕delta  GA(response.output_audio_transcript.delta) : ${sawTranscriptDelta ? '✅ 来た' : '— 来ず'}`
    );
    console.log(
        `   字幕delta  旧(response.audio_transcript.delta)        : ${sawLegacyTranscriptDelta ? '⚠️ 来た' : '— 来ず'}`
    );
    console.log(
        `   エラー                                               : ${sawError ? '❌ あり' : 'なし'}`
    );
    console.log('\n結論:');
    if (sawAudioDelta && sawTranscriptDelta) {
        console.log('   → GAイベント名が正しい。拡張の修正(GA名 / output_modalities)は妥当。');
    } else if (sawLegacyAudioDelta || sawLegacyTranscriptDelta) {
        console.log('   → サーバーは旧イベント名を返している。拡張は旧名に戻す必要あり。');
    } else {
        console.log(
            '   → 音声イベントが来ていない。output_modalities/モデル/権限を要確認（上のエラー参照）。'
        );
    }
    console.log('===============================================');
    try {
        ws.close();
    } catch (_) {}
    process.exit(0);
};

ws.on('open', () => {
    console.log('✅ 接続成功。session.update を送信します。');
    ws.send(
        JSON.stringify({
            type: 'session.update',
            session: {
                type: 'realtime',
                output_modalities: ['audio'], // GA: 'audio' で音声＋字幕
                instructions:
                    'You are a translator. Translate the user message from English to Japanese. Output Japanese only.',
                audio: {
                    output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'alloy' }
                }
            }
        })
    );

    // テキスト入力アイテムを作成（音声なしで応答生成を試す）
    ws.send(
        JSON.stringify({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: 'Hello, how are you today?' }]
            }
        })
    );

    // 応答生成を要求（GA: output_modalities）
    ws.send(
        JSON.stringify({
            type: 'response.create',
            response: { output_modalities: ['audio'] }
        })
    );
    console.log('✅ response.create 送信。イベント受信待ち...\n');
});

ws.on('message', (data) => {
    let msg;
    try {
        msg = JSON.parse(data.toString());
    } catch (_) {
        return;
    }
    const t = msg.type || '(no type)';
    seenTypes.add(t);

    if (t === 'response.output_audio.delta') sawAudioDelta = true;
    if (t === 'response.audio.delta') sawLegacyAudioDelta = true;
    if (t === 'response.output_audio_transcript.delta') sawTranscriptDelta = true;
    if (t === 'response.audio_transcript.delta') sawLegacyTranscriptDelta = true;

    // deltaは大量に来るので種別ごとに1回のみ表示
    if (t.endsWith('.delta')) {
        if (!loggedDelta.has(t)) {
            loggedDelta.add(t);
            console.log(`[delta] ${t} (以降同種は省略)`);
        }
    } else if (t === 'error') {
        sawError = true;
        console.log('❌ [error]', JSON.stringify(msg.error || msg, null, 2));
    } else {
        console.log(`[event] ${t}`);
        if (t === 'response.done') {
            const status = msg.response && msg.response.status;
            console.log('   response.status =', status);
            if (msg.response && msg.response.status_details) {
                console.log('   status_details =', JSON.stringify(msg.response.status_details));
            }
            setTimeout(finish, 300);
        }
    }
});

ws.on('error', (err) => {
    console.error('❌ WebSocketエラー:', err.message);
});

ws.on('close', (code, reason) => {
    console.log(`接続終了 code=${code} reason=${reason ? reason.toString() : ''}`);
    if (!seenTypes.size) process.exit(1);
});

// 安全弁: 20秒で強制終了
setTimeout(() => {
    console.log('\n⏱ タイムアウト（20s）。受信済みイベントで判定します。');
    finish();
}, 20000);
