import {
  renderRangeControls,
  bindRangeControls,
  filterSeriesByRange,
  getRangeState,
  getChartTheme,
  enhanceInteractiveCharts
} from './chart-utils.js';

let ctx, selectedId = null, bookFilter = 'OPEN', alertFilter = 'ALL';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sg = (v, d = 2) => (v == null ? '—' : (v > 0 ? '+' : '') + n(v, d));
const money = (v, c) => (v == null ? '평가 대기' : c === 'KRW' ? sg(v / 10000, 1) + ' 만원' : '$' + sg(v, 0));
const currency = (p) => p.pnl_currency || 'USD';
const side = (v, cls) => (cls === 'Rates' ? (v > 0 ? '채권 LONG' : '채권 SHORT') : v > 0 ? 'LONG' : 'SHORT');

const monitors = {
  HOLD: '보유',
  CLOSED: '청산 완료',
  AWAITING_MARK: '진입 후 가격 대기',
  DATA_STALE: '기준일 관측 누락',
  DATA_MISSING: '가격 누락',
  HARDCAP_ALERT: '손실 기준 초과',
  STOP_ALERT: '모델 손절선',
  EXIT_ALERT: '모델 청산선',
  PROFIT_ALERT: '이익 실현 기준',
  MODEL_REVIEW: '모델 재평가',
  MODEL_UNAVAILABLE: '고정모델 확인'
};

export function configureHoldings(context) {
  ctx = context;
}

function quote(asset, date) {
  const s = ctx.getState();
  let value = s.asset_history?.[asset.id]?.find((p) => p.date === date)?.value;
  if (value == null && date === s.as_of) value = s.latest_transformed?.[asset.id];
  if (value == null) return '';
  return asset.class === 'Rates' ? (value / 100).toFixed(5) : Math.exp(value / 100).toPrecision(9);
}

function momentumLevel(p, q) {
  return q == null ? '—' : p.asset_class === 'FX' ? n(Math.exp(q), 6) + ' USD' : p.leg2 ? n(q, 2) + ' bp' : n(-q / 100, 3) + '%';
}

function today() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map((k) => p.find((p) => p.type === k).value).join('-');
}

function quoteLabel(a) {
  return a.class === 'Rates' ? `${a.name} 진입 수익률 (%)` : a.name === 'USD_Basket' ? '달러지수 진입 레벨' : `${a.name} 진입 가격 (USD / 통화 1단위)`;
}

function dialogShell(title, body) {
  const d = $('#position-dialog');
  d.innerHTML = `<form id="holding-form"><div class="eyebrow">HOLDINGS & TRADE HISTORY</div><h2>${title}</h2>${body}<div id="holding-error" role="alert" class="form-error" hidden></div><div class="dialog-actions"><button type="button" id="cancel-holding" class="btn">취소</button><button type="submit" class="btn primary" id="save-holding">저장</button></div></form>`;
  $('#cancel-holding').onclick = () => d.close();
  d.showModal();
  return $('#holding-form');
}

export function openHoldingDialog(row) {
  const s = ctx.getState(),
    cls = ['Rates', 'FX'].includes(row?.asset_class) ? row.asset_class : 'Rates';
  const form = dialogShell(
    '보유 포지션 등록',
    `<p class="muted">모멘텀 표시는 실제 입력일 전 변동성으로 최초 손절선을 고정합니다. 체결한 보유 내역을 직접 기록합니다. 모델 시그널과 관계없이 등록할 수 있습니다.</p><div class="form-grid"><label>자산군<select id="h-class"><option value="Rates">금리 · 합산 민감도</option><option value="FX">FX · USD mio</option></select></label><label>금리 DV01 통화<select id="h-rates-currency"><option value="KRW">원화 · 만원/bp</option><option value="USD">달러 · USD/bp</option></select></label><label>진입일<input id="h-date" type="date" value="${row?.entry_date || s.as_of}" max="${today()}" required></label><label>전략<select id="h-strategy"><option value="MANUAL">수동 / 미분류</option><option value="RV">RV</option><option value="MOMENTUM">모멘텀 전략</option><option value="MOMENTUM_A">모멘텀 A</option><option value="MOMENTUM_B">모멘텀 B</option></select></label><label>거래 형태<select id="h-shape"><option value="PAIR">페어</option><option value="SINGLE">단일 자산</option></select></label><label>Leg 1<select id="h-leg1"></select></label><label>Leg 2<select id="h-leg2"></select></label><label>Leg 1 방향<select id="h-side1"></select></label><label>Leg 2 방향<select id="h-side2"></select></label></div><div id="sizing-fields"></div><div class="form-grid"><label><span id="h-quote1-label"></span><input id="h-quote1" type="number" step="any" required></label><label><span id="h-quote2-label"></span><input id="h-quote2" type="number" step="any" required></label></div><p class="muted" id="quote-hint"></p><label>손실 알림 <span id="h-limit-unit"></span> · 선택<input id="h-limit" type="number" min="0" step="any" placeholder="미입력 시 사용 안 함"></label><label>메모<textarea id="h-notes" rows="2" maxlength="1000" placeholder="거래 목적, 실제 체결 정보 등"></textarea></label><div class="input-help">시세·금리는 모델의 기준가격입니다. 실제 진입 가격으로 수정할 수 있습니다.</div>`
  );
  $('#h-class').value = cls;
  $('#h-rates-currency').value = row?.rates_currency || 'KRW';
  $('#h-shape').value = row?.shape || 'PAIR';
  $('#h-strategy').value = row?.strategy || 'MANUAL';

  function fillAssets(wanted1, wanted2) {
    const single = $('#h-shape').value === 'SINGLE';
    const c = $('#h-class').value,
      usd = c === 'Rates' && $('#h-rates-currency').value === 'USD',
      assets = s.assets.filter((a) => a.class === c);
    for (const selector of ['#h-leg1', '#h-leg2']) $(selector).innerHTML = assets.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
    $('#h-leg1').value = assets.some((a) => a.id === wanted1) ? wanted1 : assets[0]?.id;
    $('#h-leg2').value = assets.some((a) => a.id === wanted2) ? wanted2 : assets[1]?.id;
    const options =
      c === 'Rates'
        ? '<option value="1">채권 LONG · 금리 하락</option><option value="-1">채권 SHORT · 금리 상승</option>'
        : '<option value="1">통화 LONG</option><option value="-1">통화 SHORT</option>';
    $('#h-side1').innerHTML = options;
    $('#h-side2').innerHTML = options;
    $('#h-side1').value = '1';
    $('#h-side2').value = '-1';
    if (row?.direction_sign) {
      const d = c === 'Rates' && !row.strategy?.startsWith('MOMENTUM_') ? -row.direction_sign : row.direction_sign;
      $('#h-side1').value = String(d);
      $('#h-side2').value = String(c === 'FX' ? -d * Math.sign(row.lag_beta || 1) : -d);
    }
    $('#sizing-fields').innerHTML =
      c === 'Rates'
        ? `<div class="form-grid"><label>${single ? '단일 민감도' : '페어 합산 민감도'} (${usd ? 'USD' : '만원'} / bp)<input id="h-total" type="number" min="0.0001" step="any" placeholder="예: 1000" required></label><label>Leg 1 배분 (%)<input id="h-weight" type="number" min="0.01" max="99.99" value="50" step="any" required></label></div><div id="allocation-preview" class="allocation-preview"></div>`
        : `<div class="form-grid"><label>Leg 1 규모 (USD mio)<input id="h-mio1" type="number" min="0.000001" step="any" value="1" required></label><label>Leg 2 규모 (USD mio)<input id="h-mio2" type="number" min="0.000001" step="any" value="1" required></label></div>`;
    for (const selector of ['#h-leg2', '#h-side2', '#h-quote2']) {
      const el = $(selector);
      el.closest('label').hidden = single;
      el.required = !single;
    }
    if (c === 'Rates') {
      $('#h-weight').closest('label').hidden = single;
      $('#h-weight').disabled = single;
      if (single) $('#h-weight').value = 100;
    } else {
      $('#h-mio2').closest('label').hidden = single;
      $('#h-mio2').required = !single;
    }
    $('#h-rates-currency').closest('label').hidden = c !== 'Rates';
    if (row?.suggested_size > 0 && (c !== 'Rates' || row.rates_currency === $('#h-rates-currency').value)) {
      $(c === 'Rates' ? '#h-total' : '#h-mio1').value = row.suggested_size.toFixed(4);
    }
    $('#h-limit-unit').textContent = c === 'Rates' && !usd ? '(만원)' : '(USD)';
    $('#h-limit').value = usd && row?.hardcap_usd ? row.hardcap_usd : '';
    if (c === 'Rates') {
      $('#h-total').oninput = allocation;
      $('#h-weight').oninput = allocation;
      allocation();
    }
    fillQuotes();
  }

  function allocation() {
    const total = Number($('#h-total').value),
      w = Number($('#h-weight').value),
      unit = $('#h-rates-currency').value === 'USD' ? 'USD' : '만원';
    $('#allocation-preview').textContent =
      total > 0
        ? `절대 DV01 합계 ${n(total, 1)}${unit}/bp → Leg 1 ${n((total * w) / 100, 1)} + Leg 2 ${n((total * (1 - w / 100)), 1)}${unit}/bp`
        : '단일은 해당 자산, 페어는 두 leg의 절대 DV01 합계를 입력하세요.';
  }

  function fillQuotes() {
    for (const i of [1, 2]) {
      const a = s.assets.find((a) => a.id === $('#h-leg' + i).value);
      if (!a) continue;
      $('#h-quote' + i + '-label').textContent = quoteLabel(a);
      $('#h-quote' + i).value = quote(a, $('#h-date').value);
    }
    $('#quote-hint').textContent =
      $('#h-date').value === s.as_of
        ? `가격 기준일 ${s.as_of}의 모델 가격을 채웠습니다. 실제 체결값으로 수정하세요.`
        : '선택한 진입일의 자료가 있으면 채웁니다.';
  }

  fillAssets(row?.leg1, row?.leg2);
  $('#h-class').onchange = () => fillAssets();
  $('#h-rates-currency').onchange = () => fillAssets($('#h-leg1').value, $('#h-leg2').value);
  $('#h-shape').onchange = () => fillAssets($('#h-leg1').value, $('#h-leg2').value);
  $('#h-leg1').onchange = fillQuotes;
  $('#h-leg2').onchange = fillQuotes;
  $('#h-date').onchange = fillQuotes;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const c = $('#h-class').value;
    const single = $('#h-shape').value === 'SINGLE';
    const v = {
      action: 'manual_open',
      shape: single ? 'SINGLE' : 'PAIR',
      rates_currency: $('#h-rates-currency').value,
      strategy: $('#h-strategy').value,
      momentum_id: row?.momentum_id,
      leg1: $('#h-leg1').value,
      leg2: single ? null : $('#h-leg2').value,
      side1: +$('#h-side1').value,
      side2: +$('#h-side2').value,
      entry_date: $('#h-date').value,
      quote1: +$('#h-quote1').value,
      quote2: single ? 0 : +$('#h-quote2').value,
      hardcap: $('#h-limit').value ? +$('#h-limit').value * (c === 'Rates' && $('#h-rates-currency').value !== 'USD' ? 10000 : 1) : 0,
      notes: $('#h-notes').value
    };
    if (c === 'Rates') {
      if ($('#h-rates-currency').value === 'USD') v.total_dv01_usd = +$('#h-total').value;
      else v.total_sensitivity_manwon = +$('#h-total').value;
      v.leg1_weight = +$('#h-weight').value;
    } else {
      v.mio1 = +$('#h-mio1').value;
      v.mio2 = +$('#h-mio2').value;
    }
    await submit(v);
  };
}

async function submit(v) {
  try {
    $('#save-holding').disabled = true;
    const r = await ctx.api('/api/positions', v);
    selectedId = r.id || v.id;
    $('#position-dialog').close();
    await ctx.onChange();
    ctx.setTab('book');
    ctx.toast('보유 내역과 거래 이력을 저장했습니다.');
  } catch (e) {
    $('#holding-error').hidden = false;
    $('#holding-error').textContent = e.message;
  } finally {
    if ($('#save-holding')) $('#save-holding').disabled = false;
  }
}

function openCloseDialog(p) {
  const closeRequest = crypto.randomUUID(),
    s = ctx.getState(),
    date = [s.as_of, p.entry_date, ...(p.events || []).filter((e) => e.remaining_fraction !== undefined).map((e) => e.trade_date)].sort().at(-1);
  const form = dialogShell(
    '부분·전체 청산 기록',
    `<p>${esc(p.name)} · ${currency(p) === 'KRW' ? '민감도 기준' : 'USD 명목 기준'}</p><div class="form-grid"><label>청산일<input type="date" id="c-date" value="${date}" max="${today()}" required></label><label>남은 보유 중 청산 비율 (%)<input type="number" id="c-percent" min="0.01" max="100" value="100" step="any" required></label><label id="c-label1">Leg 1 청산 수익률·가격<input type="number" step="any" id="c-quote1" required></label><label id="c-label2">Leg 2 청산 수익률·가격<input type="number" step="any" id="c-quote2" required></label></div><label>청산 메모<textarea id="c-notes" rows="2" maxlength="1000"></textarea></label>`
  );
  function fill() {
    for (const i of [1, 2]) {
      const a = s.assets.find((a) => a.id === p['leg' + i]);
      $('#c-quote' + i).value = a ? quote(a, $('#c-date').value) : '';
    }
  }
  fill();
  if (!p.leg2) {
    $('#c-quote2').required = false;
    $('#c-label2').hidden = true;
    $('#c-quote2').value = 0;
  }
  $('#c-date').onchange = fill;
  form.onsubmit = async (e) => {
    e.preventDefault();
    await submit({
      action: 'manual_close',
      id: p.id,
      expected_revision: p.revision || 0,
      request_id: closeRequest,
      trade_date: $('#c-date').value,
      percent: +$('#c-percent').value,
      quote1: +$('#c-quote1').value,
      quote2: +$('#c-quote2').value,
      notes: $('#c-notes').value
    });
  };
}

function quantity(p) {
  const cPrefix =
    p.momentum_meta?.contracts != null
      ? `${p.momentum_meta.contract ? p.momentum_meta.contract + ' ' : ''}${p.momentum_meta.contracts}계약 · `
      : '';
  if (p.current_leg1_size != null) {
    const a = p.current_leg1_size,
      b = p.current_leg2_size || 0;
    return p.asset_class === 'Rates'
      ? `${cPrefix}${n((a + b) / (currency(p) === 'KRW' ? 10000 : 1), 1)} ${currency(p) === 'KRW' ? '만원' : 'USD'}/bp`
      : `${n(a / 1e6)}${p.leg2 ? ' / ' + n(b / 1e6) : ''} mio`;
  }
  const f = p.remaining_fraction ?? (p.status === 'CLOSED' ? 0 : 1);
  return p.schema_version === 2
    ? p.asset_class === 'Rates'
      ? currency(p) === 'USD'
        ? `${cPrefix}${n((p.leg1_size + p.leg2_size) * f, 1)} USD/bp`
        : `${cPrefix}${n(((p.leg1_size + p.leg2_size) * f) / 10000, 1)} 만원/bp`
      : `${n((p.leg1_size * f) / 1e6)}${p.leg2 ? ' / ' + n((p.leg2_size * f) / 1e6) : ''} mio`
    : `${n(p.notional / 1e6)} / ${n(p.notional / 1e6)} mio`;
}

function pnlChart(p) {
  const ct = getChartTheme();
  const rawPoints = filterSeriesByRange(p.history_points || [], 'holdings-detail', (h) => h.date, 'ALL');
  if (!rawPoints.length) return '<div class="empty">일별 평가 이력은 진입 이후 가격이 수록되면 표시됩니다.</div>';
  const st = getRangeState('holdings-detail', 'ALL', false);
  const basePnl = st.rebase ? rawPoints[0]?.pnl || 0 : 0;
  const points = rawPoints.map((pt) => ({ ...pt, pnl: (pt.pnl || 0) - basePnl }));

  const w = window.innerWidth <= 760 ? 480 : 700,
    h = 225,
    pad = 60,
    vals = points.map((p) => p.pnl),
    lo = Math.min(0, ...vals),
    hi = Math.max(1, ...vals),
    range = hi - lo || 1,
    x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, points.length - 1),
    y = (v) => 16 + ((hi - v) / range) * (h - 52),
    line = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(2) + ',' + y(p.pnl).toFixed(2)).join('');

  return `<svg class="pnl-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="일별 평가손익 이력">
    <line x1="${pad}" x2="${w - pad}" y1="${y(0)}" y2="${y(0)}" stroke="${ct.zero}"/>
    <path d="${line}" fill="none" stroke="${ct.green}" stroke-width="2.2"/>
    <text x="4" y="${y(hi) + 8}" fill="${ct.axis}" font-size="12">${p.pnl_currency === 'KRW' ? n(hi / 10000, 0) : n(hi, 0)}</text>
    <text x="4" y="${y(lo)}" fill="${ct.axis}" font-size="12">${p.pnl_currency === 'KRW' ? n(lo / 10000, 0) : n(lo, 0)}</text>
    <text x="${pad}" y="${h - 7}" fill="${ct.axis}" font-size="12">${points[0].date}</text>
    <text x="${w - pad}" y="${h - 7}" text-anchor="end" fill="${ct.axis}" font-size="12">${points.at(-1).date}</text>
    ${points
      .map(
        (pt, i) => `<circle cx="${x(i)}" cy="${y(pt.pnl)}" r="${points.length === 1 ? 4 : 5}" fill="${points.length === 1 ? ct.green : 'transparent'}">
        <title>${pt.date}: ${money(pt.pnl, pt.currency)}</title>
      </circle>`
      )
      .join('')}
  </svg>`;
}

function exposure(ps) {
  const out = {};
  for (const p of ps) {
    const c = currency(p),
      f = p.remaining_fraction ?? 1;
    for (const i of [1, 2]) {
      if (!p['leg' + i]) continue;
      const node = p['node' + i],
        amount =
          p.schema_version === 2
            ? p['side' + i] * (p['current_leg' + i + '_size'] ?? p['leg' + i + '_size'] * f)
            : (i === 1 ? p.direction : -p.direction) * p.notional;
      const key = c + ':' + node + ':' + (p.asset_class === 'Rates' ? 'DV01' : 'NOTIONAL');
      out[key] = (out[key] || 0) + amount;
    }
  }
  return (
    Object.entries(out)
      .map(([k, v]) => {
        const [c, node, kind] = k.split(':');
        return `<span class="tag ${v >= 0 ? 'primary' : 'block'}">${esc(node)} ${c === 'KRW' ? sg(v / 10000, 1) + '만원/bp' : kind === 'DV01' ? sg(v, 1) + 'USD/bp' : '$' + sg(v / 1e6) + 'm'}</span>`;
      })
      .join('') || '<span class="muted">등록된 보유 없음</span>'
  );
}

function countryLimitNotice(active) {
  const counts = {};
  for (const p of active) {
    if (p.strategy?.startsWith('MOMENTUM_') && p.asset_class === 'Rates' && !p.leg2) {
      const c = /^(US|DE)/.exec(p.momentum?.instrument_id || '')?.[0];
      if (c) counts[c] = (counts[c] || 0) + 1;
    }
  }
  const excess = Object.entries(counts).filter(([, n]) => n > 1);
  return excess.length ? `<div class="notice">모멘텀 실제 등록의 국가별 1개 한도 초과: ${excess.map(([c, n]) => c + ' ' + n + '건').join(', ')}. 실제 체결 기록은 유지하며 모의 포지션과 구분합니다.</div>` : '';
}

const urgency = {
  HARDCAP_ALERT: 0,
  STOP_ALERT: 1,
  PROFIT_ALERT: 2,
  EXIT_ALERT: 3,
  MODEL_REVIEW: 4,
  MODEL_UNAVAILABLE: 5,
  DATA_MISSING: 6,
  DATA_STALE: 7,
  AWAITING_MARK: 8,
  HOLD: 9,
  CLOSED: 10
};

function monitorBadges(p) {
  const codes = [p.monitor, ...(p.monitor_flags || []).map((f) => f.code)].filter((c, i, a) => c && a.indexOf(c) === i);
  return `<div class="hm-badges">${codes
    .map(
      (code) =>
        `<span class="tag ${['HARDCAP_ALERT', 'STOP_ALERT'].includes(code) ? 'block' : ['EXIT_ALERT', 'PROFIT_ALERT'].includes(code) ? 'primary' : ['MODEL_REVIEW', 'MODEL_UNAVAILABLE', 'DATA_STALE', 'DATA_MISSING', 'AWAITING_MARK'].includes(code) ? 'hold' : ''}">${esc(monitors[code] || code)}</span>`
    )
    .join('')}</div>`;
}

function modelQuote(p, q) {
  return q == null ? '—' : p.asset_class === 'Rates' ? n(q, 4) + '%' : n(q, 6);
}
function currentSize(p, i) {
  return p['current_leg' + i + '_size'] ?? (p['leg' + i + '_size'] ?? p.notional ?? 0) * (p.remaining_fraction ?? 1);
}
function sizeText(p, a, b) {
  return p.asset_class === 'Rates'
    ? n((a + b) / (currency(p) === 'KRW' ? 10000 : 1), 1) + ' ' + (currency(p) === 'KRW' ? '만원' : 'USD') + '/bp'
    : n(a / 1e6) + (p.leg2 ? ' / ' + n(b / 1e6) : '') + ' mio';
}
function nextTradeDate(p) {
  return [ctx.getState().as_of, p.entry_date, ...(p.events || []).filter((e) => ['OPEN', 'ADD', 'PARTIAL_CLOSE', 'CLOSE'].includes(e.type)).map((e) => e.trade_date)].sort().at(-1);
}

function openAddDialog(p) {
  const state = ctx.getState(),
    request = crypto.randomUUID(),
    rates = p.asset_class === 'Rates',
    krw = currency(p) === 'KRW',
    unit = rates ? (krw ? '만원/bp' : 'USD/bp') : 'USD mio';
  const form = dialogShell(
    '추가 진입 기록',
    `<p class="hm-dialog-intro">${esc(p.name)} · 현재 <b>${quantity(p)}</b><br>추가할 규모와 실제 체결 가격을 입력하세요.</p><div class="form-grid"><label>추가 체결일<input id="a-date" type="date" value="${nextTradeDate(p)}" max="${today()}" required></label>${rates ? `<label>추가 합산 민감도 (${unit})<input id="a-total" type="number" min="0.000001" step="any" required></label><label>추가분 Leg 1 배분 (%)<input id="a-weight" type="number" min="0.01" max="${p.leg2 ? '99.99' : '100'}" step="any" value="${p.leg2 ? 50 : 100}" ${p.leg2 ? '' : 'readonly'}></label>` : `<label>Leg 1 추가 USD mio<input id="a-mio1" type="number" min="0.000001" step="any" required></label>${p.leg2 ? '<label>Leg 2 추가 USD mio<input id="a-mio2" type="number" min="0.000001" step="any" required></label>' : ''}`}<label>${esc(p.node1)} 추가 체결 ${rates ? '수익률 (%)' : '가격 (USD/통화)'}<input id="a-quote1" type="number" step="any" required></label>${p.leg2 ? `<label>${esc(p.node2)} 추가 체결 ${rates ? '수익률 (%)' : '가격 (USD/통화)'}<input id="a-quote2" type="number" step="any" required></label>` : ''}</div><div class="hm-size-preview" id="a-preview">추가 후 규모를 확인하세요.</div><label>추가 진입 메모<textarea id="a-notes" rows="2" maxlength="1000"></textarea></label>`
  );
  function fill() {
    for (const i of [1, 2]) {
      const node = $('#a-quote' + i);
      if (!node) continue;
      const asset = state.assets.find((a) => a.id === p['leg' + i]);
      node.value = asset ? quote(asset, $('#a-date').value) : '';
    }
  }
  function preview() {
    let a = 0,
      b = 0;
    if (rates) {
      const total = +$('#a-total').value * (krw ? 10000 : 1),
        w = +$('#a-weight').value / 100;
      a = total * w;
      b = p.leg2 ? total * (1 - w) : 0;
    } else {
      a = +$('#a-mio1').value * 1e6;
      b = p.leg2 ? +$('#a-mio2').value * 1e6 : 0;
    }
    $('#a-preview').textContent = `현재 ${quantity(p)} + 추가 ${sizeText(p, a, b)} → ${sizeText(p, currentSize(p, 1) + a, currentSize(p, 2) + b)}`;
  }
  fill();
  $('#a-date').onchange = fill;
  for (const id of ['a-total', 'a-weight', 'a-mio1', 'a-mio2']) if ($('#' + id)) $('#' + id).oninput = preview;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = {
      action: 'manual_add',
      id: p.id,
      expected_revision: p.revision || 0,
      request_id: request,
      trade_date: $('#a-date').value,
      quote1: +$('#a-quote1').value,
      quote2: p.leg2 ? +$('#a-quote2').value : 0,
      notes: $('#a-notes').value
    };
    if (rates) {
      v[krw ? 'total_sensitivity_manwon' : 'total_dv01_usd'] = +$('#a-total').value;
      v.leg1_weight = +$('#a-weight').value;
    } else {
      v.mio1 = +$('#a-mio1').value;
      v.mio2 = p.leg2 ? +$('#a-mio2').value : 0;
    }
    await submit(v);
  };
}

function openEditDialog(p) {
  const s = ctx.getState(),
    rates = p.asset_class === 'Rates',
    single = !p.leg2,
    initCcy = currency(p),
    s1Cur = currentSize(p, 1),
    s2Cur = currentSize(p, 2),
    totRaw = s1Cur + s2Cur,
    initTotal = rates ? totRaw / (initCcy === 'KRW' ? 10000 : 1) : s1Cur / 1e6,
    initWeight = single ? 100 : totRaw > 0 ? +((s1Cur / totRaw) * 100).toFixed(2) : p.leg1_weight || 50,
    initMio1 = +(s1Cur / 1e6).toFixed(4),
    initMio2 = +(s2Cur / 1e6).toFixed(4),
    initQ1 = p.average_entry_quote1 ?? p.entry_quote1 ?? p.lots?.[0]?.entry_quote1 ?? '',
    initQ2 = p.average_entry_quote2 ?? p.entry_quote2 ?? p.lots?.[0]?.entry_quote2 ?? '',
    dirOptions = rates
      ? '<option value="1">채권 LONG · 금리 하락</option><option value="-1">채권 SHORT · 금리 상승</option>'
      : '<option value="1">통화 LONG</option><option value="-1">통화 SHORT</option>';

  const form = dialogShell(
    '보유 포지션 수정 (진입 가격 · 규모 · 방향)',
    `<p class="hm-dialog-intro"><b>${esc(p.name)}</b> 포지션의 진입일, 진입 수익률/가격, 보유 규모 및 방향을 수정합니다. 저장 시 고정모델 Z-score와 일별 평가손익 이력이 즉시 재계산됩니다.</p>
    <div class="form-grid">
      <label>진입일<input id="e-date" type="date" value="${esc(p.entry_date)}" max="${today()}" required></label>
      <label>전략 구분<select id="e-strategy"><option value="MANUAL">수동 / 미분류</option><option value="RV">RV</option><option value="MOMENTUM">모멘텀 전략</option><option value="MOMENTUM_A">모멘텀 A</option><option value="MOMENTUM_B">모멘텀 B</option></select></label>
      ${rates ? `<label>금리 DV01 통화<select id="e-rates-currency"><option value="KRW">원화 · 만원/bp</option><option value="USD">달러 · USD/bp</option></select></label>` : ''}
      <label>${esc(p.node1)} 방향<select id="e-side1">${dirOptions}</select></label>
      ${!single ? `<label>${esc(p.node2)} 방향<select id="e-side2">${dirOptions}</select></label>` : ''}
    </div>
    ${
      rates
        ? `<div class="form-grid">
            <label><span id="e-total-label">${single ? '단일 민감도' : '페어 합산 민감도'} (${initCcy === 'USD' ? 'USD' : '만원'} / bp)</span><input id="e-total" type="number" min="0.0001" step="any" value="${initTotal}" required></label>
            ${!single ? `<label>Leg 1 (${esc(p.node1)}) 배분 (%)<input id="e-weight" type="number" min="0.01" max="99.99" step="any" value="${initWeight}" required></label>` : ''}
          </div>
          <div id="e-allocation-preview" class="hm-size-preview"></div>`
        : `<div class="form-grid">
            <label>${esc(p.node1)} 규모 (USD mio)<input id="e-mio1" type="number" min="0.000001" step="any" value="${initMio1}" required></label>
            ${!single ? `<label>${esc(p.node2)} 규모 (USD mio)<input id="e-mio2" type="number" min="0.000001" step="any" value="${initMio2}" required></label>` : ''}
          </div>`
    }
    <div class="form-grid">
      <label>${esc(p.node1)} 진입 ${rates ? '수익률 (%)' : '가격 (USD/통화)'}<input id="e-quote1" type="number" step="any" value="${initQ1}" required></label>
      ${!single ? `<label>${esc(p.node2)} 진입 ${rates ? '수익률 (%)' : '가격 (USD/통화)'}<input id="e-quote2" type="number" step="any" value="${initQ2}" required></label>` : ''}
    </div>
    <div style="margin: -4px 0 10px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
      <small class="muted">실제 체결된 진입 금리(%) 또는 환율/가격을 직접 입력할 수 있습니다.</small>
      <button type="button" class="btn quiet" id="e-fill-model-quote" style="font-size:12px; padding:4px 8px;">선택 진입일의 모델 종가로 채우기</button>
    </div>
    <label>금액 손실 알림 기준 (<span id="e-limit-unit">${rates && initCcy === 'KRW' ? '만원' : 'USD'}</span> · 0 입력 시 사용 안 함)<input id="e-limit" type="number" min="0" step="any" value="${(p.hardcap || 0) / (rates && initCcy === 'KRW' ? 10000 : 1)}"></label>
    <label>포지션 메모 / 수정 사유<textarea id="e-notes" rows="2" maxlength="1000" placeholder="수정 사유 또는 포지션 메모">${esc(p.notes || '')}</textarea></label>
    <div style="margin-top:8px; padding-top:10px; border-top:1px dashed var(--line); display:flex; justify-content:space-between; align-items:center;">
      <span class="muted" style="font-size:12px;">잘못 등록한 포지션 자체를 지우려면 우측 버튼을 누르세요.</span>
      <button type="button" class="btn quiet" id="e-delete-pos" style="color:var(--red); border-color:var(--red);">포지션 삭제</button>
    </div>`
  );

  $('#e-strategy').value = p.strategy || 'MANUAL';
  if (rates && $('#e-rates-currency')) $('#e-rates-currency').value = initCcy;
  $('#e-side1').value = String(p.side1 ?? 1);
  if (!single && $('#e-side2')) $('#e-side2').value = String(p.side2 ?? -1);

  function updateAllocationPreview() {
    if (!rates) return;
    const ccy = $('#e-rates-currency')?.value || initCcy,
      unit = ccy === 'USD' ? 'USD' : '만원',
      tot = Number($('#e-total').value) || 0,
      w = single ? 100 : Number($('#e-weight')?.value ?? 50);
    $('#e-total-label').textContent = `${single ? '단일 민감도' : '페어 합산 민감도'} (${unit} / bp)`;
    $('#e-limit-unit').textContent = unit;
    $('#e-allocation-preview').textContent = single
      ? `단일 DV01: ${esc(p.node1)} ${n(tot, 1)} ${unit}/bp`
      : `합산 DV01 ${n(tot, 1)} ${unit}/bp → Leg 1 (${esc(p.node1)}) ${n((tot * w) / 100, 1)} + Leg 2 (${esc(p.node2)}) ${n((tot * (100 - w)) / 100, 1)} ${unit}/bp`;
  }

  if (rates) {
    $('#e-total').oninput = updateAllocationPreview;
    if ($('#e-weight')) $('#e-weight').oninput = updateAllocationPreview;
    if ($('#e-rates-currency')) $('#e-rates-currency').onchange = updateAllocationPreview;
    updateAllocationPreview();
  }

  $('#e-fill-model-quote').onclick = () => {
    const dVal = $('#e-date').value;
    const a1 = s.assets.find((a) => a.id === p.leg1);
    if (a1) {
      const q1 = quote(a1, dVal);
      if (q1) $('#e-quote1').value = q1;
    }
    if (!single) {
      const a2 = s.assets.find((a) => a.id === p.leg2);
      if (a2) {
        const q2 = quote(a2, dVal);
        if (q2) $('#e-quote2').value = q2;
      }
    }
  };

  $('#e-delete-pos').onclick = async () => {
    if (!confirm(`'${p.name}' 포지션을 완전히 삭제하시겠습니까?`)) return;
    try {
      await ctx.api('/api/positions', { action: 'delete', id: p.id });
      $('#position-dialog').close();
      await ctx.onChange();
      ctx.toast('포지션을 삭제했습니다.');
    } catch (err) {
      $('#holding-error').hidden = false;
      $('#holding-error').textContent = err.message;
    }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const ccy = rates ? $('#e-rates-currency')?.value || initCcy : 'USD';
    const payload = {
      action: 'manual_edit',
      id: p.id,
      entry_date: $('#e-date').value,
      strategy: $('#e-strategy').value,
      rates_currency: ccy,
      side1: +$('#e-side1').value,
      side2: single ? 0 : +$('#e-side2').value,
      quote1: +$('#e-quote1').value,
      quote2: single ? 0 : +$('#e-quote2').value,
      hardcap: $('#e-limit').value ? +$('#e-limit').value * (rates && ccy === 'KRW' ? 10000 : 1) : 0,
      notes: $('#e-notes').value,
      edit_reason: '진입 가격·규모 수정'
    };
    if (rates) {
      if (ccy === 'USD') payload.total_dv01_usd = +$('#e-total').value;
      else payload.total_sensitivity_manwon = +$('#e-total').value;
      payload.leg1_weight = single ? 100 : +$('#e-weight').value;
    } else {
      payload.mio1 = +$('#e-mio1').value;
      payload.mio2 = single ? 0 : +$('#e-mio2').value;
    }
    await submit(payload);
  };
}

function openSettingsDialog(p) {
  const m = p.model_monitor?.management || {
      exit_z: p.exit_z ?? 0.5,
      stop_z: p.stop_z ?? 3.7,
      review_z: p.review_z ?? 1,
      widening_z: p.widening_z ?? 1,
      hardcap: p.hardcap || 0,
      profit_target: p.profit_target || 0,
      pnl_basis: p.pnl_basis || 'TOTAL',
      rv_monitor_enabled: p.rv_monitor_enabled ?? (!p.momentum && !!p.leg2)
    },
    krw = currency(p) === 'KRW',
    request = crypto.randomUUID();
  const form = dialogShell(
    '포지션 관리 설정',
    `<p class="hm-dialog-intro">${esc(p.name)} · 고정 Z ${sg(p.fixed_z)} / 현재 OOS ${sg(p.current_oos_z)}</p><label class="hm-check"><input id="m-rv" type="checkbox" ${m.rv_monitor_enabled ? 'checked' : ''}>고정모델 청산·손절·재평가 알림</label><div class="form-grid"><label>청산 Z (진입 방향 기준)<input id="m-exit" type="number" min="0" max="99" step="any" value="${m.exit_z}" required></label><label>손절 Z (진입 방향 기준)<input id="m-stop" type="number" min="0.01" max="100" step="any" value="${m.stop_z}" required></label><label>고정·현재 OOS 차이 기준 (σ)<input id="m-review" type="number" min="0" max="100" step="any" value="${m.review_z}" required></label><label>고정 |Z| 전 관측일 확대 기준 (σ)<input id="m-widen" type="number" min="0" max="100" step="any" value="${m.widening_z}" required></label><label>금액 손실 기준 (${krw ? '만원' : 'USD'})<input id="m-loss" type="number" min="0" step="any" value="${m.hardcap / (krw ? 10000 : 1)}" required></label><label>금액 이익 실현 기준 (${krw ? '만원' : 'USD'})<input id="m-profit" type="number" min="0" step="any" value="${m.profit_target / (krw ? 10000 : 1)}" required></label><label>금액 판정에 사용하는 손익<select id="m-basis"><option value="TOTAL">실현 + 미실현 합계</option><option value="UNREALIZED">남은 보유의 미실현</option></select></label></div><div id="m-preview" class="hm-size-preview"></div><label>변경 사유<textarea id="m-notes" rows="2" maxlength="1000"></textarea></label>`
  );
  $('#m-basis').value = m.pnl_basis;
  function preview() {
    const sign = p.model_monitor?.entry_sign || Math.sign(p.entry_fixed_z || 0),
      z = p.fixed_z,
      exit = +$('#m-exit').value,
      stop = +$('#m-stop').value,
      basis = $('#m-basis').value === 'TOTAL' ? p.pnl : p.unrealized_pnl,
      limit = +$('#m-loss').value * (krw ? 10000 : 1),
      profit = +$('#m-profit').value * (krw ? 10000 : 1),
      flags = [];
    if ($('#m-rv').checked && z != null && sign) {
      if (sign * z >= stop) flags.push('현재 고정 Z가 손절 기준 이상');
      else if (sign * z <= exit) flags.push('현재 고정 Z가 청산 기준 충족');
    }
    if (basis != null && limit > 0 && basis <= -limit) flags.push('현재 손익이 금액 손실 기준 충족');
    if (basis != null && profit > 0 && basis >= profit) flags.push('현재 손익이 이익 실현 기준 충족');
    $('#m-preview').textContent = flags.length ? flags.join(' · ') : '변경한 기준으로 다음 평가부터 상태를 표시합니다.';
  }
  for (const id of ['m-exit', 'm-stop', 'm-loss', 'm-profit', 'm-basis', 'm-rv']) $('#' + id).oninput = preview;
  preview();
  form.onsubmit = async (e) => {
    e.preventDefault();
    await submit({
      action: 'update_management',
      id: p.id,
      expected_revision: p.revision || 0,
      request_id: request,
      exit_z: +$('#m-exit').value,
      stop_z: +$('#m-stop').value,
      review_z: +$('#m-review').value,
      widening_z: +$('#m-widen').value,
      hardcap: +$('#m-loss').value * (krw ? 10000 : 1),
      profit_target: +$('#m-profit').value * (krw ? 10000 : 1),
      pnl_basis: $('#m-basis').value,
      rv_monitor_enabled: $('#m-rv').checked,
      notes: $('#m-notes').value
    });
  };
}

function positionZChart(p) {
  const ct = getChartTheme();
  const allPts = (p.history_points || []).filter((h) => Number.isFinite(h.fixed_z) || Number.isFinite(h.current_oos_z));
  const points = filterSeriesByRange(allPts, 'holdings-detail', (h) => h.date, 'ALL');
  if (!points.length) return '<div class="empty">고정모델·현재 Z-score 이력을 준비 중입니다.</div>';
  const w = window.innerWidth <= 760 ? 480 : 760,
    h = 245,
    pad = { l: 48, r: 25, t: 23, b: 35 },
    m = p.model_monitor,
    lines = [
      ['fixed_z', '진입 고정모델', ct.amber],
      ['current_oos_z', '현재 OOS', ct.blue],
      ['current_refit_z', '현재 Refit', ct.muted]
    ],
    vals = points.flatMap((p) => lines.map(([k]) => p[k])).filter(Number.isFinite),
    max = Math.max(4.2, m?.management?.stop_z || 0, ...vals.map(Math.abs)) * 1.1,
    X = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, points.length - 1),
    Y = (v) => pad.t + ((max - v) / (2 * max)) * (h - pad.t - pad.b);

  let svg = `<svg class="hm-z-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="진입 고정모델과 현재 OOS Z-score">`;
  for (const z of [0, m?.exit_z_signed, m?.stop_z_signed].filter(Number.isFinite)) {
    svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(z)}" y2="${Y(z)}" stroke="${z === m?.stop_z_signed ? ct.stop : ct.grid}" stroke-dasharray="4 4"/><text x="8" y="${Y(z) + 4}" fill="${ct.axis}" font-size="11">${n(z, 1)}</text>`;
  }
  for (const [key, , color] of lines) {
    let pen = false;
    const d = points
      .map((p, i) => {
        if (!Number.isFinite(p[key])) {
          pen = false;
          return '';
        }
        const text = (pen ? 'L' : 'M') + X(i).toFixed(2) + ',' + Y(p[key]).toFixed(2);
        pen = true;
        return text;
      })
      .join(' ');
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${key === 'fixed_z' ? 2.5 : 1.7}"/>`;
  }
  points.forEach((pt, i) => {
    svg += `<circle cx="${X(i)}" cy="${Y(pt.fixed_z || 0)}" r="5" fill="transparent"><title>${pt.date}\n고정 Z: ${sg(pt.fixed_z)}\n현재 OOS: ${sg(pt.current_oos_z)}\nRefit: ${sg(pt.current_refit_z)}</title></circle>`;
  });
  svg += `<text x="${pad.l}" y="${h - 7}" fill="${ct.axis}" font-size="12">${points[0].date}</text><text x="${w - pad.r}" y="${h - 7}" text-anchor="end" fill="${ct.axis}" font-size="12">${points.at(-1).date}</text></svg>`;
  return `<div class="hm-chart-legend">${lines.map(([, name, color]) => `<span><i style="background:${color}"></i>${name}</span>`).join('')}</div>${svg}`;
}

export function renderHoldings(target) {
  const s = ctx.getState(),
    all = s.positions || [],
    active = all.filter((p) => p.status === 'OPEN');
  let visible = all.filter((p) => bookFilter === 'ALL' || p.status === bookFilter);
  if (alertFilter === 'ACTION') visible = visible.filter((p) => ['HARDCAP_ALERT', 'STOP_ALERT', 'PROFIT_ALERT', 'EXIT_ALERT'].includes(p.monitor));
  if (alertFilter === 'REVIEW') visible = visible.filter((p) => p.monitor === 'MODEL_REVIEW' || p.monitor_flags?.some((f) => f.code === 'MODEL_REVIEW'));
  if (alertFilter === 'HOLD') visible = visible.filter((p) => p.monitor === 'HOLD');
  visible.sort((a, b) => (urgency[a.monitor] ?? 99) - (urgency[b.monitor] ?? 99) || a.entry_date.localeCompare(b.entry_date));
  selectedId = visible.some((p) => p.id === selectedId) ? selectedId : visible[0]?.id;
  const chosen = visible.find((p) => p.id === selectedId);
  const total = (c) => all.filter((p) => currency(p) === c && Number.isFinite(p.pnl)).reduce((v, p) => v + p.pnl, 0),
    actionCount = active.filter((p) => ['HARDCAP_ALERT', 'STOP_ALERT', 'PROFIT_ALERT', 'EXIT_ALERT'].includes(p.monitor)).length,
    reviewCount = active.filter((p) => p.monitor_flags?.some((f) => f.code === 'MODEL_REVIEW')).length;

  target.innerHTML = `<section class="hm-root"><div class="stats"><div class="stat"><div class="label">보유 포지션</div><div class="num green">${active.length}<small>건</small></div><div class="help">가격 기준일 ${s.as_of} · 조회일 ${today()} KST</div></div><div class="stat"><div class="label">KRW 누적 손익</div><div class="num ${total('KRW') >= 0 ? 'green' : 'red'}">${sg(total('KRW') / 10000, 1)}<small>만원</small></div><div class="help">실현 추정 + 미실현 · 고정 DV01 근사</div></div><div class="stat"><div class="label">USD 누적 손익</div><div class="num ${total('USD') >= 0 ? 'green' : 'red'}">$${sg(total('USD'), 0)}</div><div class="help">USD 금리·FX · 거래비용·캐리 제외</div></div><div class="stat"><div class="label">청산·손절 / 모델 재평가</div><div class="num orange">${actionCount} / ${reviewCount}<small>건</small></div><div class="help">가격 평가 대기 ${active.filter((p) => p.pnl == null).length}건 · 중복 상태 포함</div></div></div>${countryLimitNotice(active)}<div class="panel"><div class="panel-head"><div><h2>보유 포지션과 관리 상태</h2><small>고정 Z는 진입 α·β·σ에 기준일 가격을 대입합니다.</small></div><div class="control-buttons"><button class="btn quiet" id="de-steep">DE 2–10Y 스팁 입력</button><button class="btn primary" id="manual-position">+ 포지션 등록</button></div></div><div class="filters"><div class="segmented">${[['OPEN', '보유'], ['CLOSED', '청산 이력'], ['ALL', '전체']].map(([v, l]) => `<button data-book-filter="${v}" class="${bookFilter === v ? 'on' : ''}">${l}</button>`).join('')}</div><label class="hm-filter">관리 상태<select id="book-alert-filter">${[['ALL', '전체 상태'], ['ACTION', '청산·손절 기준'], ['REVIEW', '모델 재평가'], ['HOLD', '보유']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label><span class="muted">고정모델·금액 손익·괴리 상태를 함께 표시합니다.</span></div><div class="table-scroll"><table class="hm-position-table wide-table" id="holdings-table"><thead><tr><th>페어 / 방향</th><th>진입일 / 잔여 규모</th><th class="number">진입 고정모델 Z<br>${esc(s.as_of)}</th><th class="number">현재 OOS Z<br>고정·현재 차이</th><th class="number">손익 합계<br>실현 / 미실현</th><th>관리 상태 / 근거</th><th>변경</th></tr></thead><tbody>${visible
    .map(
      (p) =>
        `<tr data-holding-id="${esc(p.id)}" class="holding-row ${p.id === selectedId ? 'selected' : ''}" tabindex="0"><td class="pair-name">${esc(p.name)}<div class="pair-sub">${p.schema_version === 2 ? `${esc(p.node1)} ${side(p.side1, p.asset_class)}${p.leg2 ? ' / ' + esc(p.node2) + ' ' + side(p.side2, p.asset_class) : ''}` : '기존 가상 기록'}</div></td><td data-label="진입일 / 잔여 규모">${p.entry_date}<div class="pair-sub">${quantity(p)}</div><div class="pair-sub">${p.strategy === 'MOMENTUM' ? '<b style="color:#ea580c;">⚡ 모멘텀 전략</b>' : esc(p.strategy || 'MANUAL')} · ${p.status === 'OPEN' ? '보유' : '청산 ' + p.exit_date}</div></td><td data-label="고정 Z · 기준일 ${s.as_of}" class="number hm-fixed-z">${p.strategy === 'MOMENTUM' && p.momentum_meta ? `${n(p.momentum_meta.current_futures_px, 3)}<div class="pair-sub">진입선물가 ${n(p.momentum_meta.entry_futures_px, 3)}</div>` : `${sg(p.fixed_z)}<div class="pair-sub">진입 ${sg(p.entry_fixed_z)} · Δ|Z| ${sg(p.model_monitor?.fixed_abs_change)}</div>`}</td><td data-label="현재 OOS / 괴리" class="number">${p.strategy === 'MOMENTUM' && p.momentum_meta ? `스탑 ${n(p.momentum_meta.stop_futures_px, 3)}<div class="pair-sub">익절 ${n(p.momentum_meta.partial_tp_futures_px, 3)}</div>` : `${sg(p.current_oos_z)}<div class="pair-sub">차이 ${n(p.model_monitor?.gap_abs)}σ</div>`}</td><td data-label="합계 / 실현 / 미실현" class="number ${(p.pnl || 0) >= 0 ? 'green' : 'red'}"><b>${money(p.pnl, currency(p))}</b><div class="pair-sub">실현 ${money(p.realized_pnl ?? (p.status === 'CLOSED' ? p.pnl : 0), currency(p))}</div><div class="pair-sub">미실현 ${money(p.unrealized_pnl ?? (p.status === 'OPEN' ? p.pnl : 0), currency(p))}</div></td><td data-label="관리 상태" class="hm-status">${monitorBadges(p)}<div class="pair-sub">${esc(p.monitor_flags?.[0]?.reason || (p.monitor === 'AWAITING_MARK' ? '마지막 거래 이후 가격 대기' : p.monitor === 'HOLD' ? '현재 관리 기준 내' : '가격·모형 상태 확인'))}</div></td><td data-label="변경"><div class="hm-row-actions">${p.strategy === 'MOMENTUM' ? `<button class="btn primary" data-goto-mom-strategy="${p.id}" style="background:#ea580c; border-color:#ea580c;">⚡ 모멘텀 전략 제어 ↗</button>` : ''}<button class="btn quiet" data-edit-holding="${p.id}">✎ 진입·규모 수정</button>${p.status === 'OPEN' ? `<button class="btn quiet" data-settings-holding="${p.id}">관리 설정</button><button class="btn quiet" data-add-holding="${p.id}">+ 추가 진입</button><button class="btn quiet" data-close-holding="${p.id}">${p.schema_version === 2 ? '부분·전체 청산' : '종가 청산'}</button>` : ''}</div></td></tr>`
    )
    .join('')}</tbody></table></div>${visible.length ? '' : '<div class="empty">해당 상태의 포지션이 없습니다.</div>'}<div class="book-warning">기준일 종가를 사용하는 관리 알림입니다. 조건을 충족해도 자동 주문·청산은 하지 않습니다.</div></div><div class="panel below"><div class="panel-head"><h2>자산별 현재 순 노출</h2><small>추가 진입·부분 청산 후 잔여 규모</small></div><div class="exposure">${exposure(active)}</div></div>${chosen ? holdingDetail(chosen) : ''}</section>`;

  bindRangeControls(target, () => renderHoldings(target));
  enhanceInteractiveCharts(target);

  $('#manual-position').onclick = () => openHoldingDialog();
  $('#de-steep').onclick = () => openHoldingDialog({ asset_class: 'Rates', leg1: 'EUREX_DU', leg2: 'EUREX_RX' });
  $('#book-alert-filter').value = alertFilter;
  $('#book-alert-filter').onchange = (e) => { alertFilter = e.target.value; renderHoldings(target); };
  document.querySelectorAll('[data-book-filter]').forEach((b) => (b.onclick = () => { bookFilter = b.dataset.bookFilter; renderHoldings(target); }));
  document.querySelectorAll('[data-goto-mom-strategy]').forEach((b) => (b.onclick = () => ctx.setTab('mom_strategy')));
  document.querySelectorAll('[data-holding-id]').forEach((r) => {
    const select = () => { selectedId = r.dataset.holdingId; renderHoldings(target); };
    r.onclick = (e) => { if (!e.target.closest('button')) select(); };
    r.onkeydown = (e) => { if (e.key === 'Enter' && e.target === r) select(); };
  });
  document.querySelectorAll('[data-edit-holding]').forEach((b) => (b.onclick = () => openEditDialog(all.find((p) => p.id === b.dataset.editHolding))));
  document.querySelectorAll('[data-add-holding]').forEach((b) => (b.onclick = () => openAddDialog(all.find((p) => p.id === b.dataset.addHolding))));
  document.querySelectorAll('[data-settings-holding]').forEach((b) => (b.onclick = () => openSettingsDialog(all.find((p) => p.id === b.dataset.settingsHolding))));
  document.querySelectorAll('[data-close-holding]').forEach(
    (b) =>
      (b.onclick = async () => {
        const p = all.find((p) => p.id === b.dataset.closeHolding);
        if (p.schema_version === 2) openCloseDialog(p);
        else if (confirm('현재 기준일 종가로 기존 가상 기록을 청산할까요?')) {
          try {
            await ctx.api('/api/positions', { action: 'close', id: p.id });
            await ctx.onChange();
          } catch (e) {
            ctx.toast(e.message);
          }
        }
      })
  );
  if ($('#save-note'))
    $('#save-note').onclick = async () => {
      try {
        await ctx.api('/api/positions', { action: 'note', id: chosen.id, expected_revision: chosen.revision || 0, notes: $('#holding-note').value });
        await ctx.onChange();
        ctx.toast('메모 변경 이력을 저장했습니다.');
      } catch (e) {
        ctx.toast(e.message);
      }
    };
}

function managementDiff(e, p) {
  if (e.type !== 'SETTINGS' || !e.management_before || !e.management_after) return '';
  const labels = {
    exit_z: '청산 Z',
    stop_z: '손절 Z',
    review_z: '모형 괴리',
    widening_z: '1일 확대',
    hardcap: '금액 손실',
    profit_target: '이익 실현',
    pnl_basis: '손익 기준',
    rv_monitor_enabled: '모형 알림'
  };
  return Object.keys(labels)
    .filter((k) => e.management_before?.[k] !== e.management_after[k])
    .map((k) => {
      const val = (v) => (['hardcap', 'profit_target'].includes(k) ? money(v, currency(p)) : typeof v === 'boolean' ? (v ? '사용' : '중지') : String(v));
      return labels[k] + ' ' + val(e.management_before?.[k]) + ' → ' + val(e.management_after[k]);
    })
    .join(' · ');
}

function modelDetail(p) {
  const m = p.model_monitor;
  if (!m)
    return `<div class="data-info">${p.monitor === 'AWAITING_MARK' ? `마지막 거래 ${esc(p.pending_trade_date || '')} 이후 가격을 기다리고 있습니다.` : '고정모델과 가격을 확인하세요.'}</div>`;
  const metric = (name, value, help = '') => `<div><span>${name}</span><b>${value}</b>${help ? `<small>${help}</small>` : ''}</div>`,
    f = m.model,
    mg = m.management;
  return `<div class="hm-model-head">${monitorBadges(p)}<span>평가 기준일 ${m.as_of} · 현재 Leg 1 ${modelQuote(p, m.current_quote1)} / Leg 2 ${modelQuote(p, m.conditional_quote2)}</span></div><div class="hm-model-grid">${metric('진입 고정모델 Z', sg(p.fixed_z) + ' σ', '진입 시 ' + sg(p.entry_fixed_z) + ' · 전 관측일 |Z| ' + sg(m.fixed_abs_change))}${metric('현재 OOS / Refit Z', sg(p.current_oos_z) + ' / ' + sg(p.current_refit_z), '현재 시점의 재추정 모델과 비교')}${metric('고정·현재 OOS 차이', n(m.gap_abs) + ' σ', '전 관측일 대비 ' + sg(m.gap_change) + ' · 재평가 기준 ' + n(mg.review_z) + 'σ')}${metric('고정모델 청산 레벨 · Leg 1', modelQuote(p, m.exit_quote1), '진입방향 Z ≤ ' + n(mg.exit_z))}${metric('고정모델 손절 레벨 · Leg 1', modelQuote(p, m.stop_quote1), '진입방향 Z ≥ ' + n(mg.stop_z))}${metric('금액 손실 기준까지 여유', p.loss_headroom == null ? '사용 안 함' : money(p.loss_headroom, currency(p)), mg.pnl_basis === 'TOTAL' ? '실현+미실현 손익 기준' : '남은 보유 미실현 기준')}</div><ul class="hm-reasons">${(p.monitor_flags || []).map((flag) => `<li>${esc(flag.reason)}</li>`).join('') || '<li>현재 관리 기준을 충족하는 청산·손절·재평가 알림이 없습니다.</li>'}</ul><div class="data-info">고정 α ${n(f?.alpha, 5)} · β ${n(f?.beta, 5)} · σ ${n(f?.sigma, 5)}${f?.fit_end ? ' · 적합 종료 ' + esc(f.fit_end) : ' · 기존 저장 모형'}.</div>`;
}

function holdingDetail(p) {
  const lots = p.lot_marks || p.lots || [];
  const rangeCtrl = renderRangeControls('holdings-detail', {
    presets: [
      ['1M', '1M'],
      ['3M', '3M'],
      ['6M', '6M'],
      ['YTD', 'YTD'],
      ['1Y', '1Y'],
      ['ALL', '전체']
    ],
    defaultPreset: 'ALL',
    showRebase: true,
    label: '포지션 차트 기간'
  });

  return `<div class="panel below hm-detail" id="holding-detail">
    <div class="panel-head"><div><h2>${esc(p.name)} · 모델·손익·거래 이력</h2><small>${esc(p.strategy || 'MANUAL')}</small></div><div class="control-buttons"><button class="btn quiet" data-edit-holding="${p.id}">✎ 진입 가격·규모 수정</button></div></div>
    ${modelDetail(p)}
    ${rangeCtrl}
    <div class="hm-charts">
      <div><h3>고정모델과 현재 Z-score</h3>${positionZChart(p)}<p class="hm-chart-note">현재 관리 설정의 청산·손절 기준선을 표시합니다.</p></div>
      <div><h3>누적 실현 + 미실현 손익</h3>${pnlChart(p)}<p class="hm-chart-note">${currency(p) === 'KRW' ? '차트 단위 만원' : '차트 단위 USD'} · 거래별 원가와 청산 이력 반영</p></div>
    </div>
    ${p.momentum ? `<div class="data-info">모멘텀 ${p.momentum.model} · 최초 손절 ${momentumLevel(p, p.momentum.initial_stop)} / 현재 채널 ${momentumLevel(p, p.momentum_mark?.channel_exit)}. 고정모델 알림과 별도로 표시합니다.</div>` : ''}
    <div class="panel-head"><h3>거래별 진입 원가와 남은 규모</h3><small>FX 평균 원가는 통화 수량 기준 · 금리는 DV01 가중</small></div>
    <div class="table-scroll"><table id="holding-lots"><thead><tr><th>진입일</th><th>진입 가격 Leg 1 / 2</th><th>최초 규모</th><th>현재 잔여 규모</th><th class="number">미실현 손익</th></tr></thead><tbody>${lots.map((l) => `<tr><td>${l.entry_date}</td><td>${modelQuote(p, l.entry_quote1)}${p.leg2 ? ' / ' + modelQuote(p, l.entry_quote2) : ''}</td><td>${sizeText(p, l.leg1_size, l.leg2_size || 0)}</td><td>${sizeText(p, l.leg1_size * l.remaining_fraction, (l.leg2_size || 0) * l.remaining_fraction)}</td><td class="number">${l.unrealized_pnl != null ? money(l.unrealized_pnl, currency(p)) : '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="data-info">현재 잔여분 평균 원가: ${modelQuote(p, p.average_entry_quote1)}${p.leg2 ? ' / ' + modelQuote(p, p.average_entry_quote2) : ''}.</div>
    <div class="table-scroll"><table class="wide-table" id="holding-events"><thead><tr><th>거래일</th><th>종류</th><th>가격 Leg 1 / 2</th><th>거래 후 잔여 규모</th><th class="number">실현 추정손익</th><th>변경 내용 / 메모</th></tr></thead><tbody>${(p.events || [])
      .map((e) => {
        const lots = e.lots_after,
          a = lots?.reduce((s, l) => s + l.leg1_size * l.remaining_fraction, 0),
          b = lots?.reduce((s, l) => s + (l.leg2_size || 0) * l.remaining_fraction, 0);
        return `<tr><td>${esc(e.trade_date)}</td><td>${esc({ OPEN: '진입', ADD: '규모 확대', EDIT: '진입·규모 수정', PARTIAL_CLOSE: '부분 청산', CLOSE: '전체 청산', SETTINGS: '관리 설정 변경', NOTE: '메모 변경' }[e.type] || e.type)}</td><td>${e.quote1 != null ? n(e.quote1, 5) + (p.leg2 ? ' / ' + n(e.quote2, 5) : '') : '—'}</td><td>${a != null ? sizeText(p, a, b) : e.remaining_fraction != null ? n(e.remaining_fraction * 100, 1) + '%' : '—'}</td><td class="number">${e.realized_pnl != null ? money(e.realized_pnl, currency(p)) : '—'}</td><td class="history-note">${esc(managementDiff(e, p))}${e.notes ? '<br>' + esc(e.notes) : ''}</td></tr>`;
      })
      .join('')}</tbody></table></div>
    <div class="note-editor"><label>포지션 메모<textarea id="holding-note" rows="2" maxlength="1000">${esc(p.notes || '')}</textarea></label><button id="save-note" class="btn">메모 저장</button></div>
  </div>`;
}
