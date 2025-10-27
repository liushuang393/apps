/**
 * Teams 音声キャプチャ診断スクリプト
 * 
 * 使用方法:
 * 1. Electron アプリを起動
 * 2. 開発者ツール (F12) を開く
 * 3. コンソールで以下を実行:
 *    await import('./teams-audio-diagnostic.js').then(m => m.runDiagnostics())
 */

async function runDiagnostics() {
    console.log('🔍 Teams 音声キャプチャ診断を開始します...\n');
    
    // ステップ 1: Electron API の確認
    console.log('📋 ステップ 1: Electron API の確認');
    if (!window.electronAPI) {
        console.error('❌ Electron API が利用できません');
        return;
    }
    console.log('✅ Electron API が利用可能です\n');
    
    // ステップ 2: Teams ウィンドウの検出
    console.log('📋 ステップ 2: Teams ウィンドウの検出');
    try {
        const apps = await window.electronAPI.detectMeetingApps();
        console.log(`✅ ${apps.length} 個のアプリを検出しました:`);
        apps.forEach((app, index) => {
            const isMeeting = app.name.toLowerCase().includes('teams') ||
                            app.name.toLowerCase().includes('zoom') ||
                            app.name.toLowerCase().includes('meet');
            const icon = isMeeting ? '🎤' : '🌐';
            console.log(`  [${index + 1}] ${icon} ${app.name} (ID: ${app.id})`);
        });
        
        const teamsApp = apps.find(app => app.name.toLowerCase().includes('teams'));
        if (!teamsApp) {
            console.warn('⚠️  Teams が検出されませんでした');
            console.log('💡 Teams を起動してから再度試してください\n');
            return;
        }
        console.log(`✅ Teams を検出しました: ${teamsApp.name}\n`);
        
        // ステップ 3: 音声トラックの確認
        console.log('📋 ステップ 3: 音声トラックの確認');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: teamsApp.id
                    }
                },
                video: false
            });
            
            const audioTracks = stream.getAudioTracks();
            console.log(`✅ ストリームを取得しました`);
            console.log(`   音声トラック数: ${audioTracks.length}`);
            
            if (audioTracks.length > 0) {
                console.log(`✅ 音声トラックが検出されました:`);
                audioTracks.forEach((track, index) => {
                    console.log(`   [${index + 1}] ${track.label}`);
                    console.log(`       - 有効: ${track.enabled}`);
                    console.log(`       - 状態: ${track.readyState}`);
                });
            } else {
                console.warn('⚠️  音声トラックが見つかりません');
                console.log('💡 Teams で音声を再生してから再度試してください\n');
            }
            
            // ステップ 4: 音声レベルの確認
            console.log('\n📋 ステップ 4: 音声レベルの確認');
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            let maxLevel = 0;
            
            console.log('🔊 3秒間の音声レベルを測定中...');
            const startTime = Date.now();
            const interval = setInterval(() => {
                analyser.getByteFrequencyData(dataArray);
                const level = Math.max(...dataArray);
                maxLevel = Math.max(maxLevel, level);
                
                if (Date.now() - startTime > 3000) {
                    clearInterval(interval);
                    console.log(`✅ 測定完了`);
                    console.log(`   最大レベル: ${maxLevel} / 255`);
                    
                    if (maxLevel > 50) {
                        console.log('✅ 音声が検出されました！');
                    } else {
                        console.warn('⚠️  音声レベルが低いです');
                        console.log('💡 Teams で音量を上げてから再度試してください');
                    }
                    
                    // クリーンアップ
                    stream.getTracks().forEach(track => track.stop());
                    source.disconnect();
                    audioContext.close();
                    
                    // 診断完了
                    console.log('\n✅ 診断完了！');
                    console.log('💡 問題が解決しない場合は、以下を確認してください:');
                    console.log('   1. Teams が起動しているか');
                    console.log('   2. Teams で音声が再生されているか');
                    console.log('   3. Electron アプリが管理者権限で実行されているか');
                }
            }, 100);
            
        } catch (error) {
            console.error('❌ 音声キャプチャに失敗しました:', error.message);
            console.log('💡 以下を確認してください:');
            console.log('   1. Teams が起動しているか');
            console.log('   2. Electron アプリが管理者権限で実行されているか');
            console.log('   3. OS のマイク権限が許可されているか');
        }
        
    } catch (error) {
        console.error('❌ Teams 検出に失敗しました:', error.message);
    }
}

// エクスポート
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runDiagnostics };
}

