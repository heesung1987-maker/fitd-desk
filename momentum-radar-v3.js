import { getChartTheme } from './chart-utils.js?v=11';

let r3Data = null;
let portfolioMode = 'COMBO'; // 'COMBO' | 'FX_ONLY' | 'MOM_ONLY'
let sectionTab = 'ALL'; // 'ALL' | 'RADAR' | 'EXAMPLES' | 'MONTHLY' | 'RESEARCH'
let yearFilter = 'ALL'; // 'ALL' | '2022' | '2023' | '2024' | '2025' | '2026'
let monthFilter = 'ALL'; // 'ALL' | 'BIG_WIN' | 'LOSS' | 'SEVERE' | 'FX_ZERO'
let dailyViewMode = 'RADAR'; // 'RADAR' | 'SCALE' | 'PNL'
let dailyHoverIdx = -1;

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
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

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

const STATE_META = {
  BOX_FULL: { label: 'BOX_FULL (정상 1.25x)', bg: 'rgba(13,148,136,0.12)', fg: '#0d9488' },
  SHOCK_TAPER: { label: 'SHOCK_TAPER (연속감속)', bg: 'rgba(217,119,6,0.12)', fg: '#d97706' },
  SHOCK_BLOCK: { label: 'SHOCK_BLOCK (고속차단)', bg: 'rgba(220,38,38,0.14)', fg: '#dc2626' },
  DZ_BLOCK: { label: 'DZ_BLOCK (안개장차단)', bg: 'rgba(100,116,139,0.14)', fg: '#64748b' },
  L3_BLOCK: { label: 'L3_BLOCK (장기폭풍차단)', bg: 'rgba(153,27,27,0.14)', fg: '#991b1b' },
};
const STATE_LIST = ['DZ_BLOCK', 'BOX_FULL', 'SHOCK_TAPER', 'SHOCK_BLOCK', 'L3_BLOCK'];

function stateBadge(code) {
  const m = STATE_META[code] || { label: code, bg: 'rgba(100,116,139,0.12)', fg: '#64748b' };
  return `<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;background:${m.bg};color:${m.fg};white-space:nowrap;">${esc(m.label)}</span>`;
}

async function loadRadarV3Data() {
  if (r3Data) return r3Data;
  const res = await fetch('./data/radar-v3-a3-report.json?v=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('FX v3.0 (A3 브레이크) 리포트 데이터를 불러오지 못했습니다.');
  }
  r3Data = await res.json();
  return r3Data;
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

function renderMonthlyEquitySvg(rows, mode) {
  const ct = getChartTheme();
  const ink = ct.ink || '#0f172a';
  if (!rows.length) return '<div class="empty">표시할 기간 데이터가 없습니다.</div>';

  const cfg =
    mode === 'COMBO'
      ? {
          kMain: 'combo_a3_cum', mMain: 'combo_a3', lblMain: '[확정] 통합 데스크 (FX A3 v3.0 + 모멘텀 v3.5)',
          kMid: 'combo_v2_cum', mMid: 'combo_v2', lblMid: '기존 FX v2.0 + 모멘텀 v3.5',
          kBase: 'combo_static_cum', mBase: 'combo_static', lblBase: '필터 없음 FX + 모멘텀 v3.5',
        }
      : mode === 'FX_ONLY'
      ? {
          kMain: 'fx_a3_cum', mMain: 'fx_a3', lblMain: '[확정] FX A3 (v3.0 브레이크 · 익일Open)',
          kMid: 'fx_v2_cum', mMid: 'fx_v2', lblMid: '기존 FX v2.0 (24/44/56 · 익일Open)',
          kBase: 'fx_static_cum', mBase: 'fx_static', lblBase: '필터 없음 FX (STATIC 1.0x)',
        }
      : {
          kMain: 'mom_cum', mMain: 'mom_v35', lblMain: '[확정] 모멘텀 v3.5 단독 (v2.0 기반)',
          kMid: 'mom_cum', mMid: 'mom_v35', lblMid: '',
          kBase: 'mom_cum', mBase: 'mom_v35', lblBase: '',
        };

  const offMain = rows[0][cfg.kMain] - rows[0][cfg.mMain];
  const offMid = rows[0][cfg.kMid] - rows[0][cfg.mMid];
  const offBase = rows[0][cfg.kBase] - rows[0][cfg.mBase];

  const pts = rows.map((r) => ({
    ym: r.ym, v2: r.v2_avg, sh4: r.shock4_avg, state: r.state, fxN: r.fx_entries,
    main: r[cfg.kMain] - offMain, mid: r[cfg.kMid] - offMid, base: r[cfg.kBase] - offBase,
    mMain: r[cfg.mMain], mMid: r[cfg.mMid], mBase: r[cfg.mBase], mFx: r.fx_a3, mMom: r.mom_v35,
  }));

  const vals = mode === 'MOM_ONLY' ? pts.flatMap((p) => [0, p.main]) : pts.flatMap((p) => [0, p.main, p.mid, p.base]);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(150000, ...vals);
  const w = 1040, h = 290, padL = 82, padR = 26, padT = 38, padB = 34;
  const x = (i) => padL + (i * (w - padL - padR)) / Math.max(1, pts.length - 1);
  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const line = (key) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const ticks = [lo, lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.75, hi];
  const last = pts.at(-1);

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="59개월 누적 손익 비교 곡선">
    <g transform="translate(${padL}, 18)" style="font-size:11.5px;font-weight:700;fill:${ink};">
      <line x1="0" y1="-4" x2="20" y2="-4" stroke="#0d9488" stroke-width="3.2"/>
      <text x="25" y="0" fill="${ink}">${cfg.lblMain}: ${fmtUsd(last?.main)}</text>
      ${
        mode !== 'MOM_ONLY'
          ? `<line x1="420" y1="-4" x2="440" y2="-4" stroke="#6366f1" stroke-width="2.1" stroke-dasharray="5 3"/>
             <text x="445" y="0" fill="${ink}">${cfg.lblMid}: ${fmtUsd(last?.mid)}</text>
             <line x1="735" y1="-4" x2="755" y2="-4" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="2 3"/>
             <text x="760" y="0" fill="${ink}">${cfg.lblBase}: ${fmtUsd(last?.base)}</text>`
          : ''
      }
    </g>
    ${ticks
      .map(
        (tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${ct.grid}" stroke-dasharray="3 3"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${ink}" font-size="11" font-weight="600">$${fmtNum(tv / 1000, 0)}k</text>`
      )
      .join('')}
    <line x1="${padL}" x2="${w - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="${ct.zero}" stroke-width="1.2"/>
    ${mode !== 'MOM_ONLY' ? `<path d="${line('base')}" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="2 3"/>` : ''}
    ${mode !== 'MOM_ONLY' ? `<path d="${line('mid')}" fill="none" stroke="#6366f1" stroke-width="2.1" stroke-dasharray="5 3"/>` : ''}
    <path d="${line('main')}" fill="none" stroke="#0d9488" stroke-width="3.2"/>
    ${pts
      .map(
        (p, i) => `
      <circle cx="${x(i).toFixed(1)}" cy="${y(p.main).toFixed(1)}" r="4.0" fill="#0d9488" opacity="0.85">
        <title>[${p.ym}] v2.0=${p.v2}점 · Shock4=${p.sh4}% · ${p.state} · FX진입 ${p.fxN}건
- ${cfg.lblMain}: 누적 ${fmtUsd(p.main)} (당월 ${fmtUsd(p.mMain)})
- 구성 당월: FX A3 ${fmtUsd(p.mFx)} + 모멘텀 v3.5 ${fmtUsd(p.mMom)}</title>
      </circle>`
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

  const kVal = mode === 'COMBO' ? 'combo_a3' : mode === 'FX_ONLY' ? 'fx_a3' : 'mom_v35';
  const refLine = mode === 'MOM_ONLY' ? -20000 : -50000;
  const allVals = rows.flatMap((r) => [r[kVal], 0, refLine]);
  const lo = Math.min(refLine * 1.5, ...allVals);
  const hi = Math.max(150000, ...allVals);
  const w = 1040, h = 250, padL = 82, padR = 24, padT = 34, padB = 32;
  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const y0 = y(0);
  const slotW = (w - padL - padR) / Math.max(1, rows.length);
  const barW = Math.max(3, Math.min(11, slotW * 0.64));
  const ticks = [-200000, -100000, refLine, 0, 100000, 200000, 300000]
    .filter((v, i, arr) => arr.indexOf(v) === i && v >= lo - 15000 && v <= hi + 15000)
    .sort((a, b) => a - b);

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="월별 손익 막대 차트">
    <g transform="translate(${padL}, 16)" style="font-size:12px;font-weight:700;fill:${ink};">
      <rect x="0" y="-10" width="12" height="10" fill="#0d9488" rx="2"/>
      <text x="18" y="-1" fill="${ink}">${mode === 'COMBO' ? '통합 흑자월' : mode === 'FX_ONLY' ? 'FX A3 흑자월' : '모멘텀 v3.5 흑자월'}</text>
      <rect x="155" y="-10" width="12" height="10" fill="#e11d48" rx="2"/>
      <text x="173" y="-1" fill="${ink}">적자월 (적색 점선: ${fmtUsd(refLine)})</text>
    </g>
    ${ticks
      .map(
        (tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${tv === 0 ? ct.zero : tv === refLine ? '#f43f5e' : ct.grid}" stroke-width="${tv === 0 ? '1.3' : '1'}" stroke-dasharray="${tv === 0 ? 'none' : '3 3'}" opacity="${tv === refLine ? '0.65' : '1'}"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${tv === refLine ? '#e11d48' : ink}" font-size="11" font-weight="600">${tv === 0 ? '$0' : (tv > 0 ? '+$' : '−$') + fmtNum(Math.abs(tv) / 1000, 0) + 'k'}</text>`
      )
      .join('')}
    ${rows
      .map((r, i) => {
        const cx = padL + (i + 0.5) * slotW;
        const val = r[kVal];
        const yTop = Math.min(y0, y(val));
        const bH = Math.max(1.8, Math.abs(y(val) - y0));
        return `<g>
          <rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" fill="${val >= 0 ? '#0d9488' : '#e11d48'}" rx="1.5"/>
          <rect x="${(cx - slotW / 2).toFixed(1)}" y="${padT}" width="${slotW.toFixed(1)}" height="${h - padT - padB}" fill="transparent">
            <title>[${r.ym}] v2.0=${r.v2_avg}점 · Shock4=${r.shock4_avg}% · ${r.state}
- 통합 (FX A3 + 모멘텀 v3.5): ${fmtUsd(r.combo_a3)} (누적 ${fmtUsd(r.combo_a3_cum)})
- FX A3: ${fmtUsd(r.fx_a3)} (신규 ${r.fx_entries}건)
- 모멘텀 v3.5: ${fmtUsd(r.mom_v35)}</title>
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

function drawDailyCanvas(target, allDaily) {
  const cv = target.querySelector('#r3-daily-cv');
  if (!cv || !allDaily || !allDaily.length) return;
  const rows = yearFilter === 'ALL' ? allDaily : allDaily.filter((r) => r[0].startsWith(yearFilter));
  if (rows.length < 2) return;

  const ct = getChartTheme();
  const ink = ct.ink || '#0f172a';
  const muted = ct.muted || '#64748b';
  const gridCol = ct.grid || 'rgba(148,163,184,0.22)';

  const dpr = window.devicePixelRatio || 1;
  const rect = cv.getBoundingClientRect();
  const W = Math.max(360, rect.width || 960);
  const H = 330;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const padL = 62, padR = 16, padT = 16, padB = 28;
  const pw = W - padL - padR;
  const ph = H - padT - padB;
  const n = rows.length;
  const xAt = (i) => padL + (i / (n - 1)) * pw;

  let yMin, yMax, ticks, fmtY;
  if (dailyViewMode === 'RADAR') {
    yMin = 0; yMax = 100; ticks = [0, 24, 52, 64, 72, 100];
    fmtY = (v) => String(v);
  } else if (dailyViewMode === 'SCALE') {
    yMin = 0.2; yMax = 1.35; ticks = [0.35, 0.55, 0.80, 1.00, 1.25];
    fmtY = (v) => v.toFixed(2) + 'x';
  } else {
    const vals = rows.flatMap((r) => [r[10], r[11], r[12]]);
    yMin = Math.min(0, ...vals) - 100;
    yMax = Math.max(200, ...vals) + 150;
    const step = (yMax - yMin) > 2500 ? 1000 : 500;
    ticks = [];
    for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) ticks.push(t);
    fmtY = (v) => (v < 0 ? '−$' : '$') + Math.abs(v) + 'k';
  }
  const yAt = (v) => padT + ((yMax - v) / Math.max(1e-6, yMax - yMin)) * ph;

  // Shaded block regimes on RADAR view
  if (dailyViewMode === 'RADAR') {
    for (let i = 0; i < n; i++) {
      const st = rows[i][5];
      if (st === 3 || st === 0 || st === 4) {
        const x0 = xAt(Math.max(0, i - 0.5));
        const x1 = xAt(Math.min(n - 1, i + 0.5));
        ctx.fillStyle = st === 3 ? 'rgba(220,38,38,0.16)' : 'rgba(100,116,139,0.11)';
        ctx.fillRect(x0, padT, Math.max(1.2, x1 - x0), ph);
      }
    }
  }

  ctx.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tv of ticks) {
    const yy = yAt(tv);
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(W - padR, yy);
    if (dailyViewMode === 'RADAR' && (tv === 24 || tv === 64)) {
      ctx.strokeStyle = 'rgba(37,99,235,0.45)';
      ctx.setLineDash([4, 3]);
    } else if (dailyViewMode === 'RADAR' && (tv === 52 || tv === 72)) {
      ctx.strokeStyle = 'rgba(234,88,12,0.50)';
      ctx.setLineDash([2, 3]);
    } else {
      ctx.strokeStyle = gridCol;
      ctx.setLineDash(tv === 0 ? [] : [3, 3]);
    }
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = dailyViewMode === 'RADAR' && (tv === 64 || tv === 72) ? '#dc2626' : muted;
    ctx.fillText(fmtY(tv), padL - 7, yy);
  }

  function plotLine(col, width, dash, fn) {
    ctx.beginPath();
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    for (let i = 0; i < n; i++) {
      const xx = xAt(i), yy = yAt(fn(rows[i]));
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (dailyViewMode === 'RADAR') {
    plotLine('#2563eb', 1.7, [], (r) => r[1]);
    plotLine('#ea580c', 1.6, [], (r) => r[2]);
  } else if (dailyViewMode === 'SCALE') {
    plotLine('#94a3b8', 1.4, [4, 3], (r) => r[4]);
    plotLine('#0d9488', 2.0, [], (r) => r[3]);
  } else {
    plotLine('#94a3b8', 1.5, [4, 3], (r) => r[11]);
    plotLine('#2563eb', 2.0, [], (r) => r[10]);
    plotLine('#0d9488', 2.4, [], (r) => r[12]);
  }

  ctx.fillStyle = muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const stepX = Math.max(1, Math.floor(n / 8));
  for (let i = 0; i < n; i += stepX) {
    ctx.fillText(rows[i][0].slice(0, 7), xAt(i), H - padB + 8);
  }
  ctx.textAlign = 'right';
  ctx.fillText(rows[n - 1][0].slice(0, 7), W - padR, H - padB + 8);

  const activeIdx = dailyHoverIdx >= 0 && dailyHoverIdx < n ? dailyHoverIdx : n - 1;
  const pt = rows[activeIdx];
  if (dailyHoverIdx >= 0 && dailyHoverIdx < n) {
    const xx = xAt(activeIdx);
    ctx.beginPath();
    ctx.moveTo(xx, padT);
    ctx.lineTo(xx, H - padB);
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    const markers =
      dailyViewMode === 'RADAR'
        ? [[pt[1], '#2563eb'], [pt[2], '#ea580c']]
        : dailyViewMode === 'SCALE'
        ? [[pt[3], '#0d9488'], [pt[4], '#94a3b8']]
        : [[pt[12], '#0d9488'], [pt[10], '#2563eb'], [pt[11], '#94a3b8']];
    for (const [val, col] of markers) {
      ctx.beginPath();
      ctx.arc(xx, yAt(val), 4, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    }
  }

  // Update readout strip
  const roDate = target.querySelector('#r3-ro-date');
  const roState = target.querySelector('#r3-ro-state');
  const roMain = target.querySelector('#r3-ro-main');
  const roSub = target.querySelector('#r3-ro-sub');
  if (roDate && pt) {
    const [d, v2, sh4, scA3, scV2, stIdx, pmz, prv, pvr, per, ca3, cv2, ccb] = pt;
    const stCode = STATE_LIST[stIdx] || 'BOX_FULL';
    const sm = STATE_META[stCode] || { label: stCode, fg: '#64748b', bg: 'transparent' };
    roDate.textContent = d;
    roState.textContent = sm.label;
    roState.style.color = sm.fg;
    roState.style.background = sm.bg;
    if (dailyViewMode === 'RADAR') {
      roMain.textContent = `1층 v2.0 ${v2.toFixed(1)}점 | 2층 Shock4 ${sh4.toFixed(1)}% → A3 배수 ${scA3.toFixed(2)}x`;
      roSub.textContent = `MOVE_z ${pmz}% · RV5/60 ${prv}% · VR10 ${pvr}% · RATES_ER10 ${per}%`;
    } else if (dailyViewMode === 'SCALE') {
      roMain.textContent = `A3 연속 배수 ${scA3.toFixed(2)}x vs 기존 v2.0 계단식 ${scV2.toFixed(2)}x`;
      roSub.textContent = `v2.0 ${v2.toFixed(1)}점 · Shock4 ${sh4.toFixed(1)}% (MOVE ${pmz}% / RV ${prv}% / VR ${pvr}% / ER ${per}%)`;
    } else {
      roMain.textContent = `통합 +$${ccb.toFixed(0)}k | FX A3 ${ca3 >= 0 ? '+' : '−'}$${Math.abs(ca3).toFixed(0)}k | 기존 v2.0 ${cv2 >= 0 ? '+' : '−'}$${Math.abs(cv2).toFixed(0)}k`;
      roSub.textContent = `A3 우위 ${(ca3 - cv2) >= 0 ? '+' : '−'}$${Math.abs(ca3 - cv2).toFixed(0)}k · 당일 배수 ${scA3.toFixed(2)}x`;
    }
  }
}

export async function renderMomentumRadarV3(target) {
  target.innerHTML = `<div class="panel"><p class="muted">FX v3.0 (A3 브레이크 수익형) + 모멘텀 v3.5 통합 연구 데이터를 불러오는 중입니다...</p></div>`;

  let data;
  try {
    data = await loadRadarV3Data();
  } catch (e) {
    target.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`;
    return;
  }

  const hl = data.headline;
  const snap = data.latest_snapshot || {};
  const mh = hl.mutual_hedge || {};
  const activePerf = portfolioMode === 'COMBO' ? hl.combo : portfolioMode === 'FX_ONLY' ? hl.fx : hl.mom;

  const allMonths = data.monthly_rows || [];
  const chartMonths = allMonths.filter((m) => yearFilter === 'ALL' || m.year === yearFilter);
  const tableMonths = allMonths.filter((m) => {
    if (yearFilter !== 'ALL' && m.year !== yearFilter) return false;
    const v = portfolioMode === 'COMBO' ? m.combo_a3 : portfolioMode === 'FX_ONLY' ? m.fx_a3 : m.mom_v35;
    const bigTh = portfolioMode === 'MOM_ONLY' ? 50000 : 150000;
    const sevTh = portfolioMode === 'MOM_ONLY' ? -20000 : -50000;
    if (monthFilter === 'BIG_WIN') return v >= bigTh;
    if (monthFilter === 'LOSS') return v < 0;
    if (monthFilter === 'SEVERE') return v <= sevTh;
    if (monthFilter === 'FX_ZERO') return m.fx_entries === 0;
    return true;
  });

  const showRadar = sectionTab === 'ALL' || sectionTab === 'RADAR';
  const showExamples = sectionTab === 'ALL' || sectionTab === 'EXAMPLES';
  const showMonthly = sectionTab === 'ALL' || sectionTab === 'MONTHLY';
  const showResearch = sectionTab === 'ALL' || sectionTab === 'RESEARCH';

  const top5 = portfolioMode === 'COMBO' ? data.top5_combo : portfolioMode === 'FX_ONLY' ? data.top5_fx : data.top5_mom;
  const bot5 = portfolioMode === 'COMBO' ? data.bot5_combo : portfolioMode === 'FX_ONLY' ? data.bot5_fx : data.bot5_mom;

  const sumFxN = tableMonths.reduce((a, r) => a + r.fx_entries, 0);
  const sumFx = tableMonths.reduce((a, r) => a + r.fx_a3, 0);
  const sumMom = tableMonths.reduce((a, r) => a + r.mom_v35, 0);
  const sumCb = tableMonths.reduce((a, r) => a + r.combo_a3, 0);

  const legendHtml =
    dailyViewMode === 'RADAR'
      ? `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:14px;height:2.5px;background:#2563eb;display:inline-block;"></span>1층 FX v2.0 (24~64 허용)</span>
         <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:14px;height:2.5px;background:#ea580c;display:inline-block;"></span>2층 v3.0 Shock4 (52→72% 감속/차단)</span>
         <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;background:rgba(220,38,38,0.18);display:inline-block;"></span>SHOCK_BLOCK (4센서 단독 선제차단)</span>
         <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;background:rgba(100,116,139,0.15);display:inline-block;"></span>DZ(&lt;24) / L3(≥64) 차단</span>`
      : dailyViewMode === 'SCALE'
      ? `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:14px;height:2.5px;background:#0d9488;display:inline-block;"></span>A3 · v3.0 연속 실효 배수 (0.35x~1.25x)</span>
         <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:14px;height:2px;border-top:2px dashed #94a3b8;display:inline-block;"></span>기존 FX v2.0 계단식 배수 (24/44/56)</span>`
      : `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:14px;height:2.5px;background:#0d9488;display:inline-block;"></span>통합 데스크 (FX A3 + 모멘텀 v3.5)</span>
         <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:14px;height:2.5px;background:#2563eb;display:inline-block;"></span>FX A3 단독 (v3.0 브레이크)</span>
         <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:14px;height:2px;border-top:2px dashed #94a3b8;display:inline-block;"></span>기존 FX v2.0 단독</span>`;

  target.innerHTML = `
    <!-- HERO HEADER & LIVE RADAR SNAPSHOT -->
    <div class="panel" style="border-left:4px solid #0d9488;">
      <div class="panel-head" style="flex-wrap:wrap;gap:12px;">
        <div>
          <div class="eyebrow">RADAR v3.0 (A3 DUAL-LAYER BRAKE) · 100% STRICTLY CAUSAL · NEXT-DAY OPEN STOP (ZERO CLAMPING · 2022-01 ~ 2026-11)</div>
          <h2 style="margin:4px 0 6px;">FX v3.0 (A3 브레이크 수익형) + 모멘텀 v3.5 통합 연구 &amp; 5개년 일간 레이더</h2>
          <p class="muted" style="margin:0;font-size:12.5px;line-height:1.55;">
            1층 <strong>FX v2.0 (24~64 허용 · 경계완충)</strong> 위에 2층 <strong>고속 4센서 선행 브레이크 (MOVE_z60 · FX_RV5/60 · VR10 · RATES_ER10 · 252일 백분위)</strong>를 결합.<br>
            전일 종가 −$20k 초과 시 익일 시초가(Open) 손절(클램핑 0%) 기준 통합 <strong>${fmtUsd(hl.combo.total_net)} · MDD −$${fmtNum(hl.combo.mdd)} · Sharpe ${hl.combo.sharpe} · Calmar ${hl.combo.calmar}x · 5개년 전승</strong> (FX A3 <code>${fmtUsd(hl.fx.total_net)}</code>, Shp <code>${hl.fx.sharpe}</code>).
          </p>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <div class="segmented" role="group" aria-label="포트폴리오 모드">
            <button type="button" data-r3-pmode="COMBO" class="${portfolioMode === 'COMBO' ? 'on' : ''}">통합 데스크 (${fmtUsd(hl.combo.total_net)})</button>
            <button type="button" data-r3-pmode="FX_ONLY" class="${portfolioMode === 'FX_ONLY' ? 'on' : ''}">FX v3.0 A3 단독 (${fmtUsd(hl.fx.total_net)})</button>
            <button type="button" data-r3-pmode="MOM_ONLY" class="${portfolioMode === 'MOM_ONLY' ? 'on' : ''}">모멘텀 v3.5 단독 (${fmtUsd(hl.mom.total_net)})</button>
          </div>
          <button type="button" id="r3-export-csv" class="btn quiet">↓ 59개월 CSV</button>
        </div>
      </div>

      <!-- Live Snapshot Strip -->
      <div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:var(--surface-2,rgba(248,250,252,0.65));border:1px solid var(--border,rgba(148,163,184,0.25));display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;font-size:12px;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
          <strong style="font-family:ui-monospace,Consolas,monospace;">최근 기준일 ${esc(snap.date || '—')}</strong>
          ${stateBadge(snap.state || 'BOX_FULL')}
          <span>1층 <strong>v2.0 = ${fmtNum(snap.v2, 1)}점</strong></span>
          <span>2층 <strong>Shock4 = ${fmtNum(snap.ema_shock4, 1)}%</strong></span>
          <span>최종 배수 <strong class="green">${fmtNum(snap.final_sc, 2)}x</strong> (${snap.allow ? '신규 허용' : '신규 중단'})</span>
        </div>
        <div class="muted" style="font-family:ui-monospace,Consolas,monospace;font-size:11.5px;">
          MOVE_z ${snap.pct_move_z}% · RV5/60 ${snap.pct_rv}% · VR10 ${snap.pct_vr10}% · RATES_ER10 ${snap.pct_rer10}%
        </div>
      </div>

      <!-- 5 KPI Cards -->
      <div class="stats" style="margin-top:12px;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));">
        <div class="stat">
          <div class="label">총 누적 순손익 (59개월)</div>
          <div class="num green">${fmtUsd(activePerf.total_net)}</div>
          <div class="help">${activePerf.all_5_years_positive ? '5개년 전 연도 흑자' : '통합 5년 전승'} · 월평균 ${fmtUsd(activePerf.avg_month)}</div>
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
          <div class="label">월간 승률 / 최장 연승·연패</div>
          <div class="num green">${activePerf.win_months}/59 <small style="font-size:13px;">(${activePerf.win_months_pct}%)</small></div>
          <div class="help">최장 <strong>${activePerf.max_win_streak}연승</strong> / <strong>${activePerf.max_loss_streak}연패</strong> · 일간상관 ${hl.corr_fx_mom}</div>
        </div>
        <div class="stat">
          <div class="label">FX A3 평균 보유 · 하드캡 실체결</div>
          <div class="num">${hl.fx_avg_pos}개 <small style="font-size:13px;">(진입 ${hl.fx.entered_trades}건)</small></div>
          <div class="help">승률 ${hl.fx.trade_wr_pct}% · TP ${fmtUsd(hl.fx.tp_avg_win)} / HC ${fmtUsd(hl.fx.hc_avg_loss)}</div>
        </div>
      </div>

      <!-- Section & Year Filters -->
      <div class="filters" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border,rgba(148,163,184,0.22));justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div class="segmented" role="group" aria-label="섹션 필터">
          ${[
            ['ALL', '전체 보기'],
            ['RADAR', '1. 5년 일간 레이더 & 공식'],
            ['EXAMPLES', '2. 실전 수치 대입 & 액션'],
            ['MONTHLY', '3. 59개월 손익 차트 & 표'],
            ['RESEARCH', '4. 센서 연구 & 민감도·진화'],
          ]
            .map(([k, l]) => `<button type="button" data-r3-sec="${k}" class="${sectionTab === k ? 'on' : ''}">${l}</button>`)
            .join('')}
        </div>
        <div class="segmented" role="group" aria-label="연도 필터">
          ${['ALL', '2022', '2023', '2024', '2025', '2026']
            .map((y) => `<button type="button" data-r3-yr="${y}" class="${yearFilter === y ? 'on' : ''}">${y === 'ALL' ? '전체 5개년' : y + '년'}</button>`)
            .join('')}
        </div>
      </div>
    </div>

    ${
      showRadar
        ? `
    <!-- PART 1: 5-YEAR DAILY INTERACTIVE CHART + DUAL-LAYER FORMULA -->
    <div class="panel below">
      <div class="panel-head" style="flex-wrap:wrap;gap:10px;">
        <div>
          <div class="eyebrow">PART 1 · 5-YEAR DAILY RADAR TIME SERIES (1,271 TRADING DAYS · 2022-01 ~ 2026-11)</div>
          <h2>1. FX v2.0 vs v3.0 (Shock4) 5개년 일간 시계열 차트 &amp; 2층 브레이크 공식</h2>
        </div>
        <div class="segmented" role="group" aria-label="일간 차트 보기 모드">
          <button type="button" data-r3-dview="RADAR" class="${dailyViewMode === 'RADAR' ? 'on' : ''}">v2.0 vs v3.0 (Shock4)</button>
          <button type="button" data-r3-dview="SCALE" class="${dailyViewMode === 'SCALE' ? 'on' : ''}">실효 배수 (A3 vs v2.0)</button>
          <button type="button" data-r3-dview="PNL" class="${dailyViewMode === 'PNL' ? 'on' : ''}">일간 누적 손익</button>
        </div>
      </div>

      <!-- Hover Readout Bar -->
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:var(--surface-2,rgba(248,250,252,0.6));border:1px solid var(--border,rgba(148,163,184,0.22));font-family:ui-monospace,Consolas,monospace;font-size:12px;margin-bottom:8px;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
          <strong id="r3-ro-date">—</strong>
          <span id="r3-ro-state" style="padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;">—</span>
          <span id="r3-ro-main" style="font-weight:700;">—</span>
        </div>
        <div id="r3-ro-sub" class="muted" style="font-size:11.5px;">차트에 마우스를 올리면 1,271거래일 전체의 상세 수치를 확인할 수 있습니다</div>
      </div>

      <canvas id="r3-daily-cv" style="width:100%;height:330px;display:block;cursor:crosshair;"></canvas>
      <div style="display:flex;flex-wrap:wrap;gap:14px;font-size:11.5px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border,rgba(148,163,184,0.2));" class="muted">${legendHtml}</div>

      <!-- Dual-Layer Formula Explanation -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:12px;margin-top:16px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;color:#2563eb;margin-bottom:6px;">1층 · 중기 구조 골격 (FX v2.0 · 24 ~ 64점)</div>
          • <code>v2 &lt; 24점</code>: <strong>DZ_BLOCK</strong> (초저변동 안개장 — 신규 중단, 보유 0.40x)<br>
          • <code>v2 ≥ 64점</code>: <strong>L3_BLOCK</strong> (장기 폭풍장 — 신규 중단, 보유 0.35x)<br>
          • 기존 56점 상한을 64점으로 열어 황금 변동성 구간을 수확하되, 경계(<code>24~28</code>, <code>58~64</code>)는 선형 완충으로 절벽을 제거합니다.<br>
          • <strong>모멘텀 v3.5</strong>는 기존 <code>v2.0</code>를 그대로 사용 (5년 전승 · Sharpe 1.84).
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;color:#ea580c;margin-bottom:6px;">2층 · 고속 4센서 선행 브레이크 (Shock4 · 0~100%)</div>
          전·후반기(22~24 vs 25~26) 일치 4센서를 <strong>직전 252일 인과 백분위</strong>로 변환:<br>
          1) <code>MOVE_z60</code> (미 국채 옵션 내재변동성 60일 Z)<br>
          2) <code>FX_RV5 / RV60</code> (10개 통화 5일/60일 실현변동성 급변비)<br>
          3) <code>blend_VR10</code> (10일 분산비율 · 추세 지속성)<br>
          4) <code>RATES_ER10</code> (6대 국채선물 10일 추세효율성)<br>
          <code>Shock4(t) = 0.65×평균4센서(t) + 0.35×Shock4(t−1)</code>
        </div>
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;">
          <div style="font-weight:800;color:#0d9488;margin-bottom:6px;">최종 FX 배수 &amp; 경계 완충 산식 (t−1 고정)</div>
          • <code>Shock4 ≥ 72%</code> → <strong>SHOCK_BLOCK</strong> (신규 중단, 보유 0.35x)<br>
          • <code>Shock4 ≤ 52%</code> → 기본 배수 <strong>1.25x</strong> (BOX_FULL)<br>
          • <code>52% &lt; Shock4 &lt; 72%</code> → <strong>1.25 − 0.70×(Shock4−52)/20</strong> (1.25x→0.55x)<br>
          • 경계 완충: <code>24~28점</code>은 <code>0.65→1.00</code>, <code>58~64점</code>은 <code>1.00→0.60</code> 곱셈<br>
          • 보유 포지션: <code>active_scale = 0.5×진입배수 + 0.5×당일배수</code>
        </div>
      </div>

      <!-- 5 State Distribution Table -->
      <h3 style="margin:16px 0 8px;font-size:14px;">A3 레이더 5대 상태별 발생 비중 (1,271거래일)</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th>상태 코드</th><th>발동 조건 (전일 t−1)</th><th>FX 배수</th><th>신규 진입</th><th class="number">발생일수</th><th class="number">비중</th></tr>
          </thead>
          <tbody>
            ${(data.state_dist || [])
              .map(
                (s) => `<tr>
                <td>${stateBadge(s.code)}</td>
                <td style="font-size:12px;"><code>${esc(s.cond)}</code></td>
                <td style="font-size:12px;"><strong>${esc(s.scale)}</strong></td>
                <td><span class="tag ${s.allow === '허용' ? 'primary' : 'block'}">${esc(s.allow)}</span></td>
                <td class="number">${s.days}일</td>
                <td class="number"><strong>${s.pct}%</strong></td>
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

    ${
      showExamples
        ? `
    <!-- PART 2: WORKED REAL-WORLD EXAMPLES & DAILY ACTION ROUTINE -->
    <div class="panel below">
      <div class="panel-head">
        <div>
          <div class="eyebrow">PART 2 · WORKED NUMERICAL EXAMPLES &amp; DAILY 08:00 KST EXECUTION PROTOCOL</div>
          <h2>2. 실전 날짜 4건 단계별 수치 대입 해설 &amp; 매일 아침 데스크 액션 루틴</h2>
        </div>
      </div>

      <p class="muted" style="margin:0 0 10px;font-size:12.5px;">
        실제 FITD DB 종가를 대입해 <code>A3</code>가 원시 센서 → 252일 백분위 → <code>Shock4</code> EMA → 최종 배수 및 주문 금액을 산출하는 전 과정입니다. <em>(주문 예시: 70일 잔차 <code>1σ = 0.65%</code> 페어 → 원시 명목 <code>$3.08M</code> 기준)</em>
      </p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;">
        ${(data.worked_examples || [])
          .map(
            (ex) => `
          <div style="border:1px solid var(--border,rgba(148,163,184,0.28));border-radius:10px;padding:12px;font-size:12px;line-height:1.6;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--border,rgba(148,163,184,0.2));">
              <strong>${esc(ex.label)} <span class="muted">(${esc(ex.date)})</span></strong>
              ${stateBadge(ex.state)}
            </div>
            <div><strong>1층 v2.0</strong>: <strong>${ex.v2}점</strong> <span class="muted">(P1 ${ex.p1} / P2 ${ex.p2} / P3 ${ex.p3})</span></div>
            <div style="font-family:ui-monospace,Consolas,monospace;font-size:11px;background:var(--surface-2,rgba(248,250,252,0.65));padding:7px 8px;border-radius:6px;margin:6px 0;">
              (1) MOVE ${ex.move} (μ60=${ex.move_mu60}, σ=${ex.move_sd60}) → z=${ex.move_z60 >= 0 ? '+' : ''}${ex.move_z60} → <strong>${ex.pct_move_z}%</strong><br>
              (2) FX_RV5 ${ex.rv5}% / RV60 ${ex.rv60}% = ${ex.rv_ratio} → <strong>${ex.pct_rv}%</strong><br>
              (3) blend_VR10 = ${ex.vr10} → <strong>${ex.pct_vr10}%</strong><br>
              (4) RATES_ER10 = ${ex.rer10} → <strong>${ex.pct_rer10}%</strong>
            </div>
            <div>• <strong>Raw_Shock4</strong> = ${ex.raw_shock4}% → <strong>EMA</strong> = 0.65×${ex.raw_shock4} + 0.35×${ex.prev_shock4} = <strong>${ex.ema_shock4}%</strong></div>
            <div>• <strong>최종 배수</strong>: 기본 ${ex.base_sc}x × 완충 ${ex.edge_mult} = <strong class="${ex.allow ? 'green' : 'red'}">${ex.final_sc}x</strong> (${ex.allow ? '신규 진입 허용' : '신규 진입 전면 중단'})</div>
            <div class="muted">• 주문 예시 (1σ=0.65%): 원시 $${ex.example_raw_not_m}M → <strong>각 레그 $${ex.example_eff_not_m}M (1:1)</strong></div>
          </div>`
          )
          .join('')}
      </div>

      <h3 style="margin:18px 0 8px;font-size:14px;">매일 아침 08:00 KST 실전 데스크 4-Step 액션 프로토콜</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>단계</th><th>대상</th><th>전일(t−1) 종가 확정 후 당일 실제 집행 액션</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Step 1</strong></td>
              <td><strong>기상 레이더 확정</strong></td>
              <td style="font-size:12.5px;">전일 확정 종가로 <code>v2.0</code>(모멘텀 + FX 1층)과 <code>Shock4</code>(FX 2층)를 계산해 오늘의 <code>day_scale</code>(0.35x~1.25x)과 신규 허용 여부를 하루 동안 고정합니다. (장중 소급 변경 금지)</td>
            </tr>
            <tr>
              <td><strong>Step 2</strong></td>
              <td><strong>FX 기존 보유 관리</strong></td>
              <td style="font-size:12.5px;">① 전일 종가 기준 누적손익 <strong>≤ −$20,000</strong> 또는 <strong>|OOS Z| ≥ 4.0</strong> 도달 포지션은 <strong>당일 시초가(Open)에 즉시 전량 손절</strong>.<br>② <code>|Z| ≤ 0.5</code> 도달 시 익절, 20영업일 적자 지속 시 타임스탑 정리. 잔여 보유분은 <code>0.5×진입배수 + 0.5×당일배수</code>로 점진 조정.</td>
            </tr>
            <tr>
              <td><strong>Step 3</strong></td>
              <td><strong>FX 신규 진입 (월 ~5.7건)</strong></td>
              <td style="font-size:12.5px;">허용 상태(<code>BOX_FULL</code>·<code>SHOCK_TAPER</code>) + 빈 슬롯(최대 6개, 통화당 최대 2개)일 때 <code>|Z| ≥ 2.2</code> 후보 중 <code>|Z|×(0.5+0.5|Corr|)</code> 상위 페어를 <code>min($5M, $20k ÷ 1σ%) × day_scale</code> (1:1 롱숏)으로 진입.</td>
            </tr>
            <tr>
              <td><strong>Step 4</strong></td>
              <td><strong>모멘텀 v3.5 (월 ~1.4건)</strong></td>
              <td style="font-size:12.5px;"><code>v2.0</code> 국면에 따라 US 1종목 + DE 1종목 집행: <strong>SHORT→W3(TY는 W7), LONG→W7(65%)+Sniper(35%)</strong>. 10D 1/3(Tier-1 D-1 상한) → 20D 2/3 → 동조 3/3 × 국면배수(L2 1.25~1.48x / L3 1.58~1.90x). 2.5SD 손절 + 3~5일 타임스탑 + 국면별 잠금/러너 연장.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    `
        : ''
    }

    ${
      showMonthly
        ? `
    <!-- PART 3: 59-MONTH CHARTS & FULL MONTHLY MATRIX -->
    <div class="panel below">
      <div class="panel-head">
        <div>
          <div class="eyebrow">PART 3 · 59-MONTH PNL TRAJECTORY (A3 v3.0 BRAKE + MOMENTUM v3.5 · NEXT-DAY OPEN STOP)</div>
          <h2>3. 59개월 누적·월별 손익 추이 (${yearFilter === 'ALL' ? '전체 59개월' : yearFilter + '년'} · ${
            portfolioMode === 'COMBO' ? '통합 A3 + 모멘텀 v3.5' : portfolioMode === 'FX_ONLY' ? 'FX A3 단독' : '모멘텀 v3.5 단독'
          })</h2>
        </div>
      </div>

      <div style="margin-top:6px;">${renderMonthlyEquitySvg(chartMonths, portfolioMode)}</div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border,rgba(148,163,184,0.2));">${renderMonthlyBarSvg(chartMonths, portfolioMode)}</div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:14px;">
        <div style="border:1px solid var(--border,rgba(148,163,184,0.25));border-radius:10px;padding:12px;">
          <div style="font-weight:800;font-size:13px;margin-bottom:6px;">상호 헤지 실증 (일간 상관 ${hl.corr_fx_mom})</div>
          <div style="font-size:12px;line-height:1.7;">
            • 모멘텀 손실월 <strong>${mh.mom_loss_months}개월 중 ${mh.mom_rescued_by_fx}개월</strong>을 FX A3가 흑자 전환<br>
            • FX 손실월 <strong>${mh.fx_loss_months}개월 중 ${mh.fx_rescued_by_mom}개월</strong>을 모멘텀 v3.5가 흑자 전환<br>
            • 통합 2022~2024년 3년 연속 매년 약 <strong>+$100만</strong> ($985k~$1,006k) 달성
          </div>
        </div>
        <div style="border:1px solid rgba(13,148,136,0.3);border-radius:10px;padding:12px;">
          <div style="font-weight:800;font-size:13px;color:#0d9488;margin-bottom:6px;">최우수 5개월</div>
          <div style="font-size:12px;line-height:1.7;">
            ${(top5 || [])
              .map(
                (r, idx) =>
                  `<div style="display:flex;justify-content:space-between;gap:8px;">
                    <span><strong>${idx + 1}. ${r.ym}</strong></span>
                    <span><strong class="green">${fmtUsd(portfolioMode === 'COMBO' ? r.combo_a3 : portfolioMode === 'FX_ONLY' ? r.fx_a3 : r.mom_v35)}</strong> <span class="muted">(FX ${fmtUsd(r.fx_a3)} / 모멘 ${fmtUsd(r.mom_v35)})</span></span>
                  </div>`
              )
              .join('')}
          </div>
        </div>
        <div style="border:1px solid rgba(225,29,72,0.3);border-radius:10px;padding:12px;">
          <div style="font-weight:800;font-size:13px;color:#e11d48;margin-bottom:6px;">최악 5개월</div>
          <div style="font-size:12px;line-height:1.7;">
            ${(bot5 || [])
              .map(
                (r, idx) =>
                  `<div style="display:flex;justify-content:space-between;gap:8px;">
                    <span><strong>${idx + 1}. ${r.ym}</strong></span>
                    <span><strong class="red">${fmtUsd(portfolioMode === 'COMBO' ? r.combo_a3 : portfolioMode === 'FX_ONLY' ? r.fx_a3 : r.mom_v35)}</strong> <span class="muted">(FX ${fmtUsd(r.fx_a3)} / 모멘 ${fmtUsd(r.mom_v35)})</span></span>
                  </div>`
              )
              .join('')}
          </div>
        </div>
      </div>

      <div class="panel-head" style="margin-top:18px;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0;font-size:14.5px;">59개월 월별 손익추이 &amp; 레이더 매트릭스 (${tableMonths.length}개월 표시)</h3>
        <div class="segmented" role="group" aria-label="월별 필터">
          ${[
            ['ALL', '전체'],
            ['BIG_WIN', portfolioMode === 'MOM_ONLY' ? '대승 (+$50k↑)' : '대승 (+$150k↑)'],
            ['LOSS', '적자월'],
            ['SEVERE', portfolioMode === 'MOM_ONLY' ? '하락 (−$20k↓)' : '하락 (−$50k↓)'],
            ['FX_ZERO', 'FX 휴식(0건)'],
          ]
            .map(([k, l]) => `<button type="button" data-r3-mfilter="${k}" class="${monthFilter === k ? 'on' : ''}">${l}</button>`)
            .join('')}
        </div>
      </div>

      <div class="table-scroll" style="max-height:600px;overflow-y:auto;">
        <table>
          <thead style="position:sticky;top:0;z-index:2;background:var(--surface,#fff);">
            <tr>
              <th>년-월</th>
              <th class="number">v2 평균</th>
              <th class="number">Shock4 평균</th>
              <th>주력 상태</th>
              <th class="number">FX 진입</th>
              <th class="number">FX A3 당월</th>
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
                (r) => `<tr style="${r.combo_a3 >= 150000 ? 'background:rgba(13,148,136,0.06);' : r.combo_a3 <= -50000 ? 'background:rgba(225,29,72,0.06);' : ''}">
                <td><strong>${r.ym}</strong></td>
                <td class="number">${fmtNum(r.v2_avg, 1)}</td>
                <td class="number">${fmtNum(r.shock4_avg, 1)}%</td>
                <td>${stateBadge(r.state)}</td>
                <td class="number">${r.fx_entries === 0 ? '<span class="muted">0건(휴식)</span>' : `<strong>${r.fx_entries}건</strong>`}</td>
                <td class="number ${clsPnl(r.fx_a3)}"><strong>${fmtUsd(r.fx_a3)}</strong></td>
                <td class="number muted">${fmtUsd(r.fx_a3_cum)}</td>
                <td class="number ${clsPnl(r.mom_v35)}">${fmtUsd(r.mom_v35)}</td>
                <td class="number ${clsPnl(r.combo_a3)}"><strong>${fmtUsd(r.combo_a3)}</strong></td>
                <td class="number"><strong>${fmtUsd(r.combo_a3_cum)}</strong></td>
                <td class="number ${r.combo_a3_dd < 0 ? 'red' : 'muted'}">${r.combo_a3_dd === 0 ? '$0' : fmtUsd(r.combo_a3_dd)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
          <tfoot style="position:sticky;bottom:0;background:var(--surface-2,#f8fafc);font-weight:800;">
            <tr>
              <td colspan="4">선택 구간 합계 (${tableMonths.length}개월)</td>
              <td class="number">${sumFxN}건</td>
              <td class="number ${clsPnl(sumFx)}">${fmtUsd(sumFx)}</td>
              <td class="number">—</td>
              <td class="number ${clsPnl(sumMom)}">${fmtUsd(sumMom)}</td>
              <td class="number ${clsPnl(sumCb)}">${fmtUsd(sumCb)}</td>
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
      showResearch
        ? `
    <!-- PART 4: RESEARCH EVIDENCE, PLATEAU TEST, ANNUAL & EVOLUTION -->
    <div class="panel below">
      <div class="panel-head">
        <div>
          <div class="eyebrow">PART 4 · RADAR v3.0 EMPIRICAL RESEARCH · SENSOR SCAN · PLATEAU STABILITY · ANNUAL SUMMARY</div>
          <h2>4. 연도별 요약 · 27개 센서 선행 검증 · 민감도 고원(Plateau) &amp; 진화 비교</h2>
        </div>
      </div>

      <h3 style="margin:6px 0 8px;font-size:14px;">연도별 거래·평균보유·손익 요약 (FX v2.0 vs FX A3 v3.0 vs 통합)</h3>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>연도</th><th class="number">v2 평균</th><th class="number">Shock4 평균</th>
              <th class="number">FX 평균보유</th><th class="number">FX 진입</th>
              <th class="number">기존 FX v2.0</th><th class="number">FX A3 v3.0</th>
              <th class="number">모멘텀 v3.5</th><th class="number">통합 (A3+v3.5)</th><th class="number">통합 승월</th>
            </tr>
          </thead>
          <tbody>
            ${(data.annual_summary || [])
              .map(
                (a) => `<tr>
                <td><strong>${a.year}년</strong> ${a.year === '2026' ? '<span class="muted" style="font-size:11px;">(~11월)</span>' : ''}</td>
                <td class="number">${fmtNum(a.v2_avg, 1)}</td>
                <td class="number">${fmtNum(a.shock4_avg, 1)}%</td>
                <td class="number">${fmtNum(a.fx_avg_pos, 2)}개</td>
                <td class="number">${a.fx_entries}건</td>
                <td class="number ${clsPnl(a.fx_v2)}">${fmtUsd(a.fx_v2)}</td>
                <td class="number ${clsPnl(a.fx_a3)}"><strong>${fmtUsd(a.fx_a3)}</strong></td>
                <td class="number ${clsPnl(a.mom_v35)}"><strong>${fmtUsd(a.mom_v35)}</strong></td>
                <td class="number ${clsPnl(a.combo_a3)}"><strong>${fmtUsd(a.combo_a3)}</strong></td>
                <td class="number"><strong>${a.combo_win_m}/${a.months}</strong></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <h3 style="margin:18px 0 8px;font-size:14px;">1단계 27개 센서 스캔 — 전·후반기 일치 채택 핵심 센서 근거</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>센서</th><th>용도</th><th>미래 IC (5d/10d/20d)</th><th>전반(22-24) / 후반(25-26)</th><th>역할 및 실증 근거</th></tr></thead>
          <tbody>
            ${(data.sensor_findings || [])
              .map(
                (sf) => `<tr>
                <td><strong><code>${esc(sf.sensor)}</code></strong></td>
                <td><span class="tag primary">${esc(sf.target)}</span></td>
                <td style="font-family:ui-monospace,Consolas,monospace;font-size:11.5px;">${esc(sf.ic)}</td>
                <td style="font-family:ui-monospace,Consolas,monospace;font-size:11.5px;">${esc(sf.h1_h2)}</td>
                <td style="font-size:12px;">${esc(sf.role)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px;margin-top:16px;">
        <div>
          <h3 style="margin:0 0 8px;font-size:14px;">레이더 진화 비교표 (전부 익일 Open 손절 · 클램핑 0%)</h3>
          <div class="table-scroll">
            <table>
              <thead><tr><th>모델</th><th class="number">총 순손익</th><th class="number">MDD</th><th class="number">Sharpe</th><th class="number">Calmar</th></tr></thead>
              <tbody>
                ${(data.evolution_rows || [])
                  .map((ev) => {
                    const isHi = ev.key === 'fx_a3' || ev.key === 'cb_a3';
                    return `<tr style="${isHi ? 'background:rgba(13,148,136,0.09);font-weight:700;' : ''}">
                      <td style="font-size:12px;">${esc(ev.label)}</td>
                      <td class="number ${clsPnl(ev.total_net)}"><strong>${fmtUsd(ev.total_net)}</strong></td>
                      <td class="number red">−$${fmtNum(ev.mdd)}</td>
                      <td class="number"><strong>${ev.sharpe}</strong></td>
                      <td class="number">${ev.calmar}x</td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style="margin:0 0 8px;font-size:14px;">민감도 고원(Plateau) 검증 (±4점 경계 흔들기)</h3>
          <div class="table-scroll">
            <table>
              <thead><tr><th>테스트 구간</th><th class="number">FX 순손익</th><th class="number">MDD</th><th class="number">Sharpe</th><th class="number">Calmar</th></tr></thead>
              <tbody>
                ${(data.plateau_rows || [])
                  .map((ev) => {
                    const isHi = ev.key === 'a3_base';
                    return `<tr style="${isHi ? 'background:rgba(13,148,136,0.09);font-weight:700;' : ''}">
                      <td style="font-size:12px;">${esc(ev.label)}</td>
                      <td class="number ${clsPnl(ev.total_net)}"><strong>${fmtUsd(ev.total_net)}</strong></td>
                      <td class="number red">−$${fmtNum(ev.mdd)}</td>
                      <td class="number"><strong>${ev.sharpe}</strong></td>
                      <td class="number">${ev.calmar}x</td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    `
        : ''
    }
  `;

  // Bind controls
  target.querySelectorAll('[data-r3-pmode]').forEach((b) => {
    b.onclick = () => {
      portfolioMode = b.dataset.r3Pmode;
      monthFilter = 'ALL';
      renderMomentumRadarV3(target);
    };
  });
  target.querySelectorAll('[data-r3-sec]').forEach((b) => {
    b.onclick = () => {
      sectionTab = b.dataset.r3Sec;
      renderMomentumRadarV3(target);
    };
  });
  target.querySelectorAll('[data-r3-yr]').forEach((b) => {
    b.onclick = () => {
      yearFilter = b.dataset.r3Yr;
      dailyHoverIdx = -1;
      renderMomentumRadarV3(target);
    };
  });
  target.querySelectorAll('[data-r3-mfilter]').forEach((b) => {
    b.onclick = () => {
      monthFilter = b.dataset.r3Mfilter;
      renderMomentumRadarV3(target);
    };
  });
  target.querySelectorAll('[data-r3-dview]').forEach((b) => {
    b.onclick = () => {
      dailyViewMode = b.dataset.r3Dview;
      dailyHoverIdx = -1;
      renderMomentumRadarV3(target);
    };
  });

  // Bind daily canvas hover & draw
  const cv = target.querySelector('#r3-daily-cv');
  if (cv && data.daily_series) {
    drawDailyCanvas(target, data.daily_series);
    cv.onmousemove = (e) => {
      const rows = yearFilter === 'ALL' ? data.daily_series : data.daily_series.filter((r) => r[0].startsWith(yearFilter));
      const rect = cv.getBoundingClientRect();
      const padL = 62, padR = 16;
      const frac = (e.clientX - rect.left - padL) / Math.max(1, rect.width - padL - padR);
      dailyHoverIdx = Math.max(0, Math.min(rows.length - 1, Math.round(frac * (rows.length - 1))));
      drawDailyCanvas(target, data.daily_series);
    };
    cv.onmouseleave = () => {
      dailyHoverIdx = -1;
      drawDailyCanvas(target, data.daily_series);
    };
  }

  const expBtn = target.querySelector('#r3-export-csv');
  if (expBtn) {
    expBtn.onclick = () => {
      downloadCsv('fx-v3-a3-brake-plus-momentum-v35-59months.csv', [
        ['year_month', 'v2_avg', 'shock4_avg_pct', 'state', 'fx_entries', 'fx_a3_usd', 'fx_a3_cum_usd', 'fx_v2_usd', 'mom_v35_usd', 'combo_a3_usd', 'combo_a3_cum_usd', 'combo_a3_dd_usd'],
        ...allMonths.map((r) => [r.ym, r.v2_avg, r.shock4_avg, r.state, r.fx_entries, r.fx_a3, r.fx_a3_cum, r.fx_v2, r.mom_v35, r.combo_a3, r.combo_a3_cum, r.combo_a3_dd]),
      ]);
    };
  }
}
