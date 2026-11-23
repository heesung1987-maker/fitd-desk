import { getChartTheme } from './chart-utils.js?v=11';

let v35Data = null;
let portfolioMode = 'STANDALONE'; // 'STANDALONE' | 'COMBO'
let sectionTab = 'ALL'; // 'ALL' | 'FORMULA' | 'RULES' | 'MONTHLY' | 'TRADES'
let yearFilter = 'ALL'; // 'ALL' | '2022' | '2023' | '2024' | '2025' | '2026'
let monthFilter = 'ALL'; // 'ALL' | 'BIG_WIN' | 'LOSS' | 'LOSS20K' | 'ZERO_ENTRY'

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

const fmtNum = (v, d = 0) =>
  v == null || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });

const fmtUsd = (v, signed = true) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const val = Math.abs(Number(v)) < 0.5 ? 0 : Number(v);
  if (!signed) return '$' + fmtNum(Math.abs(val), 0);
  return (val < 0 ? '−$' : val > 0 ? '+$' : '$') + fmtNum(Math.abs(val), 0);
};

const clsPnl = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) < 0.5) return 'muted';
  return n > 0 ? 'green' : 'red';
};

const REGIME_META = {
  L3_Crisis: { label: 'L3 추세확장', bg: 'rgba(220,38,38,0.12)', fg: '#dc2626' },
  L2_Boost: { label: 'L2 가속동조', bg: 'rgba(234,88,12,0.12)', fg: '#ea580c' },
  L2_Trend: { label: 'L2 추세형성', bg: 'rgba(217,119,6,0.12)', fg: '#d97706' },
  IsoTrend: { label: '고립추세', bg: 'rgba(37,99,235,0.12)', fg: '#2563eb' },
  Box: { label: '박스권', bg: 'rgba(13,148,136,0.12)', fg: '#0d9488' },
  DeadZone: { label: '저변동휴식', bg: 'rgba(100,116,139,0.14)', fg: '#64748b' },
  L2_Fatigue: { label: 'L2 피로잠금', bg: 'rgba(124,58,237,0.12)', fg: '#7c3aed' },
  L3_Fatigue: { label: 'L3 피로잠금', bg: 'rgba(147,51,234,0.12)', fg: '#9333ea' },
};

function regimeBadge(code) {
  const m = REGIME_META[code] || { label: code, bg: 'rgba(100,116,139,0.12)', fg: '#64748b' };
  return `<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;background:${m.bg};color:${m.fg};white-space:nowrap;">${esc(m.label)}</span>`;
}

async function loadV35Data() {
  if (v35Data) return v35Data;
  const res = await fetch('./data/momentum-v35-report.json?v=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('모멘텀 v3.5 리포트 데이터(./data/momentum-v35-report.json)를 불러오지 못했습니다.');
  }
  v35Data = await res.json();
  return v35Data;
}

function downloadCsv(filename, rows) {
  const text =
    '\ufeff' +
    rows
      .map((r) => r.map((v) => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(','))
      .join('\r\n');
  const u = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = u;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(u);
}

function renderEquitySvg(rows, mode) {
  const ct = getChartTheme();
  const ink = ct.ink || '#0f172a';
  if (!rows.length) return '<div class="empty">표시할 기간 데이터가 없습니다.</div>';

  const isCombo = mode === 'COMBO';
  const kMain = isCombo ? 'combo_cum' : 'mom_cum';
  const kMid = isCombo ? 'combo_def12_cum' : 'mom_def1_cum';
  const kBase = isCombo ? 'combo_base_cum' : 'mom_base_cum';
  const mMain = isCombo ? 'combo_v35' : 'mom_v35';
  const mMid = isCombo ? 'combo_def12' : 'mom_def1';
  const mBase = isCombo ? 'combo_base' : 'mom_base';

  const offMain = rows[0][kMain] - rows[0][mMain];
  const offMid = rows[0][kMid] - rows[0][mMid];
  const offBase = rows[0][kBase] - rows[0][mBase];

  const pts = rows.map((r) => ({
    ym: r.ym,
    v2: r.v2_avg,
    regime: r.regime,
    newTrades: r.new_trades,
    main: r[kMain] - offMain,
    mid: r[kMid] - offMid,
    base: r[kBase] - offBase,
    mMain: r[mMain],
    mMid: r[mMid],
    mBase: r[mBase],
    mFx: r.fx45_def,
  }));

  const allVals = pts.flatMap((p) => [0, p.main, p.mid, p.base]);
  const lo = Math.min(0, ...allVals);
  const hi = Math.max(100000, ...allVals);
  const w = 1040,
    h = 290,
    padL = 80,
    padR = 26,
    padT = 40,
    padB = 34;

  const x = (i) => padL + (i * (w - padL - padR)) / Math.max(1, pts.length - 1);
  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const line = (key) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');

  const ticks = [lo, lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.75, hi];
  const last = pts.at(-1);

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="모멘텀 v3.5 59개월 누적 손익 곡선">
    <g transform="translate(${padL}, 18)" style="font-size:12px;font-weight:700;fill:${ink};">
      <line x1="0" y1="-4" x2="22" y2="-4" stroke="#0d9488" stroke-width="3.2"/>
      <text x="28" y="0" fill="${ink}">${isCombo ? '★ 통합 (모멘텀 v3.5 + FX45 방어②)' : '★ 모멘텀 v3.5 확정 (단독)'}: ${fmtUsd(last?.main)}</text>
      <line x1="365" y1="-4" x2="387" y2="-4" stroke="#6366f1" stroke-width="2.1" stroke-dasharray="5 3"/>
      <text x="393" y="0" fill="${ink}">${isCombo ? '기존 v2.0 방어①·② 통합' : '기존 + 구 방어①'}: ${fmtUsd(last?.mid)}</text>
      <line x1="655" y1="-4" x2="677" y2="-4" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="2 3"/>
      <text x="683" y="0" fill="${ink}">${isCombo ? '방어 전 통합' : '기존 기본(R1_V2_CONC)'}: ${fmtUsd(last?.base)}</text>
    </g>

    ${ticks
      .map(
        (tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${ct.grid}" stroke-dasharray="3 3"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${ink}" font-size="11" font-weight="600">$${fmtNum(tv / 1000, 0)}k</text>
    `
      )
      .join('')}

    <line x1="${padL}" x2="${w - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="${ct.zero}" stroke-width="1.2"/>

    <path d="${line('base')}" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="2 3"/>
    <path d="${line('mid')}" fill="none" stroke="#6366f1" stroke-width="2.1" stroke-dasharray="5 3"/>
    <path d="${line('main')}" fill="none" stroke="#0d9488" stroke-width="3.2"/>

    ${pts
      .map(
        (p, i) => `
      <circle cx="${x(i).toFixed(1)}" cy="${y(p.main).toFixed(1)}" r="4.2" fill="#0d9488" opacity="0.85">
        <title>[${p.ym}] v2.0=${p.v2}점 · ${p.regime} · 신규진입 ${p.newTrades}건
★ ${isCombo ? '통합 v3.5+FX45' : '모멘텀 v3.5'} 누적: ${fmtUsd(p.main)} (당월 ${fmtUsd(p.mMain)})
• ${isCombo ? '기존 방어 통합' : '구 방어①'} 누적: ${fmtUsd(p.mid)} (당월 ${fmtUsd(p.mMid)})
• ${isCombo ? '방어 전 통합' : '기존 기본'} 누적: ${fmtUsd(p.base)} (당월 ${fmtUsd(p.mBase)})${isCombo ? `\n• FX45 방어② 당월: ${fmtUsd(p.mFx)}` : ''}</title>
      </circle>
    `
      )
      .join('')}

    ${pts
      .filter((p, i) => i === 0 || p.ym.endsWith('-01') || i === pts.length - 1)
      .map((p) => {
        const idx = pts.indexOf(p);
        return `<text x="${x(idx).toFixed(1)}" y="${h - 8}" text-anchor="${idx === pts.length - 1 ? 'end' : idx === 0 ? 'start' : 'middle'}" fill="${ink}" font-size="11" font-weight="600">${p.ym}</text>`;
      })
      .join('')}
  </svg>`;
}

function renderMonthlyBarSvg(rows, mode) {
  const ct = getChartTheme();
  const ink = ct.ink || '#0f172a';
  if (!rows.length) return '';

  const isCombo = mode === 'COMBO';
  const kVal = isCombo ? 'combo_v35' : 'mom_v35';
  const kRef = isCombo ? 'combo_base' : 'mom_base';

  const allVals = rows.flatMap((r) => [r[kVal], r[kRef], 0]);
  const lo = Math.min(-50000, ...allVals);
  const hi = Math.max(120000, ...allVals);
  const w = 1040,
    h = 260,
    padL = 80,
    padR = 24,
    padT = 36,
    padB = 34;

  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const y0 = y(0);
  const slotW = (w - padL - padR) / Math.max(1, rows.length);
  const barW = Math.max(3, Math.min(10, slotW * 0.62));

  const ticks = [-100000, -50000, -20000, 0, 50000, 100000, 200000, 250000].filter(
    (v) => v >= lo - 8000 && v <= hi + 8000
  );

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="모멘텀 v3.5 월별 손익 막대 차트">
    <g transform="translate(${padL}, 18)" style="font-size:12px;font-weight:700;fill:${ink};">
      <rect x="0" y="-11" width="12" height="10" fill="#0d9488" rx="2"/>
      <text x="18" y="-2" fill="${ink}">${isCombo ? '통합 v3.5+FX45 흑자월' : '모멘텀 v3.5 흑자월'}</text>
      <rect x="195" y="-11" width="12" height="10" fill="#e11d48" rx="2"/>
      <text x="213" y="-2" fill="${ink}">적자월 (점선: −$20k 관리 기준)</text>
      <circle cx="432" cy="-6" r="4" fill="#f59e0b"/>
      <text x="442" y="-2" fill="${ink}">상단 숫자: 해당 월 신규 진입 건수 (월평균 1.44건)</text>
    </g>

    ${ticks
      .map(
        (tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${tv === 0 ? ct.zero : tv === -20000 ? '#f43f5e' : ct.grid}" stroke-width="${tv === 0 ? '1.3' : '1'}" stroke-dasharray="${tv === 0 ? 'none' : '3 3'}" opacity="${tv === -20000 ? '0.65' : '1'}"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${tv === -20000 ? '#e11d48' : ink}" font-size="11" font-weight="600">${tv === 0 ? '$0' : (tv > 0 ? '+$' : '−$') + fmtNum(Math.abs(tv) / 1000, 0) + 'k'}</text>
    `
      )
      .join('')}

    ${rows
      .map((r, i) => {
        const cx = padL + (i + 0.5) * slotW;
        const val = r[kVal];
        const yTop = Math.min(y0, y(val));
        const bH = Math.max(1.8, Math.abs(y(val) - y0));
        const col = val >= 0 ? '#0d9488' : '#e11d48';
        return `<g>
          <rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" fill="${col}" rx="1.5"/>
          ${
            rows.length <= 24 || r.new_trades >= 3
              ? `<text x="${cx.toFixed(1)}" y="${(yTop - 4).toFixed(1)}" text-anchor="middle" fill="#d97706" font-size="9.5" font-weight="700">${r.new_trades}</text>`
              : ''
          }
          <rect x="${(cx - slotW / 2).toFixed(1)}" y="${padT}" width="${slotW.toFixed(1)}" height="${h - padT - padB}" fill="transparent">
            <title>[${r.ym}] v2.0=${r.v2_avg}점 · ${r.regime}
• 모멘텀 v3.5 단독: ${fmtUsd(r.mom_v35)} (누적 ${fmtUsd(r.mom_cum)})
• FX45 방어②: ${fmtUsd(r.fx45_def)}
• 통합 (v3.5+FX45): ${fmtUsd(r.combo_v35)} (누적 ${fmtUsd(r.combo_cum)})
• 신규 진입: ${r.new_trades}건 (${r.entries_desc}) / 보유 ${r.active_trades}건</title>
          </rect>
        </g>`;
      })
      .join('')}

    ${rows
      .filter((r, i) => i === 0 || r.ym.endsWith('-01') || i === rows.length - 1)
      .map((r) => {
        const idx = rows.indexOf(r);
        const cx = padL + (idx + 0.5) * slotW;
        return `<text x="${cx.toFixed(1)}" y="${h - 8}" text-anchor="middle" fill="${ink}" font-size="11" font-weight="600">${r.ym}</text>`;
      })
      .join('')}
  </svg>`;
}

function renderDistBar(buckets) {
  const items = [
    { lbl: '≥ +$50k', n: buckets.ge_50k, col: '#0f766e' },
    { lbl: '+$10k~50k', n: buckets.p10_50k, col: '#14b8a6' },
    { lbl: '$0~+$10k', n: buckets.p0_10k, col: '#5eead4' },
    { lbl: '−$10k~$0', n: buckets.m10_0, col: '#fda4af' },
    { lbl: '−$20k~−$10k', n: buckets.m20_m10, col: '#fb7185' },
    { lbl: '≤ −$20k', n: buckets.le_m20k, col: '#e11d48' },
  ];
  const tot = Math.max(1, items.reduce((a, b) => a + b.n, 0));
  return `
    <div style="display:flex;height:22px;border-radius:8px;overflow:hidden;gap:2px;margin:8px 0 10px;">
      ${items
        .filter((it) => it.n > 0)
        .map(
          (it) =>
            `<div style="flex:${it.n};background:${it.col};display:flex;align-items:center;justify-content:center;color:${
              it.lbl === '$0~+$10k' || it.lbl === '−$10k~$0' ? '#0f172a' : '#fff'
            };font-size:11px;font-weight:700;" title="${it.lbl}: ${it.n}개월 (${((it.n / tot) * 100).toFixed(1)}%)">${it.n}</div>`
        )
        .join('')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:11.5px;">
      ${items
        .map(
          (it) =>
            `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:2px;background:${it.col};display:inline-block;"></span>${it.lbl}: <strong>${it.n}개월</strong></span>`
        )
        .join('')}
    </div>
  `;
}

export async function renderMomentumV35(target) {
  target.innerHTML = `<div class="panel"><p class="muted">모멘텀 v3.5 A-to-Z 기술 백서 및 59개월 월간 손익·거래건수 데이터를 불러오는 중입니다...</p></div>`;

  let data;
  try {
    data = await loadV35Data();
  } catch (e) {
    target.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`;
    return;
  }

  const hl = data.headline;
  const activePerf = portfolioMode === 'COMBO' ? hl.combo : hl.standalone;
  const strictPerf = portfolioMode === 'COMBO' ? hl.combo_strict : hl.standalone_strict;
  const allMonths = data.monthly_rows || [];
  const chartMonths = allMonths.filter((m) => yearFilter === 'ALL' || m.year === yearFilter);

  const tableMonths = allMonths.filter((m) => {
    if (yearFilter !== 'ALL' && m.year !== yearFilter) return false;
    const v = portfolioMode === 'COMBO' ? m.combo_v35 : m.mom_v35;
    if (monthFilter === 'BIG_WIN') return v >= 50000;
    if (monthFilter === 'LOSS') return v < 0;
    if (monthFilter === 'LOSS20K') return v <= -20000;
    if (monthFilter === 'ZERO_ENTRY') return m.new_trades === 0;
    return true;
  });

  const showFormula = sectionTab === 'ALL' || sectionTab === 'FORMULA';
  const showRules = sectionTab === 'ALL' || sectionTab === 'RULES';
  const showMonthly = sectionTab === 'ALL' || sectionTab === 'MONTHLY';
  const showTrades = sectionTab === 'ALL' || sectionTab === 'TRADES';

  const lv2 = data.latest_v2_snapshot || {};
  const v2Info = lv2.v2 || {};

  // Table subtotal for filtered rows
  const sumNewT = tableMonths.reduce((a, r) => a + r.new_trades, 0);
  const sumMom = tableMonths.reduce((a, r) => a + r.mom_v35, 0);
  const sumFx = tableMonths.reduce((a, r) => a + r.fx45_def, 0);
  const sumCombo = tableMonths.reduce((a, r) => a + r.combo_v35, 0);

  target.innerHTML = `
    <!-- ===================================================================== -->
    <!-- HERO HEADER & TOP CONTROLS                                            -->
    <!-- ===================================================================== -->
    <div class="panel" style="border-left:4px solid #0d9488;">
      <div class="panel-head" style="flex-wrap:wrap;gap:12px;">
        <div>
          <div class="eyebrow">MOMENTUM v3.5 MASTER SPECIFICATION · CAUSAL BACKTEST (2022-01 ~ 2026-11 · 59 MONTHS)</div>
          <h2 style="margin:4px 0 6px;">🚀 모멘텀 v3.5 A-to-Z 아키텍처 &amp; 59개월 월간 손익·거래건수 연구 리포트</h2>
          <p class="muted" style="margin:0;font-size:12.5px;line-height:1.55;">
            FX 스트레스 지수 v2.0(3-Pillar) + 방향 비대칭 라우팅(<code>SHORT=W3 / LONG=W7+Sniper</code>) + 테너 품질 분리(<code>TY→W7</code>) + 2024 과민반응 교정 방어①.<br>
            모멘텀 <strong>단독 5개년 전 연도 흑자(+$1.48M · Sharpe 1.84 · Calmar 11.60x)</strong> 및 FX 45페어 방어② 결합 시 <strong>+$2.02M 돌파(Sharpe 2.22 · Calmar 15.24x)</strong>를 실증했습니다.
          </p>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div class="segmented" role="group" aria-label="분석 대상 선택">
            <button type="button" data-v35-pmode="STANDALONE" class="${portfolioMode === 'STANDALONE' ? 'on' : ''}">🎯 모멘텀 v3.5 단독</button>
            <button type="button" data-v35-pmode="COMBO" class="${portfolioMode === 'COMBO' ? 'on' : ''}">🔥 통합 (v3.5 + FX45 방어②)</button>
          </div>
          <button type="button" id="v35-export-csv" class="btn quiet">↓ 59개월 CSV</button>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="stats" style="margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));">
        <div class="stat">
          <div class="label">총 누적 순손익 (59개월)</div>
          <div class="num green">${fmtUsd(activePerf.total_net)}</div>
          <div class="help">✅ 5개년 전 연도 흑자 · Strict 기준 ${fmtUsd(strictPerf.total_net)}</div>
        </div>
        <div class="stat">
          <div class="label">최대 낙폭 (MDD) / Calmar</div>
          <div class="num" style="color:#2563eb;">−$${fmtNum(activePerf.mdd)} <small style="font-size:13px;">(${activePerf.calmar}x)</small></div>
          <div class="help">23~25 박스권 3개년 합산 ${fmtUsd(activePerf.box_23_25)}</div>
        </div>
        <div class="stat">
          <div class="label">Sharpe / 월간 손익비</div>
          <div class="num green">${activePerf.sharpe} <small style="font-size:13px;">(${activePerf.monthly_payoff}x)</small></div>
          <div class="help">수익월 평균 ${fmtUsd(activePerf.avg_win_month)} / 손실월 ${fmtUsd(activePerf.avg_loss_month)}</div>
        </div>
        <div class="stat">
          <div class="label">월간 승률 / −$20k 이하</div>
          <div class="num green">${activePerf.win_months}/59 <small style="font-size:13px;">(${activePerf.win_months_pct}%)</small></div>
          <div class="help">−$20k 이하 <strong>${activePerf.loss20k_months}개월</strong> · 최장 ${activePerf.max_win_streak}연승 / ${activePerf.max_loss_streak}연패</div>
        </div>
        <div class="stat">
          <div class="label">실거래 빈도 (데스크 기준)</div>
          <div class="num">${hl.desk_trades_total}건 <small style="font-size:13px;">(월 ${hl.desk_trades_per_month}건)</small></div>
          <div class="help">SHORT ${hl.desk_short_cnt} / LONG ${hl.desk_long_cnt} · 코어 평균보유 ${hl.core_avg_hold_days}일</div>
        </div>
      </div>

      <!-- Sub-section Jump Tabs -->
      <div class="filters" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border,rgba(148,163,184,0.22));justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div class="segmented" role="group" aria-label="섹션 필터">
          ${[
            ['ALL', '📚 전체 보기'],
            ['FORMULA', '① FX v2.0 계산 공식'],
            ['RULES', '② 진입·증액·손절·익절 A-to-Z'],
            ['MONTHLY', '③ 59개월 손익 차트 & 표'],
            ['TRADES', '④ 거래건수·테너·기각 팩터'],
          ]
            .map(([k, l]) => `<button type="button" data-v35-sec="${k}" class="${sectionTab === k ? 'on' : ''}">${l}</button>`)
            .join('')}
        </div>
        <div class="segmented" role="group" aria-label="연도 필터">
          ${['ALL', '2022', '2023', '2024', '2025', '2026']
            .map((y) => `<button type="button" data-v35-yr="${y}" class="${yearFilter === y ? 'on' : ''}">${y === 'ALL' ? '전체 5개년' : y + '년'}</button>`)
            .join('')}
        </div>
      </div>
    </div>

    ${
      showFormula
        ? `
    <!-- ===================================================================== -->
    <!-- SECTION 1: FX STRESS INDEX v2.0 3-PILLAR FORMULAS                     -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head">
        <div>
          <div class="eyebrow">PART 1 · FX STRESS INDEX v2.0 (3-PILLAR MACRO REGIME SENSOR)</div>
          <h2>1. FX 스트레스 지수 v2.0 계산 원리 및 3대 기둥 공식 (0 ~ 100점)</h2>
        </div>
        ${
          v2Info.score != null
            ? `<span class="tag primary" style="font-size:12px;">최근 기준일(${esc(lv2.date || '2026-11-16')}) v2.0 = ${fmtNum(v2Info.score, 1)}점 (P1:${fmtNum(v2Info.p1_eff, 1)} / P2:${fmtNum(v2Info.p2_rv, 1)} / P3:${fmtNum(v2Info.p3_coh, 1)})</span>`
            : ''
        }
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:8px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:14px;background:var(--surface-2,rgba(248,250,252,0.5));">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:#0d9488;">기둥 ① P1 · 시장 추세 효율성</strong>
            <span class="tag primary">최대 40점</span>
          </div>
          <p style="font-size:12.5px;margin:0 0 8px;line-height:1.55;">
            가격이 지그재그(박스권)로 흔들리는지, 직선(추세장)으로 뻗는지 직접 측정합니다. 금리 6종 상위 3개(<strong>60%</strong>) + FX 7종 상위 3개(<strong>40%</strong>)를 합산합니다.
          </p>
          <div style="font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--surface,#fff);padding:8px 10px;border-radius:6px;border:1px solid var(--border,rgba(148,163,184,0.22));line-height:1.6;">
            ER20 = |Close(t) − Close(t−20)| / Σ|ΔClose|<br>
            TrendEff = ER20 × (0.45 + 0.55 × |S0|)<br>
            VR10 = Var(10D수익률) / (10 × Var(1D수익률))<br>
            <strong>P1 = 25 × norm(TrendEff, 0.14→0.34) + 15 × norm(VR10, 0.88→1.25)</strong>
          </div>
        </div>

        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:14px;background:var(--surface-2,rgba(248,250,252,0.5));">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:#2563eb;">기둥 ② P2 · FX 평균회귀 붕괴도</strong>
            <span class="tag shadow">최대 30점</span>
          </div>
          <p style="font-size:12.5px;margin:0 0 8px;line-height:1.55;">
            기존 v1.0의 오경보 원인이던 <code>BETA_BLOCK</code>(상관관계 이탈) 페어를 제외하고, 정상 페어(<code>0.4 ≤ |β| ≤ 1.6</code>)에서만 평균회귀가 깨지는지 측정합니다.
          </p>
          <div style="font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--surface,#fff);padding:8px 10px;border-radius:6px;border:1px solid var(--border,rgba(148,163,184,0.22));line-height:1.6;">
            PureTail = 정상 페어 중 |Z_OOS| ≥ 2.3 비율<br>
            P75_HL = 정상 페어 OU 반감기 상위 75분위수<br>
            ValidDrift = 정상 페어 평균 |Z_OOS − Z_Refit|<br>
            <strong>P2 = 14×norm(Tail, 6%→28%) + 8×norm(HL, 4.8→7.5d) + 8×norm(Drift, 0.07→0.26)</strong>
          </div>
        </div>

        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:14px;background:var(--surface-2,rgba(248,250,252,0.5));">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:#d97706;">기둥 ③ P3 · 글로벌 매크로 동조성</strong>
            <span class="tag hold">최대 30점</span>
          </div>
          <p style="font-size:12.5px;margin:0 0 8px;line-height:1.55;">
            단일 통화·단일 만기 해프닝을 거르고, G7 통화의 달러 일방향 쏠림과 미국·독일 국채 전 만기가 한 방향으로 움직이는 진짜 거시 파동을 포착합니다.
          </p>
          <div style="font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--surface,#fff);padding:8px 10px;border-radius:6px;border:1px solid var(--border,rgba(148,163,184,0.22));line-height:1.6;">
            USD_Coh = |Mean(7개 FX선물 USD방향 모멘텀)|<br>
            Curve_Coh = |Mean(sign(US 2/5/10Y · DE 2/5/10Y))|<br>
            <strong>P3 = 14×norm(USD_Coh, 0.24→0.68) + 16×norm(Curve_Coh, 0.42→0.82)</strong><br>
            <strong>최종 v2.0(t) = 0.55×Raw(t) + 0.45×v2.0(t−1)</strong> (3일 EMA)
          </div>
        </div>
      </div>

      <div class="rule-note" style="margin-top:10px;">
        📐 <strong>선형 정규화 함수</strong>: <code>norm(x, lo→hi) = clip((x − lo) / (hi − lo), 0, 1)</code> · <strong>완전 인과(Causal) 원칙</strong>: 당일(<code>t</code>)의 모든 국면 판정·배수·엔진 스위칭은 반드시 <strong>전일(<code>t−1</code>) 확정 지표</strong>만 사용하여 미래 정보 누수를 100% 차단합니다.
      </div>
    </div>
    `
        : ''
    }

    ${
      showRules
        ? `
    <!-- ===================================================================== -->
    <!-- SECTION 2: MOMENTUM v3.5 A-TO-Z EXECUTION RULES                       -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head">
        <div>
          <div class="eyebrow">PART 2 · MOMENTUM v3.5 EXECUTION ARCHITECTURE A-TO-Z</div>
          <h2>2. 모멘텀 v3.5 핵심 혁신 3가지 &amp; 진입·증액·감액·손절·익절·청산 전체 규칙</h2>
        </div>
      </div>

      <!-- 3 Core Innovations -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:14px;">
        <div style="border:1px solid rgba(13,148,136,0.35);border-radius:10px;padding:13px;">
          <div style="font-weight:800;font-size:13.5px;color:#0d9488;margin-bottom:6px;">① 방향 비대칭 엔진 라우팅 (Asymmetric Engine)</div>
          <ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6;">
            <li><strong>채권 SHORT (금리 상승)</strong> → <code>W3 고속 (CTA_RECIPE1)</code><br><span class="muted">실증: 62건 승률 59.7%, +$969,234 (금리 급등 추세는 직선적)</span></li>
            <li><strong>채권 LONG (금리 하락)</strong> → <code>W7 완속 65% + Sniper 35%</code><br><span class="muted">실증: W3 LONG은 16건 −$72.3k 적자였으나 W7(+$40.9k) + Sniper(+$17.3k, WR 70%)로 흑자 전환</span></li>
          </ul>
        </div>
        <div style="border:1px solid rgba(37,99,235,0.35);border-radius:10px;padding:13px;">
          <div style="font-weight:800;font-size:13.5px;color:#2563eb;margin-bottom:6px;">② 테너 품질 라우팅 (Tenor Quality Split)</div>
          <ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6;">
            <li><strong>TU(미 2Y) · DU(독 2Y) · FV(미 5Y) · RX(독 10Y)</strong><br><span class="muted">단·중기 및 분트 주력 4종은 W3 고속 SHORT 수행 (TU+DU가 수익의 69%)</span></li>
            <li><strong>TY(미국 10Y)</strong> → <code>W7 완속 전용 라우팅</code><br><span class="muted">W3에서 유일한 적자 테너(−$20.2k / F3 −$73.9k)였으나 W7 이관 시 +$37.9k 흑자</span></li>
          </ul>
        </div>
        <div style="border:1px solid rgba(124,58,237,0.35);border-radius:10px;padding:13px;">
          <div style="font-weight:800;font-size:13.5px;color:#7c3aed;margin-bottom:6px;">③ 교정된 비침습 방어① (2024 과민반응 해결)</div>
          <ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6;">
            <li><strong>이중 기간 피로 판정</strong>: 5일 하락만으로 컷하지 않고 <code>Δ5D&lt;−4.5 ∧ Δ10D&lt;−3.0</code> (L3: <code>−5.5 / −4.0</code>) 동시 하락 시에만 수익잠금 전환</li>
            <li><strong>고립 채권 추세 예외 (IsoTrend)</strong>: FX가 조용해도(<code>v2∈[24,38)</code>) 채권 자체 <code>ER20≥0.26 ∧ |S0|≥0.55</code>면 코어 추세 허용 → <strong>2024년 −$77k → +$40k 극적 반전!</strong></li>
          </ul>
        </div>
      </div>

      <!-- 8-Regime Matrix -->
      <h3 style="margin:14px 0 8px;font-size:14px;">📊 8대 시장 국면별 배수 · 엔진 배분 · 59개월 실적 매트릭스</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>국면 (Regime)</th>
              <th>발동 조건 (전일 t−1 확정)</th>
              <th>배수 / 스케일</th>
              <th>엔진 배분 및 익절 규칙</th>
              <th class="number">발생 일수 (비중)</th>
              <th class="number">누적 손익 기여</th>
              <th class="number">일평균 손익</th>
            </tr>
          </thead>
          <tbody>
            ${(data.regime_summary || [])
              .map(
                (rg) => `<tr>
                <td>${regimeBadge(rg.code)} <strong style="font-size:12px;margin-left:4px;">${esc(rg.name)}</strong></td>
                <td style="font-size:12px;"><code>${esc(rg.condition)}</code></td>
                <td style="font-size:12px;font-weight:700;">${esc(rg.multiplier)}</td>
                <td style="font-size:12px;">${esc(rg.allocation)}</td>
                <td class="number">${rg.days}일 <span class="muted">(${rg.days_pct}%)</span></td>
                <td class="number ${clsPnl(rg.total_pnl)}"><strong>${fmtUsd(rg.total_pnl)}</strong></td>
                <td class="number ${clsPnl(rg.avg_daily_pnl)}">${fmtUsd(rg.avg_daily_pnl)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Full Lifecycle 6-Step Cards -->
      <h3 style="margin:18px 0 8px;font-size:14px;">⚙️ 포지션 라이프사이클 전체 규칙 (진입 → 증액 → 감액 → 부분익절 → 손절 → 청산)</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:10px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;margin-bottom:5px;">1️⃣ 진입 조건 (Entry Signal)</div>
          • 방향 점수: <code>S0 = 0.70×Dispersion + 0.30×MA정렬</code><br>
          • <strong>10D Donchian 돌파</strong> + <strong>MA20/MA60/MA120 정배열</strong><br>
          • 국가당 최강 1종목 집중 (US: TU/FV/TY, DE: DU/OE/RX)<br>
          • <strong>1차 선발대 1/3 진입</strong> (기본 예산 $35k 기준 $11,667)<br>
          • <strong style="color:#d97706;">이벤트 D-1 경보</strong>: FOMC·CPI·NFP 전일 <em>신규 진입</em>은 1/3 정찰 상한 (기존 보유 수익 포지션은 유지)
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;margin-bottom:5px;">2️⃣ 증액 기준 (Scale-In / Pyramiding)</div>
          • <strong>2차 본대 (+1/3 → 총 2/3)</strong>: 20D 돌파 확인 &amp; 포지션 수익권 진입 시 (<code>|S0| ≥ 0.45~0.55</code>)<br>
          • <strong>3차 풀배분 (+1/3 → 총 3/3)</strong>: 같은 국가 2개 이상 테너 동조(<code>|S0|≥0.48</code>) + 강한 확신(<code>|S0|≥0.65~0.70</code>)<br>
          • <strong>국면 배수 증액</strong>: L2 가속 <code>1.48x</code> / L3 추세확장 단독 <code>1.58x</code> · 멀티동조 <code>1.90x</code>
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;margin-bottom:5px;">3️⃣ 감액 기준 (Scale-Down / Fatigue)</div>
          • 모멘텀 점수 둔화(<code>|S0| &lt; 0.22~0.35</code>) 시 보유 비중 <strong>1/3 축소</strong><br>
          • <strong>추세 피로 전환</strong>(L2/L3 Fatigue): 공격 배수 즉시 해제 → <code>Fast 3-Beat + Sniper</code> 수익잠금 모드 전환<br>
          • <strong>박스권·저변동 전환</strong>(<code>v2 &lt; 24</code>): 추세 배수 축소, 4/6 합의 스나이퍼 선별 모드 가동
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;margin-bottom:5px;">4️⃣ 손절 규칙 (Hard Stop &amp; Time Stop)</div>
          • <strong>초기 하드스탑</strong>: 진입가 대비 <code>2.5 × SD20</code> (20일 가격 변동성) 이탈 시 장중 즉시 손절 (계약수 = 예산 ÷ 2.5SD)<br>
          • <strong>타임스탑</strong>: 진입 후 <code>3~5영업일</code>(국면별 4~7일) 내 최고 평가익이 <code>+0.16R</code> 미달 시 횡보 낭비 방지를 위해 조기 정리
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;margin-bottom:5px;">5️⃣ 수익잠금 &amp; 부분익절 (Profit-Lock &amp; TP)</div>
          • <strong>Fast 3-Beat / Sniper 잠금 (박스·피로장)</strong>: 평가익 <code>+0.28R</code> 도달 즉시 스탑을 <strong>+0.14R(수익 확보선)</strong>으로 상향<br>
          • <strong>일반 추세장 (L2)</strong>: <code>+0.90R</code> 도달 시 <strong>50% 부분익절 확정</strong> + 잔여 50% 본전(BE) 스탑 상향<br>
          • <strong>추세 확장장 (L3)</strong>: <code>+0.90R</code> 부분익절 유예(BE 스탑만 상향) → <strong>+1.35R</strong>까지 전량 러너 보유 연장
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;margin-bottom:5px;">6️⃣ 최종 청산 &amp; 눌림목 재진입 (Exit &amp; Re-entry)</div>
          • <strong>추세 트레일링 청산</strong>: 잔여 러너는 <strong>10일 반대 채널(10D High/Low)</strong> 종가 이탈 시 최종 청산<br>
          • <strong>눌림목 재진입</strong>: 부분익절·청산 후에도 <code>MA60</code> 대추세가 살아있고 <code>MA20</code> 지지 반등 확인 시 <strong>2/3 규모로 재진입</strong> (L2·L3 허용, 박스권 보류)
        </div>
      </div>
    </div>
    `
        : ''
    }

    ${
      showMonthly
        ? `
    <!-- ===================================================================== -->
    <!-- SECTION 3: 59-MONTH CHARTS, DISTRIBUTION & FULL MONTHLY TABLE         -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head" style="flex-wrap:wrap;gap:10px;">
        <div>
          <div class="eyebrow">PART 3 · 59-MONTH PNL TRAJECTORY (2022-01 ~ 2026-11)</div>
          <h2>3. 모멘텀 v3.5 59개월 누적·월별 손익 추이 (${yearFilter === 'ALL' ? '전체 59개월' : yearFilter + '년'} · ${portfolioMode === 'COMBO' ? '통합 v3.5+FX45' : '모멘텀 v3.5 단독'})</h2>
        </div>
      </div>

      <div style="margin-top:6px;">${renderEquitySvg(chartMonths, portfolioMode)}</div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border,rgba(148,163,184,0.2));">${renderMonthlyBarSvg(chartMonths, portfolioMode)}</div>

      <!-- Distribution & Extreme Months -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:14px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;">
          <div style="font-weight:800;font-size:13px;">📊 월간 손익 구간 분포 (${portfolioMode === 'COMBO' ? '통합 59개월' : '단독 59개월'})</div>
          ${renderDistBar(activePerf.buckets)}
          <p class="muted" style="font-size:11.5px;margin:8px 0 0;">
            • 월평균 <strong>${fmtUsd(activePerf.avg_month)}</strong> · 수익월 평균 <strong>${fmtUsd(activePerf.avg_win_month)}</strong> · 손실월 평균 <strong>${fmtUsd(activePerf.avg_loss_month)}</strong> (손익비 <strong>${activePerf.monthly_payoff}x</strong>)
          </p>
        </div>

        <div style="border:1px solid rgba(13,148,136,0.3);border-radius:10px;padding:12px;">
          <div style="font-weight:800;font-size:13px;color:#0d9488;margin-bottom:6px;">🏆 모멘텀 v3.5 최우수 5개월</div>
          <div style="font-size:12px;line-height:1.7;">
            ${(data.top5_months || [])
              .map(
                (r, idx) =>
                  `<div style="display:flex;justify-content:space-between;gap:8px;">
                    <span><strong>${idx + 1}. ${r.ym}</strong> ${regimeBadge(r.regime)} <span class="muted">(v2 ${r.v2_avg})</span></span>
                    <span class="green"><strong>${fmtUsd(r.mom_v35)}</strong> <span class="muted">(통합 ${fmtUsd(r.combo_v35)})</span></span>
                  </div>`
              )
              .join('')}
          </div>
        </div>

        <div style="border:1px solid rgba(225,29,72,0.3);border-radius:10px;padding:12px;">
          <div style="font-weight:800;font-size:13px;color:#e11d48;margin-bottom:6px;">🛡️ 모멘텀 v3.5 최악 5개월 &amp; FX45 자연 헤지</div>
          <div style="font-size:12px;line-height:1.7;">
            ${(data.bottom5_months || [])
              .map(
                (r, idx) =>
                  `<div style="display:flex;justify-content:space-between;gap:8px;">
                    <span><strong>${idx + 1}. ${r.ym}</strong> ${regimeBadge(r.regime)}</span>
                    <span><strong class="red">${fmtUsd(r.mom_v35)}</strong> → FX <span class="${clsPnl(r.fx45_def)}">${fmtUsd(r.fx45_def)}</span> → <strong class="${clsPnl(r.combo_v35)}">${fmtUsd(r.combo_v35)}</strong></span>
                  </div>`
              )
              .join('')}
          </div>
        </div>
      </div>

      <!-- Full 59-Month Table -->
      <div class="panel-head" style="margin-top:18px;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0;font-size:14.5px;">📅 59개월 월별 손익추이 &amp; 거래건수 상세 매트릭스 (${tableMonths.length}개월 표시)</h3>
        <div class="segmented" role="group" aria-label="월별 상세 필터">
          ${[
            ['ALL', '전체'],
            ['BIG_WIN', '★ 대승월 (+$50k↑)'],
            ['LOSS', '적자월'],
            ['LOSS20K', '▼ −$20k 이하'],
            ['ZERO_ENTRY', '신규진입 0건 (홀딩·관망)'],
          ]
            .map(([k, l]) => `<button type="button" data-v35-mfilter="${k}" class="${monthFilter === k ? 'on' : ''}">${l}</button>`)
            .join('')}
        </div>
      </div>

      <div class="table-scroll" style="max-height:620px;overflow-y:auto;">
        <table>
          <thead style="position:sticky;top:0;z-index:2;background:var(--surface,#fff);">
            <tr>
              <th>년-월</th>
              <th class="number">v2 평균</th>
              <th>주력 국면</th>
              <th class="number">신규</th>
              <th class="number">보유</th>
              <th>신규 진입 종목 (S=숏 / L=롱)</th>
              <th class="number">모멘텀 v3.5</th>
              <th class="number">모멘텀 누적</th>
              <th class="number">모멘텀 DD</th>
              <th class="number">FX45 방어②</th>
              <th class="number">통합 (v3.5+FX)</th>
              <th class="number">통합 누적</th>
            </tr>
          </thead>
          <tbody>
            ${tableMonths
              .map(
                (r) => `<tr style="${r.mom_v35 >= 50000 ? 'background:rgba(13,148,136,0.06);' : r.mom_v35 <= -20000 ? 'background:rgba(225,29,72,0.06);' : ''}">
                <td><strong>${r.ym}</strong></td>
                <td class="number">${fmtNum(r.v2_avg, 1)}</td>
                <td>${regimeBadge(r.regime)}</td>
                <td class="number"><strong>${r.new_trades}건</strong></td>
                <td class="number muted">${r.active_trades}건</td>
                <td style="font-size:11.5px;font-family:ui-monospace,Consolas,monospace;">${esc(r.entries_desc)}</td>
                <td class="number ${clsPnl(r.mom_v35)}"><strong>${fmtUsd(r.mom_v35)}</strong>${r.mom_v35 >= 50000 ? ' ★' : r.mom_v35 <= -20000 ? ' ▼' : ''}</td>
                <td class="number">${fmtUsd(r.mom_cum)}</td>
                <td class="number ${r.mom_dd < 0 ? 'red' : 'muted'}">${r.mom_dd === 0 ? '$0' : fmtUsd(r.mom_dd)}</td>
                <td class="number ${clsPnl(r.fx45_def)}">${fmtUsd(r.fx45_def)}</td>
                <td class="number ${clsPnl(r.combo_v35)}"><strong>${fmtUsd(r.combo_v35)}</strong></td>
                <td class="number">${fmtUsd(r.combo_cum)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
          <tfoot style="position:sticky;bottom:0;background:var(--surface-2,#f8fafc);font-weight:800;">
            <tr>
              <td colspan="3">선택 구간 합계 (${tableMonths.length}개월)</td>
              <td class="number">${sumNewT}건</td>
              <td class="number muted">—</td>
              <td class="muted" style="font-size:11.5px;">월평균 ${(sumNewT / Math.max(1, tableMonths.length)).toFixed(2)}건</td>
              <td class="number ${clsPnl(sumMom)}">${fmtUsd(sumMom)}</td>
              <td class="number">—</td>
              <td class="number">—</td>
              <td class="number ${clsPnl(sumFx)}">${fmtUsd(sumFx)}</td>
              <td class="number ${clsPnl(sumCombo)}">${fmtUsd(sumCombo)}</td>
              <td class="number">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    `
        : ''
    }

    ${
      showTrades
        ? `
    <!-- ===================================================================== -->
    <!-- SECTION 4: TRADE COUNTS, TENOR ANATOMY, EVOLUTION & REJECTED AUDIT    -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head">
        <div>
          <div class="eyebrow">PART 4 · TRADE COUNT ANATOMY · TENOR FORENSICS · VERSION EVOLUTION</div>
          <h2>4. 거래건수 · 테너별 분해 · 버전 진화 비교 · 실증 기각 팩터 아카이브</h2>
        </div>
      </div>

      <!-- Annual Trade & PnL Summary -->
      <h3 style="margin:6px 0 8px;font-size:14px;">📆 연도별 거래건수 &amp; 손익 비교 (실거래 데스크 중첩 통합 기준 · 총 ${hl.desk_trades_total}건)</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>연도</th>
              <th class="number">v2 평균</th>
              <th class="number">신규 진입 (월평균)</th>
              <th class="number">SHORT / LONG</th>
              <th class="number">US / DE</th>
              <th class="number">단독 승월</th>
              <th class="number">기존 기본 (R1_V2)</th>
              <th class="number">구 방어①</th>
              <th class="number">★ 모멘텀 v3.5 단독</th>
              <th class="number">FX45 방어②</th>
              <th class="number">★ 통합 (v3.5+FX)</th>
            </tr>
          </thead>
          <tbody>
            ${(data.annual_summary || [])
              .map(
                (a) => `<tr>
                <td><strong>${a.year}년</strong> ${a.year === '2026' ? '<span class="muted" style="font-size:11px;">(~11월)</span>' : ''}</td>
                <td class="number">${fmtNum(a.v2_avg, 1)}점</td>
                <td class="number"><strong>${a.new_trades}건</strong> <span class="muted">(${a.trades_per_month}/월)</span></td>
                <td class="number">${a.short_trades} / ${a.long_trades}</td>
                <td class="number">${a.us_trades} / ${a.de_trades}</td>
                <td class="number">${a.mom_win_months}/${a.months}</td>
                <td class="number ${clsPnl(a.mom_base)}">${fmtUsd(a.mom_base)}</td>
                <td class="number ${clsPnl(a.mom_def1)}">${fmtUsd(a.mom_def1)}</td>
                <td class="number ${clsPnl(a.mom_v35)}"><strong>${fmtUsd(a.mom_v35)}</strong></td>
                <td class="number ${clsPnl(a.fx45_def)}">${fmtUsd(a.fx45_def)}</td>
                <td class="number ${clsPnl(a.combo_v35)}"><strong>${fmtUsd(a.combo_v35)}</strong></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Monthly Entry Frequency + Core Route Breakdown + Tenor Breakdown -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:16px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:13px;">
          <h3 style="margin:0 0 8px;font-size:13.5px;">🧭 v3.5 코어 비대칭 라우팅 건수 (${hl.core_trades_total}건 · 승률 ${hl.core_win_rate_pct}%)</h3>
          <div class="table-scroll">
            <table>
              <thead>
                <tr><th>라우팅 경로</th><th class="number">건수</th><th class="number">승률</th><th class="number">보유일</th><th class="number">원시 순손익</th></tr>
              </thead>
              <tbody>
                ${(data.core_route_summary || [])
                  .map(
                    (c) => `<tr>
                    <td><strong>${esc(c.label)}</strong><div class="pair-sub">${esc(c.role)}</div></td>
                    <td class="number">${c.trades}건</td>
                    <td class="number">${c.win_rate_pct}%</td>
                    <td class="number">${c.avg_hold_days}일</td>
                    <td class="number ${clsPnl(c.raw_net)}"><strong>${fmtUsd(c.raw_net)}</strong></td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
          <div class="rule-note" style="margin-top:8px;">
            월별 진입 빈도(59개월): <strong>0건 ${hl.monthly_entry_freq['0'] || 0}개월</strong> · <strong>1건 ${hl.monthly_entry_freq['1'] || 0}개월</strong> · <strong>2건 ${hl.monthly_entry_freq['2'] || 0}개월</strong> · <strong>3건 ${hl.monthly_entry_freq['3'] || 0}개월</strong> (월 4건 이상 과잉매매 0회)
          </div>
        </div>

        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:13px;">
          <h3 style="margin:0 0 8px;font-size:13.5px;">🎯 5대 핵심 테너별 거래건수 &amp; W3 vs W7 실증</h3>
          <div class="table-scroll">
            <table>
              <thead>
                <tr><th>테너</th><th class="number">v3.5 건수 (S/L)</th><th class="number">W3(R1) 순손익</th><th class="number">W7(R2) 순손익</th></tr>
              </thead>
              <tbody>
                ${(data.tenor_stats || [])
                  .map(
                    (ts) => `<tr style="${ts.id === 'TY' ? 'background:rgba(37,99,235,0.06);' : ''}">
                    <td><strong>${ts.id}</strong> · ${esc(ts.name)}<div class="pair-sub">${esc(ts.route)}</div></td>
                    <td class="number"><strong>${ts.v35_trades}건</strong> <span class="muted">(${ts.v35_short}/${ts.v35_long})</span></td>
                    <td class="number ${clsPnl(ts.r1_net)}">${fmtUsd(ts.r1_net)} <span class="muted">(${ts.r1_wr}%)</span></td>
                    <td class="number ${clsPnl(ts.r2_net)}"><strong>${fmtUsd(ts.r2_net)}</strong> <span class="muted">(${ts.r2_wr}%)</span></td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
          <p class="muted" style="font-size:11.5px;margin:8px 0 0;">
            ※ <strong>TY(미국 10Y)</strong>는 W3 고속에서 −$20.2k 적자였으나 W7 완속에서 +$37.9k로 역전되어 v3.5에서 W7 전용 라우팅으로 분리했습니다.
          </p>
        </div>
      </div>

      <!-- Underlying 4 Production Engines -->
      <h3 style="margin:18px 0 8px;font-size:14px;">⚙️ 기반 4개 서브엔진 공식 거래 원장 비교 (2022-01 ~ 2026-11)</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>기반 엔진</th>
              <th class="number">거래건수 (월평균)</th>
              <th class="number">승률 / PF</th>
              <th class="number">평균(중앙) 보유</th>
              <th class="number">시장 노출일</th>
              <th class="number">SHORT (손익 · WR)</th>
              <th class="number">LONG (손익 · WR)</th>
              <th class="number">증액 / 부분익절 / 감액</th>
            </tr>
          </thead>
          <tbody>
            ${(data.engine_summary || [])
              .map(
                (en) => `<tr>
                <td><strong>${esc(en.model)}</strong></td>
                <td class="number">${en.trades}건 <span class="muted">(${en.per_month}/월)</span></td>
                <td class="number">${en.win_rate_pct}% / <strong>${en.pf}</strong></td>
                <td class="number">${en.avg_hold_days}일 <span class="muted">(${en.median_hold_days}일)</span></td>
                <td class="number">${en.active_days}일 <span class="muted">(${en.active_pct}%)</span></td>
                <td class="number">${en.short_cnt}건 · <span class="${clsPnl(en.short_net)}">${fmtUsd(en.short_net)}</span> <span class="muted">(${en.short_wr}%)</span></td>
                <td class="number">${en.long_cnt}건 · <span class="${clsPnl(en.long_net)}">${fmtUsd(en.long_net)}</span> <span class="muted">(${en.long_wr}%)</span></td>
                <td class="number">${en.adds} / ${en.partial_tps} / ${en.reduces}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Version Evolution Table -->
      <h3 style="margin:18px 0 8px;font-size:14px;">📈 전략 진화 단계별 백테스트 비교 (Ablation Study · 59개월)</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>전략 버전</th>
              <th class="number">총 순손익</th>
              <th class="number">MDD</th>
              <th class="number">Sharpe</th>
              <th class="number">Calmar</th>
              <th class="number">월승률</th>
              <th class="number">−$20k↓</th>
              <th class="number">23~25 박스권</th>
              <th>5년 전승</th>
            </tr>
          </thead>
          <tbody>
            ${(data.evolution || [])
              .map((ev) => {
                const isStar = ev.key === 'mom_v35_core' || ev.key === 'combo_v35';
                return `<tr style="${isStar ? 'background:rgba(13,148,136,0.09);font-weight:700;' : ''}">
                  <td>${esc(ev.label)}</td>
                  <td class="number ${clsPnl(ev.total_net)}"><strong>${fmtUsd(ev.total_net)}</strong></td>
                  <td class="number red">−$${fmtNum(ev.mdd)}</td>
                  <td class="number"><strong>${ev.sharpe}</strong></td>
                  <td class="number">${ev.calmar}x</td>
                  <td class="number">${ev.win_months}/59 (${ev.win_months_pct}%)</td>
                  <td class="number">${ev.loss20k_months}개월</td>
                  <td class="number ${clsPnl(ev.box_23_25)}">${fmtUsd(ev.box_23_25)}</td>
                  <td>${ev.all_5_years_positive ? '<span class="tag primary">✅ 5년 전승</span>' : '<span class="tag block">일부 적자</span>'}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Rejected Factors Archive -->
      <h3 style="margin:18px 0 8px;font-size:14px;">🧪 실증 검증 후 기각(배제)한 아이디어 아카이브 (과최적화 방지 기록)</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th>테스트한 후보 팩터 / 자산</th><th>실증 백테스트 결과</th><th>판정</th><th>기각·제한 사유</th></tr>
          </thead>
          <tbody>
            ${(data.rejected_factors || [])
              .map(
                (rf) => `<tr>
                <td><strong>${esc(rf.factor)}</strong></td>
                <td style="font-size:12px;"><code>${esc(rf.result)}</code></td>
                <td><span class="tag ${rf.verdict === '기각' ? 'block' : 'hold'}">${esc(rf.verdict)}</span></td>
                <td style="font-size:12px;line-height:1.5;">${esc(rf.reason)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
    `
        : ''
    }
  `;

  // Bind interactive buttons
  target.querySelectorAll('[data-v35-pmode]').forEach((b) => {
    b.onclick = () => {
      portfolioMode = b.dataset.v35Pmode;
      renderMomentumV35(target);
    };
  });
  target.querySelectorAll('[data-v35-sec]').forEach((b) => {
    b.onclick = () => {
      sectionTab = b.dataset.v35Sec;
      renderMomentumV35(target);
    };
  });
  target.querySelectorAll('[data-v35-yr]').forEach((b) => {
    b.onclick = () => {
      yearFilter = b.dataset.v35Yr;
      renderMomentumV35(target);
    };
  });
  target.querySelectorAll('[data-v35-mfilter]').forEach((b) => {
    b.onclick = () => {
      monthFilter = b.dataset.v35Mfilter;
      renderMomentumV35(target);
    };
  });

  const expBtn = target.querySelector('#v35-export-csv');
  if (expBtn) {
    expBtn.onclick = () => {
      downloadCsv('momentum-v35-59months.csv', [
        [
          'year_month',
          'v2_avg',
          'regime',
          'new_trades',
          'active_trades',
          'entries_desc',
          'mom_v35_usd',
          'mom_cum_usd',
          'mom_dd_usd',
          'fx45_def_usd',
          'combo_v35_usd',
          'combo_cum_usd',
        ],
        ...allMonths.map((r) => [
          r.ym,
          r.v2_avg,
          r.regime,
          r.new_trades,
          r.active_trades,
          r.entries_desc,
          r.mom_v35,
          r.mom_cum,
          r.mom_dd,
          r.fx45_def,
          r.combo_v35,
          r.combo_cum,
        ]),
      ]);
    };
  }
}
