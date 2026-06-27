/**
 * 翻訳字幕の増分レンダリング（ライブ暫定行）テスト。
 *
 * 対象: renderLiveCaption / clearLiveCaption（UIMixin）と
 *       handleTranslationTranscriptDelta / commitTranslationCaption（WebSocketMixin）。
 *
 * 実コード（root の voicetranslate-*.js）を vm で同一コンテキストに読み込み、
 * jsdom の document を注入して検証する（src/ の再実装ではなく本番コードを対象）。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// jest は jsdom 環境（jest.config.js）なので document はグローバルに存在する。
// jsdom を直接 require するとその ESM 依存で jest が落ちるため、グローバルを使う。

const TRANSLATION_CAPTION_IDLE_MS = 800;

/**
 * UIMixin と WebSocketMixin を同一 vm コンテキストに読み込む。
 * 両 mixin のメソッドが同じ document / setTimeout を参照するよう共有させる。
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
        TRANSLATION_CAPTION_IDLE_MS,
        CONFIG: { AUDIO: { SAMPLE_RATE: 24000 } },
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
 * 表示テスト用の最小アプリスタブを生成する。
 *
 * @returns {{app: object, inputContainer: Element, outputContainer: Element}}
 */
function createApp() {
    // isConnected が true になるよう、コンテナを document ツリーへ実際に接続する。
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
        updateLatencyDisplay() {}
    };

    const { UIMixin, WebSocketMixin } = loadMixins(document);
    Object.assign(app, UIMixin, WebSocketMixin);
    return { app, inputContainer, outputContainer };
}

/**
 * コンテナ内のテキスト行を取得する。
 * @param {Element} container
 * @returns {Element[]}
 */
function rows(container) {
    return Array.from(container.querySelectorAll('.transcript-message'));
}

function textOf(el) {
    return el.querySelector('.transcript-text').textContent;
}

describe('翻訳字幕の増分レンダリング', () => {
    it('確定前のデルタを単一のライブ行へ逐次反映する', () => {
        const { app, outputContainer } = createApp();

        app.handleTranslationTranscriptDelta('output', '你好');
        app.handleTranslationTranscriptDelta('output', '，世界');

        const live = rows(outputContainer);
        expect(live).toHaveLength(1); // 行が増殖しない（1本のライブ行を更新）
        expect(live[0].dataset.live).toBe('1');
        expect(textOf(live[0])).toBe('你好，世界');
    });

    it('サーバ .done でライブ行を確定行へ置き換える（句読点では確定しない）', () => {
        const { app, outputContainer } = createApp();

        app.handleTranslationTranscriptDelta('output', '你好');
        app.handleTranslationTranscriptDelta('output', '，世界');
        app.handleTranslationTranscriptDelta('output', '。'); // 句読点だけでは確定しない（BUG1: 境界を .done に一本化）

        const live = rows(outputContainer);
        expect(live).toHaveLength(1);
        expect(live[0].dataset.live).toBe('1'); // まだライブ（未確定）

        // サーバ境界 session.output_transcript.done 相当
        app.commitTranslationCaption('output');

        const finalized = rows(outputContainer);
        expect(finalized).toHaveLength(1); // ライブ行は消え、確定行が1本だけ
        expect(finalized[0].dataset.live).toBeUndefined();
        expect(textOf(finalized[0])).toBe('你好，世界。');
        expect(app.translationCaption.output).toBe('');
    });

    it('サーバ .done ごとに別々の確定行になる', () => {
        const { app, outputContainer } = createApp();

        app.handleTranslationTranscriptDelta('output', '第一句。');
        app.commitTranslationCaption('output'); // .done #1
        app.handleTranslationTranscriptDelta('output', '第二句。');
        app.commitTranslationCaption('output'); // .done #2

        const finalized = rows(outputContainer);
        expect(finalized).toHaveLength(2);
        // 新しい行が上に来る（insertLatestMessage）
        expect(textOf(finalized[0])).toBe('第二句。');
        expect(textOf(finalized[1])).toBe('第一句。');
    });

    it('左右が同一境界(.done)で確定すれば順序で1:1対応する（BUG1）', () => {
        const { app, inputContainer, outputContainer } = createApp();

        // 1ターン目: 原文確定 → 訳文確定
        app.handleTranslationTranscriptDelta('input', 'A原文');
        app.commitTranslationCaption('input');
        app.handleTranslationTranscriptDelta('output', 'A訳');
        app.commitTranslationCaption('output');
        // 2ターン目
        app.handleTranslationTranscriptDelta('input', 'B原文');
        app.commitTranslationCaption('input');
        app.handleTranslationTranscriptDelta('output', 'B訳');
        app.commitTranslationCaption('output');

        const left = rows(inputContainer).map(textOf);
        const right = rows(outputContainer).map(textOf);
        // 新しい行が上 → 同じ序数位置どうしが対応（左[0]⇔右[0]）
        expect(left).toEqual(['B原文', 'A原文']);
        expect(right).toEqual(['B訳', 'A訳']);
        expect(left.length).toBe(right.length); // 行数一致 = 1:1
    });

    it('左右カラムは独立したライブ行を持つ', () => {
        const { app, inputContainer, outputContainer } = createApp();

        app.handleTranslationTranscriptDelta('input', '原文');
        app.handleTranslationTranscriptDelta('output', '訳文');

        expect(textOf(rows(inputContainer)[0])).toBe('原文');
        expect(textOf(rows(outputContainer)[0])).toBe('訳文');
    });
});

describe('履歴保存失敗の通知（BUG4）', () => {
    it('SQLite 保存失敗をセッション中に一度だけ警告する（無言握り潰しの解消）', async () => {
        const { UIMixin } = loadMixins(document);
        const notifyCalls = [];
        const app = {
            state: { currentSessionId: 's1', sourceLang: 'zh' },
            platform: {
                conversation: {
                    addTurn() {
                        throw new Error('db locked');
                    }
                }
            }
        };
        Object.assign(app, UIMixin);
        // 実 notify を上書きしてスパイ化（Object.assign の後に設定する）。
        app.notify = (title, msg, level) => notifyCalls.push({ title, msg, level });

        await app.saveTranscriptToDatabase('input', '一回目', 1);
        await app.saveTranscriptToDatabase('input', '二回目', 2);

        expect(notifyCalls).toHaveLength(1); // 氾濫させず1回だけ
        expect(notifyCalls[0].level).toBe('warning');
        expect(notifyCalls[0].msg).toContain('db locked');
    });
});
