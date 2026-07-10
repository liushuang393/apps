import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CredentialService, SafeStorageAdapter } from '../../electron/CredentialService';

class TestStorage implements SafeStorageAdapter {
    public available = true;

    public isEncryptionAvailable(): boolean {
        return this.available;
    }

    public encryptString(plainText: string): Buffer {
        return Buffer.from(`encrypted:${plainText}`, 'utf8');
    }

    public decryptString(encrypted: Buffer): string {
        const value = encrypted.toString('utf8');
        if (!value.startsWith('encrypted:')) {
            throw new Error('corrupt');
        }
        return value.slice('encrypted:'.length);
    }
}

describe('CredentialService', () => {
    const directories: string[] = [];

    function createService(environment: NodeJS.ProcessEnv = {}) {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-credential-'));
        directories.push(directory);
        const storage = new TestStorage();
        return { service: new CredentialService(directory, storage, environment), storage, directory };
    }

    afterEach(() => {
        for (const directory of directories.splice(0)) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('prioritizes the compatible environment variables over a stored fallback', () => {
        const { service } = createService({ OPENAI_API_KEY: 'env-key' });
        expect(service.storeKey('stored-key')).toEqual({ success: true, persisted: true });
        expect(service.getApiKey()).toBe('env-key');
        expect(service.getStatus()).toMatchObject({
            configured: true,
            source: 'environment',
            storedFallbackExists: true
        });
    });

    it('persists only ciphertext and can clear the stored fallback', () => {
        const { service, directory } = createService();
        service.storeKey('secret-plain-key');
        const credentialPath = path.join(directory, 'credentials.json');
        expect(fs.readFileSync(credentialPath, 'utf8')).not.toContain('secret-plain-key');
        expect(service.getApiKey()).toBe('secret-plain-key');

        service.clearStoredKey();
        expect(fs.existsSync(credentialPath)).toBe(false);
        expect(service.getStatus().configured).toBe(false);
    });

    it('deletes corrupted ciphertext and reports a recoverable storage error', () => {
        const { service, directory } = createService();
        fs.writeFileSync(
            path.join(directory, 'credentials.json'),
            JSON.stringify({ version: 1, openaiApiKey: Buffer.from('bad').toString('base64') })
        );
        expect(service.getApiKey()).toBeNull();
        expect(service.getStatus()).toMatchObject({ configured: false, source: 'none' });
        expect(service.getStatus().storageError).toContain('再入力');
        expect(fs.existsSync(path.join(directory, 'credentials.json'))).toBe(false);
    });

    it('uses memory only when safeStorage is unavailable', () => {
        const { service, storage, directory } = createService();
        storage.available = false;
        expect(service.storeKey('memory-key')).toMatchObject({ success: true, persisted: false });
        expect(service.getApiKey()).toBe('memory-key');
        expect(service.getStatus()).toMatchObject({ configured: true, source: 'memory' });
        expect(fs.existsSync(path.join(directory, 'credentials.json'))).toBe(false);
    });
});
