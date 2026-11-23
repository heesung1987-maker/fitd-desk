import { PAIR_SORTS, sortPairs } from './pair-sort.js';
import { configureTreasury, renderTreasury } from './treasury.js?v=13';
import { configureMomentum, renderMomentum as renderMomentumView } from './momentum.js?v=12';
import { configureHoldings, renderHoldings, openHoldingDialog } from './holdings.js?v=12';
import { configureMomentumStrategy, renderMomentumStrategy } from './momentum-strategy.js?v=12';
import {
  renderRangeControls,
  bindRangeControls,
  filterSeriesByRange,
  getChartTheme,
  enhanceInteractiveCharts,
} from './chart-utils.js?v=11';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

const num = (v, d = 2) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });

const signed = (v, d = 2) => (v == null ? '—' : (v > 0 ? '+' : '') + num(v, d));

const labels = {
  PRIMARY: 'PRIMARY',
  SHADOW: 'SHADOW',
  WATCH: '관찰',
  BETA_BLOCK: 'β 범위 이탈',
  SHOCK_HOLD: '확대 보류',
  WAIT_RESET: '리셋 대기',
  RESET_TODAY: '리셋 확인',
  STOP_ZONE: '손절 구간',
  PROXY_REVIEW: '대체 소스 확인',
  STALE_DATA: '기준일 누락',
  DATA_MISSING: '데이터 부족',
  HEDGE_REVIEW: '헤지 확인',
  PAUSED: '진입 중지',
};

const hold = ['SHOCK_HOLD', 'WAIT_RESET', 'RESET_TODAY'];
let calendarFilter = 'UPCOMING';
let state = null;
let tab = location.hash.startsWith('#treasury')
  ? 'treasury'
  : location.hash === '#mom-strategy' || location.hash === '#mom_strategy'
  ? 'mom_strategy'
  : location.hash === '#book'
  ? 'book'
  : location.hash.startsWith('#momentum')
  ? 'momentum'
  : 'rv';
let selected = null;
let assetClass = 'ALL';
let status = 'ALL';
let search = '';
let page = 0;
let pageSize = 15;
let detailExpanded = false;
let pairSort = 'priority';
let pairSortDirection = 'desc';

try {
  const saved = JSON.parse(localStorage.getItem('fitd-pair-sort') || 'null');
  if (
    saved &&
    PAIR_SORTS.some(([k]) => k === saved.key) &&
    ['asc', 'desc'].includes(saved.direction)
  ) {
    pairSort = saved.key;
    pairSortDirection = saved.direction;
  }
} catch {}

// Theme Management
function applyTheme(theme) {
  if (!['light', 'slate', 'dark'].includes(theme)) theme = 'light';
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('fitd-theme', theme);
  } catch {}
  $$('[data-theme-btn]').forEach((b) =>
    b.classList.toggle('on', b.dataset.themeBtn === theme)
  );
  if (state) render();
}

$$('[data-theme-btn]').forEach((b) => {
  b.onclick = () => applyTheme(b.dataset.themeBtn);
});
applyTheme(document.documentElement.getAttribute('data-theme') || 'light');

// Data Source Mode Management ('close' = FITD Daily Close, 'live' = Bloomberg 15m Live Overlay)
let dataMode = 'live';
try {
  const savedMode = localStorage.getItem('fitd-data-mode');
  if (savedMode === 'live' || savedMode === 'close') dataMode = savedMode;
} catch {}

// Live Z-Score Basis ('prerefit' = 전일 종가를 실시간으로 대체 · Refit 전 모형, 'refit' = 전일 종가 확정 · Refit된 모형)
let liveZBasis = 'prerefit';
try {
  const savedBasis = localStorage.getItem('fitd-live-z-basis');
  if (savedBasis === 'prerefit' || savedBasis === 'refit') liveZBasis = savedBasis;
} catch {}

function syncModeButtons() {
  $$('[data-mode-btn]').forEach((b) =>
    b.classList.toggle('on', b.dataset.modeBtn === dataMode)
  );
  const zSwitcher = $('#z-basis-switcher');
  if (zSwitcher) {
    zSwitcher.hidden = dataMode !== 'live';
  }
  $$('[data-z-basis-btn]').forEach((b) =>
    b.classList.toggle('on', b.dataset.zBasisBtn === liveZBasis)
  );
  document.documentElement.setAttribute('data-live-mode', dataMode);
  document.documentElement.setAttribute('data-z-basis', liveZBasis);
}
syncModeButtons();

function applyLiveZBasis(d) {
  if (!d || d.data_mode !== 'live' || !Array.isArray(d.rows)) return;
  const rowMap = {};
  for (const r of d.rows) {
    rowMap[r.id] = r;
    if (!r.z_modes) continue;
    if (!r._base_hist_prior && d.histories && Array.isArray(d.histories[r.id])) {
      r._base_hist_prior = d.histories[r.id].filter(
        (pt) => pt.date !== d.base_as_of && pt.date !== d.as_of
      );
    }
    const md = r.z_modes[liveZBasis] || r.z_modes.prerefit || r.z_modes.refit;
    if (!md) continue;
    for (const [k, v] of Object.entries(md)) {
      if (k !== 'history_pt') r[k] = v;
    }
    if (r._base_hist_prior && d.histories) {
      if (liveZBasis === 'prerefit') {
        d.histories[r.id] = [...r._base_hist_prior, md.history_pt];
      } else {
        d.histories[r.id] = [
          ...r._base_hist_prior,
          ...(r.history_close_pt ? [r.history_close_pt] : []),
          md.history_pt,
        ];
      }
    }
  }
  if (Array.isArray(d.positions)) {
    for (const pos of d.positions) {
      if (pos.status !== 'OPEN') continue;
      const pid = pos.pair_id || (pos.leg2 ? `${pos.leg1}-${pos.leg2}` : pos.leg1);
      const pr = rowMap[pid] || (pos.leg2 ? rowMap[`${pos.leg2}-${pos.leg1}`] : null);
      if (pr) {
        pos.current_oos_z = pr.oos_z;
        pos.current_refit_z = pr.refit_z;
        if (pos.model_monitor) {
          pos.model_monitor.current_beta = pr.beta;
          if (Number.isFinite(pos.fixed_z)) {
            pos.model_monitor.gap_abs = Math.abs(pos.fixed_z - pr.oos_z);
          }
        }
      }
    }
  }
}

function setLiveZBasis(nextBasis) {
  if (!['prerefit', 'refit'].includes(nextBasis)) return;
  liveZBasis = nextBasis;
  try {
    localStorage.setItem('fitd-live-z-basis', liveZBasis);
  } catch {}
  syncModeButtons();
  if (state && state.data_mode === 'live') {
    applyLiveZBasis(state);
    render();
    toast(
      liveZBasis === 'prerefit'
        ? '🔄 [Refit 전 Z (종가 대체)] 적용: 전일 종가 모형(Refit 전)에 현재 실시간 가격을 대입합니다.'
        : '📐 [Refit된 Z (모형 갱신)] 적용: 전일 종가까지 70일 모형을 Refit한 뒤 오늘 실시간 가격을 평가합니다.'
    );
  }
}

$$('[data-z-basis-btn]').forEach((b) => {
  b.onclick = () => setLiveZBasis(b.dataset.zBasisBtn);
});

async function setDataMode(nextMode) {
  if (!['close', 'live'].includes(nextMode)) return;
  dataMode = nextMode;
  try {
    localStorage.setItem('fitd-data-mode', dataMode);
  } catch {}
  syncModeButtons();
  try {
    await api('/api/data-mode', {
      mode: dataMode,
      force_refresh: false,
    });
    await load(true);
    toast(
      dataMode === 'live'
        ? `⚡ 블룸버그 실시간 모드 활성화 (${liveZBasis === 'prerefit' ? 'Refit 전 · 종가 대체' : 'Refit 후 · 시계열 추가'} · 15분 주기)`
        : `📊 FITD 전일 종가 기준(${state?.as_of || ''}) 모드로 전환되었습니다.`
    );
  } catch (e) {
    toast('데이터 모드 전환 오류: ' + e.message);
  }
}

$$('[data-mode-btn]').forEach((b) => {
  b.onclick = () => setDataMode(b.dataset.modeBtn);
});

function changePairSort(key, direction = pairSortDirection) {
  pairSort = key;
  pairSortDirection = direction;
  page = 0;
  try {
    localStorage.setItem('fitd-pair-sort', JSON.stringify({ key, direction }));
  } catch {}
  renderTable();
}

function tag(s) {
  const cls =
    s === 'PRIMARY'
      ? 'primary'
      : s === 'SHADOW'
      ? 'shadow'
      : hold.includes(s)
      ? 'hold'
      : [
          'BETA_BLOCK',
          'STOP_ZONE',
          'DATA_MISSING',
          'STALE_DATA',
          'PROXY_REVIEW',
          'HEDGE_REVIEW',
        ].includes(s)
      ? 'block'
      : '';
  return `<span class="tag ${cls}">${esc(labels[s] || s)}</span>`;
}

function toast(msg) {
  $('#toast').textContent = msg;
  $('#toast').style.display = 'block';
  setTimeout(() => ($('#toast').style.display = 'none'), 5000);
}

async function api(path, body) {
  let reqPath = path;
  if (
    !body &&
    (reqPath.startsWith('/api/state') ||
      reqPath.startsWith('/api/momentum-strategy') ||
      reqPath.startsWith('/api/momentum-cta') ||
      reqPath.startsWith('/api/cta-monitor')) &&
    !reqPath.includes('mode=')
  ) {
    reqPath += (reqPath.includes('?') ? '&' : '?') + 'mode=' + encodeURIComponent(dataMode);
  }
  const r = await fetch(reqPath, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const v = await r.json().catch(() => ({ error: '응답 형식 오류' }));
  if (!r.ok) throw Error(v.error || `HTTP ${r.status}`);
  return v;
}

function showNotice(msg) {
  $('#notice').hidden = !msg;
  $('#notice').textContent = msg || '';
}

async function load(forceRepaint = false) {
  try {
    let d = await api(
      '/api/state' +
        (!forceRepaint && state && state.data_mode === dataMode
          ? '?since=' + encodeURIComponent(state.updated_at)
          : '')
    );
    let repaint = true;
    if (d.unchanged && state && !forceRepaint) {
      repaint =
        JSON.stringify(d.events) !== JSON.stringify(state.events) ||
        JSON.stringify(d.config) !== JSON.stringify(state.config) ||
        (['book', 'momentum', 'mom_strategy'].includes(tab) &&
          JSON.stringify(d.positions) !== JSON.stringify(state.positions));
      d = { ...state, ...d };
    }
    if (!d.rows) {
      $('#loading p').textContent = '수집기에서 첫 계산 결과가 도착하면 자동으로 표시됩니다.';
      return;
    }
    if (d.events?.some((e) => e.related_pair_ids)) {
      for (const r of d.rows) {
        r.events = d.events.filter(
          (e) =>
            e.related_pair_ids.includes(r.id) &&
            eventStatus(e) !== 'COMPLETED' &&
            ['오늘', '내일'].includes(e.when)
        );
      }
    }
    applyLiveZBasis(d);
    state = d;
    syncModeButtons();
    selected =
      selected && d.rows.some((r) => r.id === selected)
        ? selected
        : (
            d.rows.find((r) => r.status === 'PRIMARY') ||
            d.rows.find((r) => r.statistical_signal) ||
            d.rows[0]
          )?.id;

    $('#loading').hidden = true;
    $('#view').hidden = false;
    if (d.data_mode === 'live') {
      $('#asof').innerHTML = `${esc(d.as_of)} <span class="live-pill">LIVE</span>`;
      $('#updated').textContent = `전일종가 ${d.base_as_of || '—'} + BBG 실시간 (${String(
        d.updated_at
      ).slice(11, 19)} KST · 15분 주기)`;
      $('#connection').textContent = '● BBG 실시간 연동 (15m)';
      $('#connection').classList.remove('offline');
      $('#connection').classList.add('live-conn');
    } else {
      $('#asof').textContent = d.as_of;
      $('#updated').textContent =
        'FITD 종가 · 계산 ' + String(d.updated_at).slice(5, 16).replace('T', ' ') + ' KST';
      $('#connection').textContent = '● FITD 종가 스냅샷';
      $('#connection').classList.remove('offline', 'live-conn');
    }

    let warning = [];
    if (d.heartbeat?.error) warning.push(d.heartbeat.error);
    if (d.pending_config) warning.push('설정 변경 반영 대기 중입니다.');
    showNotice(warning.join(' '));
    if (repaint || forceRepaint) render();
  } catch (e) {
    showNotice('대시보드 연결 실패: ' + e.message);
  }
}

const titles = {
  treasury: [
    'GLOBAL RATES MARKET',
    '글로벌 금리',
    '국가별 금리·커브와 동일 테너 국가간 스프레드의 이격·분포를 확인합니다.',
    'Global Rates',
  ],
  rv: [
    'RELATIVE VALUE MONITOR',
    '통계적 차익거래',
    '진입 후보, 대기 조건과 포지션 위험을 함께 확인합니다.',
    'Relative Value',
  ],
  mom_strategy: [
    'MOMENTUM STRATEGY & FX STRESS REGIME',
    '모멘텀 전략',
    'FX 스트레스 지수 기반 국면별 동적 파라미터 운용 · 국가 커브 대표 테너 DV01 배분 · 보유 포지션 규모 조정 및 포지션 모니터 연동',
    'Momentum Strategy',
  ],
  book: [
    'POSITION MONITOR',
    '보유 포지션',
    '금리 합산 민감도와 FX USD mio로 보유·청산·손익 이력을 관리합니다.',
    'Positions',
  ],
  momentum: [
    'MOMENTUM & BACKTEST',
    '모멘텀 모니터',
    '금리 A/B와 선물·CTA 결합 연구의 진입 계획 및 연도별 성과를 확인합니다.',
    'Momentum',
  ],
  events: [
    'EVENT CALENDAR',
    '이벤트 캘린더',
    '관련 국가와 통화에 중요한 당일·익일 일정을 확인합니다.',
    'Events',
  ],
  data: [
    'DATA OPERATIONS',
    '데이터 상태',
    '원천 데이터, 변환과 기준일 누락을 확인합니다.',
    'Data Status',
  ],
  settings: [
    'MODEL CONTROLS',
    '모델 설정',
    '진입 규칙과 수집 주기를 관리합니다.',
    'Model Settings',
  ],
};

function setTab(t) {
  tab = t;
  if (t === 'book') history.replaceState(null, '', '#book');
  else if (t === 'mom_strategy') history.replaceState(null, '', '#mom-strategy');
  else if (t === 'momentum') {
    if (!location.hash.startsWith('#momentum')) history.replaceState(null, '', '#momentum');
  } else if (
    (location.hash === '#book' || location.hash === '#mom-strategy' || location.hash === '#mom_strategy' || location.hash.startsWith('#momentum')) &&
    t !== 'treasury'
  ) {
    history.replaceState(null, '', '#' + t);
  }
  $$('.nav').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  const v = titles[t];
  $('#eyebrow').textContent = v[0];
  $('#title').textContent = v[1];
  $('#subtitle').textContent = v[2];
  $('#crumb').textContent = v[3];
  if (state) render();
}

$$('[data-tab]').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

function stats(items) {
  return `<div class="stats">${items
    .map(
      ([l, n, h, c]) =>
        `<div class="stat">
          <div class="label">${esc(l)}<span>${c === 'green' ? '↗' : '·'}</span></div>
          <div class="num ${c || ''}">${n}</div>
          <div class="help">${esc(h)}</div>
        </div>`
    )
    .join('')}</div>`;
}

function render() {
  ({
    treasury: renderTreasury,
    rv: renderRV,
    mom_strategy: () => renderMomentumStrategy($('#view')),
    book: renderBook,
    momentum: renderMomentum,
    events: renderEvents,
    data: renderData,
    settings: renderSettings,
  }[tab])();
  enhanceInteractiveCharts($('#view'));
}

function renderRV() {
  const rows = state.rows;
  const fresh = state.quality.filter((q) => q.fresh).length;
  const primaryCount = rows.filter((r) => r.status === 'PRIMARY').length;
  const signalCount = rows.filter((r) => r.statistical_signal).length;
  const holdCount = rows.filter((r) => hold.includes(r.status)).length;
  const betaBlockCount = rows.filter((r) => r.status === 'BETA_BLOCK').length;

  $('#view').innerHTML =
    stats([
      [
        '진입 후보',
        `${primaryCount}<small>PRIMARY</small>`,
        '중복 위험을 조정한 대표 후보',
        'green',
      ],
      [
        '확대 후 대기',
        `${holdCount}<small>PAIRS</small>`,
        '1σ 확대 · 리셋 확인 규칙',
        'orange',
      ],
      [
        'FX |β| 범위 이탈',
        `${betaBlockCount}<small>PAIRS</small>`,
        '진입용 β: 0.4 ≤ |β| ≤ 1.6',
        '',
      ],
      [
        '기준일 관측 자산',
        `${fresh}<small>/ ${state.quality.length}</small>`,
        '휴일 이월값은 별도 확인',
        'blue',
      ],
    ]) +
    `<div class="workspace ${detailExpanded ? 'detail-expanded' : ''}">
      <div>
        <div class="panel">
          <div class="panel-head">
            <h2>페어 모니터 <span class="count">${rows.length} pairs</span></h2>
            <div class="control-buttons">
              ${
                state.data_mode === 'live'
                  ? `<div class="segmented z-basis-inline" role="group" aria-label="실시간 Z-Score 기준 선택">
                      <button type="button" data-z-basis-inline="prerefit" class="${
                        liveZBasis === 'prerefit' ? 'on' : ''
                      }" title="전일 종가 모형(Refit 전) 유지 · 전일 종가를 현재 실시간 데이터로 대체">🔄 Refit 전 Z (종가 대체)</button>
                      <button type="button" data-z-basis-inline="refit" class="${
                        liveZBasis === 'refit' ? 'on' : ''
                      }" title="전일 종가까지 70일 모형 Refit 반영 · 오늘 실시간 데이터를 새 점으로 추가">📐 Refit된 Z (모형 갱신)</button>
                    </div>`
                  : `<small>OOS · 전일 고정 모형</small>`
              }
              <button class="btn quiet" id="toggle-detail-size">${
                detailExpanded ? '◫ 좌우 분할 보기' : '⤢ 상세 차트 넓게 보기'
              }</button>
              <button class="btn primary" id="register-any">+ 보유 등록</button>
            </div>
          </div>
          <div class="filters">
            <div class="segmented" id="classes">
              ${['ALL', 'FX', 'Rates', 'Commodity']
                .map(
                  (c) =>
                    `<button data-class="${c}" class="${
                      assetClass === c ? 'on' : ''
                    }">${c === 'ALL' ? '전체' : c === 'Commodity' ? '원자재' : c}</button>`
                )
                .join('')}
            </div>
            <select aria-label="진입 상태 필터" id="status">
              <option value="ALL">모든 상태 (${rows.length})</option>
              <option value="PRIMARY">PRIMARY (${primaryCount})</option>
              <option value="SIGNAL">통계 시그널 (${signalCount})</option>
              <option value="HOLD">확대 후 대기 (${holdCount})</option>
              <option value="BETA_BLOCK">β 범위 이탈 (${betaBlockCount})</option>
              <option value="WATCH">관찰</option>
              <option value="DATA">데이터 확인</option>
            </select>
            <label class="muted" style="display:flex;align-items:center;gap:6px">
              표시
              <select id="page-size" aria-label="페이지당 행 수">
                <option value="10">10개</option>
                <option value="15">15개</option>
                <option value="30">30개</option>
                <option value="999">전체</option>
              </select>
            </label>
            <input aria-label="페어 검색" id="search" placeholder="페어명 검색..." value="${esc(
              search
            )}">
          </div>
          <div id="pair-table"></div>
        </div>
        <div class="panel below">
          <div class="panel-head">
            <h2>예정 이벤트 · ${esc(getEventTodayKst())}</h2>
            <button class="btn quiet" id="all-events">전체 일정 ↗</button>
          </div>
          <div class="event-strip">${eventCards()}</div>
          <div class="rule-note">이벤트는 알림으로만 사용합니다. 진입 차단·사이즈 제한에는 반영하지 않습니다.</div>
        </div>
      </div>
      <div class="panel detail" id="detail"></div>
    </div>`;

  $('#status').value = status;
  $('#status').onchange = (e) => {
    status = e.target.value;
    page = 0;
    renderTable();
  };
  $('#page-size').value = String(pageSize);
  $('#page-size').onchange = (e) => {
    pageSize = +e.target.value;
    page = 0;
    renderTable();
  };
  $('#search').oninput = (e) => {
    search = e.target.value;
    page = 0;
    renderTable();
  };
  $$('[data-class]').forEach((b) => {
    b.onclick = () => {
      assetClass = b.dataset.class;
      page = 0;
      renderRV();
    };
  });
  $('#toggle-detail-size').onclick = () => {
    detailExpanded = !detailExpanded;
    renderRV();
  };
  $$('[data-z-basis-inline]').forEach((b) => {
    b.onclick = () => setLiveZBasis(b.dataset.zBasisInline);
  });
  $('#all-events').onclick = () => setTab('events');
  $('#register-any').onclick = () =>
    openHoldingDialog(state.rows.find((r) => r.id === selected));

  renderTable();
  renderDetail();
}

function getEventTodayKst() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const liveKst = ['year', 'month', 'day']
      .map((k) => parts.find((p) => p.type === k)?.value || '')
      .join('-');
    if (liveKst.length === 10) return liveKst;
  } catch {}
  return state?.event_today || new Date().toISOString().slice(0, 10);
}

function getEventTomorrowKst(todayStr) {
  const base = todayStr || getEventTodayKst();
  return new Date(new Date(base + 'T00:00:00Z').getTime() + 86400000)
    .toISOString()
    .slice(0, 10);
}

function eventStatus(e) {
  const ds = String(e?.date || '').trim();
  if (ds.length > 10) {
    const ts = Date.parse(ds.replace(' ', 'T') + '+09:00');
    if (Number.isFinite(ts)) {
      return ts <= Date.now() ? 'COMPLETED' : 'UPCOMING';
    }
  }
  if (ds.length === 10) {
    return ds < getEventTodayKst() ? 'COMPLETED' : 'TIME_UNKNOWN';
  }
  return e?.status || 'TIME_UNKNOWN';
}

function eventWhen(e) {
  if (eventStatus(e) === 'COMPLETED') return '지난 일정';
  const d10 = String(e?.date || '').slice(0, 10);
  const today = getEventTodayKst();
  const tomorrow = getEventTomorrowKst(today);
  if (d10 === today) return '오늘';
  if (d10 === tomorrow) return '내일';
  return d10 || e?.when || '예정';
}

function upcomingEvents(list) {
  return (list || []).filter((e) => eventStatus(e) !== 'COMPLETED');
}

function eventLocal(e) {
  if (e.local_date) return e.local_date;
  const dt = new Date(
    e.date.replace(' ', 'T') + (e.date.length > 10 ? '+09:00' : 'T00:00:00+09:00')
  );
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: e.currency === 'USD' ? 'America/New_York' : 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dt);
  return ['year', 'month', 'day']
    .map((k) => parts.find((p) => p.type === k).value)
    .join('-');
}

function eventCards() {
  const today = getEventTodayKst();
  const tomorrow = getEventTomorrowKst(today);
  const events = (state.events || [])
    .filter(
      (e) =>
        [today, tomorrow].includes(e.date.slice(0, 10)) &&
        eventStatus(e) !== 'COMPLETED'
    )
    .sort((a, b) => a.date.localeCompare(b.date) || b.importance - a.importance)
    .slice(0, 3);
  return events.length
    ? events
        .map(
          (e) =>
            `<div class="event-card">
              <div class="when">${
                e.date.startsWith(today) ? '오늘' : '내일'
              } ${esc(e.date.slice(11, 16) || '시간 미정')} KST <span class="tag hold">중요도 ${
              e.importance
            }</span></div>
              <h3>${esc(e.title)}</h3>
              <p>${esc(e.country)} · 현지 ${eventLocal(e)} · 예정</p>
            </div>`
        )
        .join('')
    : '<div class="empty">오늘·내일 남은 중요 일정이 없습니다. 발표 완료 일정은 캘린더에서 확인하세요.</div>';
}

function filtered() {
  return state.rows.filter(
    (r) =>
      (assetClass === 'ALL' || r.asset_class === assetClass) &&
      (!search || r.name.toLowerCase().includes(search.toLowerCase())) &&
      (status === 'ALL' ||
        r.status === status ||
        (status === 'SIGNAL' && r.statistical_signal) ||
        (status === 'HOLD' && hold.includes(r.status)) ||
        (status === 'DATA' &&
          ['STALE_DATA', 'DATA_MISSING', 'PROXY_REVIEW'].includes(r.status)))
  );
}

function zGaugeHtml(z, r = null) {
  if (!Number.isFinite(z)) return '—';
  const pct = Math.min(100, (Math.abs(z) / 4.0) * 100);
  const fill =
    Math.abs(z) >= 2.7
      ? z > 0
        ? 'var(--orange)'
        : 'var(--green)'
      : 'var(--blue)';
  let subCompare = '';
  if (state?.data_mode === 'live' && r?.z_modes) {
    const otherZ =
      liveZBasis === 'prerefit'
        ? r.z_modes.refit?.oos_z
        : r.z_modes.prerefit?.oos_z;
    const otherLbl = liveZBasis === 'prerefit' ? 'Refit후' : 'Refit전';
    subCompare = `<div class="pair-sub" style="font-size:10.5px;margin-top:2px">${otherLbl} ${signed(
      otherZ
    )} · 종가 ${signed(r.prev_close_oos_z)}</div>`;
  }
  return `<div class="z-cell-wrap">
    <span class="z ${z > 0 ? 'orange' : 'green'}">${signed(z)}</span>
    <span class="z-gauge"><span class="z-gauge-fill" style="width:${pct.toFixed(
      0
    )}%;background:${fill}"></span></span>
  </div>${subCompare}`;
}

function renderTable() {
  const rows = sortPairs(filtered(), pairSort, pairSortDirection);
  const size = pageSize;
  page = Math.max(0, Math.min(page, Math.ceil(rows.length / size) - 1));
  $('#pair-table').innerHTML = `
    <div class="filters sort-controls">
      <label for="pair-sort">정렬 기준</label>
      <select id="pair-sort" aria-label="페어 정렬 기준">
        ${PAIR_SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <select id="pair-sort-direction" aria-label="페어 정렬 방향" ${
        pairSort === 'priority' ? 'disabled' : ''
      }>
        <option value="desc">내림차순 ↓</option>
        <option value="asc">오름차순 ↑</option>
      </select>
      <span class="muted">행 클릭 시 우측 시계열 상세 갱신 · 진입 기준 ±${
        state.applied_config.entry_z
      }σ</span>
    </div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>페어 / 자산군</th>
            <th class="number" aria-sort="${
              pairSort === 'oos_z'
                ? pairSortDirection === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none'
            }">
              <button class="sort-heading" data-pair-sort="oos_z">${
                state.data_mode === 'live'
                  ? liveZBasis === 'prerefit'
                    ? 'OOS Z (Refit전)'
                    : 'OOS Z (Refit된)'
                  : 'OOS Z'
              } ${
                pairSort === 'oos_z'
                  ? pairSortDirection === 'asc'
                    ? '↑'
                    : '↓'
                  : '↕'
              }</button>
            </th>
            <th class="number">Δ|Z|</th>
            <th class="number" aria-sort="${
              pairSort === 'lag_beta'
                ? pairSortDirection === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none'
            }">
              <button class="sort-heading" data-pair-sort="lag_beta">진입 β ${
                pairSort === 'lag_beta'
                  ? pairSortDirection === 'asc'
                    ? '↑'
                    : '↓'
                  : '↕'
              }</button>
            </th>
            <th class="number">품질 Q</th>
            <th>판단</th>
            <th>이벤트</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .slice(page * size, (page + 1) * size)
            .map(
              (r) =>
                `<tr class="pair-row ${
                  r.id === selected ? 'selected' : ''
                }" data-id="${esc(r.id)}" tabindex="0" aria-label="${esc(
                  r.name
                )} 상세">
                  <td>
                    <div class="pair-name">${esc(r.name)}</div>
                    <div class="pair-sub">${esc(r.asset_class)} · ${
                  r.direction_sign > 0 ? 'LONG' : 'SHORT'
                } residual</div>
                  </td>
                  <td class="number">${zGaugeHtml(r.oos_z, r)}</td>
                  <td class="number ${
                    r.delta_abs_z >= 1 ? 'orange' : ''
                  }">${signed(r.delta_abs_z)}</td>
                  <td class="number">${num(r.lag_beta)}</td>
                  <td class="number">${r.quality}<span class="muted">/4</span></td>
                  <td>${tag(r.status)}</td>
                  <td>
                    ${(() => {
                      const up = upcomingEvents(r.events);
                      return `<div class="event-mini" title="${esc(
                        up.map((e) => `${eventWhen(e)} ${e.title}`).join(', ')
                      )}">${
                        up.length
                          ? '● ' + esc(eventWhen(up[0])) + ' ' + up.length + '건'
                          : '—'
                      }</div>`;
                    })()}
                  </td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
    ${rows.length ? '' : `<div class="empty">조건에 맞는 페어가 없습니다.</div>`}
    <div class="table-foot">
      <span>${
        rows.length
          ? `${page * size + 1}–${Math.min((page + 1) * size, rows.length)} / ${
              rows.length
            } pairs`
          : '0 pairs'
      }</span>
      <span>
        <button class="btn quiet" id="prev" ${page === 0 ? 'disabled' : ''}>‹ 이전</button>
        <b>${page + 1} / ${Math.max(1, Math.ceil(rows.length / size))}</b>
        <button class="btn quiet" id="next" ${
          (page + 1) * size >= rows.length ? 'disabled' : ''
        }>다음 ›</button>
      </span>
    </div>`;

  $('#pair-sort').value = pairSort;
  $('#pair-sort-direction').value = pairSortDirection;
  $('#pair-sort').onchange = (e) => changePairSort(e.target.value);
  $('#pair-sort-direction').onchange = (e) =>
    changePairSort(pairSort, e.target.value);
  $$('[data-pair-sort]').forEach(
    (b) =>
      (b.onclick = () =>
        changePairSort(
          b.dataset.pairSort,
          pairSort === b.dataset.pairSort && pairSortDirection === 'desc'
            ? 'asc'
            : 'desc'
        ))
  );
  $$('.pair-row').forEach((el) => {
    const select = () => {
      selected = el.dataset.id;
      renderTable();
      renderDetail();
    };
    el.onclick = select;
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    };
  });
  $('#prev').onclick = () => {
    page--;
    renderTable();
  };
  $('#next').onclick = () => {
    page++;
    renderTable();
  };
}

function chart(series) {
  const data = filterSeriesByRange(
    series,
    'rv-detail',
    (d) => d.date,
    '60D'
  );
  if (!data.length) return '<div class="empty">선택한 기간의 관측 데이터가 없습니다.</div>';

  const th = getChartTheme();
  const w = detailExpanded ? 780 : 420;
  const h = detailExpanded ? 260 : 210;
  const pad = 34;
  const vals = data.flatMap((d) => [d.z, d.refit_z]).filter(Number.isFinite);
  const max = Math.max(4.2, ...vals.map(Math.abs));
  const x = (i) => pad + (i * (w - pad - 18)) / Math.max(1, data.length - 1);
  const y = (v) => 18 + ((max - v) / (2 * max)) * (h - 44);

  function line(key) {
    let s = '',
      pen = false;
    data.forEach((d, i) => {
      if (Number.isFinite(d[key])) {
        s += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(d[key]).toFixed(1);
        pen = true;
      } else pen = false;
    });
    return s;
  }

  const levels = [
    -state.applied_config.stop_z,
    -state.applied_config.entry_z,
    0,
    state.applied_config.entry_z,
    state.applied_config.stop_z,
  ];

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="OOS·Refit Z-score 추이">
    ${levels
      .map(
        (v) =>
          `<line x1="${pad}" x2="${w - 18}" y1="${y(v)}" y2="${y(v)}" stroke="${
            Math.abs(v) === state.applied_config.entry_z
              ? th.orange
              : Math.abs(v) === state.applied_config.stop_z
              ? th.red
              : th.grid
          }" stroke-opacity="${v === 0 ? '0.9' : '0.55'}" stroke-dasharray="${
            v === 0 ? '0' : '4 4'
          }"/>
          <text x="4" y="${y(v) + 4}" fill="${th.text}" font-size="11">${v}</text>`
      )
      .join('')}
    <path d="${line('refit_z')}" fill="none" stroke="${
    th.blue
  }" stroke-width="1.6" stroke-dasharray="3 2" opacity="0.8"/>
    <path d="${line('z')}" fill="none" stroke="${th.orange}" stroke-width="2.4"/>
    ${data
      .map((d, i) =>
        Number.isFinite(d.z)
          ? `<circle cx="${x(i)}" cy="${y(d.z)}" r="4" fill="transparent">
              <title>${d.date}\nOOS Z: ${signed(d.z)}σ\nRefit Z: ${signed(
              d.refit_z
            )}σ\n진입 β: ${num(d.beta)}</title>
            </circle>`
          : ''
      )
      .join('')}
    <text x="${pad}" y="${h - 6}" fill="${th.text}" font-size="11">${
    data[0]?.date || ''
  }</text>
    <text x="${w - 18}" y="${h - 6}" text-anchor="end" fill="${
    th.text
  }" font-size="11">${data.at(-1)?.date || ''}</text>
  </svg>`;
}

function renderDetail() {
  const r = state.rows.find((r) => r.id === selected);
  if (!r) return;
  const rawSeries = state.histories[r.id] || [];
  const minDate = rawSeries[0]?.date || '';
  const maxDate = rawSeries.at(-1)?.date || '';
  const m = (label, value) =>
    `<div><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`;

  $('#detail').innerHTML = `
    <div class="detail-top">
      <div class="detail-label"><span>PAIR DETAIL</span>${tag(r.status)}</div>
      <div class="detail-title">${esc(r.name)}</div>
      <div class="detail-status">${esc(r.reason)}</div>
      <div class="z-summary">
        <div>
          <div class="big-z ${r.oos_z > 0 ? 'orange' : 'green'}">${signed(
    r.oos_z
  )}<span style="font-size:16px"> σ</span></div>
          <div class="z-caption">${
            state.data_mode === 'live'
              ? liveZBasis === 'prerefit'
                ? 'OOS Z · Refit 전 (종가 대체)'
                : 'OOS Z · Refit된 모형 (11/13 반영)'
              : 'OOS Z-score'
          }</div>
        </div>
        <div class="delta">
          <span class="${r.delta_abs_z >= 1 ? 'orange' : ''}">${signed(
    r.delta_abs_z
  )} σ</span>
          <div class="z-caption">${
            state.data_mode === 'live' && Number.isFinite(r.delta_vs_close_z)
              ? `전일 대비 |Z| (종가 대비 ${signed(r.delta_vs_close_z)}σ)`
              : '전일 대비 |Z| 변화'
          }</div>
        </div>
      </div>
      ${
        state.data_mode === 'live' && r.z_modes
          ? `<div class="data-info" style="margin-top:8px;padding:6px 10px;font-size:12px">
              <b>실시간 Z 비교</b> · Refit 전(종가 대체): <b>${signed(
                r.z_modes.prerefit?.oos_z
              )}σ</b> (${labels[r.z_modes.prerefit?.status] || r.z_modes.prerefit?.status})
              &nbsp;|&nbsp; Refit된 Z(모형 갱신): <b>${signed(
                r.z_modes.refit?.oos_z
              )}σ</b> (${labels[r.z_modes.refit?.status] || r.z_modes.refit?.status})
              &nbsp;|&nbsp; 전일 종가(${esc(r.prev_close_as_of)}): <b>${signed(
                r.prev_close_oos_z
              )}σ</b>
            </div>`
          : ''
      }
    </div>
    ${renderRangeControls('rv-detail', {
      presets: [
        ['20D', '20D'],
        ['60D', '60D'],
        ['90D', '90D'],
        ['120D', '120D'],
        ['180D', '180D'],
        ['ALL', '전체'],
      ],
      defaultPreset: '60D',
      minDate,
      maxDate,
      compact: true,
    })}
    <div class="chart">${chart(rawSeries)}</div>
    <div class="chart-note">
      <span><i></i>OOS Z-score</span>
      <span><i class="refit"></i>Refit Z-score</span>
      <span>진입 ±${state.applied_config.entry_z}σ / 손절 ±${
    state.applied_config.stop_z
  }σ</span>
    </div>
    <div class="metrics-grid">
      ${m('진입 β / Refit β', `${num(r.lag_beta)} / ${num(r.beta)}`)}
      ${m('반감기', num(r.half_life, 1) + ' 일')}
      ${m('상관계수 / Q', `${num(r.corr)} / ${r.quality}`)}
      ${m('Refit Z', signed(r.refit_z) + ' σ')}
    </div>
    <div class="actions">
      <div class="leg-action"><span>LEG 1</span><b>${esc(r.actions[0])}</b></div>
      <div class="leg-action"><span>LEG 2</span><b>${esc(r.actions[1])}</b></div>
    </div>
    <div class="risk-list">
      ${[
        ['1σ 변동', r.risk_lines.sigma],
        ['현재 OOS 괴리', r.risk_lines.gap],
        ['진입선', r.risk_lines.entry],
        ['청산선', r.risk_lines.exit],
        ['손절선', r.risk_lines.stop],
        ['손절까지 여유', r.risk_lines.to_stop],
      ]
        .map(
          ([k, v]) => `<div><span>${k}</span><b>${num(v)} ${r.risk_unit}</b></div>`
        )
        .join('')}
      <div>
        <span>Y 적정값 OOS / Refit</span>
        <b>${num(r.oos_fair_y, 4)} / ${num(r.refit_fair_y, 4)}</b>
      </div>
      <small class="muted" style="font-size:12px">X의 현재값을 조건으로 한 Y 원시 호가 적정값</small>
    </div>
    ${(() => {
      const up = upcomingEvents(r.events);
      return up.length
        ? `<div class="detail-event">${up
            .slice(0, 3)
            .map((e) => `${esc(eventWhen(e))} ${esc(e.date.slice(11, 16) || '')} · ${esc(e.title)}`)
            .join('<br>')}<br><span class="muted">이벤트 알림 · 자동 진입 제한 없음</span></div>`
        : '';
    })()}
    <div class="record">
      <button id="record" class="btn ${
        ['Rates', 'FX'].includes(r.asset_class) ? 'primary' : ''
      }" ${!['Rates', 'FX'].includes(r.asset_class) ? 'disabled' : ''}>
        ${
          ['Rates', 'FX'].includes(r.asset_class)
            ? '보유 포지션 등록'
            : '원자재 규모 입력은 별도 검증'
        }
      </button>
    </div>`;

  bindRangeControls($('#detail'), () => renderDetail());
  enhanceInteractiveCharts($('#detail'));
  $('#record').onclick = () => openHoldingDialog(r);
}

function renderBook() {
  renderHoldings($('#view'));
  enhanceInteractiveCharts($('#view'));
}

function renderMomentum() {
  renderMomentumView($('#view'));
  enhanceInteractiveCharts($('#view'));
}

function renderEvents() {
  const todayKst = getEventTodayKst();
  const es = (state.events || []).filter(
    (e) =>
      calendarFilter === 'ALL' ||
      eventStatus(e) === calendarFilter ||
      (calendarFilter === 'UPCOMING' && eventStatus(e) === 'TIME_UNKNOWN')
  );
  const groups = {};
  es.forEach((e) => (groups[e.date.slice(0, 10)] ??= []).push(e));

  $('#view').innerHTML = `
    <div class="research-banner">
      캘린더 조회일 <b>${esc(todayKst)}</b> (KST) · 가격 기준일 ${esc(
    state.as_of
  )}와 분리합니다. 지난 발표는 예정 알림에서 제외합니다.<br>
      미국 일정은 현지 날짜와 한국시간이 다를 수 있습니다. 현지 날짜와 발표 완료 여부를 함께 표시합니다.
    </div>
    <div class="panel">
      <div class="filters">
        <div class="segmented">
          ${[
            ['UPCOMING', '예정'],
            ['COMPLETED', '발표 완료'],
            ['ALL', '전체'],
          ]
            .map(
              ([v, l]) =>
                `<button data-calendar-filter="${v}" class="${
                  calendarFilter === v ? 'on' : ''
                }">${l}</button>`
            )
            .join('')}
        </div>
        <span class="muted">${esc(state.event_timezone)} · 캘린더 수록 ${esc(
    state.calendar_end
  )}</span>
      </div>
    </div>
    ${
      Object.entries(groups)
        .sort()
        .map(
          ([date, events]) =>
            `<div class="calendar-date">한국시간 ${date} ${
              date === todayKst ? '<span class="tag primary">오늘</span>' : ''
            }</div>
            <div class="panel">
              <div class="table-scroll">
                <table class="wide-table">
                  <thead>
                    <tr>
                      <th>한국시간 (KST)</th>
                      <th>현지 날짜</th>
                      <th>발표 상태</th>
                      <th>국가 / 이벤트</th>
                      <th>중요도</th>
                      <th>연관 페어</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${events
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((e) => {
                        const affected =
                          e.related_pair_ids ||
                          state.rows
                            .filter((r) => r.events.some((x) => x.id === e.id))
                            .map((r) => r.id);
                        return `<tr>
                          <td>${esc(e.date.slice(11, 16) || '시간 미정')}</td>
                          <td>${eventLocal(e)}${
                          e.currency === 'USD'
                            ? ' <span class="pair-sub">미국 동부</span>'
                            : ''
                        }</td>
                          <td><span class="tag ${
                            eventStatus(e) === 'COMPLETED' ? '' : 'primary'
                          }">${
                          eventStatus(e) === 'COMPLETED'
                            ? '발표 완료'
                            : eventStatus(e) === 'TIME_UNKNOWN'
                            ? '시간 미정'
                            : '예정'
                        }</span></td>
                          <td>${esc(e.title)}<div class="pair-sub">${esc(
                          e.country
                        )}</div></td>
                          <td><span class="tag ${
                            e.importance === 3 ? 'hold' : ''
                          }">${e.importance === 3 ? 'HIGH' : 'MEDIUM'}</span></td>
                          <td>${
                            affected.length
                              ? `<button class="btn quiet" data-event="${esc(
                                  e.id
                                )}">${affected.length} pairs ↗</button>`
                              : '—'
                          }</td>
                        </tr>`;
                      })
                      .join('')}
                  </tbody>
                </table>
              </div>
            </div>`
        )
        .join('') || '<div class="empty">선택한 구분의 일정이 없습니다.</div>'
    }`;

  $$('[data-calendar-filter]').forEach(
    (b) =>
      (b.onclick = () => {
        calendarFilter = b.dataset.calendarFilter;
        renderEvents();
      })
  );
  $$('[data-event]').forEach(
    (b) =>
      (b.onclick = () => {
        const e = state.events.find((e) => e.id === b.dataset.event);
        const r = state.rows.find(
          (r) =>
            e.related_pair_ids?.includes(r.id) ||
            r.events.some((x) => x.id === e.id)
        );
        if (r) {
          selected = r.id;
          assetClass = 'ALL';
          status = 'ALL';
          search = '';
          page = Math.floor(state.rows.indexOf(r) / pageSize);
          setTab('rv');
        }
      })
  );
}

function renderData() {
  $('#view').innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>원 모델 자산과 FITD 연결</h2>
        <small>${state.quality.length} assets</small>
      </div>
      <div class="data-info">
        가격 기준일 ${state.as_of}. 동일 소스를 기간 전체에 사용합니다. 평일 휴일은 최대 3관측일 이월하되, 기준일 원천값이 없으면 신규 진입을 보류합니다. DB 메타의 bp·pct 표시는 그대로 단위로 가정하지 않고 실제 원시 레벨로 변환합니다.
      </div>
      <div class="table-scroll">
        <table class="wide-table">
          <thead>
            <tr>
              <th>자산</th>
              <th>FITD 소스</th>
              <th>호가 변환</th>
              <th>기간</th>
              <th class="number">관측수</th>
              <th class="number">최신 원시값</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            ${state.quality
              .map(
                (q) =>
                  `<tr>
                    <td class="pair-name">${esc(q.name)}</td>
                    <td>${esc(q.source)}</td>
                    <td>${
                      q.inverse
                        ? '역수 후 원 모델 부호 적용'
                        : q.asset_class === 'Rates'
                        ? '수익률 % ×100 → bp'
                        : '로그 ×100·원 모델 부호'
                    }</td>
                    <td>${esc(q.first || '—')}<div class="pair-sub">~ ${esc(
                    q.last || '—'
                  )}</div></td>
                    <td class="number">${num(q.observations, 0)}</td>
                    <td class="number">${num(
                      q.value,
                      q.asset_class === 'FX' ? 6 : 3
                    )}</td>
                    <td>
                      ${
                        !q.observations
                          ? '<span class="tag block">원천 수록 대기</span>'
                          : !q.fresh
                          ? '<span class="tag hold">원천 갱신 대기</span>'
                          : '<span class="tag primary">관측 확인</span>'
                      }
                      ${q.note ? '<div class="pair-sub">' + esc(q.note) + '</div>' : ''}
                    </td>
                  </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel below">
      <div class="panel-head"><h2>데이터 처리와 한계</h2></div>
      <ul class="research-list">
        <li>당일 진행 중인 일별값을 제외하고 KST 전일까지의 평일 자료를 사용합니다.</li>
        <li>FX JPY·CHF·BRL·MXN·KRW는 역수 변환, CAD는 원 모델의 음수 로그 부호를 유지합니다. (USD_Basket·CNH 제외, CHF 9개 크로스 페어 포함)</li>
        <li>미국 3·7년은 KIS UST3·UST7을 사용합니다. KIS 수록 전에는 대기하며 FRED로 자동 대체하지 않습니다.</li>
        <li>Brent·WTI·Copper는 연속물 월물 및 가격 단위 확인 전 기본 진입 보류입니다.</li>
        <li>원 엑셀 수식과 계산 엔진의 수치 대사는 별도 검증 결과에 보관합니다. FITD와 BBG 원천 가격 차이는 수식 오차와 구분합니다.</li>
      </ul>
    </div>`;
}

function renderSettings() {
  const c = state.config;
  const field = (key, label, note, step = 0.1) =>
    `<label class="setting-row">
      <span>${label}<small>${note}</small></span>
      <input name="${key}" type="number" value="${c[key]}" step="${step}" required>
    </label>`;

  $('#view').innerHTML = `
    <form id="settings-form" class="settings-grid">
      <div class="panel">
        <div class="panel-head"><h2>진입과 위험 규칙</h2></div>
        <div class="settings-body">
          ${field('lookback', 'OLS 관측기간', '원 모델 70일 · 현재일 포함 Refit / 전일 종료 OOS', 1)}
          ${field('entry_z', '진입 |OOS Z|', '최소 품질·반감기 조건도 함께 적용')}
          ${field('exit_z', '청산 |Z|', '가상 보유는 진입 시 고정모형으로 모니터')}
          ${field('stop_z', '손절 |Z|', '신규 진입은 손절선 미만으로 제한')}
          ${field('beta_min', 'FX 진입 |β| 하한', '전일 고정모형 β의 절대값 · 부호는 leg 방향에 반영')}
          ${field('beta_max', 'FX 진입 |β| 상한', '전일 고정모형 β의 절대값 · 부호는 leg 방향에 반영')}
          <div class="setting-row readonly">
            <span>확대 보류<small>새 시그널 당일 |Z| 증가 ≥ 1.0</small></span>
            <b>1.0 σ</b>
          </div>
          <div class="setting-row readonly">
            <span>재진입 리셋<small>|Z|≤2.7 확인 당일 진입 금지</small></span>
            <b>2.7 σ</b>
          </div>
          <div class="setting-row readonly">
            <span>국면·이벤트 제한<small>국면 제거 / 이벤트는 알림 전용</small></span>
            <b>사용 안 함</b>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>운용과 데이터</h2></div>
        <div class="settings-body">
          <label class="setting-row">
            <span>RV 신규 진입 활성화<small>기존 가상 포지션 모니터는 유지</small></span>
            <input type="checkbox" name="rv_enabled" ${c.rv_enabled ? 'checked' : ''}>
          </label>
          <label class="setting-row">
            <span>대체 소스 사용 승인<small>CMT·원자재 연속물 정의를 확인한 후 사용</small></span>
            <input type="checkbox" name="allow_proxies" ${c.allow_proxies ? 'checked' : ''}>
          </label>
          ${field('refresh_minutes', '자동 계산 간격 (분)', '수집기는 30초마다 설정·갱신 요청 확인', 1)}
          ${field('max_positions', '모델 관리 한도', '초과 보유는 알림 · 수동 등록은 허용', 1)}
          ${field('notional_per_leg', '기본 Leg별 명목 (USD)', 'FX 동일금액 가상 운용', 1000)}
          ${field('hardcap_usd', '기본 손실 알림 (USD)', '실제 하드캡 체결을 의미하지 않음', 1000)}
          <button type="submit" class="btn primary">설정 저장 및 재계산 요청</button>
          <p class="muted">설정을 저장하면 로컬 상태에 반영되며, 원격 수집기 연결 시 동기화됩니다.</p>
          ${state.pending_config ? '<div class="sync-note">설정 적용 대기 중</div>' : ''}
        </div>
      </div>
    </form>`;

  $('#settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const v = {};
    for (const [k, x] of f) v[k] = +x;
    v.rv_enabled = f.has('rv_enabled');
    v.allow_proxies = f.has('allow_proxies');
    try {
      await api('/api/settings', v);
      toast('설정을 저장했습니다.');
      await load();
    } catch (err) {
      toast(err.message);
    }
  };
}

$('#refresh').onclick = async () => {
  const b = $('#refresh');
  b.disabled = true;
  b.textContent = dataMode === 'live' ? '↻ BBG 실시간 조회 중' : '↻ 갱신 요청 중';
  try {
    await api('/api/refresh', { mode: dataMode });
    await load(true);
    toast(
      dataMode === 'live'
        ? `⚡ 블룸버그 실시간 데이터를 즉시 갱신했습니다. (${state?.as_of || ''})`
        : '📊 FITD 종가 데이터를 동기화했습니다.'
    );
  } catch (e) {
    toast(e.message);
  } finally {
    b.disabled = false;
    b.textContent = '↻ 데이터 갱신';
  }
};

$('#export').onclick = async () => {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fitd-desk-${state.as_of}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast('내보낼 데이터가 없습니다.');
  }
};

configureHoldings({ getState: () => state, api, toast, onChange: load, setTab });
configureMomentumStrategy({ getState: () => state, api, toast, onChange: load, setTab });
configureMomentum({ getState: () => state, api, toast, onChange: load });
configureTreasury({ getState: () => state, setTab, api, onChange: load, toast });

setTab(tab);
api('/api/data-mode', { mode: dataMode }).catch(() => {});
await load(true);
setInterval(load, 30000);
