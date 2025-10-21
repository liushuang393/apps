/**
 * Electron システム音声キャプチャ
 *
 * @description
 * Electron の desktopCapturer API を使用してシステム音声をキャプチャ。
 * Teams/Zoom などの会議アプリ、Chrome/Edge などのブラウザ音声を取得。
 *
 * @features
 * - デスクトップ音声ソースの列挙
 * - 会議アプリ音声キャプチャ（Teams、Zoom、Google Meet等）
 * - ブラウザ音声キャプチャ（Chrome、Edge、Firefox等）
 * - 画面共有音声キャプチャ
 * - 音声ストリーム管理
 *
 * @author VoiceTranslate Pro Team
 * @version 2.1.0
 */

import { desktopCapturer, DesktopCapturerSource } from 'electron';

/**
 * 音声ソース情報
 */
export interface AudioSourceInfo {
    /** ソース ID */
    id: string;
    /** ソース名 */
    name: string;
    /** ソースタイプ */
    type: 'window' | 'screen';
    /** サムネイル（Base64） */
    thumbnail?: string;
}

/**
 * システム音声キャプチャクラス
 */
export class ElectronAudioCapture {
    /**
     * 利用可能な音声ソースを取得
     *
     * @param types - ソースタイプ
     * @returns 音声ソース一覧
     */
    public static async getAudioSources(
        types: ('window' | 'screen')[] = ['window', 'screen']
    ): Promise<AudioSourceInfo[]> {
        try {
            const sources = await desktopCapturer.getSources({
                types,
                fetchWindowIcons: true
            });

            return sources.map((source: DesktopCapturerSource) => ({
                id: source.id,
                name: source.name,
                type: source.id.startsWith('screen') ? 'screen' : 'window',
                thumbnail: source.thumbnail?.toDataURL()
            }));
        } catch (error) {
            console.error('[ElectronAudioCapture] Failed to get audio sources:', error);
            return [];
        }
    }

    /**
     * Teams/Zoom/ブラウザウィンドウを検出
     *
     * 目的:
     *   会議アプリとブラウザウィンドウを検出して表示する。
     *   音声トラックの有無は録音開始時にチェックする。
     *
     * @returns 音声ソース（会議アプリ + ブラウザ）
     */
    public static async detectMeetingApps(): Promise<AudioSourceInfo[]> {
        const sources = await this.getAudioSources(['window']);

        // デバッグ: 全ウィンドウを出力
        console.log('[ElectronAudioCapture] ========== 全ウィンドウ一覧 ==========');
        console.log(`[ElectronAudioCapture] 総ウィンドウ数: ${sources.length}`);
        sources.forEach((source, index) => {
            console.log(`  [${index}] ${source.name}`);
            console.log(`       ID: ${source.id}`);
            console.log(`       Type: ${source.type}`);
        });
        console.log('[ElectronAudioCapture] ========================================');

        // 会議アプリのパターン（柔軟なマッチング）
        const meetingAppPatterns = [
            /Teams/i, // Microsoft Teams（任意の位置）
            /Microsoft.*Teams/i, // Microsoft Teams（順序を含む）
            /Zoom/i, // Zoom Meeting / Zoom（任意の位置）
            /Google Meet/i, // Google Meet
            /Meet.*Google/i, // Google Meetの別形式
            /Skype/i, // Skype
            /Discord/i, // Discord
            /Slack.*Call/i, // Slack Call
            /Webex/i, // Webex
            /GoToMeeting/i // GoToMeeting
        ];

        // ブラウザのパターン（柔軟なマッチング - ウィンドウ名にブラウザ名が含まれていればOK）
        const browserPatterns = [
            /Google Chrome/i, // Google Chrome（任意の位置）
            /Chrome/i, // Chrome（任意の位置）
            /Microsoft.*Edge/i, // Microsoft Edge
            /Edge/i, // Edge（任意の位置）
            /Firefox/i, // Firefox（任意の位置）
            /Mozilla.*Firefox/i, // Mozilla Firefox
            /Safari/i, // Safari
            /Opera/i, // Opera
            /Brave/i // Brave
        ];

        // 除外パターン（明らかに音声ソースではないもの）
        const excludePatterns = [
            // 自分自身
            /VoiceTranslate Pro/i,

            // エディタ・IDE
            /Visual Studio Code/i,
            /VSCode/i,
            /VS Code/i,
            /Cursor/i,
            /Notepad\+\+/i,
            /Notepad$/i,
            /メモ帳/i,
            /Sublime Text/i,
            /Atom/i,

            // システムアプリ
            /Windows Explorer/i,
            /File Explorer/i,
            /エクスプローラー/i,
            /ファイル エクスプローラー/i,
            /PowerShell/i,
            /Command Prompt/i,
            /cmd\.exe/i,
            /コマンド プロンプト/i,
            /Terminal$/i,
            /ターミナル/i,
            /Snipping Tool/i,
            /切り取り/i,
            /Settings$/i,
            /設定$/i,
            /Task Manager/i,
            /タスク マネージャー/i,

            // Officeアプリ（Teamsと区別するため、より厳格に）
            /\bWord\b.*\.docx?/i,
            /\bExcel\b.*\.xlsx?/i,
            /\bPowerPoint\b.*\.pptx?/i,
            /^Outlook$/i,
            /^Word$/i,
            /^Excel$/i,
            /^PowerPoint$/i
        ];

        console.log('[ElectronAudioCapture] ========== 検出処理開始 ==========');

        // フィルタリング処理
        const filtered = sources.filter((source) => {
            const name = source.name;

            // 除外パターンに一致する場合はスキップ
            if (excludePatterns.some((pattern) => pattern.test(name))) {
                console.log(`[ElectronAudioCapture] ❌ 除外: ${name}`);
                return false;
            }

            // 会議アプリに一致するか確認
            const isMeetingApp = meetingAppPatterns.some((pattern) => pattern.test(name));
            if (isMeetingApp) {
                console.log(`[ElectronAudioCapture] ✅ 会議アプリ: ${name}`);
                return true;
            }

            // ブラウザかどうか確認
            const isBrowser = browserPatterns.some((pattern) => pattern.test(name));
            if (isBrowser) {
                console.log(`[ElectronAudioCapture] ✅ ブラウザ: ${name}`);
                return true;
            }

            console.log(`[ElectronAudioCapture] ❌ 不一致: ${name}`);
            return false;
        });

        // 優先順位でソート: 会議アプリ > ブラウザ
        filtered.sort((a, b) => {
            const aIsMeeting = meetingAppPatterns.some((pattern) => pattern.test(a.name));
            const bIsMeeting = meetingAppPatterns.some((pattern) => pattern.test(b.name));

            if (aIsMeeting && !bIsMeeting) {
                return -1;
            }
            if (!aIsMeeting && bIsMeeting) {
                return 1;
            }
            return 0;
        });

        console.log(`[ElectronAudioCapture] ========== 検出結果: ${filtered.length}個 ==========`);
        filtered.forEach((source, index) => {
            const isMeeting = meetingAppPatterns.some((pattern) => pattern.test(source.name));
            const label = isMeeting ? '🎤 会議' : '🌐 ブラウザ';
            console.log(`  [${index + 1}] ${label} ${source.name}`);
        });

        return filtered;
    }

    /**
     * 音声ソース ID を検証
     *
     * @param sourceId - ソース ID
     * @returns 有効か
     */
    public static async validateSourceId(sourceId: string): Promise<boolean> {
        const sources = await this.getAudioSources();
        return sources.some((source) => source.id === sourceId);
    }
}
