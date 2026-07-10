/** Electron renderer へ公開する最小・明示的な IPC ブリッジ。 */

import { contextBridge, ipcRenderer } from 'electron';
import type { StoreCredentialResult } from './CredentialService';
import type { PublicOpenAIConfig } from './OpenAIConfigService';
import type { RealtimeRendererEvent, RealtimeSendResult } from './realtimeWebSocket';
import type { TranslationRequest, TranslationResult } from './TranslationGateway';
import type { SegmentTurnInput } from './ConversationDatabase';

export interface PublicCredentialStatus {
    configured: boolean;
    source: 'environment' | 'secure-storage' | 'none';
    storedFallbackExists: boolean;
}

export interface ElectronAPI {
    minimizeWindow(): void;
    maximizeWindow(): void;
    closeWindow(): void;
    toggleAlwaysOnTop(): void;
    getConfig(): Promise<unknown>;
    saveConfig(config: unknown): Promise<boolean>;
    getAudioSources(types?: ('window' | 'screen')[]): Promise<unknown[]>;
    detectMeetingApps(): Promise<unknown[]>;
    credentials: {
        getStatus(): Promise<PublicCredentialStatus>;
        storeKey(key: string): Promise<StoreCredentialResult>;
        clearStoredKey(): Promise<void>;
    };
    runtime: {
        getPublicConfig(): Promise<PublicOpenAIConfig>;
    };
    realtime: {
        connect(): Promise<{ connectionId: string }>;
        send(connectionId: string, event: unknown): Promise<RealtimeSendResult>;
        close(connectionId: string): Promise<void>;
        getState(): Promise<{ connectionId: string | null; state: string }>;
        subscribe(callback: (event: RealtimeRendererEvent) => void): () => void;
    };
    translation: {
        translate(request: TranslationRequest): Promise<TranslationResult>;
    };
    history: {
        startSession(sourceLanguage?: string, targetLanguage?: string): Promise<number>;
        endSession(): Promise<void>;
        upsertSegment(turn: SegmentTurnInput): Promise<number>;
        listSessions(limit?: number): Promise<unknown[]>;
        getSession(sessionId: number): Promise<unknown[]>;
        clearAll(): Promise<number>;
    };
    platform: string;
    versions: {
        node: string;
        chrome: string;
        electron: string;
    };
}

const electronAPI: ElectronAPI = {
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    toggleAlwaysOnTop: () => ipcRenderer.send('toggle-always-on-top'),
    getConfig: async () => await ipcRenderer.invoke('get-config'),
    saveConfig: async (config: unknown) => await ipcRenderer.invoke('save-config', config),
    getAudioSources: async (types?: ('window' | 'screen')[]) =>
        await ipcRenderer.invoke('get-audio-sources', types),
    detectMeetingApps: async () => await ipcRenderer.invoke('detect-meeting-apps'),
    credentials: {
        getStatus: async () => await ipcRenderer.invoke('credentials:get-status'),
        storeKey: async (key: string) => await ipcRenderer.invoke('credentials:store-key', key),
        clearStoredKey: async () => await ipcRenderer.invoke('credentials:clear-key')
    },
    runtime: {
        getPublicConfig: async () => await ipcRenderer.invoke('runtime:get-public-config')
    },
    realtime: {
        connect: async () => await ipcRenderer.invoke('realtime:connect'),
        send: async (connectionId: string, event: unknown) =>
            await ipcRenderer.invoke('realtime:send', connectionId, event),
        close: async (connectionId: string) =>
            await ipcRenderer.invoke('realtime:close', connectionId),
        getState: async () => await ipcRenderer.invoke('realtime:get-state'),
        subscribe: (callback: (event: RealtimeRendererEvent) => void) => {
            const wrapped = (
                _event: Electron.IpcRendererEvent,
                payload: RealtimeRendererEvent
            ): void => {
                callback(payload);
            };
            ipcRenderer.on('realtime:event', wrapped);
            return () => ipcRenderer.removeListener('realtime:event', wrapped);
        }
    },
    translation: {
        translate: async (request: TranslationRequest) =>
            await ipcRenderer.invoke('translation:translate', request)
    },
    history: {
        startSession: async (sourceLanguage?: string, targetLanguage?: string) =>
            await ipcRenderer.invoke('conversation:start-session', sourceLanguage, targetLanguage),
        endSession: async () => await ipcRenderer.invoke('conversation:end-session'),
        upsertSegment: async (turn: SegmentTurnInput) =>
            await ipcRenderer.invoke('conversation:upsert-segment-turn', turn),
        listSessions: async (limit?: number) =>
            await ipcRenderer.invoke('conversation:get-all-sessions', limit),
        getSession: async (sessionId: number) =>
            await ipcRenderer.invoke('conversation:get-session-turns', sessionId),
        clearAll: async () => await ipcRenderer.invoke('conversation:clear-all')
    },
    platform: process.platform,
    versions: {
        node: process.versions.node,
        chrome: process.versions.chrome,
        electron: process.versions.electron || 'unknown'
    }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
