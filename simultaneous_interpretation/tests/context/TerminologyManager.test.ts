/**
 * TerminologyManager ユニットテスト
 */

import { TerminologyManager } from '../../src/context/TerminologyManager';

describe('TerminologyManager', () => {
    let manager: TerminologyManager;

    beforeEach(() => {
        manager = new TerminologyManager();
        // LocalStorageのモック
        global.localStorage = {
            getItem: jest.fn(),
            setItem: jest.fn(),
            removeItem: jest.fn(),
            clear: jest.fn(),
            length: 0,
            key: jest.fn()
        } as any;
    });

    describe('addUserTerm', () => {
        it('should add user term', () => {
            manager.addUserTerm({
                source: 'AI',
                target: '人工知能',
                domain: 'IT',
                priority: 10,
                createdAt: Date.now()
            });

            const term = manager.getUserTerm('AI');
            expect(term).toBeDefined();
            expect(term?.target).toBe('人工知能');
            expect(term?.priority).toBe(10);
        });

        it('should update lastUsedAt', () => {
            const now = Date.now();
            manager.addUserTerm({
                source: 'API',
                target: 'アプリケーションプログラミングインターフェース',
                domain: 'IT',
                priority: 8,
                createdAt: now
            });

            const term = manager.getUserTerm('API');
            expect(term?.lastUsedAt).toBeDefined();
            expect(term?.lastUsedAt).toBeGreaterThanOrEqual(now);
        });
    });

    describe('removeUserTerm', () => {
        it('should remove user term', () => {
            manager.addUserTerm({
                source: 'Test',
                target: 'テスト',
                domain: 'general',
                priority: 5,
                createdAt: Date.now()
            });

            expect(manager.getUserTerm('Test')).toBeDefined();

            const removed = manager.removeUserTerm('Test');
            expect(removed).toBe(true);
            expect(manager.getUserTerm('Test')).toBeUndefined();
        });

        it('should return false for non-existent term', () => {
            const removed = manager.removeUserTerm('NonExistent');
            expect(removed).toBe(false);
        });
    });

    describe('getAllUserTerms', () => {
        it('should return all user terms', () => {
            manager.addUserTerm({
                source: 'Term1',
                target: '用語1',
                domain: 'general',
                priority: 5,
                createdAt: Date.now()
            });

            manager.addUserTerm({
                source: 'Term2',
                target: '用語2',
                domain: 'IT',
                priority: 7,
                createdAt: Date.now()
            });

            const terms = manager.getAllUserTerms();
            expect(terms).toHaveLength(2);
        });

        it('should return empty array when no terms', () => {
            const terms = manager.getAllUserTerms();
            expect(terms).toHaveLength(0);
        });
    });

    describe('loadDomainDict', () => {
        it('should load domain dictionary', () => {
            const dict = new Map([
                ['computer', 'コンピュータ'],
                ['software', 'ソフトウェア']
            ]);

            manager.loadDomainDict('IT', dict);

            // ドメイン辞書がロードされたことを確認
            // (内部状態の確認は難しいため、Instructions生成でテスト)
            const instructions = manager.generateInstructions({
                sourceLang: 'en',
                targetLang: 'ja',
                domain: 'IT'
            });

            expect(instructions).toContain('computer');
            expect(instructions).toContain('コンピュータ');
        });
    });

    describe('generateInstructions', () => {
        it('should generate basic instructions', () => {
            const instructions = manager.generateInstructions({
                sourceLang: 'en',
                targetLang: 'ja'
            });

            expect(instructions).toContain('enからjaへの同時通訳者');
        });

        it('should include user terms', () => {
            manager.addUserTerm({
                source: 'AI',
                target: '人工知能',
                domain: 'IT',
                priority: 10,
                createdAt: Date.now()
            });

            const instructions = manager.generateInstructions({
                sourceLang: 'en',
                targetLang: 'ja'
            });

            expect(instructions).toContain('AI');
            expect(instructions).toContain('人工知能');
            expect(instructions).toContain('必須術語');
        });

        it('should apply style formal', () => {
            const instructions = manager.generateInstructions({
                sourceLang: 'en',
                targetLang: 'ja',
                style: 'formal'
            });

            expect(instructions).toContain('丁寧');
        });

        it('should apply style casual', () => {
            const instructions = manager.generateInstructions({
                sourceLang: 'en',
                targetLang: 'ja',
                style: 'casual'
            });

            expect(instructions).toContain('カジュアル');
        });

        it('should include custom instructions', () => {
            const instructions = manager.generateInstructions({
                sourceLang: 'en',
                targetLang: 'ja',
                customInstructions: 'ビジネス用語を使用してください'
            });

            expect(instructions).toContain('ビジネス用語を使用してください');
        });

        it('should sort terms by priority', () => {
            manager.addUserTerm({
                source: 'Low',
                target: '低優先度',
                domain: 'general',
                priority: 1,
                createdAt: Date.now()
            });

            manager.addUserTerm({
                source: 'High',
                target: '高優先度',
                domain: 'general',
                priority: 10,
                createdAt: Date.now()
            });

            const instructions = manager.generateInstructions({
                sourceLang: 'en',
                targetLang: 'ja'
            });

            const highIndex = instructions.indexOf('High');
            const lowIndex = instructions.indexOf('Low');

            // 高優先度が先に出現
            expect(highIndex).toBeLessThan(lowIndex);
        });
    });

    describe('saveToLocalStorage', () => {
        it('should save to localStorage', () => {
            manager.addUserTerm({
                source: 'Test',
                target: 'テスト',
                domain: 'general',
                priority: 5,
                createdAt: Date.now()
            });

            manager.saveToLocalStorage();

            expect(localStorage.setItem).toHaveBeenCalledWith(
                'voicetranslate_user_dict',
                expect.any(String)
            );
        });
    });

    describe('loadFromLocalStorage', () => {
        it('should load from localStorage', () => {
            const testData = [
                ['Test', {
                    source: 'Test',
                    target: 'テスト',
                    domain: 'general',
                    priority: 5,
                    createdAt: Date.now()
                }]
            ];

            (localStorage.getItem as jest.Mock).mockReturnValue(JSON.stringify(testData));

            const count = manager.loadFromLocalStorage();

            expect(count).toBe(1);
            expect(manager.getUserTerm('Test')).toBeDefined();
        });

        it('should return 0 when no data', () => {
            (localStorage.getItem as jest.Mock).mockReturnValue(null);

            const count = manager.loadFromLocalStorage();
            expect(count).toBe(0);
        });

        it('should handle parse error', () => {
            (localStorage.getItem as jest.Mock).mockReturnValue('invalid json');
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            const count = manager.loadFromLocalStorage();

            expect(count).toBe(0);
            expect(consoleErrorSpy).toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });
    });

    describe('clearUserDict', () => {
        it('should clear all user terms', () => {
            manager.addUserTerm({
                source: 'Test',
                target: 'テスト',
                domain: 'general',
                priority: 5,
                createdAt: Date.now()
            });

            manager.clearUserDict();

            expect(manager.getAllUserTerms()).toHaveLength(0);
        });
    });

    describe('clearDomainDict', () => {
        it('should clear specific domain', () => {
            const dict1 = new Map([['term1', '用語1']]);
            const dict2 = new Map([['term2', '用語2']]);

            manager.loadDomainDict('IT', dict1);
            manager.loadDomainDict('medical', dict2);

            manager.clearDomainDict('IT');

            // IT辞書がクリアされたことを確認
            const instructions = manager.generateInstructions({
                sourceLang: 'en',
                targetLang: 'ja',
                domain: 'IT'
            });

            expect(instructions).not.toContain('term1');
        });

        it('should clear all domains when no parameter', () => {
            const dict = new Map([['term', '用語']]);
            manager.loadDomainDict('IT', dict);

            manager.clearDomainDict();

            // すべての辞書がクリアされた
            const instructions = manager.generateInstructions({
                sourceLang: 'en',
                targetLang: 'ja',
                domain: 'IT'
            });

            expect(instructions).not.toContain('term');
        });
    });
});


