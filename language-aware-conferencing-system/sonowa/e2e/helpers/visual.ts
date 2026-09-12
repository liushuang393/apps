/**
 * Sonowa MVP visual regression helper
 *
 * 「2 回目以降の実行で時刻や動的要素のために画面差分が出てしまう」
 * を防ぐ仕組み。
 *
 * 鉄則:
 *   1. screenshot を取る前に必ず freezeTime を呼ぶ（または globalSetup で 1 回）
 *   2. 動的要素は data-testid に `volatile-*` プレフィックスを付ける（HTML 側の規約）
 *   3. expectScreenshotStable() を使うと自動で全 volatile 要素をマスクする
 *
 * 動的要素 testid 規約（adapter manifest.toml の determinism.volatile_testid_prefix と一致）:
 *   - `volatile-*`   : 一般的な動的要素
 *   - `timestamp-*`  : 絶対時刻表示
 *   - `relative-*`   : 相対時刻 ("3 分前" 等)
 *   - `now-*`        : 現在時刻
 */
import { expect, type Page, type Locator, type TestInfo } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** adapter manifest と同期。動的要素として扱う testid prefix。*/
export const VOLATILE_TESTID_PREFIXES = ['volatile-', 'timestamp-', 'relative-', 'now-'];

/** 既定の固定時刻（adapter manifest の default_clock と同期）。*/
export const DEFAULT_CLOCK_ISO = '2026-01-01T00:00:00Z';

export const BUSINESS_SCREENSHOT_PHASES = ['initial', 'before-submit', 'after-submit'] as const;

export type BusinessScreenshotPhase = (typeof BUSINESS_SCREENSHOT_PHASES)[number];

/**
 * ブラウザ時刻を固定する。
 * Playwright 1.45+ の page.clock.install を使う。
 *
 * 必須: screenshot 比較や "現在時刻" 表示の test で必ず呼ぶ。
 */
export async function freezeTime(page: Page, isoTime: string = DEFAULT_CLOCK_ISO): Promise<void> {
  const clock = (
    page as unknown as { clock?: { install: (opts: { time: Date }) => Promise<void> } }
  ).clock;
  if (clock && typeof clock.install === 'function') {
    await clock.install({ time: new Date(isoTime) });
    return;
  }
  // 古い playwright の fallback: Date を inject
  await page.addInitScript((isoTimeArg: string) => {
    const fixed = new Date(isoTimeArg).getTime();
    const OriginalDate = Date;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Date = class extends OriginalDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixed);
        } else {
          // @ts-expect-error 任意引数
          super(...args);
        }
      }
      static now() {
        return fixed;
      }
    };
  }, isoTime);
}

/** 動的 testid を持つ要素を全て取得（mask 用）。*/
async function collectVolatileLocators(page: Page): Promise<Locator[]> {
  const selectors = VOLATILE_TESTID_PREFIXES.map((p) => `[data-testid^="${p}"]`).join(', ');
  return [page.locator(selectors)];
}

const VISUAL_STABILITY_ATTEMPTS = 5;
const VISUAL_STABILITY_INTERVAL_MS = 100;

/** font / stylesheet 適用と連続 paint を待ち、描画途中の screenshot を防ぐ。*/
export async function waitForVisualStability(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/**
 * 同一画像が 2 回連続するまで capture する。
 *
 * Playwright の `toHaveScreenshot` は内部で安定画像を待つが、`page.screenshot`
 * は 1 paint だけを保存する。後者をそのまま業務証跡に使うと、SPA の CSS chunk や
 * web font が反映途中の黒い画面を「current」として残すため、同じ入力でも旧新差分に
 * なる。安定しない画面は証跡として保存せず fail-closed にする。
 */
async function captureStablePageScreenshot(
  page: Page,
  mask: Locator[],
  fullPage: boolean,
  scope?: Locator,
): Promise<Buffer> {
  await waitForVisualStability(page);
  let previous: Buffer | undefined;
  for (let attempt = 0; attempt < VISUAL_STABILITY_ATTEMPTS; attempt += 1) {
    const current = scope
      ? await scope.screenshot({ mask, animations: 'disabled', caret: 'hide' })
      : await page.screenshot({
          mask,
          animations: 'disabled',
          caret: 'hide',
          fullPage,
        });
    if (previous?.equals(current)) return current;
    previous = current;
    await page.waitForTimeout(VISUAL_STABILITY_INTERVAL_MS);
  }
  throw new Error(
    `visual output did not stabilize after ${VISUAL_STABILITY_ATTEMPTS} captures; ` +
      'mask volatile regions or wait for the business state explicitly',
  );
}

/**
 * 「2 回目以降の差分が出にくい」screenshot 比較。
 *
 * - 全動的要素を自動マスク
 * - アニメーション無効
 * - カーソル非表示
 * - 失敗時は __snapshots__ に diff 画像
 *
 * 使い方:
 *   await expectScreenshotStable(page, "home.png");
 *   await expectScreenshotStable(page.locator("[data-testid=card]"), "card.png");
 */
export async function expectScreenshotStable(
  target: Page | Locator,
  name: string,
  options: {
    maskExtra?: Locator[];
    fullPage?: boolean;
  } = {},
): Promise<void> {
  const page = 'page' in target ? target.page() : (target as Page);
  await waitForVisualStability(page);
  const mask = await collectVolatileLocators(page);
  if (options.maskExtra) mask.push(...options.maskExtra);

  await expect(target).toHaveScreenshot(name, {
    mask,
    animations: 'disabled',
    caret: 'hide',
    fullPage: 'fullPage' in options ? options.fullPage : true,
    maxDiffPixels: 100,
  });
}

function normalizeScenarioId(scenarioId: string): string {
  return scenarioId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 業務イベントの証跡 screenshot 名を固定する。
 *
 * ルール:
 *   - UI 業務イベント 1 件につき initial / before-submit / after-submit の 3 枚だけ
 *   - ファイル名は `<scenario-id>-<phase>.png` に固定し、run 間で同名比較できるようにする
 *   - 追加の ad-hoc screenshot は取らない
 */
export function businessScreenshotName(scenarioId: string, phase: BusinessScreenshotPhase): string {
  return `${normalizeScenarioId(scenarioId)}-${phase}.png`;
}

function businessScreenshotPath(name: string): string {
  const root = process.env.E2E_BUSINESS_SCREENSHOT_DIR
    ? resolve(process.env.E2E_BUSINESS_SCREENSHOT_DIR)
    : resolve(process.cwd(), 'business-screenshots');
  const current = resolve(root, 'current', name);
  const previous = resolve(root, 'previous', name);

  mkdirSync(dirname(current), { recursive: true });
  if (existsSync(current)) {
    mkdirSync(dirname(previous), { recursive: true });
    copyFileSync(current, previous);
  }
  return current;
}

export async function captureBusinessScreenshot(
  page: Page,
  testInfo: TestInfo,
  scenarioId: string,
  phase: BusinessScreenshotPhase,
  options: {
    maskExtra?: Locator[];
    fullPage?: boolean;
    scope?: Locator;
  } = {},
): Promise<void> {
  const mask = await collectVolatileLocators(page);
  if (options.maskExtra) mask.push(...options.maskExtra);
  const name = businessScreenshotName(scenarioId, phase);
  const path = businessScreenshotPath(name);
  const image = await captureStablePageScreenshot(
    page,
    mask,
    'fullPage' in options ? options.fullPage : true,
    options.scope,
  );
  writeFileSync(path, image);
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

export async function expectBusinessScreenshot(
  target: Page | Locator,
  scenarioId: string,
  phase: BusinessScreenshotPhase,
  options: {
    maskExtra?: Locator[];
    fullPage?: boolean;
  } = {},
): Promise<void> {
  await expectScreenshotStable(target, businessScreenshotName(scenarioId, phase), options);
}

/**
 * volatile 要素が spec 内に hard-code されていないかチェック（lint 補助）。
 * spec 中で `getByTestId("volatile-...")` のように動的値を直接アサートするのは
 * 「初回実行の今の時刻」に依存することになり、2 回目以降 fail する。
 *
 * この関数は spec を読む時に AI / hook が呼ぶ規約ヘルパー。
 */
export function isVolatileTestId(testid: string): boolean {
  return VOLATILE_TESTID_PREFIXES.some((p) => testid.startsWith(p));
}
