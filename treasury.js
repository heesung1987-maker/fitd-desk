import { renderCtaMonitor } from './cta-monitor.js';
import { calculatePerformance } from './cta-performance.js';
import {
  countryView,
  commonTenors,
  countrySpread,
  spreadBoard,
  movingAverage,
  sourceSeries,
} from './global-rates.js';
import {
  renderRangeControls,
  bindRangeControls,
  filterSeriesByRange,
  getChartTheme,
  enhanceInteractiveCharts,
} from './chart-utils.js';

const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (v, d = 2) =>
  finite(v)
    ? v.toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })
    : '—';
const signed = (v, d = 1) => (finite(v) ? (v > 0 ? '+' : '') + fmt(v, d) : '—');
const color = (v) => (!finite(v) ? 'muted' : v > 0 ? 'orange' : v < 0 ? 'green' : '');

let getState = () => ({}),
  setTab = () => {},
  api = async () => {},
  onChange = async () => {},
  toast = () => {};

let view = location.hash.startsWith('#treasury/cta-monitor')
  ? 'cta-monitor'
  : location.hash === '#treasury/cta'
  ? 'cta'
  : location.hash === '#treasury/cross'
  ? 'cross'
  : 'overview';
let windowN = 126,
  kind = 'ALL',
  sort = 'abs_z',
  selected = 'SLOPE_2_10',
  focus = 'UST10';
let globalCountry = 'US',
  crossA = 'US',
  crossB = 'DE',
  crossTenor = 10,
  crossWindow = 126,
  crossSort = 'abs_z',
  maEnabled = new Set([20, 60, 120]);

try {
  const s = JSON.parse(localStorage.getItem('fitd-global-rates-view') || 'null');
  if (s) {
    globalCountry = s.country || 'US';
    crossA = s.a || 'US';
    crossB = s.b || 'DE';
    crossTenor = +s.tenor || 10;
    crossWindow = [63, 126, 252].includes(s.window) ? s.window : 126;
    if (Array.isArray(s.mas))
      maEnabled = new Set(s.mas.filter((n) => [20, 60, 120].includes(n)));
  }
} catch {}

function saveGlobalView() {
  try {
    localStorage.setItem(
      'fitd-global-rates-view',
      JSON.stringify({
        country: globalCountry,
        a: crossA,
        b: crossB,
        tenor: crossTenor,
        window: crossWindow,
        mas: [...maEnabled],
      })
    );
  } catch {}
}

let comparisons = new Set(['LATEST', '1M', '1Y']);
let ctaFocus = 'UST10',
  ctaBase = null;
let ctaDraft = null,
  ctaDraftBasis = null;
let ctaWeightDraft = null,
  ctaWeightBasis = null;
let ctaCost = 0.2,
  ctaYear = 'ALL';

try {
  const v = localStorage.getItem('fitd-cta-cost-bp');
  if (v !== null && Number.isFinite(+v) && +v >= 0 && +v <= 5) ctaCost = +v;
} catch {}
try {
  const v = Number(localStorage.getItem('fitd-cta-base-dv01-usd'));
  if (v > 0 && v <= 1e7) ctaBase = v;
} catch {}

export function configureTreasury(o) {
  getState = o.getState;
  setTab = o.setTab;
  api = o.api;
  onChange = o.onChange;
  toast = o.toast;
}

function download(name, header, rows) {
  const csv =
    '\ufeff' +
    [header, ...rows]
      .map((r) => r.map((x) => '"' + String(x ?? '').replaceAll('"', '""') + '"').join(','))
      .join('\r\n');
  const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

function periodControls(chartId = 'ust-main') {
  return renderRangeControls(chartId, {
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
    showDateInputs: true,
  });
}

function rateLines(lines, chartId = 'ust-main', all = false) {
  const th = getChartTheme();
  const averages = lines.flatMap((line, i) =>
    i > 0 && !all
      ? []
      : [...maEnabled]
          .sort((a, b) => a - b)
          .map((n) => ({
            label: line.label + ' · MA' + n,
            color: th.maColors[n],
            strokeWidth: 1.3,
            dash: n === 20 ? '4 3' : n === 60 ? '7 3' : '10 4',
            data: filterSeriesByRange(
              movingAverage(line.data, n),
              chartId,
              (r) => r[0],
              '1Y'
            ),
          }))
  );
  return [
    ...lines.map((line) => ({
      ...line,
      data: filterSeriesByRange(line.data, chartId, (r) => r[0], '1Y'),
    })),
    ...averages,
  ];
}

function plot(lines, { unit = 'bp', height = 280, bands = false, small = false, curve = false } = {}) {
  const th = getChartTheme();
  const palette = th.palette;
  const moneyAxis = unit.startsWith('USD'),
    w = 920,
    h = height,
    p = { l: moneyAxis ? 110 : 64, r: 25, t: 25, b: 40 },
    iw = w - p.l - p.r,
    ih = h - p.t - p.b;
  const all = lines.flatMap((l) => l.data).filter((a) => finite(a[1])),
    xs = all.map((a) => (curve ? a[0] : Date.parse(a[0] + 'T00:00:00Z')));
  if (!xs.length) return '<div class="empty">동일 날짜의 원천 관측값이 부족합니다.</div>';
  const xlo = Math.min(...xs),
    xhi = Math.max(...xs),
    values = all.flatMap((a) =>
      bands && finite(a[2]) && finite(a[3])
        ? [a[1], a[2] - 2 * a[3], a[2] + 2 * a[3]]
        : [a[1]]
    );
  let lo = Math.min(...values),
    hi = Math.max(...values);
  const span = hi - lo || 1;
  lo -= span * 0.12;
  hi += span * 0.12;
  const X = (a) => p.l + (((curve ? a : Date.parse(a + 'T00:00:00Z')) - xlo) / (xhi - xlo || 1)) * iw,
    Y = (v) => p.t + ((hi - v) / (hi - lo)) * ih;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const dates = [...new Set(all.map((a) => a[0]))].sort((a, b) =>
    curve ? a - b : a.localeCompare(b)
  );
  const xmarks = curve
    ? dates
    : dates.filter(
        (a, i) => i === 0 || i === dates.length - 1 || i === Math.floor(dates.length / 2)
      );

  let body = ticks
    .map(
      (v) =>
        `<line x1="${p.l}" x2="${w - p.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${th.grid}"/><text x="${
          p.l - 10
        }" y="${Y(v) + 5}" text-anchor="end">${
          moneyAxis
            ? new Intl.NumberFormat('en-US', {
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format(v)
            : fmt(v, unit === '%' || unit === 'x' ? 2 : 0)
        }</text>`
    )
    .join('');

  if (lo < 0 && hi > 0)
    body += `<line x1="${p.l}" x2="${w - p.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="${
      th.zeroLine
    }" stroke-dasharray="4 4"/>`;

  if (bands) {
    const d = lines[0].data.filter((a) => finite(a[1]) && finite(a[2]) && finite(a[3]));
    for (const k of [2, 1]) {
      const points = d
        .map((a) => `${X(a[0])},${Y(a[2] + k * a[3])}`)
        .concat([...d].reverse().map((a) => `${X(a[0])},${Y(a[2] - k * a[3])}`));
      body += `<polygon points="${points.join(' ')}" fill="${th.bandFill}" opacity="${
        k === 2 ? (th.isLight ? 0.09 : 0.06) : th.isLight ? 0.16 : 0.12
      }"/>`;
    }
    body += `<polyline points="${d
      .map((a) => `${X(a[0])},${Y(a[2])}`)
      .join(' ')}" fill="none" stroke="${th.blue}" stroke-width="1.2" stroke-dasharray="5 5"/>`;
  }

  lines.forEach((l, j) => {
    let drawing = false;
    const path = l.data
      .map((a) => {
        if (!finite(a[1])) {
          drawing = false;
          return '';
        }
        const command = drawing ? 'L' : 'M';
        drawing = true;
        return `${command}${X(a[0]).toFixed(2)},${Y(a[1]).toFixed(2)}`;
      })
      .join(' ');
    body += `<path d="${path}" fill="none" stroke="${
      l.color || palette[j % palette.length]
    }" stroke-width="${l.strokeWidth ?? (small ? 2 : 2.5)}" ${
      l.dash ? `stroke-dasharray="${l.dash}"` : ''
    } stroke-linejoin="round"/>`;
    if (curve)
      body += l.data
        .filter((a) => finite(a[1]))
        .map(
          (a) =>
            `<circle cx="${X(a[0])}" cy="${Y(a[1])}" r="4.5" fill="${
              l.color || palette[j % palette.length]
            }"/>`
        )
        .join('');
  });

  body += xmarks
    .map(
      (d, i) =>
        `<text x="${X(d)}" y="${h - 12}" text-anchor="${
          i === 0 ? 'start' : i === xmarks.length - 1 ? 'end' : 'middle'
        }">${curve ? d + 'Y' : d}</text>`
    )
    .join('');
  body += `<text x="${p.l}" y="15">${unit}</text>`;

  const hits = dates
    .map((d) => {
      const values = lines.flatMap((l) => {
        const a = l.data.find((a) => a[0] === d);
        return a && finite(a[1]) ? [`${l.label}: ${fmt(a[1], 3)} ${unit}`] : [];
      });
      return `<rect x="${X(d) - Math.max(2, iw / dates.length / 2)}" y="${
        p.t
      }" width="${Math.max(4, iw / dates.length)}" height="${ih}" fill="transparent"><title>${
        curve ? d + 'Y' : d
      }\n${esc(values.join('\n'))}</title></rect>`;
    })
    .join('');

  return `<svg class="ust-chart ${
    small ? 'ust-small-chart' : ''
  }" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(
    lines.map((l) => l.label).join(', ')
  )} 추이 (${unit})">${body}${hits}</svg>`;
}

function spark(data) {
  if (!data.length) return '<span class="muted">수록 대기</span>';
  const th = getChartTheme();
  const raw = data.slice(-20);
  const lines = [
    {
      label: '금리',
      color: raw.at(-1)[1] >= raw[0][1] ? th.orange : th.green,
      data: raw,
    },
  ];
  const values = lines.flatMap((l) => l.data.map((r) => r[1])).filter(finite),
    lo = Math.min(...values),
    hi = Math.max(...values);
  return `<svg class="ust-spark" viewBox="0 0 130 34" aria-hidden="true">${lines
    .map(
      (l) =>
        `<polyline points="${l.data
          .map((r, i) =>
            finite(r[1])
              ? `${(i * 130) / Math.max(1, l.data.length - 1)},${
                  30 - ((r[1] - lo) / (hi - lo || 1)) * 26
                }`
              : ''
          )
          .join(' ')}" fill="none" stroke="${l.color}" stroke-width="2.2"/>`
    )
    .join('')}</svg>`;
}

function head(title, note = '', action = '') {
  return `<div class="panel-head"><div><h2>${title}</h2>${
    note ? `<small>${note}</small>` : ''
  }</div>${action}</div>`;
}

function legend(lines) {
  return `<div class="ust-legend">${lines
    .map((l) => `<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`)
    .join('')}</div>`;
}

function tableLevels(d) {
  return `<div class="table-scroll"><table class="ust-level-table"><thead><tr><th>만기</th><th class="number">금리 %</th>${[
    '1D',
    '3D',
    '1W',
    '1M',
    '3M',
    'YTD',
  ]
    .map(
      (k) => `<th class="number" title="비교일 ${d.references[k] || '없음'}">${k} bp</th>`
    )
    .join('')}<th class="number">20일 변동성 bp</th><th>최종 관측일</th></tr></thead><tbody>${d.levels
    .map(
      (r) =>
        `<tr><td><button class="ust-text-link" data-ust-focus="${r.id}">${
          r.name
        }</button></td><td class="number">${fmt(r.yield_pct, 3)}</td>${[
          '1D',
          '3D',
          '1W',
          '1M',
          '3M',
          'YTD',
        ]
          .map(
            (k) => `<td class="number ${color(r.changes[k])}">${signed(r.changes[k])}</td>`
          )
          .join('')}<td class="number">${fmt(r.vol20_bp, 1)}</td><td>${
          r.last ? esc(r.last) : '<span class="tag block">KIS 수록 대기</span>'
        }${r.last && !r.fresh ? ' · 기준일 누락' : ''}</td></tr>`
    )
    .join('')}</tbody></table></div>`;
}

function curvePanel(d) {
  const th = getChartTheme();
  const palette = th.palette;
  const lines = d.curve_comparisons
    .filter((c) => comparisons.has(c.id))
    .map((c) => ({
      label: `${
        {
          LATEST: '기준일',
          '1M': '1개월 전',
          '3M': '3개월 전',
          '6M': '6개월 전',
          '1Y': '1년 전',
        }[c.id]
      } · ${c.date || '없음'}`,
      color: palette[['LATEST', '1M', '3M', '6M', '1Y'].indexOf(c.id)],
      data: c.points.map((p) => [p.tenor, p.yield_pct]),
    }));
  for (const n of [...maEnabled].sort((a, b) => a - b))
    lines.push({
      label: 'MA' + n + ' · 기준일 평균 커브',
      color: th.maColors[n],
      strokeWidth: 1.3,
      dash: '5 3',
      data: d.levels.map((l) => [
        l.tenor,
        movingAverage(l.history, n).find((r) => r[0] === d.as_of)?.[1] ?? null,
      ]),
    });
  return `<div class="panel">${head(
    (d.country?.name || '미국') + ' 국채 벤치마크 커브',
    '관측 만기별 수익률 · 가로축 만기(년), 세로축 금리(%)'
  )}<div class="filters ust-comparisons">${[
    ['LATEST', '기준일'],
    ['1M', '1개월 전'],
    ['3M', '3개월 전'],
    ['6M', '6개월 전'],
    ['1Y', '1년 전'],
  ]
    .map(
      ([k, l]) =>
        `<button class="btn ${
          comparisons.has(k) ? 'ust-active' : ''
        }" data-ust-compare="${k}" aria-pressed="${comparisons.has(k)}">${l}</button>`
    )
    .join('')}</div>${legend(lines)}${plot(lines, {
    unit: '%',
    curve: true,
  })}<p class="ust-footnote">비교일은 해당 기간 이전의 공통 관측일입니다. 누락 만기 구간은 연결하거나 보간하지 않습니다. MA 곡선은 각 만기의 관측일 이동평균입니다.</p></div>`;
}

function overview(d, state) {
  const th = getChartTheme();
  const isLive = state?.data_mode === 'live';
  const cards = d.levels
    .map(
      (r) =>
        `<button class="ust-yield-card ${
          r.fresh ? '' : 'ust-waiting'
        }" data-ust-focus="${r.id}"><span class="ust-card-label">${r.name}<small>${
          r.fresh ? (isLive ? 'BBG · LIVE' : 'KIS · DAILY') : r.last ? '기준일 누락' : 'KIS 수록 대기'
        }</small></span><strong>${fmt(
          r.yield_pct,
          3
        )}<small>%</small></strong><span class="ust-card-bottom"><b class="${color(
          r.changes['1D']
        )}">${signed(r.changes['1D'])} bp <small>1D</small></b>${spark(
          r.history
        )}</span></button>`
    )
    .join('');
  const refs = ['1D', '3D'].map((k) => [k, d.references[k]]);
  const common = d.levels.filter((r) => finite(r.yield_pct));
  const max = Math.max(
    1,
    ...common.flatMap((r) => refs.map(([k]) => Math.abs(r.changes[k] || 0)))
  );
  const bars = common
    .map(
      (r) =>
        `<div class="ust-move-row"><b>${r.name}</b>${refs
          .map(([k]) => {
            const v = r.changes[k];
            return `<div class="ust-move-cell"><div class="ust-move-track"><span style="left:${
              50 + Math.min(0, ((v || 0) / max) * 44)
            }%;width:${(Math.abs(v || 0) / max) * 44}%;background:${
              v > 0 ? th.orange : th.green
            }"></span></div><span class="${color(v)}">${signed(v)} bp</span></div>`;
          })
          .join('')}</div>`
    )
    .join('');
  const events = (state.events || []).filter(
    (e) =>
      (e.currency === (d.country?.currency || 'USD') || e.currency === 'USD') &&
      ['오늘', '내일'].includes(e.when) &&
      e.status !== 'COMPLETED'
  );
  return `<div class="ust-yield-grid global-grid-${d.levels.length}">${cards}</div><div class="ust-two">${curvePanel(
    d
  )}<div class="panel">${head(
    '최근 금리 움직임',
    '금리 상승 + / 하락 − · bp'
  )}<div class="ust-move-head"><span>만기</span>${refs
    .map(([k, dt]) => `<span>${k}<small>${dt || '—'} 대비</small></span>`)
    .join('')}</div>${bars}<p class="ust-footnote">D = ${
    d.as_of || '—'
  } · D−1·D−3은 공통 관측 거래일입니다.</p><div class="ust-market-links"><button class="btn" data-ust-view="board">커브·플라이 이격 보기 →</button><button class="btn quiet" data-ust-go="momentum">모멘텀 모니터 →</button></div></div></div><div class="panel">${head(
    '만기별 레벨과 변화',
    '변화는 고정 비교일의 실제 관측값으로 계산 · 결측 대체 없음',
    '<button id="ust-level-export" class="btn quiet">↓ 금리 CSV</button>'
  )}${tableLevels(d)}</div><div class="panel ust-events">${head(
    (d.country?.name || '미국') + ' · 미국 공통 이벤트 / 오늘·내일',
    '조회 시점 KST 기준 · 가격 기준일과 분리',
    '<button class="btn quiet" data-ust-go="events">전체 캘린더 →</button>'
  )}<div class="ust-event-list">${
    events.length
      ? events
          .map(
            (e) =>
              `<div><span class="tag">${esc(e.when)}</span><strong>${esc(
                e.title
              )}</strong><span class="muted">${esc(e.date)} · 중요도 ${
                e.importance
              }</span></div>`
          )
          .join('')
      : '<p class="muted">현재 수록된 오늘·내일 관련 중요 이벤트가 없습니다. 일정 수록 종료일: ' +
        esc(state.calendar_end || '미확인') +
        '</p>'
  }</div></div>`;
}

function boardRows(d) {
  return d.board
    .filter((r) => kind === 'ALL' || r.kind === kind)
    .sort((a, b) => {
      const av =
        sort === 'abs_z'
          ? Math.abs(a.metrics[String(windowN)].z ?? NaN)
          : sort === 'z'
          ? a.metrics[String(windowN)].z
          : sort === 'move'
          ? a.change_1d_bp
          : a.value_bp;
      const bv =
        sort === 'abs_z'
          ? Math.abs(b.metrics[String(windowN)].z ?? NaN)
          : sort === 'z'
          ? b.metrics[String(windowN)].z
          : sort === 'move'
          ? b.change_1d_bp
          : b.value_bp;
      return finite(av) && finite(bv)
        ? bv - av || a.id.localeCompare(b.id)
        : finite(av)
        ? -1
        : finite(bv)
        ? 1
        : a.id.localeCompare(b.id);
    });
}

function board(d) {
  const th = getChartTheme();
  const rows = boardRows(d),
    r =
      rows.find((r) => r.id === selected) ||
      rows.find((r) => finite(r.value_bp)) ||
      rows[0];
  selected = r?.id;
  const m = r?.metrics[String(windowN)] || {};
  const rank = rows.filter((r) => finite(r.metrics[String(windowN)].z));
  const extent = Math.max(3, ...rank.map((r) => Math.abs(r.metrics[String(windowN)].z)));
  const chartLines = r
    ? [
        {
          label: r.name + ' ' + r.formula,
          color: th.orange,
          data: r.history.map((a) => [
            a[0],
            a[1],
            a[windowN === 63 ? 2 : 4],
            a[windowN === 63 ? 3 : 5],
          ]),
        },
      ]
    : [];
  const ranking = rank
    .map((r) => {
      const z = r.metrics[String(windowN)].z,
        v = (z / extent) * 47;
      return `<button class="ust-rank-row ${
        r.id === selected ? 'selected' : ''
      }" data-ust-select="${r.id}"><span>${r.name}<small>${
        r.kind === 'FLY' ? '플라이' : '슬로프'
      }</small></span><span class="ust-rank-track"><i style="left:${
        50 + Math.min(0, v)
      }%;width:${Math.abs(v)}%;background:${
        z >= 0 ? th.orange : th.green
      };opacity:${Math.abs(z) >= 2 ? 1 : 0.65}"></i></span><b class="${color(
        z
      )}">${signed(z, 2)}σ</b></button>`;
    })
    .join('');

  return `<div class="panel">${head(
    '커브·플라이 이격 보드',
    '같은 날짜 금리로 계산 · Z는 시장 관찰용이며 RV 진입 시그널과 별개',
    '<button id="ust-board-export" class="btn quiet">↓ 이격 CSV</button>'
  )}<div class="filters ust-board-controls"><label>Z 윈도 <select id="ust-window"><option value="63">3개월 · 63관측</option><option value="126">6개월 · 126관측</option></select></label><label>구성 <select id="ust-kind"><option value="ALL">전체</option><option value="SLOPE">슬로프</option><option value="FLY">플라이</option></select></label><label>정렬 <select id="ust-sort"><option value="abs_z">|Z| 큰 순</option><option value="z">Z 높은 순</option><option value="level">스프레드 높은 순</option><option value="move">1D 변화 높은 순</option></select></label></div><div class="table-scroll"><table class="ust-board-table"><thead><tr><th>구성 / 계산식</th><th class="number">현재 bp</th><th class="number">1D bp</th><th class="number">평균 bp</th><th class="number">표준편차 bp</th><th class="number">Z-score</th><th>상태</th></tr></thead><tbody>${rows
    .map((x) => {
      const z = x.metrics[String(windowN)];
      return `<tr class="ust-board-row ${
        x.id === selected ? 'selected' : ''
      }"><td><button data-ust-select="${x.id}">${x.name}<small>${
        x.kind === 'FLY' ? '플라이' : '슬로프'
      } · ${x.formula}</small></button></td><td class="number">${fmt(
        x.value_bp
      )}</td><td class="number ${color(x.change_1d_bp)}">${signed(
        x.change_1d_bp
      )}</td><td class="number">${fmt(z.mean_bp)}</td><td class="number">${fmt(
        z.sd_bp
      )}</td><td class="number ${color(z.z)}">${signed(z.z, 2)}</td><td>${
        !finite(x.value_bp)
          ? '<span class="tag block">관측값 부족</span>'
          : !finite(z.z)
          ? '<span class="tag">윈도 부족</span>'
          : Math.abs(z.z) >= 2
          ? '<span class="tag hold">|Z| ≥ 2</span>'
          : '<span class="muted">관찰</span>'
      }</td></tr>`;
    })
    .join('')}</tbody></table></div></div><div class="ust-two ust-board-detail"><div class="panel">${head(
    '이격 순위',
    `현재 구성 · ${windowN}관측 · 진한 막대 |Z| ≥ 2`
  )}<div class="ust-rank-list">${
    ranking || '<div class="empty">계산할 관측값이 없습니다.</div>'
  }</div><p class="ust-footnote">+Z: 슬로프가 기간 평균보다 가파름 / 플라이 몸통 금리가 상대적으로 높음. −Z는 반대입니다.</p></div><div class="panel" id="ust-detail">${head(
    esc(r?.name || '선택 없음') + ' · ' + esc(r?.formula || ''),
    '롤링 평균 및 ±1σ·±2σ 밴드'
  )}${periodControls('ust-main')}<div class="ust-detail-metrics"><span>현재 <b>${fmt(
    r?.value_bp
  )} bp</b></span><span>Z <b class="${color(m.z)}">${signed(
    m.z,
    2
  )}σ</b></span><span>윈도 <b>${windowN}관측</b></span></div>${legend(
    rateLines(chartLines, 'ust-main')
  )}${plot(rateLines(chartLines, 'ust-main'), {
    bands: true,
  })}<p class="ust-footnote">주황: 스프레드 · 파랑 점선: 당일 롤링 평균 · 음영: ±1σ·±2σ</p></div></div>`;
}

function trends(d) {
  const th = getChartTheme();
  const palette = th.palette;
  const active = d.levels.find((r) => r.id === focus) || d.levels[0];
  const lines = finite(active.yield_pct)
    ? [{ label: active.name, color: palette[0], data: active.history }]
    : [];
  const sliced = rateLines(lines, 'ust-main');
  return `<div class="panel">${head(
    (d.country?.name || '미국') + ' 국채 금리 추이',
    '만기를 선택해 확대 · 상단에서 시계열 기간 및 시작일~종료일을 자유롭게 조절하세요'
  )}${periodControls('ust-main')}<div class="filters"><label for="ust-tenor">만기 선택</label><select id="ust-tenor">${d.levels
    .map(
      (r) =>
        `<option value="${r.id}">${r.name}${
          r.status === 'NO_DATA' ? ' · 수록 대기' : ''
        }</option>`
    )
    .join('')}</select><button id="ust-history-export" class="btn quiet">↓ 선택 만기 전체 이력 CSV</button></div><div class="ust-trend-title"><strong>${
    active.name
  }</strong><span>${fmt(active.yield_pct, 3)}%</span><b class="${color(
    active.changes['1D']
  )}">${signed(active.changes['1D'])} bp / 1D</b></div>${legend(sliced)}${plot(
    sliced,
    { unit: '%', height: 320 }
  )}<p class="ust-footnote">마지막 관측: ${
    active.last || '없음'
  } · 20일 일별 변동성 ${fmt(active.vol20_bp, 2)} bp · 표시 관측수 ${
    sliced[0]?.data?.length || 0
  }개</p></div><div class="ust-mini-grid">${d.levels
    .map(
      (r, i) =>
        `<div class="panel">${head(
          r.name,
          finite(r.yield_pct) ? fmt(r.yield_pct, 3) + '%' : 'KIS 수록 대기',
          `<button class="btn quiet" data-ust-focus="${r.id}">확대 ↗</button>`
        )}${plot(
          rateLines(
            finite(r.yield_pct)
              ? [{ label: r.name, color: palette[i % palette.length], data: r.history }]
              : [],
            'ust-main'
          ),
          { unit: '%', height: 230, small: true }
        )}</div>`
    )
    .join('')}</div>`;
}

function method(d, state) {
  const isLive = state?.data_mode === 'live';
  return `<details class="panel ust-method"><summary>계산 기준과 데이터 범위</summary><div><p>원천: ${
    isLive
      ? `FITD <code>kis_market_prices</code> 전일 종가(${esc(
          state?.base_as_of || '—'
        )}) + <b>Bloomberg 실시간 금리 오버레이(${esc(
          d.as_of || '없음'
        )} · 15분 주기 자동 갱신)</b>`
      : `FITD <code>kis_market_prices</code>의 선택 국가 명목 국채 일별 금리. 가격 기준일 ${esc(
          d.as_of || '없음'
        )}, 요청 기준일 ${esc(d.requested_as_of)}. 당일 진행 중인 값은 제외합니다.`
  }</p><p>금리는 %, 변화·스프레드는 bp입니다. 슬로프 = 장기금리 − 단기금리, 플라이 = 2 × 몸통금리 − 양쪽 날개금리. 양의 플라이는 몸통 금리가 날개 평균보다 높다는 뜻이며, DV01 중립 포지션 수익률을 뜻하지 않습니다.</p><p>Z = (현재 스프레드 − 롤링 평균) / 표본 표준편차(ddof=1). 동일 날짜 실제 관측값을 사용하며 현재일을 포함합니다. 평균·밴드도 각 과거 시점까지의 값으로 계산합니다. MA20·60·120은 과거 20·60·120개 실제 관측값의 단순이동평균이며 선행 구간까지 계산한 후 표시 기간을 자릅니다. 이평선 표시는 전략 신호를 변경하지 않습니다.</p><p>시장 관찰 화면입니다. 이격 Z는 기존 RV의 OOS 회귀 Z와 계산 방식이 다르며, 모멘텀·RV 진입 조건을 변경하지 않습니다.</p></div></details>`;
}

function normalizeCross(g) {
  if (!g.countries.some((c) => c.id === crossA)) crossA = g.countries[0]?.id;
  if (!g.countries.some((c) => c.id === crossB) || crossA === crossB)
    crossB = g.countries.find((c) => c.id !== crossA)?.id;
  const tenors = commonTenors(g, crossA, crossB);
  if (!tenors.includes(crossTenor))
    crossTenor = tenors.includes(10) ? 10 : tenors[0];
  return countrySpread(g, crossA, crossB, crossTenor, crossWindow);
}

function crossRows(g) {
  return spreadBoard(g, crossTenor, crossWindow)
    .map((r) =>
      r.a === crossB && r.b === crossA
        ? countrySpread(g, crossA, crossB, crossTenor, crossWindow)
        : r
    )
    .sort((a, b) => {
      const av =
          crossSort === 'abs_z'
            ? Math.abs(a.z ?? NaN)
            : crossSort === 'z'
            ? a.z
            : crossSort === 'move'
            ? a.change_1d_bp
            : a.value_bp,
        bv =
          crossSort === 'abs_z'
            ? Math.abs(b.z ?? NaN)
            : crossSort === 'z'
            ? b.z
            : crossSort === 'move'
            ? b.change_1d_bp
            : b.value_bp;
      return finite(av) && finite(bv)
        ? bv - av || a.id.localeCompare(b.id)
        : finite(av)
        ? -1
        : finite(bv)
        ? 1
        : 0;
    });
}

function distribution(r) {
  if (!r.zValues.length)
    return '<div class="empty">선택한 윈도의 공통 관측 또는 표준편차가 부족합니다.</div>';
  const th = getChartTheme();
  const w = 900,
    h = 290,
    p = { l: 60, r: 25, t: 30, b: 45 },
    iw = w - p.l - p.r,
    ih = h - p.t - p.b,
    extent = Math.max(
      4,
      Math.ceil(Math.max(...r.zValues.map(Math.abs), Math.abs(r.z || 0)))
    ),
    count = 24,
    width = (2 * extent) / count,
    bins = Array(count).fill(0);
  r.zValues.forEach(
    (z) =>
      bins[Math.max(0, Math.min(count - 1, Math.floor((z + extent) / width)))]++
  );
  const normal = (z) =>
      (r.zValues.length * width * Math.exp((-z * z) / 2)) / Math.sqrt(2 * Math.PI),
    top = Math.max(...bins, normal(0)) * 1.15,
    X = (z) => p.l + ((z + extent) / (2 * extent)) * iw,
    Y = (v) => p.t + ((top - v) / top) * ih;
  let body = '';
  for (const n of [0, 0.5, 1]) {
    const v = top * n;
    body += `<line x1="${p.l}" x2="${w - p.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${
      th.grid
    }"/><text x="${p.l - 10}" y="${Y(v) + 5}" text-anchor="end">${fmt(
      v,
      0
    )}</text>`;
  }
  bins.forEach((v, i) => {
    const x = X(-extent + i * width);
    body += `<rect x="${x + 1}" y="${Y(v)}" width="${iw / count - 2}" height="${
      Y(0) - Y(v)
    }" fill="${th.blue}" opacity="0.6"><title>${fmt(
      -extent + i * width,
      2
    )} ~ ${fmt(-extent + (i + 1) * width, 2)}σ\n관측수: ${v}개</title></rect>`;
  });
  const curve = Array.from({ length: 161 }, (_, i) => {
    const z = -extent + (i * 2 * extent) / 160;
    return `${X(z)},${Y(normal(z))}`;
  }).join(' ');
  body += `<polyline points="${curve}" fill="none" stroke="${th.green}" stroke-width="2" stroke-dasharray="5 4"/>`;
  for (const z of [-2, -1, 0, 1, 2])
    body += `<line x1="${X(z)}" x2="${X(z)}" y1="${p.t}" y2="${Y(0)}" stroke="${
      th.zeroLine
    }" stroke-dasharray="3 5" opacity="0.65"/>`;
  for (const z of [...new Set([-extent, -2, -1, 0, 1, 2, extent])].sort(
    (a, b) => a - b
  ))
    body += `<text x="${X(z)}" y="${h - 15}" text-anchor="middle">${z}σ</text>`;
  if (finite(r.z))
    body += `<line x1="${X(r.z)}" x2="${X(r.z)}" y1="${p.t}" y2="${Y(0)}" stroke="${
      th.orange
    }" stroke-width="3"><title>현재 ${signed(r.z, 3)}σ · ${fmt(
      r.value_bp,
      3
    )}bp</title></line><text x="${Math.min(
      w - 120,
      Math.max(p.l + 10, X(r.z) + 8)
    )}" y="20" fill="${th.orange}">현재 ${signed(r.z, 2)}σ</text>`;
  return `<svg id="cross-histogram" class="ust-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="최근 ${crossWindow}개 스프레드의 표준편차 단위 분포">${body}</svg>`;
}

function crossPanel(g) {
  if (!g)
    return '<div class="panel"><div class="empty">글로벌 금리 수집 후 국가간 스프레드가 표시됩니다.</div></div>';
  const th = getChartTheme();
  const palette = th.palette;
  const r = normalizeCross(g),
    a = g.countries.find((c) => c.id === crossA),
    b = g.countries.find((c) => c.id === crossB),
    rows = crossRows(g),
    name = (id) => g.countries.find((c) => c.id === id)?.name || id,
    tenors = commonTenors(g, crossA, crossB),
    lines = rateLines(
      [{ label: `${a?.name} − ${b?.name} ${crossTenor}Y`, color: palette[0], data: r.stats }],
      'ust-main'
    );
  const legLines = rateLines(
    [
      {
        label: a?.name + ' ' + crossTenor + 'Y',
        color: palette[0],
        data: sourceSeries(g, r.code_a).filter((row) => row[0] <= r.as_of),
      },
      {
        label: b?.name + ' ' + crossTenor + 'Y',
        color: palette[1],
        data: sourceSeries(g, r.code_b).filter((row) => row[0] <= r.as_of),
      },
    ],
    'ust-main',
    true
  );

  return `<div class="panel">${head(
    '국가간 동일 테너 스프레드',
    '국가 A 금리 − 국가 B 금리 · 동일 가격일의 실제 관측값',
    '<button class="btn quiet" id="cross-board-export">↓ 순위표 CSV</button>'
  )}<div class="cross-controls"><label>국가 A <select id="cross-country-a">${g.countries
    .map(
      (c) =>
        `<option value="${c.id}" ${c.id === crossA ? 'selected' : ''}>${
          c.name
        } · ${c.id}</option>`
    )
    .join('')}</select></label><button class="btn quiet" id="cross-swap" aria-label="국가 A와 B 바꾸기">⇄</button><label>국가 B <select id="cross-country-b">${g.countries
    .filter((c) => c.id !== crossA)
    .map(
      (c) =>
        `<option value="${c.id}" ${c.id === crossB ? 'selected' : ''}>${
          c.name
        } · ${c.id}</option>`
    )
    .join('')}</select></label><label>동일 테너 <select id="cross-tenor">${tenors
    .map(
      (t) =>
        `<option value="${t}" ${t === crossTenor ? 'selected' : ''}>${t}년</option>`
    )
    .join('')}</select></label><label>Z 윈도 <select id="cross-window">${[
    [63, '63관측 · 약 3개월'],
    [126, '126관측 · 약 6개월'],
    [252, '252관측 · 약 1년'],
  ]
    .map(
      ([n, l]) =>
        `<option value="${n}" ${n === crossWindow ? 'selected' : ''}>${l}</option>`
    )
    .join('')}</select></label></div><p class="ust-footnote">${esc(
    a?.name
  )} − ${esc(b?.name)} · ${crossTenor}년 · 공통 기준일 ${
    r.as_of || '관측 없음'
  } ${
    r.fresh ? '' : '· 요청 기준일 누락'
  }. 양수는 A 금리가 B보다 높다는 뜻입니다.</p></div><div class="cta-stats cross-stats">${[
    ['현재 스프레드', fmt(r.value_bp, 2), 'bp'],
    ['기간 평균 / 표준편차', fmt(r.mean_bp, 2) + ' / ' + fmt(r.sd_bp, 2), 'bp'],
    ['현재 이격 Z', signed(r.z, 2), 'σ'],
    ['기간 내 경험 백분위', fmt(r.percentile, 1), '%'],
  ]
    .map(
      ([label, v, u]) =>
        `<div class="stat"><div class="label">${label}</div><div class="num">${v}<small>${u}</small></div><div class="help">${crossWindow}개 공통 관측 · 현재일 포함</div></div>`
    )
    .join('')}</div><div class="panel">${head(
    '국가간 스프레드 이격 보드',
    `${crossTenor}년을 가진 국가쌍 · 행을 선택하면 아래 상세 변경`,
    `<label class="cross-sort-label">정렬 <select id="cross-sort"><option value="abs_z">|Z| 큰 순</option><option value="z">Z 높은 순</option><option value="level">스프레드 높은 순</option><option value="move">1D 변화 높은 순</option></select></label>`
  )}<div class="table-scroll cross-board-scroll"><table id="cross-board"><thead><tr><th>국가 A − 국가 B</th><th class="number">현재 bp</th><th class="number">1D bp</th><th class="number">평균 bp</th><th class="number">표준편차 bp</th><th class="number">Z</th><th>공통 기준일</th></tr></thead><tbody>${rows
    .map(
      (x) =>
        `<tr class="${
          x.a === crossA && x.b === crossB ? 'selected' : ''
        }"><td><button class="ust-text-link" data-cross-a="${
          x.a
        }" data-cross-b="${x.b}">${name(x.a)} − ${name(x.b)} <small>${
          x.tenor
        }Y</small></button></td><td class="number">${fmt(
          x.value_bp
        )}</td><td class="number ${color(x.change_1d_bp)}">${signed(
          x.change_1d_bp
        )}</td><td class="number">${fmt(x.mean_bp)}</td><td class="number">${fmt(
          x.sd_bp
        )}</td><td class="number ${color(x.z)}">${signed(x.z, 2)}${
          finite(x.z) && Math.abs(x.z) >= 2 ? ' ●' : ''
        }</td><td>${x.as_of || '—'}${x.fresh ? '' : ' · 누락'}</td></tr>`
    )
    .join('')}</tbody></table></div></div><div class="panel cross-detail">${head(
    `${esc(a?.name)} − ${esc(b?.name)} ${crossTenor}Y · 추이와 이격`,
    '스프레드 · 롤링 평균·±1σ·±2σ 밴드 · MA20/60/120'
  )}${periodControls('ust-main')}${legend(lines)}${plot(lines, {
    bands: true,
    height: 310,
  })}<p class="ust-footnote">각 시점까지의 ${crossWindow}개 공통 관측으로 롤링 밴드를 계산합니다. MA20·60·120도 과거 데이터만 사용합니다.</p><div class="panel-head"><h2>표준편차 기준 분포</h2><small>${
    r.sample[0]?.[0] || '—'
  } ~ ${r.as_of || '—'} · ${r.zValues.length}개 관측</small></div>${distribution(
    r
  )}<p class="ust-footnote">파랑: 현재 윈도 스프레드를 현재 평균·표준편차로 표준화한 실제 빈도. 주황선: 현재 Z. 초록 점선: 정규분포 참고 곡선.</p><div class="filters"><button class="btn quiet" id="cross-history-export">↓ 선택 스프레드·이평선 이력 CSV</button></div></div><details class="panel global-leg-rates" open><summary>선택한 두 국가의 구성 금리 추이</summary>${legend(
    legLines
  )}${plot(legLines, {
    unit: '%',
    height: 290,
  })}</details><div class="rule-note">${esc(
    g.method.cross_market_note
  )} 이격은 시장 관찰용이며 기존 RV 진입 시그널과 별개입니다.</div>`;
}

const pnlColor = (v) => (!finite(v) ? 'muted' : v > 0 ? 'green' : v < 0 ? 'red' : 'muted');
const ctaActions = {
  SLEEVE_REBALANCE: '추세·규모 조정',
  WEIGHT_REBALANCE: '결합 비중 조정',
  HOLD: '유지',
  WARMUP: '관측 부족',
};
const ctaAmount = (v) =>
  ctaBase && finite(v) ? signed(v * ctaBase, 2) : signed(v, 3);
const ctaUnit = () => (ctaBase ? 'USD/bp' : 'x');
const ctaSide = (v) =>
  !finite(v) ? '대기' : Math.abs(v) < 1e-10 ? '중립' : v > 0 ? '채권 롱' : '채권 숏';
const tenorLabel = (ts) => ts.map((t) => t + 'Y').join(' + ');
const ctaAppliedWeights = (c) =>
  c.signal_weights || {
    mop: (c.rules?.ensemble_mop_weight ?? 0.5) * 100,
    baz: (1 - (c.rules?.ensemble_mop_weight ?? 0.5)) * 100,
  };
const ctaMixKey = (w) => JSON.stringify([w.mop, w.baz]);
const ctaValidWeights = (w) =>
  [w.mop, w.baz].every((v) => finite(v) && v >= 0 && v <= 100) &&
  Math.abs(w.mop + w.baz - 100) <= 1e-8;
const ctaWeightText = (v) => String(Number(Number(v).toFixed(8)));
const ctaMixLabel = (c) => {
  const w = ctaAppliedWeights(c);
  return `MOP ${ctaWeightText(w.mop)}% · Baz ${ctaWeightText(w.baz)}%`;
};

function downloadCta(name, header, rows) {
  const w = ctaAppliedWeights(getState().treasury.cta);
  download(
    name,
    header.concat(['MOP_weight_pct', 'Baz_weight_pct']),
    rows.map((row) => row.concat([w.mop, w.baz]))
  );
}

function ctaWeightSelector(c) {
  const applied = ctaAppliedWeights(c),
    desired = getState().config.cta_signal_weights || applied,
    basis = ctaMixKey(desired);
  if (ctaWeightBasis !== basis) {
    ctaWeightDraft = { ...desired };
    ctaWeightBasis = basis;
  }
  const pending = ctaMixKey(applied) !== basis;
  return `<div class="panel cta-weight-selector ${
    pending ? 'pending' : ''
  }">${head(
    'MOP · Baz 신호 비중',
    '합계 100% · 한쪽 입력 시 나머지 비중 자동 조정'
  )}<form id="cta-weight-form"><div class="cta-weight-inputs"><label for="cta-mop-weight">MOP <span><input id="cta-mop-weight" name="mop" type="number" min="0" max="100" step="any" required value="${
    finite(ctaWeightDraft.mop) ? ctaWeightDraft.mop : ''
  }"> %</span></label><b aria-hidden="true">:</b><label for="cta-baz-weight">Baz <span><input id="cta-baz-weight" name="baz" type="number" min="0" max="100" step="any" required value="${
    finite(ctaWeightDraft.baz) ? ctaWeightDraft.baz : ''
  }"> %</span></label><button class="btn primary" type="submit" id="cta-apply-weights" ${
    !ctaValidWeights(ctaWeightDraft) || ctaMixKey(ctaWeightDraft) === basis
      ? 'disabled'
      : ''
  }>비중 적용</button></div><div class="cta-weight-presets">${[
    [50, 50],
    [0, 100],
    [35, 65],
    [100, 0],
  ]
    .map(
      ([m, b]) =>
        `<button class="btn quiet" type="button" data-cta-mix="${m}:${b}">MOP ${m} : Baz ${b}</button>`
    )
    .join(
      ''
    )}</div><div class="form-error" id="cta-weight-error" role="alert" hidden></div></form><p class="ust-footnote" id="cta-weight-status">현재 적용: <b>${ctaMixLabel(
    c
  )}</b>${
    pending
      ? ` · <span class="orange">MOP ${ctaWeightText(
          desired.mop
        )}% · Baz ${ctaWeightText(desired.baz)}% 저장됨 · 재계산 대기</span>`
      : ' · 적용 완료'
  }</p></div>`;
}

function bindCtaWeights() {
  const mop = $('#cta-mop-weight'),
    baz = $('#cta-baz-weight'),
    button = $('#cta-apply-weights'),
    error = $('#cta-weight-error');
  const validate = () => {
    const m = mop.value.trim() === '' ? NaN : Number(mop.value),
      b = baz.value.trim() === '' ? NaN : Number(baz.value);
    const valid = ctaValidWeights({ mop: m, baz: b });
    ctaWeightDraft = { mop: m, baz: b };
    error.hidden = valid;
    if (!valid)
      error.textContent = 'MOP·Baz 비중은 각각 0~100%, 합계 100%로 입력하세요.';
    button.disabled = !valid || ctaMixKey(ctaWeightDraft) === ctaWeightBasis;
    return valid;
  };
  const adjust = (changed, other) => {
    const n = changed.value.trim() === '' ? NaN : Number(changed.value);
    if (Number.isFinite(n) && n >= 0 && n <= 100)
      other.value = ctaWeightText(100 - n);
    validate();
  };
  mop.oninput = () => adjust(mop, baz);
  baz.oninput = () => adjust(baz, mop);
  document.querySelectorAll('[data-cta-mix]').forEach(
    (b) =>
      (b.onclick = () => {
        const [m, z] = b.dataset.ctaMix.split(':');
        mop.value = m;
        baz.value = z;
        validate();
      })
  );
  $('#cta-weight-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    button.disabled = true;
    button.textContent = '저장 중';
    error.hidden = true;
    try {
      await api('/api/settings', { cta_signal_weights: { ...ctaWeightDraft } });
      toast('CTA 신호 비중을 저장했습니다.');
      await onChange();
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
    } finally {
      if ($('#cta-apply-weights')) {
        $('#cta-apply-weights').textContent = '비중 적용';
        const desired =
          getState().config.cta_signal_weights ||
          ctaAppliedWeights(getState().treasury.cta);
        $('#cta-apply-weights').disabled =
          ctaMixKey(ctaWeightDraft) === ctaMixKey(desired);
      }
    }
  };
}

function ctaSelector(c) {
  const desired = getState().config.cta_tenors || c.selected_tenors || [10, 30],
    basis = JSON.stringify(desired);
  if (ctaDraftBasis !== basis) {
    ctaDraft = [...desired];
    ctaDraftBasis = basis;
  }
  const applied = c.selected_tenors || [10, 30],
    pending = JSON.stringify(applied) !== basis;
  return `<div class="panel cta-tenor-selector">${head(
    'CTA 금리 테너 선택',
    '하나 또는 여러 개 선택 · 선택한 조합으로 비중·포지션·이력 재계산'
  )}<form id="cta-tenor-form"><fieldset>${(c.catalogue || [])
    .map(
      (r) =>
        `<label class="cta-tenor-option ${
          !r.selectable ? 'unavailable' : ''
        }"><input type="checkbox" name="cta_tenor" value="${r.tenor}" ${
          ctaDraft.includes(r.tenor) ? 'checked' : ''
        } ${
          !r.selectable && !ctaDraft.includes(r.tenor) ? 'disabled' : ''
        }><span><b>${r.tenor}년</b><small>${
          r.status === 'NO_DATA'
            ? 'KIS 수록 대기'
            : r.status === 'WARMUP'
            ? '지표 관측 부족'
            : r.last
        }</small></span></label>`
    )
    .join(
      ''
    )}</fieldset><div class="cta-tenor-actions"><span id="cta-tenor-count">${
    ctaDraft.length
  }개 선택</span><button class="btn quiet" type="button" id="cta-default-tenors">기본 10·30년</button><button class="btn primary" type="submit" id="cta-apply-tenors" ${
    !ctaDraft.length || JSON.stringify(ctaDraft) === basis ? 'disabled' : ''
  }>선택 적용</button></div><div class="form-error" id="cta-selection-error" hidden></div></form><p class="ust-footnote" id="cta-selection-status">현재 계산 조합: <b>${tenorLabel(
    applied
  )}</b>${
    pending
      ? ` · <span class="orange">${tenorLabel(desired)} 저장됨 · 재계산 대기</span>`
      : ' · 적용 완료'
  }</p></div>`;
}

function ctaPerformance(c) {
  const p = c.performance;
  if (!p?.available)
    return `<div class="panel cta-performance">${head(
      'CTA 누적손익',
      '2022년 이후 · 실제 관측 시가로 계산'
    )}<div class="empty">누적성과를 계산할 데이터가 준비되지 않았습니다.</div></div>`;
  const th = getChartTheme();
  const palette = th.palette;
  const base = ctaBase || 1000;
  let vFull = calculatePerformance(p, ctaCost, base, ctaYear);
  if (ctaYear !== 'ALL' && !vFull.years.includes(ctaYear)) {
    ctaYear = 'ALL';
    vFull = calculatePerformance(p, ctaCost, base, ctaYear);
  }
  const slicedDates = filterSeriesByRange(
    vFull.daily,
    'cta-legacy-perf',
    (r) => r.date,
    'ALL'
  );
  const v = calculatePerformance(p, ctaCost, base, ctaYear, slicedDates);
  const s = v.summary,
    zero = v.baselineDate ? [[v.baselineDate, 0]] : [];
  const lines = [
    {
      label: '거래비용 차감 후',
      color: palette[0],
      data: zero.concat(v.daily.map((r) => [r.date, r.cumulative])),
    },
    {
      label: '거래비용 차감 전',
      color: palette[1],
      data: zero.concat(v.daily.map((r) => [r.date, r.cumulative_gross])),
    },
  ];
  const cards = [
    ['누적 순손익', s.net, '시가 체결 가정 · 거래비용 차감'],
    ['최대 낙폭', s.mdd, '선택 기간 내 누적 최고점 대비'],
    ['누적 거래비용', s.cost, `편도 ${fmt(ctaCost, 2)}bp × 매매 DV01`],
    ['최근 관측일 손익', s.last, s.end || '관측 없음'],
  ];

  return `<div class="panel cta-performance">${head(
    'CTA 누적손익',
    `${s.start || '—'} ~ ${s.end || '—'} · 선택 조합 ${tenorLabel(
      c.selected_tenors
    )} · ${ctaMixLabel(c)} · USD`,
    '<button class="btn quiet" id="cta-pnl-export">↓ 일별 손익 CSV</button>'
  )}${renderRangeControls('cta-legacy-perf', {
    presets: [
      ['3M', '3M'],
      ['6M', '6M'],
      ['YTD', 'YTD'],
      ['1Y', '1Y'],
      ['2Y', '2Y'],
      ['ALL', '전체'],
    ],
    defaultPreset: 'ALL',
  })}<div class="cta-performance-controls"><label>연도 필터 <select id="cta-performance-year"><option value="ALL">전체 · 2022년 이후</option>${v.years
    .map(
      (y) =>
        `<option value="${y}" ${ctaYear === y ? 'selected' : ''}>${y}년${
          y === p.end.slice(0, 4) ? ' · 기준일까지' : ''
        }</option>`
    )
    .join(
      ''
    )}</select></label><form id="cta-cost-form"><label for="cta-cost">편도 비용 가정 <input id="cta-cost" type="number" min="0" max="5" step="any" value="${ctaCost}"> bp</label><button class="btn quiet" type="submit">비용 적용</button></form><button class="btn quiet" id="cta-performance-export">↓ 연도·테너별 CSV</button></div><div class="cta-stats cta-performance-stats">${cards
    .map(
      ([label, note, help], i) =>
        `<div class="stat"><div class="label">${label}</div><div class="num ${
          i === 2 ? 'muted' : pnlColor(note)
        }">${i === 2 ? fmt(note, 0) : signed(note, 0)}<small>USD</small></div><div class="help">${esc(
          help
        )}</div></div>`
    )
    .join('')}</div>${legend(lines)}${plot(lines, {
    unit: 'USD',
    height: 310,
  })}<div class="cta-drawdown">${head(
    '누적 손익의 낙폭',
    '선택 기간 시작을 0으로 재설정 · 거래비용 차감 후'
  )}${plot(
    [
      {
        label: '낙폭',
        color: th.red,
        data: zero.concat(v.daily.map((r) => [r.date, r.drawdown])),
      },
    ],
    { unit: 'USD', height: 190 }
  )}</div><div class="panel-head"><h2>연도별·테너별 손익</h2><small>전체 기간 · 현재 비용과 DV01 기준</small></div><div class="table-scroll"><table id="cta-pnl-annual"><thead><tr><th>연도</th><th class="number">순손익 USD</th>${v.codes
    .map((code) => `<th class="number">${code.replace('UST', 'US ')}Y USD</th>`)
    .join(
      ''
    )}<th class="number">비용 전 USD</th><th class="number">거래비용 USD</th></tr></thead><tbody>${v.annual
    .map(
      (r) =>
        `<tr class="${ctaYear === r.year ? 'selected' : ''}"><td>${
          r.year
        }</td><td class="number ${pnlColor(r.net)}">${signed(
          r.net,
          0
        )}</td>${v.codes
          .map(
            (code) =>
              `<td class="number ${pnlColor(r.assets[code])}">${signed(
                r.assets[code],
                0
              )}</td>`
          )
          .join('')}<td class="number">${signed(
          r.gross,
          0
        )}</td><td class="number">${fmt(r.cost, 0)}</td></tr>`
    )
    .join('')}</tbody></table></div></div>`;
}

function ctaPanel(d) {
  const c = d.cta;
  if (!c)
    return '<div class="panel"><div class="empty">CTA 모델을 계산하고 있습니다.</div></div>';
  const th = getChartTheme();
  const palette = th.palette;
  if (!c.sleeves.some((r) => r.id === ctaFocus))
    ctaFocus = c.sleeves[0]?.id || '';
  const b = c.book || {},
    r = c.sleeves.find((r) => r.id === ctaFocus) || c.sleeves[0];
  const summary = [
    [
      '현재 모델 순노출',
      b.current_net,
      `총노출 ${fmt((b.current_gross ?? 0) * (ctaBase || 1), ctaBase ? 0 : 3)} ${ctaUnit()}`,
    ],
    ['다음 세션 목표', b.next_net, '기준일 종가로 계산 · 1세션 시차'],
    [
      '조정 순노출',
      b.net_delta,
      `조정 절대합 ${fmt((b.turnover ?? 0) * (ctaBase || 1), ctaBase ? 0 : 3)} ${ctaUnit()}`,
    ],
  ];
  const scale = ctaBase || 1;
  const slicedHistory = r
    ? filterSeriesByRange(r.history, 'ust-main', (h) => h[0], '1Y')
    : [];
  const lines = r
    ? [
        {
          label: r.name + ' 현재 모델 적용',
          color: palette[0],
          data: slicedHistory.map((h) => [h[0], h[10] == null ? null : h[10] * scale]),
        },
        {
          label: r.name + ' 다음 세션 목표',
          color: palette[1],
          data: slicedHistory.map((h) => [h[0], h[11] == null ? null : h[11] * scale]),
        },
      ]
    : [];
  const rawLines = r
    ? [
        { label: 'MOP', color: palette[2], data: slicedHistory.map((h) => [h[0], h[2]]) },
        { label: 'Baz', color: palette[1], data: slicedHistory.map((h) => [h[0], h[3]]) },
        {
          label: ctaMixLabel(c) + ' 앙상블',
          color: palette[0],
          data: slicedHistory.map((h) => [h[0], h[4]]),
        },
      ]
    : [];

  return `${ctaSelector(c)}${ctaWeightSelector(
    c
  )}<div class="momentum-warning cta-context"><b>미국채 금리 대용 모델 · 실제 CTA 펀드 보유량 추정 아님</b><br>업로드한 PPT의 MOP + Baz 로직을 선택한 미국채 테너의 KIS 금리에 적용했습니다.</div><div class="panel cta-sizing">${head(
    'CTA 델타 · ' + tenorLabel(c.selected_tenors || [10, 30]),
    ctaMixLabel(c) + ' · 역변동성 결합 · sleeve 밴드 0.5 · 1세션 lag',
    '<button class="btn quiet" id="cta-target-export">↓ 포지션 CSV</button>'
  )}<form id="cta-size-form"><label for="cta-base">1.0 단위의 기준 DV01 <span class="muted">USD/bp</span></label><input id="cta-base" type="number" min="1" max="10000000" step="any" placeholder="조회용 기준 DV01 입력" value="${
    ctaBase || ''
  }"><button class="btn primary" type="submit">달러로 환산</button><button class="btn quiet" type="button" id="cta-clear-base">환산 해제</button></form></div><div class="cta-stats">${summary
    .map(
      ([l, v, n]) =>
        `<div class="stat"><div class="label">${l}</div><div class="num ${color(
          v
        )}">${ctaAmount(v)}<small>${ctaUnit()}</small></div><div class="help">${esc(
          n
        )}</div></div>`
    )
    .join('')}<div class="stat"><div class="label">신호 기준일</div><div class="num cta-date">${esc(
    c.as_of || '—'
  )}</div><div class="help">다음 미국채 공통 관측 세션에 적용</div></div></div>${ctaPerformance(
    c
  )}<div class="panel">${head(
    '모델 포지션과 다음 조정',
    '현재 = 전 관측일 신호 적용 / 다음 목표 = 기준일 종가 신호 적용'
  )}<div class="table-scroll"><table class="cta-position-table"><thead><tr><th>만기 / 방향</th><th class="number">금리 %</th><th class="number">결합 비중</th><th class="number">현재 ${ctaUnit()}</th><th class="number">다음 목표 ${ctaUnit()}</th><th class="number">조정량 ${ctaUnit()}</th><th>조정 사유</th></tr></thead><tbody>${c.sleeves
    .map(
      (s) =>
        `<tr class="${
          s.id === ctaFocus ? 'selected' : ''
        }"><td><button class="ust-text-link" data-cta-focus="${s.id}">${
          s.name
        }</button><small class="cta-side">${ctaSide(s.current_book)} → ${ctaSide(
          s.next_book
        )}</small></td><td class="number">${fmt(
          s.yield_pct,
          3
        )}</td><td class="number">${fmt(s.current_weight * 100, 1)}% → ${fmt(
          s.weight * 100,
          1
        )}%</td><td class="number ${color(s.current_book)}">${ctaAmount(
          s.current_book
        )}</td><td class="number ${color(s.next_book)}">${ctaAmount(
          s.next_book
        )}</td><td class="number ${color(s.book_delta)}">${ctaAmount(
          s.book_delta
        )}</td><td><span class="tag ${
          s.action === 'SLEEVE_REBALANCE' ? 'hold' : ''
        }">${ctaActions[s.action]}</span></td></tr>`
    )
    .join('')}</tbody></table></div></div><div class="panel cta-analysis">${head(
    esc(r?.name || '') + ' 포지션과 신호 분해',
    '선택 만기 · 양수는 채권 롱 방향'
  )}${periodControls('ust-main')}<div class="filters segmented">${c.sleeves
    .map(
      (s) =>
        `<button data-cta-focus="${s.id}" class="${
          ctaFocus === s.id ? 'on' : ''
        }">${s.name}</button>`
    )
    .join(
      ''
    )}<button id="cta-history-export" class="btn quiet">↓ 선택 만기 이력 CSV</button></div>${legend(
    lines
  )}${plot(lines, { unit: ctaUnit(), height: 290 })}<div class="cta-signal-grid">${
    r
      ? `<div class="cta-components"><h3>기준일 신호 분해</h3><dl><div><dt>MOP · 21/63/252일 평균</dt><dd>${signed(
          r.mop,
          3
        )}</dd></div><div><dt>Baz · 3개 속도 응답 평균</dt><dd>${signed(
          r.baz,
          3
        )}</dd></div><div><dt>원신호 · ${ctaMixLabel(c)}</dt><dd>${signed(
          r.ensemble,
          3
        )}</dd></div><div><dt>EWMA 일별 변동성</dt><dd>${fmt(
          r.sigma_bp,
          3
        )} bp</dd></div><div><dt>확장 중앙값 기준 변동성</dt><dd>${fmt(
          r.reference_bp,
          3
        )} bp</dd></div><div><dt>변동성 배율 · 0.25~2.0</dt><dd>${fmt(
          r.lever,
          3
        )}x</dd></div><div><dt>가중 전 목표 / 밴드 적용 목표</dt><dd>${signed(
          r.raw_target,
          3
        )} / ${signed(r.band_target, 3)}</dd></div><div><dt>현재 sleeve / 밴드 조정량</dt><dd>${signed(
          r.current_sleeve,
          3
        )} / ${signed(r.sleeve_delta, 3)}</dd></div></dl></div>`
      : ''
  }<div><h3>MOP·Baz·앙상블 추이</h3>${legend(rawLines)}${plot(rawLines, {
    unit: 'x',
    height: 320,
  })}</div></div></div><div class="panel cta-rebalances">${head(
    '최근 모델 조정 이력',
    '신호일 기준 · 다음 세션의 모델 목표 변경',
    '<button class="btn quiet" id="cta-log-export">↓ 조정 CSV</button>'
  )}<div class="table-scroll cta-log-scroll"><table><thead><tr><th>신호일</th><th>만기</th><th class="number">현재 ${ctaUnit()}</th><th class="number">목표 ${ctaUnit()}</th><th class="number">조정 ${ctaUnit()}</th><th>사유</th></tr></thead><tbody>${c.rebalance_log
    .map(
      (r) =>
        `<tr><td>${r.date}</td><td>${r.code.replace(
          'UST',
          'US '
        )}Y</td><td class="number">${ctaAmount(
          r.current_book
        )}</td><td class="number">${ctaAmount(
          r.next_book
        )}</td><td class="number ${color(r.book_delta)}">${ctaAmount(
          r.book_delta
        )}</td><td>${ctaActions[r.reason]}</td></tr>`
    )
    .join('')}</tbody></table></div></div>`;
}

export function renderTreasury() {
  const state = getState(),
    raw = state.treasury,
    g = raw?.global;
  if (!raw) {
    $('#view').innerHTML =
      '<div class="panel"><div class="empty"><h2>글로벌 금리 데이터를 준비하고 있습니다</h2></div></div>';
    return;
  }
  const th = getChartTheme();
  let d = raw;
  if (g?.countries.length) {
    if (!g.countries.some((c) => c.id === globalCountry))
      globalCountry = g.countries[0].id;
    d = { ...countryView(g, globalCountry), cta: raw.cta };
  }
  if (d.levels && !d.levels.some((r) => r.id === focus))
    focus = (d.levels.find((r) => r.tenor === 10) || d.levels[0])?.id;

  $('#view').innerHTML = `
    <div class="ust-toolbar">
      <div class="segmented ust-tabs" aria-label="글로벌 금리 화면">
        ${[
          ['overview', '시장 개요'],
          ['board', '커브·플라이'],
          ['cross', '국가간 스프레드'],
          ['trends', '금리 추이'],
          ['cta-monitor', 'CTA 포지션'],
          ['cta', '기존 CTA 전략'],
        ]
          .map(
            ([k, l]) =>
              `<button data-ust-view="${k}" class="${
                view === k ? 'on' : ''
              }" aria-pressed="${view === k}">${l}</button>`
          )
          .join('')}
      </div>
      <span class="ust-source">${
        state.data_mode === 'live'
          ? `● BBG · LIVE (15m) <b>${esc(d.as_of || '관측 없음')}</b>`
          : `KIS · DAILY CLOSE <b>${esc(d.as_of || '관측 없음')}</b>`
      }</span>
    </div>
    <div class="global-view-controls">
      ${
        view !== 'cta' && view !== 'cta-monitor' && view !== 'cross'
          ? `<label>국가 <select id="global-country">${(
              g?.countries || [{ id: 'US', name: '미국' }]
            )
              .map(
                (c) =>
                  `<option value="${c.id}" ${
                    c.id === globalCountry ? 'selected' : ''
                  }>${c.name} · ${c.id}</option>`
              )
              .join('')}</select></label>`
          : ''
      }
      ${
        view !== 'cta' && view !== 'cta-monitor'
          ? `<div class="global-ma-controls"><span>이동평균선</span>${[20, 60, 120]
              .map(
                (n) =>
                  `<label><input type="checkbox" data-global-ma="${n}" ${
                    maEnabled.has(n) ? 'checked' : ''
                  }><i style="background:${th.maColors[n]}"></i> ${n}일</label>`
              )
              .join('')}<small>단순평균 · 실제 관측일 기준</small></div>`
          : view === 'cta-monitor'
          ? '<span class="muted">미국·독일 고정 선물 9상품 · 기존 CTA 전략은 별도 비교</span>'
          : '<span class="muted">기존 미국채 금리 대용 CTA 전략</span>'
      }
    </div>
    ${
      view === 'overview'
        ? overview(d, state)
        : view === 'board'
        ? board(d)
        : view === 'cross'
        ? crossPanel(g)
        : view === 'cta'
        ? ctaPanel(d)
        : view === 'cta-monitor'
        ? '<div id="cta-monitor-mount"></div>'
        : trends(d)
    }
    ${view === 'cta' || view === 'cta-monitor' || view === 'cross' ? '' : method(d, state)}`;

  if (view === 'cta-monitor')
    renderCtaMonitor($('#cta-monitor-mount'), {
      api,
      toast,
      getState,
      legacy: () => {
        view = 'cta';
        history.replaceState(null, '', '#treasury/cta');
        renderTreasury();
      },
    });

  bindRangeControls($('#view'), () => renderTreasury());
  enhanceInteractiveCharts($('#view'));

  document.querySelectorAll('[data-ust-view]').forEach(
    (b) =>
      (b.onclick = () => {
        view = b.dataset.ustView;
        history.replaceState(
          null,
          '',
          view === 'cta-monitor'
            ? '#treasury/cta-monitor'
            : view === 'cta'
            ? '#treasury/cta'
            : view === 'cross'
            ? '#treasury/cross'
            : '#treasury'
        );
        renderTreasury();
      })
  );
  document.querySelectorAll('[data-ust-go]').forEach(
    (b) => (b.onclick = () => setTab(b.dataset.ustGo))
  );
  document.querySelectorAll('[data-ust-focus]').forEach(
    (b) =>
      (b.onclick = () => {
        focus = b.dataset.ustFocus;
        view = 'trends';
        renderTreasury();
        $('#view').scrollIntoView({ block: 'start' });
      })
  );
  if ($('#global-country'))
    $('#global-country').onchange = (e) => {
      globalCountry = e.target.value;
      saveGlobalView();
      renderTreasury();
    };
  document.querySelectorAll('[data-global-ma]').forEach(
    (input) =>
      (input.onchange = () => {
        const n = +input.dataset.globalMa;
        if (input.checked) maEnabled.add(n);
        else maEnabled.delete(n);
        saveGlobalView();
        renderTreasury();
      })
  );
  if ($('#cross-country-a')) {
    const update = () => {
      normalizeCross(g);
      saveGlobalView();
      renderTreasury();
    };
    $('#cross-country-a').onchange = (e) => {
      crossA = e.target.value;
      update();
    };
    $('#cross-country-b').onchange = (e) => {
      crossB = e.target.value;
      update();
    };
    $('#cross-tenor').onchange = (e) => {
      crossTenor = +e.target.value;
      update();
    };
    $('#cross-window').onchange = (e) => {
      crossWindow = +e.target.value;
      update();
    };
    $('#cross-swap').onclick = () => {
      [crossA, crossB] = [crossB, crossA];
      update();
    };
    $('#cross-sort').value = crossSort;
    $('#cross-sort').onchange = (e) => {
      crossSort = e.target.value;
      renderTreasury();
    };
    document.querySelectorAll('[data-cross-a]').forEach(
      (button) =>
        (button.onclick = () => {
          crossA = button.dataset.crossA;
          crossB = button.dataset.crossB;
          update();
        })
    );
    $('#cross-board-export').onclick = () =>
      download(
        `FITD-cross-country-${crossTenor}Y-${crossWindow}D.csv`,
        ['A', 'B', 'tenor_years', 'as_of', 'spread_bp', 'change_1d_bp', 'mean_bp', 'sd_bp', 'z', 'window'],
        crossRows(g).map((r) => [
          r.a,
          r.b,
          r.tenor,
          r.as_of,
          r.value_bp,
          r.change_1d_bp,
          r.mean_bp,
          r.sd_bp,
          r.z,
          r.window,
        ])
      );
    $('#cross-history-export').onclick = () => {
      const r = normalizeCross(g),
        mas = [20, 60, 120].map((n) => movingAverage(r.history, n)),
        aMap = new Map(sourceSeries(g, r.code_a)),
        bMap = new Map(sourceSeries(g, r.code_b));
      download(
        `FITD-${r.a}-${r.b}-${r.tenor}Y-spread.csv`,
        [
          'date',
          'A',
          'B',
          'tenor_years',
          'A_yield_pct',
          'B_yield_pct',
          'spread_bp',
          'rolling_mean_bp',
          'rolling_sd_bp',
          'rolling_z',
          'MA20_bp',
          'MA60_bp',
          'MA120_bp',
          'window',
        ],
        r.stats
          .filter((x) => x[0] >= g.visible_start)
          .map((x) => {
            const i = r.history.findIndex((h) => h[0] === x[0]);
            return [
              x[0],
              r.a,
              r.b,
              r.tenor,
              aMap.get(x[0]),
              bMap.get(x[0]),
              x[1],
              x[2],
              x[3],
              finite(x[2]) && x[3] > 1e-10 ? (x[1] - x[2]) / x[3] : null,
              ...mas.map((m) => m[i][1]),
              r.window,
            ];
          })
      );
    };
  }
  document.querySelectorAll('[data-ust-compare]').forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset.ustCompare;
        if (comparisons.has(k)) {
          if (comparisons.size > 1) comparisons.delete(k);
        } else comparisons.add(k);
        renderTreasury();
      })
  );
  document.querySelectorAll('[data-ust-select]').forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.ustSelect;
        renderTreasury();
      })
  );
  if ($('#ust-window')) {
    $('#ust-window').value = String(windowN);
    $('#ust-window').onchange = (e) => {
      windowN = +e.target.value;
      renderTreasury();
    };
    $('#ust-kind').value = kind;
    $('#ust-kind').onchange = (e) => {
      kind = e.target.value;
      renderTreasury();
    };
    $('#ust-sort').value = sort;
    $('#ust-sort').onchange = (e) => {
      sort = e.target.value;
      renderTreasury();
    };
  }
  if ($('#ust-tenor')) {
    $('#ust-tenor').value = focus;
    $('#ust-tenor').onchange = (e) => {
      focus = e.target.value;
      renderTreasury();
    };
  }
  if ($('#ust-level-export'))
    $('#ust-level-export').onclick = () =>
      download(
        `FITD-${d.country?.id || 'US'}-yields-${d.as_of}.csv`,
        [
          'as_of',
          'code',
          'yield_pct',
          'last_observation',
          '1D_bp',
          '3D_bp',
          '1W_bp',
          '1M_bp',
          '3M_bp',
          'YTD_bp',
          ...Object.keys(d.references).map((k) => k + '_reference_date'),
        ],
        d.levels.map((r) => [
          d.as_of,
          r.id,
          r.yield_pct,
          r.last,
          ...['1D', '3D', '1W', '1M', '3M', 'YTD'].map((k) => r.changes[k]),
          ...Object.values(d.references),
        ])
      );
  if ($('#ust-board-export'))
    $('#ust-board-export').onclick = () =>
      download(
        `FITD-US-curve-board-${d.as_of}-${windowN}D.csv`,
        [
          'as_of',
          'id',
          'kind',
          'formula',
          'value_bp',
          'change_1d_bp',
          'mean_bp',
          'sd_bp',
          'z',
          'window_observations',
          'last_observation',
        ],
        boardRows(d).map((r) => {
          const m = r.metrics[String(windowN)];
          return [
            d.as_of,
            r.id,
            r.kind,
            r.formula,
            r.value_bp,
            r.change_1d_bp,
            m.mean_bp,
            m.sd_bp,
            m.z,
            windowN,
            r.last,
          ];
        })
      );
  if ($('#ust-history-export'))
    $('#ust-history-export').onclick = () => {
      const h = d.levels.find((r) => r.id === focus).history,
        mas = [20, 60, 120].map((n) => movingAverage(h, n));
      download(
        `FITD-${focus}-history.csv`,
        ['date', 'yield_pct', 'MA20_pct', 'MA60_pct', 'MA120_pct'],
        h.map((r, i) => [...r, ...mas.map((m) => m[i][1])])
      );
    };
  if ($('#cta-size-form')) {
    bindCtaWeights();
    const updateTenorDraft = () => {
      ctaDraft = [...document.querySelectorAll('[name="cta_tenor"]:checked')]
        .map((x) => +x.value)
        .sort((a, b) => a - b);
      $('#cta-tenor-count').textContent = ctaDraft.length
        ? `${ctaDraft.length}개 선택`
        : '최소 한 개를 선택하세요';
      $('#cta-apply-tenors').disabled =
        !ctaDraft.length || JSON.stringify(ctaDraft) === ctaDraftBasis;
    };
    document.querySelectorAll('[name="cta_tenor"]').forEach(
      (input) => (input.onchange = updateTenorDraft)
    );
    $('#cta-default-tenors').onclick = () => {
      document.querySelectorAll('[name="cta_tenor"]').forEach((input) => {
        input.checked = [10, 30].includes(+input.value) && !input.disabled;
      });
      updateTenorDraft();
    };
    $('#cta-tenor-form').onsubmit = async (e) => {
      e.preventDefault();
      if (!ctaDraft.length) return;
      const button = $('#cta-apply-tenors');
      button.disabled = true;
      button.textContent = '저장 중';
      $('#cta-selection-error').hidden = true;
      try {
        await api('/api/settings', { cta_tenors: [...ctaDraft] });
        toast('CTA 테너를 저장했습니다.');
        await onChange();
      } catch (err) {
        $('#cta-selection-error').hidden = false;
        $('#cta-selection-error').textContent = err.message;
      } finally {
        if ($('#cta-apply-tenors')) {
          $('#cta-apply-tenors').textContent = '선택 적용';
          updateTenorDraft();
        }
      }
    };
    $('#cta-size-form').onsubmit = (e) => {
      e.preventDefault();
      const v = Number($('#cta-base').value);
      if (!(v >= 1 && v <= 1e7)) return;
      ctaBase = v;
      try {
        localStorage.setItem('fitd-cta-base-dv01-usd', String(v));
      } catch {}
      renderTreasury();
    };
    $('#cta-clear-base').onclick = () => {
      ctaBase = null;
      try {
        localStorage.removeItem('fitd-cta-base-dv01-usd');
      } catch {}
      renderTreasury();
    };
    document.querySelectorAll('[data-cta-focus]').forEach(
      (b) =>
        (b.onclick = () => {
          ctaFocus = b.dataset.ctaFocus;
          renderTreasury();
        })
    );
    const c = d.cta;
    if ($('#cta-cost-form')) {
      $('#cta-cost-form').onsubmit = (e) => {
        e.preventDefault();
        const v = Number($('#cta-cost').value);
        if (!Number.isFinite(v) || v < 0 || v > 5) return;
        ctaCost = v;
        try {
          localStorage.setItem('fitd-cta-cost-bp', String(v));
        } catch {}
        renderTreasury();
      };
      $('#cta-performance-year').onchange = (e) => {
        ctaYear = e.target.value;
        renderTreasury();
      };
      $('#cta-pnl-export').onclick = () => {
        const v = calculatePerformance(c.performance, ctaCost, ctaBase || 1000, ctaYear);
        downloadCta(
          `FITD-CTA-daily-PnL-${ctaYear}-${c.as_of}.csv`,
          [
            'date',
            'gross_USD',
            'cost_USD',
            'net_USD',
            'cumulative_net_USD',
            'drawdown_USD',
            'base_DV01_USD_per_bp',
            'one_way_cost_bp',
            ...v.codes.flatMap((code) => [
              code + '_gross_USD',
              code + '_cost_USD',
              code + '_net_USD',
            ]),
          ],
          v.daily.map((r) => [
            r.date,
            r.gross,
            r.cost,
            r.net,
            r.cumulative,
            r.drawdown,
            v.baseDV01,
            v.costBp,
            ...v.codes.flatMap((code) => [
              r.assets[code].gross,
              r.assets[code].cost,
              r.assets[code].net,
            ]),
          ])
        );
      };
      $('#cta-performance-export').onclick = () => {
        const v = calculatePerformance(c.performance, ctaCost, ctaBase || 1000, 'ALL');
        downloadCta(
          `FITD-CTA-annual-PnL-${c.as_of}.csv`,
          [
            'year',
            'net_USD',
            ...v.codes.map((code) => code + '_net_USD'),
            'gross_USD',
            'cost_USD',
            'base_DV01_USD_per_bp',
            'one_way_cost_bp',
          ],
          v.annual.map((r) => [
            r.year,
            r.net,
            ...v.codes.map((code) => r.assets[code]),
            r.gross,
            r.cost,
            v.baseDV01,
            v.costBp,
          ])
        );
      };
    }
    $('#cta-target-export').onclick = () =>
      downloadCta(
        `FITD-US-CTA-targets-${c.as_of}.csv`,
        [
          'signal_date',
          'current_signal_date',
          'code',
          'yield_pct',
          'current_book_x',
          'next_book_x',
          'delta_book_x',
          'base_DV01_USD_per_bp',
          'current_DV01_USD_per_bp',
          'next_DV01_USD_per_bp',
          'delta_DV01_USD_per_bp',
          'raw_signal',
          'vol_lever',
          'current_risk_weight',
          'next_risk_weight',
          'raw_sleeve_target',
          'band_sleeve_target',
          'action',
          'source_proxy',
        ],
        c.sleeves.map((r) => [
          c.as_of,
          r.current_signal_date,
          r.id,
          r.yield_pct,
          r.current_book,
          r.next_book,
          r.book_delta,
          ctaBase,
          ctaBase && r.current_book != null ? r.current_book * ctaBase : null,
          ctaBase && r.next_book != null ? r.next_book * ctaBase : null,
          ctaBase && r.book_delta != null ? r.book_delta * ctaBase : null,
          r.ensemble,
          r.lever,
          r.current_weight,
          r.weight,
          r.raw_target,
          r.band_target,
          r.action,
          'KIS_CASH_YIELD_NOT_ROLL_ADJUSTED',
        ])
      );
    $('#cta-history-export').onclick = () => {
      const r = c.sleeves.find((r) => r.id === ctaFocus) || c.sleeves[0];
      if (!r) return;
      downloadCta(
        `FITD-US-CTA-${r.id}-history.csv`,
        c.history_columns.concat([
          'base_DV01_USD_per_bp',
          'current_DV01_USD_per_bp',
          'next_DV01_USD_per_bp',
        ]),
        r.history.map((h) =>
          h.concat([
            ctaBase,
            ctaBase && h[10] != null ? h[10] * ctaBase : null,
            ctaBase && h[11] != null ? h[11] * ctaBase : null,
          ])
        )
      );
    };
    $('#cta-log-export').onclick = () =>
      downloadCta(
        `FITD-US-CTA-rebalances-${c.as_of}.csv`,
        ['signal_date', 'code', 'current_book_x', 'next_book_x', 'delta_book_x', 'reason'],
        c.rebalance_log.map((r) => [
          r.date,
          r.code,
          r.current_book,
          r.next_book,
          r.book_delta,
          r.reason,
        ])
      );
  }
}
