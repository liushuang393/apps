// testing-kit Quality Report - 性能最適化版
// - 並列 fetch (Promise.all)
// - 事前計算済 summary を使う
// - Intersection Observer で履歴・失敗を lazy 描画
// - 単一 RAF で bar アニメをバッチ
// - DocumentFragment で table 一括追加
(async function () {
  const [dataRes, histRes] = await Promise.all([
    fetch('./data.json').catch((e) => ({ error: e })),
    fetch('./history/index.json').catch(() => null),
  ]);
  if (!dataRes || dataRes.error || !dataRes.ok) {
    document.body.insertAdjacentHTML(
      'afterbegin',
      `<div style="background:#ef4444;color:white;padding:1rem;text-align:center;">
        data.json が読めません<br>file:// で開いている場合は <code>python -m http.server</code> 経由で
      </div>`,
    );
    return;
  }
  const data = await dataRes.json();
  const history = histRes && histRes.ok ? await histRes.json() : [];

  // デプロイ健全性バナー（check_deploy_health.py の deploy-status.json 由来）。
  // 「E2E は green でも本番コンテナが停止/不健全」という死角を最上部で常時可視化する。
  // data.deployment が無い（Docker 未収集）ときは何も出さない＝従来動作。
  (function renderDeploymentBanner() {
    const dep = data.deployment;
    if (!dep) return;
    const broken = (dep.unhealthy || 0) + (dep.down || 0);
    const bar = document.createElement('div');
    if (broken > 0) {
      bar.style.cssText =
        'background:#dc2626;color:#fff;padding:.6rem 1rem;text-align:center;font-weight:700;';
      bar.textContent =
        `⛔ デプロイ異常: 停止 ${dep.down || 0} / unhealthy ${dep.unhealthy || 0}` +
        `（全 ${dep.total} コンテナ中）— E2E が green でも本番は不稼働。` +
        `bash scripts/docker_up.sh --all で再発布`;
    } else {
      bar.style.cssText =
        'background:#065f46;color:#fff;padding:.4rem 1rem;text-align:center;font-weight:600;';
      bar.textContent =
        `✅ デプロイ健全: ${dep.healthy}/${dep.total} コンテナ healthy` +
        (dep.starting ? `（starting ${dep.starting}）` : '');
    }
    document.body.prepend(bar);
  })();

  // 鮮度バナー（2 段階）: preview-server (/api/freshness) 経由のときだけ有効。
  //   レベル 2: テスト定義が変更され診断自体が古い app あり → 該当 app の診断+レポート更新
  //   レベル 1: 診断は新しいがレポート(data.json)が未反映 → レポートのみ再生成
  // 画面を開いたままでも 30 秒間隔の polling で自動検知する（テスト並走中の追従）。
  // 静的配信 (python -m http.server / file://) では 404/失敗 → silent skip（polling も停止）。
  const FRESHNESS_POLL_MS = 30000;
  let freshnessBar = null;
  let refreshInProgress = false;

  function removeFreshnessBar() {
    if (freshnessBar) {
      freshnessBar.remove();
      freshnessBar = null;
    }
  }

  function showFreshnessBar(message, refreshUrl) {
    removeFreshnessBar();
    const bar = document.createElement('div');
    bar.style.cssText =
      'background:#f59e0b;color:#111;padding:.6rem 1rem;text-align:center;font-weight:600;';
    bar.textContent = message;
    const btn = document.createElement('button');
    btn.textContent = '最新の状態に更新';
    btn.style.cssText =
      'margin-left:.6rem;padding:.2rem .8rem;cursor:pointer;border-radius:4px;border:1px solid #92400e;';
    btn.onclick = async () => {
      refreshInProgress = true;
      btn.disabled = true;
      btn.textContent = '更新中...（数十秒かかることがあります）';
      try {
        const r = await fetch(refreshUrl, { method: 'POST' });
        if (r.ok) {
          location.reload();
          return;
        }
      } catch {
        /* fallthrough */
      }
      refreshInProgress = false;
      btn.textContent = '更新に失敗しました（サーバのログを確認してください）';
    };
    bar.appendChild(btn);
    document.body.prepend(bar);
    freshnessBar = bar;
  }

  async function checkFreshness() {
    if (refreshInProgress) return true; // 更新中はバナーを作り直さない
    let fresh;
    try {
      const r = await fetch('/api/freshness');
      if (!r.ok) return false; // 静的配信 → polling 停止
      fresh = await r.json();
    } catch {
      return false;
    }
    if (!fresh) return false;
    const staleApps = fresh.diag_stale_apps || [];
    if (!fresh.stale && staleApps.length === 0) {
      removeFreshnessBar(); // 他の人が更新済みなら警告を引っ込める
      return true;
    }
    let message;
    let refreshUrl;
    if (staleApps.length > 0) {
      const shown = staleApps.slice(0, 5).join(', ');
      const more = staleApps.length > 5 ? ` ほか ${staleApps.length - 5} 件` : '';
      message = `⚠ テスト定義が変更されたため、この画面の数字は古い可能性があります（対象: ${shown}${more}）`;
      refreshUrl =
        staleApps.length > 10
          ? '/api/refresh'
          : '/api/refresh?' + staleApps.map((a) => `app=${encodeURIComponent(a)}`).join('&');
    } else {
      message = `⚠ 新しい診断結果 (${fresh.newest_diagnostic}) がまだこの画面に反映されていません`;
      refreshUrl = '/api/refresh';
    }
    showFreshnessBar(message, refreshUrl);
    return true;
  }

  (async () => {
    if (await checkFreshness()) {
      setInterval(checkFreshness, FRESHNESS_POLL_MS);
    }
  })();

  const s = data.summary || {};
  document.getElementById('generated-at').textContent = data.generated_at || '—';

  // status pill: pass_rate に応じて色とラベル
  const pill = document.getElementById('status-pill');
  if (pill) {
    const r = s.pass_rate ?? 0;
    if (r >= 90) {
      pill.className = 'status-pill ok';
      pill.textContent = 'リリース可';
    } else if (r >= 70) {
      pill.className = 'status-pill warn';
      pill.textContent = '要改善 (70-90%)';
    } else {
      pill.className = 'status-pill ng';
      pill.textContent = '未達成 (<70%)';
    }
  }

  document.getElementById('kpi-total').textContent = s.total ?? data.apps.length;
  document.getElementById('kpi-pass').textContent = s.passed ?? 0;
  document.getElementById('kpi-fail').textContent = s.failed ?? 0;
  document.getElementById('kpi-rate').textContent = (s.pass_rate ?? 0).toFixed(0);

  const techBtn = document.getElementById('view-tech');
  const bizBtn = document.getElementById('view-business');
  let currentView = 'tech';
  function setView(v) {
    currentView = v;
    techBtn.classList.toggle('active', v === 'tech');
    bizBtn.classList.toggle('active', v === 'business');
    document.body.dataset.view = v;
    renderVerdict();
    renderHiddenBugs();
  }
  techBtn?.addEventListener('click', () => setView('tech'));
  bizBtn?.addEventListener('click', () => setView('business'));

  // Round 1/2 diff (DocumentFragment)
  const diffGrid = document.getElementById('round-comparison');
  const dgFrag = document.createDocumentFragment();
  if (!data.rounds || data.rounds.length < 2) {
    const c = document.createElement('div');
    c.className = 'diff-card';
    const round1Count = data.rounds && data.rounds[0] ? data.rounds[0].count : 0;
    c.innerHTML = `<div class="diff-app">Round 2 診断 未実行</div>
      <div class="diff-status">
        この比較は「同じ診断を 2 回実行して指標が一致するか（再現性 / 修正前後の差分）」を見るための手動 before/after 機能です。
        現在は Round 1 のみ（${round1Count} app）。Round 2 を生成するには次を実行してください:
        <br><code>conda run -n agentflow python testing-kit/scripts/bulk_run_diagnostics.py --round 2 --compare</code>
        <br>自動トリガーはありません。
      </div>`;
    dgFrag.appendChild(c);
  } else if ((data.round_diffs || []).length === 0) {
    const c = document.createElement('div');
    c.className = 'diff-card match';
    c.innerHTML = `<div class="diff-app">✓ 完全一致</div>
      <div class="diff-status">${s.total} app 全てで Round 1 / Round 2 一致 → 再現性 OK</div>`;
    dgFrag.appendChild(c);
  } else {
    data.round_diffs.forEach((d) => {
      const c = document.createElement('div');
      c.className = 'diff-card diff';
      const changes = d.changes
        .map((cc) => `<li><code>${cc.metric}</code>: ${cc.round1} → ${cc.round2}</li>`)
        .join('');
      c.innerHTML = `<div class="diff-app">${d.app}</div><ul class="diff-status">${changes}</ul>`;
      dgFrag.appendChild(c);
    });
  }
  diffGrid.innerHTML = '';
  diffGrid.appendChild(dgFrag);

  // verdict 三値表示: pass / conditional（AI 業務カバレッジ判定が未達） / fail。
  // coverage_gap_alert（matrix 自動化% − AI 業務カバレッジ% > 30pt）は乖離バッジを併記し、
  // 「matrix 緑 ≠ 業務保護」を首屏で見えるようにする（2026-07-04 sales_support 教訓）。
  function verdictBadge(a, passLabel, condLabel, failLabel) {
    const gap = a.coverage_gap_alert
      ? ` <span class="badge warn" title="matrix 自動化 ${a.automated_pct ?? '—'}% に対し AI 業務カバレッジ ${a.business_coverage_pct ?? '—'}%（乖離 30pt 超）">乖離</span>`
      : '';
    if (a.verdict === 'pass') return `<span class="badge ok">${passLabel}</span>${gap}`;
    if (a.verdict === 'conditional')
      return `<span class="badge warn" title="${a.verdict_reason || 'AI 業務カバレッジ判定が未達'}">${condLabel}</span>${gap}`;
    return `<span class="badge ng">${failLabel}</span>${gap}`;
  }

  function renderVerdict() {
    const tbody = document.querySelector('#verdict-table tbody');
    const thead = document.querySelector('#verdict-table thead tr');
    if (currentView === 'tech') {
      thead.innerHTML = `<th>app<br><small>アプリ</small></th><th title="テスト実行の接続方式">adapter<br><small>接続方式</small></th><th title="自動解析できた画面の数。API ファースト app は 0 でも routes 検出で解析成功扱い">screens<br><small>画面数</small></th><th title="テストが画面部品を見つける目印の数（カッコ内は網羅率）">testid<br><small>目印数</small></th><th title="目印のズレ＝壊れているテストの数。0 が正常">drift<br><small>目印ズレ</small></th><th title="最重要シナリオの自動化数 / 総数">P1<br><small>最重要自動化</small></th><th title="3 条件（解析成功=画面または API route 検出・目印健全・P1 定義済みなら 1 件以上自動化）を全部満たすと合格">判定</th>`;
    } else {
      thead.innerHTML = `<th>app<br><small>アプリ</small></th><th title="P1（最重要シナリオ）の多さから見た業務上の重要度">業務影響</th><th title="最重要シナリオのうち自動テストで守られている割合">P1 保護率</th><th title="仕様確認待ちで止まっているテストの数">blocked<br><small>保留中</small></th><th title="守られていない最重要シナリオ + 保留中の合計。0 が理想">未検出リスク</th><th>判定</th>`;
    }
    const frag = document.createDocumentFragment();
    data.apps.forEach((a) => {
      const tr = document.createElement('tr');
      if (currentView === 'tech') {
        tr.innerHTML = `
          <td><strong>${a.app}</strong></td>
          <td><span class="badge adapter">${a.adapter || '—'}</span></td>
          <td>${a.screens}</td>
          <td>${a.testid_count} <span style="color:#7681a2">(${(a.testid_ratio ?? 0).toFixed(0)}%)</span></td>
          <td class="${a.testid_broken === 0 ? 'pass' : 'fail'}">${a.testid_broken}</td>
          <td>${a.matrix_p1_automated}/${a.matrix_p1_total}</td>
          <td>${verdictBadge(a, '合格', '条件付き', '不合格')}</td>`;
      } else {
        const riskBadge =
          a.business_risk === 'high' ? 'ng' : a.business_risk === 'mid' ? 'warn' : 'ok';
        tr.innerHTML = `
          <td><strong>${a.app}</strong></td>
          <td><span class="badge ${riskBadge}">${a.business_risk_label || '—'}</span></td>
          <td>
            <div class="bar-track" style="display:inline-block;width:100px;vertical-align:middle">
              <div class="bar-fill" style="transform:scaleX(${(a.p1_protection_rate ?? 0) / 100});transform-origin:left"></div>
            </div>
            <span style="margin-left:0.5rem">${(a.p1_protection_rate ?? 0).toFixed(0)}%</span>
          </td>
          <td>${a.matrix_blocked}</td>
          <td class="${a.undetected_risk > 0 ? 'fail' : 'pass'}">${a.undetected_risk ?? 0}</td>
          <td>${verdictBadge(a, '業務保護', '条件付き', '要対応')}</td>`;
      }
      frag.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }
  renderVerdict();

  // === 業務カバレッジ（AI 判定）: matrix の数でなく「業務が守られているか」の判定 ===
  function renderJudgments() {
    const wrap = document.getElementById('judgment-table');
    if (!wrap) return;
    const judgments = data.judgments || [];
    if (!judgments.length) {
      wrap.innerHTML =
        '<div class="loading">判定なし — 業務フロー洗い出し工程（/af-e2e-flow）が未実施です</div>';
      return;
    }
    const esc = (s) =>
      String(s ?? '').replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[c],
      );
    const rows = judgments
      .map((j) => {
        const c = j.counts || {};
        const rc = j.realistic_correctness;
        const rcBadge =
          rc === 'ok'
            ? '<span class="verdict-badge pass">ok</span>'
            : `<span class="verdict-badge fail" title="現実の業務運用として懸念あり（詳細は notes）">${esc(rc)}</span>`;
        const missing = (j.missing_flows || [])
          .map((m) => `<li>[${esc(m.suggested_priority || 'P?')}] ${esc(m.desc)}</li>`)
          .join('');
        const detail = `
          <details>
            <summary>詳細（判定根拠・未洗い出しフロー）</summary>
            ${missing ? `<p><strong>未洗い出し業務フロー:</strong></p><ul>${missing}</ul>` : ''}
            ${j.notes ? `<p><strong>notes:</strong> ${esc(j.notes)}</p>` : ''}
            ${(j.scenarios || [])
              .map(
                (sc) =>
                  `<div class="bug-item"><code>${esc(sc.id)}</code> <span class="verdict-badge ${
                    sc.verdict === 'real' ? 'pass' : 'fail'
                  }">${esc(sc.verdict)}</span> ${esc(sc.note || '')}</div>`,
              )
              .join('')}
          </details>`;
        const staleBadge = j.stale
          ? ' <span class="verdict-badge fail" title="判定後に test-matrix.csv が更新された＝この判定は現状を保証しない。再判定（/af-e2e-flow）が必要">stale</span>'
          : '';
        return `<tr>
          <td>${esc(j.app)}</td>
          <td>${j.business_coverage_pct ?? '—'}%${staleBadge}</td>
          <td>${rcBadge}</td>
          <td>${c.real ?? 0} / ${c.placeholder ?? 0} / ${c.missing ?? 0}</td>
          <td>${esc((j.judged_at || '').slice(0, 16))}</td>
        </tr>
        <tr class="judgment-detail-row"><td colspan="5">${detail}</td></tr>`;
      })
      .join('');
    wrap.innerHTML = `<table>
      <thead><tr>
        <th>app<br><small>アプリ</small></th>
        <th title="AI が business-flow 正本と spec の assert を突き合わせた業務カバレッジ">業務カバレッジ</th>
        <th title="機能が現実の業務運用として合理的か（ok / concerns）">現実妥当性</th>
        <th title="real=業務を本当に検証 / placeholder=形だけの占位 / missing=洗い出し漏れ">real / 占位 / 未洗出</th>
        <th>判定日時</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }
  renderJudgments();

  function renderHiddenBugs() {
    const bugList = document.getElementById('hidden-bugs');
    const bugs = data.hidden_bugs || [];
    let filtered = bugs;
    if (currentView === 'business') {
      filtered = bugs.filter(
        (b) =>
          b.severity === 'security' ||
          b.severity === 'deploy' ||
          b.message.includes('blocked') ||
          b.message.includes('入力'),
      );
    }
    const frag = document.createDocumentFragment();
    if (filtered.length === 0) {
      const d = document.createElement('div');
      d.className = 'bug-item';
      d.textContent = '主要な欠落なし';
      frag.appendChild(d);
    } else {
      filtered.forEach((b) => {
        const item = document.createElement('div');
        item.className = `bug-item ${b.severity || 'warn'}`;
        item.innerHTML = `<span class="bug-app">${b.app}</span>: ${b.message}`;
        frag.appendChild(item);
      });
    }
    bugList.innerHTML = '';
    bugList.appendChild(frag);
  }
  renderHiddenBugs();

  // Adapter chart - 事前集計 + 単一 RAF + transform
  const adapterChart = document.getElementById('adapter-chart');
  const adapterDist = data.adapter_dist || [];
  const maxCount = Math.max(...adapterDist.map((d) => d.count), 1);
  const acFrag = document.createDocumentFragment();
  const bars = [];
  adapterDist.forEach((d) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-label">${d.adapter}</div>
      <div class="bar-track"><div class="bar-fill" style="transform:scaleX(0);transform-origin:left"></div></div>
      <div class="bar-value">${d.count}</div>`;
    acFrag.appendChild(row);
    bars.push({ row, pct: d.count / maxCount });
  });
  adapterChart.innerHTML = '';
  adapterChart.appendChild(acFrag);
  requestAnimationFrame(() => {
    bars.forEach(({ row, pct }) => {
      row.querySelector('.bar-fill').style.transform = `scaleX(${pct})`;
    });
  });

  // 即時描画: 失敗一覧・履歴は lazy にしない。
  // （未スクロール時や HTML/PDF エクスポート・スクリーンショットで
  //   「読み込み中…」のまま空になるのを防ぐ）
  const histSection = document.getElementById('history-section');
  if (histSection && history.length > 0) {
    histSection.style.display = 'block';
    renderHistory();
  }
  renderFailures();

  function renderHistory() {
    const ch = document.getElementById('history-chart');
    const recent = history.slice(-20);
    const frag = document.createDocumentFragment();
    const bs = [];
    recent.forEach((h) => {
      const bar = document.createElement('div');
      bar.className = 'history-bar';
      const ts = h.timestamp.replace('T', ' ').substring(5, 16);
      const p1Rate = h.p1_total ? (h.p1_automated / h.p1_total) * 100 : 0;
      bar.innerHTML = `
        <div class="hb-stack">
          <div class="hb-fill pass" style="height:0%" title="pass: ${h.pass_rate.toFixed(0)}%"></div>
          <div class="hb-fill p1" style="height:0%" title="P1: ${p1Rate.toFixed(0)}%"></div>
          <div class="hb-fill blocked" style="height:0%" title="blocked: ${h.blocked}"></div>
        </div>
        <div class="hb-label">${ts}</div>`;
      frag.appendChild(bar);
      bs.push({
        bar,
        pass: h.pass_rate,
        p1: p1Rate,
        blocked: Math.min(h.blocked * 10, 100),
      });
    });
    ch.innerHTML = '';
    ch.appendChild(frag);
    requestAnimationFrame(() => {
      bs.forEach(({ bar, pass, p1, blocked }) => {
        bar.querySelector('.hb-fill.pass').style.height = `${pass}%`;
        bar.querySelector('.hb-fill.p1').style.height = `${p1}%`;
        bar.querySelector('.hb-fill.blocked').style.height = `${blocked}%`;
      });
    });
  }

  function renderFailures() {
    const failed = data.apps.filter((a) => a.verdict === 'fail');
    const failPanel = document.getElementById('failure-details');
    const frag = document.createDocumentFragment();
    if (failed.length === 0) {
      const d = document.createElement('div');
      d.className = 'bug-item';
      d.textContent = '失敗 app なし';
      frag.appendChild(d);
    } else {
      failed.forEach((a) => {
        const card = document.createElement('div');
        card.className = 'fail-card';
        // /repo/ はプレビューサーバの読み取り専用ルート。
        // 旧 ../../../ 相対リンクは HTTP 配信では root 外に出られず常に 404 だった。
        const links = [];
        if (a.adapter)
          links.push(`<a href="/repo/testing-kit/adapters/${a.adapter}/">接続設定 (adapter)</a>`);
        if (a.target_dir) {
          links.push(`<a href="/repo/${a.target_dir}/docs/business-flows/">業務フロー定義</a>`);
          links.push(
            `<a href="/repo/${a.target_dir}/docs/test-matrix.csv">テスト一覧表 (matrix)</a>`,
          );
        }
        const reasons = [];
        if (a.screens === 0) reasons.push('⚠ 画面を自動解析できていない (screens=0)');
        if (a.testid_broken > 0)
          reasons.push(`🚨 テストの目印ズレ (drift) ${a.testid_broken} 件 — テストが壊れている`);
        if (a.matrix_p1_total > 0 && a.matrix_p1_automated === 0)
          reasons.push('⚠ 最重要 (P1) シナリオが 1 件も自動テスト化されていない');
        card.innerHTML = `
          <div class="fail-title">${a.app}</div>
          <div class="fail-reason">${reasons.join('<br>')}</div>
          <div class="fail-links">調査入口: ${links.join(' · ')}</div>`;
        frag.appendChild(card);
      });
    }
    failPanel.innerHTML = '';
    failPanel.appendChild(frag);
  }
})();

// ========== Action bar: エクスポート + 停止 ==========
(function setupActionBar() {
  const toast = document.getElementById('toast');
  function showToast(msg, kind) {
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast ' + (kind || '');
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  // ===== HTML エクスポート: 現在の DOM を 1 ファイルにまとめる =====
  async function exportHTML() {
    const btn = document.getElementById('btn-export-html');
    btn.disabled = true;
    btn.querySelector('span:last-child').textContent = '生成中…';
    try {
      const [cssText, jsText] = await Promise.all([
        fetch('./style.css').then((r) => r.text()),
        fetch('./report.js').then((r) => r.text()),
      ]);
      const dataObj = await fetch('./data.json').then((r) => r.json());
      let historyObj = [];
      try {
        const r = await fetch('./history/index.json');
        if (r.ok) historyObj = await r.json();
      } catch {}

      // inline 化: fetch を data inline に置換した小規模 wrapper
      const wrapper = `(function(){
        const __DATA__ = ${JSON.stringify(dataObj)};
        const __HISTORY__ = ${JSON.stringify(historyObj)};
        const origFetch = window.fetch;
        window.fetch = async function(url) {
          if (typeof url === 'string') {
            if (url.endsWith('data.json')) return new Response(JSON.stringify(__DATA__), {status:200});
            if (url.endsWith('index.json')) return new Response(JSON.stringify(__HISTORY__), {status:200});
            if (url.endsWith('style.css') || url.endsWith('report.js')) return new Response('', {status:404});
          }
          return origFetch(url);
        };
      })();\n${jsText}`;

      const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>testing-kit Quality Report (snapshot ${timestamp()})</title>
<style>${cssText}</style>
</head>
<body data-view="tech">
${document.querySelector('.bg-orbs').outerHTML}
${document.querySelector('.hero').outerHTML}
${document.querySelector('.container').outerHTML}
${document.getElementById('toast').outerHTML}
${document.querySelector('.footer').outerHTML}
<script>${wrapper}<\/script>
</body></html>`;

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quality-report-${timestamp()}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('✓ HTML 保存しました');
    } catch (e) {
      showToast('HTML 保存失敗: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.querySelector('span:last-child').textContent = 'HTML 保存';
    }
  }

  // ===== PDF エクスポート: サーバ側 chrome headless 優先、失敗時 window.print fallback =====
  async function exportPDF() {
    const btn = document.getElementById('btn-export-pdf');
    btn.disabled = true;
    btn.querySelector('span:last-child').textContent = '生成中…';
    const fname = `quality-report-${timestamp()}.pdf`;
    try {
      const r = await fetch(`/__export-pdf__?name=${encodeURIComponent(fname)}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`✓ ${fname} 保存しました`);
    } catch (e) {
      const msg = (e && e.message) || 'unknown';
      showToast(
        `サーバ PDF 失敗 (${msg})。印刷ダイアログにフォールバック → "PDF として保存" を選んでください`,
        'error',
      );
      console.error('[exportPDF] サーバ生成失敗', e);
      setTimeout(() => window.print(), 800);
    } finally {
      btn.disabled = false;
      btn.querySelector('span:last-child').textContent = 'PDF 保存';
    }
  }

  // ===== 停止 + ページクローズ (非同期) =====
  async function shutdown() {
    const btn = document.getElementById('btn-shutdown');
    btn.disabled = true;
    btn.querySelector('span:last-child').textContent = '停止中…';
    try {
      // 非同期 fetch でサーバ shutdown
      await fetch('/__shutdown__', { method: 'POST', mode: 'no-cors' }).catch(() => null);
      showToast('サーバ停止しました');
      setTimeout(() => {
        try {
          window.close();
        } catch {}
        // window.close できない場合のフォールバック
        document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;color:#aab2c8;font-family:sans-serif">
          <h1 style="font-size:3rem;margin-bottom:1rem">🛑</h1>
          <h2>サーバ停止しました</h2>
          <p>このタブは手動で閉じてください</p>
        </div>`;
      }, 800);
    } catch (e) {
      showToast('停止失敗: ' + e.message, 'error');
      btn.disabled = false;
      btn.querySelector('span:last-child').textContent = '停止・閉じる';
    }
  }

  document.getElementById('btn-export-html')?.addEventListener('click', exportHTML);
  document.getElementById('btn-export-pdf')?.addEventListener('click', exportPDF);
  document.getElementById('btn-shutdown')?.addEventListener('click', () => {
    if (confirm('サーバを停止して、このページを閉じます。よろしいですか？')) shutdown();
  });
})();

// ========== テスト完了通知 (Web Notifications + 音) ==========
(function setupCompletionNotify() {
  // タブが visible でない間 (長時間放置) に「完了」通知を出す
  if (typeof Notification === 'undefined') return;

  let wasHidden = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) wasHidden = true;
  });

  async function notifyComplete() {
    if (!wasHidden) return; // タブが見えていたなら通知不要
    if (Notification.permission === 'granted') {
      new Notification('✅ testing-kit レポート読み込み完了', {
        body: 'Quality Report の生成と読み込みが完了しました',
        silent: false,
      });
      // 音 (Web Audio API で beep)
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.frequency.value = 880;
        g.gain.value = 0.05;
        o.start();
        o.stop(ctx.currentTime + 0.2);
      } catch {}
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }

  // データ読み込み完了 (data.json が読まれた直後を擬似的に検知)
  // 「report が完全に DOM へ反映された」タイミング = window.load 後
  if (document.readyState === 'complete') {
    setTimeout(notifyComplete, 100);
  } else {
    window.addEventListener('load', () => setTimeout(notifyComplete, 100));
  }

  // 「通知を許可」ボタンを action bar に追加
  const bar = document.getElementById('action-bar');
  if (bar && Notification.permission === 'default') {
    const btn = document.createElement('button');
    btn.className = 'action-btn export';
    btn.innerHTML = '<span class="action-icon">🔔</span><span>通知を許可</span>';
    btn.onclick = () => {
      Notification.requestPermission().then((p) => {
        if (p === 'granted') {
          btn.remove();
          new Notification('通知を有効化しました', {
            body: '今後、レポート生成完了時に通知します',
          });
        }
      });
    };
    bar.insertBefore(btn, bar.firstChild);
  }
})();
