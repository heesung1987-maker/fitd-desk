import { getChartTheme } from './chart-utils.js?v=16';

let ctx = null;
let a4Data = null;
let lastStateKey = null;
let loading = false;

let activeTab = 'COCKPIT'; // 'COCKPIT' | 'ANALOG' | 'PERF' | 'RULES' | 'AUDIT'
let selectedSetting = 'A'; // 'A' (2E 50/50 Vol $0.8M default) | 'B' (2E Soft Hybrid) | 'C' (4E W4 Ref)
let customVolM = 0.8;      // Linear scaler for Setting A (0.4, 0.6, 0.8, 1.0, 1.2)
let perfPeriod = '11Y';    // '11Y' | '26Y' | 'REGIMES'
let selectedAnalogRank = 1;

const $ = (s) => document.querySelector(s);

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

const fmtSigned = (v, d = 2) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return (n > 0 ? '+' : '') + fmtNum(n, d);
};

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
  if (!Number.isFinite(n) || Math.abs(n) < 1e-6) return 'muted';
  return n > 0 ? 'green' : 'red';
};

function todayKst() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day'].map((k) => p.find((x) => x.type === k).value).join('-');
}

const pill = (text, tone = 'neutral') => {
  const map = {
    green: ['rgba(13,148,136,0.14)', '#0d9488'],
    red: ['rgba(220,38,38,0.14)', '#dc2626'],
    amber: ['rgba(217,119,6,0.16)', '#b45309'],
    blue: ['rgba(37,99,235,0.14)', '#2563eb'],
    dark: ['rgba(15,23,42,0.12)', 'var(--ink)'],
    neutral: ['rgba(100,116,139,0.14)', '#64748b'],
  };
  const [bg, fg] = map[tone] || map.neutral;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${bg};color:${fg};white-space:nowrap;">${esc(text)}</span>`;
};

function bandPill(st) {
  if (st === 'IN_BAND') return pill('밴드 내 유지 (±15%)', 'green');
  if (st === 'NEW_ORDER') return pill('신규 집행 필요', 'blue');
  if (st === 'REBAL_NEEDED') return pill('리밸런싱 필요', 'amber');
  if (st === 'CLOSE_NEEDED') return pill('청산 필요', 'red');
  return pill('무포지션', 'neutral');
}

const FX_FUT_SPEC = {
  EUR: { code: '6E', mult: 125000, quote: 'XXXUSD', desc: 'CME 125k EUR' },
  GBP: { code: '6B', mult: 62500, quote: 'XXXUSD', desc: 'CME 62.5k GBP' },
  AUD: { code: '6A', mult: 100000, quote: 'XXXUSD', desc: 'CME 100k AUD' },
  NZD: { code: '6N', mult: 100000, quote: 'XXXUSD', desc: 'CME 100k NZD' },
  CAD: { code: '6C', mult: 100000, quote: 'USDXXX', desc: 'CME 100k CAD' },
  JPY: { code: '6J', mult: 12500000, quote: 'USDXXX', desc: 'CME 12.5M JPY' },
  CHF: { code: '6S', mult: 125000, quote: 'USDXXX', desc: 'CME 125k CHF' },
  BRL: { code: '6L', mult: 100000, quote: 'USDXXX', desc: 'CME 100k BRL' },
  MXN: { code: '6M', mult: 500000, quote: 'USDXXX', desc: 'CME 500k MXN' },
  KRW: { code: 'KRX USD', mult: 10000, quote: 'USD_FIXED_INV', desc: 'KRX $10k (역방향)' },
};

function calcFxFut(ccy, signedUsd, spot) {
  const sp = FX_FUT_SPEC[ccy];
  const s = Number(spot);
  if (!sp || !Number.isFinite(s) || s <= 0) return { code: sp?.code || ccy, usdPerCt: 0, ct: 0, desc: sp?.desc || '' };
  let usdPerCt = 0;
  let ct = 0;
  if (sp.quote === 'XXXUSD') {
    usdPerCt = sp.mult * s;
    ct = Math.round(Number(signedUsd || 0) / Math.max(1, usdPerCt));
  } else if (sp.quote === 'USDXXX') {
    usdPerCt = sp.mult / s;
    ct = Math.round(Number(signedUsd || 0) / Math.max(1, usdPerCt));
  } else {
    usdPerCt = sp.mult;
    ct = Math.round(-Number(signedUsd || 0) / Math.max(1, usdPerCt));
  }
  return { code: sp.code, usdPerCt: Math.round(usdPerCt), ct, desc: sp.desc };
}

function liveStatusPill(st) {
  if (st === 'NEW_ENTRY') return pill('오늘 신규', 'green');
  if (st === 'EXIT_ALERT') return pill('청산선 돌파', 'red');
  if (st === 'STOP_ALERT') return pill('손절 경보', 'red');
  if (st === 'TP_REACHED') return pill('익절 도달', 'green');
  if (st === 'TP_NEAR') return pill('익절 초근접', 'green');
  if (st === 'NEAR_EXIT') return pill('청산 임박', 'amber');
  if (st === 'LIVE_BREAK_LONG') return pill('10D 상향돌파', 'green');
  if (st === 'LIVE_BREAK_SHORT') return pill('10D 하향돌파', 'red');
  if (st === 'HOLD' || st === 'OPEN') return pill('보유중', 'blue');
  if (st === 'SIGNAL') return pill('진입신호', 'green');
  if (st && st.startsWith('COOLDOWN')) return pill(st.replace('COOLDOWN', '쿨다운'), 'red');
  if (st === 'BETA_CAP') return pill('베타캡 차단', 'amber');
  if (st === 'NODE_CAP') return pill('통화한도', 'amber');
  if (st === 'S4_PAUSE') return pill('S4 중단', 'red');
  return pill('관찰', 'neutral');
}

function downloadCsv(filename, rows) {
  const text =
    '\ufeff' +
    rows.map((r) => r.map((v) => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
  const u = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = u;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(u);
}

export function configureMomentumStrategy(context) {
  ctx = context;
}

function getLinearVolScale() {
  if (selectedSetting !== 'A') return 1.0;
  return customVolM / 0.8;
}

async function fetchActive4ePayload(force = false) {
  const st = ctx?.getState?.();
  const stateKey = `${st?.data_mode || 'live'}|${st?.updated_at || ''}|${(st?.positions || []).length}`;
  if (!force && a4Data && lastStateKey === stateKey) return a4Data;
  loading = true;
  try {
    const res = await ctx.api('/api/active-4e?t=' + Date.now());
    a4Data = res;
    lastStateKey = stateKey;
  } catch (e) {
    try {
      const r = await fetch('./data/active-4e-report.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) a4Data = await r.json();
      else throw e;
    } catch {
      ctx?.toast?.('2엔진 50/50 전략 데이터 조회 실패: ' + e.message);
    }
  } finally {
    loading = false;
  }
  return a4Data;
}

// =========================================================================
// EXECUTION DIALOGS (1-CLICK SYNC TO /api/positions & #book)
// =========================================================================
function openDialogShell(eyebrow, title, subtitle, bodyHtml, submitLabel) {
  const d = $('#position-dialog');
  d.innerHTML = `
    <form id="a4-exec-form" style="min-width:min(640px, 92vw);">
      <div class="eyebrow">${esc(eyebrow)}</div>
      <h2 style="margin:4px 0 6px;">${title}</h2>
      <p class="muted" style="margin:0 0 14px; font-size:12.5px; line-height:1.5;">${subtitle}</p>
      ${bodyHtml}
      <div id="a4-dialog-err" role="alert" class="form-error" hidden></div>
      <div class="dialog-actions" style="margin-top:16px;">
        <button type="button" id="a4-dialog-cancel" class="btn">취소</button>
        <button type="submit" id="a4-dialog-submit" class="btn primary">${esc(submitLabel)}</button>
      </div>
    </form>`;
  $('#a4-dialog-cancel').onclick = () => d.close();
  d.showModal();
  return $('#a4-exec-form');
}

function openFuturesOrderDialog(cid, suggestedSignedCt, engineTag = '2E-E1') {
  const lo = a4Data?.live_overlay || {};
  const fq = lo.fut_quotes?.[cid];
  const e1r = (a4Data?.live_engines?.e1_rows || []).find((x) => x.cid === cid);
  if (!fq) return;
  const sideInit = suggestedSignedCt < 0 ? -1 : 1;
  const absCt = Math.max(1, Math.round(Math.abs(suggestedSignedCt || 10)));
  const livePx = Number(fq.live_px || 100);
  const vol60 = Number(fq.vol60 || 0.12);
  const stopPxInit = Number((livePx - sideInit * 7.0 * vol60).toFixed(4));
  const trailPxInit = Number((livePx - sideInit * 8.0 * vol60).toFixed(4));
  const yldInit = Number(fq.live_yield_pct || 4.0);

  const form = openDialogShell(
    '2-ENGINE 50/50 · FUTURES EXECUTION',
    `국채선물 체결 등록 · ${esc(fq.name)} (${esc(fq.contract)})`,
    '실제 체결한 계약수와 선물 가격을 입력하면 <b>포지션 모니터(#book)</b>에 즉시 반영되고 모델 vs 실보유 주문표가 자동 동기화됩니다.',
    `
    <div style="background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12.5px;">
      <div>실시간 BBG가: <b>${fmtNum(livePx, 4)}</b> (${fmtSigned(fq.chg_bp, 1)}bp) · 1σ <b>${fmtNum(fq.vol60_bp, 1)}bp</b> · 7σ 손절폭 <b>${fmtNum(fq.stop7_bp, 1)}bp</b></div>
      <div>계약당 DV01: <b>$${fmtNum(fq.dv01_ct, 0)}/bp</b></div>
    </div>
    <div class="form-grid">
      <label>체결일
        <input id="f-date" type="date" value="${esc(lo.live_date || todayKst())}" max="${todayKst()}" required>
      </label>
      <label>방향
        <select id="f-side">
          <option value="-1" ${sideInit < 0 ? 'selected' : ''}>채권 SHORT (매도 · 금리 상승)</option>
          <option value="1" ${sideInit > 0 ? 'selected' : ''}>채권 LONG (매수 · 금리 하락)</option>
        </select>
      </label>
      <label>체결 계약수 (Contracts)
        <input id="f-ct" type="number" min="1" max="5000" step="1" value="${absCt}" required>
      </label>
      <label>체결 선물가격 (${esc(fq.contract)})
        <input id="f-px" type="number" step="any" value="${livePx}" required>
      </label>
      <label>대응 현물금리 (%)
        <input id="f-yld" type="number" step="any" value="${yldInit}" required>
      </label>
      <label>7σ 하드스탑 선물가 (참고)
        <input id="f-stop" type="number" step="any" value="${stopPxInit}" required>
      </label>
    </div>
    <div id="f-preview" style="margin:10px 0;padding:8px 12px;background:var(--panel2);border-radius:8px;font-size:12.5px;font-weight:700;"></div>
    <label>메모
      <textarea id="f-notes" rows="2">2엔진 50/50 (${esc(engineTag)}) · ${esc(fq.contract)} ${sideInit < 0 ? 'SHORT' : 'LONG'} ${absCt}ct 체결 (8σ 트레일 참고 ${trailPxInit})</textarea>
    </label>`,
    '체결 확정 및 #book 등록'
  );

  const upd = () => {
    const c = Math.max(1, Math.round(Number($('#f-ct').value) || 1));
    const dv = c * fq.dv01_ct;
    const stopUsd = dv * (fq.stop7_bp || 35);
    $('#f-preview').innerHTML = `등록 규모: <b>${c}계약 (${esc(fq.contract)})</b> · DV01 <b>$${fmtNum(dv, 0)}/bp</b> · 7σ 기준 손절예산 약 <b>$${fmtNum(stopUsd, 0)}</b>`;
  };
  $('#f-ct').oninput = upd;
  $('#f-side').onchange = () => {
    const s = Number($('#f-side').value);
    const p = Number($('#f-px').value) || livePx;
    $('#f-stop').value = (p - s * 7.0 * vol60).toFixed(4);
  };
  upd();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#a4-dialog-submit');
    btn.disabled = true;
    try {
      const c = Math.max(1, Math.round(Number($('#f-ct').value) || 1));
      const side1 = Number($('#f-side').value);
      await ctx.api('/api/positions', {
        action: 'manual_open',
        shape: 'SINGLE',
        strategy: 'MOMENTUM',
        core_id: cid,
        leg1: fq.leg1,
        contract: fq.contract,
        side1,
        contracts: c,
        rates_currency: 'USD',
        total_dv01_usd: Math.round(c * fq.dv01_ct),
        entry_date: $('#f-date').value,
        entry_futures_px: Number($('#f-px').value),
        quote1: Number($('#f-yld').value),
        stop_futures_px: Number($('#f-stop').value),
        stage: e1r?.open?.stage === 1 ? 'STAGE_1_SCOUT' : 'STAGE_2_MAIN',
        stage_label: `2엔진 50/50 ${engineTag} (${c}계약)`,
        notes: $('#f-notes').value,
      });
      $('#position-dialog').close();
      ctx.toast(`${fq.contract} ${side1 < 0 ? 'SHORT' : 'LONG'} ${c}계약 등록 완료 (#book 동기화)`);
      lastStateKey = null;
      await ctx.onChange(true);
    } catch (err) {
      const er = $('#a4-dialog-err');
      er.textContent = err.message;
      er.hidden = false;
    } finally {
      btn.disabled = false;
    }
  };
}

function openFxOrderDialog({ mode = 'SINGLE', ccy1, ccy2 = null, side1 = 1, side2 = -1, mio1 = 1.0, mio2 = 1.0, strategy = 'ACTIVE_2E_FX4', label = '' }) {
  const lo = a4Data?.live_overlay || {};
  const q1 = lo.fx_quotes?.[ccy1] || {};
  const q2 = ccy2 ? (lo.fx_quotes?.[ccy2] || {}) : null;
  const isPair = mode === 'PAIR' && ccy2;
  const px1 = Number(q1.fitd_quote || q1.live_spot || 1.0);
  const px2 = isPair ? Number(q2.fitd_quote || q2.live_spot || 1.0) : null;

  const f1 = calcFxFut(ccy1, side1 * mio1 * 1e6, q1.live_spot);
  const f2 = isPair ? calcFxFut(ccy2, side2 * mio2 * 1e6, q2.live_spot) : null;
  const form = openDialogShell(
    isPair ? '2-ENGINE 50/50 · FX4 PAIR EXECUTION' : '2-ENGINE 50/50 · FX NET EXECUTION',
    isPair ? `FX4 페어 체결 등록 · ${esc(ccy1)}/${esc(ccy2)}` : `FX 통화 체결 등록 · ${esc(ccy1)} (vs USD)`,
    '실제 체결 명목금액(USD mio)과 환율을 입력하면 <b>포지션 모니터(#book)</b>에 등록되어 모델 vs 실보유 델타에 즉시 반영됩니다.',
    `
    <div style="background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12.5px;line-height:1.55;">
      <div>실시간 BBG 스팟: <b>${esc(ccy1)} ${fmtNum(q1.live_spot, 4)}</b> (${fmtSigned(q1.chg_pct, 2)}%)${isPair ? ` · <b>${esc(ccy2)} ${fmtNum(q2.live_spot, 4)}</b> (${fmtSigned(q2.chg_pct, 2)}%)` : ''}</div>
      <div style="color:#0d9488;font-weight:700;margin-top:3px;">FX 선물 환산: ${esc(f1.code)} ${fmtSigned(f1.ct, 0)} ct (1계약 약 $${fmtNum(f1.usdPerCt, 0)})${isPair && f2 ? ` / ${esc(f2.code)} ${fmtSigned(f2.ct, 0)} ct (1계약 약 $${fmtNum(f2.usdPerCt, 0)})` : ''}</div>
    </div>
    <div class="form-grid">
      <label>체결일
        <input id="fx-date" type="date" value="${esc(lo.live_date || todayKst())}" max="${todayKst()}" required>
      </label>
      <label>전략 태그
        <input id="fx-strat" type="text" value="${esc(strategy)}" required>
      </label>
      <label>${esc(ccy1)} 방향
        <select id="fx-s1">
          <option value="1" ${side1 > 0 ? 'selected' : ''}>LONG ${esc(ccy1)}</option>
          <option value="-1" ${side1 < 0 ? 'selected' : ''}>SHORT ${esc(ccy1)}</option>
        </select>
      </label>
      <label>${esc(ccy1)} 명목금액 (USD mio)
        <input id="fx-m1" type="number" min="0.01" max="50" step="0.01" value="${Math.max(0.05, Math.abs(mio1)).toFixed(2)}" required>
      </label>
      <label>${esc(ccy1)} 진입 기준가 (USD/1단위)
        <input id="fx-q1" type="number" step="any" value="${px1}" required>
      </label>
      ${isPair ? `
      <label>${esc(ccy2)} 방향
        <select id="fx-s2">
          <option value="1" ${side2 > 0 ? 'selected' : ''}>LONG ${esc(ccy2)}</option>
          <option value="-1" ${side2 < 0 ? 'selected' : ''}>SHORT ${esc(ccy2)}</option>
        </select>
      </label>
      <label>${esc(ccy2)} 명목금액 (USD mio)
        <input id="fx-m2" type="number" min="0.01" max="50" step="0.01" value="${Math.max(0.05, Math.abs(mio2)).toFixed(2)}" required>
      </label>
      <label>${esc(ccy2)} 진입 기준가 (USD/1단위)
        <input id="fx-q2" type="number" step="any" value="${px2}" required>
      </label>` : ''}
    </div>
    <label style="margin-top:10px;display:block;">메모
      <textarea id="fx-notes" rows="2">${esc(label || `2엔진 50/50 · ${isPair ? `${ccy1}/${ccy2}` : ccy1} 체결`)}</textarea>
    </label>`,
    'FX 체결 확정 및 #book 등록'
  );

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#a4-dialog-submit');
    btn.disabled = true;
    try {
      await ctx.api('/api/positions', {
        action: 'manual_open',
        shape: isPair ? 'PAIR' : 'SINGLE',
        strategy: $('#fx-strat').value.trim() || strategy,
        leg1: q1.leg_id,
        leg2: isPair ? q2.leg_id : null,
        side1: Number($('#fx-s1').value),
        side2: isPair ? Number($('#fx-s2').value) : 0,
        mio1: Number($('#fx-m1').value),
        mio2: isPair ? Number($('#fx-m2').value) : 0,
        quote1: Number($('#fx-q1').value),
        quote2: isPair ? Number($('#fx-q2').value) : null,
        entry_date: $('#fx-date').value,
        notes: $('#fx-notes').value,
      });
      $('#position-dialog').close();
      ctx.toast(`${isPair ? `${ccy1}/${ccy2}` : ccy1} FX 포지션 등록 완료 (#book 동기화)`);
      lastStateKey = null;
      await ctx.onChange(true);
    } catch (err) {
      const er = $('#a4-dialog-err');
      er.textContent = err.message;
      er.hidden = false;
    } finally {
      btn.disabled = false;
    }
  };
}

function openClosePositionDialog(pos) {
  if (!pos) return;
  const lo = a4Data?.live_overlay || {};
  const isFut = pos.asset_class === 'Rates' && pos.contracts > 0;
  const fq = pos.core_id ? lo.fut_quotes?.[pos.core_id] : null;
  const form = openDialogShell(
    'POSITION CLOSE · #BOOK SYNC',
    `보유 포지션 청산 · ${esc(pos.name)}`,
    '전량 또는 부분 청산 비율을 선택하면 실현손익이 자동 정산되어 포지션 모니터(#book)에 반영됩니다.',
    `
    <div style="background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12.5px;">
      현재 전략: <b>${esc(pos.strategy)}</b> · 진입일 <b>${esc(pos.entry_date || '—')}</b> · 현재 미실현 <b class="${clsVal(pos.unrealized_usd)}">${fmtUsd(pos.unrealized_usd)}</b>
    </div>
    <div class="form-grid">
      <label>청산일
        <input id="cl-date" type="date" value="${esc(lo.live_date || todayKst())}" max="${todayKst()}" required>
      </label>
      <label>청산 비율 (%)
        <select id="cl-pct">
          <option value="100" selected>100% 전량 청산</option>
          <option value="50">50% 부분 청산</option>
          <option value="25">25% 일부 축소</option>
        </select>
      </label>
      ${isFut && fq ? `
      <label>청산 체결 선물가 (${esc(fq.contract)})
        <input id="cl-fpx" type="number" step="any" value="${fq.live_px}" required>
      </label>` : ''}
    </div>
    <label style="margin-top:10px;display:block;">청산 메모
      <textarea id="cl-notes" rows="2">2엔진 50/50 운용 콕핏에서 청산 집행</textarea>
    </label>`,
    '청산 확정'
  );

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#a4-dialog-submit');
    btn.disabled = true;
    try {
      const payload = {
        action: 'manual_close',
        id: pos.id,
        trade_date: $('#cl-date').value,
        percent: Number($('#cl-pct').value),
        notes: $('#cl-notes').value,
      };
      if (isFut && $('#cl-fpx')) payload.exit_futures_px = Number($('#cl-fpx').value);
      await ctx.api('/api/positions', payload);
      $('#position-dialog').close();
      ctx.toast(`${pos.name} 청산 완료 (#book 동기화)`);
      lastStateKey = null;
      await ctx.onChange(true);
    } catch (err) {
      const er = $('#a4-dialog-err');
      er.textContent = err.message;
      er.hidden = false;
    } finally {
      btn.disabled = false;
    }
  };
}

// =========================================================================
// CHARTS (5Y EQUITY CURVE & TOP 8 ANALOG 60D TRAJECTORIES)
// =========================================================================
function renderMonthlyEquitySvg(data, activeKey) {
  const ct = getChartTheme();
  const ink = ct.ink || '#0f172a';
  const mA = data.settings.A.monthly_5y || [];
  const mB = data.settings.B.monthly_5y || [];
  const mC = data.settings.C.monthly_5y || [];
  if (!mA.length) return '<div class="empty">월간 시계열 데이터가 없습니다.</div>';

  const n = mA.length;
  const vals = [...mA.map((r) => r.cum), ...mB.map((r) => r.cum), ...mC.map((r) => r.cum), 0];
  const lo = Math.min(0, ...vals);
  const hi = Math.max(1000000, ...vals);
  const w = 1040, h = 285, padL = 82, padR = 24, padT = 38, padB = 34;
  const x = (i) => padL + (i * (w - padL - padR)) / Math.max(1, n - 1);
  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const makePath = (arr) => arr.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(r.cum).toFixed(1)}`).join(' ');
  const ticks = [lo, lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.75, hi];

  const mainArr = data.settings[activeKey].monthly_5y;
  const styles = {
    A: { col: '#0d9488', lbl: '세팅 A · 2엔진 50/50 (추천 · Vol $0.8M)' },
    B: { col: '#2563eb', lbl: '세팅 B · 2엔진 소프트감속 (Vol $1.0M)' },
    C: { col: '#94a3b8', lbl: '세팅 C · 4엔진 W4 비교 (Vol $0.8M)' },
  };

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="최근 5년 누적 손익 곡선">
    <g transform="translate(${padL}, 18)" style="font-size:11.5px;font-weight:700;fill:${ink};">
      <line x1="0" y1="-4" x2="20" y2="-4" stroke="${styles.A.col}" stroke-width="${activeKey === 'A' ? 3.2 : 1.8}" ${activeKey === 'A' ? '' : 'stroke-dasharray="5 3"'}/>
      <text x="25" y="0" fill="${ink}">세팅 A (2엔진 추천): ${fmtM(mA.at(-1)?.cum)}</text>
      <line x1="270" y1="-4" x2="290" y2="-4" stroke="${styles.B.col}" stroke-width="${activeKey === 'B' ? 3.2 : 1.8}" ${activeKey === 'B' ? '' : 'stroke-dasharray="5 3"'}/>
      <text x="295" y="0" fill="${ink}">세팅 B (2엔진 감속): ${fmtM(mB.at(-1)?.cum)}</text>
      <line x1="540" y1="-4" x2="560" y2="-4" stroke="${styles.C.col}" stroke-width="${activeKey === 'C' ? 3.2 : 1.8}" ${activeKey === 'C' ? '' : 'stroke-dasharray="3 3"'}/>
      <text x="565" y="0" fill="${ink}">세팅 C (4엔진 W4 참고): ${fmtM(mC.at(-1)?.cum)}</text>
    </g>
    ${ticks.map((tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${ct.grid}" stroke-dasharray="3 3"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${ink}" font-size="11" font-weight="600">$${fmtNum(tv / 1e6, 1)}M</text>`).join('')}
    <line x1="${padL}" x2="${w - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="${ct.zero}" stroke-width="1.2"/>
    <path d="${makePath(mC)}" fill="none" stroke="${styles.C.col}" stroke-width="${activeKey === 'C' ? 3.2 : 1.7}" ${activeKey === 'C' ? '' : 'stroke-dasharray="3 3"'}/>
    <path d="${makePath(mB)}" fill="none" stroke="${styles.B.col}" stroke-width="${activeKey === 'B' ? 3.2 : 1.9}" ${activeKey === 'B' ? '' : 'stroke-dasharray="5 3"'}/>
    <path d="${makePath(mA)}" fill="none" stroke="${styles.A.col}" stroke-width="${activeKey === 'A' ? 3.2 : 1.9}" ${activeKey === 'A' ? '' : 'stroke-dasharray="5 3"'}/>
    ${mainArr.map((r, i) => `
      <circle cx="${x(i).toFixed(1)}" cy="${y(r.cum).toFixed(1)}" r="3.8" fill="${styles[activeKey].col}" opacity="0.88">
        <title>[${r.ym}] ${styles[activeKey].lbl}\n월간 손익: ${fmtUsd(r.pnl)} | 누적: ${fmtUsd(r.cum)}\nE1 ${fmtK(r.e1)} / FX4 ${fmtK(r.e3)}${activeKey === 'C' ? ` / E2 ${fmtK(r.e2)} / E4 ${fmtK(r.e4)}` : ''}</title>
      </circle>`).join('')}
    ${mainArr
      .filter((r, i) => i === 0 || r.ym.endsWith('-01') || i === n - 1)
      .map((r) => {
        const idx = mainArr.indexOf(r);
        return `<text x="${x(idx).toFixed(1)}" y="${h - 10}" text-anchor="${idx === n - 1 ? 'end' : 'middle'}" fill="${ink}" font-size="11" font-weight="600">${r.ym}</text>`;
      })
      .join('')}
  </svg>`;
}

function renderAnalogTrajectoriesSvg(analog, selRank) {
  const ct = getChartTheme();
  const ink = ct.ink || '#0f172a';
  const top8 = analog?.top8 || [];
  const days = analog?.curve_days || [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  const avgCurve = analog?.summary?.avg_curve_60d || [];
  if (!top8.length) return '<div class="empty">싱크로율 시계열 데이터가 없습니다.</div>';

  const allVals = [0, ...avgCurve];
  top8.forEach((t) => (t.fwd_3m?.curve_60d || []).forEach((v) => allVals.push(v)));
  const lo = Math.min(-150000, ...allVals);
  const hi = Math.max(250000, ...allVals);
  const w = 1040, h = 290, padL = 78, padR = 92, padT = 36, padB = 34;
  const x = (i) => padL + (i * (w - padL - padR)) / Math.max(1, days.length - 1);
  const y = (v) => padT + ((hi - v) / Math.max(1, hi - lo)) * (h - padT - padB);
  const pathOf = (arr) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [lo, lo + (hi - lo) * 0.25, 0, lo + (hi - lo) * 0.75, hi].filter(
    (v, i, a) => a.findIndex((z) => Math.abs(z - v) < (hi - lo) * 0.1) === i
  );

  // Month boundary vertical guides (D+20 = M+1, D+40 = M+2, D+60 = M+3)
  const mGuides = [
    [4, 'M+1 (20D)'],
    [8, 'M+2 (40D)'],
    [12, 'M+3 (60D)'],
  ];

  const winCnt = top8.filter((t) => (t.fwd_3m?.pnl || 0) >= 0).length;
  const lossCnt = top8.length - winCnt;

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;" role="img" aria-label="TOP 8 유사 국면 직후 3개월 2엔진 누적 손익 궤적">
    <g transform="translate(${padL}, 17)" style="font-size:11.5px;font-weight:700;fill:${ink};">
      <line x1="0" y1="-4" x2="20" y2="-4" stroke="#0d9488" stroke-width="2.2"/>
      <text x="25" y="0" fill="${ink}">3M 흑자 국면 (${winCnt}개)</text>
      <line x1="160" y1="-4" x2="180" y2="-4" stroke="#dc2626" stroke-width="2.2"/>
      <text x="185" y="0" fill="${ink}">3M 조정 국면 (${lossCnt}개)</text>
      <line x1="320" y1="-4" x2="344" y2="-4" stroke="#1e293b" stroke-width="3.2" stroke-dasharray="6 4"/>
      <text x="349" y="0" fill="${ink}">TOP 8 평균 궤적 (${fmtK(avgCurve.at(-1))})</text>
      <line x1="560" y1="-4" x2="582" y2="-4" stroke="#2563eb" stroke-width="3.6"/>
      <text x="587" y="0" fill="#2563eb">선택 국면 강조 (#${selRank})</text>
    </g>
    ${ticks.map((tv) => `
      <line x1="${padL}" x2="${w - padR}" y1="${y(tv).toFixed(1)}" y2="${y(tv).toFixed(1)}" stroke="${tv === 0 ? ct.zero : ct.grid}" stroke-width="${tv === 0 ? 1.3 : 1}" stroke-dasharray="${tv === 0 ? '' : '3 3'}"/>
      <text x="${padL - 8}" y="${(y(tv) + 4).toFixed(1)}" text-anchor="end" fill="${ink}" font-size="11" font-weight="600">${fmtK(tv)}</text>`).join('')}
    ${mGuides.map(([idx, lbl]) => `
      <line x1="${x(idx).toFixed(1)}" x2="${x(idx).toFixed(1)}" y1="${padT}" y2="${h - padB}" stroke="${ct.grid}" stroke-dasharray="2 3"/>
      <text x="${x(idx).toFixed(1)}" y="${h - 10}" text-anchor="middle" fill="${ink}" font-size="11" font-weight="700">${lbl}</text>`).join('')}
    <text x="${x(0).toFixed(1)}" y="${h - 10}" text-anchor="middle" fill="${ink}" font-size="11" font-weight="700">D+0</text>
    ${top8
      .filter((t) => t.rank !== selRank)
      .map((t) => {
        const arr = t.fwd_3m?.curve_60d || [];
        const win = (t.fwd_3m?.pnl || 0) >= 0;
        const col = win ? '#0d9488' : '#dc2626';
        return `<path d="${pathOf(arr)}" fill="none" stroke="${col}" stroke-width="1.6" opacity="0.45"><title>#${t.rank} ${t.ym} (${t.sim_all}%): 3M ${fmtUsd(t.fwd_3m?.pnl)}</title></path>
          <text x="${(x(arr.length - 1) + 6).toFixed(1)}" y="${(y(arr.at(-1)) + 3).toFixed(1)}" fill="${col}" font-size="10" font-weight="700" opacity="0.72">#${t.rank} ${t.ym.slice(2)}</text>`;
      })
      .join('')}
    ${avgCurve.length ? `<path d="${pathOf(avgCurve)}" fill="none" stroke="#1e293b" stroke-width="3.0" stroke-dasharray="6 4"/>` : ''}
    ${(() => {
      const sel = top8.find((t) => t.rank === selRank) || top8[0];
      const arr = sel.fwd_3m?.curve_60d || [];
      return `<path d="${pathOf(arr)}" fill="none" stroke="#2563eb" stroke-width="3.6"/>
        ${arr.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.6" fill="#2563eb"><title>#${sel.rank} ${sel.date} (D+${days[i]}): ${fmtUsd(v)}</title></circle>`).join('')}
        <text x="${(x(arr.length - 1) + 6).toFixed(1)}" y="${(y(arr.at(-1)) + 4).toFixed(1)}" fill="#2563eb" font-size="11" font-weight="900">#${sel.rank} ${sel.ym.slice(2)} (${fmtK(arr.at(-1))})</text>`;
    })()}
  </svg>`;
}

// =========================================================================
// VIEW 1: REAL-TIME EXECUTION COCKPIT (2-ENGINE 50/50 PRIMARY)
// =========================================================================
function renderCockpit(data, s, scaleMul) {
  const lo = data.live_overlay || {};
  const le = data.live_engines || {};
  const rec = lo.reconcile || {};
  const actions = lo.action_queue || [];
  const e3m = le.e3_macro || {};
  const ls = s.live_scales || {};
  const is2E = (s.weights?.[1] || 0) === 0 && (s.weights?.[3] || 0) === 0;

  const futActMap = {};
  (rec.futures || []).forEach((r) => (futActMap[r.cid] = r));
  const fxActMap = {};
  (rec.fx || []).forEach((r) => (fxActMap[r.ccy] = r));

  const futExecRows = (s.live_net_futures?.rows || []).map((frow) => {
    const baseRec = futActMap[frow.cid] || {};
    const fq = lo.fut_quotes?.[frow.cid] || {};
    const tgtCt = Math.round((frow.net_ct || 0) * scaleMul);
    const e1Ct = (frow.e1_ct || 0) * scaleMul;
    const e2Ct = (frow.e2_ct || 0) * scaleMul;
    const actCt = Number(baseRec.actual_ct || 0);
    const deltaCt = Math.round(tgtCt - actCt);
    const dv01Unit = fq.dv01_ct || 40;
    let band = 'FLAT';
    if (tgtCt === 0 && Math.abs(actCt) >= 0.5) band = 'CLOSE_NEEDED';
    else if (tgtCt !== 0 && Math.abs(actCt) < 0.5) band = 'NEW_ORDER';
    else if (tgtCt !== 0) {
      const drift = (Math.abs(actCt - tgtCt) / Math.abs(tgtCt)) * 100;
      band = drift <= 15 ? 'IN_BAND' : 'REBAL_NEEDED';
    }
    return {
      cid: frow.cid, name: frow.name, contract: fq.contract || frow.cid + 'Z26',
      live_px: fq.live_px, chg_bp: fq.chg_bp, live_yield_pct: fq.live_yield_pct,
      e1_ct: e1Ct, e2_ct: e2Ct, target_ct: tgtCt, actual_ct: actCt, delta_ct: deltaCt,
      actual_dv01: Number(baseRec.actual_dv01 || 0), delta_dv01: Math.round(deltaCt * dv01Unit),
      band, pos_ids: baseRec.pos_ids || [],
    };
  });

  const targetFxMap = {};
  (s.live_net_fx?.rows || []).forEach((r) => (targetFxMap[r.ccy] = r));
  const fxCcys = [...new Set([...Object.keys(targetFxMap), ...Object.keys(fxActMap)])];
  const fxExecRows = fxCcys
    .map((ccy) => {
      const tr = targetFxMap[ccy] || { e3_usd: 0, e4_usd: 0, net_usd: 0 };
      const br = fxActMap[ccy] || { actual_usd: 0, pos_ids: [] };
      const fq = lo.fx_quotes?.[ccy] || {};
      const tgtUsd = Math.round((tr.net_usd || 0) * scaleMul);
      const actUsd = Math.round(br.actual_usd || 0);
      const deltaUsd = tgtUsd - actUsd;
      let band = 'FLAT';
      if (Math.abs(tgtUsd) < 50000 && Math.abs(actUsd) >= 50000) band = 'CLOSE_NEEDED';
      else if (Math.abs(tgtUsd) >= 50000 && Math.abs(actUsd) < 50000) band = 'NEW_ORDER';
      else if (Math.abs(tgtUsd) >= 50000) {
        const drift = (Math.abs(actUsd - tgtUsd) / Math.abs(tgtUsd)) * 100;
        band = drift <= 15 ? 'IN_BAND' : 'REBAL_NEEDED';
      }
      return {
        ccy, live_spot: fq.live_spot, chg_pct: fq.chg_pct,
        e3_usd: Math.round((tr.e3_usd || 0) * scaleMul), e4_usd: Math.round((tr.e4_usd || 0) * scaleMul),
        target_usd: tgtUsd, actual_usd: actUsd, delta_usd: deltaUsd, band, pos_ids: br.pos_ids || [],
      };
    })
    .filter((r) => Math.abs(r.target_usd) >= 50000 || Math.abs(r.actual_usd) >= 50000)
    .sort((a, b) => Math.abs(b.target_usd) - Math.abs(a.target_usd));

  const targetAbsDv01 = Math.round((s.live_net_futures?.abs_dv01_usd || 0) * scaleMul);
  const targetNetDv01 = Math.round((s.live_net_futures?.net_dv01_usd || 0) * scaleMul);
  const targetGrossFx = Math.round((s.live_net_fx?.gross_fx_usd || 0) * scaleMul);
  const targetNetUsdLeg = Math.round((s.live_net_fx?.net_usd_leg || 0) * scaleMul);
  const pendingOrders =
    futExecRows.filter((r) => ['NEW_ORDER', 'REBAL_NEEDED', 'CLOSE_NEEDED'].includes(r.band)).length +
    fxExecRows.filter((r) => ['NEW_ORDER', 'REBAL_NEEDED', 'CLOSE_NEEDED'].includes(r.band)).length;
  const urgentCnt = actions.filter((a) => a.level === 'URGENT').length;

  const stressVal = Number(e3m.stress || 1.0);
  const stressPct = Math.min(100, Math.max(0, (stressVal / 1.5) * 100));
  const stressTone = stressVal >= 1.25 ? '#dc2626' : stressVal >= 1.12 ? '#d97706' : '#0d9488';
  const openPositions = rec.actual_open_positions || [];
  const eff1 = Number(ls.eff_e1 || 2.60) * scaleMul;
  const eff3 = Number(ls.eff_e3 || 2.14) * scaleMul;
  const top1Analog = data.analog_analysis?.top8?.[0];

  return `
    <!-- 1. EXECUTIVE LIVE KPI STRIP -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:10px;margin-bottom:14px;">
      <div class="panel" style="padding:13px 15px;border-left:4px solid ${urgentCnt > 0 ? '#dc2626' : pendingOrders > 0 ? '#2563eb' : '#0d9488'};">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">실시간 경보 · 실행 대기 주문</div>
        <div style="font-size:21px;font-weight:900;margin:4px 0;color:${urgentCnt > 0 ? '#dc2626' : 'var(--ink)'};">
          긴급 ${urgentCnt}건 · 주문 ${pendingOrders}건
        </div>
        <div style="font-size:11.5px;color:var(--muted);">${is2E ? `2엔진 50/50 · 국채 ${(le.e1_rows || []).filter((r) => r.open).length}종 + FX ${le.e3_open?.length || 0}페어 (오늘 신규 포함)` : '참고 4엔진 W4 (30/15/35/20)'}</div>
      </div>

      <div class="panel" style="padding:13px 15px;border-left:4px solid #2563eb;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">국채선물 |DV01| (목표 / 실보유)</div>
        <div style="font-size:21px;font-weight:900;margin:4px 0;">
          $${fmtNum(targetAbsDv01, 0)} <span style="font-size:13px;font-weight:700;color:var(--muted);">/ $${fmtNum(rec.actual_abs_dv01 || 0, 0)}</span>
        </div>
        <div style="font-size:11.5px;color:var(--muted);">순 DV01 목표 <b class="${clsVal(targetNetDv01)}">${fmtUsd(targetNetDv01)}</b> · 5종 중 US 1 + DE 1</div>
      </div>

      <div class="panel" style="padding:13px 15px;border-left:4px solid #0d9488;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">FX Gross (목표 / 실보유)</div>
        <div style="font-size:21px;font-weight:900;margin:4px 0;">
          ${fmtM(targetGrossFx, false)} <span style="font-size:13px;font-weight:700;color:var(--muted);">/ ${fmtM(rec.actual_gross_fx || 0, false)}</span>
        </div>
        <div style="font-size:11.5px;color:var(--muted);">${is2E ? '<b>100% USD 중립 ($0.00M)</b> · 실BBG 3M캐리 ≥1%' : `Net USD ${fmtM(targetNetUsdLeg)}`}</div>
      </div>

      <div class="panel" style="padding:13px 15px;border-left:4px solid ${stressTone};">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;font-weight:700;color:var(--muted);">S4 매크로 스트레스 (FX4 브레이크)</span>
          ${e3m.allow_new ? pill('정상 허용', 'green') : pill('신규 중단', 'red')}
        </div>
        <div style="font-size:21px;font-weight:900;margin:4px 0;color:${stressTone};">${fmtNum(stressVal, 2)} <span style="font-size:12px;color:var(--muted);font-weight:600;">/ 1.25 중단선</span></div>
        <div style="height:5px;background:var(--line);border-radius:99px;overflow:hidden;margin-bottom:4px;">
          <div style="width:${stressPct.toFixed(0)}%;height:100%;background:${stressTone};"></div>
        </div>
        <div style="font-size:11px;color:var(--muted);">RV10/60 ${fmtNum(e3m.rv10_60, 2)} · MOVE ${fmtNum(e3m.move_val, 1)} · 배율 ${fmtNum(e3m.s4_scale, 2)}x</div>
      </div>

      <div class="panel" style="padding:13px 15px;border-left:4px solid #475569;cursor:pointer;" id="a4-jump-analog" title="클릭 시 26년 과거 국면 싱크로율 분석 탭으로 이동">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">5Y 성과 · 최유사 과거 국면 (클릭)</div>
        <div style="font-size:20px;font-weight:900;margin:4px 0;" class="green">${fmtM((s.summary_5y?.tot || 0) * scaleMul)} <span style="font-size:12.5px;color:var(--muted);">Shp ${fmtNum(s.summary_5y?.shp, 2)}</span></div>
        <div style="font-size:11.5px;color:var(--muted);">${top1Analog ? `1위 <b>${top1Analog.ym} (${top1Analog.sim_all}%)</b> · TOP8 3M ${fmtK(data.analog_analysis?.summary?.avg_3m)}` : `11Y Shp ${fmtNum(s.summary_11y?.shp, 2)}`}</div>
      </div>
    </div>

    <!-- 2. TODAY'S PRIORITY ACTION QUEUE -->
    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-head">
        <div>
          <h2 style="margin:0;">오늘의 운용 액션 · 실시간 경보 큐</h2>
          <small>BBG 15분 실시간 가격과 2엔진 청산선·손절선·돌파선을 자동 대조합니다.</small>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${pill(`감속기 ${ls.dd_scale === 1 ? 'OFF (1.00x)' : fmtNum(ls.dd_scale, 2) + 'x'}`, ls.dd_scale === 1 ? 'green' : 'amber')}
          ${pill(`목표 Vol $${fmtNum(selectedSetting === 'A' ? customVolM : (s.target_vol || 800000) / 1e6, 1)}M/yr`, 'blue')}
        </div>
      </div>
      ${
        actions.length
          ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px;padding:12px 14px;">
              ${actions
                .map((a) => {
                  const bcol = a.level === 'URGENT' ? '#dc2626' : a.level === 'WARN' ? '#d97706' : a.level === 'SIGNAL' ? '#0d9488' : '#2563eb';
                  const tagTxt = a.level === 'URGENT' ? '긴급 액션' : a.level === 'WARN' ? '청산 임박' : a.level === 'SIGNAL' ? '오늘 신규 진입' : '모니터링';
                  const tone = a.level === 'URGENT' ? 'red' : a.level === 'WARN' ? 'amber' : a.level === 'SIGNAL' ? 'green' : 'blue';
                  let extraLine = '';
                  let actionBtn = '';
                  if (a.action_type === 'OPEN_FX4' && a.c1 && a.c2 && a.raw_leg_1x) {
                    const legUsd = Math.round(Number(a.raw_leg_1x) * eff3);
                    const f1 = calcFxFut(a.c1, (a.s1 || 1) * legUsd, lo.fx_quotes?.[a.c1]?.live_spot);
                    const f2 = calcFxFut(a.c2, (a.s2 || -1) * legUsd, lo.fx_quotes?.[a.c2]?.live_spot);
                    extraLine = `<div style="margin-top:6px;padding:6px 8px;border-radius:7px;background:rgba(13,148,136,0.08);font-size:11.5px;font-weight:700;color:var(--ink);">
                      목표 규모(Vol $${fmtNum(selectedSetting === 'A' ? customVolM : (s.target_vol || 800000) / 1e6, 1)}M): 레그당 <b>${fmtM(legUsd, false)}</b> · FX선물 <b style="color:#0d9488;">${esc(f1.code)} ${fmtSigned(f1.ct, 0)} ct / ${esc(f2.code)} ${fmtSigned(f2.ct, 0)} ct</b>
                    </div>`;
                    actionBtn = `<div style="margin-top:8px;display:flex;justify-content:flex-end;">
                      <button type="button" class="btn primary a4-open-fx-pair"
                        data-c1="${esc(a.c1)}" data-c2="${esc(a.c2)}" data-s1="${a.s1 || 1}" data-s2="${a.s2 || -1}" data-mio="${(legUsd / 1e6).toFixed(2)}"
                        style="padding:5px 11px;font-size:11.5px;">신규 페어 등록 (${esc(a.pair)})</button>
                    </div>`;
                  } else if (a.action_type === 'OPEN_FUT' && a.core_id && a.raw_ct_1x) {
                    const tgtCt = Math.round(Number(a.raw_ct_1x) * eff1);
                    extraLine = `<div style="margin-top:6px;padding:6px 8px;border-radius:7px;background:rgba(13,148,136,0.08);font-size:11.5px;font-weight:700;color:var(--ink);">
                      목표 계약(Vol $${fmtNum(selectedSetting === 'A' ? customVolM : (s.target_vol || 800000) / 1e6, 1)}M): <b>${esc(a.core_id)} ${fmtSigned(tgtCt, 0)} ct</b>
                    </div>`;
                    actionBtn = `<div style="margin-top:8px;display:flex;justify-content:flex-end;">
                      <button type="button" class="btn primary a4-open-fut"
                        data-cid="${esc(a.core_id)}" data-ct="${tgtCt}"
                        style="padding:5px 11px;font-size:11.5px;">신규 선물 등록 (${esc(a.core_id)})</button>
                    </div>`;
                  }
                  return `<div style="border:1px solid var(--line);border-left:4px solid ${bcol};border-radius:10px;padding:10px 12px;background:var(--panel2);">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px;">
                      <span style="font-size:11px;font-weight:800;color:var(--muted);">${esc(a.engine)} · ${esc(a.instrument)}</span>
                      ${pill(tagTxt, tone)}
                    </div>
                    <div style="font-size:13px;font-weight:800;color:var(--ink);margin-bottom:3px;">${esc(a.title)}</div>
                    <div style="font-size:11.5px;color:var(--muted);line-height:1.45;">${esc(a.detail)}</div>
                    ${extraLine}
                    ${actionBtn}
                  </div>`;
                })
                .join('')}
            </div>`
          : `<div style="padding:14px 16px;font-size:12.5px;color:#0d9488;font-weight:700;">
              현재 긴급 손절·청산선 돌파 경보가 없습니다. 아래 모델 목표 vs 실보유(#book) 실행 주문표에서 미반영 주문만 점검하세요.
            </div>`
      }
    </div>

    <!-- 3. EXECUTION ORDER TICKET: MODEL TARGET VS #BOOK ACTUAL -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(490px,1fr));gap:14px;margin-bottom:14px;">
      <!-- 3A. US/DE FUTURES EXECUTION BOARD -->
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 style="margin:0;">국채선물 실행 주문표 (${is2E ? 'E1 단독 50%' : 'E1 + E2 네팅'})</h2>
            <small>독일 5Y(OE) 제외 · ±15% 이내 미세 변동은 집행 보류 (데드밴드)</small>
          </div>
          <span style="font-size:11.5px;font-weight:700;color:var(--muted);">총 |DV01| $${fmtNum(targetAbsDv01, 0)}</span>
        </div>
        <div class="table-scroll">
          <table class="wide-table" style="font-size:12px;">
            <thead>
              <tr>
                <th>종목 / 월물</th>
                <th class="number">BBG 실시간가</th>
                <th class="number">모델 목표</th>
                <th class="number">실보유 (#book)</th>
                <th class="number">실행 주문 (Delta)</th>
                <th>상태</th>
                <th style="text-align:right;">액션</th>
              </tr>
            </thead>
            <tbody>
              ${futExecRows
                .map((r) => {
                  const ordTxt =
                    r.delta_ct === 0
                      ? '<span class="muted">0 ct</span>'
                      : `<b class="${r.delta_ct > 0 ? 'green' : 'red'}">${r.delta_ct > 0 ? '매수 +' : '매도 '}${r.delta_ct} ct</b><div class="pair-sub">${fmtUsd(r.delta_dv01)}/bp</div>`;
                  const hasPos = r.pos_ids.length > 0;
                  return `<tr>
                    <td><b>${esc(r.cid)}</b> <span class="muted">${esc(r.contract)}</span><div class="pair-sub">${esc(r.name)}</div></td>
                    <td class="number"><b>${fmtNum(r.live_px, 3)}</b><div class="pair-sub ${clsVal(-(r.chg_bp || 0))}">${fmtSigned(r.chg_bp, 1)}bp (${fmtNum(r.live_yield_pct, 2)}%)</div></td>
                    <td class="number"><b class="${clsVal(r.target_ct)}">${fmtSigned(r.target_ct, 0)} ct</b>${!is2E ? `<div class="pair-sub">E1 ${fmtSigned(r.e1_ct, 1)} / E2 ${fmtSigned(r.e2_ct, 1)}</div>` : ''}</td>
                    <td class="number"><b>${fmtSigned(r.actual_ct, 0)} ct</b><div class="pair-sub">${fmtUsd(r.actual_dv01)}/bp</div></td>
                    <td class="number">${ordTxt}</td>
                    <td>${bandPill(r.band)}</td>
                    <td style="text-align:right;white-space:nowrap;">
                      <button type="button" class="btn ${r.delta_ct !== 0 ? 'primary' : 'quiet'} a4-open-fut" data-cid="${esc(r.cid)}" data-ct="${r.delta_ct || r.target_ct || -10}" style="padding:4px 9px;font-size:11px;">${r.delta_ct !== 0 ? '주문 등록' : '입력'}</button>
                      ${hasPos ? `<button type="button" class="btn quiet a4-close-pos" data-pid="${esc(r.pos_ids[0])}" style="padding:4px 8px;font-size:11px;margin-left:4px;">청산</button>` : ''}
                    </td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 3B. FX NETTED EXECUTION BOARD -->
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 style="margin:0;">FX 통화별 네팅 실행 주문표 (${is2E ? 'FX4 단독 50% · USD 중립' : 'E3 + E4 네팅'})</h2>
            <small>전일 뉴욕 종가 신규 신호 포함 · CME/KRX FX 선물 환산 계약수 동시 표기</small>
          </div>
          <span style="font-size:11.5px;font-weight:700;color:var(--muted);">Net USD ${fmtM(targetNetUsdLeg)}</span>
        </div>
        <div class="table-scroll">
          <table class="wide-table" style="font-size:12px;">
            <thead>
              <tr>
                <th>통화 / 선물</th>
                <th class="number">BBG 스팟 (%)</th>
                <th class="number">모델 목표 (선물)</th>
                <th class="number">실보유 (#book)</th>
                <th class="number">실행 주문 (Delta)</th>
                <th>상태</th>
                <th style="text-align:right;">액션</th>
              </tr>
            </thead>
            <tbody>
              ${fxExecRows
                .map((r) => {
                  const ftTgt = calcFxFut(r.ccy, r.target_usd, r.live_spot);
                  const ftAct = calcFxFut(r.ccy, r.actual_usd, r.live_spot);
                  const ftDlt = calcFxFut(r.ccy, r.delta_usd, r.live_spot);
                  const ordTxt =
                    Math.abs(r.delta_usd) < 50000
                      ? '<span class="muted">$0.00M (0 ct)</span>'
                      : `<b class="${r.delta_usd > 0 ? 'green' : 'red'}">${r.delta_usd > 0 ? 'LONG +' : 'SHORT '}${fmtM(r.delta_usd, false)}</b><div class="pair-sub"><b class="${clsVal(ftDlt.ct)}">${esc(ftDlt.code)} ${ftDlt.ct > 0 ? '매수 +' : '매도 '}${ftDlt.ct} ct</b></div>`;
                  const hasPos = r.pos_ids.length > 0;
                  return `<tr>
                    <td><b>${esc(r.ccy)}</b> <span class="muted">${esc(ftTgt.code)}</span><div class="pair-sub">1ct ≈ $${fmtNum(ftTgt.usdPerCt, 0)}</div></td>
                    <td class="number"><b>${fmtNum(r.live_spot, 4)}</b><div class="pair-sub ${clsVal(r.chg_pct)}">${fmtSigned(r.chg_pct, 2)}%</div></td>
                    <td class="number"><b class="${clsVal(r.target_usd)}">${fmtM(r.target_usd)}</b><div class="pair-sub">${esc(ftTgt.code)} <b>${fmtSigned(ftTgt.ct, 0)} ct</b>${!is2E ? ` (E3 ${fmtM(r.e3_usd)})` : ''}</div></td>
                    <td class="number"><b>${fmtM(r.actual_usd)}</b><div class="pair-sub">${fmtSigned(ftAct.ct, 0)} ct</div></td>
                    <td class="number">${ordTxt}</td>
                    <td>${bandPill(r.band)}</td>
                    <td style="text-align:right;white-space:nowrap;">
                      <button type="button" class="btn ${Math.abs(r.delta_usd) >= 50000 ? 'primary' : 'quiet'} a4-open-fx-single"
                        data-ccy="${esc(r.ccy)}" data-side="${r.delta_usd >= 0 ? 1 : -1}" data-mio="${(Math.abs(r.delta_usd || r.target_usd) / 1e6).toFixed(2)}"
                        style="padding:4px 9px;font-size:11px;">FX 등록</button>
                      ${hasPos ? `<button type="button" class="btn quiet a4-close-pos" data-pid="${esc(r.pos_ids[0])}" style="padding:4px 8px;font-size:11px;margin-left:4px;">청산</button>` : ''}
                    </td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 4. CORE 2-ENGINE LIVE MONITORING PANELS (SIDE-BY-SIDE) -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(490px,1fr));gap:14px;margin-bottom:14px;">
      <!-- ENGINE 1: US/DE OUTRIGHT RATES -->
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 style="margin:0;">엔진 ① US/DE 국채 방향성 (${is2E ? '50%' : '30%'} · 실효 ${fmtNum(eff1, 2)}x)</h2>
            <small>10→20D 돌파 · 50D 채널 & 8σ 트레일링 청산선까지 남은 여유 실시간 감시</small>
          </div>
        </div>
        <div class="table-scroll">
          <table class="wide-table" style="font-size:11.8px;">
            <thead>
              <tr>
                <th>종목</th>
                <th class="number">CTA (합의)</th>
                <th class="number">BBG가 (등락)</th>
                <th>보유 / 청산선 여유</th>
                <th class="number">목표 계약</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              ${(le.e1_rows || [])
                .map((r) => {
                  const op = r.open;
                  const tgtCt = op ? Math.round(op.raw_ct_1x * eff1) : 0;
                  let exitBar = `<span class="muted">10D [${fmtNum(r.ch10?.[0], 2)} ~ ${fmtNum(r.ch10?.[1], 2)}]</span>`;
                  if (op) {
                    const sig = Number(op.dist_exit_sig ?? 4.0);
                    const bp = Number(op.dist_exit_bp ?? 0);
                    const pct = Math.min(100, Math.max(4, (sig / 8.0) * 100));
                    const bcol = sig <= 0 ? '#dc2626' : sig <= 1.5 ? '#d97706' : '#0d9488';
                    exitBar = `
                      <div style="font-size:11px;"><b>${esc(op.side)}</b> (${op.hd}d · S${op.stage}) · 여유 <b style="color:${bcol};">${fmtNum(sig, 1)}σ (${fmtNum(bp, 1)}bp)</b></div>
                      <div style="height:5px;background:var(--line);border-radius:99px;overflow:hidden;margin-top:3px;max-width:170px;">
                        <div style="width:${pct.toFixed(0)}%;height:100%;background:${bcol};"></div>
                      </div>`;
                  }
                  return `<tr>
                    <td><b>${esc(r.cid)}</b> <span class="muted">${esc(r.contract || '')}</span></td>
                    <td class="number"><b class="${clsVal(r.cta)}">${fmtSigned(r.cta, 2)}</b> <span class="muted">(${r.agree}/6)</span></td>
                    <td class="number">${fmtNum(r.live_px, 3)}<div class="pair-sub ${clsVal(-(r.chg_bp || 0))}">${fmtSigned(r.chg_bp, 1)}bp</div></td>
                    <td>${exitBar}</td>
                    <td class="number"><b class="${clsVal(tgtCt)}">${tgtCt ? fmtSigned(tgtCt, 0) + ' ct' : '—'}</b></td>
                    <td>${liveStatusPill(r.live_status)}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- ENGINE 2 (FX4): RATES-ADJUSTED POSITIVE-CARRY MR -->
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 style="margin:0;">엔진 ② FX4 평균회귀 · 실BBG 캐리 (${is2E ? '50%' : '35%'} · 실효 ${fmtNum(eff3, 2)}x)</h2>
            <small>보유 ${le.e3_open?.length || 0}/6 페어 · 순베타 ${fmtNum(e3m.net_beta, 1)} / 2.0 · 2Y OLS 회귀 + 3M Forward 캐리 ≥ +1.0%</small>
          </div>
        </div>
        <div class="table-scroll">
          <table class="wide-table" style="font-size:11.8px;">
            <thead>
              <tr>
                <th>보유 페어</th>
                <th>실시간 2F-Z 게이지 (익절 0.2 ← 현재 → 손절 4.0)</th>
                <th class="number">3M 캐리</th>
                <th class="number">목표 레그</th>
                <th>상태</th>
                <th style="text-align:right;">액션</th>
              </tr>
            </thead>
            <tbody>
              ${(le.e3_open || [])
                .map((op) => {
                  const lz = Number(op.live_z ?? op.cur_z ?? 0);
                  const absZ = Math.abs(lz);
                  const pct = Math.min(100, Math.max(3, (absZ / 4.0) * 100));
                  const zcol = absZ <= 0.35 ? '#0d9488' : absZ >= 3.5 ? '#dc2626' : '#2563eb';
                  const legUsd = Math.round((op.raw_leg_1x || 0) * eff3);
                  const [c1, c2] = op.pair.split('/');
                  const f1 = calcFxFut(c1, (op.s1 || 1) * legUsd, lo.fx_quotes?.[c1]?.live_spot);
                  const f2 = calcFxFut(c2, (op.s2 || -1) * legUsd, lo.fx_quotes?.[c2]?.live_spot);
                  const isNew = Boolean(op.new_today);
                  return `<tr style="${isNew ? 'background:rgba(13,148,136,0.07);' : ''}">
                    <td><b>${esc(op.pair)}</b><div class="pair-sub">${esc(op.side)} · ${isNew ? '오늘 아침 신규(0d)' : `${op.hd}d`}</div></td>
                    <td>
                      <div style="font-size:11px;">진입 ${fmtSigned(op.entry_z, 2)}σ → <b style="color:${zcol};">실시간 ${fmtSigned(lz, 2)}σ</b></div>
                      <div style="height:5px;background:var(--line);border-radius:99px;overflow:hidden;margin-top:3px;max-width:170px;">
                        <div style="width:${pct.toFixed(0)}%;height:100%;background:${zcol};"></div>
                      </div>
                    </td>
                    <td class="number"><b class="green">+${fmtNum(op.carry_pct, 2)}%</b></td>
                    <td class="number"><b>${fmtM(legUsd, false)}</b><div class="pair-sub">${esc(f1.code)} ${fmtSigned(f1.ct, 0)} / ${esc(f2.code)} ${fmtSigned(f2.ct, 0)} ct</div></td>
                    <td>${liveStatusPill(op.live_status)}</td>
                    <td style="text-align:right;">
                      <button type="button" class="btn ${isNew ? 'primary' : 'quiet'} a4-open-fx-pair"
                        data-c1="${esc(c1)}" data-c2="${esc(c2)}" data-s1="${op.s1 || 1}" data-s2="${op.s2 || -1}" data-mio="${(legUsd / 1e6).toFixed(2)}"
                        style="padding:3px 8px;font-size:11px;">${isNew ? '신규 등록' : '페어 등록'}</button>
                    </td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        ${
          (le.e3_candidates || []).filter((c) => c.status !== 'OPEN').length
            ? `<div style="padding:8px 14px 12px;border-top:1px solid var(--line);">
                <div style="font-size:11px;font-weight:800;color:var(--muted);margin-bottom:6px;">관찰 · 쿨다운 · 베타캡 대기 상위 후보</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                  ${(le.e3_candidates || [])
                    .filter((c) => c.status !== 'OPEN')
                    .slice(0, 6)
                    .map(
                      (c) => `<span style="font-size:11px;padding:3px 8px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);">
                        <b>${esc(c.pair)}</b> Z ${fmtSigned(c.z, 2)} · 캐리 ${fmtSigned(c.carry_pct, 1)}% · ${liveStatusPill(c.status)}
                      </span>`
                    )
                    .join('')}
                </div>
              </div>`
            : ''
        }
      </div>
    </div>

    <!-- 5. REGISTERED #BOOK OPEN POSITIONS TRACKER -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2 style="margin:0;">현재 등록된 실보유 북 (#book 실시간 연동 · ${openPositions.length}건)</h2>
          <small>위 주문표에서 [주문 등록] · [FX 등록] · [페어 등록]으로 입력한 포지션이 실시간 추적됩니다.</small>
        </div>
        <button type="button" class="btn quiet" id="a4-goto-book">포지션 모니터(#book) 전체 보기</button>
      </div>
      ${
        openPositions.length
          ? `<div class="table-scroll">
              <table class="wide-table" style="font-size:12px;">
                <thead><tr><th>포지션</th><th>전략</th><th>진입일</th><th class="number">현재 규모</th><th class="number">미실현 손익 (USD)</th><th>상태</th><th style="text-align:right;">액션</th></tr></thead>
                <tbody>
                  ${openPositions
                    .map((p) => {
                      const szTxt =
                        p.asset_class === 'Rates'
                          ? p.contracts
                            ? `${p.side1 > 0 ? '+' : '−'}${p.contracts} ct`
                            : `${fmtUsd(p.side1 * p.current_leg1_size)}/bp`
                          : `${fmtM(p.side1 * p.current_leg1_size)}${p.leg2 ? ` / ${fmtM(p.side2 * p.current_leg2_size)}` : ''}`;
                      return `<tr>
                        <td><b>${esc(p.name)}</b><div class="pair-sub">${esc(p.notes || '')}</div></td>
                        <td>${pill(p.strategy, 'dark')}</td>
                        <td>${esc(p.entry_date || '—')}</td>
                        <td class="number"><b>${szTxt}</b></td>
                        <td class="number"><b class="${clsVal(p.unrealized_usd)}">${fmtUsd(p.unrealized_usd)}</b></td>
                        <td>${liveStatusPill(p.monitor)}</td>
                        <td style="text-align:right;">
                          <button type="button" class="btn quiet a4-close-pos" data-pid="${esc(p.id)}" style="padding:4px 9px;font-size:11px;">부분/전량 청산</button>
                        </td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>`
          : `<div style="padding:18px;text-align:center;color:var(--muted);font-size:12.5px;">
              현재 #book에 등록된 오픈 포지션이 없습니다. 위 <b>국채선물 / FX 실행 주문표</b>에서 <b>[주문 등록]</b>을 클릭해 실거래를 등록하세요.
            </div>`
      }
    </div>`;
}

// =========================================================================
// VIEW 2: 26-YEAR HISTORICAL REGIME SIMILARITY (싱크로율 TOP 8)
// =========================================================================
function renderAnalogView(data) {
  const an = data.analog_analysis;
  if (!an || !an.top8?.length) {
    return '<div class="panel" style="padding:20px;">싱크로율 분석 데이터가 없습니다. build_active_4e_snapshot.py를 실행하세요.</div>';
  }
  const sum = an.summary || {};
  const top8 = an.top8;
  const sel = top8.find((x) => x.rank === selectedAnalogRank) || top8[0];

  return `
    <!-- A. CURRENT REGIME 16-FACTOR DNA -->
    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-head">
        <div>
          <h2 style="margin:0;">현재 FICC 국면 DNA (${esc(an.window_60d)} · 직전 60영업일)</h2>
          <small>26년 전체(2001~2026) 16개 금리·커브·FX·변동성·주식 팩터를 표준화해 방향(55%) + 강도(45%) 종합 싱크로율을 계산합니다.</small>
        </div>
        ${pill(`기준일 ${an.as_of}`, 'blue')}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px 14px;">
        ${(an.current_factors || [])
          .map((f) => {
            const z = Number(f.z26 || 0);
            const tone = Math.abs(z) >= 1.0 ? (z > 0 ? '#dc2626' : '#2563eb') : 'var(--ink)';
            return `<div style="border:1px solid var(--line);border-radius:8px;padding:6px 10px;background:var(--panel2);min-width:118px;">
              <div style="font-size:10.5px;color:var(--muted);font-weight:700;">${esc(f.name)}</div>
              <div style="font-size:13px;font-weight:900;color:${tone};margin-top:2px;">${fmtSigned(f.val, 1)}${esc(f.unit)} <span style="font-size:10.5px;font-weight:600;color:var(--muted);">(${fmtSigned(z, 1)}σ)</span></div>
            </div>`;
          })
          .join('')}
      </div>
    </div>

    <!-- B. TOP 8 SUMMARY KPI STRIP -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:14px;">
      <div class="panel" style="padding:13px 15px;border-left:4px solid #0d9488;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">TOP 8 직후 3개월 2엔진 평균</div>
        <div style="font-size:21px;font-weight:900;margin:4px 0;" class="${clsVal(sum.avg_3m)}">${fmtUsd(sum.avg_3m)}</div>
        <div style="font-size:11.5px;color:var(--muted);">중앙값 <b>${fmtUsd(sum.med_3m)}</b> · 승률 <b>${sum.win_3m}/8</b> (vs 4엔진 ${fmtK(sum.avg_w4_3m)})</div>
      </div>
      <div class="panel" style="padding:13px 15px;border-left:4px solid #2563eb;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">해당월 & 직후 1개월(M+1) 성과</div>
        <div style="font-size:21px;font-weight:900;margin:4px 0;" class="${clsVal(sum.avg_m1)}">M+1 ${fmtUsd(sum.avg_m1)}</div>
        <div style="font-size:11.5px;color:var(--muted);">M+1 승률 <b>${sum.win_m1}/8</b> · 해당월 평균 ${fmtK(sum.avg_same_month)} (${sum.win_same_month}/8승)</div>
      </div>
      <div class="panel" style="padding:13px 15px;border-left:4px solid #475569;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">2엔진 3M 기여 & 평균 3M MDD</div>
        <div style="font-size:20px;font-weight:900;margin:4px 0;">E1 ${fmtK(sum.avg_e1_3m)} · FX4 ${fmtK(sum.avg_e3_3m)}</div>
        <div style="font-size:11.5px;color:var(--muted);">평균 3개월 최대낙폭 <b class="red">−${fmtUsd(sum.avg_mdd_3m, false)}</b></div>
      </div>
      <div class="panel" style="padding:13px 15px;border-left:4px solid #d97706;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">직후 3개월 시장 공통 경향</div>
        <div style="font-size:20px;font-weight:900;margin:4px 0;">10Y 하락 ${sum.cnt_us10_down}/8 · 플랫 ${sum.cnt_flattening}/8</div>
        <div style="font-size:11.5px;color:var(--muted);">US10Y 중앙 <b>${fmtSigned(sum.med_us10_3m_bp, 0)}bp</b> · 2s10s 평균 <b>${fmtSigned(sum.avg_slp_3m_bp, 0)}bp</b></div>
      </div>
    </div>

    <!-- C. 60-DAY CUMULATIVE TRAJECTORY SVG -->
    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-head">
        <div>
          <h2 style="margin:0;">TOP 8 유사 국면 직후 60영업일(3개월) 2엔진 누적 손익 궤적</h2>
          <small>아래 표에서 국면을 클릭하면 파란색 강조선과 하단 상세 해부 카드가 즉시 전환됩니다. (Vol $0.8M · 세팅 A 기준)</small>
        </div>
      </div>
      <div style="padding:10px 14px 14px;">${renderAnalogTrajectoriesSvg(an, sel.rank)}</div>
    </div>

    <!-- D. TOP 8 MASTER TABLE -->
    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-head">
        <div>
          <h2 style="margin:0;">과거 고(高)싱크로율 TOP 8 국면 — 당시 2엔진 포지션 · 해당월 성과 · 직후 3개월 변화</h2>
          <small>최소 4개월(80영업일) 이상 떨어진 독립 국면만 추출 · 행 클릭 시 상세 분석</small>
        </div>
      </div>
      <div class="table-scroll">
        <table class="wide-table" style="font-size:11.8px;">
          <thead>
            <tr>
              <th>순위 / 과거 국면</th>
              <th class="number">종합 싱크로 (금리/FX)</th>
              <th>당시 2엔진 보유 포지션 (E1 + FX4)</th>
              <th class="number">해당월 성과</th>
              <th class="number">M+1</th>
              <th class="number">M+2</th>
              <th class="number">M+3</th>
              <th class="number">직후 3M 합계 (MDD)</th>
              <th class="number">3M 시장 (10Y/2s10s/USD)</th>
            </tr>
          </thead>
          <tbody>
            ${top8
              .map((t) => {
                const isSel = t.rank === sel.rank;
                const e1Txt = (t.positions_2e?.e1 || []).join(', ') || '없음';
                const fxTxt = (t.positions_2e?.fx4_pairs || []).slice(0, 2).join(', ') + ((t.positions_2e?.fx4_pairs || []).length > 2 ? ` 외 ${(t.positions_2e.fx4_pairs.length - 2)}개` : '');
                const m1 = t.fwd_months?.[0]?.pnl || 0;
                const m2 = t.fwd_months?.[1]?.pnl || 0;
                const m3 = t.fwd_months?.[2]?.pnl || 0;
                return `<tr class="a4-analog-row" data-rank="${t.rank}" style="cursor:pointer;${isSel ? 'background:rgba(37,99,235,0.09);outline:1.5px solid #2563eb;' : ''}">
                  <td>
                    <b>#${t.rank} · ${esc(t.ym)}</b> <span class="muted">(${esc(t.date)})</span>
                    <div class="pair-sub">${esc(t.tag)}</div>
                  </td>
                  <td class="number">
                    <b style="font-size:13px;color:#2563eb;">${fmtNum(t.sim_all, 1)}%</b>
                    <div class="pair-sub">금리 ${fmtNum(t.sim_rates, 0)}% · FX ${fmtNum(t.sim_fx, 0)}%</div>
                  </td>
                  <td style="max-width:250px;">
                    <div style="font-size:11px;"><b>E1:</b> ${esc(e1Txt)}</div>
                    <div style="font-size:11px;color:var(--muted);"><b>FX4 (${t.positions_2e?.fx4_pairs?.length || 0}):</b> ${esc(fxTxt || '무포지션')}</div>
                  </td>
                  <td class="number">
                    <b class="${clsVal(t.same_month?.pnl)}">${fmtK(t.same_month?.pnl)}</b>
                    <div class="pair-sub">E1 ${fmtK(t.same_month?.e1)} / FX ${fmtK(t.same_month?.e3)}</div>
                  </td>
                  <td class="number ${clsVal(m1)}">${fmtK(m1)}</td>
                  <td class="number ${clsVal(m2)}">${fmtK(m2)}</td>
                  <td class="number ${clsVal(m3)}">${fmtK(m3)}</td>
                  <td class="number">
                    <b class="${clsVal(t.fwd_3m?.pnl)}" style="font-size:12.5px;">${fmtK(t.fwd_3m?.pnl)}</b>
                    <div class="pair-sub red">MDD −${fmtK(t.fwd_3m?.mdd, false)}</div>
                  </td>
                  <td class="number">
                    <span>${fmtSigned(t.fwd_3m?.us10_bp, 0)}bp / ${fmtSigned(t.fwd_3m?.slp_bp, 0)}bp</span>
                    <div class="pair-sub">USD ${fmtSigned(t.fwd_3m?.usd_pct, 1)}% · W4 ${fmtK(t.fwd_3m?.w4_pnl)}</div>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- E. SELECTED ANALOG DEEP DIVE CARD -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2 style="margin:0;">선택 국면 상세 해부 — #${sel.rank} · ${esc(sel.date)} (${esc(sel.tag)} · 싱크로율 ${fmtNum(sel.sim_all, 1)}%)</h2>
          <small>당시 레벨: US2Y ${fmtNum(sel.levels?.us2, 2)}% · US10Y ${fmtNum(sel.levels?.us10, 2)}% · DE2Y ${fmtNum(sel.levels?.de2, 2)}% · 2s10s ${fmtSigned(sel.levels?.us_2s10s, 0)}bp · MOVE ${fmtNum(sel.levels?.move, 0)} · EUR ${fmtNum(sel.levels?.eur, 3)} · JPY ${fmtNum(sel.levels?.jpy, 1)} · AUD ${fmtNum(sel.levels?.aud, 3)} · KRW ${fmtNum(sel.levels?.krw, 0)}</small>
        </div>
        ${pill((sel.fwd_3m?.pnl || 0) >= 0 ? '3M 흑자 전개' : '3M 조정 전개', (sel.fwd_3m?.pnl || 0) >= 0 ? 'green' : 'red')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;padding:12px 14px;">
        <div style="border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--panel2);">
          <div style="font-size:12px;font-weight:800;margin-bottom:8px;">당시 2엔진 실제 보유 포지션 & 해당월(${esc(sel.same_month?.ym)}) 성과</div>
          <div style="font-size:12px;line-height:1.7;">
            <div><b>① E1 국채 방향성:</b> ${esc((sel.positions_2e?.e1 || []).join(' · ') || '무포지션')}</div>
            <div><b>② FX4 평균회귀</b> (Stress ${fmtNum(sel.positions_2e?.fx4_stress, 2)} · ${sel.positions_2e?.fx4_allow ? '허용' : '중단'}):<br>
              <span class="muted">${esc((sel.positions_2e?.fx4_pairs || []).join(' · ') || '무포지션')}</span>
            </div>
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line);">
              <b>해당월(${esc(sel.same_month?.ym)}) 2엔진 손익:</b>
              <b class="${clsVal(sel.same_month?.pnl)}">${fmtUsd(sel.same_month?.pnl)}</b>
              (E1 ${fmtK(sel.same_month?.e1)} / FX4 ${fmtK(sel.same_month?.e3)} · 월중 DD −${fmtK(sel.same_month?.mdd, false)})
            </div>
          </div>
        </div>

        <div style="border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--panel2);">
          <div style="font-size:12px;font-weight:800;margin-bottom:8px;">직후 3개월 (M+1 / M+2 / M+3) 시장 궤적 & 2엔진 월별 성과</div>
          <table class="wide-table" style="font-size:11.5px;">
            <thead><tr><th>구간</th><th class="number">US2Y/10Y</th><th class="number">2s10s</th><th class="number">USD/SPX</th><th class="number">2엔진 손익</th><th class="number">E1 / FX4</th></tr></thead>
            <tbody>
              ${(sel.fwd_months || [])
                .map(
                  (fm) => `<tr>
                    <td><b>${esc(fm.m)}</b> <span class="muted">${esc(fm.span)}</span></td>
                    <td class="number">${fmtSigned(fm.us2_bp, 0)} / ${fmtSigned(fm.us10_bp, 0)}bp</td>
                    <td class="number">${fmtSigned(fm.slp_bp, 0)}bp</td>
                    <td class="number">${fmtSigned(fm.usd_pct, 1)}% / ${fmtSigned(fm.spx_pct, 1)}%</td>
                    <td class="number"><b class="${clsVal(fm.pnl)}">${fmtK(fm.pnl)}</b></td>
                    <td class="number">${fmtK(fm.e1)} / ${fmtK(fm.e3)}</td>
                  </tr>`
                )
                .join('')}
              <tr style="font-weight:800;border-top:1.5px solid var(--line);">
                <td>3M 합계</td>
                <td class="number">${fmtSigned(sel.fwd_3m?.us2_bp, 0)} / ${fmtSigned(sel.fwd_3m?.us10_bp, 0)}bp</td>
                <td class="number">${fmtSigned(sel.fwd_3m?.slp_bp, 0)}bp</td>
                <td class="number">USD ${fmtSigned(sel.fwd_3m?.usd_pct, 1)}%</td>
                <td class="number ${clsVal(sel.fwd_3m?.pnl)}">${fmtK(sel.fwd_3m?.pnl)}</td>
                <td class="number">${fmtK(sel.fwd_3m?.e1)} / ${fmtK(sel.fwd_3m?.e3)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// =========================================================================
// VIEW 3: PERFORMANCE & MONTHLY ANALYSIS
// =========================================================================
function renderPerfView(data, s) {
  const s5 = s.summary_5y || {};
  const s11 = s.summary_11y || {};
  const s26 = s.summary_26y || {};
  const m5 = s.monthly_5y || [];
  const ann11 = s.annual_11y || [];
  const ann26 = s.annual_26y || [];
  const regs = s.regimes_26y || [];
  const corr = data.corr_matrix || {};
  const is2E = (s.weights?.[1] || 0) === 0 && (s.weights?.[3] || 0) === 0;

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:14px;">
      <div class="panel" style="padding:13px 15px;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">최근 5년 (2022~2026)</div>
        <div style="font-size:21px;font-weight:900;margin:4px 0;" class="green">${fmtM(s5.tot)} <span style="font-size:13px;color:var(--muted);">Shp ${fmtNum(s5.shp, 2)}</span></div>
        <div style="font-size:11.5px;color:var(--muted);">MDD ${fmtM(-s5.mdd)} · 월승률 <b>${fmtNum(s5.win_m_pct, 1)}%</b> (${s5.pos_m}/${s5.tot_m}) · ${s5.pos_y}/${s5.tot_y}년 흑자</div>
      </div>
      <div class="panel" style="padding:13px 15px;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">11.1년 실선물 (2015~2026)</div>
        <div style="font-size:21px;font-weight:900;margin:4px 0;">${fmtK(s11.ann)}/y <span style="font-size:13px;color:var(--muted);">Shp ${fmtNum(s11.shp, 2)}</span></div>
        <div style="font-size:11.5px;color:var(--muted);">누적 ${fmtM(s11.tot)} · MDD ${fmtM(-s11.mdd)} · 월승률 ${fmtNum(s11.win_m_pct, 1)}%</div>
      </div>
      <div class="panel" style="padding:13px 15px;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">26년 장기 (2001~2026)</div>
        <div style="font-size:21px;font-weight:900;margin:4px 0;">${fmtK(s26.ann)}/y <span style="font-size:13px;color:var(--muted);">Shp ${fmtNum(s26.shp, 2)}</span></div>
        <div style="font-size:11.5px;color:var(--muted);">누적 ${fmtM(s26.tot)} · MDD ${fmtM(-s26.mdd)} · ${s26.pos_y}/${s26.tot_y}년 흑자</div>
      </div>
      <div class="panel" style="padding:13px 15px;">
        <div style="font-size:11px;font-weight:700;color:var(--muted);">실현 변동성 · 거래 빈도</div>
        <div style="font-size:21px;font-weight:900;margin:4px 0;">${fmtM(s11.ann_vol, false)}/yr</div>
        <div style="font-size:11.5px;color:var(--muted);">연 약 ${fmtNum(data.meta?.trades_per_year, 1)}건 거래 · 가동 정지일 ${s11.stop_days ?? 0}일</div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-head">
        <div>
          <h2 style="margin:0;">최근 5년(59개월) 누적 손익 곡선 — 2엔진 50/50 vs 4엔진 W4 비교</h2>
          <small>${esc(s.desc || '')}</small>
        </div>
        <button type="button" class="btn quiet" id="a4-csv-59m">59개월 월간 CSV 다운로드</button>
      </div>
      <div style="padding:10px 14px 14px;">${renderMonthlyEquitySvg(data, selectedSetting)}</div>
    </div>

    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-head">
        <h2 style="margin:0;">연도별 · 9대 매크로 국면별 성과</h2>
        <div class="segmented">
          <button type="button" data-perf-p="11Y" class="${perfPeriod === '11Y' ? 'on' : ''}">11.1년 실선물</button>
          <button type="button" data-perf-p="26Y" class="${perfPeriod === '26Y' ? 'on' : ''}">26년 장기</button>
          <button type="button" data-perf-p="REGIMES" class="${perfPeriod === 'REGIMES' ? 'on' : ''}">9대 매크로 국면</button>
        </div>
      </div>
      <div class="table-scroll">
        ${
          perfPeriod === 'REGIMES'
            ? `<table class="wide-table" style="font-size:12px;">
                <thead><tr><th>매크로 국면</th><th class="number">누적 손익</th><th class="number">연평균 손익</th><th class="number">Sharpe</th><th class="number">구간 MDD</th></tr></thead>
                <tbody>${regs.map((r) => `<tr><td><b>${esc(r.label)}</b></td><td class="number ${clsVal(r.tot)}"><b>${fmtUsd(r.tot)}</b></td><td class="number ${clsVal(r.ann)}">${fmtUsd(r.ann)}</td><td class="number"><b>${fmtSigned(r.shp, 2)}</b></td><td class="number red">${fmtUsd(-r.mdd)}</td></tr>`).join('')}</tbody>
              </table>`
            : `<table class="wide-table" style="font-size:12px;">
                <thead><tr><th>연도</th><th>구간</th><th class="number">합산 손익</th><th class="number">연중 DD</th><th class="number">E1 국채방향</th><th class="number">FX4 평균회귀</th>${!is2E ? '<th class="number">E2 커브</th><th class="number">E4 FX돌파</th>' : ''}</tr></thead>
                <tbody>${(perfPeriod === '11Y' ? ann11 : ann26).slice().reverse().map((r) => `<tr>
                  <td><b>${esc(r.year)}</b></td><td>${pill(r.period, r.period === '5Y' ? 'blue' : 'neutral')}</td>
                  <td class="number ${clsVal(r.pnl)}"><b>${fmtUsd(r.pnl)}</b></td>
                  <td class="number red">${fmtUsd(-r.yr_dd)}</td>
                  <td class="number ${clsVal(r.e1)}">${fmtK(r.e1)}</td>
                  <td class="number ${clsVal(r.e3)}">${fmtK(r.e3)}</td>
                  ${!is2E ? `<td class="number ${clsVal(r.e2)}">${fmtK(r.e2)}</td><td class="number ${clsVal(r.e4)}">${fmtK(r.e4)}</td>` : ''}
                </tr>`).join('')}</tbody>
              </table>`
        }
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:14px;">
      <div class="panel">
        <div class="panel-head"><h2 style="margin:0;">최근 59개월 월간 손익표 (최신순)</h2></div>
        <div class="table-scroll" style="max-height:360px;overflow-y:auto;">
          <table class="wide-table" style="font-size:11.8px;">
            <thead><tr><th>연월</th><th class="number">월간 손익</th><th class="number">누적 손익</th><th class="number">E1 국채</th><th class="number">FX4 회귀</th></tr></thead>
            <tbody>${m5.slice().reverse().map((r) => `<tr>
              <td><b>${esc(r.ym)}</b></td>
              <td class="number ${clsVal(r.pnl)}"><b>${fmtK(r.pnl)}</b></td>
              <td class="number">${fmtM(r.cum)}</td>
              <td class="number ${clsVal(r.e1)}">${fmtK(r.e1)}</td>
              <td class="number ${clsVal(r.e3)}">${fmtK(r.e3)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2 style="margin:0;">엔진 상관관계 매트릭스 (26년 일간 · E1 vs FX4 = −0.02)</h2></div>
        <div class="table-scroll">
          <table class="wide-table" style="font-size:12px;">
            <thead><tr><th>엔진</th>${(corr.labels || []).map((l) => `<th class="number">${esc(l)}</th>`).join('')}</tr></thead>
            <tbody>${(corr.matrix_26y || corr.c26 || []).map((row, i) => `<tr><td><b>${esc(corr.labels?.[i] || '')}</b></td>${row.map((v, j) => `<td class="number" style="font-weight:${i === j ? 800 : 600};">${fmtNum(v, 2)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// =========================================================================
// VIEW 4 & 5: RULES & AUDIT
// =========================================================================
function renderRulesView(data) {
  const m = data.meta || {};
  return `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2 style="margin:0;">2엔진 50/50 확정 전략 룰북 (E1 국채방향 50% + FX4 평균회귀 50%)</h2>
          <small>${esc(m.carry_source || '')}</small>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;padding:14px;">
        <div style="border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--panel2);">
          <div style="font-weight:900;font-size:13.5px;margin-bottom:6px;">엔진 ① US/DE 국채 방향성 추세돌파 (50%)</div>
          <ul style="margin:0;padding-left:16px;font-size:12px;line-height:1.7;color:var(--muted);">
            <li><b>유니버스</b>: TU, FV, UXY, DU, RX (미 10Y는 Ultra 10Y UXY 적용 · 독일 5Y OE 제외 · US 1개 + DE 1개 대표 만기)</li>
            <li><b>진입</b>: CTA_RECIPE2 (W7) · 4/6 합의 · |CTA| ≥ 0.35 · 10D 돌파 1/3 → 20D 돌파 2/3 추가</li>
            <li><b>청산</b>: 50D 채널 이탈 · 7σ 하드스탑 · 8σ 트레일링 · CTA 반전(-0.20)</li>
            <li><b>역할</b>: 중앙은행 금리 사이클·대형 위기(2016·2019·2020·2022) 수익 창출</li>
          </ul>
        </div>
        <div style="border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--panel2);">
          <div style="font-weight:900;font-size:13.5px;margin-bottom:6px;">엔진 ② FX4 평균회귀 + 실BBG 3M 캐리 (50%)</div>
          <ul style="margin:0;padding-left:16px;font-size:12px;line-height:1.7;color:var(--muted);">
            <li><b>적정가 모델</b>: 10통화 45페어 · 직전 70D 2요인 OLS (실제 BBG 2Y 국채금리차 + Ridge 안정화)</li>
            <li><b>필터</b>: 2.4 ≤ |2F-Z| &lt; 3.85 · 실제 BBG 3M Forward/NDF 캐리 ≥ +1.0%/yr · 기대엣지 ≥ 8배</li>
            <li><b>방어</b>: 최대 6페어 · 통화당 2개 · |Net Beta| ≤ 2.0 · S4 스트레스 ≥ 1.25 중단(0.35x) · TP 0.2σ / 손절 4.0σ·-$20k</li>
            <li><b>역할</b>: 100% USD 중립 · 금리 박스권·고금리차 장세(2023~2026) 안정적 현금흐름</li>
          </ul>
        </div>
        <div style="border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--panel2);">
          <div style="font-weight:900;font-size:13.5px;margin-bottom:6px;">2단계 변동성 타깃팅 & 실무 집행 룰</div>
          <ul style="margin:0;padding-left:16px;font-size:12px;line-height:1.7;color:var(--muted);">
            <li><b>목표 변동성</b>: 연 $0.8M (일간 1σ 약 $50k · 세팅 A 외부 감속기 OFF · 순수 선형 구조)</li>
            <li><b>제외 항목</b>: E2(커브 추세) · E4(FX 추세돌파) 제거로 구조 단순화 및 피크아웃 반전 손실 대폭 축소</li>
            <li><b>실무 리밸런싱</b>: 진입 시점 최신 Vol 배율 적용 · 보유 중 ±15% 밴드 이내 변동 무시</li>
          </ul>
        </div>
      </div>
    </div>`;
}

function renderAuditView(data) {
  const st = data.stress_table || [];
  return `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2 style="margin:0;">거래비용 스트레스(1.5x / 2.0x) 및 청산 파라미터 고원(40D / 60D) 검증</h2>
          <small>2엔진 50/50 (세팅 A · Vol $0.8M) 기준 26년 및 11.1년 실선물 강건성 검증 결과입니다.</small>
        </div>
      </div>
      <div class="table-scroll">
        <table class="wide-table" style="font-size:12px;">
          <thead><tr><th>테스트 시나리오</th><th class="number">26Y Sharpe</th><th class="number">11.1Y Sharpe</th><th class="number">5Y 총손익</th><th class="number">11.1Y MDD</th><th>판정</th></tr></thead>
          <tbody>${st.map((r) => `<tr>
            <td><b>${esc(r.label)}</b></td>
            <td class="number"><b>${fmtNum(r.shp_26y ?? r.a_26_shp, 2)}</b></td>
            <td class="number"><b>${fmtNum(r.shp_11y ?? r.a_11_shp, 2)}</b></td>
            <td class="number ${clsVal(r.tot_5y)}">${r.tot_5y != null ? fmtM(r.tot_5y) : '—'}</td>
            <td class="number red">${r.mdd_11y != null ? fmtM(-r.mdd_11y) : '—'}</td>
            <td>${pill(r.verdict || '통과', 'green')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// =========================================================================
// MAIN RENDER ENTRYPOINT
// =========================================================================
export async function renderMomentumStrategy(target) {
  if (!target) return;
  if (!a4Data) {
    target.innerHTML = '<div class="panel" style="padding:28px;text-align:center;"><div class="spinner" style="margin:0 auto 12px;"></div><b>2엔진 50/50 실시간 운용 콕핏을 불러오는 중입니다...</b></div>';
  }
  const data = await fetchActive4ePayload(false);
  if (!data || data.error) {
    target.innerHTML = `<div class="panel" style="padding:20px;color:#dc2626;"><b>데이터 오류:</b> ${esc(data?.error || '스냅샷을 불러올 수 없습니다.')}</div>`;
    return;
  }

  const s = data.settings?.[selectedSetting] || data.settings?.A;
  const lo = data.live_overlay || {};
  const scaleMul = getLinearVolScale();
  const isLive = lo.mode === 'live' && lo.bbg_connected;
  const fetchedTime = lo.fetched_at ? String(lo.fetched_at).replace('T', ' ').slice(0, 19) : '—';

  target.innerHTML = `
    <!-- TOP STICKY COMMAND BAR -->
    <div class="panel" style="padding:12px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
        <div class="segmented" role="group" aria-label="2엔진 화면 전환">
          <button type="button" data-a4-tab="COCKPIT" class="${activeTab === 'COCKPIT' ? 'on' : ''}">실시간 운용·액션</button>
          <button type="button" data-a4-tab="ANALOG" class="${activeTab === 'ANALOG' ? 'on' : ''}">싱크로율 분석 (TOP 8)</button>
          <button type="button" data-a4-tab="PERF" class="${activeTab === 'PERF' ? 'on' : ''}">성과·월간 분석</button>
          <button type="button" data-a4-tab="RULES" class="${activeTab === 'RULES' ? 'on' : ''}">전략 룰북</button>
          <button type="button" data-a4-tab="AUDIT" class="${activeTab === 'AUDIT' ? 'on' : ''}">스트레스 검증</button>
        </div>
        ${isLive ? pill(`BBG 실시간 · ${fetchedTime.slice(11, 16)} KST`, 'green') : pill(`FITD 종가 · ${lo.base_as_of || data.meta?.as_of}`, 'neutral')}
      </div>

      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
        <div class="segmented" role="group" aria-label="세팅 선택">
          <button type="button" data-a4-set="A" class="${selectedSetting === 'A' ? 'on' : ''}">세팅 A (2엔진 추천)</button>
          <button type="button" data-a4-set="B" class="${selectedSetting === 'B' ? 'on' : ''}">세팅 B (감속)</button>
          <button type="button" data-a4-set="C" class="${selectedSetting === 'C' ? 'on' : ''}">세팅 C (4엔진 비교)</button>
        </div>

        ${
          selectedSetting === 'A'
            ? `<div class="segmented" role="group" aria-label="목표 연변동성 체급">
                ${[0.4, 0.6, 0.8, 1.0, 1.2]
                  .map((v) => `<button type="button" data-a4-vol="${v}" class="${Math.abs(customVolM - v) < 0.01 ? 'on' : ''}" title="목표 연 변동성 $${v}M/yr (일 1σ 약 $${Math.round((v * 1000) / Math.sqrt(252))}k)">$${v.toFixed(1)}M</button>`)
                  .join('')}
              </div>`
            : ''
        }

        <a href="./FITD_2Engine_Active_FICC_Guide.pdf" target="_blank" rel="noopener" class="btn quiet" style="text-decoration:none;">설명자료 PDF</a>
        <button type="button" class="btn quiet" id="a4-live-refresh" ${loading ? 'disabled' : ''}>BBG 즉시 갱신</button>
      </div>
    </div>

    ${
      activeTab === 'COCKPIT'
        ? renderCockpit(data, s, scaleMul)
        : activeTab === 'ANALOG'
        ? renderAnalogView(data)
        : activeTab === 'PERF'
        ? renderPerfView(data, s)
        : activeTab === 'RULES'
        ? renderRulesView(data)
        : renderAuditView(data)
    }
  `;

  // Bind controls
  target.querySelectorAll('[data-a4-tab]').forEach((b) => {
    b.onclick = () => {
      activeTab = b.dataset.a4Tab;
      renderMomentumStrategy(target);
    };
  });
  target.querySelectorAll('[data-a4-set]').forEach((b) => {
    b.onclick = () => {
      selectedSetting = b.dataset.a4Set;
      renderMomentumStrategy(target);
    };
  });
  target.querySelectorAll('[data-a4-vol]').forEach((b) => {
    b.onclick = () => {
      customVolM = Number(b.dataset.a4Vol);
      renderMomentumStrategy(target);
    };
  });
  target.querySelectorAll('[data-perf-p]').forEach((b) => {
    b.onclick = () => {
      perfPeriod = b.dataset.perfP;
      renderMomentumStrategy(target);
    };
  });
  target.querySelectorAll('.a4-analog-row').forEach((tr) => {
    tr.onclick = () => {
      selectedAnalogRank = Number(tr.dataset.rank);
      renderMomentumStrategy(target);
    };
  });

  const jumpAnalog = target.querySelector('#a4-jump-analog');
  if (jumpAnalog) {
    jumpAnalog.onclick = () => {
      activeTab = 'ANALOG';
      renderMomentumStrategy(target);
    };
  }

  const refBtn = target.querySelector('#a4-live-refresh');
  if (refBtn) {
    refBtn.onclick = async () => {
      refBtn.disabled = true;
      refBtn.textContent = '갱신 중...';
      try {
        await ctx.api('/api/refresh', { mode: ctx.getState?.()?.data_mode || 'live' });
        lastStateKey = null;
        await ctx.onChange(true);
        ctx.toast('블룸버그 실시간 가격 및 2엔진 주문표를 갱신했습니다.');
      } catch (e) {
        ctx.toast('갱신 실패: ' + e.message);
      } finally {
        refBtn.disabled = false;
        refBtn.textContent = 'BBG 즉시 갱신';
      }
    };
  }

  const gotoBook = target.querySelector('#a4-goto-book');
  if (gotoBook) gotoBook.onclick = () => ctx.setTab('book');

  const csvBtn = target.querySelector('#a4-csv-59m');
  if (csvBtn) {
    csvBtn.onclick = () => {
      const rows = [['연월', '월간손익(USD)', '누적손익(USD)', 'E1국채', 'FX4회귀']];
      (s.monthly_5y || []).forEach((r) => rows.push([r.ym, r.pnl, r.cum, r.e1, r.e3]));
      downloadCsv(`FITD_2E5050_${selectedSetting}_59M.csv`, rows);
    };
  }

  target.querySelectorAll('.a4-open-fut').forEach((b) => {
    b.onclick = () => openFuturesOrderDialog(b.dataset.cid, Number(b.dataset.ct), '2E-E1');
  });
  target.querySelectorAll('.a4-open-fx-single').forEach((b) => {
    b.onclick = () =>
      openFxOrderDialog({
        mode: 'SINGLE',
        ccy1: b.dataset.ccy,
        side1: Number(b.dataset.side),
        mio1: Number(b.dataset.mio),
        strategy: 'ACTIVE_2E_FX4',
      });
  });
  target.querySelectorAll('.a4-open-fx-pair').forEach((b) => {
    b.onclick = () =>
      openFxOrderDialog({
        mode: 'PAIR',
        ccy1: b.dataset.c1,
        ccy2: b.dataset.c2,
        side1: Number(b.dataset.s1),
        side2: Number(b.dataset.s2),
        mio1: Number(b.dataset.mio),
        mio2: Number(b.dataset.mio),
        strategy: 'ACTIVE_2E_FX4',
        label: `2엔진 50/50 FX4 · ${b.dataset.c1}/${b.dataset.c2} 페어 체결`,
      });
  });
  const openPosMap = {};
  (lo.reconcile?.actual_open_positions || []).forEach((p) => (openPosMap[p.id] = p));
  target.querySelectorAll('.a4-close-pos').forEach((b) => {
    b.onclick = () => openClosePositionDialog(openPosMap[b.dataset.pid]);
  });
}
