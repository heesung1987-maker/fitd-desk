import { getChartTheme } from './chart-utils.js?v=11';

let v35Data = null;
let portfolioMode = 'COMBO'; // 'COMBO' | 'FX_ONLY' | 'MOM_ONLY'
let sectionTab = 'ALL'; // 'ALL' | 'SCHEME' | 'RULES' | 'MONTHLY' | 'TRADES'
let yearFilter = 'ALL'; // 'ALL' | '2022' | '2023' | '2024' | '2025' | '2026'
let monthFilter = 'ALL'; // 'ALL' | 'BIG_WIN' | 'LOSS' | 'SEVERE' | 'FX_ZERO' | 'MOM_ZERO'

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
  L3_Crisis: { label: 'L3 폭풍장', bg: 'rgba(220,38,38,0.12)', fg: '#dc2626' },
  L2_Boost: { label: 'L2 가속동조', bg: 'rgba(234,88,12,0.12)', fg: '#ea580c' },
  L2_Trend: { label: 'L2 추세형성', bg: 'rgba(217,119,6,0.12)', fg: '#d97706' },
  IsoTrend: { label: '고립추세', bg: 'rgba(37,99,235,0.12)', fg: '#2563eb' },
  Box: { label: '박스권', bg: 'rgba(13,148,136,0.12)', fg: '#0d9488' },
  DeadZone: { label: '안개장', bg: 'rgba(100,116,139,0.14)', fg: '#64748b' },
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
    throw new Error('FX v2.0 + 모멘텀 v3.5 리포트 데이터를 불러오지 못했습니다.');
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

  const cfg =
    mode === 'COMBO'
      ? {
          kMain: 'combo_4b_cum', mMain: 'combo_4b', lblMain: '★ 통합 확정 (FX v2.0 4B + 모멘텀 v3.5)',
          kMid: 'combo_4a_cum', mMid: 'combo_4a', lblMid: '원설계 정적 통합 (FX 4A + v3.5)',
          kBase: 'combo_2a_cum', mBase: 'combo_2a', lblBase: '감속형 통합 (FX 2A + v3.5)',
        }
      : mode === 'FX_ONLY'
      ? {
          kMain: 'fx_4b_cum', mMain: 'fx_4b', lblMain: '★ FX v2.0 확정 (4B: Z2.2 · BOX · Time20d)',
          kMid: 'fx_4a_cum', mMid: 'fx_4a', lblMid: 'FX 원설계 정적 (4A: Z2.7 · 1:1 Cap$5M)',
          kBase: 'fx_2a_cum', mBase: 'fx_2a', lblBase: 'FX 감속형 (2A: Z2.7 · DEF2_CAUSAL)',
        }
      : {
          kMain: 'mom_cum', mMain: 'mom_v35', lblMain: '★ 모멘텀 v3.5 확정 (단독 · 5년전승)',
          kMid: 'mom_def1_cum', mMid: 'mom_def1', lblMid: '기존 + 구 방어①',
          kBase: 'mom_base_cum', mBase: 'mom_base', lblBase: '기존 기본 (R1_V2_CONC)',
        };

  const offMain = rows[0][cfg.kMain] - rows[0][cfg.mMain];
  const offMid = rows[0][cfg.kMid] - rows[0][cfg.mMid];
  const offBase = rows[0][cfg.kBase] - rows[0][cfg.mBase];

  const pts = rows.map((r) => ({
    ym: r.ym,
    v2: r.v2_avg,
    regime: r.regime,
    fxNew: r.fx_new_trades,
    momNew: r.new_trades,
    main: r[cfg.kMain] - offMain,
    mid: r[cfg.kMid] - offMid,
    base: r[cfg.kBase] - offBase,
    mMain: r[cfg.mMain],
    mMid: r[cfg.mMid],
    mBase: r[cfg.mBase],
    mFx: r.fx_4b,
    mMom: r.mom_v35,
  }));

  const allVals = pts.flatMap((p) => [0, p.main, p.mid, p.base]);
  const lo = Math.min(0, ...allVals);
  const hi = Math.max(150000, ...allVals);
  const w = 1040,
    h = 295,
    padL = 82,
    padR = 26,
    padT = 40,
    padB = 34;

  const x = (i) => padL + (i * (w - padL - padR)) / Math.max(1, pts.length - 1);
  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const line = (key) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');

  const ticks = [lo, lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.75, hi];
  const last = pts.at(-1);

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="59개월 누적 손익 비교 곡선">
    <g transform="translate(${padL}, 18)" style="font-size:11.5px;font-weight:700;fill:${ink};">
      <line x1="0" y1="-4" x2="20" y2="-4" stroke="#0d9488" stroke-width="3.2"/>
      <text x="25" y="0" fill="${ink}">${cfg.lblMain}: ${fmtUsd(last?.main)}</text>
      <line x1="390" y1="-4" x2="410" y2="-4" stroke="#6366f1" stroke-width="2.1" stroke-dasharray="5 3"/>
      <text x="415" y="0" fill="${ink}">${cfg.lblMid}: ${fmtUsd(last?.mid)}</text>
      <line x1="710" y1="-4" x2="730" y2="-4" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="2 3"/>
      <text x="735" y="0" fill="${ink}">${cfg.lblBase}: ${fmtUsd(last?.base)}</text>
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
        <title>[${p.ym}] v2.0=${p.v2}점 · ${p.regime} · 진입 FX ${p.fxNew}건 / 모멘텀 ${p.momNew}건
★ ${cfg.lblMain}: 누적 ${fmtUsd(p.main)} (당월 ${fmtUsd(p.mMain)})
• ${cfg.lblMid}: 누적 ${fmtUsd(p.mid)} (당월 ${fmtUsd(p.mMid)})
• ${cfg.lblBase}: 누적 ${fmtUsd(p.base)} (당월 ${fmtUsd(p.mBase)})
• 구성 당월: FX 4B ${fmtUsd(p.mFx)} + 모멘텀 v3.5 ${fmtUsd(p.mMom)}</title>
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

  const kVal = mode === 'COMBO' ? 'combo_4b' : mode === 'FX_ONLY' ? 'fx_4b' : 'mom_v35';
  const refLine = mode === 'MOM_ONLY' ? -20000 : -50000;
  const allVals = rows.flatMap((r) => [r[kVal], 0, refLine]);
  const lo = Math.min(refLine * 1.5, ...allVals);
  const hi = Math.max(150000, ...allVals);
  const w = 1040,
    h = 260,
    padL = 82,
    padR = 24,
    padT = 36,
    padB = 34;

  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const y0 = y(0);
  const slotW = (w - padL - padR) / Math.max(1, rows.length);
  const barW = Math.max(3, Math.min(11, slotW * 0.64));

  const ticks = [-200000, -100000, refLine, 0, 100000, 200000, 300000]
    .filter((v, i, arr) => arr.indexOf(v) === i && v >= lo - 15000 && v <= hi + 15000)
    .sort((a, b) => a - b);

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="월별 손익 막대 차트">
    <g transform="translate(${padL}, 18)" style="font-size:12px;font-weight:700;fill:${ink};">
      <rect x="0" y="-11" width="12" height="10" fill="#0d9488" rx="2"/>
      <text x="18" y="-2" fill="${ink}">${mode === 'COMBO' ? '통합 흑자월' : mode === 'FX_ONLY' ? 'FX v2.0 (4B) 흑자월' : '모멘텀 v3.5 흑자월'}</text>
      <rect x="175" y="-11" width="12" height="10" fill="#e11d48" rx="2"/>
      <text x="193" y="-2" fill="${ink}">적자월 (적색 점선: ${fmtUsd(refLine)} 기준)</text>
      <text x="455" y="-2" fill="${ct.muted || '#64748b'}" font-weight="600">※ 각 막대에 마우스를 올리면 당월 FX·모멘텀 손익과 진입 건수를 확인할 수 있습니다</text>
    </g>

    ${ticks
      .map(
        (tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${tv === 0 ? ct.zero : tv === refLine ? '#f43f5e' : ct.grid}" stroke-width="${tv === 0 ? '1.3' : '1'}" stroke-dasharray="${tv === 0 ? 'none' : '3 3'}" opacity="${tv === refLine ? '0.65' : '1'}"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${tv === refLine ? '#e11d48' : ink}" font-size="11" font-weight="600">${tv === 0 ? '$0' : (tv > 0 ? '+$' : '−$') + fmtNum(Math.abs(tv) / 1000, 0) + 'k'}</text>
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
          <rect x="${(cx - slotW / 2).toFixed(1)}" y="${padT}" width="${slotW.toFixed(1)}" height="${h - padT - padB}" fill="transparent">
            <title>[${r.ym}] v2.0=${r.v2_avg}점 · ${r.regime}
★ 통합 (FX 4B + 모멘텀 v3.5): ${fmtUsd(r.combo_4b)} (누적 ${fmtUsd(r.combo_4b_cum)})
• FX v2.0 (4B): ${fmtUsd(r.fx_4b)} (신규 ${r.fx_new_trades}건)
• 모멘텀 v3.5: ${fmtUsd(r.mom_v35)} (신규 ${r.new_trades}건: ${r.entries_desc})</title>
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

function renderDistBar(perf, mode) {
  const isMom = mode === 'MOM_ONLY';
  const b = isMom ? perf.buckets_mom : perf.buckets_combo;
  const items = isMom
    ? [
        { lbl: '≥ +$50k', n: b.ge_50k, col: '#0f766e' },
        { lbl: '+$10k~50k', n: b.p10_50k, col: '#14b8a6' },
        { lbl: '$0~+$10k', n: b.p0_10k, col: '#5eead4' },
        { lbl: '−$10k~$0', n: b.m10_0, col: '#fda4af' },
        { lbl: '−$20k~−$10k', n: b.m20_m10, col: '#fb7185' },
        { lbl: '≤ −$20k', n: b.le_m20k, col: '#e11d48' },
      ]
    : [
        { lbl: '≥ +$200k', n: b.ge_200k, col: '#0f766e' },
        { lbl: '+$100k~200k', n: b.p100_200k, col: '#14b8a6' },
        { lbl: '+$50k~100k', n: b.p50_100k, col: '#2dd4bf' },
        { lbl: '$0~+$50k', n: b.p0_50k, col: '#99f6e4' },
        { lbl: '−$50k~$0', n: b.m50_0, col: '#fda4af' },
        { lbl: '≤ −$50k', n: b.le_m50k, col: '#e11d48' },
      ];
  const tot = Math.max(1, items.reduce((a, x) => a + x.n, 0));
  return `
    <div style="display:flex;height:22px;border-radius:8px;overflow:hidden;gap:2px;margin:8px 0 10px;">
      ${items
        .filter((it) => it.n > 0)
        .map(
          (it) =>
            `<div style="flex:${it.n};background:${it.col};display:flex;align-items:center;justify-content:center;color:${
              it.col === '#5eead4' || it.col === '#99f6e4' || it.col === '#fda4af' ? '#0f172a' : '#fff'
            };font-size:11px;font-weight:700;" title="${it.lbl}: ${it.n}개월 (${((it.n / tot) * 100).toFixed(1)}%)">${it.n}</div>`
        )
        .join('')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:9px;font-size:11.5px;">
      ${items
        .map(
          (it) =>
            `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:${it.col};display:inline-block;"></span>${it.lbl}: <strong>${it.n}개월</strong></span>`
        )
        .join('')}
    </div>
  `;
}

export async function renderMomentumV35(target) {
  target.innerHTML = `<div class="panel"><p class="muted">FX v2.0 (4B) + 모멘텀 v3.5 통합 A-to-Z 및 59개월 분석 데이터를 불러오는 중입니다...</p></div>`;

  let data;
  try {
    data = await loadV35Data();
  } catch (e) {
    target.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`;
    return;
  }

  const hl = data.headline;
  const activePerf =
    portfolioMode === 'COMBO'
      ? hl.combo
      : portfolioMode === 'FX_ONLY'
      ? hl.standalone_fx
      : hl.standalone_mom;

  const allMonths = data.monthly_rows || [];
  const chartMonths = allMonths.filter((m) => yearFilter === 'ALL' || m.year === yearFilter);

  const tableMonths = allMonths.filter((m) => {
    if (yearFilter !== 'ALL' && m.year !== yearFilter) return false;
    const v = portfolioMode === 'COMBO' ? m.combo_4b : portfolioMode === 'FX_ONLY' ? m.fx_4b : m.mom_v35;
    const bigTh = portfolioMode === 'MOM_ONLY' ? 50000 : 150000;
    const sevTh = portfolioMode === 'MOM_ONLY' ? -20000 : -50000;
    if (monthFilter === 'BIG_WIN') return v >= bigTh;
    if (monthFilter === 'LOSS') return v < 0;
    if (monthFilter === 'SEVERE') return v <= sevTh;
    if (monthFilter === 'FX_ZERO') return m.fx_new_trades === 0;
    if (monthFilter === 'MOM_ZERO') return m.new_trades === 0;
    return true;
  });

  const showScheme = sectionTab === 'ALL' || sectionTab === 'SCHEME';
  const showRules = sectionTab === 'ALL' || sectionTab === 'RULES';
  const showMonthly = sectionTab === 'ALL' || sectionTab === 'MONTHLY';
  const showTrades = sectionTab === 'ALL' || sectionTab === 'TRADES';

  const lv2 = data.latest_v2_snapshot || {};
  const v2Info = lv2.v2 || {};
  const mh = hl.mutual_hedge || {};

  const top5List = portfolioMode === 'COMBO' ? data.top5_combo : portfolioMode === 'FX_ONLY' ? data.top5_fx : data.top5_mom;
  const bot5List = portfolioMode === 'COMBO' ? data.bot5_combo : portfolioMode === 'FX_ONLY' ? data.bot5_fx : data.bot5_mom;

  const sumFxNew = tableMonths.reduce((a, r) => a + r.fx_new_trades, 0);
  const sumMomNew = tableMonths.reduce((a, r) => a + r.new_trades, 0);
  const sumFx = tableMonths.reduce((a, r) => a + r.fx_4b, 0);
  const sumMom = tableMonths.reduce((a, r) => a + r.mom_v35, 0);
  const sumCombo = tableMonths.reduce((a, r) => a + r.combo_4b, 0);

  const tradeKpiMain =
    portfolioMode === 'COMBO'
      ? `${hl.fx_trades_entered + hl.mom_trades_total}건 <small style="font-size:13px;">(주 ~1.7건)</small>`
      : portfolioMode === 'FX_ONLY'
      ? `${hl.fx_trades_entered}건 <small style="font-size:13px;">(월 ${hl.fx_trades_per_month}건)</small>`
      : `${hl.mom_trades_total}건 <small style="font-size:13px;">(월 ${hl.mom_trades_per_month}건)</small>`;

  const tradeKpiSub =
    portfolioMode === 'COMBO'
      ? `FX ${hl.fx_trades_entered}건(평균 $${hl.fx_avg_notional_m}M) + 모멘텀 ${hl.mom_trades_total}건 · 일간상관 ${hl.corr_fx_mom}`
      : portfolioMode === 'FX_ONLY'
      ? `1σ=$20k · 1:1 동일금액 · Cap $5M (평균 $${hl.fx_avg_notional_m}M / 중앙 $${hl.fx_med_notional_m}M)`
      : `SHORT ${hl.mom_short_cnt} / LONG ${hl.mom_long_cnt} · 코어 평균보유 ${hl.core_avg_hold_days}일`;

  target.innerHTML = `
    <!-- ===================================================================== -->
    <!-- HERO HEADER & TOP CONTROLS                                            -->
    <!-- ===================================================================== -->
    <div class="panel" style="border-left:4px solid #0d9488;">
      <div class="panel-head" style="flex-wrap:wrap;gap:12px;">
        <div>
          <div class="eyebrow">UNIFIED DESK MASTER · 100% STRICTLY CAUSAL (ZERO LOOKAHEAD · 2022-01 ~ 2026-11 · 59 MONTHS)</div>
          <h2 style="margin:4px 0 6px;">🚀 FX v2.0 (4B: 1σ=$20k · 1:1 · Cap $5M) + 모멘텀 v3.5 통합 A-to-Z &amp; 59개월 분석</h2>
          <p class="muted" style="margin:0;font-size:12.5px;line-height:1.55;">
            중앙 레이더 <strong>FX 스트레스 지수 v2.0</strong>이 <strong>FX 통계적 차익 v2.0 (4B: <code>+$2.88M · Shp 1.40</code>)</strong>과 <strong>금리 모멘텀 v3.5 (<code>+$1.48M · Shp 1.84</code>)</strong>를 시소처럼 교대 가동.<br>
            100% 엄밀 인과(전일 <code>t−1</code> 확정 스케일 고정) 기준 통합 데스크 <strong>+$4,360,231 · MDD −$262,833 · Sharpe 1.99 · Calmar 16.59x · 5년 전승(최장 2연패)</strong> 실증!
          </p>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div class="segmented" role="group" aria-label="분석 대상 선택">
            <button type="button" data-v35-pmode="COMBO" class="${portfolioMode === 'COMBO' ? 'on' : ''}">🔥 통합 데스크 (+$4.36M)</button>
            <button type="button" data-v35-pmode="FX_ONLY" class="${portfolioMode === 'FX_ONLY' ? 'on' : ''}">💱 FX v2.0 4B 단독 (+$2.88M)</button>
            <button type="button" data-v35-pmode="MOM_ONLY" class="${portfolioMode === 'MOM_ONLY' ? 'on' : ''}">🎯 모멘텀 v3.5 단독 (+$1.48M)</button>
          </div>
          <button type="button" id="v35-export-csv" class="btn quiet">↓ 59개월 CSV</button>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="stats" style="margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));">
        <div class="stat">
          <div class="label">총 누적 순손익 (59개월)</div>
          <div class="num green">${fmtUsd(activePerf.total_net)}</div>
          <div class="help">✅ 5개년 전 연도 흑자 · 월평균 ${fmtUsd(activePerf.avg_month)}</div>
        </div>
        <div class="stat">
          <div class="label">최대 낙폭 (MDD) / Calmar</div>
          <div class="num" style="color:#2563eb;">−$${fmtNum(activePerf.mdd)} <small style="font-size:13px;">(${activePerf.calmar}x)</small></div>
          <div class="help">23~25 박스 3년 합계 ${fmtUsd(activePerf.box_23_25)}</div>
        </div>
        <div class="stat">
          <div class="label">Sharpe / 월간 손익비</div>
          <div class="num green">${activePerf.sharpe} <small style="font-size:13px;">(${activePerf.monthly_payoff}x)</small></div>
          <div class="help">수익월 ${fmtUsd(activePerf.avg_win_month)} / 손실월 ${fmtUsd(activePerf.avg_loss_month)}</div>
        </div>
        <div class="stat">
          <div class="label">월간 승률 / 최장 연패</div>
          <div class="num green">${activePerf.win_months}/59 <small style="font-size:13px;">(${activePerf.win_months_pct}%)</small></div>
          <div class="help">최장 <strong>${activePerf.max_win_streak}연승</strong> / 최장 <strong>${activePerf.max_loss_streak}연패</strong> · ${
            portfolioMode === 'MOM_ONLY' ? `−$20k↓ ${activePerf.loss20k_months}개월` : `−$50k↓ ${activePerf.loss50k_months}개월`
          }</div>
        </div>
        <div class="stat">
          <div class="label">실거래 빈도 · 리스크 단위</div>
          <div class="num">${tradeKpiMain}</div>
          <div class="help">${tradeKpiSub}</div>
        </div>
      </div>

      <!-- Sub-section Jump Tabs -->
      <div class="filters" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border,rgba(148,163,184,0.22));justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div class="segmented" role="group" aria-label="섹션 필터">
          ${[
            ['ALL', '📚 전체 보기'],
            ['SCHEME', '① FX v2.0 지수 & 시소 스킴'],
            ['RULES', '② FX 4B & 모멘텀 v3.5 A-to-Z'],
            ['MONTHLY', '③ 59개월 손익 차트 & 표'],
            ['TRADES', '④ 거래건수·진화·기각 팩터'],
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
      showScheme
        ? `
    <!-- ===================================================================== -->
    <!-- PART 1: FX STRESS INDEX v2.0 FORMULAS & SEESAW OPERATING SCHEME       -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head">
        <div>
          <div class="eyebrow">PART 1 · FX STRESS INDEX v2.0 &amp; UNIFIED SEESAW OPERATING SCHEME</div>
          <h2>1. 중앙 기상 레이더(FX v2.0) 계산 공식 &amp; 통합 시소(Seesaw) 운용 스킴</h2>
        </div>
        ${
          v2Info.score != null
            ? `<span class="tag primary" style="font-size:12px;">최근 기준일(${esc(lv2.date || '2026-11-16')}) v2.0 = ${fmtNum(v2Info.score, 1)}점 (P1:${fmtNum(v2Info.p1_eff, 1)} / P2:${fmtNum(v2Info.p2_rv_break ?? v2Info.p2_rv, 1)} / P3:${fmtNum(v2Info.p3_coherence ?? v2Info.p3_coh, 1)})</span>`
            : ''
        }
      </div>

      <!-- 4-Weather Seesaw Operating Matrix -->
      <h3 style="margin:6px 0 8px;font-size:14px;">⚖️ 시장 날씨(<code>전일 확정 v2.0</code>)별 두 엔진 자동 교대(시소) 운용 매트릭스</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>시장 날씨 (전일 t−1 확정)</th>
              <th>엔진 A · FX 통계적 차익 v2.0 (<code>4B</code>)</th>
              <th>엔진 B · 금리 모멘텀 v3.5</th>
              <th>데스크 운용 컨셉</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong style="color:#64748b;">① 초저변동 안개장</strong><div class="pair-sub"><code>v2 &lt; 24점</code></div></td>
              <td><span class="tag block">🛑 신규 진입 중단</span><div class="pair-sub">보유분만 <code>0.45x</code> 축소 관리</div></td>
              <td><span class="tag">🛡️ 스나이퍼 극소액 방어</span><div class="pair-sub">4/6 지평 동시 동의 시만 · +0.28R 잠금</div></td>
              <td style="font-size:12px;">변동성 분모 수축으로 가짜 Z·돌파 신호 다발 — <strong>둘 다 몸 사리는 구간</strong> (예: 2025-07~08)</td>
            </tr>
            <tr style="background:rgba(13,148,136,0.06);">
              <td><strong style="color:#0d9488;">② 정상 박스권</strong><div class="pair-sub"><code>24 ≤ v2 &lt; 38점</code></div></td>
              <td><span class="tag primary">🟢 메인 풀가동 (1.25x)</span><div class="pair-sub">최대 6페어 · <code>|Z|≥2.2</code> · 1σ=$20k (1:1)</div></td>
              <td><span class="tag">🛡️ 박스 방어 · 수익잠금</span><div class="pair-sub">단, 채권 독자 추세(<code>ER≥0.26</code>)면 고립추세 허용</div></td>
              <td style="font-size:12px;"><strong>FX v2.0이 꾸준한 현금흐름을 쓸어 담는 메인 무대</strong> (2023~2025 박스 3년 FX +$2.28M)</td>
            </tr>
            <tr>
              <td><strong style="color:#d97706;">③ 추세 형성·교차장</strong><div class="pair-sub"><code>38 ≤ v2 &lt; 56점</code></div></td>
              <td><span class="tag hold">🟡 1.25x → 붕괴징후 시 0.65x 감속</span><div class="pair-sub"><code>v2≥44 ∧ (P2≥13.5 ∨ Tail≥24%)</code></div></td>
              <td><span class="tag hold">🟠 추세 가속 (1.25x ~ 1.48x)</span><div class="pair-sub">멀티테너 동조 가속 · 피로 시 즉시 잠금</div></td>
              <td style="font-size:12px;"><strong>FX → 모멘텀 바통 터치 구간</strong> — 두 엔진이 보완적으로 병행 가동</td>
            </tr>
            <tr style="background:rgba(220,38,38,0.05);">
              <td><strong style="color:#dc2626;">④ 매크로 폭풍장</strong><div class="pair-sub"><code>v2 ≥ 56</code> 또는 <code>P2≥16∧USD동조≥0.44</code></div></td>
              <td><span class="tag block">🛑 신규 진입 전면 중단</span><div class="pair-sub">보유분 <code>0.35x</code> 축소 + $20k 하드캡 엄수</div></td>
              <td><span class="tag primary" style="background:#dc2626;color:#fff;border-color:#dc2626;">🔴 최대 화력 (1.58x ~ 1.90x)</span><div class="pair-sub">코어 100% · +0.90R 유예 → +1.35R 러너 연장</div></td>
              <td style="font-size:12px;"><strong>모멘텀 v3.5 대박 구간</strong> — FX 출혈은 원천 차단 (예: 2022년, 2026-03/09)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Daily 3-Step Routine -->
      <h3 style="margin:16px 0 8px;font-size:14px;">🗓️ 매일 아침 실전 데스크 3-Step 운용 루틴 (주당 평균 약 1.7건 저빈도 스윙)</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:10px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;color:#0d9488;margin-bottom:4px;">Step 1 · 오전 8시 날씨(v2.0) 확정</div>
          전일(<code>t−1</code>) 확정 종가로 계산된 <strong>FX 스트레스 v2.0 점수 · P2 · Tail · 5D/10D 기울기</strong>를 확인해 오늘 하루의 FX 허용 여부·배수 및 모멘텀 국면을 고정합니다. <em>(장중 변동으로 당일 배수를 소급 변경하지 않는 100% 인과 원칙)</em>
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;color:#2563eb;margin-bottom:4px;">Step 2 · FX v2.0 (4B) 집행 (월 ~5.7건)</div>
          허용 구간(<code>24≤v2&lt;56</code>) + 빈 슬롯(최대 6개, 통화당 최대 2개)일 때 <code>|Z|≥2.2</code> 후보 중 <code>|Z|×(0.5+0.5|Corr|)</code> 상위 진입.<br>
          <strong>명목 = min($5M, $20,000 ÷ 1σ%) × 배수</strong> (Leg1=Leg2 1:1 롱숏). 청산: <code>|Z|≤0.5</code> 익절 / <strong>−$20k 하드캡</strong> / <code>|Z|≥4.0</code> / <strong>20일 적자 타임스탑</strong>.
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;color:#dc2626;margin-bottom:4px;">Step 3 · 모멘텀 v3.5 집행 (월 ~1.4건)</div>
          US 1종목 + DE 1종목. <strong>SHORT→W3(TY는 W7) · LONG→W7(65%)+Sniper(35%)</strong>.<br>
          <code>10D</code> 돌파 1/3 (Tier-1 이벤트 D-1 신규진입 1/3 상한) → <code>20D</code> 2/3 → 멀티동조 3/3 × 국면배수. 손절 <code>2.5SD</code> + <code>3~5일</code> 타임스탑 + 국면별 잠금/러너 청산.
        </div>
      </div>

      <!-- 3-Pillar Formula Cards -->
      <h3 style="margin:16px 0 8px;font-size:14px;">📐 FX 스트레스 지수 v2.0 3대 기둥 계산 공식 (0 ~ 100점)</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;background:var(--surface-2,rgba(248,250,252,0.5));">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:#0d9488;">기둥 ① P1 · 시장 추세 효율성</strong><span class="tag primary">최대 40점</span>
          </div>
          <div style="font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--surface,#fff);padding:8px;border-radius:6px;border:1px solid var(--border,rgba(148,163,184,0.22));line-height:1.55;">
            ER20 = |Close(t)−Close(t−20)| / Σ|ΔClose|<br>
            TrendEff = ER20 × (0.45 + 0.55×|S0|) [금리60%+FX40%]<br>
            <strong>P1 = 25×norm(TrendEff, 0.14→0.34) + 15×norm(VR10, 0.88→1.25)</strong>
          </div>
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;background:var(--surface-2,rgba(248,250,252,0.5));">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:#2563eb;">기둥 ② P2 · FX 평균회귀 붕괴도</strong><span class="tag shadow">최대 30점</span>
          </div>
          <div style="font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--surface,#fff);padding:8px;border-radius:6px;border:1px solid var(--border,rgba(148,163,184,0.22));line-height:1.55;">
            정상 페어(<code>0.4≤|β|≤1.6</code>) 한정 (BETA_BLOCK 제외)<br>
            <strong>P2 = 14×norm(PureTail, 6→28%) + 8×norm(P75_HL, 4.8→7.5d) + 8×norm(Drift, 0.07→0.26)</strong>
          </div>
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;background:var(--surface-2,rgba(248,250,252,0.5));">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:#d97706;">기둥 ③ P3 · 글로벌 매크로 동조성</strong><span class="tag hold">최대 30점</span>
          </div>
          <div style="font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--surface,#fff);padding:8px;border-radius:6px;border:1px solid var(--border,rgba(148,163,184,0.22));line-height:1.55;">
            USD_Coh (7개 FX선물 USD쏠림) + Curve_Coh (US/DE 6만기)<br>
            <strong>P3 = 14×norm(USD, 0.24→0.68) + 16×norm(Curve, 0.42→0.82)</strong><br>
            <strong>최종 v2.0(t) = 0.55×Raw(t) + 0.45×v2.0(t−1)</strong> (3일 EMA)
          </div>
        </div>
      </div>
    </div>
    `
        : ''
    }

    ${
      showRules
        ? `
    <!-- ===================================================================== -->
    <!-- PART 2: FX 4A->4B EVOLUTION & MOMENTUM v3.5 EXECUTION RULES A-TO-Z    -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head">
        <div>
          <div class="eyebrow">PART 2 · FX v2.0 (4A → 2A → 2B → 4B) &amp; MOMENTUM v3.5 A-TO-Z RULES</div>
          <h2>2. FX 통계적 차익 4단계 진화 (<code>4A → 4B</code>) &amp; 모멘텀 v3.5 매매 규칙 A-to-Z</h2>
        </div>
      </div>

      <!-- FX 4A -> 2A -> 2B -> 4B Side-by-Side Comparison -->
      <h3 style="margin:6px 0 8px;font-size:14px;">💱 FX 통계적 차익 4단계 비교 (공통: 유저 원설계 <code>1σ = $20,000</code> 역산 · 1:1 동일금액 · −$20k 하드캡 · |Z|≤0.5 익절)</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>구분</th>
              <th>4A. 원설계 정적</th>
              <th>2A. 원설계 + <code>DEF2_CAUSAL</code></th>
              <th>2B. 원설계 + <code>BOX</code> + <code>Time20d</code></th>
              <th style="background:rgba(13,148,136,0.12);">★ 4B. FX v2.0 최종 제안</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>한 줄 요약</strong></td>
              <td>원래 설계 그대로 (필터 없음)</td>
              <td>원래 설계 + 위험 시 사이즈만 감속</td>
              <td>원래 설계 + 안 좋은 장 진입중단·20일컷</td>
              <td style="background:rgba(13,148,136,0.06);"><strong>2B에서 진입 기준만 Z 2.2로 개방</strong></td>
            </tr>
            <tr>
              <td><strong>진입 <code>|OOS Z|</code> / Z-손절</strong></td>
              <td><code>≥ 2.7</code> / <code>3.7</code></td>
              <td><code>≥ 2.7</code> / <code>3.7</code></td>
              <td><code>≥ 2.7</code> / <code>3.7</code></td>
              <td style="background:rgba(13,148,136,0.06);"><strong><code>≥ 2.2</code> / <code>4.0</code></strong> <span class="muted">(−$20k 하드캡 동일)</span></td>
            </tr>
            <tr>
              <td><strong>최대 슬롯 / 명목 상한</strong></td>
              <td>5개 / <code>$5M</code></td>
              <td>5개 / <code>$8M</code></td>
              <td>6개 / <code>$8M</code></td>
              <td style="background:rgba(13,148,136,0.06);"><strong>6개 / <code>$5M</code></strong> (실전 체결 상한)</td>
            </tr>
            <tr>
              <td><strong>후보 우선순위</strong></td>
              <td><code>|Z|</code> 큰 순</td>
              <td><code>|Z| × Corr</code> 가중</td>
              <td><code>|Z| × Corr</code> 가중</td>
              <td style="background:rgba(13,148,136,0.06);"><strong><code>|Z| × (0.5+0.5|Corr|)</code></strong></td>
            </tr>
            <tr>
              <td><strong>레짐 연동 (<code>v2.0</code>)</strong></td>
              <td>없음 (항상 1.0x)</td>
              <td>감속 배수만 (0.35~1.10x)</td>
              <td><code>BOX_FOCUS</code> (DZ·L3 차단 / 박스 1.25x)</td>
              <td style="background:rgba(13,148,136,0.06);"><strong><code>BOX_FOCUS</code> (DZ·L3 차단 / 박스 1.25x)</strong></td>
            </tr>
            <tr>
              <td><strong>미회귀 타임스탑</strong></td>
              <td>없음 (35일 만기)</td>
              <td>없음 (35일 만기)</td>
              <td><strong>20영업일</strong> 적자 시 정리</td>
              <td style="background:rgba(13,148,136,0.06);"><strong>20영업일</strong> 적자 시 정리</td>
            </tr>
            <tr>
              <td><strong>59개월 성과 (FX 단독)</strong></td>
              <td><strong>+$1,429k</strong> · MDD −$469k<br>Shp 0.80 · 316건 ❌</td>
              <td><strong>+$930k</strong> · MDD −$255k<br>Shp 0.84 · 315건 ❌</td>
              <td><strong>+$1,304k</strong> · MDD −$467k<br>Shp 0.85 · 179건 ❌</td>
              <td style="background:rgba(13,148,136,0.08);"><strong class="green">+$2,878k · MDD −$268k</strong><br><strong class="green">Shp 1.40 · Clm 10.75x · 336건 ✅5년전승</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="rule-note" style="margin-top:8px;">
        💡 <strong>왜 <code>Z ≥ 2.7</code>(2B)에서 <code>Z ≥ 2.2</code>(4B)로 완화할 때 수익이 2배(+1.30M → +2.88M)로 뛰는가?</strong><br>
        과거에는 위기장 필터가 없어 보수적으로 <code>2.7</code>까지 기다려야 했지만, <code>BOX_FOCUS</code>로 데드존(<code>&lt;24</code>)과 위기장(<code>≥56</code>)을 먼저 차단하면 정상 박스권에서 <code>2.7</code>은 신호가 반토막(179건) 나고 오히려 추세 이탈 꼬리만 역선택하게 됩니다. 안전한 박스권 안에서 <code>2.2</code>부터 포착하면 건강한 평균회귀(336건)를 온전히 수확하며, <strong>−$20,000 달러 하드캡</strong>이 생명줄 역할을 해(하드캡 미적용 <code>1B</code>는 22년 −$1.39M 폭사) 손익비 ~2:1을 완성합니다.
      </div>

      <!-- Momentum v3.5 3 Core Innovations -->
      <h3 style="margin:18px 0 8px;font-size:14px;">🎯 모멘텀 v3.5 핵심 혁신 3가지 &amp; 8대 국면별 통합 실적 기여</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin-bottom:12px;">
        <div style="border:1px solid rgba(13,148,136,0.35);border-radius:10px;padding:12px;font-size:12.5px;line-height:1.55;">
          <div style="font-weight:800;color:#0d9488;margin-bottom:4px;">① 방향 비대칭 라우팅</div>
          • <strong>SHORT(금리상승)</strong> → <code>W3 고속</code> (62건 WR 59.7%, +$969k)<br>
          • <strong>LONG(금리하락)</strong> → <code>W7 65% + Sniper 35%</code> (기존 W3 LONG −$72k 적자 → 흑자 전환)
        </div>
        <div style="border:1px solid rgba(37,99,235,0.35);border-radius:10px;padding:12px;font-size:12.5px;line-height:1.55;">
          <div style="font-weight:800;color:#2563eb;margin-bottom:4px;">② 테너 품질 분리 (<code>TY → W7</code>)</div>
          • <strong>TU·DU·FV·RX</strong>: W3 고속 SHORT 주력 (TU+DU가 수익 69%)<br>
          • <strong>TY(미 10Y)</strong>: W3 유일 적자 테너(−$20k) → <code>W7 완속 전용</code> 이관 (+$38k)
        </div>
        <div style="border:1px solid rgba(124,58,237,0.35);border-radius:10px;padding:12px;font-size:12.5px;line-height:1.55;">
          <div style="font-weight:800;color:#7c3aed;margin-bottom:4px;">③ 2024 과민반응 교정 방어①</div>
          • 이중 기간 피로(<code>Δ5D&lt;−4.5 ∧ Δ10D&lt;−3.0</code>)로 건전한 숨고르기 보호<br>
          • <strong>고립 채권 추세(<code>IsoTrend</code>)</strong> 예외(<code>ER≥0.26 ∧ |S0|≥0.55</code>) → 2024년 −$77k → +$40k 반전
        </div>
      </div>

      <!-- 8-Regime Matrix with BOTH Mom & FX PnL! -->
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>국면 (Regime)</th>
              <th>발동 조건 (t−1)</th>
              <th>두 엔진 기어 (배수)</th>
              <th class="number">발생일수</th>
              <th class="number">FX 4B 기여</th>
              <th class="number">모멘텀 v3.5 기여</th>
              <th class="number">통합 합계</th>
            </tr>
          </thead>
          <tbody>
            ${(data.regime_summary || [])
              .map(
                (rg) => `<tr>
                <td>${regimeBadge(rg.code)} <strong style="font-size:12px;margin-left:3px;">${esc(rg.name)}</strong></td>
                <td style="font-size:11.5px;"><code>${esc(rg.condition)}</code></td>
                <td style="font-size:11.5px;">${esc(rg.multiplier)}</td>
                <td class="number">${rg.days}일 <span class="muted">(${rg.days_pct}%)</span></td>
                <td class="number ${clsPnl(rg.fx_pnl)}">${fmtUsd(rg.fx_pnl)}</td>
                <td class="number ${clsPnl(rg.mom_pnl)}">${fmtUsd(rg.mom_pnl)}</td>
                <td class="number ${clsPnl(rg.combo_pnl)}"><strong>${fmtUsd(rg.combo_pnl)}</strong></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Momentum Lifecycle 6-Step Cards -->
      <h3 style="margin:16px 0 8px;font-size:14px;">⚙️ 모멘텀 v3.5 포지션 라이프사이클 6단계 (진입 → 증액 → 감액 → 손절 → 잠금/익절 → 청산)</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:10px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:11px;font-size:12px;line-height:1.58;">
          <strong>1️⃣ 진입</strong>: <code>S0 = 0.70×Disp + 0.30×MA</code> · 10D 돌파 + MA20/60/120 정배열 · 1차 선발대 <strong>1/3 ($11.7k)</strong> · <span style="color:#d97706;">FOMC/CPI/NFP D-1 신규진입 1/3 상한</span>
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:11px;font-size:12px;line-height:1.58;">
          <strong>2️⃣ 증액</strong>: 20D 돌파+수익권 → <strong>2/3 ($23.3k)</strong> · 멀티테너 동조(<code>|S0|≥0.48</code>) → <strong>3/3 ($35k)</strong> × 국면배수 (L2 <code>1.25~1.48x</code> / L3 <code>1.58~1.90x</code>)
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:11px;font-size:12px;line-height:1.58;">
          <strong>3️⃣ 감액</strong>: <code>|S0|</code> 둔화 시 1/3 축소 · L2/L3 추세 피로(<code>Fatigue</code>) 감지 시 공격배수 해제 → <code>Fast 3-Beat + Sniper</code> 수익잠금 모드 전환
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:11px;font-size:12px;line-height:1.58;">
          <strong>4️⃣ 손절</strong>: 진입가 대비 <strong>2.5 × SD20</strong> 장중 하드스탑 · <strong>3~5영업일</strong>(국면별 4~7일) 내 최고 평가익 <code>+0.16R</code> 미달 시 타임스탑
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:11px;font-size:12px;line-height:1.58;">
          <strong>5️⃣ 잠금·익절</strong>: 박스/피로장 <strong>+0.28R → +0.14R 잠금</strong> · L2 추세장 <strong>+0.90R 50% 반익절+BE</strong> · L3 폭풍장 <strong>+0.90R 유예(BE) → +1.35R 연장</strong>
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:11px;font-size:12px;line-height:1.58;">
          <strong>6️⃣ 청산·재진입</strong>: 잔여 러너 <strong>10D 반대채널</strong> 종가 이탈 시 청산 · MA60 대추세 유지 + MA20 지지 반등 시 <strong>2/3 눌림목 재진입</strong> (L2/L3 허용)
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
    <!-- PART 3: 59-MONTH CHARTS, MUTUAL HEDGE & FULL MONTHLY TABLE            -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head" style="flex-wrap:wrap;gap:10px;">
        <div>
          <div class="eyebrow">PART 3 · 59-MONTH PNL TRAJECTORY (100% STRICTLY CAUSAL · 2022-01 ~ 2026-11)</div>
          <h2>3. 59개월 누적·월별 손익 추이 (${yearFilter === 'ALL' ? '전체 59개월' : yearFilter + '년'} · ${
            portfolioMode === 'COMBO' ? '통합 FX 4B + 모멘텀 v3.5' : portfolioMode === 'FX_ONLY' ? 'FX v2.0 (4B) 단독' : '모멘텀 v3.5 단독'
          })</h2>
        </div>
      </div>

      <div style="margin-top:6px;">${renderEquitySvg(chartMonths, portfolioMode)}</div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border,rgba(148,163,184,0.2));">${renderMonthlyBarSvg(chartMonths, portfolioMode)}</div>

      <!-- Distribution, Mutual Hedge & Extreme Months -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:14px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;">
          <div style="font-weight:800;font-size:13px;">📊 월간 손익 분포 &amp; 상호 헤지 실증</div>
          ${renderDistBar(activePerf, portfolioMode)}
          <div style="font-size:11.5px;margin-top:8px;line-height:1.6;" class="muted">
            • <strong>모멘텀 손실월 ${mh.mom_loss_months}개월 중 ${mh.mom_rescued_by_fx}개월</strong>을 FX 4B가 흑자 전환 (24-12·24-06은 통합 Top 3·4로 역전)<br>
            • <strong>FX 손실월 ${mh.fx_loss_months}개월 중 ${mh.fx_rescued_by_mom}개월</strong>을 모멘텀이 흑자 전환 (2022년 통합 11승 1패!)
          </div>
        </div>

        <div style="border:1px solid rgba(13,148,136,0.3);border-radius:10px;padding:12px;">
          <div style="font-weight:800;font-size:13px;color:#0d9488;margin-bottom:6px;">🏆 최우수 5개월 (${portfolioMode === 'COMBO' ? '통합 기준' : portfolioMode === 'FX_ONLY' ? 'FX 4B 기준' : '모멘텀 v3.5 기준'})</div>
          <div style="font-size:12px;line-height:1.7;">
            ${(top5List || [])
              .map(
                (r, idx) =>
                  `<div style="display:flex;justify-content:space-between;gap:8px;">
                    <span><strong>${idx + 1}. ${r.ym}</strong> ${regimeBadge(r.regime)}</span>
                    <span><strong class="green">${fmtUsd(portfolioMode === 'COMBO' ? r.combo_4b : portfolioMode === 'FX_ONLY' ? r.fx_4b : r.mom_v35)}</strong> <span class="muted">(FX ${fmtUsd(r.fx_4b)} / 모멘 ${fmtUsd(r.mom_v35)})</span></span>
                  </div>`
              )
              .join('')}
          </div>
        </div>

        <div style="border:1px solid rgba(225,29,72,0.3);border-radius:10px;padding:12px;">
          <div style="font-weight:800;font-size:13px;color:#e11d48;margin-bottom:6px;">🛡️ 최악 5개월 (${portfolioMode === 'COMBO' ? '통합 기준' : portfolioMode === 'FX_ONLY' ? 'FX 4B 기준' : '모멘텀 v3.5 기준'})</div>
          <div style="font-size:12px;line-height:1.7;">
            ${(bot5List || [])
              .map(
                (r, idx) =>
                  `<div style="display:flex;justify-content:space-between;gap:8px;">
                    <span><strong>${idx + 1}. ${r.ym}</strong> ${regimeBadge(r.regime)}</span>
                    <span><strong class="red">${fmtUsd(portfolioMode === 'COMBO' ? r.combo_4b : portfolioMode === 'FX_ONLY' ? r.fx_4b : r.mom_v35)}</strong> <span class="muted">(FX ${fmtUsd(r.fx_4b)} / 모멘 ${fmtUsd(r.mom_v35)})</span></span>
                  </div>`
              )
              .join('')}
          </div>
        </div>
      </div>

      <!-- Full 59-Month Matrix Table -->
      <div class="panel-head" style="margin-top:18px;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0;font-size:14.5px;">📅 59개월 월별 손익추이 &amp; 거래건수 전체 매트릭스 (${tableMonths.length}개월 표시)</h3>
        <div class="segmented" role="group" aria-label="월별 상세 필터">
          ${[
            ['ALL', '전체'],
            ['BIG_WIN', portfolioMode === 'MOM_ONLY' ? '★ 대승(+$50k↑)' : '★ 대승(+$150k↑)'],
            ['LOSS', '적자월'],
            ['SEVERE', portfolioMode === 'MOM_ONLY' ? '▼ −$20k↓' : '▼ −$50k↓'],
            ['FX_ZERO', 'FX 휴식(0건)'],
            ['MOM_ZERO', '모멘텀 0건'],
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
              <th class="number">FX 진입</th>
              <th class="number">모멘 진입</th>
              <th>모멘텀 진입 종목</th>
              <th class="number">FX v2.0 (4B)</th>
              <th class="number">FX 누적</th>
              <th class="number">모멘텀 v3.5</th>
              <th class="number">통합 당월</th>
              <th class="number">통합 누적</th>
              <th class="number">통합 DD</th>
            </tr>
          </thead>
          <tbody>
            ${tableMonths
              .map(
                (r) => `<tr style="${r.combo_4b >= 150000 ? 'background:rgba(13,148,136,0.06);' : r.combo_4b <= -50000 ? 'background:rgba(225,29,72,0.06);' : ''}">
                <td><strong>${r.ym}</strong></td>
                <td class="number">${fmtNum(r.v2_avg, 1)}</td>
                <td>${regimeBadge(r.regime)}</td>
                <td class="number">${r.fx_new_trades === 0 ? '<span class="muted">0건(휴식)</span>' : `<strong>${r.fx_new_trades}건</strong>`}</td>
                <td class="number">${r.new_trades}건</td>
                <td style="font-size:11px;font-family:ui-monospace,Consolas,monospace;">${esc(r.entries_desc)}</td>
                <td class="number ${clsPnl(r.fx_4b)}"><strong>${fmtUsd(r.fx_4b)}</strong></td>
                <td class="number muted">${fmtUsd(r.fx_4b_cum)}</td>
                <td class="number ${clsPnl(r.mom_v35)}">${fmtUsd(r.mom_v35)}</td>
                <td class="number ${clsPnl(r.combo_4b)}"><strong>${fmtUsd(r.combo_4b)}</strong>${r.combo_4b >= 150000 ? ' ★' : r.combo_4b <= -50000 ? ' ▼' : ''}</td>
                <td class="number"><strong>${fmtUsd(r.combo_4b_cum)}</strong></td>
                <td class="number ${r.combo_4b_dd < 0 ? 'red' : 'muted'}">${r.combo_4b_dd === 0 ? '$0' : fmtUsd(r.combo_4b_dd)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
          <tfoot style="position:sticky;bottom:0;background:var(--surface-2,#f8fafc);font-weight:800;">
            <tr>
              <td colspan="3">선택 구간 합계 (${tableMonths.length}개월)</td>
              <td class="number">${sumFxNew}건</td>
              <td class="number">${sumMomNew}건</td>
              <td class="muted" style="font-size:11px;">FX ${(sumFxNew / Math.max(1, tableMonths.length)).toFixed(1)}/월 · 모멘 ${(sumMomNew / Math.max(1, tableMonths.length)).toFixed(2)}/월</td>
              <td class="number ${clsPnl(sumFx)}">${fmtUsd(sumFx)}</td>
              <td class="number">—</td>
              <td class="number ${clsPnl(sumMom)}">${fmtUsd(sumMom)}</td>
              <td class="number ${clsPnl(sumCombo)}">${fmtUsd(sumCombo)}</td>
              <td class="number">—</td>
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
    <!-- PART 4: ANNUAL SUMMARY, EVOLUTION TABLES, TENORS & REJECTED ARCHIVE   -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head">
        <div>
          <div class="eyebrow">PART 4 · ANNUAL BREAKDOWN · FX &amp; MOMENTUM EVOLUTION · TENOR &amp; REJECTED AUDIT</div>
          <h2>4. 연도별 거래·손익 · FX/모멘텀/통합 진화 비교 · 테너 분해 · 실증 기각 아카이브</h2>
        </div>
      </div>

      <!-- Annual Summary -->
      <h3 style="margin:6px 0 8px;font-size:14px;">📆 연도별 거래건수 &amp; 손익 요약 (매년 통합 최소 +$656k ~ +$1,199k · 5년 전승)</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>연도</th>
              <th class="number">v2 평균</th>
              <th class="number">FX 신규 (월)</th>
              <th class="number">FX 원설계(4A)</th>
              <th class="number">★ FX v2.0(4B)</th>
              <th class="number">모멘 신규 (S/L)</th>
              <th class="number">★ 모멘텀 v3.5</th>
              <th class="number">★ 통합 (4B+v3.5)</th>
              <th class="number">통합 승월</th>
            </tr>
          </thead>
          <tbody>
            ${(data.annual_summary || [])
              .map(
                (a) => `<tr>
                <td><strong>${a.year}년</strong> ${a.year === '2026' ? '<span class="muted" style="font-size:11px;">(~11월)</span>' : ''}</td>
                <td class="number">${fmtNum(a.v2_avg, 1)}점</td>
                <td class="number"><strong>${a.fx_new_trades}건</strong> <span class="muted">(${a.fx_per_month})</span></td>
                <td class="number ${clsPnl(a.fx_4a)}">${fmtUsd(a.fx_4a)}</td>
                <td class="number ${clsPnl(a.fx_4b)}"><strong>${fmtUsd(a.fx_4b)}</strong></td>
                <td class="number"><strong>${a.mom_new_trades}건</strong> <span class="muted">(${a.short_trades}/${a.long_trades})</span></td>
                <td class="number ${clsPnl(a.mom_v35)}"><strong>${fmtUsd(a.mom_v35)}</strong></td>
                <td class="number ${clsPnl(a.combo_4b)}"><strong>${fmtUsd(a.combo_4b)}</strong></td>
                <td class="number"><strong>${a.combo_win_months}/${a.months}</strong></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Full Evolution Comparison: FX + Momentum + Integrated -->
      <h3 style="margin:18px 0 8px;font-size:14px;">📈 100% 엄밀 인과 진화 비교표 (FX 1σ=$20k 1:1 기준 · 모멘텀 v3.5 · 통합 포트폴리오)</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>모델 / 전략 버전</th>
              <th class="number">총 순손익</th>
              <th class="number">MDD</th>
              <th class="number">Sharpe</th>
              <th class="number">Calmar</th>
              <th class="number">월승률</th>
              <th class="number">23~25 박스권</th>
              <th>5년 전승</th>
            </tr>
          </thead>
          <tbody>
            ${[...(data.fx_evolution || []), ...(data.mom_evolution || []), ...(data.combo_evolution || [])]
              .map((ev) => {
                const isStar = ev.key === 'fx_4b' || ev.key === 'mom_v35_core' || ev.key === 'combo_4b';
                return `<tr style="${isStar ? 'background:rgba(13,148,136,0.09);font-weight:700;' : ''}">
                  <td>${esc(ev.label)}</td>
                  <td class="number ${clsPnl(ev.total_net)}"><strong>${fmtUsd(ev.total_net)}</strong></td>
                  <td class="number red">−$${fmtNum(ev.mdd)}</td>
                  <td class="number"><strong>${ev.sharpe}</strong></td>
                  <td class="number">${ev.calmar}x</td>
                  <td class="number">${ev.win_months}/59 (${ev.win_months_pct}%)</td>
                  <td class="number ${clsPnl(ev.box_23_25)}">${fmtUsd(ev.box_23_25)}</td>
                  <td>${ev.all_5_years_positive ? '<span class="tag primary">✅ 5년 전승</span>' : '<span class="tag block">일부 적자</span>'}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>

      <!-- Momentum Core Routes & Tenor Forensics -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:16px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;">
          <h3 style="margin:0 0 8px;font-size:13.5px;">🧭 모멘텀 v3.5 코어 비대칭 라우팅 (${hl.core_trades_total}건 · 승률 ${hl.core_win_rate_pct}%)</h3>
          <div class="table-scroll">
            <table>
              <thead><tr><th>라우팅 경로</th><th class="number">건수</th><th class="number">승률</th><th class="number">보유</th><th class="number">원시 순손익</th></tr></thead>
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
            모멘텀 월별 진입 빈도: <strong>0건 ${hl.mom_entry_freq['0'] || 0}개월</strong> · <strong>1건 ${hl.mom_entry_freq['1'] || 0}개월</strong> · <strong>2건 ${hl.mom_entry_freq['2'] || 0}개월</strong> · <strong>3건 ${hl.mom_entry_freq['3'] || 0}개월</strong>
          </div>
        </div>

        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;">
          <h3 style="margin:0 0 8px;font-size:13.5px;">🎯 금리 5대 핵심 테너별 건수 &amp; W3 vs W7 실증</h3>
          <div class="table-scroll">
            <table>
              <thead><tr><th>테너</th><th class="number">v3.5 (S/L)</th><th class="number">W3(R1) 순손익</th><th class="number">W7(R2) 순손익</th></tr></thead>
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
        </div>
      </div>

      <!-- Rejected Factors Archive -->
      <h3 style="margin:18px 0 8px;font-size:14px;">🧪 실증 검증 후 기각·교정한 팩터 아카이브 (과최적화 &amp; 선행 오류 방지 기록)</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>테스트 항목</th><th>실증 결과</th><th>판정</th><th>기각·교정 사유</th></tr></thead>
          <tbody>
            ${(data.rejected_factors || [])
              .map(
                (rf) => `<tr>
                <td><strong>${esc(rf.factor)}</strong></td>
                <td style="font-size:12px;"><code>${esc(rf.result)}</code></td>
                <td><span class="tag ${rf.verdict.includes('기각') ? 'block' : 'hold'}">${esc(rf.verdict)}</span></td>
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

  // Bind controls
  target.querySelectorAll('[data-v35-pmode]').forEach((b) => {
    b.onclick = () => {
      portfolioMode = b.dataset.v35Pmode;
      monthFilter = 'ALL';
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
      downloadCsv('fx-v2-4b-plus-momentum-v35-59months.csv', [
        [
          'year_month', 'v2_avg', 'regime',
          'fx_new_trades', 'mom_new_trades', 'mom_entries',
          'fx_4b_usd', 'fx_4b_cum_usd', 'fx_4a_usd',
          'mom_v35_usd', 'mom_cum_usd',
          'combo_4b_usd', 'combo_4b_cum_usd', 'combo_4b_dd_usd',
        ],
        ...allMonths.map((r) => [
          r.ym, r.v2_avg, r.regime,
          r.fx_new_trades, r.new_trades, r.entries_desc,
          r.fx_4b, r.fx_4b_cum, r.fx_4a,
          r.mom_v35, r.mom_cum,
          r.combo_4b, r.combo_4b_cum, r.combo_4b_dd,
        ]),
      ]);
    };
  }
}
