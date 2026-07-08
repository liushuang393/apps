/**
 * ライブ字幕の rAF 合流テスト（D2:「字が跳ねる」対策）。
 *
 * 対象: renderLiveCaption / flushLiveCaption / clearLiveCaption（UIMixin）。
 *
 * 検証: requestAnimationFrame のある環境では、同一フレーム内の複数 delta を
 *   1回の描画に合流し（最後のテキストだけ反映）、確定(clearLiveCaption)は
 *   保留中の描画をキャンセルする（確定行の遅延上書き防止）。
 *   ※ rAF の無い環境での即時描画フォールバックは既存の同期テスト
 *     （TranslationStreamRender / CaptionLiveRender）が担保する。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * UIMixin を制御可能な requestAnimationFrame 付きサンドボックスへ読み込む。
 * @param {Array<Function|null>} rafQueue 予約された rAF コールバックの受け皿（手動 flush 用）
 */
function loadUIMixin(rafQueue) {
    const uiSource = fs.readFileSync(
        path.join(__dirname, '../..', 'voicetranslate-ui-mixin.js'),
        'utf8'
    );
    const sandbox = {
        console,
        Date,
        setTimeout,
        clearTimeout,
        // id は 1 始まり（0 を「予約なし」と誤認しないため）。cancel は該当枠を null 化。
        requestAnimationFrame: (cb) => rafQueue.push(cb),
        cancelAnimationFrame: (id) => {
            if (id != null) {
                rafQueue[id - 1] = null;
            }
        },
        module: { exports: {} }
    };
    vm.runInNewContext(`${uiSource}\nmodule.exports = { UIMixin };`, sandbox);
    return sandbox.module.exports.UIMixin;
}

/** 描画ヘルパを差し替えた最小 this（coalesce 契約のみ検証） */
function makeApp(UIMixin) {
    const createdTexts = [];
    const app = {};
    Object.assign(app, UIMixin);
    app.shouldShowTranscript = () => true;
    app.removeEmptyState = () => {};
    app.getTranscriptContainer = () => ({
        firstChild: null,
        insertBefore() {},
        scrollTop: 0
    });
    app.createTranscriptMessage = (_kind, text) => {
        createdTexts.push(text);
        return { dataset: {}, isConnected: true, querySelector: () => ({ textContent: text }) };
    };
    return { app, createdTexts };
}

describe('renderLiveCaption（D2: rAF 合流）', () => {
    it('同一フレームの複数 delta は1回だけ予約し、最後のテキストで1回だけ描画する', () => {
        const rafQueue = [];
        const UIMixin = loadUIMixin(rafQueue);
        const { app, createdTexts } = makeApp(UIMixin);

        app.renderLiveCaption('input', 'こ');
        app.renderLiveCaption('input', 'こん');
        app.renderLiveCaption('input', 'こんに');

        // まだ描画していない（rAF に合流）。予約は1回だけ。
        expect(createdTexts).toHaveLength(0);
        expect(rafQueue.filter(Boolean)).toHaveLength(1);

        // フレーム到来（予約分を実行）→ 最後のテキストで1回だけ描画。
        rafQueue.forEach((cb) => cb && cb());
        expect(createdTexts).toEqual(['こんに']);
    });

    it('確定(clearLiveCaption)は保留中の描画をキャンセルし、遅延描画が起きない', () => {
        const rafQueue = [];
        const UIMixin = loadUIMixin(rafQueue);
        const { app, createdTexts } = makeApp(UIMixin);

        app.renderLiveCaption('input', 'こんにちは');
        app.clearLiveCaption('input');

        rafQueue.forEach((cb) => cb && cb());
        expect(createdTexts).toHaveLength(0);
    });

    it('入力と出力は別枠で合流する（片方の確定が他方の描画を消さない）', () => {
        const rafQueue = [];
        const UIMixin = loadUIMixin(rafQueue);
        const { app, createdTexts } = makeApp(UIMixin);

        app.renderLiveCaption('input', '入力');
        app.renderLiveCaption('output', '訳文');
        app.clearLiveCaption('input'); // 左だけ確定

        rafQueue.forEach((cb) => cb && cb());
        expect(createdTexts).toEqual(['訳文']); // 右は残って描画される
    });

    it('予約から実描画までの間に表示トグルが OFF になったら描画しない（孤児ライブ行を防ぐ）', () => {
        const rafQueue = [];
        const UIMixin = loadUIMixin(rafQueue);
        const { app, createdTexts } = makeApp(UIMixin);

        app.renderLiveCaption('input', 'こんにちは'); // rAF 予約（この時点は表示ON）
        app.shouldShowTranscript = () => false; // 実描画前に列を隠す

        rafQueue.forEach((cb) => cb && cb());
        expect(createdTexts).toHaveLength(0);
    });
});
