/**
 * Vitest 共通セットアップ
 *
 * UI 言語を ja に固定する。Node 21+ は navigator.language を持つため、
 * 未固定だと実行環境のロケールで言語が変わり、翻訳結果を検証するテストが不安定になる。
 */
import i18n from '../i18n';

await i18n.changeLanguage('ja');
