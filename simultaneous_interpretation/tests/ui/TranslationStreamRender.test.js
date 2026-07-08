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
const { buildTransportDescriptor } = require('../../voicetranslate-transport-config.js');

function loadMixins(document) {
    const root = path.join(__dirname, '../..');
    const uiSource = fs.readFileSync(path.join(root, 'voicetranslate-ui-mixin.js'), 'utf8');
    const wsSource = fs.readFileSync(path.join(root, 'voicetranslate-websocket-mixin.js'), 'utf8');
    // sendMessage が参照するトランスポート決定表（TRANSPORT_KINDS）も同一コンテキストへ読み込む
    const tcSource = fs.readFileSync(path.join(root, 'voicetranslate-transport-config.js'), 'utf8');

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
        `${tcSource}\n${uiSource}\n${wsSource}\nmodule.exports = { UIMixin, WebSocketMixin };`,
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
        },
        // 既定は翻訳ブラウザ経路（WebRTC）。graceful/sendMessage 系テストは各自 transport を差し替える。
        transport: buildTransportDescriptor({ isElectron: false, isTranslationSession: true })
    };

    const { UIMixin, WebSocketMixin } = loadMixins(document);
    Object.assign(app, UIMixin, WebSocketMixin);
    // ✅ mixin メソッドのスタブは Object.assign の「後」に設定する（前だと実装で上書きされる）。
    app.segmentAlignment = new SegmentAlignmentManager();
    app.refineCalls = [];
    // 実装（失敗ハンドリング）を直接検証するテスト用に退避してからスタブする。
    app.realTranslateSegmentViaChat = app.translateSegmentViaChat;
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

    it('TTS抑止(_ttsSuppressedByLoopback)中でも左右のストリーム描画と路径3(Chat T2T)は通常どおり動く', async () => {
        // 音声出力の抑止/ミュートは applyAudioOutputMode（voicetranslate-pro.js）側の関心事であり、
        // ui-mixin/websocket-mixin のテキストパイプラインはこのフラグを一切参照しない設計。
        // 抑止時でも右カラムが左カラムの認識文からT2T翻訳される不変条件をロックする。
        const { app, inputContainer, outputContainer } = createTranslationApp();
        app._ttsSuppressedByLoopback = true;
        app.state.audioOutputMode = 'off';

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'こんにちは' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '你好' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });

        const left = committedRows(inputContainer);
        const right = committedRows(outputContainer);
        expect(textOf(left[0])).toBe('こんにちは');
        expect(textOf(right[0])).toBe('你好');
        expect(left[0].dataset.segmentId).toBe(right[0].dataset.segmentId);

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
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });
        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'B原文' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'B訳' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });

        const left = committedRows(inputContainer).map(textOf);
        const right = committedRows(outputContainer).map(textOf);
        // 新しい行対が上（seq 降順挿入）。
        expect(left).toEqual(['B原文', 'A原文']);
        expect(right).toEqual(['B訳', 'A訳']);
    });

    it('重畳ターン: 前ターンの訳文が次ターンの入力開始後に届いても右列がズレない（FIFO）', () => {
        const { app, inputContainer, outputContainer } = createTranslationApp();

        // 実際の到着順: 訳文は原文より遅れるため、B の入力が始まってから A の訳文が届く。
        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'A原文' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'B原文' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'A訳' });
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'B訳' });
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });

        const left = committedRows(inputContainer);
        const right = committedRows(outputContainer);
        expect(left.map(textOf)).toEqual(['B原文', 'A原文']);
        expect(right.map(textOf)).toEqual(['B訳', 'A訳']);
        // 左右は同じ segmentId で結ばれ、孤児行（segmentId無し）を作らない。
        expect(left[0].dataset.segmentId).toBe(right[0].dataset.segmentId);
        expect(left[1].dataset.segmentId).toBe(right[1].dataset.segmentId);
        for (const row of right) {
            expect(row.dataset.segmentId).toBeTruthy();
        }
    });

    it('ストリーミング中の訳文は次ターンの入力中でも前の行対の右セルへ着地する', () => {
        const { app, inputContainer, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'A原文' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'B原文' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'A訳' });

        const left = committedRows(inputContainer);
        const right = committedRows(outputContainer);
        expect(right).toHaveLength(1);
        expect(textOf(right[0])).toBe('A訳');
        expect(right[0].dataset.status).toBe('responding');
        expect(right[0].dataset.segmentId).toBe(left[0].dataset.segmentId);
    });

    it('output の .done が欠落してもアイドルflushがキュー先頭を確定し、次ターンへ累積しない', async () => {
        const { app, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'A原文' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'A訳' });
        // .done が来ないままアイドル時間（1500ms）が経過する。
        await sleep(1700);

        const right = committedRows(outputContainer);
        expect(right).toHaveLength(1);
        expect(textOf(right[0])).toBe('A訳');
        expect(app._pendingOutputSegments).toHaveLength(0); // キューが掃けている
    }, 5000);

    it('路径3(Chat確定訳)が実行不能でも右セルは stream-final へ確定し responding が残らない', async () => {
        const { app, outputContainer } = createTranslationApp();
        app.state.apiKey = null; // 補精度が走れない環境（fetch/APIキー無し）

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'A原文' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'A訳' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });

        const right = committedRows(outputContainer);
        expect(right[0].dataset.status).toBe('responding');

        await app.realTranslateSegmentViaChat(right[0].dataset.segmentId, 'A原文', 'ja');
        expect(right[0].dataset.status).toBe('stream-final');
        expect(textOf(right[0])).toBe('A訳'); // テキストは消えない（不漏）
    });

    it('resetTranslationStreamState が残留キュー/保留/バッファを破棄し、次の訳文を誤結線しない', () => {
        const { app, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'A原文' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        expect(app._pendingOutputSegments).toHaveLength(1);

        app.resetTranslationStreamState();
        expect(app._pendingOutputSegments).toHaveLength(0);
        expect(app._heldOutputs).toHaveLength(0);
        expect(app.translationCaption).toEqual({ input: '', output: '' });

        // リセット後の訳文は旧セグメントへ結線されず、孤児フォールバックで単独確定する。
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '新訳' });
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });
        const orphans = committedRows(outputContainer).filter((el) => !el.dataset.segmentId);
        expect(orphans).toHaveLength(1);
        expect(textOf(orphans[0])).toBe('新訳');
    });

    it('Chat確定訳(translated)は後続ストリームのdelta/doneに上書きされない（乱改根絶）', () => {
        const { app, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'A原文' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        const right = committedRows(outputContainer);
        const segId = right[0].dataset.segmentId;

        // 路径3のChat確定訳が先に到着
        app.upsertSegmentOutput(segId, 'Chat確定訳', { status: 'translated' });
        // 遅れて届くストリームのdelta/doneは降格上書きとして拒否される
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '流訳' });
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });

        expect(textOf(right[0])).toBe('Chat確定訳');
        expect(right[0].dataset.status).toBe('translated');
        expect(app._pendingOutputSegments).toHaveLength(0); // キュー自体は正しく進む
    });

    it('訳文ゼロのターンが先頭に滞留しても後続の右列がズレ続けない（キュー有界化）', () => {
        const { app, inputContainer, outputContainer } = createTranslationApp();

        // ターンA/Bは訳文が一切来ない。Cの確定時に最古の滞留分が外れる。
        for (const text of ['A原文', 'B原文', 'C原文']) {
            app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: text });
            app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        }
        expect(app._pendingOutputSegments.length).toBeLessThanOrEqual(2);

        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'B訳' });
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });

        // 訳文は最古の未確定ターンの行へ着地する（segmentIdの対応が保たれる）
        const rowB = committedRows(outputContainer).find((el) => textOf(el) === 'B訳');
        const leftB = committedRows(inputContainer).find((el) => textOf(el) === 'B原文');
        expect(rowB).toBeTruthy();
        expect(rowB.dataset.segmentId).toBe(leftB.dataset.segmentId);
    });

    it('入力確定が来ないまま保留された訳文も flush で必ず排出される（不漏）', () => {
        const { app, outputContainer } = createTranslationApp();

        // 1入力ターンに対し訳文確定が2回来るケース（キュー空・入力ストリーミング中）
        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'X原文' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'Y1' });
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: 'Y2' });
        app.dispatchWSMessage({ type: 'session.output_transcript.done' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' }); // Y1 を回収
        app.dispatchWSMessage({ type: 'session.closed' }); // 残余 Y2 を排出

        const texts = committedRows(outputContainer).map(textOf);
        expect(texts).toContain('Y1');
        expect(texts).toContain('Y2'); // 旧実装では黙って破棄されていた
        expect(app._heldOutputs).toHaveLength(0);
    });

    it('アイドルflushの早期確定は responding のままで、後からChat確定訳が上書きできる', async () => {
        const { app, outputContainer } = createTranslationApp();

        app.dispatchWSMessage({ type: 'session.input_transcript.delta', delta: 'A原文' });
        app.dispatchWSMessage({ type: 'session.input_transcript.done' });
        app.dispatchWSMessage({ type: 'session.output_transcript.delta', delta: '部分訳' });
        await sleep(1700); // .done が来ないままアイドルflush

        const right = committedRows(outputContainer);
        expect(right[0].dataset.status).toBe('responding'); // stream-final で固定しない
        expect(textOf(right[0])).toBe('部分訳');

        app.upsertSegmentOutput(right[0].dataset.segmentId, 'Chat確定訳', {
            status: 'translated'
        });
        expect(textOf(right[0])).toBe('Chat確定訳'); // 昇格上書きは許可される
    }, 5000);
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
        app.transport = buildTransportDescriptor({ isElectron: true, isTranslationSession: true });

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
        app.transport = buildTransportDescriptor({ isElectron: true, isTranslationSession: true });

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
        app.transport = buildTransportDescriptor({ isElectron: true, isTranslationSession: true });
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
            },
            transport: buildTransportDescriptor({ isElectron: true, isTranslationSession: true })
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
            platform: { isElectron: true, sendRealtime: async () => ({ success: true }) },
            transport: buildTransportDescriptor({ isElectron: true, isTranslationSession: true })
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
            platform: {},
            transport: buildTransportDescriptor({ isElectron: false, isTranslationSession: false })
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
