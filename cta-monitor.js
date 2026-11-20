import {
  createEngine,
  evaluate,
  historySeries,
  scenario,
  nearestPortfolioTurn,
  managedHistory,
  performanceStress,
  normalizePolicy,
  POLICY_DEFAULTS,
  normalizeWeights,
  MODEL_IDS,
  ALL_MODEL_IDS,
  MODEL_INFO,
  ENGINE_VERSION,
  RULES,
} from './cta-engine.js';
import {
  renderRangeControls,
  bindRangeControls,
  filterSeriesByRange,
  getChartTheme,
  enhanceInteractiveCharts,
} from './chart-utils.js';

const $ = (root, s) => root.querySelector(s),
  all = (root, s) => [...root.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
const finite = Number.isFinite,
  fmt = (v, n = 1) =>
    finite(v)
      ? v.toLocaleString('en-US', {
          minimumFractionDigits: n,
          maximumFractionDigits: n,
        })
      : '—';
const signed = (v, n = 1) => (finite(v) ? (v > 0 ? '+' : '') + fmt(v, n) : '—');
const tone = (v) =>
  !finite(v)
    ? 'muted'
    : v > 1e-9
    ? 'cm-positive'
    : v < -1e-9
    ? 'cm-negative'
    : 'muted';
const side = (v) =>
  !finite(v) ? '미확정' : Math.abs(v) < 1e-8 ? '중립' : v > 0 ? 'LONG' : 'SHORT';

const initial = {
  tab: 'overview',
  country: 'ALL',
  unit: 'dv01',
  focus: 'TY',
  range: 252,
  model: 'FITD',
  year: 'ALL',
  budget: 10000,
  cost: 1,
  weights: [1, 1, 1],
  policy: { ...POLICY_DEFAULTS },
  flowMove: 10,
  flowUnit: 'bp',
  flowShape: 'gradual',
  flowScope: 'ALL',
  flowCurve: false,
  freezeVol: false,
  sort: 'default',
};

let prefs = { ...initial },
  data = null,
  engine = null,
  report = null,
  key = '',
  active = null,
  context = null,
  loading = null,
  lastFetch = 0,
  error = '',
  flat = null,
  turnCache = new Map();

try {
  const s = JSON.parse(
    localStorage.getItem('fitd-cta-ms-view-v2') ||
      localStorage.getItem('fitd-cta-monitor-view') ||
      'null'
  );
  if (s) {
    for (const k of [
      'tab',
      'country',
      'unit',
      'focus',
      'range',
      'model',
      'year',
      'budget',
      'cost',
      'weights',
      'policy',
      'flowMove',
      'flowUnit',
      'flowShape',
      'flowScope',
      'flowCurve',
      'freezeVol',
      'sort',
    ])
      if (s[k] !== undefined) prefs[k] = s[k];
    normalizeWeights(prefs.weights);
    prefs.policy = normalizePolicy(prefs.policy);
    if (
      !finite(prefs.budget) ||
      prefs.budget <= 0 ||
      prefs.budget > 1e7 ||
      !finite(prefs.cost) ||
      prefs.cost < 0 ||
      prefs.cost > 10
    )
      throw Error();
  }
} catch {
  prefs = { ...initial };
}

const tabs = [
  ['overview', '종합'],
  ['signals', '신호 상세'],
  ['compare', '모델 비교'],
  ['flow', '플로우 시뮬레이터'],
  ['performance', '성과 검증'],
  ['source', '원천·계산'],
];
if (!tabs.some(([id]) => id === prefs.tab)) prefs.tab = 'overview';
const hashTab = location.hash.split('/')[2];
if (tabs.some(([id]) => id === hashTab)) prefs.tab = hashTab;

function save() {
  try {
    localStorage.setItem('fitd-cta-ms-view-v2', JSON.stringify(prefs));
  } catch {}
}

function csv(name, header, rows) {
  const meta = [
    ENGINE_VERSION,
    data?.source_hash,
    JSON.stringify(prefs.policy),
    JSON.stringify(normalizeWeights(prefs.weights)),
  ];
  header = [
    ...header,
    'engine_version',
    'source_hash',
    'risk_policy_json',
    'mix_weights_json',
  ];
  rows = rows.map((row) => [...row, ...meta]);
  const content =
      '\ufeff' +
      [header, ...rows]
        .map((r) => r.map((v) => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(','))
        .join('\r\n'),
    url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function title(t, n = '', extra = '') {
  return `<div class="panel-head"><div><h2>${t}</h2>${
    n ? `<p class="cm-caption">${n}</p>` : ''
  }</div>${extra}</div>`;
}

function legend(lines) {
  return `<div class="cm-legend">${lines
    .map((l) => `<span><i style="background:${l.color}"></i>${esc(l.name)}</span>`)
    .join('')}</div>`;
}

function plot(lines, { unit = '', height = 270 } = {}) {
  const th = getChartTheme();
  const w = typeof window !== 'undefined' && window.innerWidth <= 760 ? 560 : 960,
    h = height,
    p = { l: 90, r: 22, t: 26, b: 35 },
    points = lines.flatMap((l) => l.data).filter((v) => finite(v[1]));
  if (!points.length) return '<div class="empty">표시할 관측이 부족합니다.</div>';
  const dates = [...new Set(lines.flatMap((l) => l.data.map((v) => v[0])))].sort(),
    at = new Map(dates.map((d, i) => [d, i])),
    vals = points.map((p) => p[1]);
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.12;
  lo -= pad;
  hi += pad;
  const X = (d) => p.l + (at.get(d) / Math.max(1, dates.length - 1)) * (w - p.l - p.r),
    Y = (v) => p.t + ((hi - v) / (hi - lo)) * (h - p.t - p.b),
    compact = (v) =>
      Math.abs(v) >= 1e4
        ? new Intl.NumberFormat('en-US', {
            notation: 'compact',
            maximumFractionDigits: 1,
          }).format(v)
        : fmt(v, Math.abs(hi - lo) < 5 ? 2 : 0);

  let s = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
    .map(
      (v) =>
        `<line x1="${p.l}" x2="${w - p.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${
          th.grid
        }"/><text x="${p.l - 12}" y="${Y(v) + 4}" text-anchor="end">${compact(
          v
        )}</text>`
    )
    .join('');

  if (lo < 0 && hi > 0)
    s += `<line x1="${p.l}" x2="${w - p.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="${
      th.zeroLine
    }" stroke-dasharray="4 4"/>`;

  for (const l of lines) {
    let pen = false;
    const path = l.data
      .map((v) => {
        if (!finite(v[1])) {
          pen = false;
          return '';
        }
        const op = pen ? 'L' : 'M';
        pen = true;
        return `${op}${X(v[0]).toFixed(2)},${Y(v[1]).toFixed(2)}`;
      })
      .join(' ');
    s += `<path d="${path}" fill="none" stroke="${l.color}" stroke-width="${
      l.width || 2.2
    }" ${l.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
  }

  for (const d of [dates[0], dates[Math.floor(dates.length / 2)], dates.at(-1)])
    s += `<text x="${X(d)}" y="${h - 9}" text-anchor="${
      d === dates[0] ? 'start' : d === dates.at(-1) ? 'end' : 'middle'
    }">${esc(d)}</text>`;

  s += `<text x="${p.l}" y="16">${esc(unit)}</text>`;

  dates.forEach((d) => {
    const text = lines.flatMap((l) => {
      const v = l.data.find((v) => v[0] === d);
      return v && finite(v[1]) ? [l.name + ': ' + fmt(v[1], 3) + ' ' + unit] : [];
    });
    s += `<rect x="${
      X(d) - Math.max(2, (w - p.l - p.r) / dates.length / 2)
    }" y="${p.t}" width="${Math.max(
      4,
      (w - p.l - p.r) / dates.length
    )}" height="${h - p.t - p.b}" fill="transparent"><title>${esc(
      d + '\n' + text.join('\n')
    )}</title></rect>`;
  });

  return `<svg class="cm-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(
    lines.map((l) => l.name).join(', ') + ' ' + unit
  )}">${s}</svg>`;
}

function recalculate() {
  const next = JSON.stringify([
    data.source_hash,
    prefs.weights,
    prefs.budget,
    prefs.cost,
    prefs.policy,
  ]);
  if (next !== key) {
    report = evaluate(engine, {
      weights: prefs.weights,
      riskBudget: prefs.budget,
      costTicks: prefs.cost,
      policy: prefs.policy,
    });
    flat = scenario(engine, {
      steps: 10,
      move: 0,
      weights: prefs.weights,
      riskBudget: prefs.budget,
      policy: prefs.policy,
    });
    key = next;
    turnCache.clear();
  }
}

function unit() {
  return prefs.unit === 'dv01' ? '추정 USD/bp' : '계약';
}
function convert(v, row) {
  return prefs.unit === 'dv01'
    ? finite(row.sensitivity) && finite(v)
      ? v * row.sensitivity
      : null
    : v;
}
function amount(v, row, n = 1) {
  const x = convert(v, row);
  return `<span class="${tone(x)}">${signed(x, n)}</span>`;
}

function visibleRows() {
  let rows = report.rows.filter(
    (r) => prefs.country === 'ALL' || r.country === prefs.country
  );
  if (prefs.sort === 'delta')
    rows.sort(
      (a, b) =>
        Math.abs(convert(b.models.FITD.delta, b)) -
        Math.abs(convert(a.models.FITD.delta, a))
    );
  if (prefs.sort === 'signal')
    rows.sort((a, b) => Math.abs(b.models.FITD.signal) - Math.abs(a.models.FITD.signal));
  if (prefs.sort === 'disagree')
    rows.sort((a, b) => msAgreement(a) - msAgreement(b));
  return rows;
}

function signal(v) {
  const th = getChartTheme();
  return finite(v)
    ? `<div class="cm-score"><span class="${tone(v)}">${signed(
        v,
        3
      )}</span><span class="cm-score-track"><i style="width:${Math.min(
        100,
        Math.abs(v) * 100
      )}%;background:${v >= 0 ? th.green : th.orange}"></i></span></div>`
    : '—';
}

function header() {
  const stale =
      data.as_of !== data.requested_as_of || report.rows.some((r) => !r.fresh),
    tot = report.totals.FITD;
  return `<div class="cm-heading"><div><div class="cm-kicker">FITD CTA · MS CORE</div><h2>CTA 포지션 <span>미국 · 독일</span></h2><p>MS 다중 기간 추세 · 국가·상관 위험 관리 · 최종 포지션 밴드</p></div><div class="cm-asof"><span class="cm-live">● ${
    stale ? '기준일 확인' : '원천 관측 확인'
  }</span><strong>${esc(
    data.as_of || '미확정'
  )}</strong><small>월물별 선물 · 고정 9상품</small></div></div>
  ${error ? `<div class="momentum-warning">${esc(error)}</div>` : ''}
  ${
    stale
      ? `<div class="momentum-warning">요청 기준일 ${esc(
          data.requested_as_of
        )}과 원천 관측을 확인하세요. 일부 상품이 과거 관측을 표시합니다.</div>`
      : ''
  }
  <div class="cm-nav segmented" role="tablist" aria-label="CTA 분석 화면">${tabs
    .map(
      ([id, name]) =>
        `<button role="tab" data-cm-tab="${id}" aria-selected="${
          prefs.tab === id
        }" class="${prefs.tab === id ? 'on' : ''}">${name}</button>`
    )
    .join('')}</div>
  <div class="panel cm-assumptions"><form id="cm-assumption-form"><label>일간 위험 예산 <span>USD · 손절 한도 아님</span><input id="cm-budget" type="number" min="1" max="10000000" step="any" value="${
    prefs.budget
  }" required></label><label>편도 비용 <span>틱</span><input id="cm-cost" type="number" min="0" max="10" step="0.1" value="${
    prefs.cost
  }" required></label><div class="cm-core-badge"><b>대표 모델 · MS 기반</b><span>기존 MS → 위험 상한 → 포지션 밴드</span></div><button class="btn primary" type="submit">조회 가정 적용</button><details class="cm-policy-settings"><summary>위험 관리 설정</summary><div>${[
    ['countryCap', '국가별 위험 상한', 5, 50],
    ['portfolioCap', '전체 위험 상한', 10, 100],
    ['overlapCap', 'TY·UXY 합산 위험 상한', 2, 20],
    ['buffer', '상품별 거래 밴드', 0, 50],
  ]
    .map(
      ([id, name, min, max]) =>
        `<label>${name}<span>${
          id === 'buffer' ? '상품 위험 배분의 %' : '전체 일간 예산의 %'
        }</span><input id="cm-policy-${id}" type="number" min="${min}" max="${max}" step="0.1" value="${
          prefs.policy[id] * 100
        }"></label>`
    )
    .join(
      ''
    )}</div><p>국가·전체는 상관을 반영한 목표 일간 위험, TY·UXY는 합산 절대 위험입니다. 밴드 후에도 상한을 다시 적용합니다.</p></details></form><p id="cm-form-error" class="cm-error" hidden></p></div>
  <div class="cm-filter-bar"><div class="segmented" aria-label="CTA 국가 필터">${[
    ['ALL', '전체 9상품'],
    ['US', '미국'],
    ['DE', '독일'],
  ]
    .map(
      ([id, name]) =>
        `<button data-cm-country="${id}" class="${
          prefs.country === id ? 'on' : ''
        }">${name}</button>`
    )
    .join('')}</div><div class="segmented" aria-label="포지션 표시 단위">${[
    ['dv01', '추정 DV01'],
    ['contracts', '계약 수'],
  ]
    .map(
      ([id, name]) =>
        `<button data-cm-unit="${id}" class="${
          prefs.unit === id ? 'on' : ''
        }">${name}</button>`
    )
    .join('')}</div><small>표시 필터는 고정 위험 배분을 바꾸지 않습니다.</small></div>
  ${
    prefs.tab === 'overview'
      ? `<div class="cm-stats"><div class="stat"><div class="label">다음 목표 방향</div><div class="num"><span class="cm-positive">${
          tot.longs
        }</span><small>LONG</small> <span class="cm-negative">${
          tot.shorts
        }</span><small>SHORT</small></div><div class="help">MS 기반 · 고정 9상품</div></div><div class="stat"><div class="label">기준일 순민감도 · 추정</div><div class="num ${tone(
          tot.estimatedDV01
        )}">${signed(
          tot.estimatedDV01,
          0
        )}<small>USD/bp</small></div><div class="help">현물 회귀 환산 · CTD DV01 아님</div></div><div class="stat"><div class="label">다음 목표 일간 위험 · 추정</div><div class="num">${fmt(
          tot.estimatedDailyRisk,
          0
        )}<small>USD</small></div><div class="help">조회 상한 ${fmt(
          prefs.budget * prefs.policy.portfolioCap,
          0
        )} USD</div></div><div class="stat"><div class="label">FITD 비용 후 누적 손익</div><div class="num ${tone(
          report.performance.FITD.net
        )}">${signed(
          report.performance.FITD.net,
          0
        )}<small>USD</small></div><div class="help">2022년~기준일 · 현재 조회 가정</div></div></div>`
      : ''
  }`;
}

function overview() {
  const rows = visibleRows();
  return `<div class="panel">${title(
    '포지션과 다음 조정',
    '+는 선물 매수 · −는 선물 매도. 다음 목표는 기준일 종가 신호로 계산합니다.',
    `<div class="cm-table-tools"><select id="cm-sort" aria-label="CTA 정렬"><option value="default">상품 순서</option><option value="delta">조정 절대값</option><option value="signal">신호 절대값</option><option value="disagree">MS 기간 불일치</option></select><button class="btn quiet" id="cm-position-export">포지션 CSV</button></div>`
  )}<div class="table-scroll"><table class="cm-position-table" id="cm-position-table"><thead><tr><th>상품 / 월물</th><th>대표 신호</th><th class="number">기준일 적용 ${unit()}</th><th class="number">다음 목표</th><th class="number">다음 조정</th><th class="number">가격 유지 5세션 후<br>목표 − 현재</th><th>MS 기간 일치</th></tr></thead><tbody>${rows
    .map((r) => {
      const f = flat.find((f) => f.id === r.id),
        v = f?.available ? f.path[4].models.FITD.deltaFromCurrent : null;
      return `<tr class="${
        prefs.focus === r.id ? 'selected' : ''
      }"><td><button class="ust-text-link" data-cm-focus="${r.id}">${esc(
        r.name
      )}</button><small class="cm-contract">${esc(r.contract)} · ${side(
        r.models.FITD.target
      )}</small></td><td data-label="대표 신호">${signal(
        r.models.FITD.signal
      )}</td><td class="number" data-label="기준일 적용 ${unit()}">${amount(
        r.models.FITD.current,
        r
      )}</td><td class="number" data-label="다음 목표 ${unit()}">${amount(
        r.models.FITD.target,
        r
      )}</td><td class="number cm-emphasis" data-label="다음 조정 ${unit()}">${amount(
        r.models.FITD.delta,
        r
      )}</td><td class="number" data-label="가격 유지 5세션 후 목표 − 현재">${amount(
        v,
        r
      )}</td><td data-label="모델 방향 일치"><span class="tag ${
        msAgreement(r) === 6 ? 'primary' : 'shadow'
      }">${msAgreement(r)}/6 ${
        msAgreement(r) === 6 ? '일치' : '혼재'
      }</span></td></tr>`;
    })
    .join(
      ''
    )}</tbody></table></div></div>${riskPanel()}${attributionPanel()}${focusPanel()}`;
}

function focusPanel() {
  const th = getChartTheme();
  const i =
      engine.instruments.find((i) => i.meta.id === prefs.focus) ||
      engine.instruments[0],
    row = report.rows.find((r) => r.id === i.meta.id),
    lines = ['MS', 'MS_RISK', 'FITD'].map((id, idx) => ({
      name: MODEL_INFO[id].name,
      color: [th.green, th.blue, th.purple][idx],
      width: id === 'FITD' ? 3 : 1.7,
      data: filterSeriesByRange(
        modelHistory(i.meta.id, id),
        'cta-mon-focus',
        (h) => h.date,
        '1Y'
      ).map((h) => [h.date, h.target]),
    }));

  const turnKey = JSON.stringify([key, i.meta.id]);
  if (!turnCache.has(turnKey))
    turnCache.set(
      turnKey,
      nearestPortfolioTurn(engine, i.meta.id, {
        weights: prefs.weights,
        riskBudget: prefs.budget,
        policy: prefs.policy,
      })
    );
  const turn = turnCache.get(turnKey);

  const raw = i.meta.history.map((h) => [h[0], h[7]]),
    rateLines = [
      {
        name: i.meta.benchmark,
        color: th.blue,
        data: filterSeriesByRange(raw, 'cta-mon-focus', (h) => h[0], '1Y'),
      },
    ];
  [20, 60, 120].forEach((n) => {
    const values = raw.map((h, k) => {
      const a = raw.slice(Math.max(0, k - n + 1), k + 1);
      return [
        h[0],
        a.length === n && a.every((v) => finite(v[1]))
          ? a.reduce((s, v) => s + v[1], 0) / n
          : null,
      ];
    });
    rateLines.push({
      name: 'MA' + n,
      color: th.maColors[n],
      dash: true,
      data: filterSeriesByRange(values, 'cta-mon-focus', (h) => h[0], '1Y'),
    });
  });

  return `<div class="panel cm-focus">${title(
    esc(i.meta.name) + ' 모델 추이',
    '목표 계약 수 · 시계열 기간 및 시작일~종료일을 자유롭게 조절하세요'
  )}${renderRangeControls('cta-mon-focus', {
    presets: [
      ['1M', '1M'],
      ['3M', '3M'],
      ['6M', '6M'],
      ['YTD', 'YTD'],
      ['1Y', '1Y'],
      ['2Y', '2Y'],
      ['5Y', '5Y'],
      ['ALL', '전체'],
    ],
    defaultPreset: '1Y',
  })}<div class="cm-focus-pills">${engine.instruments
    .map(
      (a) =>
        `<button class="${
          a.meta.id === prefs.focus ? 'on' : ''
        }" data-cm-focus="${a.meta.id}">${a.meta.id}</button>`
    )
    .join('')}</div>${legend(lines)}${plot(lines, {
    unit: '계약 · 연속형 모델값',
  })}<div class="cm-split"><div class="cm-turn"><h3>가까운 목표 방향 전환</h3><p>선택 상품만 금리 충격 · 다른 상품은 가격 유지 · ±50bp 탐색</p>${
    turn.available
      ? turn.hits.length
        ? turn.hits
            .map(
              (t) =>
                `<div><span>기준금리 ${signed(t.moveBp, 0)}bp</span><b>${side(
                  t.target
                )}</b><small>${amount(t.target, row)} ${unit()}</small></div>`
            )
            .join('')
        : '<div class="muted">탐색 범위에서 방향 전환 없음</div>'
      : `<div class="muted">${esc(turn.reason)}</div>`
  }</div><div class="cm-rate-reference"><h3>${esc(
    i.meta.benchmark
  )} 현물 금리 참고</h3>${legend(rateLines)}${plot(rateLines, {
    unit: '%',
    height: 210,
  })}</div></div></div>`;
}

function compare() {
  const weights = normalizeWeights(prefs.weights);
  return `<div class="panel">${title(
    '기준 모형과 단계별 개선 비교',
    'MS 원형을 보존하고 위험 상한·최종 밴드의 영향을 분리합니다.'
  )}<div class="table-scroll"><table class="cm-compare-table" id="cm-compare-table"><thead><tr><th>상품</th>${ALL_MODEL_IDS.map(
    (id) => `<th>${MODEL_INFO[id].name}<small>${unit()}</small></th>`
  ).join('')}</tr></thead><tbody>${visibleRows()
    .map(
      (r) =>
        `<tr><td><button class="ust-text-link" data-cm-focus="${r.id}">${
          r.id
        }</button><small class="cm-contract">${esc(
          r.name
        )}</small></td>${ALL_MODEL_IDS.map(
          (id) =>
            `<td><div class="cm-compare-signal">신호 ${signed(
              r.models[id].signal,
              3
            )}</div><b class="cm-compare-target">${amount(
              r.models[id].target,
              r
            )}</b><small class="cm-contract">${
              id === 'FITD'
                ? r.policy.held
                  ? '밴드 보류 포함'
                  : '최종 목표'
                : id === 'MS_RISK'
                ? '위험 상한 적용'
                : id === 'MS_CAP'
                ? '연구용 · 대표 미반영'
                : '다음 목표'
            }</small></td>`
        ).join('')}</tr>`
    )
    .join('')}</tbody></table></div></div>
  <div class="panel cm-assumptions"><h3>사용자 혼합 · 비교 전용</h3><form id="cm-mix-form"><div class="cm-weight-group">${MODEL_IDS.map(
    (id, j) =>
      `<label>${
        MODEL_INFO[id].name
      }<input id="cm-weight-${id}" type="number" min="0" max="100" step="any" value="${
        prefs.weights[j]
      }"></label>`
  ).join(
    ''
  )}</div><button class="btn" type="submit">혼합 비중 적용</button><button class="btn quiet" id="cm-equal" type="button">동일 가중</button></form><p class="cm-caption">${MODEL_IDS.map(
    (id, j) => MODEL_INFO[id].name + ' ' + fmt(weights[j] * 100, 1) + '%'
  ).join(' · ')}</p><p id="cm-mix-error" class="cm-error" hidden></p></div>
  <div class="cm-model-cards">${['MS', 'MS_RISK', 'FITD']
    .map(
      (id) =>
        `<article class="panel"><i style="background:${
          MODEL_INFO[id].color
        }"></i><h3>${MODEL_INFO[id].name}</h3><p>${
          MODEL_INFO[id].description
        }</p></article>`
    )
    .join('')}</div>${focusPanel()}`;
}

function flow() {
  const th = getChartTheme();
  const paths = scenario(engine, {
      steps: 10,
      move: prefs.flowMove,
      unit: prefs.flowUnit,
      shape: prefs.flowShape,
      scope: prefs.flowScope,
      curve: prefs.flowCurve,
      freezeVol: prefs.freezeVol,
      weights: prefs.weights,
      riskBudget: prefs.budget,
      policy: prefs.policy,
    }),
    baselinePaths = prefs.freezeVol
      ? scenario(engine, {
          steps: 10,
          move: 0,
          weights: prefs.weights,
          riskBudget: prefs.budget,
          policy: prefs.policy,
          freezeVol: true,
        })
      : flat,
    selected = paths.find((p) => p.id === prefs.focus),
    row = report.rows.find((r) => r.id === prefs.focus),
    model = prefs.model;
  const chart = selected?.available
    ? [
        {
          name: '종가 이후 다음 목표',
          color: th.blue,
          data: [
            ['D+0', convert(selected.knownNext[model], row)],
            ...selected.path.map((p) => [
              'D+' + String(p.step).padStart(2, '0'),
              convert(p.models[model].closeTarget, row),
            ]),
          ],
        },
        {
          name: '해당 세션 시가 적용',
          color: th.orange,
          dash: true,
          data: [
            ['D+0', convert(selected.current[model], row)],
            ...selected.path.map((p) => [
              'D+' + String(p.step).padStart(2, '0'),
              convert(p.models[model].applied, row),
            ]),
          ],
        },
      ]
    : [];
  return `<div class="panel">${title(
    '금리 경로별 예상 매매',
    '기준일 이후 10세션 가정 · 동일 MS·위험·밴드 엔진으로 계산'
  )}<form id="cm-flow-form" class="cm-flow-form"><label>충격 단위<select id="cm-flow-unit"><option value="bp">기준금리 bp</option><option value="sigma">선물 가격 σ</option></select></label><label>10세션 후 변화<input id="cm-flow-move" type="number" min="-100" max="100" step="0.5" value="${
    prefs.flowMove
  }"></label><label>경로<select id="cm-flow-shape"><option value="gradual">10세션 동안 점진 이동</option><option value="jump">첫 세션 충격 후 유지</option></select></label><label>금리 곡선<select id="cm-flow-profile"><option value="parallel">동일 bp 이동</option><option value="curve">2s10s 스팁·플랫</option></select></label><label>충격 범위<select id="cm-flow-scope"><option value="ALL">미국·독일 전체</option><option value="US">미국만</option><option value="DE">독일만</option></select></label><label>모델<select id="cm-model">${ALL_MODEL_IDS.map(
    (id) => `<option value="${id}">${MODEL_INFO[id].name}</option>`
  ).join('')}</select></label><label class="cm-check"><input type="checkbox" id="cm-freeze" ${
    prefs.freezeVol ? 'checked' : ''
  }>변동성·상관 동결</label><button class="btn primary" type="submit">시나리오 계산</button></form><div class="cm-presets">${[
    -20, -10, -5, 0, 5, 10, 20,
  ]
    .map(
      (v) =>
        `<button data-cm-shock="${v}" class="${
          prefs.flowUnit === 'bp' && prefs.flowMove === v ? 'on' : ''
        }">${v === 0 ? '가격 유지' : signed(v, 0) + 'bp'}</button>`
    )
    .join(
      ''
    )}</div><div class="table-scroll"><table id="cm-flow-table"><thead><tr><th>상품</th><th class="number">기준일 적용 ${unit()}</th><th class="number">기준일 다음 조정</th><th class="number">1세션 후 목표 − 현재</th><th class="number">5세션 후 목표 − 현재</th><th class="number">10세션 후 목표 − 현재</th><th class="number">가격 유지 대비<br>10세션 추가 변화</th></tr></thead><tbody>${visibleRows()
    .map((r) => {
      const p = paths.find((p) => p.id === r.id),
        baseline = baselinePaths.find((p) => p.id === r.id);
      return `<tr><td><button class="ust-text-link" data-cm-focus="${r.id}">${
        r.id
      }</button></td>${
        p?.available
          ? `<td class="number">${amount(
              p.current[model],
              r
            )}</td><td class="number">${amount(
              p.knownNext[model] - p.current[model],
              r
            )}</td>${[0, 4, 9]
              .map(
                (n) =>
                  `<td class="number">${amount(
                    p.path[n].models[model].deltaFromCurrent,
                    r
                  )}</td>`
              )
              .join('')}<td class="number">${amount(
              baseline?.available
                ? p.path[9].models[model].closeTarget -
                    baseline.path[9].models[model].closeTarget
                : null,
              r
            )}</td>`
          : `<td colspan="6" class="muted">${esc(
              p?.reason || '모델 미확정'
            )}</td>`
      }</tr>`;
    })
    .join(
      ''
    )}</tbody></table></div><div class="cm-flow-export"><button class="btn quiet" id="cm-flow-export">시나리오 CSV</button></div></div><div class="panel">${title(
    esc(row?.name || '') + ' 경로별 포지션',
    `${MODEL_INFO[model].name} · ${unit()}`
  )}<div class="cm-focus-pills">${engine.instruments
    .map(
      (i) =>
        `<button data-cm-focus="${i.meta.id}" class="${
          prefs.focus === i.meta.id ? 'on' : ''
        }">${i.meta.id}</button>`
    )
    .join('')}</div>${legend(chart)}${plot(chart, {
    unit: unit(),
  })}${scenarioAttribution(paths, prefs.model)}</div>`;
}

function periodDaily(perf) {
  const byYear =
    prefs.year === 'ALL'
      ? perf.daily
      : perf.daily.filter((d) => d.date.startsWith(prefs.year));
  const d = filterSeriesByRange(
    byYear,
    'cta-mon-perf',
    (r) => r.date,
    'ALL'
  );
  let c = 0,
    peak = 0;
  return d.map((r) => {
    c += r.net;
    peak = Math.max(peak, c);
    return { ...r, cumulative: c, drawdown: peak - c };
  });
}

function performancePanel() {
  const th = getChartTheme();
  const model = MODEL_INFO[prefs.model] ? prefs.model : 'FITD',
    p = report.performance[model],
    years = p.annual.map((y) => y.year);
  if (prefs.year !== 'ALL' && !years.includes(prefs.year)) prefs.year = 'ALL';
  const d = periodDaily(p),
    total = d.reduce((s, d) => s + d.net, 0),
    cost = d.reduce((s, d) => s + d.cost, 0),
    mdd = Math.max(0, ...d.map((d) => d.drawdown));
  const colorMap = {
    MS: th.green,
    MS_RISK: th.blue,
    FITD: th.purple,
    MOP: th.orange,
    BAZ: th.blue,
    MIX: th.slate,
    MS_CAP: th.gold,
  };
  const lines = [...new Set(['MS', 'MS_RISK', 'FITD', model])].map((id) => ({
    name: MODEL_INFO[id].name,
    color: colorMap[id] || th.blue,
    width: id === 'FITD' ? 2.8 : 1.7,
    data: periodDaily(report.performance[id]).map((d) => [d.date, d.cumulative]),
  }));
  return `<div class="panel">${title(
    '2022년 이후 선물 모델 성과',
    '선택 기간 및 시작일~종료일을 지정하면 해당 기간 누적 손익과 MDD가 재계산됩니다'
  )}${renderRangeControls('cta-mon-perf', {
    presets: [
      ['3M', '3M'],
      ['6M', '6M'],
      ['YTD', 'YTD'],
      ['1Y', '1Y'],
      ['2Y', '2Y'],
      ['2023~', '2023년~'],
      ['ALL', '전체'],
    ],
    defaultPreset: 'ALL',
  })}<div class="cm-performance-controls"><label>상세 모델<select id="cm-perf-model">${ALL_MODEL_IDS.map(
    (id) => `<option value="${id}">${MODEL_INFO[id].name}</option>`
  ).join('')}</select></label><label>연도 필터<select id="cm-year"><option value="ALL">전체 기간</option>${years
    .map((y) => `<option value="${y}">${y}년</option>`)
    .join(
      ''
    )}</select></label><button class="btn quiet" id="cm-pnl-export">선택 기간 일별 CSV</button><button class="btn quiet" id="cm-annual-export">연도·상품별 CSV</button></div><div class="cm-performance-stats"><div><small>선택 기간 순손익</small><b class="${tone(
    total
  )}">${signed(total, 0)} <span>USD</span></b></div><div><small>선택 기간 최대 낙폭</small><b class="red">${fmt(
    mdd,
    0
  )} <span>USD</span></b></div><div><small>편도 ${fmt(
    prefs.cost,
    1
  )}틱 비용</small><b>${fmt(
    cost,
    0
  )} <span>USD</span></b></div></div>${legend(lines)}${plot(lines, {
    unit: '누적 순손익 USD',
    height: 300,
  })}</div><div class="cm-split cm-performance-tables"><div class="panel">${title(
    MODEL_INFO[model].name + ' 연도별 성과',
    '2026년은 원천 기준일까지'
  )}<div class="table-scroll"><table id="cm-annual-table"><thead><tr><th>연도</th><th class="number">순손익 USD</th><th class="number">비용 USD</th><th class="number">연내 MDD USD</th></tr></thead><tbody>${p.annual
    .map(
      (y) =>
        `<tr><td>${y.year}</td><td class="number ${tone(y.net)}">${signed(
          y.net,
          0
        )}</td><td class="number">${fmt(y.cost, 0)}</td><td class="number">${fmt(
          y.mdd,
          0
        )}</td></tr>`
    )
    .join('')}</tbody></table></div></div><div class="panel">${title(
    '모델별 전체 성과 비교',
    '고정 9상품 · 동일 예산'
  )}<div class="table-scroll"><table><thead><tr><th>모델</th><th class="number">순손익 USD</th><th class="number">MDD USD</th></tr></thead><tbody>${ALL_MODEL_IDS.map(
    (id) =>
      `<tr><td>${MODEL_INFO[id].name}</td><td class="number ${tone(
        report.performance[id].net
      )}">${signed(report.performance[id].net, 0)}</td><td class="number">${fmt(
        report.performance[id].mdd,
        0
      )}</td></tr>`
  ).join('')}</tbody></table></div></div></div><div class="panel">${title(
    MODEL_INFO[model].name + ' 상품별·연도별 순손익',
    'USD · 각 상품의 고정 위험 배분 유지'
  )}<div class="table-scroll"><table id="cm-asset-annual"><thead><tr><th>상품</th>${years
    .map((y) => `<th class="number">${y}</th>`)
    .join('')}<th class="number">합계</th></tr></thead><tbody>${visibleRows()
    .map(
      (r) =>
        `<tr><td>${r.id}<small class="cm-contract">${esc(
          r.name
        )}</small></td>${p.annual
          .map(
            (y) =>
              `<td class="number ${tone(y.assets[r.id] || 0)}">${signed(
                y.assets[r.id] || 0,
                0
              )}</td>`
          )
          .join('')}<td class="number ${tone(p.assets[r.id] || 0)}">${signed(
          p.assets[r.id] || 0,
          0
        )}</td></tr>`
    )
    .join('')}</tbody></table></div></div>${validationPanel()}${sensitivityPanel()}`;
}

function sourcePanel() {
  return `<div class="panel">${title(
    '선물 원천과 민감도 검증',
    '실제 월물 OHLC · 금리 보간과 선물 종가 전일값 대체 없음'
  )}<div class="table-scroll"><table id="cm-source-table"><thead><tr><th>상품 / 월물</th><th>관측기간</th><th class="number">관측수 / 롤</th><th class="number">포인트 가치</th><th class="number">추정 USD/bp<br>계약당</th><th class="number">회귀 R²</th><th>검증</th></tr></thead><tbody>${engine.instruments
    .filter((i) => prefs.country === 'ALL' || i.meta.country === prefs.country)
    .map(
      ({ meta: m }) =>
        `<tr><td>${m.id}<small class="cm-contract">${esc(
          m.contract
        )}</small></td><td>${m.quality.first}<small class="cm-contract">~ ${
          m.quality.last
        }</small></td><td class="number">${m.quality.observations} / ${
          m.quality.rolls
        }</td><td class="number">${fmt(m.point_value, 0)} ${
          m.currency
        }</td><td class="number">${fmt(
          m.sensitivity?.usd_per_bp_per_contract,
          2
        )}</td><td class="number">${fmt(
          m.sensitivity?.r_squared,
          3
        )}</td><td><span class="tag ${
          m.available && m.quality.fresh ? 'primary' : 'block'
        }">${
          m.available && m.quality.fresh ? '관측·단위 확인' : '확인 필요'
        }</span>${m.quality.issues
          .map((s) => `<small class="cm-contract">${esc(s)}</small>`)
          .join('')}</td></tr>`
    )
    .join('')}</tbody></table></div></div>${rollPanel()}`;
}

function msAgreement(row) {
  const a = row.ms?.corrected || [];
  return Math.max(
    a.filter((v) => v > 0).length,
    a.filter((v) => v < 0).length
  );
}

function modelHistory(core, id) {
  return ['FITD', 'MS_RISK'].includes(id)
    ? managedHistory(engine, core, id, prefs.policy, prefs.budget)
    : historySeries(
        engine,
        core,
        id === 'MIX' ? 'FITD' : id,
        prefs.weights,
        prefs.budget
      );
}

function riskPanel() {
  const p = report.policy,
    stats = report.policyStats;
  return `<div class="panel cm-risk-panel">${title(
    '다음 목표 위험과 정책 상한',
    '추정 일간 손익 변동성 · 상한은 다음 목표 기준'
  )}<div class="table-scroll"><table id="cm-risk-table"><thead><tr><th>위험 묶음</th><th class="number">MS 원형 USD</th><th class="number">FITD 목표 USD</th><th class="number">상한 USD</th></tr></thead><tbody>${[
    ['US', '미국', p.countryCap],
    ['DE', '독일', p.countryCap],
    ['total', '전체 · 상관 반영', p.portfolioCap],
    ['overlap', 'TY·UXY · 절대 위험 합', p.overlapCap],
  ]
    .map(
      ([id, name, cap]) =>
        `<tr><td>${name}</td><td class="number">${fmt(
          report.risk.raw[id],
          0
        )}</td><td class="number">${fmt(
          report.risk.current[id],
          0
        )}</td><td class="number">${fmt(prefs.budget * cap, 0)}</td></tr>`
    )
    .join('')}</tbody></table></div><p class="ust-footnote">현재 적용 상한: ${
    report.risk.flags.length
      ? esc(report.risk.flags.join(' · '))
      : '상한 축소 없음'
  }. 2022년 이후 ${stats.observations}개 정책 관측일 중 상한 적용 ${
    stats.riskDays
  }일 · 밴드 보류 ${stats.bufferDays}일.</p></div>`;
}

function attributionPanel() {
  return `<div class="panel">${title(
    '다음 조정은 왜 발생했나',
    '상품별 마지막 실제 시가 적용 → 현재 다음 목표 · 고정 순서의 합산 분해입니다.'
  )}<div class="table-scroll"><table id="cm-attribution-table"><thead><tr><th>상품</th><th class="number">추세 신호</th><th class="number">변동성</th><th class="number">위험 상한</th><th class="number">밴드·이월</th><th class="number">합계 ${unit()}</th></tr></thead><tbody>${visibleRows()
    .map(
      (r) =>
        `<tr><td>${r.id}</td>${['signal', 'volatility', 'risk', 'band', 'net']
          .map((k) => `<td class="number">${amount(r.attribution[k], r)}</td>`)
          .join('')}</tr>`
    )
    .join('')}</tbody></table></div></div>`;
}

function signalsPanel() {
  const th = getChartTheme();
  const i =
      engine.instruments.find((i) => i.meta.id === prefs.focus) ||
      engine.instruments[0],
    f = i.frames.at(-1),
    rows = f.ms;
  const slicedFrames = filterSeriesByRange(
    i.frames,
    'cta-mon-focus',
    (fr) => fr.date,
    '1Y'
  );
  const lines = [0, 1, 2].map((g) => ({
    name: ['빠른 조합 21·42', '중간 조합 63·84', '느린 조합 105·126'][g],
    color: [th.orange, th.blue, th.green][g],
    data: slicedFrames.map((f) => [f.date, f.ms.groups[g]]),
  }));
  lines.push({
    name: 'MS 최종 · 평활 후',
    color: th.purple,
    width: 3,
    data: slicedFrames.map((f) => [f.date, f.signals.MS]),
  });

  return `<div class="panel">${title(
    esc(i.meta.name) + ' · 여섯 기간 신호',
    '모든 빠른 EWMA 반감기는 5일입니다.'
  )}<div class="cm-focus-pills">${engine.instruments
    .map(
      (a) =>
        `<button data-cm-focus="${a.meta.id}" class="${
          a.meta.id === i.meta.id ? 'on' : ''
        }">${a.meta.id}</button>`
    )
    .join(
      ''
    )}</div><div class="table-scroll"><table id="cm-signal-table"><thead><tr><th>기간 묶음</th><th>느린 반감기</th><th class="number">보정 전 표준화 값</th><th class="number">기존 과열 보정 후</th><th class="number">포화 함수 · 연구</th><th>방향</th></tr></thead><tbody>${RULES.msSlow
    .map(
      (n, j) =>
        `<tr><td>${
          ['빠른', '중간', '느린'][Math.floor(j / 2)]
        }</td><td>${n}일</td><td class="number">${signed(
          rows.rawZ[j],
          3
        )}</td><td class="number">${signal(
          rows.corrected[j]
        )}</td><td class="number">${signed(rows.cap[j], 3)}</td><td>${side(
          rows.corrected[j]
        )}</td></tr>`
    )
    .join('')}</tbody></table></div></div><div class="panel">${title(
    '속도별 방향과 충돌',
    '각 묶음은 2개 보정 신호 평균 · 최종 MS만 반감기 3 평활 적용'
  )}${renderRangeControls('cta-mon-focus', {
    presets: [
      ['1M', '1M'],
      ['3M', '3M'],
      ['6M', '6M'],
      ['YTD', 'YTD'],
      ['1Y', '1Y'],
      ['2Y', '2Y'],
      ['5Y', '5Y'],
      ['ALL', '전체'],
    ],
    defaultPreset: '1Y',
  })}${legend(lines)}${plot(lines, { unit: '추세 신호' })}</div>`;
}

function scenarioAttribution(paths, model) {
  if (!['FITD', 'MS_RISK'].includes(model)) return '';
  return `<div class="cm-flow-attribution">${title(
    '10세션 동안 조정의 원인',
    '기준일 다음 목표 → D+10 종가 목표'
  )}<div class="table-scroll"><table id="cm-flow-attribution"><thead><tr><th>상품</th><th class="number">추세</th><th class="number">변동성</th><th class="number">위험</th><th class="number">밴드·이월</th><th class="number">합계 ${unit()}</th></tr></thead><tbody>${visibleRows()
    .map((r) => {
      const p = paths.find((p) => p.id === r.id);
      return `<tr><td>${r.id}</td>${[
        'signal',
        'volatility',
        'risk',
        'band',
        'net',
      ]
        .map(
          (k) =>
            `<td class="number">${amount(
              p?.available
                ? p.path.reduce(
                    (s, d) => s + (d.models[model].attribution?.[k] || 0),
                    0
                  )
                : null,
              r
            )}</td>`
        )
        .join('')}</tr>`;
    })
    .join('')}</tbody></table></div></div>`;
}

function resultNote() {
  const a = report.performance.MS,
    b = report.performance.FITD,
    exA = performanceStress(a, 1, '2023-01-01').net,
    exB = performanceStress(b, 1, '2023-01-01').net;
  return `<p class="cm-result-note">기존 MS 대비 비용 ${signed(
    (b.cost / a.cost - 1) * 100,
    1
  )}% · 최대 낙폭 ${signed(
    (b.mdd / a.mdd - 1) * 100,
    1
  )}% · 누적 순손익 차이 ${signed(
    b.net - a.net,
    0
  )} USD. 2023년 이후 손익은 ${exB >= exA ? '개선되었습니다' : '개선되지 않았습니다'}.</p>`;
}

function validationPanel() {
  const ids = ['MS', 'MS_RISK', 'FITD'];
  return `<div class="panel cm-validation">${title(
    '개선 효과와 비용 스트레스',
    '2022년 제외 성과·낙폭·비용을 함께 비교합니다.'
  )}${resultNote()}<div class="table-scroll"><table id="cm-validation-table"><thead><tr><th>모델</th><th class="number">2023년 이후 순손익</th><th class="number">전체 MDD</th><th class="number">비용 2배 순손익</th><th class="number">비용 3배 순손익</th><th class="number">비용 3배 MDD</th></tr></thead><tbody>${ids
    .map((id) => {
      const p = report.performance[id],
        ex = performanceStress(p, 1, '2023-01-01'),
        x2 = performanceStress(p, 2),
        x3 = performanceStress(p, 3);
      return `<tr><td>${MODEL_INFO[id].name}</td><td class="number ${tone(
        ex.net
      )}">${signed(ex.net, 0)}</td><td class="number">${fmt(
        p.mdd,
        0
      )}</td><td class="number ${tone(x2.net)}">${signed(
        x2.net,
        0
      )}</td><td class="number ${tone(x3.net)}">${signed(
        x3.net,
        0
      )}</td><td class="number">${fmt(x3.mdd, 0)}</td></tr>`;
    })
    .join('')}</tbody></table></div></div>`;
}

function sensitivityPanel() {
  const cases = data.reference?.sensitivity;
  if (!cases?.length) return '';
  return `<div class="panel">${title(
    '정책 주변값 민감도',
    '수집기 기본 프로필: 일간 USD10,000·편도1틱'
  )}<div class="table-scroll"><table id="cm-sensitivity-table"><thead><tr><th>변경 항목</th><th class="number">누적 순손익 USD</th><th class="number">MDD USD</th><th class="number">비용 USD</th><th class="number">2023년 이후 순손익</th></tr></thead><tbody>${cases
    .map(
      (c) =>
        `<tr><td>${esc(c.name)}</td><td class="number ${tone(c.net)}">${signed(
          c.net,
          0
        )}</td><td class="number">${fmt(c.mdd, 0)}</td><td class="number">${fmt(
          c.cost,
          0
        )}</td><td class="number ${tone(c.net2023on)}">${signed(
          c.net2023on,
          0
        )}</td></tr>`
    )
    .join('')}</tbody></table></div></div>`;
}

function rollPanel() {
  return `<div class="panel">${title(
    '월물 교체 내역 · FITD 기준',
    '실제 최근 롤일의 청산·진입 계약 수와 비용'
  )}<div class="table-scroll"><table id="cm-roll-table"><thead><tr><th>상품 / 롤일</th><th>구월물 → 신월물</th><th class="number">제거한 시가 차이</th><th class="number">구월물 청산</th><th class="number">신월물 진입</th><th class="number">총 거래 계약</th><th class="number">비용 USD</th></tr></thead><tbody>${engine.instruments
    .filter((i) => prefs.country === 'ALL' || i.meta.country === prefs.country)
    .map((i) => {
      const log = i.meta.roll_log?.at(-1),
        p = log
          ? report.performance.FITD.daily.find((d) => d.date === log.date)?.assets[
              i.meta.id
            ]
          : null;
      return `<tr><td>${i.meta.id}<small class="cm-contract">${esc(
        log?.date || '기록 없음'
      )}</small></td><td>${esc(log?.from || '—')} → ${esc(
        log?.to || '—'
      )}</td><td class="number">${signed(
        log?.open_gap_removed,
        3
      )}</td><td class="number">${signed(
        p?.closeContracts,
        2
      )}</td><td class="number">${signed(
        p?.openContracts,
        2
      )}</td><td class="number">${fmt(
        p?.turnover,
        2
      )}</td><td class="number">${fmt(p?.cost, 2)}</td></tr>`;
    })
    .join('')}</tbody></table></div></div>`;
}

function draw() {
  if (!active?.isConnected) return;
  if (!data || !engine) {
    active.innerHTML = `<div class="panel"><div class="empty"><h2>${
      loading ? '선물 기반 CTA를 불러오고 있습니다' : '선물 기반 CTA 데이터 준비'
    }</h2><p>${esc(
      error || '수집기에서 월물 연결과 모델 계산을 마치면 표시됩니다.'
    )}</p><button class="btn" id="cm-retry">다시 조회</button></div></div>`;
    const b = $(active, '#cm-retry');
    if (b) b.onclick = () => fetchData(true);
    return;
  }
  try {
    recalculate();
    active.innerHTML = `<section class="cm-root" id="cta-monitor">${header()}${(
      {
        overview,
        signals: signalsPanel,
        compare,
        flow,
        performance: performancePanel,
        source: sourcePanel,
      }[prefs.tab]
    )()}<p class="cm-footer">FITD MS 기반 연구 모델 · 실제 보유 기록과 별개 · 고정 9상품 · 선물 가격 기반 · <button class="ust-text-link" id="cm-legacy">기존 금리 대용 CTA 전략 보기</button></p></section>`;
    bind();
    bindRangeControls(active, () => draw());
    enhanceInteractiveCharts(active);
  } catch (e) {
    active.innerHTML = `<div class="panel"><div class="empty">계산을 확인해야 합니다: ${esc(
      e.message
    )} <button id="cm-reset" class="btn">조회 가정 초기화</button></div></div>`;
    $(active, '#cm-reset').onclick = () => {
      prefs = { ...initial };
      key = '';
      save();
      draw();
    };
  }
}

async function fetchData(force = false) {
  if (loading) return loading;
  const desiredMode = context?.getState?.()?.data_mode || 'close';
  const modeChanged = data && data.data_mode !== desiredMode;
  if (!force && !modeChanged && data && Date.now() - lastFetch < 29000) return;
  loading = (async () => {
    let changed = false;
    try {
      const d = await context.api(
        '/api/cta-monitor' +
          (data && !force && !modeChanged ? '?since=' + encodeURIComponent(data.updated_at) : '')
      );
      lastFetch = Date.now();
      const issue = d.last_error?.error || '';
      if (issue !== error) {
        error = issue;
        changed = true;
      }
      if (d.waiting) {
        error = issue || '선물 기반 계산 결과를 기다리고 있습니다.';
        changed = true;
      } else if (!d.unchanged) {
        if (d.error || !d.instruments) {
          error = d.error || '원천 검증 결과를 준비하고 있습니다.';
          changed = true;
        } else {
          const next = createEngine(d);
          data = d;
          engine = next;
          key = '';
          error = issue;
          changed = true;
          if (!data.instruments.some((i) => i.id === prefs.focus))
            prefs.focus = 'TY';
        }
      }
    } catch (e) {
      error = e.message;
      changed = true;
      context.toast('CTA 조회: ' + e.message);
    } finally {
      loading = null;
      if (changed || !engine) draw();
    }
  })();
  if (!data) draw();
  return loading;
}

function bind() {
  const root = active;
  all(root, '[data-cm-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        prefs.tab = b.dataset.cmTab;
        history.replaceState(null, '', '#treasury/cta-monitor/' + prefs.tab);
        save();
        draw();
      })
  );
  all(root, '[data-cm-country]').forEach(
    (b) =>
      (b.onclick = () => {
        prefs.country = b.dataset.cmCountry;
        save();
        draw();
      })
  );
  all(root, '[data-cm-unit]').forEach(
    (b) =>
      (b.onclick = () => {
        prefs.unit = b.dataset.cmUnit;
        save();
        draw();
      })
  );
  all(root, '[data-cm-focus]').forEach(
    (b) =>
      (b.onclick = () => {
        prefs.focus = b.dataset.cmFocus;
        save();
        draw();
      })
  );
  $(root, '#cm-assumption-form').onsubmit = (e) => {
    e.preventDefault();
    try {
      const budget = +$(root, '#cm-budget').value,
        cost = +$(root, '#cm-cost').value,
        policy = normalizePolicy({
          ...prefs.policy,
          ...Object.fromEntries(
            ['countryCap', 'portfolioCap', 'overlapCap', 'buffer'].map((k) => [
              k,
              +$(root, '#cm-policy-' + k).value / 100,
            ])
          ),
        });
      evaluate(engine, {
        weights: prefs.weights,
        riskBudget: budget,
        costTicks: cost,
        policy,
        includePerformance: false,
      });
      prefs.budget = budget;
      prefs.cost = cost;
      prefs.policy = policy;
      save();
      draw();
    } catch (err) {
      const n = $(root, '#cm-form-error');
      n.hidden = false;
      n.textContent = err.message;
    }
  };
  if ($(root, '#cm-mix-form')) {
    $(root, '#cm-mix-form').onsubmit = (e) => {
      e.preventDefault();
      try {
        const weights = MODEL_IDS.map((id) => +$(root, '#cm-weight-' + id).value);
        normalizeWeights(weights);
        prefs.weights = weights;
        save();
        draw();
      } catch (err) {
        const n = $(root, '#cm-mix-error');
        n.hidden = false;
        n.textContent = err.message;
      }
    };
    $(root, '#cm-equal').onclick = () => {
      prefs.weights = [1, 1, 1];
      save();
      draw();
    };
  }
  $(root, '#cm-legacy').onclick = () => context.legacy();
  if ($(root, '#cm-sort')) {
    $(root, '#cm-sort').value = prefs.sort;
    $(root, '#cm-sort').onchange = (e) => {
      prefs.sort = e.target.value;
      save();
      draw();
    };
  }
  if ($(root, '#cm-position-export'))
    $(root, '#cm-position-export').onclick = () =>
      csv(
        `FITD-CTA-futures-${data.as_of}.csv`,
        [
          'as_of',
          'core',
          'contract',
          'model',
          'signal',
          'current_contracts',
          'next_contracts',
          'change_contracts',
          'estimated_USD_DV01_current',
          'risk_budget_USD',
          'one_way_cost_ticks',
        ],
        visibleRows().flatMap((r) =>
          ALL_MODEL_IDS.map((id) => [
            data.as_of,
            r.id,
            r.contract,
            id,
            r.models[id].signal,
            r.models[id].current,
            r.models[id].target,
            r.models[id].delta,
            finite(r.sensitivity) ? r.sensitivity * r.models[id].current : null,
            prefs.budget,
            prefs.cost,
          ])
        )
      );
  if ($(root, '#cm-flow-form')) {
    for (const [id, value] of [
      ['cm-flow-unit', prefs.flowUnit],
      ['cm-flow-shape', prefs.flowShape],
      ['cm-flow-scope', prefs.flowScope],
      ['cm-flow-profile', prefs.flowCurve ? 'curve' : 'parallel'],
      ['cm-model', prefs.model],
    ])
      $(root, '#' + id).value = value;
    $(root, '#cm-flow-form').onsubmit = (e) => {
      e.preventDefault();
      const move = +$(root, '#cm-flow-move').value;
      if (!finite(move) || Math.abs(move) > 100) return;
      Object.assign(prefs, {
        flowMove: move,
        flowUnit: $(root, '#cm-flow-unit').value,
        flowShape: $(root, '#cm-flow-shape').value,
        flowScope: $(root, '#cm-flow-scope').value,
        flowCurve: $(root, '#cm-flow-profile').value === 'curve',
        model: $(root, '#cm-model').value,
        freezeVol: $(root, '#cm-freeze').checked,
      });
      save();
      draw();
    };
    all(root, '[data-cm-shock]').forEach(
      (b) =>
        (b.onclick = () => {
          prefs.flowMove = +b.dataset.cmShock;
          prefs.flowUnit = 'bp';
          save();
          draw();
        })
    );
  }
  if ($(root, '#cm-perf-model')) {
    $(root, '#cm-perf-model').value = prefs.model;
    $(root, '#cm-perf-model').onchange = (e) => {
      prefs.model = e.target.value;
      save();
      draw();
    };
    $(root, '#cm-year').value = prefs.year;
    $(root, '#cm-year').onchange = (e) => {
      prefs.year = e.target.value;
      save();
      draw();
    };
    $(root, '#cm-pnl-export').onclick = () =>
      csv(
        `FITD-CTA-daily-${prefs.model}-${prefs.year}.csv`,
        [
          'date',
          'model',
          'gross_USD',
          'cost_USD',
          'net_USD',
          'cumulative_USD',
          'drawdown_USD',
          'risk_budget_USD',
          'one_way_cost_ticks',
          ...engine.instruments.map((i) => i.meta.id + '_net_USD'),
        ],
        periodDaily(report.performance[prefs.model]).map((d) => [
          d.date,
          prefs.model,
          d.gross,
          d.cost,
          d.net,
          d.cumulative,
          d.drawdown,
          prefs.budget,
          prefs.cost,
          ...engine.instruments.map((i) => d.assets[i.meta.id]?.net || 0),
        ])
      );
    $(root, '#cm-annual-export').onclick = () =>
      csv(
        `FITD-CTA-annual-${data.as_of}.csv`,
        [
          'year',
          'model',
          'net_USD',
          'gross_USD',
          'cost_USD',
          'year_MDD_USD',
          'risk_budget_USD',
          'one_way_cost_ticks',
          ...engine.instruments.map((i) => i.meta.id + '_net_USD'),
        ],
        ALL_MODEL_IDS.flatMap((id) =>
          report.performance[id].annual.map((y) => [
            y.year,
            id,
            y.net,
            y.gross,
            y.cost,
            y.mdd,
            prefs.budget,
            prefs.cost,
            ...engine.instruments.map((i) => y.assets[i.meta.id] || 0),
          ])
        )
      );
  }
}

export function renderCtaMonitor(container, o) {
  active = container;
  context = o;
  draw();
  fetchData();
}

matchMedia('(max-width:760px)').addEventListener('change', () => {
  if (active?.isConnected) draw();
});

setInterval(() => {
  if (active?.isConnected && location.hash.startsWith('#treasury/cta-monitor'))
    fetchData();
}, 30000);
