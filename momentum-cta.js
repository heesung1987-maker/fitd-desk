let externalCtx = null;

export function configureMomentumCta(c) {
  externalCtx = c;
}

export function renderMomentumCta(target) {
  if (window.FITDMomentumCTA) {
    window.FITDMomentumCTA.render(target);
  }
}

(function () {
  const CORE_VARIANTS = ['BASE', 'TIER', 'STAGED_10_20', 'CTA_RECIPE2', 'FAST_3BEAT', 'SNIPER_S3'];
  const TOP_MODEL_ORDER = [
    'BASE',
    'TIER',
    'STAGED_10_20',
    'CTA_RECIPE2',
    'FAST_3BEAT',
    'SNIPER_S3',
    'METHOD_3',
    'CTA_RECIPE1',
    'PURE_CTA',
    'SIMPLE_10D',
  ];
  const ALL_ORDER = [
    'FAST_3BEAT',
    'SNIPER_S3',
    'CTA_RECIPE2',
    'STAGED_10_20',
    'TIER',
    'BASE',
    'METHOD_3',
    'CTA_RECIPE1',
    'PURE_CTA',
    'SIMPLE_10D',
  ];

  const COLORS = {
    BASE: '#94a3b8',
    TIER: '#0d9488',
    STAGED_10_20: '#0284c7',
    CTA_RECIPE2: '#9333ea',
    FAST_3BEAT: '#10b981',
    SNIPER_S3: '#d97706',
    METHOD_3: '#0ea5e9',
    CTA_RECIPE1: '#ea580c',
    PURE_CTA: '#64748b',
    SIMPLE_10D: '#ef4444',
  };

  const state = {
    data: null,
    loadedMode: null,
    loading: false,
    error: null,
    variant: 'FAST_3BEAT',
    activeAxis: 'axis3_exit_management',
    costTicks: 1,
    selectedId: 'TU',
    tradeAsset: 'ALL',
    tradeYear: 'ALL',
    ledgerTab: 'EXECUTED',
    detailsOpen: true,
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

  function pct(v, d = 1) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `${(Number(v) * 100).toFixed(d)}%`;
  }

  function rFmt(v, d = 2) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    return `${n > 0 ? '+' : ''}${n.toFixed(d)}R`;
  }

  function clsPnl(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return 'muted';
    return n > 0 ? 'pos' : 'neg';
  }

  function dirBadge(dir, label) {
    if (dir > 0) return `<span class="badge badge-long">▲ ${esc(label || 'LONG (금리↓)')}</span>`;
    if (dir < 0) return `<span class="badge badge-short">▼ ${esc(label || 'SHORT (금리↑)')}</span>`;
    return `<span class="badge badge-flat">FLAT</span>`;
  }

  function exitReasonBadge(reason) {
    const map = {
      PROFIT_LOCK_014R: ['badge-long', '+0.28R 도달 → +0.14R 확정익절'],
      PARTIAL_TP_TRAIL: ['badge-long', '+0.80R 부분익절 후 추세청산'],
      TRAIL_STOP_T2: ['badge-long', '장기 추세 고점보전 트레일링'],
      TRAIL_STOP_T1: ['badge-long', '트레일링 익절'],
      TIME_STOP_3D: ['badge-review', '3일 모멘텀 지연 조기 청산'],
      TIME_STOP_5D: ['badge-review', '5일 모멘텀 지연 타임스탑'],
      STOP_INTRADAY: ['badge-short', '장중 2.5σ 변동성 스탑'],
      STOP_GAP_OPEN: ['badge-short', '시가 갭 스탑'],
      CHANNEL_10D: ['badge-flat', '10일 채널 청산'],
      CTA_FLIP_EXIT: ['badge-review', 'CTA 반전 청산'],
      OPEN: ['badge-long', '보유중'],
    };
    const item = map[reason] || ['badge-flat', reason || '—'];
    return `<span class="badge ${item[0]}">${esc(item[1])}</span>`;
  }

  function getModel(variant = state.variant) {
    return state.data?.models?.[variant] || state.data?.models?.FAST_3BEAT || null;
  }

  function getVariantSpec(variant = state.variant) {
    return state.data?.variants?.[variant] || {
      name: variant,
      short_name: variant,
      color: COLORS[variant] || '#10b981',
    };
  }

  function getSummaryForCost(model, costTicks = state.costTicks) {
    if (!model) return null;
    const found = (model.stress || []).find(s => Number(s.cost_ticks) === Number(costTicks));
    return found || model.summary;
  }

  function seriesFromDaily(model, costTicks = state.costTicks) {
    if (!model?.daily) return [];
    let cum = 0;
    let peak = 0;
    return model.daily.map(row => {
      let gross = 0;
      let cost = 0;
      Object.values(row.assets || {}).forEach(a => {
        gross += Number(a.gross || 0);
        cost += Number(a.cost || 0) * costTicks;
      });
      const net = gross - cost;
      cum += net;
      if (cum > peak) peak = cum;
      return { date: row.date, net, cum, dd: peak - cum };
    });
  }

  function svgLineChart(seriesList, height = 270) {
    const nonEmpty = seriesList.filter(s => s.points && s.points.length);
    if (!nonEmpty.length) return '<div class="empty">시계열 데이터가 없습니다.</div>';
    const width = 860;
    const padL = 68;
    const padR = 20;
    const padT = 18;
    const padB = 30;
    const allPts = nonEmpty.flatMap(s => s.points);
    let minY = Math.min(0, ...allPts.map(p => p.y));
    let maxY = Math.max(0, ...allPts.map(p => p.y));
    if (Math.abs(maxY - minY) < 1e-6) {
      maxY += 1;
      minY -= 1;
    }
    const maxLen = Math.max(...nonEmpty.map(s => s.points.length));
    const xOf = i => padL + (i / Math.max(1, maxLen - 1)) * (width - padL - padR);
    const yOf = y => padT + (1 - (y - minY) / (maxY - minY)) * (height - padT - padB);
    const yZero = yOf(0);

    const ticks = [minY, minY + (maxY - minY) * 0.25, minY + (maxY - minY) * 0.5, minY + (maxY - minY) * 0.75, maxY];
    const grid = ticks.map(t => {
      const y = yOf(t);
      return `<g>
        <line x1="${padL}" x2="${width - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(148,163,184,0.22)" />
        <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#64748b" font-size="10.5">${esc(usd(t, 0))}</text>
      </g>`;
    }).join('');

    const paths = nonEmpty.map(s => {
      const d = s.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${xOf(idx).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-dasharray="${s.dash || ''}" opacity="${s.opacity || 1}" />`;
    }).join('');

    const refPts = nonEmpty[0].points;
    const dateIdx = [0, Math.floor((refPts.length - 1) * 0.25), Math.floor((refPts.length - 1) * 0.5), Math.floor((refPts.length - 1) * 0.75), refPts.length - 1];
    const xLabels = dateIdx.map(i => {
      const pt = refPts[i];
      if (!pt) return '';
      return `<text x="${xOf(i).toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="#64748b" font-size="10.5">${esc(String(pt.x || '').slice(0, 7))}</text>`;
    }).join('');

    const legend = nonEmpty.map(s => `<span class="mc-legend-item"><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('');

    return `
      <div class="mc-chart-wrap">
        <div class="mc-legend">${legend}</div>
        <svg viewBox="0 0 ${width} ${height}" class="mc-svg" role="img">
          ${grid}
          <line x1="${padL}" x2="${width - padR}" y1="${yZero.toFixed(1)}" y2="${yZero.toFixed(1)}" stroke="rgba(100,116,139,0.45)" stroke-dasharray="3,3" />
          ${paths}
          ${xLabels}
        </svg>
      </div>
    `;
  }

  function renderHeaderAndKpis() {
    const d = state.data;
    const model = getModel();
    const spec = getVariantSpec();
    const sum = getSummaryForCost(model);
    const baseSum = getSummaryForCost(d.models.BASE);
    const tierSum = getSummaryForCost(d.models.TIER);
    if (!model || !sum) return '';

    const diffVsBase = sum.net - (baseSum?.net || 0);
    const mddVsTier = tierSum?.mdd ? ((tierSum.mdd - sum.mdd) / tierSum.mdd) : 0;
    const retToMdd = sum.mdd > 0 ? (sum.net / sum.mdd) : 0;
    const wr = sum.main_win_rate != null ? sum.main_win_rate : sum.win_rate;
    const winsCnt = Math.round((sum.closed || sum.trades || 0) * wr);
    const lossCnt = Math.max(0, (sum.closed || sum.trades || 0) - winsCnt);

    const annMap = Object.fromEntries((model.annual || []).map(a => [a.year, a.net]));
    const y2026 = annMap['2026'] || 0;

    const stepButtons = TOP_MODEL_ORDER.filter(k => d.models?.[k]).map(k => {
      const sp = getVariantSpec(k);
      const col = COLORS[k] || sp.color;
      const active = state.variant === k ? 'active' : '';
      return `<button type="button" class="btn ${active}" data-mc-variant="${k}" title="${esc(sp.name || k)}" style="${active ? `border-color:${col};box-shadow:0 0 0 1px ${col} inset;` : ''}">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:5px;"></span>${esc(sp.short_name || k)}
      </button>`;
    }).join('');

    const costButtons = [1, 2, 3].map(c => {
      const active = Number(state.costTicks) === c ? 'active' : '';
      return `<button type="button" class="btn ${active}" data-mc-cost="${c}">편도 ${c}틱</button>`;
    }).join('');

    return `
      <div class="panel mc-top-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">선물 · CTA 결합 모멘텀 연구 (3대 핵심 축 정리 화면)</div>
            <div class="panel-sub">
              기준일 <span class="mono">${esc(d.as_of)}</span> (${esc(d.start)} ~ ${esc(d.end)}) ·
              선택 모형: <strong style="color:${COLORS[state.variant] || spec.color}">${esc(spec.name)}</strong>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <div style="display:flex;flex-wrap:wrap;gap:5px;">${stepButtons}</div>
            <div style="display:flex;gap:4px;">${costButtons}</div>
            <button type="button" class="btn active" id="mc-jump-recipe1-ctrl" style="border-color:#ea580c;font-weight:700;">레시피1 × FX 레짐·DB 컨트롤러 열기</button>
            <a class="btn" href="/FITD_모멘텀_모니터_10대_모델_상세_해설_보고서.pdf" target="_blank" rel="noopener" style="text-decoration:none;font-weight:700;">10대 모델 해설 PDF</a>
          </div>
        </div>

        <div class="mc-axis-strip">
          <div>
            <div class="muted" style="font-size:11.5px;margin-bottom:3px;">축 ① · 진입 기술 (CTA 내부 파라미터)</div>
            <div style="font-size:13px;font-weight:700;color:var(--text);">${esc(spec.cta_param_label || '현행 기본 (55:45 · k=0.85 · W0)')}</div>
          </div>
          <div style="border-left:1px solid var(--line);padding-left:12px;">
            <div class="muted" style="font-size:11.5px;margin-bottom:3px;">축 ② · 진입·증액 타이밍 (돌파 일자)</div>
            <div style="font-size:13px;font-weight:700;color:var(--blue);">${esc(spec.entry_rule_label || '10일 1/3 → 20일 2/3 분할')}</div>
          </div>
          <div style="border-left:1px solid var(--line);padding-left:12px;">
            <div class="muted" style="font-size:11.5px;margin-bottom:3px;">축 ③ · 익절 & 시간제한 손절 (승률·PF·MDD 엔진)</div>
            <div style="font-size:13px;font-weight:700;color:var(--green);">${esc(spec.exit_rule_label || '+0.28R 확정익절 잠금 · 3일 타임스탑')}</div>
          </div>
        </div>

        <div class="mc-kpi-grid">
          <div class="mc-kpi">
            <div class="mc-kpi-label">총 누적 손익 (2022~2026 · 편도 ${state.costTicks}틱)</div>
            <div class="mc-kpi-value mono ${clsPnl(sum.net)}">${usd(sum.net)}</div>
            <div class="mc-kpi-sub">Gross ${usd(sum.gross)} · Cost -${usd(sum.cost).replace('+','')} · 기본형 대비 <strong class="${clsPnl(diffVsBase)}">${usd(diffVsBase)}</strong></div>
          </div>
          <div class="mc-kpi">
            <div class="mc-kpi-label">승률 (Win Rate) · 손익비 (PF)</div>
            <div class="mc-kpi-value mono pos">${pct(wr, 1)} <span class="muted" style="font-size:14px;font-weight:500;">/ PF ${num(sum.pf, 2)}</span></div>
            <div class="mc-kpi-sub">총 <strong>${int(sum.trades)}건</strong> (${winsCnt}승 ${lossCnt}패) · 빠른 익절 잠금 & 미발화 조기 컷</div>
          </div>
          <div class="mc-kpi">
            <div class="mc-kpi-label">최대 낙폭 (MDD) · 리스크 효율</div>
            <div class="mc-kpi-value mono neg">-${usd(sum.mdd).replace('+','').replace('-','')}</div>
            <div class="mc-kpi-sub">수익/MDD <strong>${num(retToMdd, 2)}배</strong> · 기존 CTA 대비 낙폭 <strong>${pct(mddVsTier, 0)} 축소</strong></div>
          </div>
          <div class="mc-kpi">
            <div class="mc-kpi-label">2023년 이후 누적 & 박스권 성과</div>
            <div class="mc-kpi-value mono ${clsPnl(sum.net2023on)}">${usd(sum.net2023on)}</div>
            <div class="mc-kpi-sub">23~25년 박스권 <strong class="${clsPnl(sum.net23_25)}">${usd(sum.net23_25)}</strong> · 2026 YTD <strong class="${clsPnl(y2026)}">${usd(y2026)}</strong></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderThreeAxesWorkbench() {
    const axes = state.data?.optimization_axes;
    if (!axes) return '';

    const axisKeys = ['axis1_cta_params', 'axis2_entry_timing', 'axis3_exit_management'];
    const axisIcons = {
      axis1_cta_params: '축 ① · 진입 기술 (CTA 파라미터 변수)',
      axis2_entry_timing: '축 ② · 진입·증액 일자 (선발대 → 본대)',
      axis3_exit_management: '축 ③ · 익절 & 시간제한 손절 (승률·PF·MDD)',
    };
    const axisColors = {
      axis1_cta_params: '#9333ea',
      axis2_entry_timing: '#0284c7',
      axis3_exit_management: '#059669',
    };

    const summaryCards = axisKeys.map(ak => {
      const ax = axes[ak];
      if (!ax) return '';
      const isAct = state.activeAxis === ak;
      const col = axisColors[ak];
      return `
        <div class="mc-axis-card ${isAct ? 'active' : ''}" data-mc-axis="${ak}" style="${isAct ? `border-color:${col};box-shadow:0 0 0 1px ${col} inset;` : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <span class="badge" style="background:${col}18;color:${col};border:1px solid ${col}44;">${esc(axisIcons[ak])}</span>
            <span style="font-size:11.5px;color:${isAct ? col : 'var(--muted)'};font-weight:700;">${isAct ? '▼ 상세 열림' : '클릭하여 비교 ▶'}</span>
          </div>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin:4px 0 3px 0;">${esc(ax.title)}</div>
          <div class="muted" style="font-size:12px;line-height:1.45;">${esc(ax.subtitle)}</div>
        </div>
      `;
    }).join('');

    const curAxis = axes[state.activeAxis] || axes.axis3_exit_management;
    const curCol = axisColors[state.activeAxis] || '#059669';

    const varHeaders = state.activeAxis === 'axis1_cta_params'
      ? ['조정 파라미터 변수', '현행 기본값 (W0)', '방어·고승률 최적 (레시피 2)', '누적수익 극대화 (레시피 1)']
      : state.activeAxis === 'axis2_entry_timing'
      ? ['진입·증액 타이밍 변수', '기존 모형 (20일 단일)', '★ 최적 2단 분할 (10일→20일)', '대안 · 대조군 비교']
      : ['청산·리스크 관리 변수', '기본 청산 (0단계)', '빠른 3박자 (거래수 67건 유지)', '하이브리드 스나이퍼 (초고승률)'];

    const varRows = (curAxis.variables || []).map(v => {
      const c2 = v.recipe2 || v.optimal || v.fast3 || '';
      const c3 = v.recipe1 || v.alt || v.sniper || '';
      return `
        <tr>
          <td style="font-weight:700;color:var(--text);">${esc(v.name)}</td>
          <td class="muted">${esc(v.base)}</td>
          <td style="color:${curCol};font-weight:700;">${esc(c2)}</td>
          <td style="color:var(--text-secondary);">${esc(c3)}</td>
        </tr>
      `;
    }).join('');

    const compRows = (curAxis.rows || []).map(r => {
      const isSelectedModel = state.variant === r.model_key;
      return `
        <tr class="${isSelectedModel ? 'row-selected' : ''}" data-mc-variant="${esc(r.model_key)}" style="cursor:pointer;">
          <td>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLORS[r.model_key] || curCol};"></span>
              <strong>${esc(r.label)}</strong>
              <span class="badge badge-flat">${esc(r.tag)}</span>
            </div>
          </td>
          <td class="num mono ${clsPnl(r.total_net)}"><strong>${usd(r.total_net)}</strong></td>
          <td class="num mono ${clsPnl(r.net2023on)}">${usd(r.net2023on)}</td>
          <td class="num mono pos"><strong>${num(r.wr, 1)}%</strong></td>
          <td class="num mono"><strong>${num(r.pf, 2)}</strong></td>
          <td class="num mono neg">-$${int(r.mdd)}</td>
          <td class="num mono">${int(r.trades)}건</td>
          <td class="muted" style="font-size:12px;">${esc(r.note)}</td>
          <td class="num">
            <button type="button" class="btn ${isSelectedModel ? 'active' : ''}" data-mc-variant="${esc(r.model_key)}" style="padding:4px 9px;font-size:11.5px;">
              ${isSelectedModel ? '✓ 적용중' : '모형 적용'}
            </button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">1. 모멘텀 전략 3대 핵심 개선 축 (진입 기술 × 진입·증액 일자 × 익절·시간제한 손절)</div>
            <div class="panel-sub">아래 3개 축 카드를 클릭해 변수별 구조와 백테스트 성과를 비교하고, 표의 행을 클릭해 대시보드 전체에 즉시 적용할 수 있습니다.</div>
          </div>
        </div>

        <div class="mc-axis-cards">
          ${summaryCards}
        </div>

        <div class="mc-axis-detail">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
            <div>
              <span class="badge" style="background:${curCol}18;color:${curCol};border:1px solid ${curCol}44;margin-right:6px;">${esc(curAxis.badge)}</span>
              <strong style="font-size:14.5px;color:var(--text);">${esc(curAxis.title)}</strong>
            </div>
          </div>
          <div class="mc-insight-box" style="border-left:4px solid ${curCol};">
            <strong>핵심 검증 결론:</strong> ${esc(curAxis.key_insight)}
          </div>

          <div style="display:grid;grid-template-columns:1fr;gap:12px;">
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th style="width:24%;">${esc(varHeaders[0])}</th>
                    <th style="width:22%;">${esc(varHeaders[1])}</th>
                    <th style="width:27%;">${esc(varHeaders[2])}</th>
                    <th style="width:27%;">${esc(varHeaders[3])}</th>
                  </tr>
                </thead>
                <tbody>${varRows}</tbody>
              </table>
            </div>

            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>비교 전략 모형 (클릭 시 차트·원장 전환)</th>
                    <th class="num">총 누적손익</th>
                    <th class="num">2023년 이후</th>
                    <th class="num">승률</th>
                    <th class="num">PF(손익비)</th>
                    <th class="num">최대낙폭(MDD)</th>
                    <th class="num">거래수</th>
                    <th>핵심 차이점 요약</th>
                    <th class="num">선택</th>
                  </tr>
                </thead>
                <tbody>${compRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function resolveAssetSlotAndPos(model, assetId, country) {
    const curList = model?.current || [];
    const slotByAsset = curList.find(c => (c.id || c.position?.id || c.selected_id) === assetId);
    const slotByCountry = curList.find(c => c.country === country);
    const openTrade = (model?.trades || []).find(t => t.status === 'OPEN' && t.id === assetId);
    const rawPos = slotByAsset?.position || (openTrade ? openTrade : null);
    const pos = rawPos
      ? {
          ...rawPos,
          ...(openTrade || {}),
          contracts: openTrade?.contracts ?? rawPos.contracts,
          initial_contracts: openTrade?.initial_contracts ?? rawPos.initial_contracts,
          peak_contracts: openTrade?.peak_contracts ?? rawPos.peak_contracts,
          net: rawPos.net ?? openTrade?.net,
          unit_r_multiple: rawPos.unit_r_multiple ?? openTrade?.unit_r_multiple,
          r_multiple: rawPos.r_multiple ?? openTrade?.r_multiple,
        }
      : null;
    const countryHeldId = slotByCountry?.position?.id || (model?.trades || []).find(t => t.status === 'OPEN' && t.country === country)?.id || null;
    return { slot: slotByAsset || slotByCountry || {}, pos, countryHeldId };
  }

  function formatCtaBandLabel(b) {
    if (b?.band && typeof b.band === 'string' && Number.isNaN(Number(b.band))) {
      return b.band;
    }
    const a = Math.abs(Number(b?.ms || 0));
    if (a >= 0.75) return '3차 최대 배분 (3/3)';
    if (a >= 0.50) return '2차 표준 배분 (2/3)';
    if (a >= 0.25) return '1차 초기 진입 (1/3)';
    return '중립 대기 (<0.25)';
  }

  function renderCurrentMonitor() {
    const d = state.data;
    const model = getModel();
    const spec = getVariantSpec();

    const rowsHtml = (d.rows || []).map(r => {
      const b = r.bar || {};
      const { slot, pos, countryHeldId } = resolveAssetSlotAndPos(model, r.id, r.country);
      const selected = r.id === state.selectedId ? 'row-selected' : '';

      const p3 = r.plan_method3 || r.plan_elastic || r.plan_tier || {};
      const b10Dir = b.breakout10_dir || 0;
      const b20Dir = b.breakout20_dir || 0;

      const b10Text = b10Dir !== 0 ? `${b10Dir > 0 ? '▲10D 돌파' : '▼10D 돌파'}` : `10D 대기 (${num(b.low10, 2)}~${num(b.high10, 2)})`;
      const b20Text = b20Dir !== 0 ? `${b20Dir > 0 ? '▲20D 돌파' : '▼20D 돌파'}` : `20D 대기 (${num(b.low20, 2)}~${num(b.high20, 2)})`;

      const initC = pos?.initial_contracts || pos?.contracts;
      const curC = pos?.contracts;
      const scaleTag = pos && initC && curC && initC !== curC ? `${int(initC)}→${int(curC)}계약` : `${int(curC)}계약`;

      const posHtml = pos
        ? `<div>${dirBadge(pos.direction, pos.direction > 0 ? 'LONG' : 'SHORT')} <strong class="mono">${scaleTag}</strong></div>
           <div class="mono ${clsPnl(pos.net)}" style="font-size:12px;">${usd(pos.net)} (${rFmt(pos.unit_r_multiple != null ? pos.unit_r_multiple : pos.r_multiple)}) · 진입 ${esc(pos.entry_date || '')}</div>`
        : `<span class="muted">미보유 (대기)</span>`;

      const statusBadgeHtml = pos
        ? `<span class="badge ${pos.direction > 0 ? 'badge-long' : 'badge-short'}">보유 중 (OPEN)</span>`
        : countryHeldId && countryHeldId !== r.id
        ? `<span class="badge badge-flat">${esc(r.country)} 슬롯(${esc(countryHeldId)} 보유)</span>`
        : `<span class="badge badge-flat">${esc(slot.action || 'WAIT')}</span>`;

      return `
        <tr class="mc-row ${selected}" data-mc-asset="${esc(r.id)}" style="cursor:pointer;">
          <td>
            <div><strong>${esc(r.id)}</strong> <span class="muted">${esc(r.label)}</span></div>
            <div class="muted mono" style="font-size:11.5px;">${esc(r.country)} · ${esc(r.contract)} · $${int(r.point_value)}/pt</div>
          </td>
          <td class="num mono">
            <div><strong>${num(r.price, 3)}</strong></div>
            <div class="muted" style="font-size:11.5px;">MA20 ${num(b.ma20, 2)} / MA60 ${num(b.ma60, 2)}</div>
          </td>
          <td>
            <div class="mono" style="font-size:12px;color:${b10Dir !== 0 ? 'var(--blue)' : 'var(--muted)'};"><strong>1차(10D):</strong> ${esc(b10Text)}</div>
            <div class="mono" style="font-size:12px;color:${b20Dir !== 0 ? 'var(--green)' : 'var(--muted)'};"><strong>2차(20D):</strong> ${esc(b20Text)}</div>
          </td>
          <td class="num mono">
            <div><strong>MS ${num(b.ms, 3)}</strong> <span class="badge badge-flat">${esc(formatCtaBandLabel(b))}</span></div>
            <div class="muted" style="font-size:11.5px;">6주기 동의: <strong>${int(b.agreement)}/6</strong> · 커브 ${num(b.curve_slope, 2)}%p</div>
          </td>
          <td class="num mono">
            <div>1차 1/3: <strong>${int(Math.max(1, Math.floor((p3.full_contracts || 30) / 3)))}계약</strong> ($11,667)</div>
            <div class="muted" style="font-size:11.5px;">2차 2/3: ${int(Math.max(2, Math.floor(((p3.full_contracts || 30) * 2) / 3)))}계약 · 3차 3/3: ${int(p3.full_contracts || 30)}계약</div>
          </td>
          <td>${posHtml}</td>
          <td>${statusBadgeHtml}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">2. 실시간 5개 국채선물(TU · FV · TY · DU · RX) 신호 모니터 & 종목별 3박자 실행 계획</div>
            <div class="panel-sub">종목 행을 클릭하면 하단 카드에 선택 모형(${esc(spec.short_name)}) 기준의 [진입·증액 라인 / 빠른 익절 라인 / 시간제한·하드 손절 라인]이 표시됩니다.</div>
          </div>
        </div>
        <div class="table-wrap" style="margin-bottom:12px;">
          <table class="tbl">
            <thead>
              <tr>
                <th>종목 / 만기</th>
                <th class="num">시그널 종가 / 이평선</th>
                <th>축 ② · 10일(1차) / 20일(2차) 돌파</th>
                <th class="num">축 ① · CTA 신호 / 6주기 동의</th>
                <th class="num">단계별 예산 · 정수 계약</th>
                <th>현재 보유 포지션</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div id="mc-plan">${renderSelectedPlan()}</div>
      </div>
    `;
  }

  function renderSelectedPlan() {
    const d = state.data;
    const model = getModel();
    const r = (d?.rows || []).find(x => x.id === state.selectedId) || d?.rows?.[0];
    if (!r) return '';

    const b = r.bar || {};
    const { pos } = resolveAssetSlotAndPos(model, r.id, r.country);
    const p3 = r.plan_method3 || r.plan_elastic || r.plan_tier || r.plan_base || {};
    const fullCnt = p3.full_contracts || p3.contracts || 30;
    const scoutCnt = Math.max(1, Math.floor(fullCnt / 3));
    const mainCnt = Math.max(2, Math.floor((fullCnt * 2) / 3));

    const isFastOrSniper = state.variant === 'FAST_3BEAT' || state.variant === 'SNIPER_S3';
    const isSniper = state.variant === 'SNIPER_S3';

    return `
      <div class="mc-plan-box">
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--blue);margin-bottom:6px;">
            [1] 진입 · 증액 기준 (${esc(r.id)} ${esc(r.contract)})
          </div>
          <div style="font-size:12.5px;line-height:1.65;color:var(--text);">
            <div>• <strong>10일 돌파선 (1차 1/3 진입):</strong> 상단 <span class="mono">${num(b.high10, 3)}</span> / 하단 <span class="mono">${num(b.low10, 3)}</span> → <strong>${int(scoutCnt)}계약</strong> ($11,667)</div>
            <div>• <strong>20일 돌파선 (2차 2/3 증액):</strong> 상단 <span class="mono">${num(b.high20, 3)}</span> / 하단 <span class="mono">${num(b.low20, 3)}</span> → <strong>${int(mainCnt)}계약</strong> ($23,333)</div>
            <div>• <strong>CTA 필터 상태:</strong> |MS| <span class="mono">${num(Math.abs(b.ms || 0), 3)}</span> · 동의 <span class="mono">${int(b.agreement)}/6</span> ${isSniper ? '(스나이퍼 기준: S0≥0.35 & 4/6 동의 필수)' : '(기준: S0≥0.25)'}</div>
          </div>
        </div>

        <div style="border-left:1px solid var(--line);padding-left:14px;">
          <div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:6px;">
            [2] 수익 보전 & 부분익절 기준 (축 ③)
          </div>
          <div style="font-size:12.5px;line-height:1.65;color:var(--text);">
            <div>• <strong>조기 확정익절 잠금:</strong> ${isFastOrSniper ? '평가익 <strong>+0.28R (+$9,800)</strong> 도달 시 스탑라인을 <strong>+0.14R (+$4,900 확정수익)</strong>로 상향' : '1단계 기준 +0.90R 부분익절 시 손익분기(BE) 스탑 활성화'}</div>
            <div>• <strong>50% 부분익절 (Partial TP):</strong> ${isFastOrSniper ? '<strong>+0.80R (+$28,000)</strong> 도달 시 보유 물량 50% 부분익절' : '<strong>+0.90R (+$31,500)</strong> 도달 시 50% 부분익절'}</div>
            <div>• <strong>장기 추세 트레일링:</strong> HWM ≥ +1.30R 도달 시 최고 수익의 <strong>58%</strong> 보전 스탑 가동</div>
          </div>
        </div>

        <div style="border-left:1px solid var(--line);padding-left:14px;">
          <div style="font-size:13px;font-weight:700;color:var(--orange);margin-bottom:6px;">
            [3] 타임스탑 & 변동성 스탑 / 현재 포지션
          </div>
          <div style="font-size:12.5px;line-height:1.65;color:var(--text);">
            <div>• <strong>모멘텀 지연 타임스탑:</strong> 진입 후 <strong>${isFastOrSniper ? '3거래일' : '5거래일'}</strong> 경과 시 HWM &lt; +0.16R 및 평가손실 상태면 청산</div>
            <div>• <strong>2.5×SD20 변동성 스탑:</strong> 거리 <span class="mono">${num(p3.distance, 4)}pt (${int(p3.stop_ticks)}틱)</span> · 1계약 위험 <span class="mono">$${num((p3.planned_loss || 35000) / Math.max(1, p3.contracts || 30), 0)}</span></div>
            <div>• <strong>현재 보유 상태:</strong> ${pos ? `${pos.direction > 0 ? 'LONG' : 'SHORT'} ${int(pos.contracts)}계약 (진입 ${pos.entry_date} · 평가손익 ${usd(pos.net)} · HWM ${rFmt(pos.unit_hwm_r != null ? pos.unit_hwm_r : pos.hwm_r)})` : '현재 보유 포지션 없음 (신규 신호 대기)'}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderChartAndComparisonTable() {
    const d = state.data;
    const keysToShow = [...CORE_VARIANTS];
    if (!keysToShow.includes(state.variant) && d.models[state.variant]) {
      keysToShow.push(state.variant);
    }

    const chartSeries = keysToShow.map(k => {
      const m = d.models[k];
      if (!m) return null;
      const sp = getVariantSpec(k);
      const pts = seriesFromDaily(m, state.costTicks).map(p => ({ x: p.date, y: p.cum }));
      const isSelected = k === state.variant;
      return {
        label: sp.short_name || k,
        color: COLORS[k] || sp.color || '#94a3b8',
        width: isSelected ? 3.2 : (k === 'FAST_3BEAT' || k === 'SNIPER_S3' ? 2.2 : 1.5),
        dash: k === 'BASE' ? '4,3' : '',
        opacity: isSelected ? 1.0 : 0.72,
        points: pts,
      };
    }).filter(Boolean);

    const years = ['2022', '2023', '2024', '2025', '2026'];
    const tableRows = ALL_ORDER.map(k => {
      const m = d.models[k];
      if (!m) return '';
      const sp = getVariantSpec(k);
      const s = getSummaryForCost(m, state.costTicks);
      const annMap = Object.fromEntries((m.annual || []).map(a => [a.year, a]));
      const wr = s.main_win_rate != null ? s.main_win_rate : s.win_rate;
      const isSel = k === state.variant;
      const isCore = CORE_VARIANTS.includes(k);

      const yrCells = years.map(yr => {
        const a = annMap[yr];
        const netVal = a ? a.gross - a.cost * state.costTicks : 0;
        return `<td class="num mono ${clsPnl(netVal)}">${usd(netVal)}</td>`;
      }).join('');

      return `
        <tr class="${isSel ? 'row-selected' : ''}" data-mc-variant="${esc(k)}" style="cursor:pointer;${!isCore ? 'opacity:0.88;' : ''}">
          <td>
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLORS[k] || sp.color};margin-right:6px;"></span>
            <strong>${esc(sp.short_name || k)}</strong>
          </td>
          <td class="num mono ${clsPnl(s.net)}"><strong>${usd(s.net)}</strong></td>
          <td class="num mono ${clsPnl(s.net2023on)}"><strong>${usd(s.net2023on)}</strong></td>
          <td class="num mono pos"><strong>${pct(wr, 1)}</strong></td>
          <td class="num mono"><strong>${num(s.pf, 2)}</strong></td>
          <td class="num mono neg">-${usd(s.mdd).replace('+','').replace('-','')}</td>
          <td class="num mono">${int(s.trades)}건</td>
          ${yrCells}
        </tr>
      `;
    }).join('');

    return `
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">3. 단계별 누적 손익 곡선 & 연도별(2022~2026) 통합 성과 비교표</div>
            <div class="panel-sub">하단 표에서 전략을 클릭하면 해당 모형의 손익 곡선이 강조되고 상단 KPI 및 상세 원장이 즉시 갱신됩니다. (편도 ${state.costTicks}틱 기준)</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:14px;">
          ${svgLineChart(chartSeries, 275)}
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>전략 모형</th>
                  <th class="num">총 누적손익</th>
                  <th class="num">2023년 이후</th>
                  <th class="num">승률</th>
                  <th class="num">PF</th>
                  <th class="num">최대낙폭(MDD)</th>
                  <th class="num">거래수</th>
                  <th class="num">2022년</th>
                  <th class="num">2023년</th>
                  <th class="num">2024년</th>
                  <th class="num">2025년</th>
                  <th class="num">2026년</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function renderStrictVerificationPanel() {
    const sv = state.data?.strict_verification;
    if (!sv || !sv.r_basis_comparison) return '';
    const rbc = sv.r_basis_comparison;
    const cf = sv.sniper_counterfactual || {};
    const rules = sv.execution_rules_spec || {};

    const modelsToCompare = [
      { key: 'CTA_RECIPE2', label: '④ CTA 레시피2 (1단계 관리)', color: COLORS.CTA_RECIPE2 },
      { key: 'FAST_3BEAT', label: '⑤ 빠른 3박자 (기본형 후보 · 67건)', color: COLORS.FAST_3BEAT },
      { key: 'SNIPER_S3', label: '⑥ 하이브리드 스나이퍼 (방어형 후보 · 47건)', color: COLORS.SNIPER_S3 },
    ];

    const rRows = [];
    modelsToCompare.forEach(m => {
      const mObj = rbc[m.key] || {};
      const f35 = mObj.FIXED_35K || {};
      const act = mObj.PURE_ACTIVE_R || {};
      const hyb = mObj.HYBRID_TOTAL_CYCLE || {};
      rRows.push(`
        <tr>
          <td rowspan="2" style="vertical-align:middle;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${m.color};margin-right:6px;"></span>
            <strong>${esc(m.label)}</strong>
          </td>
          <td><span class="mc-badge mc-badge-ok">A · 전략 고정 R ($35k) & 하이브리드 총사이클 MTM</span></td>
          <td class="num mono pos"><strong>${usd(f35.total_net)}</strong></td>
          <td class="num mono pos"><strong>${usd(f35.net23_on)}</strong></td>
          <td class="num mono pos"><strong>${num(f35.win_rate, 1)}%</strong></td>
          <td class="num mono"><strong>${num(f35.pf, 2)}</strong></td>
          <td class="num mono neg"><strong>-${usd(f35.mtm_mdd).replace('+','').replace('-','')}</strong> <span class="muted">(종가실현 -${usd(f35.realized_only_mdd).replace('+','').replace('-','')})</span></td>
          <td class="num mono">${int(f35.trades)}건 <span class="muted">(롤오버 ${int(f35.rolls_traversed)}회)</span></td>
          <td class="num mono">${int(f35.same_dir_days)}일 <span class="muted">(최악일 ${usd(f35.worst_same_dir_day_loss)})</span></td>
        </tr>
        <tr style="background:rgba(148,163,184,0.05);">
          <td><span class="mc-badge mc-badge-neutral">B · 순수 초기 실투입 R ($11.7k 선발대 즉시 잠금)</span></td>
          <td class="num mono ${clsPnl(act.total_net)}">${usd(act.total_net)} <span class="muted">(${usd((act.total_net || 0) - (f35.total_net || 0))})</span></td>
          <td class="num mono ${clsPnl(act.net23_on)}">${usd(act.net23_on)}</td>
          <td class="num mono">${num(act.win_rate, 1)}%</td>
          <td class="num mono">${num(act.pf, 2)}</td>
          <td class="num mono neg">-${usd(act.mtm_mdd).replace('+','').replace('-','')} <span class="muted">(종가실현 -${usd(act.realized_only_mdd).replace('+','').replace('-','')})</span></td>
          <td class="num mono">${int(act.trades)}건</td>
          <td class="num mono">${int(act.same_dir_days)}일 <span class="muted">(최악일 ${usd(act.worst_same_dir_day_loss)})</span></td>
        </tr>
      `);
    });

    return `
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">3-B. 3대 핵심 모델 보수적 체결 엔진 & R-기준(Fixed $35k vs Active R) 정밀 재검증</div>
            <div class="panel-sub">연속선물(sig_px) 신호와 실제 근월물(contract OHLC) 체결 분리 · 일별 EURUSD(usd_fx) 환산 · 미결제 포함 일별 MTM MDD · 스나이퍼 필터 탈락 20건의 가상 손익(Counterfactual) 대조</div>
          </div>
          <div>
            <button type="button" class="btn active" data-mc-open-rejected="1" style="font-size:12px;padding:6px 12px;">
              하단 원장에서 탈락 신호 20건 가상 손익 바로 보기
            </button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-bottom:12px;">
          <div style="padding:10px 12px;border-radius:8px;background:rgba(16,185,129,0.07);border:1px solid rgba(16,185,129,0.22);">
            <div style="font-weight:700;font-size:12.5px;color:#059669;margin-bottom:4px;">① 목표 총량(Target Weight) & 동시돌파 체결 규약</div>
            <div style="font-size:12px;line-height:1.45;color:var(--text);">${esc(rules.target_weight_rule || '')} ${esc(rules.same_day_breakout_rule || '')}</div>
          </div>
          <div style="padding:10px 12px;border-radius:8px;background:rgba(2,132,199,0.07);border:1px solid rgba(2,132,199,0.22);">
            <div style="font-weight:700;font-size:12.5px;color:#0284c7;margin-bottom:4px;">② 1R 기준(고정 $35k vs 실투입 R) & 총사이클 HWM 판정</div>
            <div style="font-size:12px;line-height:1.45;color:var(--text);">${esc(rules.r_basis_rule || '')}</div>
          </div>
          <div style="padding:10px 12px;border-radius:8px;background:rgba(217,119,6,0.07);border:1px solid rgba(217,119,6,0.25);">
            <div style="font-weight:700;font-size:12.5px;color:#d97706;margin-bottom:4px;">③ 스나이퍼 필터(67건→47건) 탈락 20건 Counterfactual 판정</div>
            <div style="font-size:12px;line-height:1.45;color:var(--text);">
              탈락 <strong>${int(cf.filtered_count || 20)}건</strong> 중 <strong>회피한 손실 ${int(cf.avoided_loss_count || 12)}건(+${usd(cf.avoided_loss_usd || 102577).replace('+','')})</strong> vs <strong>놓친 추세 수익 ${int(cf.missed_gain_count || 8)}건(-${usd(cf.missed_gain_usd || 118374).replace('+','')})</strong>.
              전 기간 총수익은 <strong>⑤ 빠른 3박자(+${usd(733980).replace('+','')})</strong>가 +$40.9k 우위(기본형 확정), 2023년 이후 방어력·승률(68.1%)·MTM MDD(-$69.9k)는 <strong>⑥ 스나이퍼</strong>가 우위(방어형 확정).
            </div>
          </div>
        </div>

        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>검증 대상 모델</th>
                <th>R-분모 및 이익잠금 기준</th>
                <th class="num">총 누적손익</th>
                <th class="num">2023년 이후</th>
                <th class="num">승률</th>
                <th class="num">PF</th>
                <th class="num">일별 MTM MDD (종가실현 MDD)</th>
                <th class="num">거래수 (롤오버)</th>
                <th class="num">US·DE 동시 동방향 보유</th>
              </tr>
            </thead>
            <tbody>${rRows.join('')}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderCollapsibleDetails() {
    const model = getModel();
    const spec = getVariantSpec();
    if (!model) return '';

    const years = ['2022', '2023', '2024', '2025', '2026'];
    const assetRows = (model.asset_annual || []).map(a => {
      const byY = Object.fromEntries((a.annual || []).map(x => [x.year, x]));
      const cells = years.map(y => {
        const item = byY[y];
        const net = item ? item.gross - item.cost * state.costTicks : 0;
        return `<td class="num mono ${clsPnl(net)}">${usd(net)}</td>`;
      }).join('');
      const totNet = (a.summary?.gross || 0) - (a.summary?.cost || 0) * state.costTicks;
      return `
        <tr>
          <td><strong>${esc(a.id)}</strong> <span class="muted">${esc(a.label)} (${esc(a.country)})</span></td>
          ${cells}
          <td class="num mono ${clsPnl(totNet)}"><strong>${usd(totNet)}</strong></td>
          <td class="num mono">${num(a.summary?.pf, 2)}</td>
        </tr>
      `;
    }).join('');

    const allTrades = (model.trades || []).slice().reverse();
    const filteredTrades = allTrades.filter(t => {
      if (state.tradeAsset !== 'ALL' && t.id !== state.tradeAsset) return false;
      if (state.tradeYear !== 'ALL' && !String(t.entry_date || '').startsWith(state.tradeYear)) return false;
      return true;
    });

    const cfAll = state.data?.strict_verification?.sniper_counterfactual?.filtered_trades || model.rejected_trades || [];
    const filteredRejected = cfAll.slice().reverse().filter(t => {
      if (state.tradeAsset !== 'ALL' && t.id !== state.tradeAsset) return false;
      if (state.tradeYear !== 'ALL' && !String(t.entry_date || '').startsWith(state.tradeYear)) return false;
      return true;
    });

    const formatEventsSummary = (evs) => {
      if (!Array.isArray(evs) || !evs.length) return '—';
      return evs.map(ev => {
        const badgeColor = ev.type === 'ENTRY' ? '#0284c7'
          : (ev.type === 'ADD_20D_MAIN' || ev.type === 'ADD_FULL_3_3') ? '#7c3aed'
          : ev.type === 'PROFIT_LOCK_ARMED' ? '#059669'
          : ev.type === 'PARTIAL_TP_50' ? '#d97706'
          : ev.type === 'CONTRACT_ROLL' ? '#475569'
          : '#334155';
        return `<div style="font-size:11px;line-height:1.35;margin-bottom:2px;">
          <span class="mono" style="color:${badgeColor};font-weight:700;">[${esc(ev.date)}]</span>
          <span class="mono">${esc(ev.contract || '')}@${num(ev.raw_px, 3)}</span> · ${esc(ev.note || ev.type)}
        </div>`;
      }).join('');
    };

    const tradeRows = filteredTrades.map(t => {
      const isOpen = t.status === 'OPEN';
      const adjCost = isOpen ? Number(t.cost || 0) : Number(t.cost || 0) * state.costTicks;
      const adjNet = Number(t.gross || 0) - adjCost;
      const fixedR = adjNet / 35000.0;
      const peakB = Math.max(11667, Number(t.peak_budget || t.current_budget || t.budget || 35000));
      const activeR = adjNet / peakB;
      const contractStr = t.entry_contract && t.exit_contract && t.entry_contract !== t.exit_contract
        ? `${t.entry_contract}→${t.exit_contract} (롤오버)`
        : (t.entry_contract || `${t.id}1`);
      const pxFlow = [
        `진입 ${num(t.entry_price, 3)}`,
        t.add_price ? `증액 ${num(t.add_price, 3)}` : null,
        t.partial_tp_price ? `부분익절 ${num(t.partial_tp_price, 3)}` : null,
        isOpen ? `현재가 ${num(t.last_raw_close || t.exit_price, 3)}` : `청산 ${num(t.exit_price, 3)}`
      ].filter(Boolean).join(' → ');

      return `
        <tr>
          <td class="mono" style="white-space:nowrap;">${esc(t.entry_date)}<br><span class="muted">→ ${esc(t.exit_date || t.mark_date || 'OPEN')}</span></td>
          <td>
            <strong>${esc(t.id)}</strong> (${esc(t.country)})<br>
            <span class="mono muted" style="font-size:11px;">${esc(contractStr)}</span>
          </td>
          <td>${dirBadge(t.direction === 'LONG' || t.direction > 0 ? 1 : -1, t.direction === 'LONG' || t.direction > 0 ? 'LONG' : 'SHORT')}</td>
          <td class="mono" style="font-size:11.5px;line-height:1.4;">
            ${esc(pxFlow)}<br>
            <span class="muted">연속신호가: ${num(t.entry_sig_px, 2)} → ${num(t.exit_sig_px, 2)}</span>
          </td>
          <td style="min-width:270px;">${formatEventsSummary(t.events)}</td>
          <td class="num mono">
            ${int(t.initial_contracts || t.contracts)} → <strong>${int(t.peak_contracts || t.contracts)}계약</strong><br>
            <span class="muted" style="font-size:11px;">예산 $${int(t.budget || 11667)} → $${int(peakB)}</span>
          </td>
          <td class="num mono ${clsPnl(adjNet)}">
            <strong>${usd(adjNet)}</strong><br>
            <span style="font-size:11px;">고정R($35k): <strong>${rFmt(fixedR)}</strong></span><br>
            <span class="muted" style="font-size:11px;">실투입R($${Math.round(peakB/1000)}k): ${rFmt(activeR)}</span>
          </td>
          <td>${exitReasonBadge(t.exit_reason || t.status)}</td>
        </tr>
      `;
    }).join('');

    const rejectedRows = filteredRejected.map(t => {
      const netVal = Number(t.net || 0);
      const isAvoidedLoss = netVal <= 0;
      const badgeHtml = isAvoidedLoss
        ? `<span class="mc-badge mc-badge-ok">손실 회피 (+${usd(Math.abs(netVal)).replace('+','')})</span>`
        : `<span class="mc-badge mc-badge-warn">놓친 수익 (-${usd(netVal).replace('+','')})</span>`;
      return `
        <tr>
          <td class="mono">${esc(t.entry_date)} → ${esc(t.exit_date)} (${int(t.hold_days)}일)</td>
          <td><strong>${esc(t.id)}</strong> <span class="mono muted">${esc(t.entry_contract || '')}</span></td>
          <td>${dirBadge(t.direction === 'LONG' || t.direction > 0 ? 1 : -1, String(t.direction))}</td>
          <td class="mono" style="font-size:11.5px;">${num(t.entry_price, 3)} → ${num(t.exit_price, 3)}</td>
          <td style="font-size:12px;color:#b45309;font-weight:600;">${esc(t.reject_reason || '4/6 주기 동의 미달')}</td>
          <td class="num mono ${clsPnl(netVal)}">
            <strong>${usd(netVal)}</strong><br>
            <span class="muted" style="font-size:11px;">고정R: ${rFmt(t.fixed_r)} / 실투입R: ${rFmt(t.active_peak_r)}</span>
          </td>
          <td>${exitReasonBadge(t.exit_reason)}</td>
          <td>${badgeHtml}</td>
        </tr>
      `;
    }).join('');

    const yrFilterBtns = ['ALL', '2026', '2025', '2024', '2023', '2022'].map(y => {
      const act = state.tradeYear === y ? 'active' : '';
      return `<button type="button" class="btn ${act}" data-mc-tr-year="${y}" style="padding:3px 8px;font-size:11.5px;">${y === 'ALL' ? '전체 연도' : y + '년'}</button>`;
    }).join('');

    const assetFilterBtns = ['ALL', 'TU', 'FV', 'TY', 'DU', 'RX'].map(a => {
      const act = state.tradeAsset === a ? 'active' : '';
      return `<button type="button" class="btn ${act}" data-mc-tr-asset="${a}" style="padding:3px 8px;font-size:11.5px;">${a === 'ALL' ? '전체 종목' : a}</button>`;
    }).join('');

    const cfStats = state.data?.strict_verification?.sniper_counterfactual || {};

    return `
      <details class="panel" id="mc-details-ledger" ${state.detailsOpen ? 'open' : ''}>
        <summary style="cursor:pointer;font-weight:700;font-size:14.5px;padding:4px 0;color:var(--text);">
          4. [상세 체결·탈락 로그] 자산별 손익 & 거래별 진입·증액·청산 체결가·이중 R·탈락 신호 가상 손익 원장 (${esc(spec.short_name)} · 체결 ${int(allTrades.length)}건 / 필터탈락 ${int(cfAll.length)}건)
        </summary>
        <div style="margin-top:14px;display:grid;grid-template-columns:1fr;gap:16px;">
          <div>
            <div style="font-weight:700;font-size:13.5px;margin-bottom:6px;color:var(--text);">■ 자산별 × 연도별 순손익 분해</div>
            <div class="table-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>자산</th>
                    ${years.map(y => `<th class="num">${y}년</th>`).join('')}
                    <th class="num">합계</th>
                    <th class="num">PF</th>
                  </tr>
                </thead>
                <tbody>${assetRows}</tbody>
              </table>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button type="button" class="btn ${state.ledgerTab !== 'REJECTED' ? 'active' : ''}" data-mc-ledger-tab="EXECUTED" style="padding:6px 12px;font-size:12.5px;font-weight:700;">
                  체결 거래 라이프사이클 로그 (${int(filteredTrades.length)}건 / 전체 ${int(allTrades.length)}건)
                </button>
                <button type="button" class="btn ${state.ledgerTab === 'REJECTED' ? 'active' : ''}" data-mc-ledger-tab="REJECTED" style="padding:6px 12px;font-size:12.5px;font-weight:700;">
                  스나이퍼 필터 탈락 신호의 가상 손익 로그 (${int(filteredRejected.length)}건 / 전체 ${int(cfAll.length)}건)
                </button>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
                <div style="display:flex;gap:3px;">${yrFilterBtns}</div>
                <div style="display:flex;gap:3px;">${assetFilterBtns}</div>
              </div>
            </div>

            ${state.ledgerTab === 'REJECTED' ? `
              <div style="padding:10px 14px;margin-bottom:10px;border-radius:8px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.28);font-size:12.5px;line-height:1.5;">
                <strong>[필터 탈락 신호 Counterfactual 요약]</strong>
                <strong>⑤ 빠른 3박자(67건)</strong>에서는 진입했으나 <strong>⑥ 하이브리드 스나이퍼(47건)</strong>의 <code>CTA 레시피2 ≥ +0.35 & 4/6 주기 동의 & MA20/60 정배열</code> 필터에서 탈락한 <strong>${int(cfStats.filtered_count || 20)}건</strong>의 가상 손익입니다.
                손실 회피 <strong>${int(cfStats.avoided_loss_count || 12)}건(+${usd(cfStats.avoided_loss_usd || 102577).replace('+','')} 방어)</strong> vs 놓친 추세 수익 <strong>${int(cfStats.missed_gain_count || 8)}건(-${usd(cfStats.missed_gain_usd || 118374).replace('+','')} 기회비용)</strong>으로,
                다음 파라미터 변경 시 어느 거래가 살아나고 탈락하는지 즉시 대조할 수 있습니다.
              </div>
              <div class="table-wrap">
                <table class="tbl">
                  <thead>
                    <tr>
                      <th>신호일 → 가상청산일</th>
                      <th>종목 · 월물</th>
                      <th>방향</th>
                      <th>당시 체결가 (진입→청산)</th>
                      <th>필터 탈락 사유 (Rejection Reason)</th>
                      <th class="num">FAST_3BEAT 가상 순손익 (이중 R)</th>
                      <th>가상 청산사유</th>
                      <th>방어 기여 판정</th>
                    </tr>
                  </thead>
                  <tbody>${rejectedRows}</tbody>
                </table>
              </div>
            ` : `
              <div class="table-wrap">
                <table class="tbl">
                  <thead>
                    <tr>
                      <th>진입일 → 청산일</th>
                      <th>종목 · 체결월물</th>
                      <th>방향</th>
                      <th>실제 근월물 체결가 & 연속신호가</th>
                      <th>진입 · 증액 · 익절잠금 · 부분익절 · 청산 타임라인 로그</th>
                      <th class="num">계약 (초기→피크) · 위험예산</th>
                      <th class="num">순손익 (고정R $35k / 실투입R)</th>
                      <th>최종 청산사유</th>
                    </tr>
                  </thead>
                  <tbody>${tradeRows}</tbody>
                </table>
              </div>
            `}
          </div>
        </div>
      </details>
    `;
  }

  function renderAll(host) {
    if (!host) return;
    if (state.loading && !state.data) {
      host.innerHTML = `<div class="panel"><div class="empty">선물 · CTA 결합 연구 데이터를 불러오는 중입니다...</div></div>`;
      return;
    }
    if (state.error) {
      host.innerHTML = `<div class="panel"><div class="empty neg">데이터 로드 실패: ${esc(state.error)}</div></div>`;
      return;
    }
    if (!state.data) return;

    host.innerHTML = `
      <div class="mc-root">
        ${renderHeaderAndKpis()}
        ${renderThreeAxesWorkbench()}
        ${renderCurrentMonitor()}
        ${renderChartAndComparisonTable()}
        ${renderStrictVerificationPanel()}
        ${renderCollapsibleDetails()}
      </div>
    `;

    bindEvents(host);
  }

  function bindEvents(host) {
    host.querySelectorAll('[data-mc-variant]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const v = el.getAttribute('data-mc-variant');
        if (v && state.data?.models?.[v]) {
          state.variant = v;
          renderAll(host);
        }
      });
    });

    host.querySelectorAll('[data-mc-cost]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const c = Number(el.getAttribute('data-mc-cost'));
        if ([1, 2, 3].includes(c)) {
          state.costTicks = c;
          renderAll(host);
        }
      });
    });

    host.querySelectorAll('[data-mc-axis]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const ax = el.getAttribute('data-mc-axis');
        if (ax) {
          state.activeAxis = ax;
          renderAll(host);
        }
      });
    });

    host.querySelectorAll('[data-mc-asset]').forEach(el => {
      el.addEventListener('click', () => {
        const aid = el.getAttribute('data-mc-asset');
        if (aid) {
          state.selectedId = aid;
          host.querySelectorAll('[data-mc-asset]').forEach(r => r.classList.toggle('row-selected', r.getAttribute('data-mc-asset') === aid));
          const planEl = host.querySelector('#mc-plan');
          if (planEl) planEl.innerHTML = renderSelectedPlan();
        }
      });
    });

    const detEl = host.querySelector('#mc-details-ledger');
    if (detEl) {
      detEl.addEventListener('toggle', () => {
        state.detailsOpen = detEl.open;
      });
    }

    host.querySelectorAll('[data-mc-tr-year]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        state.tradeYear = el.getAttribute('data-mc-tr-year') || 'ALL';
        state.detailsOpen = true;
        renderAll(host);
      });
    });

    host.querySelectorAll('[data-mc-tr-asset]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        state.tradeAsset = el.getAttribute('data-mc-tr-asset') || 'ALL';
        state.detailsOpen = true;
        renderAll(host);
      });
    });

    host.querySelectorAll('[data-mc-ledger-tab]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        state.ledgerTab = el.getAttribute('data-mc-ledger-tab') || 'EXECUTED';
        state.detailsOpen = true;
        renderAll(host);
      });
    });

    host.querySelectorAll('[data-mc-open-rejected]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        state.ledgerTab = 'REJECTED';
        state.detailsOpen = true;
        renderAll(host);
        const det = host.querySelector('#mc-details-ledger');
        if (det) det.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    const jumpBtn = host.querySelector('#mc-jump-recipe1-ctrl');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        const navBtn = document.querySelector('[data-momentum-view="RECIPE1"]');
        if (navBtn) navBtn.click();
      });
    }
  }

  async function ensureLoaded(host, force = false) {
    const curMode = externalCtx?.getState?.()?.data_mode || document.documentElement.getAttribute('data-live-mode') || window.FITD_DATA_MODE || 'live';
    if (state.data && state.loadedMode === curMode && !force) {
      renderAll(host);
      return;
    }
    state.loading = true;
    state.error = null;
    renderAll(host);
    try {
      const modeParam = curMode ? `mode=${encodeURIComponent(curMode)}&` : '';
      const res = await fetch(`/api/momentum-cta?${modeParam}t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
      state.loadedMode = curMode;
      if (!state.data?.models?.[state.variant]) {
        state.variant = state.data?.recommended_variant || 'FAST_3BEAT';
      }
      state.loading = false;
      renderAll(host);
    } catch (err) {
      state.loading = false;
      state.error = err.message || String(err);
      renderAll(host);
    }
  }

  window.FITDMomentumCTA = {
    render(selectorOrEl, force = false) {
      const host = typeof selectorOrEl === 'string' ? document.querySelector(selectorOrEl) : selectorOrEl;
      if (!host) return;
      ensureLoaded(host, force);
    },
    reload() {
      const host = document.querySelector('#momentum-content') || document.querySelector('#momentum-cta-host');
      if (host) ensureLoaded(host, true);
    },
  };
})();
