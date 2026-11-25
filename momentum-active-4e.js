import { getChartTheme } from './chart-utils.js?v=16';

let a4Data = null;
let selectedSetting = 'B'; // 'B' (Soft Hybrid default) | 'C' (Annual LoS) | 'A' (No DD Control)
let sectionFilter = 'ALL'; // 'ALL' | 'LIVE' | 'PERF' | 'RULES' | 'AUDIT'
let perfPeriod = '11Y'; // '11Y' | '26Y' | 'REGIMES'

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

const fmtK = (v, signed = true) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const k = Number(v) / 1000;
  if (Math.abs(k) < 0.5) return '$0k';
  if (!signed) return '$' + fmtNum(Math.abs(k), 0) + 'k';
  return (k < 0 ? '−$' : '+$') + fmtNum(Math.abs(k), 0) + 'k';
};

const fmtM = (v, signed = true) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const m = Number(v) / 1e6;
  if (!signed) return '$' + fmtNum(Math.abs(m), 2) + 'M';
  return (m < 0 ? '−$' : m > 0 ? '+$' : '$') + fmtNum(Math.abs(m), 2) + 'M';
};

const clsVal = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) < 0.5) return 'muted';
  return n > 0 ? 'green' : 'red';
};

const pill = (text, tone = 'neutral') => {
  const map = {
    green: ['rgba(13,148,136,0.14)', '#0d9488'],
    red: ['rgba(220,38,38,0.14)', '#dc2626'],
    amber: ['rgba(217,119,6,0.15)', '#d97706'],
    blue: ['rgba(37,99,235,0.14)', '#2563eb'],
    neutral: ['rgba(100,116,139,0.14)', '#64748b'],
  };
  const [bg, fg] = map[tone] || map.neutral;
  return `<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;background:${bg};color:${fg};white-space:nowrap;">${esc(text)}</span>`;
};

function statusPill(st) {
  if (!st) return pill('대기', 'neutral');
  if (st === 'OPEN') return pill('보유중', 'blue');
  if (st === 'SIGNAL') return pill('진입신호', 'green');
  if (st.startsWith('COOLDOWN')) return pill(st.replace('COOLDOWN', '쿨다운'), 'red');
  if (st === 'BETA_CAP') return pill('베타캡 차단', 'amber');
  if (st === 'NODE_CAP') return pill('통화한도', 'amber');
  if (st === 'S4_PAUSE') return pill('S4 중단', 'red');
  return pill('관찰', 'neutral');
}

async function loadActive4eData() {
  if (a4Data) return a4Data;
  const res = await fetch('./data/active-4e-report.json?v=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('4엔진 풀액티브 리포트 데이터(./data/active-4e-report.json)를 불러오지 못했습니다.');
  }
  a4Data = await res.json();
  return a4Data;
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

function renderMonthlyEquitySvg(data, activeKey) {
  const ct = getChartTheme();
  const ink = ct.ink || '#0f172a';
  const mB = data.settings.B.monthly_5y || [];
  const mC = data.settings.C.monthly_5y || [];
  const mA = data.settings.A.monthly_5y || [];
  if (!mB.length) return '<div class="empty">월간 시계열 데이터가 없습니다.</div>';

  const n = mB.length;
  const vals = [...mB.map((r) => r.cum), ...mC.map((r) => r.cum), ...mA.map((r) => r.cum), 0];
  const lo = Math.min(0, ...vals);
  const hi = Math.max(1000000, ...vals);
  const w = 1040, h = 285, padL = 82, padR = 24, padT = 38, padB = 34;
  const x = (i) => padL + (i * (w - padL - padR)) / Math.max(1, n - 1);
  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const makePath = (arr) => arr.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(r.cum).toFixed(1)}`).join(' ');
  const ticks = [lo, lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.75, hi];

  const mainArr = data.settings[activeKey].monthly_5y;
  const styles = {
    B: { col: '#0d9488', lbl: '세팅 B · 소프트 하이브리드' },
    C: { col: '#2563eb', lbl: '세팅 C · 연간 LoS 하드스탑' },
    A: { col: '#94a3b8', lbl: '세팅 A · 제어 OFF' },
  };

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="최근 5년 누적 손익 곡선">
    <g transform="translate(${padL}, 18)" style="font-size:11.5px;font-weight:700;fill:${ink};">
      <line x1="0" y1="-4" x2="20" y2="-4" stroke="${styles.B.col}" stroke-width="${activeKey === 'B' ? 3.2 : 1.8}" ${activeKey === 'B' ? '' : 'stroke-dasharray="5 3"'}/>
      <text x="25" y="0" fill="${ink}">세팅 B (추천): ${fmtM(mB.at(-1)?.cum)}</text>
      <line x1="290" y1="-4" x2="310" y2="-4" stroke="${styles.C.col}" stroke-width="${activeKey === 'C' ? 3.2 : 1.8}" ${activeKey === 'C' ? '' : 'stroke-dasharray="5 3"'}/>
      <text x="315" y="0" fill="${ink}">세팅 C (연간LoS): ${fmtM(mC.at(-1)?.cum)}</text>
      <line x1="600" y1="-4" x2="620" y2="-4" stroke="${styles.A.col}" stroke-width="${activeKey === 'A' ? 3.2 : 1.8}" ${activeKey === 'A' ? '' : 'stroke-dasharray="2 3"'}/>
      <text x="625" y="0" fill="${ink}">세팅 A (무제어): ${fmtM(mA.at(-1)?.cum)}</text>
    </g>
    ${ticks.map((tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${ct.grid}" stroke-dasharray="3 3"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${ink}" font-size="11" font-weight="600">$${fmtNum(tv / 1e6, 1)}M</text>`).join('')}
    <line x1="${padL}" x2="${w - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="${ct.zero}" stroke-width="1.2"/>
    <path d="${makePath(mA)}" fill="none" stroke="${styles.A.col}" stroke-width="${activeKey === 'A' ? 3.2 : 1.7}" ${activeKey === 'A' ? '' : 'stroke-dasharray="2 3"'}/>
    <path d="${makePath(mC)}" fill="none" stroke="${styles.C.col}" stroke-width="${activeKey === 'C' ? 3.2 : 1.9}" ${activeKey === 'C' ? '' : 'stroke-dasharray="5 3"'}/>
    <path d="${makePath(mB)}" fill="none" stroke="${styles.B.col}" stroke-width="${activeKey === 'B' ? 3.2 : 1.9}" ${activeKey === 'B' ? '' : 'stroke-dasharray="5 3"'}/>
    ${mainArr.map((r, i) => `
      <circle cx="${x(i).toFixed(1)}" cy="${y(r.cum).toFixed(1)}" r="4.0" fill="${styles[activeKey].col}" opacity="0.88">
        <title>[${r.ym}] ${styles[activeKey].lbl}
누적: ${fmtUsd(r.cum)} | 당월: ${fmtUsd(r.pnl)} (평균배수 ${r.dd_scale_avg}x)
- ①금리방향: ${fmtUsd(r.e1)}  ②커브박스: ${fmtUsd(r.e2)}
- ③FX평균회귀: ${fmtUsd(r.e3)}  ④FX추세돌파: ${fmtUsd(r.e4)}</title>
      </circle>`).join('')}
    ${mainArr.filter((r, i) => i === 0 || r.ym.endsWith('-01') || i === n - 1).map((r) => {
      const idx = mainArr.indexOf(r);
      return `<text x="${x(idx).toFixed(1)}" y="${h - 8}" text-anchor="${idx === n - 1 ? 'end' : idx === 0 ? 'start' : 'middle'}" fill="${ink}" font-size="11" font-weight="600">${r.ym}</text>`;
    }).join('')}
  </svg>`;
}

function renderMonthlyBarSvg(rows) {
  const ct = getChartTheme();
  const ink = ct.ink || '#0f172a';
  if (!rows.length) return '';
  const vals = rows.map((r) => r.pnl);
  const lo = Math.min(-500000, ...vals);
  const hi = Math.max(500000, ...vals);
  const w = 1040, h = 225, padL = 82, padR = 24, padT = 22, padB = 30;
  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const y0 = y(0);
  const slotW = (w - padL - padR) / Math.max(1, rows.length);
  const barW = Math.max(4, Math.min(12, slotW * 0.68));
  const step = hi - lo > 2500000 ? 500000 : 250000;
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  if (!ticks.includes(0)) ticks.push(0);

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="최근 5년 월간 손익 막대">
    ${ticks.map((tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${tv === 0 ? ct.zero : ct.grid}" stroke-dasharray="${tv === 0 ? 'none' : '3 3'}"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${ink}" font-size="10.5" font-weight="600">${tv < 0 ? '−' : ''}$${fmtNum(Math.abs(tv) / 1000, 0)}k</text>`).join('')}
    ${rows.map((r, i) => {
      const cx = padL + (i + 0.5) * slotW;
      const yv = y(r.pnl);
      const top = Math.min(y0, yv);
      const bh = Math.max(1.5, Math.abs(yv - y0));
      const fill = r.stop_days >= 10 ? '#94a3b8' : r.pnl >= 0 ? '#0d9488' : '#dc2626';
      return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${fill}" opacity="0.88">
        <title>[${r.ym}] 당월 ${fmtUsd(r.pnl)} (누적 ${fmtUsd(r.cum)})
①금리 ${fmtUsd(r.e1)} | ②커브 ${fmtUsd(r.e2)} | ③FX4 ${fmtUsd(r.e3)} | ④FX돌파 ${fmtUsd(r.e4)}${r.stop_days ? `\n연간 LoS 정지일: ${r.stop_days}일` : ''}</title>
      </rect>`;
    }).join('')}
    ${rows.filter((r, i) => i === 0 || r.ym.endsWith('-01') || i === rows.length - 1).map((r) => {
      const idx = rows.indexOf(r);
      const cx = padL + (idx + 0.5) * slotW;
      return `<text x="${cx.toFixed(1)}" y="${h - 8}" text-anchor="${idx === rows.length - 1 ? 'end' : idx === 0 ? 'start' : 'middle'}" fill="${ink}" font-size="10.5" font-weight="600">${r.ym}</text>`;
    }).join('')}
  </svg>`;
}

function renderMonthlyCalendarTable(rows) {
  const byYm = {};
  for (const r of rows) byYm[r.ym] = r;
  const years = [...new Set(rows.map((r) => r.ym.slice(0, 4)))].sort();
  return `<div style="overflow-x:auto;">
    <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
      <thead>
        <tr>
          <th style="text-align:left;">연도</th>
          ${Array.from({ length: 12 }, (_, i) => `<th style="text-align:right;">${i + 1}월</th>`).join('')}
          <th style="text-align:right;">연간 합계</th>
        </tr>
      </thead>
      <tbody>
        ${years.map((yr) => {
          let ysum = 0;
          const tds = Array.from({ length: 12 }, (_, mIdx) => {
            const k = `${yr}-${String(mIdx + 1).padStart(2, '0')}`;
            const r = byYm[k];
            if (!r) return `<td style="text-align:right;" class="muted">—</td>`;
            ysum += r.pnl;
            const stopTag = r.stop_days >= 10 ? '*' : '';
            const bg =
              r.stop_days >= 10
                ? 'background:rgba(148,163,184,0.14);'
                : r.pnl >= 500000
                ? 'background:rgba(13,148,136,0.16);'
                : r.pnl <= -500000
                ? 'background:rgba(220,38,38,0.15);'
                : '';
            return `<td style="text-align:right;${bg}" class="${clsVal(r.pnl)}" title="①금리 ${fmtK(r.e1)} / ②커브 ${fmtK(r.e2)} / ③FX4 ${fmtK(r.e3)} / ④FX돌파 ${fmtK(r.e4)}">${fmtK(r.pnl)}${stopTag}</td>`;
          }).join('');
          return `<tr>
            <td style="font-weight:700;">${yr}</td>
            ${tds}
            <td style="text-align:right;font-weight:800;" class="${clsVal(ysum)}">${fmtUsd(ysum)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
  <div class="muted" style="font-size:11.5px;margin-top:6px;">
    * 표시 = 연간 손절 한도(LoS) 도달로 해당 월 10거래일 이상 매매 정지 · 각 셀에 마우스를 올리면 4개 엔진별 월간 기여도가 표시됩니다.
  </div>`;
}

function renderLiveNettingAndEngines(data, st) {
  const sc = st.live_scales;
  const eng = data.live_engines;
  const nf = st.live_net_futures;
  const nx = st.live_net_fx;
  const mac = eng.e3_macro;

  return `
  <div class="panel" style="margin-bottom:16px;">
    <div class="panel-head">
      <div>
        <h2>엔진 간 순합(Netting) 최종 주문표 · 기준일 ${esc(data.meta.as_of)}</h2>
        <p class="muted" style="margin:3px 0 0;font-size:12px;">
          독일 5년(OE) 완전 제외 · 현재 감속배수 <b>${sc.dd_scale}x</b> (YTD ${fmtUsd(sc.ytd_pnl)}, 고점대비 −$${fmtNum(sc.peak_dd)}) · 실효배수: ①금리 ${sc.eff_e1}x · ②커브 ${sc.eff_e2}x · ③FX4 ${sc.eff_e3}x · ④FX돌파 ${sc.eff_e4}x
        </p>
      </div>
      <div>${pill(st.label, selectedSetting === 'B' ? 'green' : selectedSetting === 'C' ? 'blue' : 'neutral')}</div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px;margin-top:12px;">
      <div style="border:1px solid var(--line);border-radius:10px;padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <b>국채선물 최종 순합 (① 방향성 + ② 커브·박스)</b>
          <span style="font-size:12px;" class="muted">절대 DV01 <b>$${fmtNum(nf.abs_dv01_usd)}/bp</b> · 순 방향 DV01 <b class="${clsVal(nf.net_dv01_usd)}">${fmtUsd(nf.net_dv01_usd)}/bp</b></span>
        </div>
        <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12.5px;">
          <thead>
            <tr>
              <th style="text-align:left;">종목</th>
              <th style="text-align:right;">① 방향성</th>
              <th style="text-align:right;">② 커브·박스</th>
              <th style="text-align:right;">최종 순계약</th>
              <th style="text-align:right;">순 DV01</th>
            </tr>
          </thead>
          <tbody>
            ${nf.rows.map((r) => `<tr>
              <td><b>${esc(r.cid)}</b> <span class="muted" style="font-size:11px;">${esc(r.name)}</span></td>
              <td style="text-align:right;" class="${clsVal(r.e1_ct)}">${r.e1_ct ? (r.e1_ct > 0 ? '+' : '') + fmtNum(r.e1_ct, 1) : '—'}</td>
              <td style="text-align:right;" class="${clsVal(r.e2_ct)}">${r.e2_ct ? (r.e2_ct > 0 ? '+' : '') + fmtNum(r.e2_ct, 1) : '—'}</td>
              <td style="text-align:right;font-weight:800;" class="${clsVal(r.net_ct)}">${r.net_ct > 0 ? '+' : ''}${fmtNum(r.net_ct)}계약</td>
              <td style="text-align:right;" class="${clsVal(r.dv01_usd)}">${fmtUsd(r.dv01_usd)}/bp</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div style="border:1px solid var(--line);border-radius:10px;padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <b>FX 통화별 최종 순합 (③ 평균회귀 + ④ 추세돌파)</b>
          <span style="font-size:12px;" class="muted">순 USD <b class="${clsVal(nx.net_usd_leg)}">${fmtM(nx.net_usd_leg)}</b> · 일방 합계 <b>$${fmtNum(nx.gross_fx_usd / 1e6, 2)}M</b></span>
        </div>
        <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12.5px;">
          <thead>
            <tr>
              <th style="text-align:left;">통화</th>
              <th style="text-align:right;">③ FX4 평균회귀</th>
              <th style="text-align:right;">④ FX 추세돌파</th>
              <th style="text-align:right;">최종 순명목</th>
            </tr>
          </thead>
          <tbody>
            ${nx.rows.map((r) => `<tr>
              <td><b>${esc(r.ccy)}</b></td>
              <td style="text-align:right;" class="${clsVal(r.e3_usd)}">${r.e3_usd ? fmtM(r.e3_usd) : '—'}</td>
              <td style="text-align:right;" class="${clsVal(r.e4_usd)}">${r.e4_usd ? fmtM(r.e4_usd) : '—'}</td>
              <td style="text-align:right;font-weight:800;" class="${clsVal(r.net_usd)}">${fmtM(r.net_usd)}</td>
            </tr>`).join('')}
            <tr style="border-top:2px solid var(--line);">
              <td><b>USD (상대레그 순합)</b></td>
              <td style="text-align:right;" class="muted">달러중립</td>
              <td style="text-align:right;" class="${clsVal(nx.net_usd_leg)}">${fmtM(nx.net_usd_leg)}</td>
              <td style="text-align:right;font-weight:800;" class="${clsVal(nx.net_usd_leg)}">${fmtM(nx.net_usd_leg)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:16px;margin-bottom:16px;">
    <div class="panel">
      <div class="panel-head">
        <h3>엔진 ① US/DE 방향성 금리 (비중 ${Math.round(st.weights[0] * 100)}%)</h3>
        <span class="muted" style="font-size:11.5px;">US 1 + DE 1 집중 · 50D/8σ 청산</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;">종목</th>
              <th style="text-align:right;">현재가</th>
              <th style="text-align:right;">CTA (동의)</th>
              <th style="text-align:left;">상태 · 진입</th>
              <th style="text-align:right;">8σ트레일 / 50D출구</th>
              <th style="text-align:right;">실전 계약</th>
            </tr>
          </thead>
          <tbody>
            ${eng.e1_rows.map((r) => {
              const op = r.open;
              const liveCt = op ? Math.round(op.raw_ct_1x * sc.eff_e1) : 0;
              return `<tr>
                <td><b>${esc(r.cid)}</b></td>
                <td style="text-align:right;">${fmtNum(r.px, 2)}</td>
                <td style="text-align:right;" class="${clsVal(r.cta)}">${r.cta > 0 ? '+' : ''}${fmtNum(r.cta, 2)} (${r.agree}/6)</td>
                <td>${op ? `${pill(op.side, op.dir > 0 ? 'green' : 'red')} <span class="muted" style="font-size:11px;">${op.entry_date} (${op.hd}일)</span>` : pill('대기', 'neutral')}</td>
                <td style="text-align:right;">${op ? `${fmtNum(op.trail_px, 2)} / <b>${fmtNum(op.ch50_exit, 2)}</b>` : `<span class="muted">${fmtNum(r.ch50[0], 2)}~${fmtNum(r.ch50[1], 2)}</span>`}</td>
                <td style="text-align:right;font-weight:700;" class="${clsVal(liveCt)}">${op ? (liveCt > 0 ? '+' : '') + fmtNum(liveCt) + '계약' : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>엔진 ② US/DE 커브·박스 스프레드 (비중 ${Math.round(st.weights[1] * 100)}%)</h3>
        <span class="muted" style="font-size:11.5px;">핵심 2스프레드 (US 2s10s · 미-독 2Y) · 50D/8σ 청산</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;">스프레드</th>
              <th style="text-align:right;">CTA (동의)</th>
              <th style="text-align:left;">상태 · 보유</th>
              <th style="text-align:right;">레그 분해 (실전 계약)</th>
            </tr>
          </thead>
          <tbody>
            ${eng.e2_rows.map((r) => {
              const op = r.open;
              const ca = op ? Math.round(op.ct_a_1x * sc.eff_e2) : 0;
              const cb = op ? Math.round(op.ct_b_1x * sc.eff_e2) : 0;
              return `<tr>
                <td><b>${esc(r.sp)}</b><div class="muted" style="font-size:10.5px;">${esc(r.label)}</div></td>
                <td style="text-align:right;" class="${clsVal(r.cta)}">${r.cta > 0 ? '+' : ''}${fmtNum(r.cta, 2)} (${r.agree}/6)</td>
                <td>${op ? `${pill(op.side, op.dir > 0 ? 'green' : 'red')} <span class="muted" style="font-size:11px;">${op.entry_date} (${op.hd}일)</span>` : pill('대기', 'neutral')}</td>
                <td style="text-align:right;">${op ? `<b>${r.leg_a}</b> ${ca > 0 ? '+' : ''}${ca} / <b>${r.leg_b}</b> ${cb > 0 ? '+' : ''}${cb}` : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:16px;margin-bottom:16px;">
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>엔진 ③ FX4 금리차 보정 평균회귀 (비중 ${Math.round(st.weights[2] * 100)}%)</h3>
          <div class="muted" style="font-size:11.5px;margin-top:2px;">
            S4 Stress <b>${mac.stress}</b> (RV10/60 ${mac.rv10_60} · MOVE/MA60 ${mac.move_rel}) → 배수 <b>${mac.s4_scale}x</b> (${mac.allow_new ? '신규허용' : '신규중단'}) · Net Beta <b>${mac.net_beta > 0 ? '+' : ''}${mac.net_beta}</b> / ±2.0
          </div>
        </div>
        <div>${pill(mac.allow_new ? 'S4 정상' : 'S4 중단', mac.allow_new ? 'green' : 'red')}</div>
      </div>

      ${eng.e3_open.length ? `<div style="margin-bottom:10px;padding:9px 11px;border-radius:8px;background:rgba(37,99,235,0.07);border:1px solid rgba(37,99,235,0.22);font-size:12px;">
        <b>현재 보유 FX4 페어 (${eng.e3_open.length}/6)</b>
        ${eng.e3_open.map((p) => {
          const legUsd = Math.round(p.raw_leg_1x * sc.eff_e3);
          return `<div style="margin-top:4px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
            <span><b>${esc(p.pair)}</b> (${esc(p.side)}) · 진입 ${p.entry_date} Z=${p.entry_z} → 현 <b>Z=${p.cur_z}</b> (TP ±0.2) · 캐리 <b>+${p.carry_pct}%</b> · ${p.hd}일</span>
            <span>레그당 <b>${fmtM(legUsd, false)}</b></span>
          </div>`;
        }).join('')}
      </div>` : '<div class="muted" style="font-size:12px;margin-bottom:8px;">현재 보유 중인 FX4 페어가 없습니다.</div>'}

      ${eng.e3_cooldowns.length ? `<div style="margin-bottom:8px;font-size:11.5px;" class="muted">
        <b>20일 쿨다운 차단중:</b> ${eng.e3_cooldowns.map((c) => `${esc(c.pair)} (잔여 ${c.remain_days}일)`).join(' · ')}
      </div>` : ''}

      <div style="overflow-x:auto;">
        <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;">페어 (방향)</th>
              <th style="text-align:right;">2F-Z</th>
              <th style="text-align:right;">순캐리</th>
              <th style="text-align:right;">상관</th>
              <th style="text-align:right;">비용배수</th>
              <th style="text-align:right;">판정</th>
            </tr>
          </thead>
          <tbody>
            ${eng.e3_candidates.slice(0, 8).map((c) => `<tr>
              <td><b>${esc(c.pair)}</b> <span class="muted" style="font-size:10.5px;">${esc(c.side)}</span></td>
              <td style="text-align:right;font-weight:700;" class="${Math.abs(c.z) >= 2.4 ? 'blue' : 'muted'}">${c.z > 0 ? '+' : ''}${fmtNum(c.z, 2)}</td>
              <td style="text-align:right;" class="${c.carry_pct >= 1.0 ? 'green' : 'muted'}">${c.carry_pct > 0 ? '+' : ''}${fmtNum(c.carry_pct, 1)}%</td>
              <td style="text-align:right;">${fmtNum(c.corr, 2)}</td>
              <td style="text-align:right;" class="${c.edge_x >= 8 ? 'green' : 'muted'}">${fmtNum(c.edge_x, 1)}x</td>
              <td style="text-align:right;">${statusPill(c.status)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>엔진 ④ FX 10→20일 추세돌파 (비중 ${Math.round(st.weights[3] * 100)}%)</h3>
        <span class="muted" style="font-size:11.5px;">슬림 헤지 · 최대 3통화 · |Net USD|≤2 · 50D/7σ 청산</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;">통화/USD</th>
              <th style="text-align:right;">CTA (동의)</th>
              <th style="text-align:right;">금리차(vs USD)</th>
              <th style="text-align:left;">상태 · 보유</th>
              <th style="text-align:right;">실전 명목</th>
            </tr>
          </thead>
          <tbody>
            ${eng.e4_rows.map((r) => {
              const op = r.open;
              const liveNom = op ? Math.round(op.raw_notional_1x * sc.eff_e4) : 0;
              return `<tr>
                <td><b>${esc(r.ccy)}</b> <span class="muted" style="font-size:10.5px;">${r.is_g10 ? 'G10' : 'EM'}</span></td>
                <td style="text-align:right;" class="${clsVal(r.cta)}">${r.cta > 0 ? '+' : ''}${fmtNum(r.cta, 2)} (${r.agree}/6)</td>
                <td style="text-align:right;" class="${clsVal(r.carry_vs_usd)}">${r.carry_vs_usd > 0 ? '+' : ''}${fmtNum(r.carry_vs_usd, 1)}%</td>
                <td>${op ? `${pill(op.side, op.dir > 0 ? 'green' : 'red')} <span class="muted" style="font-size:11px;">${op.entry_date} (${op.hd}일)</span>` : pill('대기', 'neutral')}</td>
                <td style="text-align:right;font-weight:700;" class="${clsVal(liveNom)}">${op ? fmtM(liveNom) : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function renderPerformanceSection(data, st) {
  const s5 = st.summary_5y;
  const s11 = st.summary_11y;
  const s26 = st.summary_26y;

  let periodTableHtml = '';
  if (perfPeriod === '11Y' || perfPeriod === '26Y') {
    const rows = perfPeriod === '11Y' ? st.annual_11y : st.annual_26y;
    periodTableHtml = `<div style="overflow-x:auto;">
      <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
        <thead>
          <tr>
            <th style="text-align:left;">연도</th>
            <th style="text-align:left;">구간</th>
            <th style="text-align:right;">4엔진 합계</th>
            <th style="text-align:right;">연중 최대DD</th>
            <th style="text-align:right;">① 금리방향</th>
            <th style="text-align:right;">② 커브·박스</th>
            <th style="text-align:right;">③ FX평균회귀</th>
            <th style="text-align:right;">④ FX추세돌파</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `<tr>
            <td style="font-weight:700;">${r.year}</td>
            <td>${pill(r.period, r.period === '5Y' ? 'blue' : 'neutral')}</td>
            <td style="text-align:right;font-weight:800;" class="${clsVal(r.pnl)}">${fmtUsd(r.pnl)}</td>
            <td style="text-align:right;" class="red">−$${fmtNum(r.yr_dd)}</td>
            <td style="text-align:right;" class="${clsVal(r.e1)}">${fmtK(r.e1)}</td>
            <td style="text-align:right;" class="${clsVal(r.e2)}">${fmtK(r.e2)}</td>
            <td style="text-align:right;" class="${clsVal(r.e3)}">${fmtK(r.e3)}</td>
            <td style="text-align:right;" class="${clsVal(r.e4)}">${fmtK(r.e4)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } else {
    periodTableHtml = `<div style="overflow-x:auto;">
      <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12.5px;">
        <thead>
          <tr>
            <th style="text-align:left;">매크로 위기 · 국면 (26년)</th>
            <th style="text-align:right;">구간 누적 손익</th>
            <th style="text-align:right;">연환산 손익</th>
            <th style="text-align:right;">Sharpe</th>
            <th style="text-align:right;">구간 내 MDD</th>
          </tr>
        </thead>
        <tbody>
          ${st.regimes_26y.map((r) => `<tr>
            <td style="font-weight:600;">${esc(r.label)}</td>
            <td style="text-align:right;font-weight:700;" class="${clsVal(r.tot)}">${fmtUsd(r.tot)}</td>
            <td style="text-align:right;" class="${clsVal(r.ann)}">${fmtUsd(r.ann)}/y</td>
            <td style="text-align:right;font-weight:700;" class="${clsVal(r.shp)}">${r.shp > 0 ? '+' : ''}${fmtNum(r.shp, 2)}</td>
            <td style="text-align:right;" class="red">−$${fmtNum(r.mdd)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  return `
  <div class="panel" style="margin-bottom:16px;">
    <div class="panel-head">
      <div>
        <h2>최근 5년 누적 · 월간 손익 (2022-01 ~ ${esc(data.meta.as_of.slice(0, 7))} · 59개월)</h2>
        <p class="muted" style="margin:3px 0 0;font-size:12px;">
          누적 <b>${fmtUsd(s5.tot)}</b> · 월평균 <b>${fmtUsd(s5.avg_m)}</b> (중앙값 ${fmtUsd(s5.med_m)}) · 월승률 <b>${s5.pos_m}/${s5.tot_m} (${s5.win_m_pct}%)</b> · 최고월 ${s5.best_m.ym} (${fmtK(s5.best_m.pnl)}) · 최악월 ${s5.worst_m.ym} (${fmtK(s5.worst_m.pnl)}) · 5년 MDD −$${fmtNum(s5.mdd)}
        </p>
      </div>
      <button class="btn quiet" id="a4-csv-btn">↓ 5년 월간 CSV</button>
    </div>
    ${renderMonthlyEquitySvg(data, selectedSetting)}
    <div style="margin-top:8px;">${renderMonthlyBarSvg(st.monthly_5y)}</div>
    <div style="margin-top:14px;">${renderMonthlyCalendarTable(st.monthly_5y)}</div>
  </div>

  <div class="panel" style="margin-bottom:16px;">
    <div class="panel-head">
      <div>
        <h2>장기 연도별 · 9대 국면별 4엔진 기여도</h2>
        <p class="muted" style="margin:3px 0 0;font-size:12px;">
          11.1년 실선물: 연평균 <b>${fmtUsd(s11.ann)}/y</b> (Shp ${s11.shp}, MDD −$${fmtNum(s11.mdd)}, 최악년 ${s11.worst_y.year} ${fmtK(s11.worst_y.pnl)}) · 26년 전체: 연평균 <b>${fmtUsd(s26.ann)}/y</b> (Shp ${s26.shp}, MDD −$${fmtNum(s26.mdd)}, 흑자 ${s26.pos_y}/${s26.tot_y}년)
        </p>
      </div>
      <div class="segmented">
        <button data-a4-period="11Y" class="${perfPeriod === '11Y' ? 'on' : ''}">11.1년 실선물</button>
        <button data-a4-period="26Y" class="${perfPeriod === '26Y' ? 'on' : ''}">26년 전체</button>
        <button data-a4-period="REGIMES" class="${perfPeriod === 'REGIMES' ? 'on' : ''}">9대 매크로 국면</button>
      </div>
    </div>
    <div style="margin-top:10px;">${periodTableHtml}</div>
  </div>`;
}

function renderRulebookSection(st) {
  const card = (title, badge, items) => `
    <div style="border:1px solid var(--line);border-radius:10px;padding:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <b style="font-size:14px;">${title}</b>
        ${badge}
      </div>
      <div style="font-size:12.5px;line-height:1.65;">
        ${items.map(([k, v]) => `<div style="margin-bottom:6px;"><b>${k}:</b> <span class="muted">${v}</span></div>`).join('')}
      </div>
    </div>`;

  return `
  <div class="panel" style="margin-bottom:16px;">
    <div class="panel-head">
      <div>
        <h2>4개 엔진 매매 룰북 — 시그널 · 진입 · 손절 · 청산 기준</h2>
        <p class="muted" style="margin:3px 0 0;font-size:12px;">전일(t−1) 종가 확정 데이터로만 계산하여 당일(t) 집행 · 미래 참조 없음 · 현실 스프레드(G10 2bp / EM 5bp) 및 실제 금리차 캐리 반영</p>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:14px;margin-top:12px;">
      ${card('엔진 ① US/DE 국채선물 방향성 추세추종', pill(`비중 ${Math.round(st.weights[0] * 100)}%`, 'blue'), [
        ['유니버스', '미국 TU/FV/TY + 독일 DU/RX 5종목 (독일 5Y OE 제외). 국가당 가장 강한 1종목만 집중 보유(최대 2종목).'],
        ['시그널 산출', 'CTA W7 (6개 주기 7/14/21/28/56/112일, 변위Z 65% + EMA괴리Z 35%, k=0.70, 가중치 3/5/7/20/30/35%) + 주기 동의도(0~6) + 10/20/50일 돈치안 채널 + 60일 일간 변동성 σ₆₀.'],
        ['진입 · 사이징', '10일 돌파 + |CTA| ≥ 0.35 + 4/6주기 이상 동의 시 1/3R 정찰 진입 (20일 돌파 동시 달성 시 2/3R). 보유 중 20일 돌파 또는 |CTA| ≥ 0.55 시 풀사이즈 1R 완성. 7σ₆₀ 역행 = −1R이 되도록 계약수 산출.'],
        ['손절 · 청산', '조기 익절 없음. ① 누적손실 −1R (7σ₆₀) 하드손절, ② 최고가 대비 8σ₆₀ 샹들리에 트레일링, ③ 50일 반대 채널 돌파, ④ 보유방향 × CTA < −0.20 중 먼저 도달 시 전량 청산.'],
      ])}

      ${card('엔진 ② US 커브 · 미-독 2Y 스프레드', pill(`비중 ${Math.round(st.weights[1] * 100)}%`, 'blue'), [
        ['유니버스', '장기 알파가 검증된 핵심 2개 변동성 중립 스프레드만 운용: ① 미국 2s10s (TY−TU, 26Y Shp +0.71), ② 미-독 2Y 정책금리 스프레드 (TU−DU, 26Y Shp +0.49). 알파가 미미했던 독일 2s10s·미-독 10Y는 제외.'],
        ['시그널 산출', '두 선물의 일간 가격변화를 전일 기준 60일 변동성(σ₆₀A, σ₆₀B)으로 각각 나눈 스프레드 지수 ΔS = ΔP_A/σ_A − ΔP_B/σ_B 를 누적한 뒤, 엔진 ①과 동일한 CTA W7 + 10/20/50일 채널 계산.'],
        ['진입 · 레그분해', '2개 스프레드 독립 진입. 10일 돌파 + |CTA| ≥ 0.25 + 3/6주기 이상 동의 시 10→20일 분할 진입(7σ_S = 1R). 주문 시 레그 A/B로 분해하여 엔진 ① 계약수와 순합(Netting).'],
        ['손절 · 청산', '합성 스프레드 지수 기준 ① −1R (7σ_S) 하드손절, ② 8σ_S 트레일링 스탑, ③ 50일 반대 채널 돌파, ④ CTA < −0.20 반전.'],
      ])}

      ${card('엔진 ③ FX4 금리차 보정 · 순캐리 평균회귀', pill(`비중 ${Math.round(st.weights[2] * 100)}%`, 'green'), [
        ['유니버스 · 시그널', '10통화 45페어. 최근 70영업일 2-요인 금리차 보정 회귀 y = a + b₁x + b₂(r₁−r₂) + ε 로 금리차 추세를 제거한 순수 단기 왜곡 잔차 2F-Z 산출.'],
        ['진입 6단계 관문', '① 2.4 ≤ |2F-Z| < 3.85 & |Δ|Z|| ≤ 1.0, ② 0.4 ≤ |b₁| ≤ 1.6 & |corr| ≥ 0.35, ③ 순캐리 ≥ +1.0%/yr, ④ 기대회귀폭 ≥ 왕복비용의 8배, ⑤ 손절 페어 20일 쿨다운 제외, ⑥ 최대 6페어 · 통화당 2페어 · |Net Beta| ≤ 2.0 · S4 Stress < 1.25.'],
        ['사이징 · S4 브레이크', '레그당 min($1.5M, $20k/sd) 1:1 달러 중립 × S4 배수. Stress = 0.5·(FX RV10/RV60) + 0.5·(MOVE/MA60) ≥ 1.25 시 신규 중단 및 0.35x 감속.'],
        ['익절 · 엄밀 손절', '① 익절(TP) |2F-Z| ≤ 0.2 당일 청산, ② 가격손실 ≤ −$20k(HC) 또는 |2F-Z| ≥ 4.0(SZ) 시 다음 영업일 종가 강제 손절 + 20일 쿨다운, ③ 20일 손실 시간컷(TF) + 20일 쿨다운, ④ 최대 45일(MH).'],
      ])}

      ${card('엔진 ④ FX 10→20일 추세돌파 모멘텀 (슬림 헤지)', pill(`비중 ${Math.round(st.weights[3] * 100)}%`, 'green'), [
        ['유니버스 · 역할', '10통화 대달러(EUR, GBP, AUD, NZD, CAD, JPY, CHF, BRL, MXN, KRW). 환율이 추세로 폭발해 엔진 ③(평균회귀)이 손절 맞을 때 정반대에서 방어하는 보조 자연 헤지 엔진(비중 10% 슬림 운용).'],
        ['시그널 · 진입', '각 통화 로그가격지수에 CTA W7 적용. 10일 돌파 + |CTA| ≥ 0.25 + 3/6주기 이상 동의 시 10→20일 분할 진입. 동시 최대 3통화, 순 달러 방향 |Net USD| ≤ 2 제한으로 FX 익스포저 과대 방지.'],
        ['사이징 · 캐리', '6σ₆₀ 역행 = −1R이 되도록 명목금액 min($2.0M, 예산 / 6σ₆₀) 산출. 보유 중 실제 양국 금리차 스왑 캐리 매일 반영.'],
        ['손절 · 청산', '① 누적손실 −1R (6σ₆₀) 하드손절, ② 최고 유리 가격 대비 7σ₆₀ 샹들리에 트레일링, ③ 50일 반대 채널 돌파, ④ CTA < −0.20 반전.'],
      ])}
    </div>

    <div style="margin-top:14px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:rgba(13,148,136,0.05);font-size:12.5px;line-height:1.65;">
      <b>공통 포트폴리오 결합 & 손절 감속 레이어 (추천: 세팅 B 소프트 하이브리드)</b><br>
      1) <b>2단계 인과적 변동성 타깃팅</b>: 4개 엔진을 각각 최근 60일 변동성으로 정규화한 뒤 <b>30% : 15% : 45% : 10%</b>로 결합하고, 포트폴리오 전체 60일 변동성을 목표 연 변동성(세팅 B <b>$1.5M/yr</b>, 세팅 C <b>$1.6M/yr</b>, 세팅 A <b>$1.2M/yr</b>)에 맞춥니다.<br>
      2) <b>세팅 B 소프트 하이브리드 감속</b>: ① 연간 손실(1월 1일 리셋, 한도 $95만) −$36만 → 0.65x, −$62만 → 0.35x, −$86만 → 당해 정지(0x), ② 다년 최고점 대비 −$80만 → 0.65x, −$120만 → 0.40x (완전 0x로 잠그지 않아 2025년 하반기 같은 대반등 회복 가능), ③ 정상 상태에서 올해 +$35만 이상 안전마진 확보 시 1.20x.<br>
      3) <b>엔진 간 순합(Netting)</b>: ①+②의 국채선물 계약수와 ③+④의 FX 통화별 명목을 매일 순합하여 차액만 거래소/은행간 시장에 집행합니다.
    </div>
  </div>`;
}

function renderAuditAndStressSection(data) {
  const cm = data.corr_matrix;
  const att = data.attribution;
  const hp = att.hedge_proof;

  return `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:16px;margin-bottom:16px;">
    <div class="panel">
      <div class="panel-head">
        <h3>4개 엔진 일간 상관계수 행렬 (26년 · 6,750일)</h3>
        <span class="muted" style="font-size:11.5px;">엔진 ③↔④ 음(-)의 상관 −0.129</span>
      </div>
      <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
        <thead>
          <tr>
            <th style="text-align:left;">엔진</th>
            ${cm.labels.map((l) => `<th style="text-align:right;">${esc(l)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${cm.labels.map((l, i) => `<tr>
            <td style="font-weight:700;">${esc(l)}</td>
            ${cm.c26[i].map((v, j) => {
              const style = i === j ? 'font-weight:700;opacity:0.55;' : v < 0 ? 'color:#0d9488;font-weight:700;' : '';
              return `<td style="text-align:right;${style}">${v > 0 ? '+' : ''}${fmtNum(v, 3)}</td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="margin-top:12px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);font-size:12px;line-height:1.6;">
        <b>위기 시 상호 헤지 실증 (26년 중 FX4 최악 20개월 평균 · 동일 $150k Vol 정규화 기준)</b><br>
        FX4가 월평균 <b class="red">${fmtUsd(hp.fx4_avg)}</b> 손실을 볼 때, 동기간 나머지 3개 엔진은 전부 플러스 방어:<br>
        ① 금리방향 <b class="green">${fmtUsd(hp.e1_avg)}/월</b> · ② 커브·박스 <b class="green">${fmtUsd(hp.e2_avg)}/월</b> · ④ FX추세돌파 <b class="green">${fmtUsd(hp.e4_avg)}/월</b>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>거래비용 1.5x/2.0x 스트레스 & 출구 평원(Plateau)</h3>
        <span class="muted" style="font-size:11.5px;">비용 2배 악화에도 26Y Shp 0.45~0.51 유지</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;">조건</th>
              <th style="text-align:right;">세팅 B (26Y / 11Y)</th>
              <th style="text-align:right;">세팅 C (26Y / 11Y)</th>
            </tr>
          </thead>
          <tbody>
            ${data.stress_table.map((r, idx) => `<tr ${idx === 0 ? 'style="font-weight:700;"' : ''}>
              <td>${esc(r.label)}</td>
              <td style="text-align:right;">${fmtK(r.b_26_ann)} (${r.b_26_shp}) / <b>${fmtK(r.b_11_ann)} (${r.b_11_shp})</b></td>
              <td style="text-align:right;">${fmtK(r.c_26_ann)} (${r.c_26_shp}) / <b>${fmtK(r.c_11_ann)} (${r.c_11_shp})</b></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:11.5px;" class="muted">
        <b>26년 누적 캐리 vs 비용(원시):</b> ③ FX4 캐리 <b class="green">${fmtUsd(att.e3_summary.carry_26y)}</b> vs 비용 <span class="red">−$${fmtNum(att.e3_summary.cost_26y)}</span> · ④ FX돌파 캐리 <b class="green">${fmtUsd(att.e4_summary.carry_26y)}</b> vs 비용 <span class="red">−$${fmtNum(att.e4_summary.cost_26y)}</span>
      </div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:16px;">
    <div class="panel">
      <div class="panel-head">
        <h3>엔진 ① 종목별 & 엔진 ② 스프레드별 해부</h3>
        <span class="muted" style="font-size:11.5px;">미국 2s10s (26Y Shp +0.71) 핵심 알파 확인</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;">엔진 ② 스프레드</th>
              <th style="text-align:right;">26Y PnL (Shp)</th>
              <th style="text-align:right;">11Y OOS / IS</th>
              <th style="text-align:right;">거래 · WR · PF</th>
            </tr>
          </thead>
          <tbody>
            ${att.e2_spreads.map((r) => `<tr>
              <td><b>${esc(r.sp)}</b></td>
              <td style="text-align:right;" class="${clsVal(r.pnl_26y)}">${fmtK(r.pnl_26y)} (${r.shp_26y > 0 ? '+' : ''}${fmtNum(r.shp_26y, 2)})</td>
              <td style="text-align:right;">${r.oos_shp > 0 ? '+' : ''}${fmtNum(r.oos_shp, 2)} / <span class="${clsVal(r.is_shp)}">${r.is_shp > 0 ? '+' : ''}${fmtNum(r.is_shp, 2)}</span></td>
              <td style="text-align:right;">${r.trades}건 · ${r.wr}% · ${r.pf}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="overflow-x:auto;margin-top:12px;">
        <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;">엔진 ① 국채선물 (11.1Y)</th>
              <th style="text-align:right;">원시 PnL</th>
              <th style="text-align:right;">거래 · 승률</th>
              <th style="text-align:right;">PF · 평균보유</th>
            </tr>
          </thead>
          <tbody>
            ${att.e1_instruments.map((r) => `<tr>
              <td><b>${esc(r.cid)}</b> <span class="muted" style="font-size:11px;">${esc(r.name)}</span></td>
              <td style="text-align:right;font-weight:700;" class="${clsVal(r.pnl_11y)}">${fmtUsd(r.pnl_11y)}</td>
              <td style="text-align:right;">${r.trades}건 · ${r.wr}%</td>
              <td style="text-align:right;">${r.pf} · ${r.avg_hd}일</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>엔진 ④ FX 추세돌파 통화별 성과 & 최근 청산</h3>
        <span class="muted" style="font-size:11.5px;">BRL · JPY · EUR · CAD 핵심 추세원</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="tbl" style="width:100%;font-variant-numeric:tabular-nums;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;">통화</th>
              <th style="text-align:right;">26Y 원시 PnL</th>
              <th style="text-align:right;">11Y 원시 PnL</th>
              <th style="text-align:right;">거래 · WR · PF</th>
            </tr>
          </thead>
          <tbody>
            ${att.e4_currencies.map((r) => `<tr>
              <td><b>${esc(r.ccy)}</b></td>
              <td style="text-align:right;font-weight:700;" class="${clsVal(r.pnl_26y)}">${fmtK(r.pnl_26y)}</td>
              <td style="text-align:right;" class="${clsVal(r.pnl_11y)}">${fmtK(r.pnl_11y)}</td>
              <td style="text-align:right;">${r.trades}건 · ${r.wr}% · ${r.pf}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function drawView(target, data) {
  const st = data.settings[selectedSetting] || data.settings.B;
  const s5 = st.summary_5y;
  const s11 = st.summary_11y;
  const s26 = st.summary_26y;
  const sc = st.live_scales;

  const stat = (l, v, h, c = '') =>
    `<div class="stat"><div class="label">${l}</div><div class="num ${c}">${v}</div><div class="help">${h}</div></div>`;

  target.innerHTML = `
  <div class="research-banner">
    <b>${esc(data.meta.model_name)}</b> · 기준일 <b>${esc(data.meta.as_of)}</b> · 국채 5종목(<b>TU/FV/TY + DU/RX</b>, 독일 5년 OE 제외) + FX 10통화 · 연 약 <b>${data.meta.trades_per_year}회</b> 액티브 매매
  </div>

  <div class="panel" style="margin-bottom:14px;padding:12px 14px;">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:700;">운용 세팅:</span>
        <div class="segmented">
          <button data-a4-setting="B" class="${selectedSetting === 'B' ? 'on' : ''}">세팅 B · 소프트 하이브리드 (추천)</button>
          <button data-a4-setting="C" class="${selectedSetting === 'C' ? 'on' : ''}">세팅 C · 연간 LoS 하드스탑</button>
          <button data-a4-setting="A" class="${selectedSetting === 'A' ? 'on' : ''}">세팅 A · 제어 OFF</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <div class="segmented">
          <button data-a4-sec="ALL" class="${sectionFilter === 'ALL' ? 'on' : ''}">전체 보기</button>
          <button data-a4-sec="LIVE" class="${sectionFilter === 'LIVE' ? 'on' : ''}">오늘 시그널 · 순합주문</button>
          <button data-a4-sec="PERF" class="${sectionFilter === 'PERF' ? 'on' : ''}">5년 월간 · 장기성과</button>
          <button data-a4-sec="RULES" class="${sectionFilter === 'RULES' ? 'on' : ''}">4엔진 매매 룰북</button>
          <button data-a4-sec="AUDIT" class="${sectionFilter === 'AUDIT' ? 'on' : ''}">해부 · 스트레스</button>
        </div>
        <a class="btn primary" href="./FITD_4Engine_Active_FICC_Guide.pdf" target="_blank" rel="noopener" style="text-decoration:none;">↓ 전략 가이드 PDF</a>
      </div>
    </div>
    <div class="muted" style="font-size:12px;margin-top:8px;">
      <b>${esc(st.label)}</b> — ${esc(st.desc)} · 목표 연 변동성 <b>$${fmtNum(st.target_vol / 1e6, 2)}M/yr</b> · 비중 ①${Math.round(st.weights[0]*100)} / ②${Math.round(st.weights[1]*100)} / ③${Math.round(st.weights[2]*100)} / ④${Math.round(st.weights[3]*100)}%
    </div>
  </div>

  <div class="stats" style="margin-bottom:16px;">
    ${stat('최근 5년 누적 (59개월)', fmtM(s5.tot), `월평균 ${fmtK(s5.avg_m)} · 월승률 ${s5.win_m_pct}% (${s5.pos_m}/${s5.tot_m}) · Shp ${s5.shp}`, 'green')}
    ${stat('11.1년 실선물 연평균', fmtK(s11.ann) + '/y', `Shp ${s11.shp} · MDD −${fmtM(s11.mdd, false)} · 최악년 ${s11.worst_y.year} (${fmtK(s11.worst_y.pnl)})`, 'blue')}
    ${stat('26년 최장기 연평균', fmtK(s26.ann) + '/y', `Shp ${s26.shp} · MDD −${fmtM(s26.mdd, false)} · 흑자 ${s26.pos_y}/${s26.tot_y}년`, 'orange')}
    ${stat('현재 감속 배수 · YTD', `${sc.dd_scale}x`, `올해 누적 ${fmtUsd(sc.ytd_pnl)} · 고점대비 −$${fmtNum(sc.peak_dd)} · 연 ${data.meta.trades_per_year}회`, sc.dd_scale >= 1.0 ? 'green' : 'red')}
  </div>

  ${sectionFilter === 'ALL' || sectionFilter === 'LIVE' ? renderLiveNettingAndEngines(data, st) : ''}
  ${sectionFilter === 'ALL' || sectionFilter === 'PERF' ? renderPerformanceSection(data, st) : ''}
  ${sectionFilter === 'ALL' || sectionFilter === 'RULES' ? renderRulebookSection(st) : ''}
  ${sectionFilter === 'ALL' || sectionFilter === 'AUDIT' ? renderAuditAndStressSection(data) : ''}
  `;

  target.querySelectorAll('[data-a4-setting]').forEach((b) => {
    b.onclick = () => {
      selectedSetting = b.dataset.a4Setting;
      drawView(target, data);
    };
  });
  target.querySelectorAll('[data-a4-sec]').forEach((b) => {
    b.onclick = () => {
      sectionFilter = b.dataset.a4Sec;
      drawView(target, data);
    };
  });
  target.querySelectorAll('[data-a4-period]').forEach((b) => {
    b.onclick = () => {
      perfPeriod = b.dataset.a4Period;
      drawView(target, data);
    };
  });
  const csvBtn = target.querySelector('#a4-csv-btn');
  if (csvBtn) {
    csvBtn.onclick = () => {
      const header = ['년월', '월간합계($)', '누적($)', '①금리방향($)', '②커브박스($)', '③FX평균회귀($)', '④FX추세돌파($)', '평균감속배수', '정지일수'];
      const rows = st.monthly_5y.map((r) => [r.ym, r.pnl, r.cum, r.e1, r.e2, r.e3, r.e4, r.dd_scale_avg, r.stop_days]);
      downloadCsv(`fitd_active_4e_setting_${selectedSetting}_5y_monthly.csv`, [header, ...rows]);
    };
  }
}

export async function renderMomentumActive4e(target) {
  target.innerHTML = '<div class="empty">4엔진 풀액티브(US/DE·FX) 데이터를 불러오는 중입니다...</div>';
  try {
    const data = await loadActive4eData();
    drawView(target, data);
  } catch (err) {
    target.innerHTML = `<div class="notice">${esc(err.message || String(err))}</div>`;
  }
}
