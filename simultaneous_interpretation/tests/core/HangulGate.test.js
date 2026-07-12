/**
 * AudioUtils ハングル優勢判定・言語検出ゲートの単体テスト。
 *
 * 仮想声卡の日韓誤認 ASR を下流に流さないための境界条件を固定する。
 */

const { AudioUtils } = require('../../voicetranslate-utils.js');

describe('AudioUtils.isHangulDominantText', () => {
    it('純ハングルは true', () => {
        expect(AudioUtils.isHangulDominantText('안녕하세요')).toBe(true);
        expect(AudioUtils.isHangulDominantText('반갑습니다.')).toBe(true);
    });

    it('純日本語（かな）は false', () => {
        expect(AudioUtils.isHangulDominantText('こんにちは')).toBe(false);
        expect(AudioUtils.isHangulDominantText('たくさんだ。')).toBe(false);
    });

    it('漢字のみ・英語は false', () => {
        expect(AudioUtils.isHangulDominantText('你好')).toBe(false);
        expect(AudioUtils.isHangulDominantText('Hello world')).toBe(false);
    });

    it('かな優勢でハングルが混じるだけなら false（誤破棄防止）', () => {
        expect(AudioUtils.isHangulDominantText('こんにちは안')).toBe(false);
    });

    it('ハングル優勢でかなが少し混じるなら true', () => {
        // ハングル6 > かな5 → 過半（同数は >0.5 ではないため false）
        expect(AudioUtils.isHangulDominantText('안녕하세요요こんにちは')).toBe(true);
    });

    it('空・空白のみは false', () => {
        expect(AudioUtils.isHangulDominantText('')).toBe(false);
        expect(AudioUtils.isHangulDominantText('   ')).toBe(false);
        expect(AudioUtils.isHangulDominantText(null)).toBe(false);
    });
});

describe('AudioUtils.detectSupportedLanguageFromText（ハングル）', () => {
    it('ハングル優勢は null（対応言語外・ko を返さない）', () => {
        expect(AudioUtils.detectSupportedLanguageFromText('안녕하세요')).toBeNull();
    });

    it('日本語は ja のまま', () => {
        expect(AudioUtils.detectSupportedLanguageFromText('こんにちは')).toBe('ja');
    });
});
