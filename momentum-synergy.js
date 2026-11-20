import {
  renderRangeControls,
  bindRangeControls,
  filterSeriesByRange,
  getRangeState,
  getChartTheme,
  enhanceInteractiveCharts
} from './chart-utils.js';

let synergyData = null;
let selectedPartner = 'CTA_RECIPE1';
let scaleMode = 'COMBO_1TO1'; // 'COMBO_1TO1' | 'COMBO_HALF_FX' | 'TARGET_2M'
let selectedYearFilter = 'ALL';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtNum = (v, d = 0) =>
  v == null || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtUsd = (v, signed = true) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const val = Math.abs(Number(v)) < 0.5 ? 0 : Number(v);
  if (!signed) return '$' + fmtNum(Math.abs(val), 0);
  return (val < 0 ? '−$' : val > 0 ? '+$' : '$') + fmtNum(Math.abs(val), 0);
};

async function loadSynergyData() {
  if (synergyData) return synergyData;
  const urls = ['/data/fx-momentum-synergy.json', '/api/fx-momentum-synergy'];
  for (const u of urls) {
    try {
      const res = await fetch(u, { cache: 'no-store' });
      if (res.ok) {
        synergyData = await res.json();
        return synergyData;
      }
    } catch (_) {}
  }
  throw new Error('FX × 모멘텀 시너지 데이터를 불러오지 못했습니다.');
}

function getScaleMultipliers(partnerId, mode) {
  if (mode === 'COMBO_HALF_FX') {
    return { fxMult: 0.5, momMult: 1.0, label: '리스크 균형 (FX 0.5x : 모멘텀 1.0x)' };
  }
  if (mode === 'TARGET_2M') {
    const mObj = synergyData?.models_comparison?.find((m) => m.id === partnerId);
    const mom5y = Math.max(100000, mObj?.standalone?.total_net || 890992);
    const fx5y = synergyData?.fx_statarb?.stats?.total_net || 666987;
    const fxM = 5.0;
    const momM = Math.max(1.0, (10000000 - fxM * fx5y) / mom5y);
    return {
      fxMult: fxM,
      momMult: momM,
      label: `연 $200만 목표 스케일 (FX ${fxM.toFixed(1)}x : 모멘텀 ${momM.toFixed(1)}계약)`
    };
  }
  return { fxMult: 1.0, momMult: 1.0, label: '기본 단위 1:1 결합 (FX 1.0x : 모멘텀 1.0x)' };
}

function computeSeriesAndMetrics(data, partnerId, mode) {
  const { fxMult, momMult, label } = getScaleMultipliers(partnerId, mode);
  const dailyRows = data.daily_rows || [];
  let cumFx = 0,
    cumMom = 0,
    cumCombo = 0;
  let pkFx = 0,
    pkMom = 0,
    pkCombo = 0;
  let mddFx = 0,
    mddMom = 0,
    mddCombo = 0;

  const series = [];
  const dailyComboArr = [];
  const byYear = {
    2022: { fx: [], mom: [], combo: [] },
    2023: { fx: [], mom: [], combo: [] },
    2024: { fx: [], mom: [], combo: [] },
    2025: { fx: [], mom: [], combo: [] },
    2026: { fx: [], mom: [], combo: [] }
  };

  for (const r of dailyRows) {
    const dFx = (r.fx || 0) * fxMult;
    const dMom = (r[partnerId] ?? r.CTA_RECIPE1 ?? 0) * momMult;
    const dCombo = dFx + dMom;

    cumFx += dFx;
    cumMom += dMom;
    cumCombo += dCombo;

    if (cumFx > pkFx) pkFx = cumFx;
    if (cumMom > pkMom) pkMom = cumMom;
    if (cumCombo > pkCombo) pkCombo = cumCombo;

    const ddFx = pkFx - cumFx;
    const ddMom = pkMom - cumMom;
    const ddCombo = pkCombo - cumCombo;

    if (ddFx > mddFx) mddFx = ddFx;
    if (ddMom > mddMom) mddMom = ddMom;
    if (ddCombo > mddCombo) mddCombo = ddCombo;

    dailyComboArr.push(dCombo);
    const yr = r.date.slice(0, 4);
    if (byYear[yr]) {
      byYear[yr].fx.push(dFx);
      byYear[yr].mom.push(dMom);
      byYear[yr].combo.push(dCombo);
    }

    series.push({
      date: r.date,
      dFx,
      dMom,
      dCombo,
      cumFx,
      cumMom,
      cumCombo,
      ddFx: -ddFx,
      ddMom: -ddMom,
      ddCombo: -ddCombo
    });
  }

  const calcArrMdd = (arr) => {
    let c = 0,
      p = 0,
      m = 0;
    for (const v of arr) {
      c += v;
      if (c > p) p = c;
      if (p - c > m) m = p - c;
    }
    return m;
  };

  const n = dailyComboArr.length || 1;
  const mean = dailyComboArr.reduce((a, b) => a + b, 0) / n;
  const variance = dailyComboArr.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
  const calmar = mddCombo > 0 ? cumCombo / mddCombo : 99;

  const annualStats = {};
  for (const yr of ['2022', '2023', '2024', '2025', '2026']) {
    const g = byYear[yr];
    annualStats[yr] = {
      fxNet: g.fx.reduce((a, b) => a + b, 0),
      fxMdd: calcArrMdd(g.fx),
      momNet: g.mom.reduce((a, b) => a + b, 0),
      momMdd: calcArrMdd(g.mom),
      comboNet: g.combo.reduce((a, b) => a + b, 0),
      comboMdd: calcArrMdd(g.combo)
    };
  }

  const trend22_26 = {
    fx: annualStats['2022'].fxNet + annualStats['2026'].fxNet,
    mom: annualStats['2022'].momNet + annualStats['2026'].momNet,
    combo: annualStats['2022'].comboNet + annualStats['2026'].comboNet
  };
  const box23_25 = {
    fx: annualStats['2023'].fxNet + annualStats['2024'].fxNet + annualStats['2025'].fxNet,
    mom: annualStats['2023'].momNet + annualStats['2024'].momNet + annualStats['2025'].momNet,
    combo: annualStats['2023'].comboNet + annualStats['2024'].comboNet + annualStats['2025'].comboNet
  };

  return {
    fxMult,
    momMult,
    scaleLabel: label,
    series,
    totals: {
      fxNet: cumFx,
      momNet: cumMom,
      comboNet: cumCombo,
      mddFx,
      mddMom,
      mddCombo,
      sharpe,
      calmar,
      trend22_26,
      box23_25
    },
    annualStats
  };
}

function renderEquityAndDrawdownSvg(series) {
  const ct = getChartTheme();
  const st = getRangeState('fx-mom-synergy', 'ALL', true);
  let filtered = filterSeriesByRange(series, 'fx-mom-synergy', (pt) => pt.date, 'ALL');
  if (selectedYearFilter !== 'ALL') {
    filtered = series.filter((pt) => pt.date.startsWith(selectedYearFilter));
  }
  if (!filtered.length) {
    return '<div class="empty">선택한 기간에 데이터가 없습니다.</div>';
  }

  const rebased = st.rebase || selectedYearFilter !== 'ALL';
  const bFx = rebased ? filtered[0].cumFx - filtered[0].dFx : 0;
  const bMom = rebased ? filtered[0].cumMom - filtered[0].dMom : 0;
  const bCombo = rebased ? filtered[0].cumCombo - filtered[0].dCombo : 0;

  const pts = filtered.map((pt) => ({
    date: pt.date,
    fx: pt.cumFx - bFx,
    mom: pt.cumMom - bMom,
    combo: pt.cumCombo - bCombo,
    ddFx: pt.ddFx,
    ddMom: pt.ddMom,
    ddCombo: pt.ddCombo
  }));

  const allVals = pts.flatMap((p) => [p.fx, p.mom, p.combo, 0]);
  const minV = Math.min(...allVals);
  const maxV = Math.max(1, ...allVals);

  const W = 1040,
    H = 320,
    PL = 82,
    PR = 28,
    PT = 24,
    PB = 38;
  const plotW = W - PL - PR;
  const plotH = H - PT - PB;

  const xOf = (i) => PL + (i * plotW) / Math.max(1, pts.length - 1);
  const yOf = (v) => PT + ((maxV - v) / (maxV - minV || 1)) * plotH;

  const buildPath = (key) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(p[key]).toFixed(1)}`).join(' ');

  const yrLines = [];
  let prevYr = pts[0].date.slice(0, 4);
  pts.forEach((p, i) => {
    const y = p.date.slice(0, 4);
    if (y !== prevYr) {
      prevYr = y;
      const x = xOf(i);
      const isBox = y === '2023' || y === '2024' || y === '2025';
      yrLines.push(
        `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${H - PB}" stroke="${ct.grid}" stroke-dasharray="4 3" />`,
        `<text x="${(x + 6).toFixed(1)}" y="${PT + 13}" fill="${isBox ? '#38bdf8' : '#fb923c'}" font-size="11" font-weight="600">${y}년 (${isBox ? '박스권 수렴' : '강한 추세'})</text>`
      );
    }
  });

  const yTicks = [minV, minV + (maxV - minV) * 0.25, minV + (maxV - minV) * 0.5, minV + (maxV - minV) * 0.75, maxV];

  const H2 = 155,
    PT2 = 16,
    PB2 = 28;
  const plotH2 = H2 - PT2 - PB2;
  const minDD = Math.min(-1000, ...pts.flatMap((p) => [p.ddFx, p.ddMom, p.ddCombo]));
  const yDD = (v) => PT2 + ((0 - v) / (0 - minDD || 1)) * plotH2;
  const buildDDPath = (key) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yDD(p[key]).toFixed(1)}`).join(' ');

  return `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="FX 차익거래 및 금리 모멘텀 5개년 누적 손익 추이">
        ${yTicks
          .map(
            (tv) => `
          <line x1="${PL}" y1="${yOf(tv).toFixed(1)}" x2="${W - PR}" y2="${yOf(tv).toFixed(1)}" stroke="${ct.grid}" stroke-width="1" />
          <text x="${PL - 8}" y="${(yOf(tv) + 4).toFixed(1)}" text-anchor="end" fill="${ct.axisText}" font-size="11">${fmtUsd(tv, false)}</text>
        `
          )
          .join('')}
        <line x1="${PL}" y1="${yOf(0).toFixed(1)}" x2="${W - PR}" y2="${yOf(0).toFixed(1)}" stroke="${ct.zeroLine}" stroke-width="1.3" />
        ${yrLines.join('')}
        <path d="${buildPath('fx')}" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.9" />
        <path d="${buildPath('mom')}" fill="none" stroke="#10b981" stroke-width="2" opacity="0.9" />
        <path d="${buildPath('combo')}" fill="none" stroke="#f97316" stroke-width="3.2" />
        <text x="${PL + 6}" y="${PT + 13}" fill="#fb923c" font-size="11" font-weight="600">${pts[0].date.slice(0, 4)}년 (${pts[0].date.startsWith('2022') || pts[0].date.startsWith('2026') ? '강한 추세' : '박스권'})</text>
        <text x="${PL}" y="${H - 10}" fill="${ct.axisText}" font-size="11">${pts[0].date}</text>
        <text x="${W - PR}" y="${H - 10}" text-anchor="end" fill="${ct.axisText}" font-size="11">${pts[pts.length - 1].date}</text>
      </svg>

      <div style="font-size:12px;color:#94a3b8;padding:0 6px;display:flex;justify-content:space-between;align-items:center;">
        <span>▼ <strong>언더워터 최대낙폭(Drawdown) 상쇄 추이</strong> — FX 차익거래 낙폭(파랑)이 깊어지는 추세 발작기에 금리 모멘텀(초록) 수익이 유입되어 통합 계좌 낙폭(주황)을 방어합니다.</span>
      </div>
      <svg class="chart" viewBox="0 0 ${W} ${H2}" role="img" aria-label="언더워터 낙폭 비교 차트">
        <line x1="${PL}" y1="${yDD(0).toFixed(1)}" x2="${W - PR}" y2="${yDD(0).toFixed(1)}" stroke="${ct.zeroLine}" stroke-width="1" />
        <line x1="${PL}" y1="${yDD(minDD / 2).toFixed(1)}" x2="${W - PR}" y2="${yDD(minDD / 2).toFixed(1)}" stroke="${ct.grid}" stroke-dasharray="3 3" />
        <line x1="${PL}" y1="${yDD(minDD).toFixed(1)}" x2="${W - PR}" y2="${yDD(minDD).toFixed(1)}" stroke="${ct.grid}" />
        <text x="${PL - 8}" y="${(yDD(0) + 4).toFixed(1)}" text-anchor="end" fill="${ct.axisText}" font-size="10">$0</text>
        <text x="${PL - 8}" y="${(yDD(minDD / 2) + 4).toFixed(1)}" text-anchor="end" fill="${ct.axisText}" font-size="10">${fmtUsd(minDD / 2)}</text>
        <text x="${PL - 8}" y="${(yDD(minDD) + 4).toFixed(1)}" text-anchor="end" fill="${ct.axisText}" font-size="10">${fmtUsd(minDD)}</text>
        <path d="${buildDDPath('ddFx')}" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.75" />
        <path d="${buildDDPath('ddMom')}" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.75" />
        <path d="${buildDDPath('ddCombo')}" fill="none" stroke="#f97316" stroke-width="2.4" />
      </svg>
    </div>
  `;
}

export async function renderMomentumSynergy(target) {
  target.innerHTML = `<div class="panel"><div class="empty">FX 차익거래 × 금리 모멘텀 5개년 시너지 데이터를 불러오는 중입니다...</div></div>`;
  let data;
  try {
    data = await loadSynergyData();
  } catch (err) {
    target.innerHTML = `<div class="panel"><div class="empty">${esc(err.message)}</div></div>`;
    return;
  }

  const partnerMeta =
    data.models_comparison.find((m) => m.id === selectedPartner) ||
    data.models_comparison.find((m) => m.id === 'CTA_RECIPE1');
  const calc = computeSeriesAndMetrics(data, partnerMeta.id, scaleMode);
  const t = calc.totals;
  const fxTrades = data.fx_statarb.annual_trades || {};
  const rangeCtrl = renderRangeControls('fx-mom-synergy', 'ALL', true);

  const partnerButtons = [
    ['CTA_RECIPE1', '🔥 ⑧ 수익극대화 레시피1 (최적 파트너)'],
    ['FAST_3BEAT', '⚡ ⑤ 빠른 3박자 (단독 표준)'],
    ['SNIPER_S3', '🎯 ⑥ 하이브리드 스나이퍼 (방어형)'],
    ['METHOD_3', '⑦ 확장A · 눌림목 재진입'],
    ['CTA_RECIPE2', '④ 🎯 CTA 레시피2'],
    ['TIER', '② 기존 CTA (20일 고정)'],
    ['BASE', '① 기본 20일 돌파 (무필터)']
  ];

  const years = ['2022', '2023', '2024', '2025', '2026'];
  const regimeInfo = {
    2022: { tag: '강한 추세장', desc: '연준 자이언트스텝 · 금리 대폭등 / 강달러 발산', winner: '금리 모멘텀 주도 (+폭발)' },
    2023: { tag: '박스권 수렴장', desc: '피벗 기대감 vs 고금리 장기화 레인지 등락', winner: 'FX 차익거래 주도 (+수렴)' },
    2024: { tag: '최적 수렴장', desc: '금리 인하 시점 저울질 · 통화 상대가치 회귀', winner: 'FX + 모멘텀 동반 흑자' },
    2025: { tag: '변동성 혼조장', desc: '관세·정책 불확실성 · 잦은 방향 전환 휩소', winner: 'FX 차익거래 방어 완충' },
    2026: { tag: '강한 추세장', desc: '재정·금리 재발작 및 통화별 추세 디커플링', winner: '금리 모멘텀 주도 (+헤지)' }
  };

  target.innerHTML = `
    <div class="panel" style="border-left:4px solid #f97316;margin-bottom:14px;">
      <div class="panel-head" style="margin-bottom:8px;">
        <div>
          <span class="tag primary" style="background:#f97316;color:#fff;margin-right:8px;">CORE SYNERGY</span>
          <strong style="font-size:16px;">FX 페어 평균회귀(55쌍) × 금리 선물 모멘텀(${esc(partnerMeta.short_name)}) 5개년 상호 상쇄·보완 분석</strong>
        </div>
        <span class="muted">분석 구간: ${esc(data.period.start)} ~ ${esc(data.period.end)} (${fmtNum(data.period.trading_days)}거래일 · ${data.period.months}개월)</span>
      </div>
      <div class="data-info" style="line-height:1.65;margin-bottom:10px;white-space:normal;word-break:keep-all;">
        • <strong>핵심 시너지 원리 (Macro Regime Complementarity)</strong>: 금리 모멘텀 단독 운용 시에는 박스권 손실 방어를 위해 추세 상방을 일부 제한한 <code>⑤ 빠른 3박자</code>·<code>⑥ 스나이퍼</code>가 유리하지만, <strong>FX 55개 통화쌍 평균회귀 전략이 박스권 3년(2023~2025년) 동안 <code>+$721,852</code>(기본 1x)의 안정적 캐리를 창출할 때는 모멘텀 전략이 추세장 수익 확보에 집중하는 구조가 유효합니다.</strong><br/>
        • <strong>최적 파트너 — <code>⑧ 레시피1 (눌림목 재진입 + k=1.05 고감도 시그널)</code></strong>: <code>10→20일 1/3 분할 진입 + 5일 타임스탑</code>으로 박스권 3년 손실을 <strong><code>−$5,170</code>(FX 수익의 99.3% 보존)</strong>으로 제어하면서, 추세 확장기(2022·2026년)에는 <strong><code>k=1.05 시그널</code>로 추세 초입 3/3 최대 배분을 신속히 달성하고 <code>눌림목 재진입</code>을 통해 <code>+$896,162</code></strong>의 성과를 기록하여 FX의 추세장 손실(<code>−$54,866</code>)을 보완합니다.
      </div>

      <div class="filters" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;padding-top:6px;border-top:1px solid rgba(148,163,184,0.15);">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="muted" style="font-weight:600;">① 금리 모멘텀 파트너 모델:</span>
          <div class="segmented">
            ${partnerButtons
              .map(
                ([id, label]) =>
                  `<button data-syn-partner="${id}" class="${partnerMeta.id === id ? 'on' : ''}">${esc(label)}</button>`
              )
              .join('')}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="muted" style="font-weight:600;">② 비중 · 목표수익 스케일:</span>
          <div class="segmented">
            <button data-syn-scale="COMBO_1TO1" class="${scaleMode === 'COMBO_1TO1' ? 'on' : ''}">기본 1:1 결합 (1x:1x)</button>
            <button data-syn-scale="COMBO_HALF_FX" class="${scaleMode === 'COMBO_HALF_FX' ? 'on' : ''}">리스크 균형 (FX 0.5x:1x)</button>
            <button data-syn-scale="TARGET_2M" class="${scaleMode === 'TARGET_2M' ? 'on' : ''}">💰 연 $200만 목표 스케일</button>
          </div>
        </div>
      </div>
    </div>

    <div class="stats" style="grid-template-columns:repeat(5, minmax(0, 1fr));margin-bottom:14px;">
      <div class="stat orange">
        <div class="stat-label">5개년 통합 누적 순익 (22~26)</div>
        <div class="stat-value">${fmtUsd(t.comboNet)}</div>
        <div class="stat-sub">연평균 <strong>${fmtUsd(t.comboNet / 5)}</strong> (${esc(calc.scaleLabel)})</div>
      </div>
      <div class="stat green">
        <div class="stat-label">22+26 추세 발작기 합산 (Crisis Alpha)</div>
        <div class="stat-value">${fmtUsd(t.trend22_26.combo)}</div>
        <div class="stat-sub">FX ${fmtUsd(t.trend22_26.fx)} / <strong>모멘텀 ${fmtUsd(t.trend22_26.mom)}</strong></div>
      </div>
      <div class="stat blue">
        <div class="stat-label">23~25 박스권 수렴기 합산 (Range Alpha)</div>
        <div class="stat-value">${fmtUsd(t.box23_25.combo)}</div>
        <div class="stat-sub"><strong>FX ${fmtUsd(t.box23_25.fx)}</strong> / 모멘텀 ${fmtUsd(t.box23_25.mom)}</div>
      </div>
      <div class="stat red">
        <div class="stat-label">통합 최대낙폭 (MDD) · 수익/MDD</div>
        <div class="stat-value">${fmtUsd(-t.mddCombo)} <small>(${t.calmar.toFixed(2)}x)</small></div>
        <div class="stat-sub">단독 MDD 합(${fmtUsd(-(t.mddFx + t.mddMom))}) 대비 <strong>${fmtNum((1 - t.mddCombo / Math.max(1, t.mddFx + t.mddMom)) * 100, 1)}% 상쇄</strong></div>
      </div>
      <div class="stat">
        <div class="stat-label">통합 샤프 · 월승률 · 일별 상관</div>
        <div class="stat-value">Sharpe ${t.sharpe.toFixed(2)}</div>
        <div class="stat-sub">월승률 <strong>${partnerMeta.combo_1to1.win_month_rate}%</strong> (${partnerMeta.combo_1to1.win_months}/${partnerMeta.combo_1to1.total_months}개월) · 상관 <strong>${partnerMeta.corr_daily}</strong></div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-head">
        <h2>1. 5개년(2022~2026) 누적 손익 추이 및 언더워터 낙폭(MDD) 상호 상쇄 차트</h2>
        <div class="segmented">
          ${['ALL', '2022', '2023', '2024', '2025', '2026']
            .map(
              (yr) =>
                `<button data-syn-yr="${yr}" class="${selectedYearFilter === yr ? 'on' : ''}">${yr === 'ALL' ? '전체 5개년 (22~26)' : yr + '년'}</button>`
            )
            .join('')}
        </div>
      </div>
      ${rangeCtrl}
      <div class="data-info" style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;">
        <span><strong style="color:#f97316;">━━ 주황 굵은선: 통합 시너지 포트폴리오 (${fmtUsd(t.comboNet)} / MDD ${fmtUsd(-t.mddCombo)})</strong></span>
        <span><strong style="color:#38bdf8;">━━ 파란선: FX 55쌍 평균회귀 단독 (${fmtUsd(t.fxNet)} / MDD ${fmtUsd(-t.mddFx)})</strong></span>
        <span><strong style="color:#10b981;">━━ 초록선: 금리 모멘텀 [${esc(partnerMeta.short_name)}] 단독 (${fmtUsd(t.momNet)} / MDD ${fmtUsd(-t.mddMom)})</strong></span>
      </div>
      ${renderEquityAndDrawdownSvg(calc.series)}
    </div>

    <div class="panel below" style="margin-bottom:14px;">
      <div class="panel-head">
        <h2>2. 연도별(2022~2026) 매크로 레짐 시소(Seesaw) 상쇄 성과표</h2>
        <span class="muted">스케일: ${esc(calc.scaleLabel)} · 괄호 안은 해당 연도 내 일별 누적손익 최대낙폭(MDD)</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>연도</th>
              <th>매크로 장세 레짐</th>
              <th class="number">① FX 페어 차익거래 (연중 MDD)</th>
              <th class="number">FX 승률 (익절/손절)</th>
              <th class="number">② 금리 모멘텀 [${esc(partnerMeta.short_name)}]</th>
              <th class="number">★ 통합 시너지 손익 (통합 MDD)</th>
              <th>상호 보완 · 상쇄 효과 판정</th>
            </tr>
          </thead>
          <tbody>
            ${years
              .map((yr) => {
                const a = calc.annualStats[yr];
                const ft = fxTrades[yr] || {};
                const rg = regimeInfo[yr];
                const isTrend = yr === '2022' || yr === '2026';
                return `
                  <tr>
                    <td><strong>${yr}년</strong></td>
                    <td style="white-space:normal;word-break:keep-all;">
                      <span class="tag ${isTrend ? 'primary' : 'shadow'}">${esc(rg.tag)}</span>
                      <div class="pair-sub">${esc(rg.desc)}</div>
                    </td>
                    <td class="number ${a.fxNet >= 0 ? 'green' : 'red'}">
                      <strong>${fmtUsd(a.fxNet)}</strong>
                      <div class="pair-sub red">MDD ${fmtUsd(-a.fxMdd)}</div>
                    </td>
                    <td class="number">
                      ${ft.win_rate ?? '—'}% <small>(PF ${ft.pf ?? '—'})</small>
                      <div class="pair-sub">수렴익절 ${ft.tp_count ?? 0}건 / 손절 ${ft.stop_count ?? 0}건</div>
                    </td>
                    <td class="number ${a.momNet >= 0 ? 'green' : 'red'}">
                      <strong>${fmtUsd(a.momNet)}</strong>
                      <div class="pair-sub red">MDD ${fmtUsd(-a.momMdd)}</div>
                    </td>
                    <td class="number ${a.comboNet >= 0 ? 'green' : 'red'}" style="background:rgba(249,115,22,0.07);">
                      <strong style="font-size:14px;">${fmtUsd(a.comboNet)}</strong>
                      <div class="pair-sub">통합 MDD <strong>${fmtUsd(-a.comboMdd)}</strong></div>
                    </td>
                    <td style="white-space:normal;word-break:keep-all;">
                      <strong>${esc(rg.winner)}</strong>
                      <div class="pair-sub">${
                        isTrend
                          ? `FX 단독 MDD(${fmtUsd(-a.fxMdd)})를 모멘텀 수익으로 덮어 통합 MDD ${fmtUsd(-a.comboMdd)}로 축소`
                          : `모멘텀 횡보 구간을 FX 수렴 수익(${fmtUsd(a.fxNet)})으로 캐리`
                      }</div>
                    </td>
                  </tr>
                `;
              })
              .join('')}
            <tr style="border-top:2px solid rgba(148,163,184,0.3);background:rgba(56,189,248,0.06);">
              <td><strong>23~25 합산</strong></td>
              <td><span class="tag shadow">3년 연속 박스권 · 혼조장</span></td>
              <td class="number green"><strong>${fmtUsd(t.box23_25.fx)}</strong></td>
              <td class="number">수렴 익절 113건 주도</td>
              <td class="number ${t.box23_25.mom >= 0 ? 'green' : 'red'}"><strong>${fmtUsd(t.box23_25.mom)}</strong></td>
              <td class="number green"><strong>${fmtUsd(t.box23_25.combo)}</strong></td>
              <td style="white-space:normal;word-break:keep-all;"><strong>FX 평균회귀가 박스권 3년 수익의 100% 이상을 책임지며 캐시카우 역할</strong></td>
            </tr>
            <tr style="background:rgba(249,115,22,0.08);">
              <td><strong>22+26 합산</strong></td>
              <td><span class="tag primary">초강세 금리·환율 추세 발작기</span></td>
              <td class="number ${t.trend22_26.fx >= 0 ? 'green' : 'red'}"><strong>${fmtUsd(t.trend22_26.fx)}</strong></td>
              <td class="number">발산 손절 53건 발생</td>
              <td class="number green"><strong>${fmtUsd(t.trend22_26.mom)}</strong></td>
              <td class="number green"><strong>${fmtUsd(t.trend22_26.combo)}</strong></td>
              <td style="white-space:normal;word-break:keep-all;"><strong>금리 모멘텀이 폭발적 추세 수익으로 FX 발산 손실을 16배 초과 상쇄</strong></td>
            </tr>
            <tr style="border-top:2px solid #f97316;background:rgba(249,115,22,0.14);font-size:14px;">
              <td><strong>5년 전체 합계</strong></td>
              <td><strong>전 주기 (All-Weather 완성)</strong></td>
              <td class="number green"><strong>${fmtUsd(t.fxNet)}</strong> <small>(MDD ${fmtUsd(-t.mddFx)})</small></td>
              <td class="number">총 288건 (승률 60.1%)</td>
              <td class="number green"><strong>${fmtUsd(t.momNet)}</strong> <small>(MDD ${fmtUsd(-t.mddMom)})</small></td>
              <td class="number green"><strong>${fmtUsd(t.comboNet)}</strong> <small>(MDD ${fmtUsd(-t.mddCombo)})</small></td>
              <td style="white-space:normal;word-break:keep-all;"><strong>5개년 무패(Losing Year 0회) · 수익/MDD ${t.calmar.toFixed(2)}배 · 샤프 ${t.sharpe.toFixed(2)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel below" style="margin-bottom:14px;">
      <div class="panel-head">
        <h2>3. 최적 파트너 전략 심층 해부: ⑧ 🔥 수익 극대화 레시피1 (눌림목 재진입 + k=1.05 공격형 시그널)</h2>
        <span class="muted">왜 FX 평균회귀가 뒤를 받쳐줄 때는 방어형(⑤·⑥번)보다 수익 극대화형(⑧ 레시피1)이 압도적 1위인가?</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(460px, 1fr));gap:14px;padding:14px 16px;align-items:stretch;">
        <div style="min-width:0;overflow:hidden;background:var(--panel-subtle);border:1px solid rgba(249,115,22,0.4);border-radius:10px;padding:16px;box-sizing:border-box;">
          <h3 style="margin:0 0 8px 0;color:#f97316;font-size:15px;line-height:1.4;">⚡ 엔진 ①: k=1.05 공격형 CTA 레시피1 — 추세 초입 3/3 풀사이즈 초고속 증액</h3>
          <p class="muted" style="margin:0 0 12px 0;line-height:1.6;white-space:normal;word-break:keep-all;">
            방어형 모델(<code>⑤ 빠른 3박자</code>·<code>⑥ 스나이퍼</code>)은 단독 운용 시 박스권 휩소를 피하기 위해 <code>k=0.70</code>과 <code>중장기 주기 85%(28·56·112일)</code>를 사용하여 추세가 한참 진행될 때까지 <code>1/3~2/3</code> 물량에 머뭅니다. 반면 <strong><code>🔥 레시피1</code>은 박스권 수익을 FX 평균회귀에 맡기고 추세 초기 반응 속도를 극대화</strong>합니다.
          </p>
          <table style="width:100%;min-width:0;table-layout:fixed;border-collapse:collapse;white-space:normal;">
            <colgroup>
              <col style="width:21%;" />
              <col style="width:22%;" />
              <col style="width:22%;" />
              <col style="width:35%;" />
            </colgroup>
            <thead>
              <tr>
                <th style="position:static;white-space:normal;word-break:keep-all;padding:8px 8px;line-height:1.35;">CTA 내부 변수</th>
                <th style="position:static;white-space:normal;word-break:keep-all;padding:8px 8px;line-height:1.35;">🎯 방어형 레시피2<br/><small>(⑤·⑥번)</small></th>
                <th style="position:static;white-space:normal;word-break:keep-all;padding:8px 8px;line-height:1.35;">🔥 공격형 레시피1<br/><small>(⑧번 최적)</small></th>
                <th style="position:static;white-space:normal;word-break:keep-all;padding:8px 8px;line-height:1.35;">실전 증액 속도 차이</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;"><strong>① 변위 : 이평 비중</strong></td>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;">65% : 35%</td>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;"><strong class="orange">70% : 30%</strong></td>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;">후행하는 이평선 비중을 줄이고 즉각적인 가격 돌파 변위(disp) 70% 반영</td>
              </tr>
              <tr>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;"><strong>② tanh 기울기 (k)</strong></td>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;">k = 0.70 (완만)</td>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;"><strong class="orange">k = 1.05 (가파름)</strong></td>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;">1.0σ 돌파 시 <code>tanh(0.70)=0.60</code> vs <strong><code>tanh(1.05)=0.78</code> (즉시 ≥0.75 풀사이즈 돌파!)</strong></td>
              </tr>
              <tr>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;"><strong>③ 6개 주기 가중치</strong></td>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;">중장기 85% 집중<br/><small>[3,5,7,20,30,35]%</small></td>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;"><strong class="orange">단·중기 66% 집중</strong><br/><small>[14,24,28,18,10,6]%</small></td>
                <td style="white-space:normal;word-break:keep-all;vertical-align:top;padding:9px 8px;line-height:1.45;font-size:13px;">7·14·21일 단중기 주기에 66%를 실어 <strong>추세 발화 첫 1~2주 내 3/3 풀배팅 완성</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style="min-width:0;overflow:hidden;background:var(--panel-subtle);border:1px solid rgba(16,185,129,0.4);border-radius:10px;padding:16px;box-sizing:border-box;">
          <h3 style="margin:0 0 8px 0;color:#10b981;font-size:15px;line-height:1.4;">엔진 ②: 10→20일 분할 진입 + 눌림목 재진입 (4단계 라이프사이클)</h3>
          <p class="muted" style="margin:0 0 12px 0;line-height:1.6;white-space:normal;word-break:keep-all;">
            단중기 민감도를 높이면 박스권에서 휩소 위험이 발생할 수 있으나, <strong><code>10일 1차 진입(1/3) + 5일 타임스탑</code>으로 박스권 손실을 3년간 <code>−$5,170</code>으로 제한</strong>하고, 장기 추세 구간에서는 <strong>부분익절 물량을 눌림목마다 재진입</strong>하여 추세 수익을 확보합니다.
          </p>
          <ol class="research-list" style="margin:0;padding-left:18px;line-height:1.68;white-space:normal;word-break:keep-all;">
            <li style="margin-bottom:8px;"><strong>[1단계 · 초기 진입 및 리스크 관리] 10일 돌파 1/3 배분 &amp; 5일 타임스탑</strong>: 10일 채널 돌파 시 <code>1/3($11,667)</code>만 우선 배분. 진입 후 5거래일 내 모멘텀 지연 시 추가 증액 없이 1/3 물량 조기 정리.</li>
            <li style="margin-bottom:8px;"><strong>[2단계 · 단계적 증액] 20일 돌파 &amp; CTA≥0.75 최대 배분(3/3)</strong>: 20일 돌파 시 <code>k=1.05</code> 시그널이 <code>≥0.75</code>에 도달하여 유리한 진입 단가에서 <code>3/3($35,000)</code> 배분 완성.</li>
            <li style="margin-bottom:8px;"><strong>[3단계 · 1차 부분익절] +0.90R 도달 시 50% 부분익절 &amp; 손익분기 스탑</strong>: 평가익 <code>+0.90R(+$31,500)</code> 도달 시 50% 이익실현 확정 후 잔여 물량 스탑라인을 진입가(0.00R)로 상향하여 원금 보전.</li>
            <li><strong>[4단계 · 추세 재진입] 눌림목 재진입 (Pullback Re-entry)</strong>: 1차 부분익절 이후에도 <strong>20일 추세 채널과 이평선 정배열(MA20&gt;MA60) 및 CTA 강도(≥0.48)가 유지된 상태에서 단기 되돌림 후 재차 지지될 때 부분익절 물량을 재진입(총 15건)</strong>하여 추세장 수익을 <code>+$67.0만(⑤번) → +$89.6만(⑧번)</code>으로 +34% 개선합니다.</li>
          </ol>
        </div>
      </div>

      <div style="padding:4px 16px 8px;">
        <h3 style="margin:6px 0 8px 0;font-size:14px;">📊 대시보드 10대 금리 모멘텀 전 모델 × FX 차익거래 결합 성과 비교 (행 클릭 시 상단 차트 즉시 전환)</h3>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>모멘텀 모델 (클릭 시 선택)</th>
              <th>핵심 파라미터 · 청산/재진입 구조</th>
              <th class="number">모멘텀 단독 5Y</th>
              <th class="number">22+26 추세장 (단독)</th>
              <th class="number">23~25 박스권 (단독)</th>
              <th class="number">★ FX+모멘텀 (1:1) 5Y 순익</th>
              <th class="number">통합 MDD (1:1)</th>
              <th class="number">통합 수익/MDD</th>
              <th class="number">통합 샤프</th>
            </tr>
          </thead>
          <tbody>
            ${data.models_comparison
              .map((m) => {
                const isSel = m.id === partnerMeta.id;
                const isBest = m.id === 'CTA_RECIPE1';
                return `
                  <tr class="mom-row ${isSel ? 'selected' : ''}" data-syn-row="${esc(m.id)}" style="cursor:pointer;${isBest ? 'background:rgba(249,115,22,0.10);' : ''}">
                    <td class="pair-name" style="white-space:normal;word-break:keep-all;">
                      <strong>${esc(m.short_name)}</strong>
                      ${isBest ? '<span class="tag primary" style="background:#f97316;color:#fff;margin-left:6px;">최적 1위</span>' : ''}
                      <div class="pair-sub">${esc(m.role)}</div>
                    </td>
                    <td style="white-space:normal;word-break:keep-all;">
                      <div>${esc(m.cta_params)}</div>
                      <div class="pair-sub">${esc(m.exit_rule)}</div>
                    </td>
                    <td class="number ${m.standalone.total_net >= 0 ? 'green' : 'red'}">${fmtUsd(m.standalone.total_net)}</td>
                    <td class="number green"><strong>${fmtUsd(m.standalone.trend_22_26)}</strong></td>
                    <td class="number ${m.standalone.box_23_25 >= 0 ? 'green' : 'red'}">${fmtUsd(m.standalone.box_23_25)}</td>
                    <td class="number green"><strong>${fmtUsd(m.combo_1to1.total_net)}</strong></td>
                    <td class="number red">${fmtUsd(-m.combo_1to1.mdd)}</td>
                    <td class="number"><strong>${m.combo_1to1.calmar.toFixed(2)}x</strong></td>
                    <td class="number"><strong>${m.combo_1to1.sharpe.toFixed(2)}</strong></td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel below" style="margin-bottom:14px;">
      <div class="panel-head">
        <h2>4. 연 $2,000,000 (200만 달러) 기대수익 달성을 위한 실전 포지션 규모 및 손실한도(Risk Limit) 가이드</h2>
        <span class="muted">FX 평균회귀 × ⑧ 🔥 수익 극대화 레시피1 병행 운용 기준</span>
      </div>
      <div class="table-scroll">
        <table style="width:100%;table-layout:fixed;white-space:normal;">
          <colgroup>
            <col style="width:18%;" />
            <col style="width:27%;" />
            <col style="width:28%;" />
            <col style="width:27%;" />
          </colgroup>
          <thead>
            <tr>
              <th style="white-space:normal;word-break:keep-all;">리스크 관리 단계</th>
              <th style="white-space:normal;word-break:keep-all;">① FX 페어 평균회귀 차익거래 (55쌍)</th>
              <th style="white-space:normal;word-break:keep-all;">② 금리 선물 모멘텀 (⑧ 🔥 수익 극대화 레시피1)</th>
              <th style="white-space:normal;word-break:keep-all;">★ 통합 데스크 전체 (Total Desk Portfolio)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;"><strong>권장 포지션 스케일</strong></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;">기본 단위의 <strong><code>5.0배 (5.0x)</code></strong><br/><span class="muted">연평균 기대수익 <code>+$667,000 / 년</code> (박스권 연 +$145만~+$185만)</span></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;">종목당 평균 <strong><code>7.5계약 (7~8계약)</code></strong> <small>(1R = $262,500)</small><br/><span class="muted">연평균 기대수익 <code>+$1,333,000 / 년</code> (추세장 연 +$137만~+$533만)</span></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;"><strong>합산 연평균 기대수익 <code>+$2,000,000 / 년</code></strong><br/><span class="muted">5개년 누적 <code>+$10,000,000</code> (손실 연도 0회)</span></td>
            </tr>
            <tr>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;"><strong>건별 손절 한도 (Per-Trade Stop)</strong></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;">페어 1건당 하드캡 <strong><code>−$50,000</code></strong> <small>(또는 Z ±3.7σ 이탈 시 즉시 청산)</small></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;">시그널 1건(1R) 풀사이즈 기준 <strong><code>−$262,500</code></strong><br/><span class="muted">단, 10일 1/3 정찰대 5일 타임스탑 시 실제 손절은 약 <code>−$35,000 ~ −$55,000</code></span></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;">단일 이벤트 최대 손실을 데스크 연간 한도의 5% 이내로 통제</td>
            </tr>
            <tr>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;"><strong>1차 주의·감축선 (Soft Limit)</strong></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;">연중 누적 DD <strong><code>−$600,000</code></strong> 도달 시<br/><span class="muted">평년 MDD(−$50만) 초과 신호 → 신규 진입 Z 문턱을 ±2.0 → ±2.3으로 상향</span></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;">연중 누적 DD <strong><code>−$550,000</code></strong> 도달 시<br/><span class="muted">평년 MDD(−$35만) 초과 신호 → 눌림목 재진입 일시 중단 및 1단계만 운용</span></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;">통합 계좌 DD <strong><code>−$550,000</code></strong> 도달 시 포지션 규모 30% 축소 점검</td>
            </tr>
            <tr style="background:rgba(239,68,68,0.08);">
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;"><strong>연간 최대 손실한도 (Hard Stop)</strong></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;"><strong class="red" style="font-size:14px;">−$1,200,000 (120만 달러)</strong><br/><span class="muted">역사적 최악(2022년 −$102만 · 5Y −$120만) 완주 보장 한도</span></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;"><strong class="red" style="font-size:14px;">−$1,100,000 (110만 달러)</strong><br/><span class="muted">역사적 최악(2025년 −$107만) 완주 보장 한도</span></td>
              <td style="white-space:normal;word-break:keep-all;line-height:1.5;"><strong class="orange" style="font-size:15px;">−$1,000,000 ~ −$1,100,000 (100만~110만 불)</strong><br/><span class="muted">두 전략의 MDD 시기가 어긋나 통합 실제 5Y MDD는 <strong><code>−$980,000</code></strong>에 불과!</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  bindRangeControls(target, () => renderMomentumSynergy(target));
  enhanceInteractiveCharts(target);

  target.querySelectorAll('[data-syn-partner]').forEach((btn) => {
    btn.onclick = () => {
      selectedPartner = btn.dataset.synPartner;
      renderMomentumSynergy(target);
    };
  });
  target.querySelectorAll('[data-syn-row]').forEach((row) => {
    row.onclick = () => {
      selectedPartner = row.dataset.synRow;
      renderMomentumSynergy(target);
    };
  });
  target.querySelectorAll('[data-syn-scale]').forEach((btn) => {
    btn.onclick = () => {
      scaleMode = btn.dataset.synScale;
      renderMomentumSynergy(target);
    };
  });
  target.querySelectorAll('[data-syn-yr]').forEach((btn) => {
    btn.onclick = () => {
      selectedYearFilter = btn.dataset.synYr;
      renderMomentumSynergy(target);
    };
  });
}
