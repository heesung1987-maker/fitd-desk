// Universal Time-Series Range Controller, Theme Palette & Interactive SVG Tooltip Helper

const rangeStore = new Map();

const PRESET_COUNTS = {
  '10D': 10,
  '20D': 20,
  '1M': 21,
  '60D': 60,
  '3M': 63,
  '90D': 90,
  '120D': 120,
  '6M': 126,
  '180D': 180,
  '1Y': 252,
  '2Y': 504,
  '3Y': 756,
  '5Y': 1260,
};

export function getRangeState(chartId, defaultPreset = '1Y', defaultRebase = true) {
  if (!rangeStore.has(chartId)) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(`fitd-range-${chartId}`) || 'null');
    } catch {}
    rangeStore.set(
      chartId,
      saved || {
        mode: 'preset',
        preset: String(defaultPreset),
        start: '',
        end: '',
        rebase: defaultRebase,
      }
    );
  }
  return rangeStore.get(chartId);
}

export function setRangeState(chartId, patch) {
  const current = getRangeState(chartId);
  const next = { ...current, ...patch };
  rangeStore.set(chartId, next);
  try {
    localStorage.setItem(`fitd-range-${chartId}`, JSON.stringify(next));
  } catch {}
  return next;
}

/**
 * Filter a time series array by the active range state for `chartId`.
 * @param {Array} series - Array of items
 * @param {string} chartId - Identifier for the chart range control
 * @param {Function} getDate - Function to extract 'YYYY-MM-DD' from an item (defaults to item.date || item[0])
 * @param {string} defaultPreset - Default preset key
 */
export function filterSeriesByRange(
  series,
  chartId,
  getDate = (d) => (Array.isArray(d) ? d[0] : d?.date),
  defaultPreset = '1Y'
) {
  if (!Array.isArray(series) || !series.length) return [];
  const st = getRangeState(chartId, defaultPreset);

  if (st.mode === 'custom' && (st.start || st.end)) {
    const start = st.start || '0000-01-01';
    const end = st.end || '9999-12-31';
    const filtered = series.filter((item) => {
      const dt = getDate(item);
      return dt && dt >= start && dt <= end;
    });
    return filtered.length ? filtered : series.slice(-20);
  }

  const preset = String(st.preset);
  if (preset === 'ALL') return series;

  if (preset === 'YTD') {
    const lastDate = getDate(series.at(-1)) || '';
    const yearPrefix = lastDate.slice(0, 4) + '-01-01';
    const filtered = series.filter((item) => {
      const dt = getDate(item);
      return dt && dt >= yearPrefix;
    });
    return filtered.length ? filtered : series;
  }

  if (preset === '2023~') {
    const filtered = series.filter((item) => {
      const dt = getDate(item);
      return dt && dt >= '2023-01-01';
    });
    return filtered.length ? filtered : series;
  }

  // Numeric observation count or named preset
  const count = PRESET_COUNTS[preset] || Number(preset);
  if (Number.isFinite(count) && count > 0) {
    return series.slice(-count);
  }

  return series;
}

/**
 * Renders a unified, high-visibility Time-Series Period & Custom Date Range control bar.
 */
export function renderRangeControls(
  chartId,
  {
    presets = [
      ['1M', '1M'],
      ['3M', '3M'],
      ['6M', '6M'],
      ['YTD', 'YTD'],
      ['1Y', '1Y'],
      ['2Y', '2Y'],
      ['5Y', '5Y'],
      ['ALL', '전체'],
    ],
    defaultPreset = '1Y',
    showDateInputs = true,
    showRebase = false,
    minDate = '',
    maxDate = '',
    compact = false,
  } = {}
) {
  const st = getRangeState(chartId, defaultPreset);
  const presetBtns = presets
    .map(([val, label]) => {
      const isOn = st.mode === 'preset' && String(st.preset) === String(val);
      return `<button type="button" data-rc-id="${chartId}" data-rc-preset="${val}" class="${isOn ? 'on' : ''}" aria-pressed="${isOn}">${label}</button>`;
    })
    .join('');

  const dateInputs = showDateInputs
    ? `<div class="rc-date-group ${st.mode === 'custom' ? 'active' : ''}">
        <span class="rc-date-label">기간 직접 선택</span>
        <input type="date" data-rc-start="${chartId}" value="${st.start || ''}" ${minDate ? `min="${minDate}"` : ''} ${maxDate ? `max="${maxDate}"` : ''} aria-label="시작일">
        <span class="rc-tilde">~</span>
        <input type="date" data-rc-end="${chartId}" value="${st.end || ''}" ${minDate ? `min="${minDate}"` : ''} ${maxDate ? `max="${maxDate}"` : ''} aria-label="종료일">
        <button type="button" class="btn rc-apply-btn" data-rc-apply="${chartId}">적용</button>
        ${st.mode === 'custom' ? `<button type="button" class="btn quiet rc-reset-btn" data-rc-reset="${chartId}">초기화</button>` : ''}
      </div>`
    : '';

  const rebaseToggle = showRebase
    ? `<label class="rc-rebase-toggle" title="선택한 기간의 첫 날을 0으로 기준점 재설정">
        <input type="checkbox" data-rc-rebase="${chartId}" ${st.rebase ? 'checked' : ''}>
        <span>기간 시작점 0 기준</span>
      </label>`
    : '';

  return `<div class="range-controller ${compact ? 'rc-compact' : ''}" data-rc-container="${chartId}">
    <div class="segmented rc-presets" role="group" aria-label="차트 기간 선택">${presetBtns}</div>
    ${dateInputs}
    ${rebaseToggle}
  </div>`;
}

/**
 * Binds click/change events for all range controls inside `root` (or `document`).
 */
export function bindRangeControls(root = document, onUpdate = () => {}) {
  const scope = root || document;

  scope.querySelectorAll('[data-rc-preset]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      const id = btn.dataset.rcId;
      const preset = btn.dataset.rcPreset;
      setRangeState(id, { mode: 'preset', preset });
      onUpdate(id, getRangeState(id));
    };
  });

  scope.querySelectorAll('[data-rc-apply]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      const id = btn.dataset.rcApply;
      const startEl = scope.querySelector(`[data-rc-start="${id}"]`);
      const endEl = scope.querySelector(`[data-rc-end="${id}"]`);
      const start = startEl?.value || '';
      const end = endEl?.value || '';
      if (!start && !end) return;
      if (start && end && start > end) {
        setRangeState(id, { mode: 'custom', start: end, end: start });
      } else {
        setRangeState(id, { mode: 'custom', start, end });
      }
      onUpdate(id, getRangeState(id));
    };
  });

  scope.querySelectorAll('[data-rc-start], [data-rc-end]').forEach((input) => {
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const id = input.dataset.rcStart || input.dataset.rcEnd;
        const applyBtn = scope.querySelector(`[data-rc-apply="${id}"]`);
        if (applyBtn) applyBtn.click();
      }
    };
  });

  scope.querySelectorAll('[data-rc-reset]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      const id = btn.dataset.rcReset;
      setRangeState(id, { mode: 'preset', start: '', end: '' });
      onUpdate(id, getRangeState(id));
    };
  });

  scope.querySelectorAll('[data-rc-rebase]').forEach((chk) => {
    chk.onchange = () => {
      const id = chk.dataset.rcRebase;
      setRangeState(id, { rebase: chk.checked });
      onUpdate(id, getRangeState(id));
    };
  });
}

/**
 * Returns theme-aware chart colors so SVG charts look crisp in Light, Soft Slate, and Dark themes.
 */
export function getChartTheme() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  if (theme === 'light') {
    return {
      isLight: true,
      grid: '#e2e8f0',
      axis: '#cbd5e1',
      zero: '#94a3b8',
      zeroLine: '#94a3b8',
      text: '#0f172a',
      subText: '#334155',
      muted: '#475569',
      orange: '#d97706',
      amber: '#d97706',
      blue: '#2563eb',
      green: '#059669',
      purple: '#7c3aed',
      gold: '#ca8a04',
      red: '#e11d48',
      stop: '#dc2626',
      slate: '#64748b',
      bandFill: '#3b82f6',
      palette: ['#2563eb', '#d97706', '#059669', '#7c3aed', '#e11d48', '#0891b2'],
      maColors: { 20: '#059669', 60: '#7c3aed', 120: '#ca8a04' },
    };
  }
  if (theme === 'slate') {
    return {
      isLight: false,
      grid: '#334155',
      axis: '#475569',
      zero: '#64748b',
      zeroLine: '#64748b',
      text: '#f8fafc',
      subText: '#cbd5e1',
      muted: '#94a3b8',
      orange: '#fb923c',
      amber: '#f59e0b',
      blue: '#60a5fa',
      green: '#34d399',
      purple: '#c084fc',
      gold: '#facc15',
      red: '#fb7185',
      stop: '#f43f5e',
      slate: '#94a3b8',
      bandFill: '#60a5fa',
      palette: ['#38bdf8', '#fb923c', '#34d399', '#c084fc', '#fb7185', '#facc15'],
      maColors: { 20: '#34d399', 60: '#c084fc', 120: '#facc15' },
    };
  }
  // Dark
  return {
    isLight: false,
    grid: '#263244',
    axis: '#384860',
    zero: '#64748b',
    zeroLine: '#64748b',
    text: '#f1f5f9',
    subText: '#cbd5e1',
    muted: '#94a3b8',
    orange: '#ffad69',
    amber: '#f59e0b',
    blue: '#91b5ff',
    green: '#6bd9b5',
    purple: '#d6abff',
    gold: '#e6d18b',
    red: '#f48591',
    stop: '#f43f5e',
    slate: '#7b8ba3',
    bandFill: '#91b5ff',
    palette: ['#ffad69', '#91b5ff', '#6bd9b5', '#d6abff', '#e6d18b', '#f48591'],
    maColors: { 20: '#6bd9b5', 60: '#d6abff', 120: '#e6d18b' },
  };
}

/**
 * Attaches an instant floating tooltip & hover highlight to all SVG charts with `<title>` hit rects/circles.
 */
let tooltipEl = null;
function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'chart-floating-tooltip';
    tooltipEl.className = 'chart-floating-tooltip';
    tooltipEl.hidden = true;
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function enhanceInteractiveCharts(root = document) {
  const tip = ensureTooltip();
  const svgs = (root || document).querySelectorAll('svg');

  svgs.forEach((svg) => {
    if (svg.dataset.interactiveBound === '1') return;
    svg.dataset.interactiveBound = '1';

    // Convert child rect/circle elements with <title> into instant hover targets
    const targets = svg.querySelectorAll('rect, circle');
    targets.forEach((el) => {
      const titleEl = el.querySelector('title');
      if (!titleEl) return;
      const rawText = titleEl.textContent || '';
      if (!rawText.trim()) return;
      el.dataset.tipText = rawText;
      // Remove native title so browser doesn't show duplicate delayed tooltip
      titleEl.remove();

      el.addEventListener('mouseenter', (e) => {
        const lines = el.dataset.tipText.split('\n').filter(Boolean);
        if (!lines.length) return;
        const header = lines[0];
        const body = lines.slice(1);
        tip.innerHTML =
          `<div class="cft-head">${escapeHtml(header)}</div>` +
          body.map((l) => `<div class="cft-row">${escapeHtml(l)}</div>`).join('');
        tip.hidden = false;
        if (el.tagName.toLowerCase() === 'rect') {
          el.style.fill = 'rgba(148, 163, 184, 0.14)';
        } else if (el.tagName.toLowerCase() === 'circle') {
          el.dataset.origFill = el.getAttribute('fill') || 'transparent';
          el.setAttribute('fill', 'var(--orange)');
          el.setAttribute('r', '5.5');
        }
        positionTooltip(e, tip);
      });

      el.addEventListener('mousemove', (e) => {
        positionTooltip(e, tip);
      });

      el.addEventListener('mouseleave', () => {
        tip.hidden = true;
        if (el.tagName.toLowerCase() === 'rect') {
          el.style.fill = 'transparent';
        } else if (el.tagName.toLowerCase() === 'circle') {
          el.setAttribute('fill', el.dataset.origFill || 'transparent');
          el.setAttribute('r', '4');
        }
      });
    });
  });
}

function positionTooltip(e, tip) {
  const pad = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = tip.getBoundingClientRect();
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + rect.width + 16 > vw) x = e.clientX - rect.width - pad;
  if (y + rect.height + 16 > vh) y = e.clientY - rect.height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}
