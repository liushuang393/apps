// 無料モード/有料モードの表示切り替え（CSP 準拠のため外部ファイル化）
// URLパラメータから無料モードかどうかを判定
const urlParams = new URLSearchParams(globalThis.location.search);
const isFreeMode = urlParams.get('mode') === 'free';

if (isFreeMode) {
    // 無料モードの場合、表示を変更
    document.getElementById('pageTitle').textContent = '無料モードで開始！';
    document.getElementById('pageSubtitle').textContent =
        'VoiceTranslate Pro を無料でお試しください';
    document.getElementById('planName').textContent = '無料プラン';

    // 料金と請求日の項目を非表示
    document.getElementById('priceItem').style.display = 'none';
    document.getElementById('billingItem').style.display = 'none';
    document.getElementById('trialItem').style.display = 'none';
} else {
    // 有料モードの場合、次回請求日を計算（7日後）
    const nextBillingDate = new Date();
    nextBillingDate.setDate(nextBillingDate.getDate() + 7);
    document.getElementById('nextBillingDate').textContent = nextBillingDate.toLocaleDateString(
        'ja-JP',
        {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }
    );
}
