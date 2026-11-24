import { configureMomentumCta, renderMomentumCta } from './momentum-cta.js?v=16';
import { renderMomentumSynergy } from './momentum-synergy.js?v=16';
import { configureMomentumRecipe1Control, renderMomentumRecipe1Control } from './momentum-recipe1-control.js?v=16';
import { renderMomentumFxV2Monthly } from './momentum-fx-v2-monthly.js?v=16';
import { renderMomentumV35 } from './momentum-v35.js?v=17';
import { renderMomentumRadarV3 } from './momentum-radar-v3.js?v=17';
import { renderMomentumActive4e } from './momentum-active-4e.js?v=19';
import { openHoldingDialog } from './holdings.js?v=16';
import {
  renderRangeControls,
  bindRangeControls,
  filterSeriesByRange,
  getRangeState,
  getChartTheme,
  enhanceInteractiveCharts
} from './chart-utils.js?v=16';

let ctx, model = 'B', selected = 'US5', sleeve = 'DIRECTIONAL', year = 'ALL';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const money = (v) => {
  if (v == null) return '—';
  if (Math.abs(v) < 0.5) v = 0;
  return (v < 0 ? '−$' : v > 0 ? '+$' : '$') + n(Math.abs(v), 0);
};

const labels = {
  WAIT: '대기',
  ENTRY_SIGNAL: '다음 거래일 진입',
  HOLD: '모의 보유',
  EXIT_SIGNAL: '다음 거래일 청산',
  STOP_SIGNAL: '다음 종가 손절',
  STOPPED: '손절 완료',
  EXITED: '청산 완료',
  GROUP_BLOCK: '같은 군 보유·선택',
  NO_DATA: 'KIS 수록 대기',
  AWAITING_MARK: '가격 대기'
};

export function configureMomentum(c) {
  ctx = c;
  configureMomentumCta(c);
  configureMomentumRecipe1Control(c);
}

const level = (r, q) => (q == null ? '—' : r.class === 'Rates' ? n(-q / 100, 3) + '%' : n(q, 2) + ' bp');

function tag(r) {
  return `<span class="tag ${r.phase === 'ENTRY_SIGNAL' && r.fresh ? 'primary' : r.phase === 'HOLD' ? 'shadow' : !r.fresh ? 'block' : ''}">${
    r.phase === 'NO_DATA' ? labels.NO_DATA : !r.fresh ? '최신 관측 대기' : labels[r.phase] || r.phase
  }</span>`;
}

function side(r) {
  const d = r.direction || r.suggested_direction;
  return !d ? '—' : r.class === 'Curve' ? (d > 0 ? '스티프너' : '플래트너') : d > 0 ? '채권 LONG' : '채권 SHORT';
}

const av = (block, y) => block?.annual.find((x) => x.year === y)?.pnl_usd ?? 0;

function csv(name, rows) {
  const text =
    '\ufeff' +
    rows
      .map((row) => row.map((v) => '"' + String(v ?? 'NO_DATA').replaceAll('"', '""') + '"').join(','))
      .join('\r\n');
  const u = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  URL.revokeObjectURL(u);
}

function chart(block, ref) {
  const ct = getChartTheme();
  const st = getRangeState('mom-legacy', 'ALL', true);
  const rawMain = filterSeriesByRange(block.equity || [], 'mom-legacy', (v) => v.date, 'ALL');
  const rawRef = ref?.equity ? filterSeriesByRange(ref.equity, 'mom-legacy', (v) => v.date, 'ALL') : null;

  if (!rawMain.length) {
    return '<div class="empty">선택한 기간에 해당하는 손익 데이터가 없습니다.</div>';
  }

  const baseMain = st.rebase ? rawMain[0]?.usd || 0 : 0;
  const baseRef = st.rebase && rawRef?.length ? rawRef[0]?.usd || 0 : 0;

  const mainEq = rawMain.map((v) => ({ date: v.date, usd: v.usd - baseMain }));
  const refEq = rawRef ? rawRef.map((v) => ({ date: v.date, usd: v.usd - baseRef })) : null;

  const values = [...mainEq, ...(refEq || [])].map((v) => v.usd);
  const lo = Math.min(0, ...values);
  const hi = Math.max(1, ...values);
  const w = 1000, h = 275, p = 74;
  const y = (v) => 18 + ((hi - v) / (hi - lo || 1)) * (h - 60);
  const x = (i, len) => p + (i * (w - p - 30)) / Math.max(1, len - 1);
  const path = (vs) => vs.map((v, i) => (i ? 'L' : 'M') + x(i, vs.length).toFixed(1) + ',' + y(v.usd).toFixed(1)).join('');

  const step = Math.max(1, Math.floor(mainEq.length / 80));
  const hoverRects = mainEq
    .filter((_, i) => i % step === 0 || i === mainEq.length - 1)
    .map((v) => {
      const idx = mainEq.indexOf(v);
      const rVal = refEq?.[idx]?.usd;
      return `<circle cx="${x(idx, mainEq.length).toFixed(1)}" cy="${y(v.usd).toFixed(1)}" r="5" fill="transparent">
        <title>${v.date}\n주황(선택 모형): ${money(v.usd)}${rVal != null ? `\n파랑(독립 참고): ${money(rVal)}` : ''}</title>
      </circle>`;
    })
    .join('');

  return `<svg class="momentum-equity" viewBox="0 0 ${w} ${h}" role="img" aria-label="달러 누적 손익">
    ${[lo, (lo + hi) / 2, 0, hi]
      .filter((v, i, a) => a.findIndex((z) => Math.abs(z - v) < (hi - lo) * 0.08) === i)
      .map(
        (v) => `<line x1="${p}" x2="${w - 30}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? ct.zero : ct.grid}" stroke-dasharray="${v === 0 ? 'none' : '3 3'}"/>
        <text x="4" y="${y(v) + 4}" fill="${ct.axis}" font-size="12">${n(v / 1000, 0)}k</text>`
      )
      .join('')}
    ${refEq ? `<path d="${path(refEq)}" fill="none" stroke="${ct.blue}" stroke-width="1.7" stroke-dasharray="5 3"/>` : ''}
    <path d="${path(mainEq)}" fill="none" stroke="${ct.amber}" stroke-width="2.5"/>
    ${hoverRects}
    ${mainEq
      .filter((v, i) => i === 0 || v.date.slice(0, 4) !== mainEq[i - 1].date.slice(0, 4) || i === mainEq.length - 1)
      .map(
        (v) => `<text x="${x(mainEq.indexOf(v), mainEq.length)}" y="${h - 8}" text-anchor="${v === mainEq.at(-1) ? 'end' : 'start'}" fill="${ct.axis}" font-size="12">${v.date}</text>`
      )
      .join('')}
  </svg>`;
}

function renderLegacyMomentum(target) {
  const state = ctx.getState(), p = state.momentum_research;
  if (!p?.config?.budget_usd) {
    target.innerHTML = '<div class="empty">달러 손절 예산·국가별 선택 모델 계산을 기다리고 있습니다.</div>';
    return;
  }
  const bt = p.models[model],
    block = sleeve === 'CURVE' ? bt.curve_experiment : bt,
    rows = p.current.filter((r) => r.model === model && (r.class === 'Curve') === (sleeve === 'CURVE')),
    sum = block.summary,
    budget = p.config.budget_usd;
  selected = rows.some((r) => r.id === selected) ? selected : rows[0]?.id;
  const years = bt.annual.map((r) => r.year),
    ys = years.filter((y) => year === 'ALL' || year === y),
    assets = sleeve === 'CURVE' ? bt.curve_experiment.assets : bt.assets;
  const stat = (l, v, h, c = '') => `<div class="stat"><div class="label">${l}</div><div class="num ${c}">${v}</div><div class="help">${h}</div></div>`;

  const rangeCtrl = renderRangeControls('mom-legacy', {
    presets: [
      ['3M', '3M'],
      ['6M', '6M'],
      ['YTD', 'YTD'],
      ['1Y', '1Y'],
      ['2Y', '2Y'],
      ['2023~', '2023년~'],
      ['ALL', '전체']
    ],
    defaultPreset: 'ALL',
    showRebase: true,
    label: '성과 조회 기간'
  });

  target.innerHTML = `<div class="research-banner">USD 손익 · ${esc(p.universe_label)} · ${p.start} ~ ${p.end} · A/B는 독립 비교 모형입니다.</div>
  ${p.partial ? `<div class="notice">부분 백테스트 ${p.available_base_instruments.length}/${p.base_instruments}개 · ${esc(p.missing_assets.join(', '))} KIS 미수록. 다른 만기로 대체하지 않습니다.</div>` : ''}
  <div class="momentum-warning"><b>계획 손절 예산 ${money(budget)}</b> · 기본 왕복 비용을 포함해 DV01을 역산합니다. 갭 손실은 한도를 넘을 수 있으며 초과 손실을 잘라 표시하지 않습니다. ${sleeve === 'CURVE' ? '커브는 종가 표본이라 장중 손절을 검증할 수 없습니다.' : ''}</div>
  <div class="stats">
    ${stat(sleeve === 'CURVE' ? '커브 별도 누적 손익' : '국가별 선택 누적 손익', money(sum.total_usd), '비용 차감 · 미청산 평가 포함', 'orange')}
    ${stat('최대 낙폭', money(sum.max_drawdown_usd), '일별 평가손익 기준', 'red')}
    ${stat('포지션 손절 예산', money(budget), sleeve === 'CURVE' ? '커브 페어 전체' : 'US 1개 + DE 1개 · $70,000 계획 위험')}
    ${stat('손실 예산 초과', sum.stop_budget_breaches + '<small>건</small>', '최대 개별 손실 ' + money(sum.worst_trade_usd), 'red')}
  </div>
  <div class="panel">
    <div class="panel-head">
      <h2>모멘텀 · 국가별 만기 선택</h2>
      <div class="segmented">${['A', 'B'].map((v) => `<button data-mom-model="${v}" class="${model === v ? 'on' : ''}">${v === 'A' ? 'A · 돌파' : 'B · 돌파 + MA'}</button>`).join('')}</div>
    </div>
    <div class="filters">
      <div class="segmented">${[['DIRECTIONAL', '방향성 · 국가별 1개'], ['CURVE', '커브 · 별도']].map(([v, l]) => `<button data-mom-sleeve="${v}" class="${sleeve === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="muted">63일 방향 추세 ÷ (60일 변동성 × √63) · 보유 중 교체 없음</span>
    </div>
    <div class="momentum-layout">
      <div class="table-scroll">
        <table>
          <thead><tr><th>자산 / 방향</th><th>판단</th><th class="number">선택 점수</th><th class="number">현재 / 손절선</th><th class="number">신규 DV01</th><th class="number">모의 미실현</th></tr></thead>
          <tbody>${rows
            .map(
              (r) => `<tr class="mom-row ${selected === r.id ? 'selected' : ''}" data-mom-id="${esc(r.id)}" tabindex="0">
              <td class="pair-name">${esc(r.name)}<div class="pair-sub">${side(r)}</div></td>
              <td>${tag(r)}<div class="pair-sub">${r.group_position_id ? '보유: ' + esc(r.group_position_id) : r.group_selected ? '선택: ' + esc(r.group_selected) : ''}</div></td>
              <td class="number">${n(r.selection_score)}</td>
              <td class="number">${level(r, r.close)}<div class="pair-sub">손절 ${level(r, r.initial_stop)}</div></td>
              <td class="number">${n(r.planned_gross_dv01_usd, 0)}<div class="pair-sub">USD/bp${r.class === 'Curve' ? ' 합산' : ''}</div></td>
              <td class="number">${r.position ? money(r.unrealized_usd) : '—'}</td>
            </tr>`
            )
            .join('')}</tbody>
        </table>
      </div>
      <div id="momentum-detail"></div>
    </div>
  </div>
  <div class="panel below" id="momentum-backtest">
    <div class="panel-head">
      <h2>달러 성과 · ${sleeve === 'CURVE' ? '커브 별도' : '방향성 국가별 선택'}</h2>
      <button class="btn" id="mom-json">↓ JSON</button>
    </div>
    ${rangeCtrl}
    <div class="data-info"><span class="orange">주황: ${sleeve === 'CURVE' ? '커브' : '국가별 1개 선택'}</span>${sleeve === 'CURVE' ? '' : ' / <span class="blue">파랑: 최대 계획 위험 $70,000에 맞춘 독립 진입 참고</span>'}. 독립 진입은 동시 포지션이 더 많아 총 위험이 다릅니다. 원금·복리 가정은 없습니다.</div>
    ${chart(block, sleeve === 'CURVE' ? null : bt.independent_cap_matched)}
    <div class="table-scroll">
      <table>
        <thead><tr><th>방식</th><th class="number">누적 손익</th><th class="number">실현</th><th class="number">미실현</th><th class="number">MDD</th><th class="number">거래</th><th class="number">승률</th><th class="number">PF</th></tr></thead>
        <tbody>${[[sleeve === 'CURVE' ? '커브' : '국가별 선택', block], ...(sleeve === 'CURVE' ? [] : [['독립 진입 · 각 $35k', bt.independent_reference], ['독립 진입 · 각 $14k, 한도 비교', bt.independent_cap_matched]])]
          .map(
            ([l, b]) => `<tr>
            <td>${l}</td>
            <td class="number">${money(b.summary.total_usd)}</td>
            <td class="number">${money(b.summary.realized_usd)}</td>
            <td class="number">${money(b.summary.unrealized_usd)}</td>
            <td class="number red">${money(b.summary.max_drawdown_usd)}</td>
            <td class="number">${b.summary.trades}</td>
            <td class="number">${n(b.summary.win_rate * 100, 1)}%</td>
            <td class="number">${n(b.summary.profit_factor)}</td>
          </tr>`
          )
          .join('')}</tbody>
      </table>
    </div>
  </div>
  <div class="panel below">
    <div class="panel-head">
      <h2>전체 연도별 손익 · USD</h2>
      <div class="control-buttons">
        <select id="mom-year" aria-label="성과 연도"><option value="ALL">전체 연도</option>${years.map((y) => `<option value="${y}">${y}</option>`).join('')}</select>
        <button class="btn" id="mom-export-annual">↓ 연도 CSV</button>
      </div>
    </div>
    <div class="table-scroll">
      <table id="mom-annual-table">
        <thead><tr><th>연도</th><th class="number">미국 방향성</th><th class="number">독일 방향성</th><th class="number">방향성 합계</th><th class="number">미국 커브</th><th class="number">독일 커브</th><th class="number">커브 합계</th><th class="number">전체 합계 참고</th></tr></thead>
        <tbody>${ys
          .map(
            (y) => `<tr>
            <td>${y}${y === p.end.slice(0, 4) ? ' YTD' : ''}</td>
            <td class="number">${money(av(bt.country.US, y))}</td>
            <td class="number">${money(av(bt.country.DE, y))}</td>
            <td class="number">${money(av(bt, y))}</td>
            ${bt.curve_experiment.assets.map((a) => `<td class="number">${money(a.annual.find((v) => v.year === y)?.pnl_usd)}</td>`).join('')}
            <td class="number">${money(av(bt.curve_experiment, y))}</td>
            <td class="number">${money(av(bt.all_with_curves, y))}</td>
          </tr>`
          )
          .join('')}</tbody>
      </table>
    </div>
    <div class="rule-note">연간 손익은 일별 실현·미실현 평가손익 증감 합계입니다. 전체 참고 합계는 별도 위험 예산의 커브를 포함합니다.</div>
  </div>
  <div class="panel below">
    <div class="panel-head"><h2>자산별 연도별 손익 · ${sleeve === 'CURVE' ? '커브' : '방향성'} / USD</h2><button class="btn" id="mom-export-assets">↓ 자산·연도 CSV</button></div>
    <div class="table-scroll">
      <table id="mom-asset-table">
        <thead><tr><th>자산</th>${ys.map((y) => `<th class="number">${y}${y === p.end.slice(0, 4) ? ' YTD' : ''}</th>`).join('')}<th class="number">전체 누적</th><th class="number">거래</th><th class="number">PF</th></tr></thead>
        <tbody>${assets
          .map(
            (a) => `<tr>
            <td class="pair-name">${esc(a.name)}</td>
            ${ys
              .map((y) => {
                const v = a.annual.find((v) => v.year === y)?.pnl_usd;
                return `<td class="number ${v > 0 ? 'green' : v < 0 ? 'red' : ''}">${v == null ? '미수록' : money(v)}</td>`;
              })
              .join('')}
            <td class="number">${a.available ? money(a.total_usd) : '미수록'}</td>
            <td class="number">${a.available ? a.trades : '—'}</td>
            <td class="number">${n(a.profit_factor)}</td>
          </tr>`
          )
          .join('')}</tbody>
      </table>
    </div>
  </div>
  <div class="panel below">
    <div class="panel-head"><h2>거래 규칙과 검증 범위</h2></div>
    <ol class="research-list">
      <li>20일 돌파, B는 MA20/120 방향 조건 추가. 국가 내 진입 후보 점수 최대 하나 선택. 보유 중 교체·추가 진입 없음.</li>
      <li>다음 국가 관측일 시가 진입. 선택 자산 시가가 없으면 취소합니다. 10일 반대 종가 채널 이탈 시 다음 시가 청산하며 청산 당일 재진입하지 않습니다.</li>
      <li>손절 거리 = 진입 전 20일 변화 표준편차 × 2.5. USD DV01 = $35,000 ÷ (손절 bp + 기본 왕복 비용 bp). 진입 후 수량과 최초 손절선 고정.</li>
      <li>금리 편도 비용 0.2bp, 커브 두 leg 합계 편도 0.4bp 가정. 독일도 USD 환산 DV01을 고정한 연구 손익입니다.</li>
      ${p.limitations.map((v) => `<li>${esc(v)}</li>`).join('')}
    </ol>
  </div>`;

  bindRangeControls(target, () => renderLegacyMomentum(target));
  enhanceInteractiveCharts(target);

  document.querySelectorAll('[data-mom-model]').forEach((el) => (el.onclick = () => { model = el.dataset.momModel; renderLegacyMomentum(target); }));
  document.querySelectorAll('[data-mom-sleeve]').forEach((el) => (el.onclick = () => { sleeve = el.dataset.momSleeve; renderLegacyMomentum(target); }));
  document.querySelectorAll('[data-mom-id]').forEach((el) => {
    el.onclick = () => { selected = el.dataset.momId; renderLegacyMomentum(target); };
    el.onkeydown = (e) => { if (e.key === 'Enter') el.click(); };
  });
  $('#mom-year').value = year;
  $('#mom-year').onchange = (e) => { year = e.target.value; renderLegacyMomentum(target); };
  $('#mom-export-annual').onclick = () =>
    csv('momentum-annual-' + model + '.csv', [
      ['year', 'US_directional_USD', 'DE_directional_USD', 'directional_USD', 'curve_USD', 'all_reference_USD'],
      ...ys.map((y) => [y, av(bt.country.US, y), av(bt.country.DE, y), av(bt, y), av(bt.curve_experiment, y), av(bt.all_with_curves, y)])
    ]);
  $('#mom-export-assets').onclick = () =>
    csv('momentum-assets-' + model + '.csv', [
      ['asset', 'year', 'pnl_USD', 'exit_trades'],
      ...assets.flatMap((a) => a.annual.filter((v) => ys.includes(v.year)).map((v) => [a.id, v.year, v.pnl_usd, v.trades]))
    ]);
  $('#mom-json').onclick = () => {
    const u = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })),
      a = document.createElement('a');
    a.href = u;
    a.download = 'momentum-usd-' + p.end + '.json';
    a.click();
    URL.revokeObjectURL(u);
  };
  const r = rows.find((r) => r.id === selected);
  if (r) detail(r, state, p);
}

function detail(r, state, research) {
  const p = r.position,
    budget = research.config.budget_usd,
    metric = (l, v) => `<div><div class="metric-label">${l}</div><div class="metric-value">${v}</div></div>`;
  $('#momentum-detail').innerHTML = `<div class="momentum-plan">
    <div class="detail-label">MODEL ${model} · ${esc(r.country)}</div>
    <h2>${esc(r.name)}</h2>
    ${tag(r)}
    <p>${side(r)}</p>
    <div class="metrics-grid">
      ${metric('계획 손절 예산', money(budget))}
      ${metric('신규 손절 폭', n(r.vol == null ? null : 2.5 * r.vol) + ' bp')}
      ${metric('신규 DV01', n(r.planned_gross_dv01_usd, 0) + ' USD/bp')}
      ${metric('신규 계획 손절선', level(r, r.vol == null ? null : r.close - (r.direction || r.suggested_direction) * 2.5 * r.vol))}
      ${metric('10일 청산 기준', level(r, r.channel_exit))}
      ${metric('후보 비교 점수', n(r.selection_score))}
    </div>
    ${p ? `<p class="muted">모의 진입 ${p.entry_date} · ${level(r, p.entry_basis)}<br>진입 DV01 ${n(p.gross_dv01_usd, 0)} USD/bp · 보유 고정 손절 ${level(r, p.initial_stop)} · 미실현 ${money(r.unrealized_usd)}</p>` : '<p class="muted">신규 규모는 최신 확정 변동성 기준입니다. 실제 진입 시 체결값에서 손절선을 다시 계산합니다.</p>'}
    ${r.class === 'Curve' ? '<p class="muted">합산 DV01을 50:50 배분합니다. 스프레드 1bp 손익은 leg당 DV01 기준입니다.</p>' : ''}
    <button class="btn primary" id="mom-register" ${r.phase === 'NO_DATA' || r.planned_gross_dv01_usd == null ? 'disabled' : ''}>실제 체결 보유 등록 · USD DV01</button>
    <p class="muted">실제 입력 장부이며 모의 거래를 자동 등록하지 않습니다. 갭·체결 차이로 손실 예산을 초과할 수 있습니다.</p>
  </div>`;
  $('#mom-register').onclick = () =>
    openHoldingDialog({
      asset_class: 'Rates',
      leg1: r.leg1,
      leg2: r.leg2 || null,
      shape: r.leg2 ? 'PAIR' : 'SINGLE',
      strategy: 'MOMENTUM_' + model,
      momentum_id: r.id,
      direction_sign: r.direction || r.suggested_direction,
      suggested_size: r.planned_gross_dv01_usd,
      entry_date: state.event_today,
      rates_currency: 'USD',
      hardcap_usd: budget
    });
}

let momentumView =
  location.hash === '#momentum/active-4e'
    ? 'ACTIVE_4E'
    : location.hash === '#momentum/radar-v3'
    ? 'RADAR_V3'
    : location.hash === '#momentum/v35-master'
    ? 'V35_MASTER'
    : location.hash === '#momentum/fx-v2-monthly'
    ? 'FX_V2_MONTHLY'
    : location.hash === '#momentum/recipe1'
    ? 'RECIPE1'
    : location.hash === '#momentum/synergy'
    ? 'SYNERGY'
    : location.hash === '#momentum/cta'
    ? 'CTA'
    : 'LEGACY';
export function renderMomentum(target) {
  const hashForView = (v) =>
    v === 'ACTIVE_4E'
      ? '#momentum/active-4e'
      : v === 'RADAR_V3'
      ? '#momentum/radar-v3'
      : v === 'V35_MASTER'
      ? '#momentum/v35-master'
      : v === 'FX_V2_MONTHLY'
      ? '#momentum/fx-v2-monthly'
      : v === 'RECIPE1'
      ? '#momentum/recipe1'
      : v === 'SYNERGY'
      ? '#momentum/synergy'
      : v === 'CTA'
      ? '#momentum/cta'
      : '#momentum';
  history.replaceState(null, '', hashForView(momentumView));
  target.innerHTML = `<div class="momentum-view-nav segmented" role="group" aria-label="모멘텀 연구 화면">
    <button data-momentum-view="LEGACY" class="${momentumView === 'LEGACY' ? 'on' : ''}">금리 A/B · 기존 모형</button>
    <button data-momentum-view="CTA" class="${momentumView === 'CTA' ? 'on' : ''}">선물 · CTA 결합 연구</button>
    <button data-momentum-view="SYNERGY" class="${momentumView === 'SYNERGY' ? 'on' : ''}">FX 차익거래 × 모멘텀 시너지 (수익 극대화)</button>
    <button data-momentum-view="RECIPE1" class="${momentumView === 'RECIPE1' ? 'on' : ''}">레시피1 × FX 레짐·DB 통합 컨트롤러</button>
    <button data-momentum-view="FX_V2_MONTHLY" class="${momentumView === 'FX_V2_MONTHLY' ? 'on' : ''}">FX v2.0 배경 & 59개월 월간 손익·방어 분석</button>
    <button data-momentum-view="V35_MASTER" class="${momentumView === 'V35_MASTER' ? 'on' : ''}">FX v2.0(4B) + 모멘텀 v3.5 A-to-Z</button>
    <button data-momentum-view="RADAR_V3" class="${momentumView === 'RADAR_V3' ? 'on' : ''}">FX v3.0(A3 브레이크) + 모멘텀 v3.5</button>
    <button data-momentum-view="ACTIVE_4E" class="${momentumView === 'ACTIVE_4E' ? 'on' : ''}">4엔진 풀액티브 (US/DE·FX)</button>
  </div>
  <div id="momentum-content"></div>`;
  target.querySelectorAll('[data-momentum-view]').forEach(
    (b) =>
      (b.onclick = () => {
        momentumView = b.dataset.momentumView;
        history.replaceState(null, '', hashForView(momentumView));
        renderMomentum(target);
      })
  );
  const content = target.querySelector('#momentum-content');
  if (momentumView === 'ACTIVE_4E') renderMomentumActive4e(content);
  else if (momentumView === 'RADAR_V3') renderMomentumRadarV3(content);
  else if (momentumView === 'V35_MASTER') renderMomentumV35(content);
  else if (momentumView === 'FX_V2_MONTHLY') renderMomentumFxV2Monthly(content);
  else if (momentumView === 'RECIPE1') renderMomentumRecipe1Control(content);
  else if (momentumView === 'SYNERGY') renderMomentumSynergy(content);
  else if (momentumView === 'CTA') renderMomentumCta(content);
  else renderLegacyMomentum(content);
}
