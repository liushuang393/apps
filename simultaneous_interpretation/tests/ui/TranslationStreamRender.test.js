/**
 * 翻訳専用セッション（/v1/realtime/translations）のストリーム描画テスト。
 *
 * 公式仕様: このエンドポイントは conversation.item.* / response.* を発行せず、
 * 字幕は session.input_transcript.delta / session.output_transcript.delta の
 * 連続ストリーム（左右対応キー無し）で届く。終了は session.close → session.closed。
 *
 * 対象:
 *   - dispatchWSMessage の session.* 配線（P0: 実際の受信経路で左右が描画されること）
 *   - commitTranslationCaption / commitTranslationPair（入力確定を境界とする行対確定）
 *   - closeTranslationSessionGracefully（session.close ハンドシェイク）
 *   - sendMessage の失敗可視化（黙殺の禁止）
 *   - 翻訳セッションでの Path1 / セグメント enqueue の停止
 *
 * 実コード（root の voicetranslate-*.js）を vm で同一コンテキストに読み込む。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { SegmentAlignmentManager } = require('../../voicetranslate-segment-alignment.js');
const { TextPathProcessor } = require('../../voicetranslate-path-processors.js');

function loadMixins(document) {
    const root = path.join(__dirname, '../..');
    const uiSource = fs.readFileSync(path.join(root, 'voicetranslate-ui-mixin.js'), 'utf8');
    const wsSource = fs.readFileSync(path.join(root, 'voicetranslate-websocket-mixin.js'), 'utf8');

    const sandbox = {
        console,
        Date,
        document,
        setTimeout,
        clearTimeout,
        Float32Array,
        CONFIG: {
            AUDIO: { SAMPLE_RATE: 24000 },
            API: {
                REALTIME_URL: 'wss://api.openai.com/v1/realtime/translations',
                REALTIME_MODEL: 'gpt-realtime-translate'
            }
        },
        Utils: {},
        WebSocket: { OPEN: 1 },
        module: { exports: {} }
    };

    vm.runInNewContext(
        `${uiSource}\n${wsSource}\nmodule.exports = { UIMixin, WebSocketMixin };`,
        sandbox
    );
    return sandbox.module.exports;
}

/**
 * 翻訳セッション相当の最小アプリスタブを生成する（実 SegmentAlignmentManager 付き）。
 *
 * @returns {{app: object, inputContainer: Element, outputContainer: Element}}
 */
function createTranslationApp() {
    document.body.innerHTML = '';
    const inputContainer = document.createElement('div');
    const outputContainer = document.createElement('div');
    document.body.appendChild(inputContainer);
    document.body.appendChild(outputContainer);

    const app = {
        elements: {
            inputTranscript: inputContainer,
            outputTranscript: outputContainer
        },
        state: { charCount: 0, sourceLang: 'zh', currentSessionId: null },
        platform: {},
        updateLatencyDisplay() {},
        usesWebRtcTransport() {
            return false;
        }
    };

    const { UIMixin, WebSocketMixin } = loadMixins(document);
    Object.assign(app, UIMixin, WebSocketMixin);
    // ✅ mixin メソッドのスタブは Object.assign の「後」に設定する（前だと実装で上書きされる）。
    app.segmentAlignment = new SegmentAlignmentManager();
    app.refineCalls = [];
    app.translateSegmentViaChat = (id, text, lang) => {
        app.refineCalls.push({ id, text, lang });
    };
    return { app, inputContainer, outputContainer };
}

function rows(container) {
    return Array.from(container.querySelectorAll('.transcript-message'));
}

function committedRows(container) {
    return rows(container).filter((el) => el.dataset.live !== '1');
}

function textOf(el) {
    return el.querySelector('.transcript-text').textContent;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('翻訳セッションのストリーム描画（P0: dispatchWSMessage 経由）', () => {
    it('input/output デルタが受信経路そのままで左右にライブ描画される', () => {
        const { app, inputContainer, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'こんにち' });
        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'は' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '你好' });

        const left = rows(inputContainer);
        const right = rows(outputContainer);
        expect(left).toHaveLength(1);
        expect(left[0].dataset.live).toBe('1');
        expect(textOf(left[0])).toBe('こんにちは');
        expect(right).toHaveLength(1);
        expect(textOf(right[0])).toBe('你好');
    });

    it('入力確定(.done)で左右が同じ行対（segmentId）として確定し、右は訳文プレビューを吸収する', async () => {
        const { app, inputContainer, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'こんにちは' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '你好' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });

        // ライブ行は消え、segmentId 付きの確定行対になる。
        const left = committedRows(inputContainer);
        const right = committedRows(outputContainer);
        expect(left).toHaveLength(1);
        expect(right).toHaveLength(1);
        expect(textOf(left[0])).toBe('こんにちは');
        expect(textOf(right[0])).toBe('你好');
        expect(left[0].dataset.segmentId).toBeTruthy();
        expect(left[0].dataset.segmentId).toBe(right[0].dataset.segmentId); // 左右1:1

        // 路径3(补精度): 同じ segment に対し Chat 翻訳がデバウンス後に1回だけ起動する。
        await sleep(650);
        expect(app.refineCalls).toHaveLength(1);
        expect(app.refineCalls[0].id).toBe(left[0].dataset.segmentId);
        expect(app.refineCalls[0].text).toBe('こんにちは');
    });

    it('入力確定後に遅れて届く訳文の尻尾は同じ行対の右セルへ追記され、孤児行を作らない', () => {
        const { app, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'こんにちは' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '你' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        // 行対確定後、翻訳のドレイン分（尻尾）が届く。
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '好' });

        const right = rows(outputContainer);
        expect(right).toHaveLength(1); // 新規行を作らない
        expect(textOf(right[0])).toBe('你好');
    });

    it('output の .done は入力未確定の間は確定を保留する（境界は入力確定に一本化）', () => {
        const { app, inputContainer, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'こんにちは' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '你好' });
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });

        // まだ確定しない（ライブ行のまま保持）。
        expect(committedRows(outputContainer)).toHaveLength(0);

        app.dispatchWSMessage({ type: 'session.input_transcript.done' });

        // 入力確定と同時に同じ行対へ吸収される。
        const left = committedRows(inputContainer);
        const right = committedRows(outputContainer);
        expect(left).toHaveLength(1);
        expect(right).toHaveLength(1);
        expect(textOf(right[0])).toBe('你好');
        expect(left[0].dataset.segmentId).toBe(right[0].dataset.segmentId);
    });

    it('入力転写が無い場合でも訳文は .done で単独確定する（不漏フォールバック）', () => {
        const { app, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '你好世界' });
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });

        const right = committedRows(outputContainer);
        expect(right).toHaveLength(1);
        expect(textOf(right[0])).toBe('你好世界');
    });

    it('session.closed で未確定バッファを取りこぼさず行対として確定する', () => {
        const { app, inputContainer, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: '最後の文' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '最后一句' });
        app.dispatchWSMessage({ type: 'session.closed' });

        const left = committedRows(inputContainer);
        const right = committedRows(outputContainer);
        expect(left).toHaveLength(1);
        expect(right).toHaveLength(1);
        expect(textOf(left[0])).toBe('最後の文');
        expect(textOf(right[0])).toBe('最后一句');
    });

    it('連続2ターンが順序どおり2つの行対になる', () => {
        const { app, inputContainer, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'A原文' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'A訳' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'B原文' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'B訳' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });

        const left = committedRows(inputContainer).map(textOf);
        const right = committedRows(outputContainer).map(textOf);
        // 新しい行対が上（seq 降順挿入）。
        expect(left).toEqual(['B原文', 'A原文']);
        expect(right).toEqual(['B訳', 'A訳']);
    });
});

describe('翻訳セッションの graceful close（P1: session.close ハンドシェイク）', () => {
    it('session.close を送信し、session.closed 受信で切断待ちが解決する', async () => {
        const { app } = createTranslationApp();
        const sent = [];
        app.platform = {
            isElectron: true,
            sendRealtime: async (m) => {
                sent.push(m);
                return { success: true };
            }
        };

        const closing = app.closeTranslationSessionGracefully();
        // sendMessage(await) 完了後に waiter が張られるので、次タスクで closed を配送する。
        await sleep(20);
        expect(sent).toHaveLength(1);
        expect(sent[0].type).toBe('session.close');

        const start = Date.now();
        app.dispatchWSMessage({ type: 'session.closed' });
        await closing;
        expect(Date.now() - start).toBeLessThan(1000); // タイムアウト(2s)を待たず解決
    });

    it('session.closed が届かなくてもタイムアウトで解決し切断を進める', async () => {
        const { app } = createTranslationApp();
        app.platform = {
            isElectron: true,
            sendRealtime: async () => ({ success: true })
        };

        const start = Date.now();
        await app.closeTranslationSessionGracefully();
        expect(Date.now() - start).toBeGreaterThanOrEqual(1900);
    }, 5000);

    it('session.close の送信に失敗しても待たずに戻る（既断時の誤報・待ち惚け防止）', async () => {
        const { app } = createTranslationApp();
        const notifications = [];
        app.platform = {
            isElectron: true,
            sendRealtime: async () => ({ success: false, message: 'closed' })
        };
        app.notify = (...args) => notifications.push(args);

        const start = Date.now();
        await app.closeTranslationSessionGracefully();
        expect(Date.now() - start).toBeLessThan(500);
        expect(notifications).toHaveLength(0); // silentFailure
    });
});

describe('sendMessage の失敗可視化（P1: 黙殺の禁止）', () => {
    it('Electron IPC 失敗時は false を返し、通知は間引いて1回だけ出す', async () => {
        const { WebSocketMixin } = loadMixins(document);
        const notifications = [];
        const app = {
            state: {},
            platform: {
                isElectron: true,
                sendRealtime: async () => ({ success: false, message: 'IPC断' })
            }
        };
        Object.assign(app, WebSocketMixin);
        app.notify = (title, msg, level) => notifications.push({ title, msg, level });

        expect(await app.sendMessage({ type: 'a' })).toBe(false);
        expect(await app.sendMessage({ type: 'b' })).toBe(false);

        expect(notifications).toHaveLength(1); // 30秒間引き
        expect(notifications[0].level).toBe('error');
        expect(notifications[0].msg).toContain('IPC断');
    });

    it('Electron IPC 成功時は true を返し通知しない', async () => {
        const { WebSocketMixin } = loadMixins(document);
        const notifications = [];
        const app = {
            state: {},
            platform: { isElectron: true, sendRealtime: async () => ({ success: true }) }
        };
        Object.assign(app, WebSocketMixin);
        app.notify = (...args) => notifications.push(args);

        expect(await app.sendMessage({ type: 'a' })).toBe(true);
        expect(notifications).toHaveLength(0);
    });

    it('ブラウザで WebSocket 未接続なら false を返し通知する', async () => {
        const { WebSocketMixin } = loadMixins(document);
        const notifications = [];
        const app = {
            state: { ws: null },
            platform: {}
        };
        Object.assign(app, WebSocketMixin);
        app.usesWebRtcTransport = () => false;
        app.notify = (title, msg, level) => notifications.push({ title, msg, level });

        expect(await app.sendMessage({ type: 'a' })).toBe(false);
        expect(notifications).toHaveLength(1);
    });
});

describe('翻訳セッションでの不要経路の停止', () => {
    it('Path1(TextPathProcessor) は音声再送せず完了マークのみで抜ける', async () => {
        const marks = [];
        const audioQueue = {
            markPathComplete: (id, pathName, meta) => marks.push({ id, pathName, meta })
        };
        const appStub = { isRealtimeTranslationSession: () => true };
        const processor = new TextPathProcessor(audioQueue, appStub);

        await processor.process({ id: 'seg1', audioData: new Float32Array(4800) });

        expect(marks).toEqual([
            { id: 'seg1', pathName: 'path1', meta: { skipped: 'translation-session' } }
        ]);
    });

    it('tryEnqueueAudioSegment は enqueue せず placeholder 行を作らない', () => {
        const { app, inputContainer, outputContainer } = createTranslationApp();

        const result = app.tryEnqueueAudioSegment(new Float32Array(4800), 200, 24000, Date.now());

        expect(result).toBe(false);
        expect(rows(inputContainer)).toHaveLength(0);
        expect(rows(outputContainer)).toHaveLength(0);
    });
});
