let externalCtx = null;

export function configureMomentumRecipe1Control(c) {
  externalCtx = c;
}

export function renderMomentumRecipe1Control(target) {
  if (window.FITDMomentumRecipe1Control) {
    window.FITDMomentumRecipe1Control.render(target);
  }
}

(function () {
  const WEIGHT_PROFILES = {
    W3: { id: 'W3', label: 'W3 단·중기 66% 집중 (레시피1)', weights: [0.14, 0.24, 0.28, 0.18, 0.10, 0.06] },
    W7: { id: 'W7', label: 'W7 중장기 85% 집중 (레시피2)', weights: [0.03, 0.05, 0.07, 0.20, 0.30, 0.35] },
    W0: { id: 'W0', label: 'W0 6주기 균등 (기본형)', weights: [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6] },
  };

  const state = {
    data: null,
    loadedMode: null,
    loading: false,
    refreshingDb: false,
    error: null,
    universeMode: 'CORE5', // 'CORE5' or 'ALL13'
    selectedId: 'TU',
    presetId: 'CTA_RECIPE1',
    dispWeight: 0.70,
    k: 1.05,
    weightProfile: 'W3',
    budgetMult: 1.00,
    autoRegimeGate: true,
  };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function num(v, d = 2) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function signedNum(v, d = 2) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    return `${n > 0 ? '+' : ''}${num(n, d)}`;
  }

  function int(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return Math.round(Number(v)).toLocaleString('en-US');
  }

  function usd(v, d = 0) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    const sign = n > 0 ? '+' : n < 0 ? '-' : '';
    return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  }

  function clsPnl(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return 'muted';
    return n > 0 ? 'pos' : 'neg';
  }

  function computeCustomCta(inst) {
    const zDisp = inst.z_disp || [0, 0, 0, 0, 0, 0];
    const zMa = inst.z_ma || [0, 0, 0, 0, 0, 0];
    const dw = Number(state.dispWeight);
    const mw = 1.0 - dw;
    const kVal = Number(state.k);
    const wArr = WEIGHT_PROFILES[state.weightProfile]?.weights || WEIGHT_PROFILES.W3.weights;
    const hLabels = state.data?.horizon_labels || [
      'H1 · 7D (초단기)',
      'H2 · 14D (단기)',
      'H3 · 21D (중단기)',
      'H4 · 28D (중기)',
      'H5 · 56D (중장기)',
      'H6 · 112D (장기)',
    ];

    let total = 0;
    const horizons = [];
    for (let i = 0; i < 6; i++) {
      const zd = Number(zDisp[i] || 0);
      const zm = Number(zMa[i] || 0);
      const zb = dw * zd + mw * zm;
      const th = Math.tanh(kVal * zb);
      const w = wArr[i];
      const contrib = w * th;
      total += contrib;
      horizons.push({
        idx: i + 1,
        label: hLabels[i],
        z_disp: zd,
        z_ma: zm,
        z_blend: zb,
        tanh_score: th,
        weight: w,
        contrib,
      });
    }
    const agree = horizons.filter(h => (h.tanh_score > 0 && total > 0) || (h.tanh_score < 0 && total < 0)).length;
    const absScore = Math.abs(total);
    const fullThr = state.autoRegimeGate && inst.triple_aligned
      ? (state.data?.fx_regime?.recommended_full_thr || 0.68)
      : 0.75;

    let stageLabel = '중립 대기 (<0.25)';
    let targetFraction = 0;
    if (absScore >= fullThr) {
      stageLabel = `3차 최대 배분 (3/3 · ≥${num(fullThr, 2)})`;
      targetFraction = 1.0;
    } else if (absScore >= 0.50) {
      stageLabel = '2차 표준 배분 (2/3 · ≥0.50)';
      targetFraction = 2 / 3;
    } else if (absScore >= 0.25) {
      stageLabel = '1차 초기 진입 (1/3 · ≥0.25)';
      targetFraction = 1 / 3;
    }

    const effMult = state.autoRegimeGate && inst.triple_aligned
      ? Math.max(state.budgetMult, state.data?.fx_regime?.recommended_budget_mult || 1.0)
      : state.budgetMult;
    const fullBudgetUsd = 35000 * effMult;
    const lossPerContract = Math.max(1, Number(inst.loss_per_contract_usd || 1000));
    const fullContracts = Math.max(1, Math.floor(fullBudgetUsd / lossPerContract));
    const mainContracts = Math.max(2, Math.floor((fullContracts * 2) / 3));
    const scoutContracts = Math.max(1, Math.floor(fullContracts / 3));
    const targetContracts = targetFraction >= 0.99
      ? fullContracts
      : targetFraction >= 0.60
      ? mainContracts
      : targetFraction >= 0.30
      ? scoutContracts
      : 0;

    return {
      score: total,
      absScore,
      direction: total > 1e-5 ? 1 : total < -1e-5 ? -1 : 0,
      agreement: agree,
      horizons,
      fullThr,
      stageLabel,
      targetFraction,
      effMult,
      fullBudgetUsd,
      fullContracts,
      mainContracts,
      scoutContracts,
      targetContracts,
    };
  }

  function renderTopBanner() {
    const d = state.data;
    const fxr = d.fx_regime || {};
    const dbInfo = d.db_info || {};
    const stress = Number(fxr.stress_score || 0);
    const stressCol = stress >= 60 ? '#ea580c' : stress >= 38 ? '#d97706' : '#10b981';

    return `
      <div class="panel mc-top-panel">
        <div class="panel-head">
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <span class="badge" style="background:rgba(234,88,12,0.14);color:#ea580c;border:1px solid rgba(234,88,12,0.35);font-weight:700;">
                DUAL MODEL INTEGRATED CONTROLLER
              </span>
              <span class="badge badge-flat mono">
                fitd DB (${esc(dbInfo.host || '175.193.255.215:3306/fitd')}) · 선물 ${int(dbInfo.total_db_futures || 20)}종 직결 (${num(dbInfo.elapsed_ms, 0)}ms)
              </span>
              <span class="badge badge-flat mono">기준일 ${esc(d.as_of)} (${esc(d.data_mode === 'live' ? 'BBG 실시간 연동' : '종가 기준')})</span>
            </div>
            <div class="panel-title">확장 B · 레시피 1 (CTA_RECIPE1) × FX 차익거래 레짐 이탈 · fitd DB 통합 워크벤치</div>
            <div class="panel-sub">
              ① <strong>FX RV 55개 통화쌍의 평균회귀 이탈(Frozen-Refit Z 괴리 확대)</strong>과 <strong>fitd DB 7대 통화선물(EC·JY·BP·AD·CD·SF·KU) 모멘텀</strong>을 교차 검증하고,
              ② <strong>CTA_RECIPE1의 6개 주기(7~112일) 내부 신호 분해 및 5단계 포지션 가격 기준선(진입·증액·최대 배분·부분익절·눌림목 재진입)</strong>을 실시간 모니터링합니다.
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button type="button" class="btn ${state.autoRegimeGate ? 'active' : ''}" id="r1-toggle-autogate" style="border-color:${stressCol};">
              ${state.autoRegimeGate ? '✓ FX 레짐→레시피1 자동 연동 ON' : 'FX 레짐→레시피1 자동 연동 OFF'}
            </button>
            <button type="button" class="btn primary" id="r1-refresh-db" ${state.refreshingDb ? 'disabled' : ''}>
              ${state.refreshingDb ? '↻ fitd DB 쿼리 중...' : '↻ fitd DB 즉시 재조회'}
            </button>
          </div>
        </div>

        <div class="mc-kpi-grid" style="margin-top:10px;">
          <div class="mc-kpi" style="border-left:4px solid ${stressCol};">
            <div class="mc-kpi-label">① FX RV 레짐 스트레스 지수 (55개 통화쌍)</div>
            <div class="mc-kpi-value mono" style="color:${stressCol};">${num(stress, 1)} <span class="muted" style="font-size:13px;">/ 100점</span></div>
            <div class="mc-kpi-sub">
              <strong>${esc(fxr.regime_label)}</strong><br>
              평균 |OOS−Refit Z| 괴리 <strong class="mono">${num(fxr.mean_z_drift, 3)}σ</strong> · 이탈/보류 페어 <strong>${int(fxr.tail_pairs_count)}/${int(fxr.fx_pairs_count)}개 (${num((fxr.tail_pairs_ratio || 0) * 100, 1)}%)</strong>
            </div>
          </div>

          <div class="mc-kpi" style="border-left:4px solid #0284c7;">
            <div class="mc-kpi-label">② fitd DB 7대 통화선물 달러 모멘텀 (FX Impulse)</div>
            <div class="mc-kpi-value mono ${fxr.avg_usd_impulse >= 0 ? 'pos' : 'neg'}">
              ${fxr.avg_usd_impulse >= 0.2 ? '▲ 강달러 추세' : fxr.avg_usd_impulse <= -0.2 ? '▼ 약달러 추세' : '중립'}
              <span style="font-size:14px;">(${signedNum(fxr.avg_usd_impulse, 3)})</span>
            </div>
            <div class="mc-kpi-sub">
              유로(EC) <strong class="mono">${signedNum(fxr.fx_futures?.[0]?.recipe1_score, 2)}</strong> ·
              엔(JY) <strong class="mono">${signedNum(fxr.fx_futures?.[1]?.recipe1_score, 2)}</strong> ·
              호주(AD) <strong class="mono">${signedNum(fxr.fx_futures?.[3]?.recipe1_score, 2)}</strong> → 미국채 금리↑(SHORT)과 동조
            </div>
          </div>

          <div class="mc-kpi" style="border-left:4px solid #ea580c;">
            <div class="mc-kpi-label">③ CTA_RECIPE1 연동 예산 배수 & 승격 문턱</div>
            <div class="mc-kpi-value mono" style="color:#ea580c;">
              ${num(state.autoRegimeGate ? fxr.recommended_budget_mult : state.budgetMult, 2)}x
              <span class="muted" style="font-size:14px;">($${int(35000 * (state.autoRegimeGate ? fxr.recommended_budget_mult : state.budgetMult))})</span>
            </div>
            <div class="mc-kpi-sub">
              교차자산 동조 시 3/3 최대 배분 기준: <strong>|CTA| ≥ 0.75 → ≥ ${num(fxr.recommended_full_thr || 0.68, 2)} 완화</strong> · 추세 수익성 확대
            </div>
          </div>

          <div class="mc-kpi" style="border-left:4px solid #10b981;">
            <div class="mc-kpi-label">④ 현재 CTA_RECIPE1 모형 포지션</div>
            <div class="mc-kpi-value mono neg">TUZ26 SHORT 26계약</div>
            <div class="mc-kpi-sub">
              10D 1차 진입(16계약 @101.953) → 20D 2차 증액(+10→26계약 @101.742) · <strong>교차자산 동조(Triple Aligned)</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPillar1FxRegimeAndDbCrossCheck() {
    const fxr = state.data?.fx_regime || {};
    const topPairs = (fxr.top_stressed_fx_pairs || []).slice(0, 7);
    const fxFuts = fxr.fx_futures || [];

    const pairRows = topPairs.map(p => {
      const driftCol = p.z_drift >= 0.45 ? 'neg' : p.z_drift >= 0.25 ? 'pos' : 'muted';
      return `
        <tr>
          <td>
            <strong>${esc(p.name)}</strong>
            <div class="muted mono" style="font-size:11px;">${esc(p.id)}</div>
          </td>
          <td><span class="badge badge-flat">${esc(p.status)}</span></td>
          <td class="num mono ${Math.abs(p.oos_z) >= 2.5 ? 'neg' : ''}"><strong>${signedNum(p.oos_z, 2)}σ</strong></td>
          <td class="num mono muted">${signedNum(p.refit_z, 2)}σ</td>
          <td class="num mono ${driftCol}"><strong>${num(p.z_drift, 3)}σ</strong></td>
          <td class="num mono">${num(p.half_life, 1)}일</td>
        </tr>
      `;
    }).join('');

    const fxFutRows = fxFuts.map(f => {
      const r1 = Number(f.recipe1_score || 0);
      const b10 = f.breakout10_dir !== 0 ? (f.breakout10_dir > 0 ? '▲10D' : '▼10D') : '—';
      const b20 = f.breakout20_dir !== 0 ? (f.breakout20_dir > 0 ? '▲20D' : '▼20D') : '—';
      return `
        <tr>
          <td>
            <strong>${esc(f.id)}</strong> <span class="muted">${esc(f.name)}</span>
            <div class="muted mono" style="font-size:11px;">근월물 ${esc(f.contract)} (만기 ${esc(f.expiry)})</div>
          </td>
          <td class="num mono">
            <strong>${num(f.raw_close, f.id === 'KU' ? 2 : 4)}</strong>
            <div class="${clsPnl(f.daily_change_raw)}" style="font-size:11px;">${signedNum(f.daily_change_raw, f.id === 'KU' ? 2 : 4)}</div>
          </td>
          <td class="num mono ${r1 > 0 ? 'pos' : r1 < 0 ? 'neg' : 'muted'}">
            <strong>${signedNum(r1, 3)}</strong>
            <div class="muted" style="font-size:11px;">동의 ${int(f.agreement)}/6</div>
          </td>
          <td class="num mono muted" style="font-size:11.5px;">
            R2: ${signedNum(f.recipe2_score, 2)}<br>W0: ${signedNum(f.base_score, 2)}
          </td>
          <td class="mono" style="font-size:11.5px;">${esc(b10)} / ${esc(b20)}</td>
          <td>
            <span class="badge ${f.usd_impulse >= 0.2 ? 'badge-short' : f.usd_impulse <= -0.2 ? 'badge-long' : 'badge-flat'}">
              ${esc(f.usd_view_label)}
            </span>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">1. [Pillar ①] FX 차익거래 레짐 붕괴(state.json) × fitd DB 7대 통화선물(EC·JY·BP·AD·CD·SF·KU) 크로스 체크 모니터</div>
            <div class="panel-sub">
              FX RV 페어의 70일 OLS 회귀선 표류(<code>|OOS Z - Refit Z|</code>)가 커질수록 평균회귀가 깨지고 추세가 형성됩니다.
              우측 <code>fitd</code> DB 통화선물의 <strong>레시피 1 CTA 점수</strong>가 동일 방향(강달러 = 미 국채선물 매도/금리 상승)으로 정렬되면 <strong>CTA_RECIPE1의 3/3 Full 증액 및 눌림목 재진입 확신도</strong>가 극대화됩니다.
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:14px;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <strong style="font-size:13.5px;color:var(--text);">■ FX 통계적 차익거래 (55개 페어) 레짐 균열 · Z-괴리 상위 통화쌍</strong>
              <span class="muted mono" style="font-size:11.5px;">평균 반감기 ${num(fxr.mean_half_life, 1)}일 · 최대 괴리 ${num(fxr.max_z_drift, 3)}σ</span>
            </div>
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>FX 차익거래 페어</th>
                    <th>상태</th>
                    <th class="num">OOS Z (고정)</th>
                    <th class="num">Refit Z (갱신)</th>
                    <th class="num">|Z 괴리 폭|</th>
                    <th class="num">반감기</th>
                  </tr>
                </thead>
                <tbody>${pairRows}</tbody>
              </table>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <strong style="font-size:13.5px;color:var(--text);">■ fitd DB 통화선물 7종 (kis_market_prices) 레시피1 모멘텀 동조</strong>
              <span class="muted mono" style="font-size:11.5px;">disp:ma 70:30 · k=1.05 · W3 단중기 66%</span>
            </div>
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>DB 통화선물 / 근월물</th>
                    <th class="num">최근 종가 (전일비)</th>
                    <th class="num">레시피1 CTA</th>
                    <th class="num">타 레시피 비교</th>
                    <th>10D / 20D</th>
                    <th>국채금리 동조 방향</th>
                  </tr>
                </thead>
                <tbody>${fxFutRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPillar2RatesUniverseTable() {
    const allInst = state.data?.rates_instruments || [];
    const list = state.universeMode === 'CORE5' ? allInst.filter(x => x.is_core5) : allInst;

    const rowsHtml = list.map(inst => {
      const calc = computeCustomCta(inst);
      const isSel = inst.id === state.selectedId;
      const pos = inst.position;
      const b10 = inst.breakout10_dir !== 0 ? (inst.breakout10_dir > 0 ? '▲10D 돌파' : '▼10D 돌파') : `대기 (${num(inst.raw_low10, 2)}~${num(inst.raw_high10, 2)})`;
      const b20 = inst.breakout20_dir !== 0 ? (inst.breakout20_dir > 0 ? '▲20D 돌파' : '▼20D 돌파') : `대기 (${num(inst.raw_low20, 2)}~${num(inst.raw_high20, 2)})`;

      const posCell = pos
        ? `<div><span class="badge ${pos.direction > 0 ? 'badge-long' : 'badge-short'}">${pos.direction > 0 ? '▲ LONG' : '▼ SHORT'} ${int(pos.initial_contracts || pos.contracts)}→${int(pos.contracts)}계약</span></div>
           <div class="mono ${clsPnl(pos.net)}" style="font-size:11.5px;margin-top:2px;">${usd(pos.net)} · 진입 ${esc(pos.entry_date)}</div>`
        : inst.country_held_id && inst.country_held_id !== inst.id
        ? `<span class="muted" style="font-size:11.5px;">${esc(inst.region)} 슬롯 (${esc(inst.country_held_id)} 보유중)</span>`
        : `<span class="muted" style="font-size:11.5px;">미보유 (신호 감시)</span>`;

      return `
        <tr class="mc-row ${isSel ? 'row-selected' : ''}" data-r1-asset="${esc(inst.id)}" style="cursor:pointer;">
          <td>
            <div><strong>${esc(inst.id)}</strong> <span class="muted">${esc(inst.name)}</span></div>
            <div class="muted mono" style="font-size:11px;">${esc(inst.region)} · ${esc(inst.exchange)} · <strong>${esc(inst.contract)}</strong> (만기 ${esc(inst.expiry)})</div>
          </td>
          <td class="num mono">
            <div><strong>${num(inst.raw_close, 3)}</strong> <span class="muted" style="font-size:11px;">(신호가 ${num(inst.sig_close, 2)})</span></div>
            <div class="muted" style="font-size:11px;">MA20 ${num(inst.raw_ma20, 2)} / MA60 ${num(inst.raw_ma60, 2)}</div>
          </td>
          <td>
            <div class="mono" style="font-size:11.5px;color:${inst.breakout10_dir !== 0 ? 'var(--blue)' : 'var(--muted)'};"><strong>10D(1차):</strong> ${esc(b10)}</div>
            <div class="mono" style="font-size:11.5px;color:${inst.breakout20_dir !== 0 ? 'var(--green)' : 'var(--muted)'};"><strong>20D(2차):</strong> ${esc(b20)}</div>
          </td>
          <td class="num mono">
            <div class="${calc.score > 0 ? 'pos' : calc.score < 0 ? 'neg' : 'muted'}" style="font-size:13.5px;">
              <strong>${signedNum(calc.score, 3)}</strong>
            </div>
            <div class="muted" style="font-size:11px;">6주기 동의: <strong>${int(calc.agreement)}/6</strong> · 기본MS ${signedNum(inst.standard_ms, 3)}</div>
          </td>
          <td>
            <div><span class="badge badge-flat">${esc(calc.stageLabel)}</span></div>
            <div class="muted mono" style="font-size:11px;margin-top:2px;">
              1/3(${int(calc.scoutContracts)}) · 2/3(${int(calc.mainContracts)}) · Full(${int(calc.fullContracts)}계약)
            </div>
          </td>
          <td>
            <span class="badge ${inst.triple_aligned ? 'badge-short' : 'badge-flat'}" style="${inst.triple_aligned ? 'background:rgba(234,88,12,0.16);color:#ea580c;border-color:rgba(234,88,12,0.4);' : ''}">
              ${esc(inst.alignment_badge)}
            </span>
            <div class="muted mono" style="font-size:11px;margin-top:2px;">${esc(inst.paired_fx_label)}</div>
          </td>
          <td>${posCell}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">2. [fitd DB 국채선물 유니버스] 실시간 CTA_RECIPE1 신호 · 3중 동조 · 목표 계약 모니터</div>
            <div class="panel-sub">행(종목)을 클릭하면 하단 3번 워크벤치의 <strong>[6개 주기 신호 분해 차트]</strong>와 <strong>[5단계 포지션 가격 사다리(Price Ladder)]</strong>가 해당 종목으로 즉시 전환됩니다.</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button type="button" class="btn ${state.universeMode === 'CORE5' ? 'active' : ''}" data-r1-univ="CORE5">
              ★ 핵심 5대 국채선물 (TU·FV·TY·DU·RX)
            </button>
            <button type="button" class="btn ${state.universeMode === 'ALL13' ? 'active' : ''}" data-r1-univ="ALL13">
              fitd DB 전체 13종 국채선물 (US·DE·IT·FR·KR)
            </button>
          </div>
        </div>

        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>종목 / 거래소 / 근월물</th>
                <th class="num">근월물 현재가 (연속신호가)</th>
                <th>10일(1차) / 20일(2차) 돌파선 (근월물 환산)</th>
                <th class="num">시뮬레이션 CTA 점수</th>
                <th>목표 단계 · 단계별 계약수</th>
                <th>FX 국면 · 통화선물 동조</th>
                <th>CTA_RECIPE1 보유 상태</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderPillar2SignalDecompAndPriceLadder() {
    const allInst = state.data?.rates_instruments || [];
    const inst = allInst.find(x => x.id === state.selectedId) || allInst[0];
    if (!inst) return '';

    const calc = computeCustomCta(inst);
    const pos = inst.position;
    const dir = pos ? Number(pos.direction || -1) : (calc.direction || -1);
    const dirLabel = dir > 0 ? '▲ LONG (금리 하락 베팅)' : '▼ SHORT (금리 상승 베팅)';

    // Build 5-stage Price Ladder in ACTUAL FRONT-MONTH CONTRACT PRICE (raw_px) and SIGNAL PRICE (sig_px)
    const rawOff = Number(inst.raw_offset || 0);
    const rawNow = Number(inst.raw_close || 100);
    const sigNow = Number(inst.sig_close || 100);
    const stopDist = Number(inst.stop_dist_pt || 0.35);

    const entryRaw = pos ? Number(pos.entry_price || pos.entry_contract_price || rawNow) : (dir < 0 ? inst.raw_low10 : inst.raw_high10);
    const add20Raw = pos && pos.add_price ? Number(pos.add_price) : (dir < 0 ? inst.raw_low20 : inst.raw_high20);
    const stopRaw = pos && pos.stop ? Number(pos.stop) + rawOff : entryRaw - dir * stopDist;
    const chan10ExitRaw = dir < 0 ? inst.raw_high10 : inst.raw_low10;

    // 3/3 Full upgrade trigger price (approx additional 0.35*SD20 move in trend direction if not yet >= fullThr)
    const scoreGapToFull = Math.max(0, calc.fullThr - calc.absScore);
    const fullTriggerMove = scoreGapToFull > 0 ? Math.max(inst.tick_size * 4, scoreGapToFull * inst.sd20 * 3.2) : 0;
    const fullUpgradeRaw = rawNow + dir * fullTriggerMove;

    // +0.90R Partial TP price
    const activeContracts = pos ? Number(pos.contracts || calc.mainContracts) : calc.mainContracts;
    const targetProfit09R = 0.90 * 35000.0 * calc.effMult;
    const curNet = pos ? Number(pos.net || 0) : 0;
    const remProfitNeeded = Math.max(0, targetProfit09R - curNet);
    const ptMoveFor09R = remProfitNeeded / Math.max(1, activeContracts * Number(inst.point_value || 1000) * Number(inst.fx || 1));
    const partialTpRaw = pos && pos.next_tp_price ? Number(pos.next_tp_price) : (rawNow + dir * ptMoveFor09R);

    // Stage 2 Pullback Re-entry zone (around MA20 with MA60 support)
    const pullbackZoneRaw = inst.raw_ma20;
    const trendGuardRaw = inst.raw_ma60;

    const ladderRows = [
      {
        stage: '[리스크 관리 1] 2.5×SD20 변동성 스탑',
        type: 'STOP',
        color: '#ef4444',
        rawPx: stopRaw,
        sigPx: stopRaw - rawOff,
        diffPt: stopRaw - rawNow,
        contractsText: '전량 즉시 손절 (0계약)',
        ruleDesc: `진입가 대비 2.5×SD20 (${num(stopDist, 4)}pt / ${int(inst.stop_ticks)}틱) 역행 시 장중 손절 · 1계약당 위험 $${num(inst.loss_per_contract_usd, 0)}`,
      },
      {
        stage: '[리스크 관리 2] 10일 반대채널 이탈 / 5일 타임스탑',
        type: 'CHANNEL_EXIT',
        color: '#f97316',
        rawPx: chan10ExitRaw,
        sigPx: chan10ExitRaw - rawOff,
        diffPt: chan10ExitRaw - rawNow,
        contractsText: '잔여 물량 추세종료 청산',
        ruleDesc: `종가가 10일 반대 채널(${num(chan10ExitRaw, 3)})을 돌파하거나 진입 5일 경과 시 모멘텀 지연(HWM < +0.16R) 상태면 다음 시가 청산`,
      },
      {
        stage: '[레시피1 전용] 부분익절 후 눌림목 재진입 구간',
        type: 'PULLBACK_REENTRY',
        color: '#0ea5e9',
        rawPx: pullbackZoneRaw,
        sigPx: inst.ma20,
        diffPt: pullbackZoneRaw - rawNow,
        contractsText: `부분익절 물량 재진입 → ${int(calc.mainContracts)}계약 (2/3)`,
        ruleDesc: `+0.90R 부분익절 완료 후 가격이 MA20(${num(pullbackZoneRaw, 3)}) 부근으로 되돌림을 주되 MA60(${num(trendGuardRaw, 3)}) 및 |CTA| ≥ 0.50 유지 시 2/3 표준 배분 복원`,
      },
      {
        stage: '[1차 초기 진입] 10일 돌파 1/3 배분',
        type: 'STAGE1_SCOUT',
        color: '#3b82f6',
        rawPx: entryRaw,
        sigPx: entryRaw - rawOff,
        diffPt: entryRaw - rawNow,
        contractsText: `목표 1/3 · ${int(calc.scoutContracts)}계약 ($${int(calc.fullBudgetUsd / 3)})`,
        ruleDesc: pos
          ? `체결 완료 (${esc(pos.entry_date)} · ${int(pos.initial_contracts || calc.scoutContracts)}계약 @ ${num(entryRaw, 3)})`
          : `10일 채널(${num(entryRaw, 3)}) 돌파 & |CTA| ≥ 0.25 충족 시 1차 초기 진입(1/3)`,
      },
      {
        stage: '[현재 시장가 · Mark-to-Market]',
        type: 'CURRENT_MARK',
        color: '#10b981',
        rawPx: rawNow,
        sigPx: sigNow,
        diffPt: 0,
        contractsText: pos ? `현재 보유: ${int(pos.contracts)}계약 (${usd(pos.net)})` : `현재 목표: ${int(calc.targetContracts)}계약`,
        ruleDesc: `근월물 ${esc(inst.contract)} 현재가 ${num(rawNow, 3)} · 시뮬레이션 CTA 점수 ${signedNum(calc.score, 3)} (${int(calc.agreement)}/6 동의)`,
      },
      {
        stage: '[2차 표준 증액] 20일 돌파 2/3 배분',
        type: 'STAGE2_MAIN',
        color: '#8b5cf6',
        rawPx: add20Raw,
        sigPx: add20Raw - rawOff,
        diffPt: add20Raw - rawNow,
        contractsText: `목표 2/3 · ${int(calc.mainContracts)}계약 ($${int((calc.fullBudgetUsd * 2) / 3)})`,
        ruleDesc: pos && pos.main_stage_done
          ? `20D 2차 증액 완료 (총 ${int(pos.contracts)}계약 · 증액체결가 ${num(add20Raw, 3)})`
          : `20일 채널(${num(add20Raw, 3)}) 돌파 & |CTA| ≥ 0.50 확인 시 목표 총량 2/3(${int(calc.mainContracts)}계약)로 증액`,
      },
      {
        stage: `[3차 최대 배분] 3/3 증액 (|CTA| ≥ ${num(calc.fullThr, 2)})`,
        type: 'STAGE3_FULL',
        color: '#ea580c',
        rawPx: fullUpgradeRaw,
        sigPx: fullUpgradeRaw - rawOff,
        diffPt: fullUpgradeRaw - rawNow,
        contractsText: `목표 3/3 · ${int(calc.fullContracts)}계약 ($${int(calc.fullBudgetUsd)})`,
        ruleDesc: calc.absScore >= calc.fullThr
          ? `현재 |CTA| ${num(calc.absScore, 3)} ≥ ${num(calc.fullThr, 2)} 충족 · 평가익 구간 진입 시 +${int(Math.max(0, calc.fullContracts - (pos?.contracts || calc.mainContracts)))}계약 추가해 ${int(calc.fullContracts)}계약 배분`
          : `|CTA| ≥ ${num(calc.fullThr, 2)} (현재 ${num(calc.absScore, 3)}, 잔여 +${num(scoreGapToFull, 3)}점) & 평가익 구간 시 3/3 최대 배분(${int(calc.fullContracts)}계약)`,
      },
      {
        stage: '[익절 4단계] +0.90R 50% 부분익절 (Partial TP)',
        type: 'STAGE4_PARTIAL_TP',
        color: '#059669',
        rawPx: partialTpRaw,
        sigPx: partialTpRaw - rawOff,
        diffPt: partialTpRaw - rawNow,
        contractsText: `50% 부분익절 (-${int(Math.ceil(activeContracts / 2))}계약 확정 · +$${int(targetProfit09R * 0.5)})`,
        ruleDesc: `도달 시 보유 물량 50% 이익실현 확정 후 잔여 50%는 손익분기(BE) 스탑 상향 & 눌림목 재진입 감시`,
      },
    ];

    const horizonBarsHtml = calc.horizons.map(h => {
      const pctBar = Math.min(100, Math.abs(h.tanh_score) * 100);
      const barCol = h.tanh_score >= 0 ? '#10b981' : '#ef4444';
      return `
        <tr>
          <td style="font-weight:700;">${esc(h.label)}</td>
          <td class="num mono ${clsPnl(h.z_disp)}">${signedNum(h.z_disp, 2)}σ</td>
          <td class="num mono ${clsPnl(h.z_ma)}">${signedNum(h.z_ma, 2)}σ</td>
          <td class="num mono ${clsPnl(h.z_blend)}"><strong>${signedNum(h.z_blend, 2)}σ</strong></td>
          <td style="min-width:150px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="flex:1;height:8px;background:rgba(148,163,184,0.18);border-radius:4px;overflow:hidden;">
                <div style="width:${pctBar.toFixed(1)}%;height:100%;background:${barCol};"></div>
              </div>
              <span class="mono ${clsPnl(h.tanh_score)}" style="font-size:11.5px;font-weight:700;min-width:48px;text-align:right;">${signedNum(h.tanh_score, 3)}</span>
            </div>
          </td>
          <td class="num mono">${num(h.weight * 100, 1)}%</td>
          <td class="num mono ${clsPnl(h.contrib)}"><strong>${signedNum(h.contrib, 3)}</strong></td>
        </tr>
      `;
    }).join('');

    const ladderHtml = ladderRows.map(l => {
      const isCurrent = l.type === 'CURRENT_MARK';
      return `
        <tr style="${isCurrent ? 'background:rgba(16,185,129,0.10);font-weight:700;' : ''}">
          <td>
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${l.color};margin-right:6px;"></span>
            <strong style="color:${isCurrent ? 'var(--green)' : 'var(--text)'};">${esc(l.stage)}</strong>
          </td>
          <td class="num mono" style="font-size:13px;"><strong>${num(l.rawPx, 3)}</strong></td>
          <td class="num mono muted" style="font-size:11.5px;">${num(l.sigPx, 2)}</td>
          <td class="num mono ${clsPnl(l.diffPt)}" style="font-size:11.5px;">
            ${isCurrent ? '현재 기준가' : `${signedNum(l.diffPt, 3)}pt`}
          </td>
          <td class="mono" style="font-size:12px;font-weight:600;">${esc(l.contractsText)}</td>
          <td style="font-size:12px;color:var(--text-secondary);">${esc(l.ruleDesc)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">
              3. [Pillar ②] ${esc(inst.id)} (${esc(inst.contract)}) · 6개 주기(7~112일) 신호 분해 & 5단계 포지션 가격 래더 워크벤치
            </div>
            <div class="panel-sub">
              하단 슬라이더나 프리셋을 조정하면 <strong>6개 주기별 변위(disp)·이평(ma) 결합 점수, 목표 계약수, Full 승격 라인이 0초 만에 실시간 재계산</strong>됩니다.
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn ${state.presetId === 'CTA_RECIPE1' ? 'active' : ''}" data-r1-preset="CTA_RECIPE1" style="border-color:#ea580c;">
              레시피 1 (70:30 · k=1.05 · W3 단중기66%)
            </button>
            <button type="button" class="btn ${state.presetId === 'CTA_RECIPE2' ? 'active' : ''}" data-r1-preset="CTA_RECIPE2" style="border-color:#9333ea;">
              레시피 2 (65:35 · k=0.70 · W7 중장기85%)
            </button>
            <button type="button" class="btn ${state.presetId === 'BASE_W0' ? 'active' : ''}" data-r1-preset="BASE_W0">
              기본 W0 (55:45 · k=0.85 · 균등)
            </button>
          </div>
        </div>

        <div class="mc-axis-strip" style="margin-bottom:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span><strong>① 변위(disp) : 이평(ma) 비중</strong></span>
              <span class="mono" style="color:#ea580c;font-weight:700;">${Math.round(state.dispWeight * 100)}% : ${Math.round((1 - state.dispWeight) * 100)}%</span>
            </div>
            <input type="range" id="r1-slider-disp" min="0.30" max="0.90" step="0.05" value="${state.dispWeight}" style="width:100%;">
            <div class="muted" style="font-size:11px;">레시피1 기본: 70% : 30% (돌파 직후 반응 극대화)</div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span><strong>② 비선형 민감도 계수 tanh(k)</strong></span>
              <span class="mono" style="color:#ea580c;font-weight:700;">k = ${num(state.k, 2)}</span>
            </div>
            <input type="range" id="r1-slider-k" min="0.50" max="1.45" step="0.05" value="${state.k}" style="width:100%;">
            <div class="muted" style="font-size:11px;">레시피1 기본: k=1.05 (빠른 2/3·3/3 증액 유도)</div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span><strong>③ 6개 주기 가중치 프로파일</strong></span>
              <span class="mono" style="font-weight:700;">${esc(state.weightProfile)}</span>
            </div>
            <div style="display:flex;gap:4px;margin-top:4px;">
              ${Object.values(WEIGHT_PROFILES).map(wp => `
                <button type="button" class="btn ${state.weightProfile === wp.id ? 'active' : ''}" data-r1-wprof="${wp.id}" style="padding:3px 8px;font-size:11px;flex:1;">
                  ${esc(wp.id)}
                </button>
              `).join('')}
            </div>
            <div class="muted" style="font-size:11px;margin-top:3px;">${esc(WEIGHT_PROFILES[state.weightProfile]?.label || '')}</div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span><strong>④ 리스크 예산 배수 ($35k 기준)</strong></span>
              <span class="mono" style="color:#10b981;font-weight:700;">${num(calc.effMult, 2)}x ($${int(calc.fullBudgetUsd)})</span>
            </div>
            <input type="range" id="r1-slider-bmult" min="0.50" max="1.50" step="0.05" value="${state.budgetMult}" style="width:100%;">
            <div class="muted" style="font-size:11px;">
              ${state.autoRegimeGate && inst.triple_aligned ? '3중 동조 감지 → 권고 배수 자동 반영 중' : '수동 예산 배수 적용 중'}
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr;gap:16px;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
              <strong style="font-size:13.5px;color:var(--text);">
                ■ [${esc(inst.id)} ${esc(inst.contract)}] 6개 주기(7~112일) 변위(disp) × 이평(ma) → tanh(k) 신호 분해표
              </strong>
              <span class="mono" style="font-size:12.5px;">
                합산 CTA 점수: <strong class="${clsPnl(calc.score)}">${signedNum(calc.score, 4)}</strong> ·
                동의 주기: <strong>${int(calc.agreement)}/6</strong> ·
                판정: <strong>${esc(calc.stageLabel)}</strong>
              </span>
            </div>
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>주기 (Lookback / EWMA 반감기)</th>
                    <th class="num">변위 Z (disp)</th>
                    <th class="num">이평 Z (ma)</th>
                    <th class="num">결합 Z (${Math.round(state.dispWeight * 100)}:${Math.round((1 - state.dispWeight) * 100)})</th>
                    <th>비선형 압축 tanh(${num(state.k, 2)} × Z)</th>
                    <th class="num">주기 가중치</th>
                    <th class="num">최종 점수 기여</th>
                  </tr>
                </thead>
                <tbody>${horizonBarsHtml}</tbody>
              </table>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
              <strong style="font-size:13.5px;color:var(--text);">
                ■ [${esc(inst.id)} ${esc(inst.contract)}] 실전 5단계 포지션 가격 사다리 (Price Ladder · ${esc(dirLabel)})
              </strong>
              <span class="mono muted" style="font-size:12px;">
                1틱 = ${inst.tick_size}pt ($${num(inst.tick_value, 2)}) · SD20 = ${num(inst.sd20, 4)}pt · 1계약 하드스탑 위험 = $${num(inst.loss_per_contract_usd, 0)}
              </span>
            </div>
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>레시피 1 실행 단계 (Action Stage)</th>
                    <th class="num">근월물 가격 (${esc(inst.contract)})</th>
                    <th class="num">연속신호가 (sig_px)</th>
                    <th class="num">현재가 대비 거리</th>
                    <th>목표 계약수 · 예산</th>
                    <th>상세 집행 조건 및 트리거 규칙</th>
                  </tr>
                </thead>
                <tbody>${ladderHtml}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPillar3RegimeBacktestAndSynergy() {
    const bt = state.data?.regime_backtest;
    if (!bt || !bt.standalone_models) return '';

    const rc = bt.regime_counts || {};
    const rp = bt.regime_ratios_pct || {};
    const rb = bt.regime_bucket_pnl || {};

    const renderModelRows = (models, highlightIds) =>
      models
        .map(m => {
          const isBest = highlightIds.includes(m.id);
          const y = m.yearly || {};
          const ym = m.yearly_mdd || {};
          return `
            <tr style="${isBest ? 'background:rgba(16,185,129,0.08);' : ''}">
              <td>
                <strong style="${isBest ? 'color:var(--green);' : ''}">${esc(m.name)}</strong>
                <div class="muted" style="font-size:11px;">${esc(m.desc || '')}</div>
              </td>
              <td class="num mono ${clsPnl(m.total_net)}"><strong>${usd(m.total_net)}</strong></td>
              <td class="num mono neg">-$${int(m.mdd)}</td>
              <td class="num mono" style="font-weight:700;color:${m.calmar >= 7.0 ? 'var(--green)' : 'var(--text)'};">${num(m.calmar, 2)}x</td>
              <td class="num mono" style="font-weight:700;color:${m.sharpe >= 1.75 ? 'var(--green)' : 'var(--text)'};">${num(m.sharpe, 2)}</td>
              <td class="num mono">${int(m.win_months)}/${int(m.total_months)} (${num(m.win_months_pct, 1)}%)</td>
              <td class="num mono ${clsPnl(m.trend_22_26)}">${usd(m.trend_22_26)}</td>
              <td class="num mono ${clsPnl(m.box_23_25)}"><strong>${usd(m.box_23_25)}</strong></td>
              <td class="num mono neg" style="font-size:11.5px;">-$${int(ym['2022'] || 0)} / -$${int(ym['2026'] || 0)}</td>
              <td class="num mono" style="font-size:11px;">
                <span class="${clsPnl(y['2022'])}">${usd(y['2022'])}</span> ·
                <span class="${clsPnl(y['2023'])}">${usd(y['2023'])}</span> ·
                <span class="${clsPnl(y['2024'])}">${usd(y['2024'])}</span> ·
                <span class="${clsPnl(y['2025'])}">${usd(y['2025'])}</span> ·
                <span class="${clsPnl(y['2026'])}">${usd(y['2026'])}</span>
              </td>
            </tr>
          `;
        })
        .join('');

    return `
      <div class="panel" style="margin-top:14px;">
        <div class="panel-head">
          <div>
            <div class="panel-title">
              4. [인과적 백테스트 실증 (${esc(bt.period)} · ${int(bt.trading_days)}거래일)] FX RV Regime Stress Index 반영 레시피1 & FX 차익거래 듀얼 시너지 성과 분석
            </div>
            <div class="panel-sub">
              fitd DB 7대 통화선물(EC·JY·BP·AD·CD·SF·KU) 로그연속 시계열의 70일 OLS <code>|OOS Z - Refit Z|</code> 구조 붕괴폭 + 통화선물 레시피1 방향성 임펄스 + 직전 15일 FX RV 드로다운을 전일 종가($t-1$) 기준으로 엄밀하게 결합한 인과적(Causal) 백테스트 결과입니다.
            </div>
          </div>
        </div>

        <div class="mc-kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-bottom:14px;">
          <div class="mc-kpi-card" style="border-top:3px solid #10b981;">
            <div class="mc-kpi-label">수렴 · 박스권 (I_stress &lt; 36)</div>
            <div class="mc-kpi-val">${int(rc.MEAN_REVERSION_BOX)}거래일 (${num(rp.MEAN_REVERSION_BOX, 1)}%)</div>
            <div class="mc-kpi-sub">
              FX 단독: <strong class="pos">${usd(rb.MEAN_REVERSION_BOX?.FX)}</strong> ·
              고정R1: <strong>${usd(rb.MEAN_REVERSION_BOX?.R1_BASE)}</strong><br>
              단순감축(0.55x): <span class="neg">${usd(rb.MEAN_REVERSION_BOX?.R1_GATED)} (초기진입 훼손)</span> ·
              적응형R1: <strong class="pos">${usd(rb.MEAN_REVERSION_BOX?.R1_ADAPTIVE)}</strong>
            </div>
          </div>
          <div class="mc-kpi-card" style="border-top:3px solid #f59e0b;">
            <div class="mc-kpi-label">레짐 균열 · 전환 경보 (36 ≤ I_stress &lt; 55)</div>
            <div class="mc-kpi-val">${int(rc.TRANSITION_ALERT)}거래일 (${num(rp.TRANSITION_ALERT, 1)}%)</div>
            <div class="mc-kpi-sub">
              FX 단독: <strong>${usd(rb.TRANSITION_ALERT?.FX)}</strong> ·
              고정R1: <strong class="pos">${usd(rb.TRANSITION_ALERT?.R1_BASE)}</strong><br>
              적응형R1(1.05x): <strong class="pos">${usd(rb.TRANSITION_ALERT?.R1_ADAPTIVE)}</strong> ·
              적응형 듀얼: <strong class="pos">${usd(rb.TRANSITION_ALERT?.DUAL_ADAPTIVE)}</strong>
            </div>
          </div>
          <div class="mc-kpi-card" style="border-top:3px solid #dc2626;">
            <div class="mc-kpi-label">추세 발산 · RV 경보 (I_stress ≥ 55)</div>
            <div class="mc-kpi-val">${int(rc.TREND_EXPANSION)}거래일 (${num(rp.TREND_EXPANSION, 1)}%)</div>
            <div class="mc-kpi-sub">
              고정R1: <strong>${usd(rb.TREND_EXPANSION?.R1_BASE)} (+$1,082/일)</strong> →
              Runner+2슬롯 해제: <strong class="pos">${usd(rb.TREND_EXPANSION?.R1_UNCAP)} (+$2,218/일)</strong><br>
              전체 거래일의 15.5% 구간에서 부분익절 유예 & 슬롯 확장 시 수익성 개선
            </div>
          </div>
        </div>

        <div style="margin-bottom:16px;">
          <div style="font-weight:700;font-size:13.5px;margin-bottom:6px;color:var(--text);">
            ■ [비교 A] 모멘텀 단독 (Standalone CTA_RECIPE1) : 단순 배수 조정(1단계) vs 구조적 제약 완화(2단계: 부분익절 유예·슬롯 확장) vs fitd DB 멀티에셋 확장(3단계)
          </div>
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>모멘텀 단독 백테스트 모델</th>
                  <th class="num">총 순손익 (Net)</th>
                  <th class="num">최대낙폭 (MDD)</th>
                  <th class="num">Calmar</th>
                  <th class="num">Sharpe</th>
                  <th class="num">월간 승률</th>
                  <th class="num">추세장 (22+26년)</th>
                  <th class="num">박스권 (23~25년)</th>
                  <th class="num">22년 / 26년 MDD</th>
                  <th class="num">연도별 순손익 (22 · 23 · 24 · 25 · 26)</th>
                </tr>
              </thead>
              <tbody>
                ${renderModelRows(bt.standalone_models, ['R1_UNCAP_CURVE', 'R1_DB_MULTIASSET'])}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div style="font-weight:700;font-size:13.5px;margin-bottom:6px;color:var(--text);">
            ■ [비교 B] FX 차익거래 × 레시피1 듀얼 포트폴리오 (Dual Synergy) : 단순 현금대기(1단계) vs ★유휴자본 동적 재배치(2단계) vs ★★DB 멀티에셋 총합(3단계)
          </div>
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>FX 차익거래 + 모멘텀 듀얼 포트폴리오 모델</th>
                  <th class="num">총 순손익 (Net)</th>
                  <th class="num">최대낙폭 (MDD)</th>
                  <th class="num">Calmar</th>
                  <th class="num">Sharpe</th>
                  <th class="num">월간 승률</th>
                  <th class="num">추세장 (22+26년)</th>
                  <th class="num">박스권 (23~25년)</th>
                  <th class="num">22년 / 26년 MDD</th>
                  <th class="num">연도별 순손익 (22 · 23 · 24 · 25 · 26)</th>
                </tr>
              </thead>
              <tbody>
                ${renderModelRows(bt.dual_models, ['DUAL_CAPITAL_REALLOC', 'DUAL_DB_MULTIASSET'])}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function renderAll(host) {
    if (!host) return;
    if (state.loading && !state.data) {
      host.innerHTML = `<div class="panel"><div class="empty">fitd DB(175.193.255.215:3306) 및 FX 레짐 통합 컨트롤러 데이터를 불러오는 중입니다...</div></div>`;
      return;
    }
    if (state.error) {
      host.innerHTML = `<div class="panel"><div class="empty neg">데이터 로드 실패: ${esc(state.error)}</div></div>`;
      return;
    }
    if (!state.data) return;

    host.innerHTML = `
      <div class="mc-root">
        ${renderTopBanner()}
        ${renderPillar1FxRegimeAndDbCrossCheck()}
        ${renderPillar2RatesUniverseTable()}
        ${renderPillar2SignalDecompAndPriceLadder()}
        ${renderPillar3RegimeBacktestAndSynergy()}
      </div>
    `;

    bindEvents(host);
  }

  function bindEvents(host) {
    const autoBtn = host.querySelector('#r1-toggle-autogate');
    if (autoBtn) {
      autoBtn.onclick = () => {
        state.autoRegimeGate = !state.autoRegimeGate;
        renderAll(host);
      };
    }

    const dbBtn = host.querySelector('#r1-refresh-db');
    if (dbBtn) {
      dbBtn.onclick = () => {
        ensureLoaded(host, true, true);
      };
    }

    host.querySelectorAll('[data-r1-univ]').forEach(el => {
      el.onclick = () => {
        state.universeMode = el.getAttribute('data-r1-univ') || 'CORE5';
        renderAll(host);
      };
    });

    host.querySelectorAll('[data-r1-asset]').forEach(el => {
      el.onclick = () => {
        const aid = el.getAttribute('data-r1-asset');
        if (aid) {
          state.selectedId = aid;
          renderAll(host);
        }
      };
    });

    host.querySelectorAll('[data-r1-preset]').forEach(el => {
      el.onclick = () => {
        const pid = el.getAttribute('data-r1-preset');
        state.presetId = pid;
        if (pid === 'CTA_RECIPE1') {
          state.dispWeight = 0.70;
          state.k = 1.05;
          state.weightProfile = 'W3';
        } else if (pid === 'CTA_RECIPE2') {
          state.dispWeight = 0.65;
          state.k = 0.70;
          state.weightProfile = 'W7';
        } else {
          state.dispWeight = 0.55;
          state.k = 0.85;
          state.weightProfile = 'W0';
        }
        renderAll(host);
      };
    });

    host.querySelectorAll('[data-r1-wprof]').forEach(el => {
      el.onclick = () => {
        state.weightProfile = el.getAttribute('data-r1-wprof') || 'W3';
        state.presetId = 'CUSTOM';
        renderAll(host);
      };
    });

    const slDisp = host.querySelector('#r1-slider-disp');
    if (slDisp) {
      slDisp.onchange = e => {
        state.dispWeight = Number(e.target.value);
        state.presetId = 'CUSTOM';
        renderAll(host);
      };
    }

    const slK = host.querySelector('#r1-slider-k');
    if (slK) {
      slK.onchange = e => {
        state.k = Number(e.target.value);
        state.presetId = 'CUSTOM';
        renderAll(host);
      };
    }

    const slBmult = host.querySelector('#r1-slider-bmult');
    if (slBmult) {
      slBmult.onchange = e => {
        state.budgetMult = Number(e.target.value);
        state.autoRegimeGate = false;
        renderAll(host);
      };
    }
  }

  async function ensureLoaded(host, force = false, refreshDb = false) {
    const curMode = externalCtx?.getState?.()?.data_mode || document.documentElement.getAttribute('data-live-mode') || window.FITD_DATA_MODE || 'live';
    if (state.data && state.loadedMode === curMode && !force && !refreshDb) {
      renderAll(host);
      return;
    }
    if (refreshDb) {
      state.refreshingDb = true;
    } else {
      state.loading = true;
    }
    state.error = null;
    renderAll(host);
    try {
      const modeParam = curMode ? `mode=${encodeURIComponent(curMode)}&` : '';
      const dbParam = refreshDb ? 'refresh_db=1&' : '';
      const res = await fetch(`/api/recipe1-control?${modeParam}${dbParam}t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
      state.loadedMode = curMode;
      state.loading = false;
      state.refreshingDb = false;
      renderAll(host);
    } catch (err) {
      state.loading = false;
      state.refreshingDb = false;
      state.error = err.message || String(err);
      renderAll(host);
    }
  }

  window.FITDMomentumRecipe1Control = {
    render(selectorOrEl, force = false) {
      const host = typeof selectorOrEl === 'string' ? document.querySelector(selectorOrEl) : selectorOrEl;
      if (!host) return;
      ensureLoaded(host, force, false);
    },
    reload() {
      const host = document.querySelector('#momentum-content');
      if (host) ensureLoaded(host, true, false);
    },
  };
})();
