/**
 * [MEETING-001] 実ブラウザ2台で会議する（擬似マイク）
 *
 * 話者: 既知音声 WAV を Chrome の擬似マイクとして入力し、画面のマイクボタンで発言する。
 * 聴者: 別ブラウザで「翻訳」を選び、翻訳字幕が画面に出ることを確認する。
 * 前提: 本番相当スタック（HTTPS・GPU・方式3 など）が起動済みで、以下の環境変数がある。
 *   E2E_BASE_URL=https://<HOST_IP>   E2E_FAKE_MIC_WAV=<話者 WAV>   E2E_SILENT_WAV=<無音 WAV>
 *   E2E_MEETING_SOURCE=ja（既定） E2E_MEETING_TARGET=en（既定）
 * 注意: 翻訳音声の内容照合は scripts/verify_local_livekit.py / verify_received_audio.py が担う。
 */
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";

import { createRoom } from "../helpers/api";
import { E2E_USERS, loginAs, registerUser } from "../helpers/auth";
import { goto } from "../helpers/navigation";

const SOURCE = process.env.E2E_MEETING_SOURCE ?? "ja";
const TARGET = process.env.E2E_MEETING_TARGET ?? "en";
const TRANSLATION_TIMEOUT_MS = 180_000;

/** 擬似マイク付きの Chrome を起動する（ファイルは1回だけ再生）。 */
async function launchWithMic(wav: string): Promise<Browser> {
  return chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
}

/** 指定言語の利用者を登録し、会議室へ入室した page を返す。 */
async function joinAs(browser: Browser, language: string) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  const credentials = {
    email: E2E_USERS.user.email(),
    password: E2E_USERS.user.password(),
  };
  await registerUser({
    ...credentials,
    displayName: `Meeting ${language}`,
    nativeLanguage: language,
  });
  const { token } = await loginAs(page, credentials);
  return { page, token };
}

async function waitConnected(page: Page): Promise<void> {
  await expect(page.getByTestId("room-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("connection-status")).toContainText("接続中", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("preference-panel")).toBeVisible({ timeout: 30_000 });
}

test.describe("[MEETING-001] 実ブラウザ会議", () => {
  test.setTimeout(TRANSLATION_TIMEOUT_MS + 120_000);

  test("[MEETING-001] mic speech reaches listener as translated subtitle", async () => {
    const micWav = process.env.E2E_FAKE_MIC_WAV;
    const silentWav = process.env.E2E_SILENT_WAV;
    test.skip(!micWav || !silentWav, "E2E_FAKE_MIC_WAV / E2E_SILENT_WAV が未指定");

    const speakerBrowser = await launchWithMic(micWav as string);
    const listenerBrowser = await launchWithMic(silentWav as string);
    try {
      const speaker = await joinAs(speakerBrowser, SOURCE);
      const created = await createRoom(speaker.token, {
        name: `E2E Meeting ${Date.now().toString(36)}`,
        allowed_languages: [SOURCE, TARGET],
      });
      expect([200, 201]).toContain(created.status);
      const roomId = created.data?.id as string;

      // 聴者を先に入室させ、翻訳・字幕言語を設定しておく。
      const listener = await joinAs(listenerBrowser, TARGET);
      await goto(listener.page, `/room/${roomId}`);
      await waitConnected(listener.page);
      await listener.page.getByTestId("audio-mode-translated").check();
      await listener.page.getByTestId("target-language").selectOption(TARGET);

      // 話者が入室し、画面のマイクボタンで発言を始める（擬似マイクの WAV が流れる）。
      await goto(speaker.page, `/room/${roomId}`);
      await waitConnected(speaker.page);
      const mic = speaker.page.locator("button.mic-button");
      await expect(mic).toBeEnabled({ timeout: 30_000 });
      await mic.click();
      await expect(mic).toHaveClass(/\bon\b/, { timeout: 15_000 });

      // 聴者の画面に、話者の発言が翻訳字幕として出る。
      const translated = listener.page.locator(
        '[data-testid="subtitle-item"]:not(.my-message)',
      );
      await expect(translated.first()).toBeVisible({ timeout: TRANSLATION_TIMEOUT_MS });
      const text = (await translated.first().innerText()).trim();
      test.info().annotations.push({ type: "listener-subtitle", description: text });
      expect(text.length).toBeGreaterThan(5);

      // 話者の画面にも自分の発言の字幕が残る（会議記録）。
      await expect(speaker.page.getByTestId("subtitle-item").first()).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      await speakerBrowser.close();
      await listenerBrowser.close();
    }
  });
});
