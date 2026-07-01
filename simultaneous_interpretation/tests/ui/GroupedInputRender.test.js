/**
 * groupedモードの左カラム（音声認識）描画テスト（回帰ガード）。
 *
 * 対象: handleTranscriptionCompleted の grouped 分岐（WebSocketMixin）。
 *
 * 回帰の内容:
 *   MAX_SENTENCES=1 だと、grouped 分岐で先に addGroupedSentenceCount() を呼ぶと
 *   1文で flushGroupedAudio() が走り groupedSegmentId が null 化する。その後の
 *   「if (groupedSegmentId)」描画が false になり、本転写が左カラムへ描画されず
 *   pending へ退避して音声認識が空になっていた（右カラムは別経路で出る）。
 *
 * 修正: 文数計数（flush 誘発）より前に、現行グループへ入力転写を描画する。
 *   本テストは flush で groupedSegmentId が null 化しても左カラムが描画されることを保証する。
 *
 * 実コード（root の voicetranslate-*.js）を vm で同一コンテキストに読み込む（[cs:s1-97] の方式）。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * UIMixin と WebSocketMixin を同一 vm コンテキストに読み込む。
 * grouped 分岐は CONFIG.TRANSLATION と Float32Array を参照するため sandbox に含める。
 *
 * @param {Document} document jsdom の document
 * @returns {{UIMixin: object, WebSocketMixin: object}}
 */
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
        TRANSLATION_CAPTION_IDLE_MS: 800,
        CONFIG: {
            AUDIO: { SAMPLE_RATE: 24000 },
            TRANSLATION: {
                TURN_MODE: 'grouped',
                MIN_COMPLETE_SENTENCES: 1,
                MAX_SENTENCES: 1, // 回帰を誘発した実値（8c41f91 で 3→1）
                POST_SENTENCE_HOLD_MS: 150,
                MAX_BUFFER_MS: 2500
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
 * 表示テスト用の最小アプリスタブ（grouped 収集中セグメントを1つ持つ状態）を生成する。
 *
 * @returns {{app: object, inputContainer: Element, outputContainer: Element, segment: object}}
 */
function createGroupedApp() {
    document.body.innerHTML = '';
    const inputContainer = document.createElement('div');
    const outputContainer = document.createElement('div');
    document.body.appendChild(inputContainer);
    document.body.appendChild(outputContainer);

    // 収集中の grouped セグメント（accumulateGroupedAudio 済み相当）。
    const segment = {
        id: 'seg1',
        seq: 1,
        input: { text: '', source: null },
        output: { text: '', responseId: null }
    };

    const app = {
        elements: {
            inputTranscript: inputContainer,
            outputTranscript: outputContainer
        },
        state: { charCount: 0, sourceLang: 'zh', currentSessionId: null },
        platform: {},
        // 依存スタブ
        useAudioQueue: true,
        segmentResendDepth: 0,
        groupedSegmentId: 'seg1',
        groupedAudioChunks: [new Float32Array(2400)], // flush が実処理に入るよう非空
        groupedAudioDuration: 100,
        groupedAudioStartTime: Date.now(),
        groupSentenceCount: 0,
        groupedSampleRate: 24000,
        segmentAlignment: {
            pendingInputSegments: [],
            bindItemId: () => {}, // item_id→segment バインド（描画の flush 非依存化で使用）
            getSegmentByItemId: () => null, // grouped 分岐へ落とす（item_id 未バインド経路）
            getSegment: (id) => (id === segment.id ? segment : null),
            updateInput: (id, text, opts) => {
                if (id === segment.id) {
                    segment.input.text = text;
                    if (opts && opts.source) {
                        segment.input.source = opts.source;
                    }
                }
                return segment;
            }
        }
    };

    const { UIMixin, WebSocketMixin } = loadMixins(document);
    Object.assign(app, UIMixin, WebSocketMixin);
    // ✅ mixin メソッドのスタブは Object.assign の「後」に設定する（前だと実装で上書きされる）。
    //    実キュー/segmentAlignment を使わず flush を完了させる。
    app.tryEnqueueAudioSegment = () => true;
    return { app, inputContainer, outputContainer, segment };
}

function rows(container) {
    return Array.from(container.querySelectorAll('.transcript-message'));
}

function textOf(el) {
    return el.querySelector('.transcript-text').textContent;
}

describe('groupedモードの左カラム描画（回帰ガード: MAX_SENTENCES=1）', () => {
    it('1文の転写が flush で groupedSegmentId を null 化しても左カラムに描画される', () => {
        const { app, inputContainer, segment } = createGroupedApp();

        // 1文完結（。付き）→ addGroupedSentenceCount が MAX_SENTENCES=1 到達で flush する。
        app.handleTranscriptionCompleted({ transcript: '你好世界。', item_id: 'itemX' });

        // flush が実際に走ったこと（この呼び出し中に groupedSegmentId が null 化）。
        expect(app.groupedSegmentId).toBeNull();

        // それでも左カラム（音声認識）に確定描画されている（修正の要）。
        const left = rows(inputContainer);
        expect(left).toHaveLength(1);
        expect(textOf(left[0])).toBe('你好世界。');

        // データモデルにも live-sra として確定している（process 側の二重描画を防ぐ）。
        expect(segment.input.text).toBe('你好世界。');
        expect(segment.input.source).toBe('live-sra');
    });

    it('連続する複数ターンの転写がすべて左カラムに残る（取りこぼしなし）', () => {
        const { app, inputContainer, segment } = createGroupedApp();

        app.handleTranscriptionCompleted({ transcript: '第一文。', item_id: 'a' });

        // 次ターン: 新しい収集セグメントを用意（accumulateGroupedAudio 相当を手動再現）。
        segment.id = 'seg2';
        segment.seq = 2;
        segment.input = { text: '', source: null };
        segment.output = { text: '', responseId: null };
        app.groupedSegmentId = 'seg2';
        app.groupedAudioChunks = [new Float32Array(2400)];
        app.groupedAudioStartTime = Date.now();
        app.groupSentenceCount = 0;

        app.handleTranscriptionCompleted({ transcript: '第二文。', item_id: 'b' });

        const left = rows(inputContainer).map(textOf);
        expect(left).toHaveLength(2);
        expect(left).toContain('第一文。');
        expect(left).toContain('第二文。');
    });
});
