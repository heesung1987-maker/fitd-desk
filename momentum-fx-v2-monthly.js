import { getChartTheme } from './chart-utils.js?v=11';

let reportData = null;
let universeMode = 'COMBO45'; // 'COMBO45' | 'COMBO21'
let yearFilter = 'ALL'; // 'ALL' | '2022' | '2023' | '2024' | '2025' | '2026'
let monthFilter = 'ALL'; // 'ALL' | 'LOSS_ONLY' | 'DEFENDED' | 'TYPE_A' | 'TYPE_B' | 'TYPE_C'

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
    : Number(v).toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });

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

async function loadReportData() {
  if (reportData) return reportData;
  const res = await fetch('/data/fx-v2-monthly-report.json?v=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('FX v2.0 월간 분석 리포트 데이터를 불러오지 못했습니다.');
  }
  reportData = await res.json();
  return reportData;
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

function renderCumulativeEquitySvg(rows, uni) {
  const ct = getChartTheme();
  const legendColor = ct.ink || '#0f172a';
  if (!rows.length) return '<div class="empty">표시할 월간 시계열이 없습니다.</div>';

  const kBase = uni === 'COMBO45' ? 'cum45_base' : 'cum21_base';
  const kDef12 = uni === 'COMBO45' ? 'cum45_def12' : 'cum21_def12';
  const kDef123 = uni === 'COMBO45' ? 'cum45_def123' : 'cum21_def123';

  const base0 = rows[0][kBase] - rows[0][uni === 'COMBO45' ? 'combo45_base' : 'combo21_base'];
  const def12_0 = rows[0][kDef12] - rows[0][uni === 'COMBO45' ? 'combo45_def12' : 'combo21_def12'];
  const def123_0 = rows[0][kDef123] - rows[0][uni === 'COMBO45' ? 'combo45_def123' : 'combo21_def123'];

  const pts = rows.map((r) => ({
    ym: r.ym,
    v2: r.v2_score,
    base: r[kBase] - base0,
    def12: r[kDef12] - def12_0,
    def123: r[kDef123] - def123_0,
    mBase: r[uni === 'COMBO45' ? 'combo45_base' : 'combo21_base'],
    mDef12: r[uni === 'COMBO45' ? 'combo45_def12' : 'combo21_def12'],
  }));

  const allVals = pts.flatMap((p) => [0, p.base, p.def12, p.def123]);
  const lo = Math.min(0, ...allVals);
  const hi = Math.max(100000, ...allVals);
  const w = 1040,
    h = 285,
    padL = 78,
    padR = 28,
    padT = 38,
    padB = 34;

  const x = (i) => padL + (i * (w - padL - padR)) / Math.max(1, pts.length - 1);
  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const linePath = (key) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');

  const ticks = [lo, lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.75, hi];

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="59개월 누적 손익 비교 차트">
    <!-- Legend (High-Contrast Ink Color) -->
    <g transform="translate(${padL}, 18)" style="font-size:12px;font-weight:700;fill:${legendColor};">
      <line x1="0" y1="-4" x2="22" y2="-4" stroke="#0d9488" stroke-width="3"/>
      <text x="28" y="0" fill="${legendColor}">★ 비침습 방어 적용 (방어 ①+②: ${fmtUsd(pts.at(-1)?.def12)})</text>
      <line x1="335" y1="-4" x2="357" y2="-4" stroke="#2563eb" stroke-width="2.2" stroke-dasharray="5 3"/>
      <text x="363" y="0" fill="${legendColor}">방어 전 기본 v2.0 집중 (${fmtUsd(pts.at(-1)?.base)})</text>
      <line x1="640" y1="-4" x2="662" y2="-4" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="2 3"/>
      <text x="668" y="0" fill="${legendColor}">대조군: 인위적 월간 손절 추가 (${fmtUsd(pts.at(-1)?.def123)})</text>
    </g>

    ${ticks
      .map(
        (tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${ct.grid}" stroke-dasharray="3 3"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${legendColor}" font-size="11" font-weight="600">$${fmtNum(tv / 1000, 0)}k</text>
    `
      )
      .join('')}

    <line x1="${padL}" x2="${w - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="${ct.zero}" stroke-width="1.2"/>

    <path d="${linePath('def123')}" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="2 3"/>
    <path d="${linePath('base')}" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-dasharray="5 3"/>
    <path d="${linePath('def12')}" fill="none" stroke="#0d9488" stroke-width="3.0"/>

    ${pts
      .map(
        (p, i) => `
      <circle cx="${x(i).toFixed(1)}" cy="${y(p.def12).toFixed(1)}" r="4.5" fill="#0d9488" opacity="0.85">
        <title>[${p.ym}] v2.0 지수: ${p.v2}점
★ 방어 ①+② 누적: ${fmtUsd(p.def12)} (당월 ${fmtUsd(p.mDef12)})
• 방어 전 누적: ${fmtUsd(p.base)} (당월 ${fmtUsd(p.mBase)})
• 대조군(①+②+③) 누적: ${fmtUsd(p.def123)}</title>
      </circle>
    `
      )
      .join('')}

    ${pts
      .filter((p, i) => i === 0 || p.ym.endsWith('-01') || i === pts.length - 1)
      .map((p) => {
        const idx = pts.indexOf(p);
        return `<text x="${x(idx).toFixed(1)}" y="${h - 8}" text-anchor="${idx === pts.length - 1 ? 'end' : idx === 0 ? 'start' : 'middle'}" fill="${legendColor}" font-size="11" font-weight="600">${p.ym}</text>`;
      })
      .join('')}
  </svg>`;
}

function renderMonthlyBarChartSvg(rows, uni) {
  const ct = getChartTheme();
  const legendColor = ct.ink || '#0f172a';
  if (!rows.length) return '';

  const kBase = uni === 'COMBO45' ? 'combo45_base' : 'combo21_base';
  const kDef12 = uni === 'COMBO45' ? 'combo45_def12' : 'combo21_def12';

  const allVals = rows.flatMap((r) => [r[kBase], r[kDef12], 0]);
  const lo = Math.min(-100000, ...allVals);
  const hi = Math.max(150000, ...allVals);
  const w = 1040,
    h = 265,
    padL = 78,
    padR = 24,
    padT = 36,
    padB = 34;

  const y0 = padT + ((hi - 0) / Math.max(1, hi - lo)) * (h - padT - padB);
  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const slotW = (w - padL - padR) / Math.max(1, rows.length);
  const barW = Math.max(2.5, Math.min(8, slotW * 0.38));

  const ticks = [-100000, -50000, 0, 50000, 100000, 200000].filter((v) => v >= lo - 10000 && v <= hi + 10000);

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="월별 손익 비교 막대 차트">
    <!-- Legend (High-Contrast Ink Color) -->
    <g transform="translate(${padL}, 18)" style="font-size:12px;font-weight:700;fill:${legendColor};">
      <rect x="0" y="-11" width="12" height="10" fill="#94a3b8" rx="2"/>
      <text x="18" y="-2" fill="${legendColor}">방어 전 당월 손익 (v2.0 기본)</text>
      <rect x="235" y="-11" width="12" height="10" fill="#0d9488" rx="2"/>
      <text x="253" y="-2" fill="${legendColor}">★ 방어 ①+② 적용 후 당월 손익 (흑자)</text>
      <rect x="505" y="-11" width="12" height="10" fill="#e11d48" rx="2"/>
      <text x="523" y="-2" fill="${legendColor}">방어 ①+② 적용 후 당월 손익 (적자 · 대폭 축소)</text>
    </g>

    ${ticks
      .map(
        (tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${tv === 0 ? ct.zero : ct.grid}" stroke-width="${tv === 0 ? '1.3' : '1'}" stroke-dasharray="${tv === 0 ? 'none' : '3 3'}"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${legendColor}" font-size="11" font-weight="600">${tv === 0 ? '$0' : (tv > 0 ? '+$' : '−$') + fmtNum(Math.abs(tv) / 1000, 0) + 'k'}</text>
    `
      )
      .join('')}

    ${rows
      .map((r, i) => {
        const cx = padL + (i + 0.5) * slotW;
        const vb = r[kBase];
        const vd = r[kDef12];
        const ybTop = Math.min(y0, y(vb));
        const ybH = Math.max(1.5, Math.abs(y(vb) - y0));
        const ydTop = Math.min(y0, y(vd));
        const ydH = Math.max(1.5, Math.abs(y(vd) - y0));
        const colD = vd >= 0 ? '#0d9488' : '#e11d48';
        return `<g>
          <rect x="${(cx - barW - 0.5).toFixed(1)}" y="${ybTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${ybH.toFixed(1)}" fill="#94a3b8" opacity="0.65" rx="1"/>
          <rect x="${(cx + 0.5).toFixed(1)}" y="${ydTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${ydH.toFixed(1)}" fill="${colD}" rx="1"/>
          <rect x="${(cx - slotW / 2).toFixed(1)}" y="${padT}" width="${slotW.toFixed(1)}" height="${h - padT - padB}" fill="transparent">
            <title>[${r.ym}] v2.0=${r.v2_score}점 (P1:${r.p1_eff} / P2:${r.p2_rv} / P3:${r.p3_coh})
• 방어 전 당월 손익: ${fmtUsd(vb)}
★ 방어 ①+② 당월 손익: ${fmtUsd(vd)} (개선폭: ${fmtUsd(vd - vb)})
${r.cause_title ? '• 손실 원인: ' + r.cause_title : ''}</title>
          </rect>
        </g>`;
      })
      .join('')}

    ${rows
      .filter((r, i) => i === 0 || r.ym.endsWith('-01') || i === rows.length - 1)
      .map((r) => {
        const idx = rows.indexOf(r);
        const cx = padL + (idx + 0.5) * slotW;
        return `<text x="${cx.toFixed(1)}" y="${h - 8}" text-anchor="middle" fill="${legendColor}" font-size="11" font-weight="600">${r.ym}</text>`;
      })
      .join('')}
  </svg>`;
}

export async function renderMomentumFxV2Monthly(target) {
  target.innerHTML = `<div class="panel"><p class="muted">FX 스트레스 지수 v2.0 기술적 배경 및 59개월 월간 손익·방어 분석 데이터를 불러오는 중입니다...</p></div>`;

  let data;
  try {
    data = await loadReportData();
  } catch (e) {
    target.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`;
    return;
  }

  const allMonths = data.monthly_rows || [];
  const filteredChartMonths = allMonths.filter((m) => yearFilter === 'ALL' || m.year === yearFilter);

  const filteredTableMonths = allMonths.filter((m) => {
    if (yearFilter !== 'ALL' && m.year !== yearFilter) return false;
    const baseVal = universeMode === 'COMBO45' ? m.combo45_base : m.combo21_base;
    const diffVal = universeMode === 'COMBO45' ? m.combo45_diff : m.combo21_diff;
    if (monthFilter === 'LOSS_ONLY') return baseVal < 0;
    if (monthFilter === 'DEFENDED') return baseVal < 0 && diffVal > 2000;
    if (monthFilter === 'TYPE_A') return m.cause_code === 'TYPE_A';
    if (monthFilter === 'TYPE_B') return m.cause_code === 'TYPE_B';
    if (monthFilter === 'TYPE_C') return m.cause_code === 'TYPE_C';
    return true;
  });

  const abBase = data.ablation_summary[universeMode + '_BASE'];
  const abDef12 = data.ablation_summary[universeMode + '_DEF12'];
  const abDef123 = data.ablation_summary[universeMode + '_DEF123'];

  const snap = data.latest_snapshot || {};
  const v1Snap = snap.v1 || {};
  const v2Snap = snap.v2 || {};

  target.innerHTML = `
    <div class="research-banner" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div>
        <strong>FX 스트레스 지수 v2.0 개편의 기술적 배경 & 59개월(2022.01~2026.11) 월간 손익·비침습 방어 분석</strong>
        <div style="font-size:12px;opacity:0.88;margin-top:2px;">
          구버전(v1.0)의 구조적 왜곡(BETA_BLOCK 상시 오염 · 일간 휩쏘 착시) 해결 원리, 신버전(v2.0) 3대 축 수식 명세, 그리고 59개월 손실 월(23개월)의 3대 매크로·기술적 원인과 비침습 방어 기제(방어 ①+②) 검증 리포트입니다.
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="button" class="btn" id="fxv2-export-csv">↓ 59개월 월간 손익·방어 CSV</button>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- SECTION 1: FX STRESS INDEX v2.0 TECHNICAL BACKGROUND                  -->
    <!-- ===================================================================== -->
    <div class="panel" style="margin-top:14px;">
      <div class="panel-head">
        <div>
          <div class="eyebrow">SECTION 1 · TECHNICAL ARCHITECTURE OF FX STRESS INDEX v2.0</div>
          <h2>1. 왜 FX 스트레스 지수 v2.0을 새로 설계했는가? — 기술적 배경과 3대 축(3-Pillar) 수식 명세</h2>
        </div>
        <span class="tag primary">인과적(Causal) 5개년 백테스트 검증 완료</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:10px;">
        <!-- Old v1.0 Limitations -->
        <div style="border:1px solid var(--line,#cbd5e1);border-radius:10px;padding:14px;background:var(--surface-2,rgba(248,250,252,0.7));">
          <div style="font-size:12px;font-weight:700;color:#e11d48;letter-spacing:0.03em;">구버전(v1.0) 산식의 3가지 구조적 한계</div>
          <h3 style="margin:6px 0 8px;font-size:15px;">왜 기존 1~3번 조건은 '추세 형성 vs 박스권 등락'을 구분하지 못했나?</h3>
          <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.65;">
            <li>
              <strong>제2조건(꼬리이탈 40점)의 <code>BETA_BLOCK</code> 상시 오염 왜곡</strong>:
              구버전은 순수 잔차 이탈(<code>|Z| ≥ 2.7</code>)뿐 아니라 70일 회귀 헤지비율이 <code>β ∉ [0.15, 2.50]</code>인 <code>BETA_BLOCK</code> 페어까지 모두 꼬리이탈에 합산했습니다. 통화 간 금리차 변화로 β가 완만히 이동한 평온한 박스권(2023~2025년)에서도 <code>BETA_BLOCK</code> 페어가 상시 45~65% 존재하여, <strong>2축 점수가 1년 내내 40점 만점에 고정되는 '상시 고스트레스 착시'</strong>가 발생했습니다.
            </li>
            <li style="margin-top:6px;">
              <strong>제1조건(일간 <code>|ΔZ|</code> 40점) 및 제3조건(평균 <code>|Z|</code> 20점)의 방향성 판별 불가</strong>:
              하루짜리 <code>|Z_t - Z_{t-1}|</code>은 일방향 대추세(Trend)가 아니라 <strong>박스권 내 단기 휩쏘(Whipsaw)</strong>에서도 똑같이 급등하며, 평균 <code>|Z|</code>는 스프레드가 벌어진 채 횡보할 때도 높게 유지됩니다.
            </li>
            <li style="margin-top:6px;">
              <strong>금리 모멘텀 타겟 자산(US·DE 국채선물)의 추세 정보 부재</strong>:
              FX 교차페어 잔차만 측정하고 정작 모멘텀 전략이 매매하는 미국·독일 국채선물의 경로 효율성(Path Efficiency)과 커브 동조성을 반영하지 못했습니다.
            </li>
          </ol>
        </div>

        <!-- New v2.0 3-Pillar Architecture -->
        <div style="border:1px solid #0d9488;border-radius:10px;padding:14px;background:rgba(13,148,136,0.04);">
          <div style="font-size:12px;font-weight:700;color:#0d9488;letter-spacing:0.03em;">신버전(v2.0) 3대 축(3-Pillar) 아키텍처 (100점 만점 · 3일 EMA 평활화)</div>
          <h3 style="margin:6px 0 8px;font-size:15px;">'일방향 추세 지속성'과 '평균회귀 정상 작동'을 직관적·수학적으로 분리</h3>
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.65;">
            <li>
              <strong>제1축 (40점 만점) — 글로벌 추세 경로 효율성(ER20) & 분산비(VR10)</strong>:
              <ul>
                <li><strong>Kaufman 20일 효율성 비율 (25점)</strong>: <code>ER20 = |P_t - P_{t-20}| / Σ|P_{t-k} - P_{t-k-1}|</code>. 왕복 소모 없이 일직선 추세로 진행할수록 1.0에 수렴, 박스권 왕복 등락 시 0에 수렴 (미·독 국채선물 55% + 통화선물 45% 결합).</li>
                <li><strong>Lo-MacKinlay 10일 분산비 (15점)</strong>: <code>VR10 = Var(Δ10 P) / (10 × Var(Δ1 P))</code>. <code>VR10 &gt; 1.0</code>이면 양(+)의 자기상관(추세 발산), <code>VR10 &lt; 1.0</code>이면 평균회귀 박스권임을 판별.</li>
              </ul>
            </li>
            <li style="margin-top:6px;">
              <strong>제2축 (30점 만점) — 순수 FX 공적분 붕괴 & 평균회귀 반감기 신장</strong>:
              <ul>
                <li><strong>순수 꼬리이탈 비율 (12점)</strong>: <code>BETA_BLOCK</code> 오염을 분자·분모에서 완전 제거하고 순수 <code>|Z_OOS| ≥ 2.5</code> 이탈 비율만 측정.</li>
                <li><strong>OU 평균회귀 반감기 75분위수 (10점) & 유효 5일 Z-드리프트 (8점)</strong>: 잔차 자기회귀 반감기 <code>HL = -ln(2)/ln(ρ1)</code>가 길어지고 5일 누적 <code>|Z_t - Z_{t-5}|</code>가 커질수록 평균회귀 실패(추세 전환)로 판정.</li>
              </ul>
            </li>
            <li style="margin-top:6px;">
              <strong>제3축 (30점 만점) — 크로스자산 매크로 방향 응집도 (Coherence)</strong>:
              <ul>
                <li><strong>7대 통화선물 USD 단일 방향 응집도 (18점)</strong> + <strong>미·독 국채 커브 전 만기 동조율 (12점)</strong>: 개별 페어 노이즈가 아니라 글로벌 달러·금리 팩터가 전 만기·전 통화를 한 방향으로 밀어붙이는지 측정.</li>
              </ul>
            </li>
          </ul>
        </div>
      </div>

      <!-- Regime Comparison Table: v1.0 vs v2.0 across 2022~2026 -->
      <div style="margin-top:16px;">
        <h3 style="font-size:14px;margin:0 0 8px;">구버전(v1.0) vs 신버전(v2.0) 5개년(2022~2026) 레짐 판별 분별력 비교</h3>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>연도 (거래일)</th>
                <th>실제 매크로 장세 성격</th>
                <th class="number">구버전(v1.0) 연평균</th>
                <th class="number">구버전 L1 / L2 / L3 비중</th>
                <th class="number">신버전(v2.0) 연평균</th>
                <th class="number">신버전 L1(박스) / L2(전환) / L3(추세) 비중</th>
                <th>분별력 개선 핵심 효과</th>
              </tr>
            </thead>
            <tbody>
              ${(data.annual_summary || [])
                .map((a) => {
                  const macroDesc =
                    a.year === '2022'
                      ? '연준 공격적 금리인상 · 킹달러 대추세장'
                      : a.year === '2023'
                      ? 'SVB 사태 이후 금리·환율 박스권 평균회귀장'
                      : a.year === '2024'
                      ? '금리 동결·완만한 인하 기대 박스권 장세'
                      : a.year === '2025'
                      ? '4월 관세 쇼크 외 연중 극저변동성 횡보장'
                      : '상반기 혼조 후 9월 글로벌 금리 대추세 폭발';
                  const effectDesc =
                    a.year === '2022'
                      ? '대추세 구간(L3 45.8%) 정확 포착 + 휴지기(L1 27.3%) 구분'
                      : a.year === '2023'
                      ? '구버전이 놓친 박스권 안정기(L1)를 10.8% → 55.4%로 복원 (FX 수익 극대화)'
                      : a.year === '2024'
                      ? '박스권(L1 44.7%)과 4월·8월 추세 구간(L3 23.3%)을 선명히 분리'
                      : a.year === '2025'
                      ? '극저변동성 박스권(L1 70.9%) 정확 판별로 모멘텀 헛손질 방어'
                      : '최근일(' + (snap.date || '2026-11-16') + ') 구버전 63.9점 오염 → 신버전 57.5점 정밀 교정';
                  return `<tr>
                    <td><strong>${a.year}년</strong> (${a.trading_days}일)</td>
                    <td>${macroDesc}</td>
                    <td class="number muted">${fmtNum(a.v1_mean, 1)}점</td>
                    <td class="number muted">L1: ${a.v1_l1_pct}% / L2: ${a.v1_l2_pct}% / L3: ${a.v1_l3_pct}%</td>
                    <td class="number"><strong>${fmtNum(a.v2_mean, 1)}점</strong></td>
                    <td class="number"><span class="green">L1: ${a.v2_l1_pct}%</span> / L2: ${a.v2_l2_pct}% / <span class="orange">L3: ${a.v2_l3_pct}%</span></td>
                    <td style="font-size:12px;">${effectDesc}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="rule-note" style="margin-top:8px;">
          <strong>단일 만기 DV01 집중(Single Best-Tenor DV01 Concentration) 결합 원리</strong>:
          미국(<code>TU·FV·TY</code>)이나 독일(<code>DU·OE·RX</code>)에서 여러 만기가 동시에 신호를 낼 때 만기별로 어중간하게 분산(Uncap)하면 신호가 약한 만기가 수익률을 희석합니다. 대신 <strong>복수 만기 동조를 '추세 신뢰도 확증 신호'로만 사용하고, 실제 계약과 DV01은 신호 대 잡음비(SNR)가 가장 강한 1종목에 집중(<code>1.48x ~ 1.90x</code>)</strong>할 때 누적 수익과 Sharpe·Calmar가 모두 우월함을 확인했습니다.
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- SECTION 2: 59-MONTH PNL SIMULATION & ABLATION STUDY                   -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head" style="flex-wrap:wrap;gap:10px;">
        <div>
          <div class="eyebrow">SECTION 2 · 59-MONTH PNL TRAJECTORY & DEFENSE ABLATION STUDY</div>
          <h2>2. 2022년~2026년(59개월) 월간 손익 추이 및 비침습 손실 방어(방어 ①+②) 검증</h2>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <div class="segmented" role="group" aria-label="FX 유니버스 선택">
            <button type="button" data-fxv2-uni="COMBO45" class="${universeMode === 'COMBO45' ? 'on' : ''}">45개 FX 페어 + 금리 모멘텀</button>
            <button type="button" data-fxv2-uni="COMBO21" class="${universeMode === 'COMBO21' ? 'on' : ''}">G10 21개 페어 + 금리 모멘텀</button>
          </div>
          <div class="segmented" role="group" aria-label="조회 연도 선택">
            ${['ALL', '2022', '2023', '2024', '2025', '2026']
              .map(
                (y) =>
                  `<button type="button" data-fxv2-yr="${y}" class="${yearFilter === y ? 'on' : ''}">${y === 'ALL' ? '전체 (59개월)' : y + '년'}</button>`
              )
              .join('')}
          </div>
        </div>
      </div>

      <!-- KPI Stat Cards Comparing Before vs After Defense ①+② -->
      <div class="stats" style="margin-top:10px;">
        <div class="stat">
          <div class="label">5개년 누적 순수익 (방어 전 → 방어 ①+②)</div>
          <div class="num green">${fmtUsd(abDef12.total_net)}</div>
          <div class="help">방어 전 ${fmtUsd(abBase.total_net)} 대비 <strong>${fmtUsd(abDef12.total_net - abBase.total_net)}</strong> 상승 (추세 수익력 100% 보존)</div>
        </div>
        <div class="stat">
          <div class="label">최대 낙폭 MDD (방어 전 → 방어 ①+②)</div>
          <div class="num green">${fmtUsd(-abDef12.mdd)}</div>
          <div class="help">방어 전 ${fmtUsd(-abBase.mdd)} 대비 낙폭 <strong>$${fmtNum(abBase.mdd - abDef12.mdd, 0)} 축소</strong></div>
        </div>
        <div class="stat">
          <div class="label">Sharpe / Calmar 비율</div>
          <div class="num orange">${fmtNum(abDef12.sharpe, 2)} / ${fmtNum(abDef12.calmar, 2)}x</div>
          <div class="help">방어 전 Sharpe ${fmtNum(abBase.sharpe, 2)} · Calmar ${fmtNum(abBase.calmar, 2)}x 대비 대폭 개선</div>
        </div>
        <div class="stat">
          <div class="label">월간 흑자 승률 (59개월 기준)</div>
          <div class="num green">${abDef12.win_months} / ${abDef12.total_months}개월 (${fmtNum(abDef12.win_rate_pct, 1)}%)</div>
          <div class="help">방어 전 ${abBase.win_months}/59개월(${fmtNum(abBase.win_rate_pct, 1)}%) · <strong>-$20k 이하 손실 월: ${abBase.severe_loss_months_20k}개월 → 단 ${abDef12.severe_loss_months_20k}개월</strong></div>
        </div>
      </div>

      <!-- Cumulative Equity Curve SVG -->
      <div style="margin-top:14px;border:1px solid var(--line,#cbd5e1);border-radius:10px;padding:12px;background:var(--surface,#fff);">
        <div style="font-size:13px;font-weight:700;margin-bottom:6px;">59개월 누적 손익 추이 비교 (방어 전 기본 vs ★ 비침습 방어 ①+② vs 인위적 월간 손절 ③ 대조군)</div>
        ${renderCumulativeEquitySvg(filteredChartMonths, universeMode)}
      </div>

      <!-- Monthly Bar Chart SVG -->
      <div style="margin-top:14px;border:1px solid var(--line,#cbd5e1);border-radius:10px;padding:12px;background:var(--surface,#fff);">
        <div style="font-size:13px;font-weight:700;margin-bottom:6px;">월별 손익(Monthly PnL) 방어 전 vs ★ 방어 ①+② 직접 비교 (막대에 마우스를 올리면 월별 상세 원인이 표시됩니다)</div>
        ${renderMonthlyBarChartSvg(filteredChartMonths, universeMode)}
      </div>

      <!-- Ablation Table & Annual Breakdown -->
      <div style="margin-top:16px;">
        <h3 style="font-size:14px;margin:0 0 8px;">방어 기제 단계별 적용 비교 (Ablation Study: 2022.01 ~ 2026.11, 59개월)</h3>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>모델 및 방어 기제 구성</th>
                <th class="number">5년 누적 순수익</th>
                <th class="number">최대 낙폭(MDD)</th>
                <th class="number">Sharpe</th>
                <th class="number">Calmar</th>
                <th class="number">월간 흑자 달수 (승률)</th>
                <th class="number">-$20k 이하 손실 월</th>
                <th class="number">최악의 달 (Worst Month)</th>
              </tr>
            </thead>
            <tbody>
              ${[abBase, abDef12, abDef123]
                .map((ab, idx) => {
                  const isBest = idx === 1;
                  return `<tr style="${isBest ? 'background:rgba(13,148,136,0.08);font-weight:700;' : ''}">
                    <td>${esc(ab.label)}</td>
                    <td class="number ${clsPnl(ab.total_net)}">${fmtUsd(ab.total_net)}</td>
                    <td class="number red">${fmtUsd(-ab.mdd)}</td>
                    <td class="number">${fmtNum(ab.sharpe, 2)}</td>
                    <td class="number">${fmtNum(ab.calmar, 2)}x</td>
                    <td class="number ${isBest ? 'green' : ''}">${ab.win_months} / ${ab.total_months}개월 (${fmtNum(ab.win_rate_pct, 1)}%)</td>
                    <td class="number ${ab.severe_loss_months_20k <= 3 ? 'green' : 'red'}">${ab.severe_loss_months_20k}개월</td>
                    <td class="number red">${ab.worst_month_ym} (${fmtUsd(ab.worst_month_pnl)})</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Annual Win Rate & Net PnL Comparison -->
      <div style="margin-top:16px;">
        <h3 style="font-size:14px;margin:0 0 8px;">연도별 월간 승률 및 순수익 변화 (방어 전 vs ★ 비침습 방어 ①+②)</h3>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>연도</th>
                <th class="number">방어 전 월간 흑자 달수</th>
                <th class="number">★ 방어 ①+② 월간 흑자 달수</th>
                <th class="number">FX 차익거래 (방어 전 → 후)</th>
                <th class="number">금리 모멘텀 (방어 전 → 후)</th>
                <th class="number">통합 순수익 (방어 전)</th>
                <th class="number">★ 통합 순수익 (방어 ①+②)</th>
                <th class="number">연간 손익 개선폭</th>
              </tr>
            </thead>
            <tbody>
              ${(data.annual_summary || [])
                .map((a) => {
                  const wBase = universeMode === 'COMBO45' ? a.win_months_45_base : a.win_months_21_base;
                  const wDef = universeMode === 'COMBO45' ? a.win_months_45_def12 : a.win_months_21_def12;
                  const fxB = universeMode === 'COMBO45' ? a.fx45_base : a.combo21_base - a.mom_base;
                  const fxD = universeMode === 'COMBO45' ? a.fx45_def : a.combo21_def12 - a.mom_def;
                  const cB = universeMode === 'COMBO45' ? a.combo45_base : a.combo21_base;
                  const cD = universeMode === 'COMBO45' ? a.combo45_def12 : a.combo21_def12;
                  const diff = cD - cB;
                  return `<tr>
                    <td><strong>${a.year}년</strong> (${a.months_count}개월)</td>
                    <td class="number">${wBase} / ${a.months_count}개월 (${fmtNum((wBase / a.months_count) * 100, 1)}%)</td>
                    <td class="number green"><strong>${wDef} / ${a.months_count}개월 (${fmtNum((wDef / a.months_count) * 100, 1)}%)</strong></td>
                    <td class="number">${fmtUsd(fxB)} → <strong>${fmtUsd(fxD)}</strong></td>
                    <td class="number">${fmtUsd(a.mom_base)} → <strong>${fmtUsd(a.mom_def)}</strong></td>
                    <td class="number ${clsPnl(cB)}">${fmtUsd(cB)}</td>
                    <td class="number ${clsPnl(cD)}"><strong>${fmtUsd(cD)}</strong></td>
                    <td class="number ${clsPnl(diff)}">${fmtUsd(diff)}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- SECTION 3: 3 ROOT CAUSES OF LOSING MONTHS & NON-INTRUSIVE DEFENSES    -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head">
        <div>
          <div class="eyebrow">SECTION 3 · LOSING-MONTH ANATOMY & NON-INTRUSIVE DEFENSE OVERLAYS</div>
          <h2>3. 손실 발생 월(23개월)의 매크로·기술적 3대 원인 해부 및 비침습 방어 전략 설계</h2>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:14px;margin-top:10px;">
        <!-- Type A -->
        <div style="border:1px solid var(--line,#cbd5e1);border-radius:10px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="tag block">원인 유형 A · FX 차익거래 손실 주도</span>
            <span style="font-size:12px;font-weight:700;color:#0d9488;">방어 ②로 정밀 차단</span>
          </div>
          <h3 style="font-size:15px;margin:8px 0 6px;">글로벌 지수 저점기의 '단일 통화(엔화·신흥국) 국소 발산 쇼크'</h3>
          <p style="font-size:13px;line-height:1.6;margin:0 0 8px;">
            <strong>발생 메커니즘</strong>: 미·독 국채 금리와 대다수 통화가 조용하면 글로벌 평균인 <code>v2.0</code> 지수는 <code>25~45점</code>(안정~중립)에 머뭅니다. 이때 FX 차익거래가 <code>1.00x~1.10x</code> 풀사이즈로 진입했는데, 실제로는 <strong>BOJ 정책 이벤트(엔화 단독 발작)나 캐리 청산으로 특정 통화 노드만 공적분 궤도를 이탈(<code>P2 ≥ 11.5점</code> 또는 <code>Pure Tail ≥ 22%</code>)</strong>하며 연쇄 손절이 발생했습니다.
          </p>
          <div style="font-size:12px;background:var(--surface-2,rgba(241,245,249,0.8));padding:10px;border-radius:8px;line-height:1.6;">
            <strong>[방어 ②] FX 국소 통화 쇼크 캡 & 역방향 확산 조기 감쇠</strong><br>
            1) 글로벌 총점이 낮아도 <code>P2 ≥ 11.5점</code>, <code>Pure Tail ≥ 22%</code>, 또는 5일 지수 급등(<code>Δ5 Iv2 ≥ +6.5점</code>) 시 국소 통화 쇼크로 판정하여 신규 진입 배율을 <code>0.45x</code>로 캡핑합니다.<br>
            2) 보유 중인 FX 페어가 평가손실(<code>-$5,000</code> 이하) 상태에서 <code>|Z_OOS|</code>가 진입 시점보다 <code>+0.25σ</code> 이상 더 바깥으로 벌어지면 하드캡(<code>-$20k</code>) 도달 전 노출을 <code>0.35x</code>로 조기 감쇠합니다.<br>
            <strong style="color:#0d9488;">→ 개선 실적: 23-04(-$91.8k→-$48.9k), 26-01(-$58.1k→-$14.8k), 26-02(-$26.2k→-$1.4k), 22-11(-$20.6k→+$4.2k 흑자전환)</strong>
          </div>
        </div>

        <!-- Type B -->
        <div style="border:1px solid var(--line,#cbd5e1);border-radius:10px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="tag primary">원인 유형 B · 금리 모멘텀 휩쏘 주도</span>
            <span style="font-size:12px;font-weight:700;color:#0d9488;">방어 ①-A로 정밀 차단</span>
          </div>
          <h3 style="font-size:15px;margin:8px 0 6px;">대추세 정점 피로(Exhaustion) 및 매크로 변곡점 급반전</h3>
          <p style="font-size:13px;line-height:1.6;margin:0 0 8px;">
            <strong>발생 메커니즘</strong>: 대추세 폭등(예: <code>2026-09 +$278.7k</code>) 직후 다음 달(<code>2026-10</code>)이나 <code>2023-03 SVB 파산 사태</code>처럼 급격한 되돌림이 올 때, 20일 윈도우 특성상 <strong>지수 절대 레벨(Level)은 여전히 45~59점으로 높지만 지수 기울기(<code>Δ5 Iv2 &lt; -2.5</code>)와 효율성 기울기(<code>Δ5 ER20 &lt; -0.03</code>)는 이미 급락</strong>하고 있습니다. 이때 <code>1.48x~1.90x</code> 집중 배율을 그대로 유지하다가 수익을 반납했습니다.
          </p>
          <div style="font-size:12px;background:var(--surface-2,rgba(241,245,249,0.8));padding:10px;border-radius:8px;line-height:1.6;">
            <strong>[방어 ①-A] 모멘텀 추세 피로 디레버리징 (Slope De-escalation)</strong><br>
            1) 지수 가속 상승 구간(<code>Δ5 Iv2 ≥ -2.5</code> &amp; <code>Δ5 ER20 ≥ -0.03</code>)에서는 기존 <code>1.48x~1.90x</code> 최강 1종목 DV01 집중을 100% 그대로 가동합니다.<br>
            2) 반면 지수나 추세 효율성이 5일 전 대비 꺾이는 <strong>추세 피로 구간에서는 즉시 집중 레버리지를 해제하고 스나이퍼 방어 모드(6개 중 4개 타임프레임 동의 + <code>+0.28R</code> 조기 반익절 잠금)</strong>로 전환합니다.<br>
            <strong style="color:#0d9488;">→ 개선 실적: 23-03 SVB 사태(-$28.6k→+$33.8k 흑자전환), 26-10(-$36.6k→-$0.4k 완벽 본전 방어)</strong>
          </div>
        </div>

        <!-- Type C -->
        <div style="border:1px solid var(--line,#cbd5e1);border-radius:10px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="tag shadow">원인 유형 C · 양쪽 슬리브 동시 누수</span>
            <span style="font-size:12px;font-weight:700;color:#0d9488;">방어 ①-B &amp; ②-B로 차단</span>
          </div>
          <h3 style="font-size:15px;margin:8px 0 6px;">극저변동성 데드존(<code>v2.0 &lt; 26점</code> &amp; <code>ER20 &lt; 0.20</code>) 분모 수축 착시</h3>
          <p style="font-size:13px;line-height:1.6;margin:0 0 8px;">
            <strong>발생 메커니즘</strong>: 2025년 여름(<code>6~8월</code>, 지수 <code>7.5~23.5점</code>)이나 <code>2024-03/05</code>처럼 시장이 극단적 수면 장세에 빠지면, <strong>20일 가격 채널과 70일 잔차 표준편차(σ) 분모가 바닥까지 수축</strong>합니다. 그 결과 금리가 3~4bp만 움직여도 가짜 채널 돌파가 켜지고, 미세한 환율 노이즈에도 <code>|Z| ≥ 2.7</code>이 찍혀 양쪽 슬리브가 동시에 잔손실을 입었습니다.
          </p>
          <div style="font-size:12px;background:var(--surface-2,rgba(241,245,249,0.8));padding:10px;border-radius:8px;line-height:1.6;">
            <strong>[방어 ①-B &amp; ②-B] 극저변동성 데드존 스나이퍼 필터 &amp; 스케일 감산</strong><br>
            1) <code>Iv2 &lt; 26점</code> 또는 <code>ER20 &lt; 0.20</code>인 데드존에서는 모멘텀을 6개 지평 중 최소 4개 이상이 일치할 때만 진입하는 스나이퍼 모드(<code>0.70x</code>)로 제한합니다.<br>
            2) FX 차익거래 역시 <code>Iv2 &lt; 24점</code> 극저변동성 구간에서는 분모 수축 착시를 감안해 진입 배율을 <code>0.55x</code>로 낮춥니다.<br>
            <strong style="color:#0d9488;">→ 개선 실적: 24-05(-$47.7k→-$6.4k), 25-06(-$29.5k→-$3.3k), 25-08(-$12.8k→-$2.6k), 23-11(-$0.9k→+$11.8k)</strong>
          </div>
        </div>
      </div>

      <div class="rule-note" style="margin-top:12px;">
        <strong>왜 인위적인 달력 기준 월간 손절 가드(방어 ③: 월간 누적 손익 <code>MTD ≤ -$12,000</code> 도달 시 그 달 남은 기간 배율 <code>0.30x</code> 축소)는 채택하지 않는가?</strong><br>
        백테스트 검증 결과(위 표 3번 대조군), 월초(1~2주 차)에 일시적으로 <code>-$12k</code> 눌렸다가 월중·월말에 강한 추세가 터지며 <code>+$60k ~ +$80k</code> 대수익으로 뒤집는 달들까지 월초 손절 가드가 레버리지를 강제로 묶어버려 <strong>5년간 <code>-$413,615</code>의 막대한 기회비용</strong>이 발생하고 월간 승률도 오히려 <code>72.9% → 66.1%</code>로 하락했습니다. 따라서 인위적 달력 손절(방어 ③)은 배제하고, 매크로·기술적 원인에 직결된 <strong>시그널 기반 비침습 방어(방어 ① + ②)만 적용하는 것이 총수익(<code>+$1.75M</code>)과 월간 승률(<code>72.9%</code>) 양면에서 최적</strong>입니다.
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- SECTION 4: FULL 59-MONTH MATRIX & ROOT-CAUSE TABLE                    -->
    <!-- ===================================================================== -->
    <div class="panel below">
      <div class="panel-head" style="flex-wrap:wrap;gap:10px;">
        <div>
          <div class="eyebrow">SECTION 4 · FULL 59-MONTH PNL & DEFENSE MATRIX (2022-01 ~ 2026-11)</div>
          <h2>4. 59개월 전체 월간 손익 및 방어 작동 내역 상세 매트릭스 (${filteredTableMonths.length}개 월 표시 중)</h2>
        </div>
        <div class="segmented" role="group" aria-label="월 상태 필터">
          ${[
            ['ALL', '전체 59개월'],
            ['LOSS_ONLY', '방어 전 손실 월 (23개월)'],
            ['DEFENDED', '핵심 방어 성공 월'],
            ['TYPE_A', '유형 A (국소 통화 쇼크)'],
            ['TYPE_B', '유형 B (추세 피로·변곡점)'],
            ['TYPE_C', '유형 C (저변동성 데드존)'],
          ]
            .map(
              ([code, lbl]) =>
                `<button type="button" data-fxv2-mfilter="${code}" class="${monthFilter === code ? 'on' : ''}">${lbl}</button>`
            )
            .join('')}
        </div>
      </div>

      <div class="table-scroll" style="max-height:680px;overflow-y:auto;">
        <table>
          <thead style="position:sticky;top:0;z-index:2;background:var(--surface,#fff);">
            <tr>
              <th>년-월</th>
              <th class="number">v2.0 지수 (P1/P2/P3)</th>
              <th class="number">FX (방어 전 → 후)</th>
              <th class="number">모멘텀 (방어 전 → 후)</th>
              <th class="number">방어 전 통합 손익</th>
              <th class="number">★ 방어 ①+② 통합 손익</th>
              <th class="number">방어 개선폭</th>
              <th>상태</th>
              <th style="min-width:340px;">매크로·기술적 손실 원인 및 비침습 방어 작동 내역</th>
            </tr>
          </thead>
          <tbody>
            ${filteredTableMonths
              .map((m) => {
                const fxB = universeMode === 'COMBO45' ? m.fx45_base : m.fx21_base;
                const fxD = universeMode === 'COMBO45' ? m.fx45_def : m.fx21_def;
                const cB = universeMode === 'COMBO45' ? m.combo45_base : m.combo21_base;
                const cD = universeMode === 'COMBO45' ? m.combo45_def12 : m.combo21_def12;
                const diff = cD - cB;

                let badge = '';
                if (cB < 0 && cD >= 0) {
                  badge = '<span class="tag primary">흑자 전환</span>';
                } else if (cB < 0 && diff > 2000) {
                  badge = '<span class="tag shadow">손실 대폭 축소</span>';
                } else if (cD >= 0) {
                  badge = '<span class="tag" style="color:#0d9488;border-color:#0d9488;">흑자 유지</span>';
                } else {
                  badge = '<span class="tag block">소폭 적자</span>';
                }

                const detailHtml = m.cause_title
                  ? `<div><strong>${esc(m.cause_title)}</strong></div>
                     <div style="font-size:11.5px;color:var(--muted,#64748b);margin-top:2px;">• 원인: ${esc(m.macro_driver)} (${esc(m.tech_driver)})</div>
                     <div style="font-size:11.5px;color:#0d9488;font-weight:600;margin-top:2px;">• 방어: ${esc(m.defense_action)}</div>`
                  : `<span class="muted" style="font-size:12px;">정상 수익 수확 구간 (ER20 평균 ${fmtNum(m.er20_mean, 2)} · 최대 Tail ${fmtNum(m.tail_max_pct, 1)}%)</span>`;

                return `<tr style="${cB < 0 && cD >= 0 ? 'background:rgba(13,148,136,0.06);' : ''}">
                  <td><strong>${m.ym}</strong></td>
                  <td class="number">
                    <strong>${fmtNum(m.v2_score, 1)}점</strong>
                    <div class="pair-sub">${fmtNum(m.p1_eff, 0)} / ${fmtNum(m.p2_rv, 0)} / ${fmtNum(m.p3_coh, 0)}</div>
                  </td>
                  <td class="number" style="font-size:12px;">
                    <span class="${clsPnl(fxB)}">${fmtUsd(fxB)}</span> → <strong class="${clsPnl(fxD)}">${fmtUsd(fxD)}</strong>
                  </td>
                  <td class="number" style="font-size:12px;">
                    <span class="${clsPnl(m.mom_base)}">${fmtUsd(m.mom_base)}</span> → <strong class="${clsPnl(m.mom_def)}">${fmtUsd(m.mom_def)}</strong>
                  </td>
                  <td class="number ${clsPnl(cB)}">${fmtUsd(cB)}</td>
                  <td class="number ${clsPnl(cD)}"><strong>${fmtUsd(cD)}</strong></td>
                  <td class="number ${clsPnl(diff)}">${fmtUsd(diff)}</td>
                  <td>${badge}</td>
                  <td style="line-height:1.45;">${detailHtml}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Bind interactive controls
  target.querySelectorAll('[data-fxv2-uni]').forEach((btn) => {
    btn.onclick = () => {
      universeMode = btn.dataset.fxv2Uni;
      renderMomentumFxV2Monthly(target);
    };
  });

  target.querySelectorAll('[data-fxv2-yr]').forEach((btn) => {
    btn.onclick = () => {
      yearFilter = btn.dataset.fxv2Yr;
      renderMomentumFxV2Monthly(target);
    };
  });

  target.querySelectorAll('[data-fxv2-mfilter]').forEach((btn) => {
    btn.onclick = () => {
      monthFilter = btn.dataset.fxv2Mfilter;
      renderMomentumFxV2Monthly(target);
    };
  });

  const expBtn = target.querySelector('#fxv2-export-csv');
  if (expBtn) {
    expBtn.onclick = () => {
      downloadCsv('fx-v2-59months-analysis.csv', [
        [
          'year_month',
          'v2_score',
          'p1_eff',
          'p2_rv',
          'p3_coh',
          'fx45_before_usd',
          'fx45_def12_usd',
          'mom_before_usd',
          'mom_def12_usd',
          'combo45_before_usd',
          'combo45_def12_usd',
          'combo45_improvement_usd',
          'combo21_before_usd',
          'combo21_def12_usd',
          'cause_code',
          'cause_title',
          'defense_action',
        ],
        ...allMonths.map((m) => [
          m.ym,
          m.v2_score,
          m.p1_eff,
          m.p2_rv,
          m.p3_coh,
          m.fx45_base,
          m.fx45_def,
          m.mom_base,
          m.mom_def,
          m.combo45_base,
          m.combo45_def12,
          m.combo45_diff,
          m.combo21_base,
          m.combo21_def12,
          m.cause_code,
          m.cause_title,
          m.defense_action,
        ]),
      ]);
    };
  }
}
