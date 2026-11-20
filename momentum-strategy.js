import { getChartTheme } from './chart-utils.js?v=11';

let ctx = null;
let momPayload = null;
let loading = false;
let selectedCoreId = 'TU';
let entryFormCoreId = 'TU';
let entryFormStage = 'STAGE_2_MAIN';
let stressOverride = null; // null = Live Auto
let baseBudgetOverride = null;
let curveFilter = 'ALL';
let showRegimeMatrix = false;

const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c])
  );

const n = (v, d = 2) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });

const sg = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : (Number(v) > 0 ? '+' : '') + n(v, d));

function today() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day'].map((k) => p.find((x) => x.type === k).value).join('-');
}

export function configureMomentumStrategy(context) {
  ctx = context;
}

async function fetchMomentumPayload(forceDb = false) {
  loading = true;
  try {
    let url = '/api/momentum-strategy?t=' + Date.now();
    if (forceDb) url += '&refresh_db=1';
    if (stressOverride !== null && Number.isFinite(stressOverride)) {
      url += '&stress_override=' + encodeURIComponent(stressOverride);
    }
    if (baseBudgetOverride !== null && Number.isFinite(baseBudgetOverride)) {
      url += '&base_budget_usd=' + encodeURIComponent(baseBudgetOverride);
    }
    momPayload = await ctx.api(url);
    if (
      momPayload?.active_positions?.length &&
      !momPayload.instruments?.some((x) => x.id === selectedCoreId)
    ) {
      selectedCoreId = momPayload.active_positions[0].core_id || 'TU';
    }
    if (!momPayload?.instruments?.some((x) => x.id === entryFormCoreId)) {
      entryFormCoreId = selectedCoreId || 'TU';
    }
  } catch (e) {
    ctx.toast('모멘텀 전략 데이터 조회 실패: ' + e.message);
  } finally {
    loading = false;
  }
}

function dialogShell(title, subtitle, bodyHtml, submitLabel = '저장 및 포지션 반영') {
  const d = $('#position-dialog');
  d.innerHTML = `
    <form id="mom-pos-form" style="min-width:min(680px, 92vw);">
      <div class="eyebrow">MOMENTUM STRATEGY EXECUTION · POSITION MONITOR SYNC</div>
      <h2 style="margin:4px 0 6px;">${title}</h2>
      <p class="muted" style="margin:0 0 14px; font-size:13px; line-height:1.5;">${subtitle}</p>
      ${bodyHtml}
      <div id="mom-dialog-error" role="alert" class="form-error" hidden></div>
      <div class="dialog-actions" style="margin-top:16px;">
        <button type="button" id="mom-dialog-cancel" class="btn">취소</button>
        <button type="submit" id="mom-dialog-submit" class="btn primary">${esc(submitLabel)}</button>
      </div>
    </form>`;
  $('#mom-dialog-cancel').onclick = () => d.close();
  d.showModal();
  return $('#mom-pos-form');
}

function openMomentumEntryDialog(inst, presetStage = 'STAGE_2_MAIN') {
  if (!inst || !momPayload) return;
  const s = ctx.getState();
  const policy = momPayload.active_policy;
  const fxStress = momPayload.fx_stress;
  const stageMap = {
    STAGE_1_SCOUT: {
      contracts: inst.scout_contracts,
      label: `1차 초기 진입 (1/3 · ${inst.scout_contracts}계약)`,
    },
    STAGE_2_MAIN: {
      contracts: inst.main_contracts,
      label: `2차 표준 배분 (2/3 · ${inst.main_contracts}계약)`,
    },
    STAGE_3_FULL: {
      contracts: inst.full_contracts,
      label: `3차 최대 배분 (3/3 · ${inst.full_contracts}계약)`,
    },
  };
  const initStage = stageMap[presetStage] ? presetStage : 'STAGE_2_MAIN';
  const initContracts = stageMap[initStage].contracts;
  const dv01PerC = Number(inst.dv01_per_contract_usd || 70);
  const krwRate = Number(momPayload.usd_krw_rate || 1390);

  const form = dialogShell(
    `모멘텀 전략 포지션 진입 입력 · ${esc(inst.name)} (${esc(inst.contract)})`,
    `실제 진입을 결정한 종목의 <b>계약수</b>와 <b>체결 진입 레벨(선물가격·금리)</b>을 입력하면 <b>모멘텀 전략</b>과 <b>포지션 모니터(#book)</b>에 동시에 등록되어 추적됩니다.`,
    `
    <div style="background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div>
        <div style="font-size:12px; color:var(--muted);">현재 FX 스트레스 지수 연동 국면 · 커브 동조 배수</div>
        <div style="font-weight:800; font-size:14px; color:${policy.regime_color};">
          FX 스트레스 ${n(fxStress.effective_score, 1)}점 (${esc(policy.regime_short)}) · ${esc(inst.conv_badge)} (총 ${n(inst.total_dv01_mult, 2)}x 배분)
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px; color:var(--muted);">모멘텀 신호 점수 · 시그널 방향</div>
        <div style="font-weight:800; font-size:14px; color:${inst.direction > 0 ? '#059669' : '#dc2626'};">
          ${sg(inst.recipe1?.score, 3)} · ${esc(inst.direction_label)}
        </div>
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <div style="font-size:12px; font-weight:700; margin-bottom:6px; color:var(--muted);">진입 단계 빠른 선택 (클릭 시 권장 계약수 및 DV01 자동 입력 · 아래에서 직접 수정 가능)</div>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
        <button type="button" class="btn quiet mom-stage-preset ${initStage === 'STAGE_1_SCOUT' ? 'primary' : ''}" data-stage="STAGE_1_SCOUT" data-contracts="${inst.scout_contracts}" style="padding:8px 10px; text-align:left;">
          <div style="font-weight:800; font-size:12px;">1차 초기 진입 (1/3)</div>
          <div style="font-size:13px; font-weight:900; margin-top:2px;">${inst.scout_contracts}계약 · $${n(inst.scout_dv01_usd, 0)}/bp</div>
        </button>
        <button type="button" class="btn quiet mom-stage-preset ${initStage === 'STAGE_2_MAIN' ? 'primary' : ''}" data-stage="STAGE_2_MAIN" data-contracts="${inst.main_contracts}" style="padding:8px 10px; text-align:left;">
          <div style="font-weight:800; font-size:12px;">2차 표준 배분 (2/3)</div>
          <div style="font-size:13px; font-weight:900; margin-top:2px;">${inst.main_contracts}계약 · $${n(inst.main_dv01_usd, 0)}/bp</div>
        </button>
        <button type="button" class="btn quiet mom-stage-preset ${initStage === 'STAGE_3_FULL' ? 'primary' : ''}" data-stage="STAGE_3_FULL" data-contracts="${inst.full_contracts}" style="padding:8px 10px; text-align:left;">
          <div style="font-weight:800; font-size:12px;">3차 최대 배분 (3/3)</div>
          <div style="font-size:13px; font-weight:900; margin-top:2px;">${inst.full_contracts}계약 · $${n(inst.full_dv01_usd, 0)}/bp</div>
        </button>
      </div>
    </div>

    <div class="form-grid">
      <label>진입일
        <input id="m-entry-date" type="date" value="${esc(s?.as_of || today())}" max="${today()}" required>
      </label>
      <label>포지션 진입 방향
        <select id="m-side1">
          <option value="-1" ${inst.direction < 0 ? 'selected' : ''}>▼ 채권 SHORT (금리 상승 방향)</option>
          <option value="1" ${inst.direction > 0 ? 'selected' : ''}>▲ 채권 LONG (금리 하락 방향)</option>
        </select>
      </label>
      <label>진입 선물 계약수 (Contracts)
        <input id="m-contracts" type="number" min="1" max="2000" step="1" value="${initContracts}" required>
      </label>
      <label>표시 통화 기준 (포지션 모니터 연동)
        <select id="m-ccy">
          <option value="USD" selected>USD ($ / bp)</option>
          <option value="KRW">KRW (만원 / bp)</option>
        </select>
      </label>
      <label>체결 선물 진입 레벨 (${esc(inst.contract)} 가격)
        <input id="m-fpx" type="number" step="any" value="${inst.raw_close}" required>
      </label>
      <label>대응 현물 금리 레벨 (${esc(inst.node_name)} 수익률 %)
        <input id="m-quote1" type="number" step="any" value="${inst.current_yield_pct}" required>
      </label>
      <label>초기 변동성 스탑 레벨 (2.5×SD20 선물가)
        <input id="m-stop-fpx" type="number" step="any" value="${inst.levels.stop_raw}" required>
      </label>
      <label>1차 부분익절 목표가 (+${n(policy.partial_tp_r, 2)}R 선물가)
        <input id="m-tp-fpx" type="number" step="any" value="${inst.levels.partial_tp_raw}" required>
      </label>
    </div>

    <div id="m-sizing-preview" class="allocation-preview" style="margin:10px 0; font-weight:700;"></div>

    <label>포지션 메모
      <textarea id="m-notes" rows="2" maxlength="1000">모멘텀 전략 · ${esc(inst.curve_group_name)} (${esc(inst.contract)}) ${inst.direction < 0 ? 'SHORT' : 'LONG'} 직접 진입 (${esc(policy.regime_short)})</textarea>
    </label>
    `,
    '진입 확정 및 포지션 모니터 등록'
  );

  let currentStageCode = initStage;

  function updatePreview() {
    const c = Math.max(1, Math.round(Number($('#m-contracts').value) || 1));
    const dvUsd = c * dv01PerC;
    const dvManwon = (dvUsd * krwRate) / 10000;
    const estRiskUsd = c * Number(inst.loss_per_contract_usd || 800);
    $('#m-sizing-preview').innerHTML =
      `체결 규모: <b>${c}계약 (${esc(inst.contract)})</b> → 단일 금리 민감도(DV01) <b>$${n(dvUsd, 1)}/bp</b> (약 <b>${n(dvManwon, 1)}만원/bp</b>) · ` +
      `2.5×SD20 변동성 스탑 기준 예상 위험예산 <b>$${n(estRiskUsd, 0)}</b>`;
  }

  form.querySelectorAll('.mom-stage-preset').forEach((btn) => {
    btn.onclick = () => {
      currentStageCode = btn.dataset.stage;
      $('#m-contracts').value = btn.dataset.contracts;
      form.querySelectorAll('.mom-stage-preset').forEach((b) => b.classList.remove('primary'));
      btn.classList.add('primary');
      updatePreview();
    };
  });

  $('#m-contracts').oninput = updatePreview;
  $('#m-fpx').oninput = () => {
    const s1 = Number($('#m-side1').value);
    const fpx = Number($('#m-fpx').value);
    if (Number.isFinite(fpx) && fpx > 0) {
      $('#m-stop-fpx').value = (fpx - s1 * inst.stop_dist_pt).toFixed(4);
    }
  };
  $('#m-side1').onchange = () => {
    const s1 = Number($('#m-side1').value);
    const fpx = Number($('#m-fpx').value) || inst.raw_close;
    $('#m-stop-fpx').value = (fpx - s1 * inst.stop_dist_pt).toFixed(4);
  };
  updatePreview();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const c = Math.max(1, Math.round(Number($('#m-contracts').value) || 1));
    const ccy = $('#m-ccy').value;
    const dvUsd = c * dv01PerC;
    const dvManwon = (dvUsd * krwRate) / 10000;
    const side1 = Number($('#m-side1').value);
    const fpx = Number($('#m-fpx').value);
    const stopFpx = Number($('#m-stop-fpx').value);
    const tpFpx = Number($('#m-tp-fpx').value);
    const stgLabel =
      currentStageCode === 'STAGE_3_FULL'
        ? `3차 최대 배분 (${c}계약)`
        : currentStageCode === 'STAGE_1_SCOUT'
        ? `1차 초기 진입 (${c}계약)`
        : `2차 표준 배분 (${c}계약)`;

    const payload = {
      action: 'manual_open',
      shape: 'SINGLE',
      strategy: 'MOMENTUM',
      rates_currency: ccy,
      name: `${inst.node_name} (${inst.contract} 국채선물)`,
      node1: `${inst.node_name} (${inst.contract})`,
      leg1: inst.leg1_id,
      leg2: null,
      side1,
      side2: 0,
      entry_date: $('#m-entry-date').value,
      quote1: Number($('#m-quote1').value),
      quote2: 0,
      contracts: c,
      entry_futures_px: fpx,
      total_dv01_usd: dvUsd,
      total_sensitivity_manwon: dvManwon,
      leg1_weight: 100,
      hardcap: Math.round(c * Number(inst.loss_per_contract_usd || 850) * (ccy === 'KRW' ? krwRate : 1)),
      notes: $('#m-notes').value,
      momentum_meta: {
        core_id: inst.id,
        contract: inst.contract,
        curve_group: inst.curve_group,
        pricing_mode: 'FUTURES',
        contracts: c,
        initial_contracts: c,
        peak_contracts: c,
        entry_futures_px: fpx,
        initial_futures_px: fpx,
        current_futures_px: inst.raw_close,
        point_value: inst.point_value,
        tick_size: inst.tick_size,
        tick_value: inst.tick_value,
        fx_rate: inst.fx || 1.0,
        dv01_per_contract_usd: dv01PerC,
        stage: currentStageCode,
        stage_label: stgLabel,
        main_stage_done: currentStageCode !== 'STAGE_1_SCOUT',
        full_stage_done: currentStageCode === 'STAGE_3_FULL',
        partial_tp_done: false,
        be_stop_armed: false,
        days_held: 1,
        hwm_r: 0.0,
        planned_risk_usd: Math.round(c * Number(inst.loss_per_contract_usd || 850)),
        stop_futures_px: stopFpx,
        partial_tp_futures_px: tpFpx,
        full_upgrade_futures_px: inst.levels.full_upgrade_raw,
        chan10_exit_futures_px: inst.levels.chan10_exit_raw,
      },
    };

    try {
      $('#mom-dialog-submit').disabled = true;
      await ctx.api('/api/positions', payload);
      $('#position-dialog').close();
      await ctx.onChange();
      await fetchMomentumPayload(false);
      renderMomentumStrategy($('#view'));
      ctx.toast(`${inst.contract} ${c}계약 모멘텀 포지션이 등록되어 포지션 모니터(#book)와 연동되었습니다.`);
    } catch (err) {
      $('#mom-dialog-error').hidden = false;
      $('#mom-dialog-error').textContent = err.message;
    } finally {
      if ($('#mom-dialog-submit')) $('#mom-dialog-submit').disabled = false;
    }
  };
}

function openScaleUpDialog(pos) {
  const recAdd = Math.max(1, pos.contract_delta > 0 ? pos.contract_delta : (pos.triggers?.full_add_contracts || 10));
  const dv01PerC = Number(pos.dv01_per_contract_usd || 70);
  const krwRate = Number(momPayload?.usd_krw_rate || 1390);
  const nextStage =
    pos.current_contracts + recAdd >= pos.full_contracts ? 'STAGE_3_FULL' : 'STAGE_2_MAIN';

  const form = dialogShell(
    `모멘텀 포지션 계약 증액 (Scale-Up) · ${esc(pos.name)}`,
    `현재 보유 <b>${pos.current_contracts}계약 ($${n(pos.current_dv01_usd, 0)}/bp)</b> · 현 FX 스트레스 국면 목표 <b>${pos.regime_target_contracts}계약</b>`,
    `
    <div class="form-grid">
      <label>추가 체결일
        <input id="su-date" type="date" value="${esc(ctx.getState()?.as_of || today())}" max="${today()}" required>
      </label>
      <label>증액 후 단계 구분
        <select id="su-stage">
          <option value="STAGE_2_MAIN" ${nextStage === 'STAGE_2_MAIN' ? 'selected' : ''}>2차 표준 배분 (2/3 증액)</option>
          <option value="STAGE_3_FULL" ${nextStage === 'STAGE_3_FULL' ? 'selected' : ''}>3차 최대 배분 (3/3 증액)</option>
          <option value="PULLBACK_REENTRY">부분익절 후 MA20 눌림목 재진입</option>
        </select>
      </label>
      <label>추가 진입 계약수 (+Contracts)
        <input id="su-contracts" type="number" min="1" max="1000" step="1" value="${recAdd}" required>
      </label>
      <label>추가 체결 선물 레벨 (${esc(pos.contract)})
        <input id="su-fpx" type="number" step="any" value="${pos.current_futures_px}" required>
      </label>
      <label>대응 현물 금리 레벨 (%)
        <input id="su-quote1" type="number" step="any" value="${pos.current_quote1}" required>
      </label>
    </div>
    <div id="su-preview" class="allocation-preview" style="margin:10px 0; font-weight:700;"></div>
    <label>증액 사유 / 메모
      <textarea id="su-notes" rows="2" maxlength="1000">모멘텀 전략 단계 증액 (+${recAdd}계약 @ ${pos.current_futures_px}) · ${esc(pos.conv_badge)}</textarea>
    </label>
    `,
    '계약 증액 실행'
  );

  function updateSuPreview() {
    const addC = Math.max(1, Math.round(Number($('#su-contracts').value) || 1));
    const afterC = pos.current_contracts + addC;
    const addDv = addC * dv01PerC;
    const afterDv = afterC * dv01PerC;
    $('#su-preview').innerHTML =
      `현재 <b>${pos.current_contracts}계약</b> + 추가 <b>+${addC}계약 (+$${n(addDv, 0)}/bp)</b> → ` +
      `증액 후 총 <b>${afterC}계약 ($${n(afterDv, 0)}/bp · ${n((afterDv * krwRate) / 10000, 0)}만원/bp)</b>`;
  }
  $('#su-contracts').oninput = updateSuPreview;
  updateSuPreview();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const addC = Math.max(1, Math.round(Number($('#su-contracts').value) || 1));
    const afterC = pos.current_contracts + addC;
    const addDvUsd = addC * dv01PerC;
    const addDvManwon = (addDvUsd * krwRate) / 10000;
    const stg = $('#su-stage').value;
    const stgLabel =
      stg === 'STAGE_3_FULL'
        ? `3차 최대 배분 (${afterC}계약)`
        : stg === 'PULLBACK_REENTRY'
        ? `눌림목 재진입 (${afterC}계약)`
        : `2차 표준 배분 (${afterC}계약)`;

    try {
      $('#mom-dialog-submit').disabled = true;
      await ctx.api('/api/positions', {
        action: 'manual_add',
        id: pos.id,
        trade_date: $('#su-date').value,
        add_contracts: addC,
        entry_futures_px: Number($('#su-fpx').value),
        quote1: Number($('#su-quote1').value),
        quote2: 0,
        total_dv01_usd: addDvUsd,
        total_sensitivity_manwon: addDvManwon,
        leg1_weight: 100,
        stage: stg,
        stage_label: stgLabel,
        notes: $('#su-notes').value,
      });
      $('#position-dialog').close();
      await ctx.onChange();
      await fetchMomentumPayload(false);
      renderMomentumStrategy($('#view'));
      ctx.toast(`${pos.contract} +${addC}계약 증액 완료 (현재 총 ${afterC}계약)`);
    } catch (err) {
      $('#mom-dialog-error').hidden = false;
      $('#mom-dialog-error').textContent = err.message;
    } finally {
      if ($('#mom-dialog-submit')) $('#mom-dialog-submit').disabled = false;
    }
  };
}

function openScaleDownOrCloseDialog(pos, mode = 'PARTIAL_TP') {
  const curC = Math.max(1, pos.current_contracts);
  const initCloseC =
    mode === 'FULL_CLOSE'
      ? curC
      : mode === 'PARTIAL_TP'
      ? Math.max(1, Math.ceil(curC * 0.5))
      : Math.max(1, Math.round(curC / 3));

  const titleMap = {
    PARTIAL_TP: `50% 부분익절 및 손익분기(BE) 스탑 상향 · ${esc(pos.name)}`,
    TRIM: `보유 계약 선제 축소 (Scale-Down) · ${esc(pos.name)}`,
    FULL_CLOSE: `모멘텀 포지션 전량 청산 · ${esc(pos.name)}`,
  };
  const defaultNote =
    mode === 'PARTIAL_TP'
      ? `모멘텀 전략 50% 부분익절 (-${initCloseC}계약 @ ${pos.current_futures_px}) 및 잔여 물량 손익분기 스탑(${pos.entry_futures_px}) 상향`
      : mode === 'TRIM'
      ? `FX 스트레스 국면 / 모멘텀 기준에 따른 선제 계약 축소 (-${initCloseC}계약 @ ${pos.current_futures_px})`
      : `모멘텀 전략 전량 청산 (${curC}계약 @ ${pos.current_futures_px})`;

  const form = dialogShell(
    titleMap[mode] || titleMap.FULL_CLOSE,
    `청산 수량만큼 실현손익(Realized PnL)이 즉시 확정되며, 포지션 모니터(#book)의 잔여 계약수와 거래 이력에 반영됩니다.`,
    `
    <div class="form-grid">
      <label>청산 체결일
        <input id="sd-date" type="date" value="${esc(ctx.getState()?.as_of || today())}" max="${today()}" required>
      </label>
      <label>청산할 계약수 (현재 보유 ${curC}계약)
        <input id="sd-contracts" type="number" min="1" max="${curC}" step="1" value="${initCloseC}" required>
      </label>
      <label>청산 선물 체결 레벨 (${esc(pos.contract)})
        <input id="sd-fpx" type="number" step="any" value="${pos.current_futures_px}" required>
      </label>
      <label>대응 현물 금리 레벨 (%)
        <input id="sd-quote1" type="number" step="any" value="${pos.current_quote1}" required>
      </label>
    </div>
    <label class="hm-check" style="margin:8px 0;">
      <input id="sd-be-stop" type="checkbox" ${mode === 'PARTIAL_TP' ? 'checked' : ''}>
      부분익절/축소 후 잔여 물량의 스탑라인을 평균 진입가(<b>${n(pos.entry_futures_px, 4)} · 손익분기 스탑</b>)로 즉시 상향합니다.
    </label>
    <div id="sd-preview" class="allocation-preview" style="margin:10px 0; font-weight:700;"></div>
    <label>청산 / 축소 메모
      <textarea id="sd-notes" rows="2" maxlength="1000">${esc(defaultNote)}</textarea>
    </label>
    `,
    mode === 'FULL_CLOSE' ? '전량 청산 확정' : '부분 청산 · 축소 실행'
  );

  function updateSdPreview() {
    const closeC = Math.min(curC, Math.max(1, Math.round(Number($('#sd-contracts').value) || 1)));
    const remC = curC - closeC;
    const pct = ((closeC / curC) * 100).toFixed(1);
    const fpx = Number($('#sd-fpx').value) || pos.current_futures_px;
    const inst = momPayload?.instruments?.find((x) => x.id === pos.core_id);
    const ptVal = Number(inst?.point_value || 2000);
    const fxVal = Number(inst?.fx || 1.0);
    const estRealizedUsd = pos.side1 * (fpx - pos.entry_futures_px) * closeC * ptVal * fxVal;
    $('#sd-preview').innerHTML =
      `청산 수량: <b>-${closeC}계약 (${pct}%)</b> → 잔여 보유: <b>${remC}계약 ($${n(remC * pos.dv01_per_contract_usd, 0)}/bp)</b> · ` +
      `이번 청산분 예상 실현손익: <b style="color:${estRealizedUsd >= 0 ? '#059669' : '#dc2626'};">$${sg(estRealizedUsd, 0)}</b>`;
  }
  $('#sd-contracts').oninput = updateSdPreview;
  $('#sd-fpx').oninput = updateSdPreview;
  updateSdPreview();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const closeC = Math.min(curC, Math.max(1, Math.round(Number($('#sd-contracts').value) || 1)));
    const pct = (closeC / curC) * 100;
    try {
      $('#mom-dialog-submit').disabled = true;
      await ctx.api('/api/positions', {
        action: 'manual_close',
        id: pos.id,
        trade_date: $('#sd-date').value,
        close_contracts: closeC,
        percent: pct,
        exit_futures_px: Number($('#sd-fpx').value),
        quote1: Number($('#sd-quote1').value),
        quote2: 0,
        is_partial_tp: mode === 'PARTIAL_TP' || $('#sd-be-stop').checked,
        notes: $('#sd-notes').value,
      });
      $('#position-dialog').close();
      await ctx.onChange();
      await fetchMomentumPayload(false);
      renderMomentumStrategy($('#view'));
      ctx.toast(
        closeC >= curC
          ? `${pos.contract} ${curC}계약 전량 청산이 완료되었습니다.`
          : `${pos.contract} -${closeC}계약 부분 청산 완료 (잔여 ${curC - closeC}계약)`
      );
    } catch (err) {
      $('#mom-dialog-error').hidden = false;
      $('#mom-dialog-error').textContent = err.message;
    } finally {
      if ($('#mom-dialog-submit')) $('#mom-dialog-submit').disabled = false;
    }
  };
}

function openMomentumEditDialog(pos) {
  const dv01PerC = Number(pos.dv01_per_contract_usd || 70);
  const krwRate = Number(momPayload?.usd_krw_rate || 1390);
  const form = dialogShell(
    `모멘텀 포지션 진입 레벨 · 계약규모 수정 · ${esc(pos.name)}`,
    `진입 선물가격, 계약수, 스탑라인을 수정하면 일별 평가손익(Mark-to-Market)과 포지션 모니터가 즉시 재계산됩니다.`,
    `
    <div class="form-grid">
      <label>진입일
        <input id="me-date" type="date" value="${esc(pos.entry_date)}" max="${today()}" required>
      </label>
      <label>포지션 방향
        <select id="me-side1">
          <option value="-1" ${pos.side1 < 0 ? 'selected' : ''}>▼ 채권 SHORT (금리 상승)</option>
          <option value="1" ${pos.side1 > 0 ? 'selected' : ''}>▲ 채권 LONG (금리 하락)</option>
        </select>
      </label>
      <label>현재 보유 계약수 (Contracts)
        <input id="me-contracts" type="number" min="1" max="2000" step="1" value="${pos.current_contracts}" required>
      </label>
      <label>평균 진입 선물 레벨 (${esc(pos.contract)})
        <input id="me-fpx" type="number" step="any" value="${pos.entry_futures_px}" required>
      </label>
      <label>대응 진입 금리 레벨 (%)
        <input id="me-quote1" type="number" step="any" value="${pos.entry_quote1}" required>
      </label>
      <label>변동성/손익분기 스탑 선물 레벨
        <input id="me-stop" type="number" step="any" value="${pos.triggers?.stop_px}" required>
      </label>
    </div>
    <div id="me-preview" class="allocation-preview" style="margin:10px 0; font-weight:700;"></div>
    <label>포지션 메모
      <textarea id="me-notes" rows="2" maxlength="1000">${esc(pos.notes || '')}</textarea>
    </label>
    <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--line); display:flex; justify-content:space-between; align-items:center;">
      <span class="muted" style="font-size:12px;">이 포지션 기록을 삭제하려면 우측 버튼을 클릭하세요.</span>
      <button type="button" id="me-delete" class="btn quiet" style="color:#dc2626; border-color:#dc2626;">포지션 기록 삭제</button>
    </div>
    `,
    '수정사항 저장'
  );

  function updateMePreview() {
    const c = Math.max(1, Math.round(Number($('#me-contracts').value) || 1));
    const dvUsd = c * dv01PerC;
    $('#me-preview').innerHTML = `수정 후 계약규모: <b>${c}계약</b> → 총 DV01 <b>$${n(dvUsd, 1)}/bp (${n((dvUsd * krwRate) / 10000, 1)}만원/bp)</b>`;
  }
  $('#me-contracts').oninput = updateMePreview;
  updateMePreview();

  $('#me-delete').onclick = async () => {
    if (!confirm(`'${pos.name}' 포지션을 삭제하시겠습니까?`)) return;
    try {
      await ctx.api('/api/positions', { action: 'delete', id: pos.id });
      $('#position-dialog').close();
      await ctx.onChange();
      await fetchMomentumPayload(false);
      renderMomentumStrategy($('#view'));
      ctx.toast('모멘텀 포지션을 삭제했습니다.');
    } catch (err) {
      ctx.toast(err.message);
    }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const c = Math.max(1, Math.round(Number($('#me-contracts').value) || 1));
    const dvUsd = c * dv01PerC;
    const dvManwon = (dvUsd * krwRate) / 10000;
    try {
      $('#mom-dialog-submit').disabled = true;
      await ctx.api('/api/positions', {
        action: 'manual_edit',
        id: pos.id,
        entry_date: $('#me-date').value,
        strategy: 'MOMENTUM',
        rates_currency: pos.pnl_currency || 'USD',
        side1: Number($('#me-side1').value),
        side2: 0,
        contracts: c,
        entry_futures_px: Number($('#me-fpx').value),
        quote1: Number($('#me-quote1').value),
        quote2: 0,
        total_dv01_usd: dvUsd,
        total_sensitivity_manwon: dvManwon,
        leg1_weight: 100,
        notes: $('#me-notes').value,
        momentum_meta: {
          stop_futures_px: Number($('#me-stop').value),
          stage_label: `보유 ${c}계약`,
        },
      });
      $('#position-dialog').close();
      await ctx.onChange();
      await fetchMomentumPayload(false);
      renderMomentumStrategy($('#view'));
      ctx.toast('모멘텀 포지션 정보를 수정했습니다.');
    } catch (err) {
      $('#mom-dialog-error').hidden = false;
      $('#mom-dialog-error').textContent = err.message;
    } finally {
      if ($('#mom-dialog-submit')) $('#mom-dialog-submit').disabled = false;
    }
  };
}

function renderHistorySvgChart(inst) {
  const bars = inst?.recent_bars || [];
  if (bars.length < 5) {
    return '<div class="empty">일별 선물 가격 및 모멘텀 신호 시계열 데이터가 없습니다.</div>';
  }
  const w = 720;
  const h = 230;
  const pad = { l: 56, r: 48, t: 20, b: 30 };
  const pxs = bars.map((b) => Number(b.close));
  const minPx = Math.min(...pxs, Number(inst.levels?.stop_raw || pxs[0]), Number(inst.levels?.partial_tp_raw || pxs[0]));
  const maxPx = Math.max(...pxs, Number(inst.levels?.stop_raw || pxs[0]), Number(inst.levels?.partial_tp_raw || pxs[0]));
  const pxSpan = maxPx - minPx || 1;

  const X = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, bars.length - 1);
  const Ypx = (v) => pad.t + ((maxPx - v) / pxSpan) * (h - pad.t - pad.b);
  const Ysc = (s) => pad.t + ((1.0 - Math.max(-1, Math.min(1, s))) / 2.0) * (h - pad.t - pad.b);

  const pxPath = bars.map((b, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Ypx(b.close).toFixed(1)}`).join(' ');
  const scPath = bars.map((b, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Ysc(b.score).toFixed(1)}`).join(' ');

  const stopY = Ypx(inst.levels.stop_raw);
  const tpY = Ypx(inst.levels.partial_tp_raw);
  const zeroScY = Ysc(0);

  return `
    <div class="hm-chart-legend legend-black" style="margin-bottom:8px; color:#0f172a !important; font-weight:700;">
      <span style="color:#0f172a !important; font-weight:700;"><i style="background:#2563eb; height:3.5px;"></i>선물 종가 (${esc(inst.contract)})</span>
      <span style="color:#0f172a !important; font-weight:700;"><i style="background:#d97706; height:3.5px;"></i>모멘텀 신호 점수 (-1 ~ +1)</span>
      <span style="color:#0f172a !important; font-weight:700;"><i style="background:#059669; height:3.5px;"></i>1차 부분익절 목표가 (${n(inst.levels.partial_tp_raw, 3)})</span>
      <span style="color:#0f172a !important; font-weight:700;"><i style="background:#dc2626; height:3.5px;"></i>2.5×SD20 변동성 스탑 (${n(inst.levels.stop_raw, 3)})</span>
    </div>
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; display:block;" role="img" aria-label="최근 60거래일 선물 가격 및 모멘텀 점수 추이">
      <line x1="${pad.l}" x2="${w - pad.r}" y1="${zeroScY.toFixed(1)}" y2="${zeroScY.toFixed(1)}" stroke="#64748b" stroke-dasharray="3 3" stroke-width="1"/>
      <line x1="${pad.l}" x2="${w - pad.r}" y1="${tpY.toFixed(1)}" y2="${tpY.toFixed(1)}" stroke="#059669" stroke-dasharray="4 3" stroke-width="1.4"/>
      <line x1="${pad.l}" x2="${w - pad.r}" y1="${stopY.toFixed(1)}" y2="${stopY.toFixed(1)}" stroke="#dc2626" stroke-dasharray="4 3" stroke-width="1.4"/>
      <path d="${scPath}" fill="none" stroke="#d97706" stroke-width="2.0" opacity="0.92"/>
      <path d="${pxPath}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
      <text x="6" y="${(pad.t + 10).toFixed(0)}" fill="#0f172a" font-weight="700" font-size="11.5">${n(maxPx, 2)}</text>
      <text x="6" y="${(h - pad.b).toFixed(0)}" fill="#0f172a" font-weight="700" font-size="11.5">${n(minPx, 2)}</text>
      <text x="${w - 42}" y="${(pad.t + 10).toFixed(0)}" fill="#b45309" font-weight="700" font-size="11.5">+1.0</text>
      <text x="${w - 42}" y="${zeroScY.toFixed(0)}" fill="#b45309" font-weight="700" font-size="11.5">0.0</text>
      <text x="${w - 42}" y="${(h - pad.b).toFixed(0)}" fill="#b45309" font-weight="700" font-size="11.5">-1.0</text>
      <text x="${pad.l}" y="${h - 8}" fill="#0f172a" font-weight="600" font-size="11.5">${esc(bars[0].date)}</text>
      <text x="${w - pad.r}" y="${h - 8}" text-anchor="end" fill="#0f172a" font-weight="600" font-size="11.5">${esc(bars.at(-1).date)}</text>
    </svg>
  `;
}

export async function renderMomentumStrategy(target) {
  if (!target) target = $('#view');
  if (!momPayload && !loading) {
    target.innerHTML = `<div class="panel"><div class="empty">모멘텀 전략 및 FX 스트레스 지수 엔진을 불러오는 중입니다...</div></div>`;
    await fetchMomentumPayload(false);
  }
  if (!momPayload) return;

  const s = ctx.getState();
  const fx = momPayload.fx_stress;
  const pol = momPayload.active_policy;
  const curves = momPayload.curve_groups || [];
  const instruments = momPayload.instruments || [];
  const activePositions = momPayload.active_positions || [];
  const closedPositions = momPayload.closed_positions || [];
  const chosenInst = instruments.find((x) => x.id === selectedCoreId) || instruments[0];
  const entryInst = instruments.find((x) => x.id === entryFormCoreId) || chosenInst || instruments[0];

  const entryDefaultContracts =
    entryFormStage === 'STAGE_3_FULL'
      ? entryInst.full_contracts
      : entryFormStage === 'STAGE_1_SCOUT'
      ? entryInst.scout_contracts
      : entryInst.main_contracts;

  const filteredInstruments =
    curveFilter === 'ALL'
      ? instruments
      : instruments.filter((x) => x.curve_group === curveFilter);

  const totalOpenDv01Usd = activePositions.reduce((s, p) => s + (p.current_dv01_usd || 0), 0);
  const totalOpenPnlUsd = activePositions.reduce((s, p) => s + (p.pnl_usd || 0), 0);
  const totalOpenContracts = activePositions.reduce((s, p) => s + (p.current_contracts || 0), 0);

  target.innerHTML = `
    <div class="mom-strategy-root" style="display:flex; flex-direction:column; gap:16px;">

      <!-- Top Summary KPI Bar -->
      <div class="stats">
        <div class="stat" style="border-top:3px solid ${pol.regime_color};">
          <div class="label">FX 스트레스 지수 · 현재 운용 국면<span>·</span></div>
          <div class="num" style="color:${pol.regime_color}; font-size:24px;">
            ${n(fx.effective_score, 1)}<small style="font-size:13px;"> / 100점 (${esc(pol.regime_short)})</small>
          </div>
          <div class="help">
            실제 지수 ${n(fx.actual_score, 1)}점 ${fx.is_overridden ? '· <b style="color:#d97706;">시뮬레이션 오버라이드 적용 중</b>' : '· 실시간 자동 연동 중'}
          </div>
        </div>

        <div class="stat">
          <div class="label">국면 연동 진입·증액 기준 & 배수<span>·</span></div>
          <div class="num" style="font-size:21px;">
            ${n(pol.fx_stress_mult, 2)}x <small style="font-size:13px;">(3차 배분 |S0| ≥ ${n(pol.full_thr, 2)})</small>
          </div>
          <div class="help">
            1차 ≥ ${n(pol.scout_thr, 2)} · 2차 ≥ ${n(pol.main_thr, 2)} · 감축 &lt; ${n(pol.trim_thr, 2)} · 타임스탑 ${pol.time_stop_days}일
          </div>
        </div>

        <div class="stat">
          <div class="label">운용 중인 모멘텀 포지션 (포지션 모니터 연동)<span>▤</span></div>
          <div class="num ${activePositions.length ? 'green' : ''}" style="font-size:22px;">
            ${activePositions.length}건 <small style="font-size:13px;">(총 ${totalOpenContracts}계약 · $${n(totalOpenDv01Usd, 0)}/bp)</small>
          </div>
          <div class="help">
            ${activePositions.length ? `합산 평가손익 <b style="color:${totalOpenPnlUsd >= 0 ? '#059669' : '#dc2626'};">$${sg(totalOpenPnlUsd, 0)}</b>` : '시그널 확인 후 아래 진입 데스크에서 직접 등록'} · 청산 이력 ${closedPositions.length}건
          </div>
        </div>

        <div class="stat">
          <div class="label">국가 커브별 대표 테너 시그널<span>·</span></div>
          <div class="num" style="font-size:20px;">
            ${curves.map((c) => `${c.flag}${c.best_id}`).join(' · ')}
          </div>
          <div class="help">
            만기 분산 대신 커브 내 신호 우위 대표 테너에 동조 배수(최대 1.35x)로 DV01 배분
          </div>
        </div>
      </div>

      <!-- SECTION 1: FX Stress Index & Dynamic Strategy Control Board -->
      <div class="panel" style="border-left:4px solid ${pol.regime_color};">
        <div class="panel-head" style="flex-wrap:wrap; gap:10px;">
          <div>
            <div class="eyebrow" style="color:${pol.regime_color}; font-weight:800;">FX STRESS INDEX & DYNAMIC MOMENTUM PARAMETER ENGINE</div>
            <h2 style="margin-top:2px;">FX 스트레스 지수 모니터 & 국면별 동적 파라미터 제어판</h2>
            <small>FX 통계적 차익거래의 평균회귀 이탈도(Z-괴리·이탈 비율)와 7대 통화선물 달러 모멘텀을 결합하여 모멘텀 전략의 진입 임계치·계약 배분·익절 기준을 동적으로 조정합니다.</small>
          </div>
          <div class="control-buttons" style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn quiet" id="mom-toggle-matrix">
              ${showRegimeMatrix ? '▲ 국면별 파라미터 기준표 닫기' : '▼ 3대 FX 국면별 파라미터 기준표 보기'}
            </button>
            <button type="button" class="btn quiet" id="mom-refresh-db">↻ FITD 선물 DB 동기화</button>
            <button type="button" class="btn quiet" id="mom-goto-book">▤ 포지션 모니터로 이동 ↗</button>
          </div>
        </div>

        <!-- Gauge + Active Policy + Interactive Simulator -->
        <div style="display:grid; grid-template-columns: 1.15fr 1.35fr; gap:16px; margin-top:10px;">
          <!-- Left: FX Stress Gauge & 3 Components -->
          <div style="background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px;">
              <span style="font-weight:800; font-size:14px;">FX 스트레스 지수 (0 ~ 100점)</span>
              <span style="font-size:22px; font-weight:900; color:${pol.regime_color};">
                ${n(fx.effective_score, 1)}점
                ${fx.is_overridden ? `<small style="font-size:11px; color:#d97706;">(실제 ${n(fx.actual_score, 1)}점)</small>` : ''}
              </span>
            </div>

            <!-- 3-Tier Visual Progress Bar -->
            <div style="position:relative; height:16px; border-radius:999px; background:linear-gradient(90deg, #10b981 0%, #10b981 37%, #f59e0b 38%, #f59e0b 59%, #dc2626 60%, #dc2626 100%); margin:10px 0 6px; box-shadow:inset 0 1px 3px rgba(0,0,0,0.15);">
              <div style="position:absolute; left:calc(${Math.min(98, Math.max(2, fx.effective_score))}% - 8px); top:-4px; width:16px; height:24px; border-radius:4px; background:#fff; border:3px solid #111827; box-shadow:0 2px 6px rgba(0,0,0,0.3);" title="현재 적용 FX 스트레스: ${n(fx.effective_score, 1)}점"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--muted); margin-bottom:12px;">
              <span>0~37점: 보수적 운용 (평균회귀)</span>
              <span>38~59점: 추세 형성 (표준 배분)</span>
              <span>60~100점: 추세 확장 (비중 확대)</span>
            </div>

            <!-- 3 Sub-pillars -->
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; font-size:12px;">
              <div style="background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px;">
                <div style="color:var(--muted); font-size:11px;">① OOS-Refit Z 괴리</div>
                <div style="font-weight:800; font-size:14px; margin-top:2px;">평균 ${n(fx.mean_z_drift, 2)}σ</div>
                <div style="color:var(--muted); font-size:11px;">최대 ${n(fx.max_z_drift, 2)}σ</div>
              </div>
              <div style="background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px;">
                <div style="color:var(--muted); font-size:11px;">② 꼬리이탈·차단 페어 비율</div>
                <div style="font-weight:800; font-size:14px; margin-top:2px;">${fx.tail_pairs_count} / ${fx.fx_pairs_count}개 (${n((fx.tail_pairs_ratio <= 1 ? fx.tail_pairs_ratio * 100 : fx.tail_pairs_ratio), 1)}%)</div>
                <div style="color:var(--muted); font-size:11px;">평균 반감기 ${n(fx.mean_half_life, 1)}일 · 평균 |Z| ${n(fx.mean_abs_oos_z, 2)}σ</div>
              </div>
              <div style="background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px;">
                <div style="color:var(--muted); font-size:11px;">③ 7대 통화선물 달러 모멘텀</div>
                <div style="font-weight:800; font-size:14px; margin-top:2px; color:${fx.avg_usd_impulse >= 0 ? '#dc2626' : '#0284c7'};">
                  ${sg(fx.avg_usd_impulse, 3)}
                </div>
                <div style="color:var(--muted); font-size:11px;">${fx.avg_usd_impulse > 0.15 ? '글로벌 달러 강세' : fx.avg_usd_impulse < -0.15 ? '글로벌 달러 약세' : '달러 방향 중립'}</div>
              </div>
            </div>

            <!-- Interactive FX Stress Simulator Control -->
            <div style="margin-top:12px; padding-top:10px; border-top:1px dashed var(--line);">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
                <span style="font-size:12px; font-weight:700;">FX 스트레스 지수 시뮬레이션 (지수 변화에 따른 전략·포지션 상태 확인)</span>
                <div style="display:flex; gap:4px;">
                  <button type="button" class="btn quiet" data-stress-preset="auto" style="padding:3px 8px; font-size:11px; ${!fx.is_overridden ? 'background:#0284c7; color:#fff; border-color:#0284c7;' : ''}">실시간(${n(fx.actual_score, 0)}점)</button>
                  <button type="button" class="btn quiet" data-stress-preset="22" style="padding:3px 8px; font-size:11px;">보수적(22점)</button>
                  <button type="button" class="btn quiet" data-stress-preset="48" style="padding:3px 8px; font-size:11px;">표준(48점)</button>
                  <button type="button" class="btn quiet" data-stress-preset="68" style="padding:3px 8px; font-size:11px;">확장(68점)</button>
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:10px;">
                <input id="mom-stress-slider" type="range" min="0" max="100" step="1" value="${Math.round(fx.effective_score)}" style="flex:1;">
                <span id="mom-stress-slider-val" style="font-weight:800; font-size:13px; min-width:48px; text-align:right;">${n(fx.effective_score, 0)}점</span>
              </div>
            </div>
          </div>

          <!-- Right: Current Active Momentum Strategy Policy Card -->
          <div style="background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:14px; display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="tag" style="background:${pol.regime_color}; color:#fff; font-weight:800; padding:4px 10px; font-size:12px;">
                  현재 운용 국면: ${esc(pol.regime_name)}
                </span>
                <span style="font-size:12px; font-weight:700; color:var(--muted);">
                  기본 1슬롯 예산 $${n(momPayload.strategy_meta?.base_budget_usd || 35000, 0)} × 국면배수 ${n(pol.fx_stress_mult, 2)}x
                </span>
              </div>
              <p style="margin:8px 0 12px; font-size:13px; line-height:1.55; color:var(--text);">
                ${esc(pol.regime_desc)}
              </p>
            </div>

            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; font-size:12px;">
              <div style="background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 10px;">
                <div style="color:var(--muted); font-size:11px;">단계별 진입·증액 신호 기준</div>
                <div style="font-weight:800; margin-top:3px;">
                  1차 진입(1/3) ≥ ${n(pol.scout_thr, 2)}<br>
                  2차 배분(2/3) ≥ ${n(pol.main_thr, 2)}<br>
                  <span style="color:${pol.regime_color};">3차 배분(3/3) ≥ ${n(pol.full_thr, 2)}</span>
                </div>
              </div>
              <div style="background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 10px;">
                <div style="color:var(--muted); font-size:11px;">부분익절 · 추세 보유 기준</div>
                <div style="font-weight:800; margin-top:3px; color:${pol.partial_tp_mode === 'HOLD_RUNNER_135R' ? '#dc2626' : '#059669'};">
                  목표 +${n(pol.partial_tp_r, 2)}R
                </div>
                <div style="font-size:11px; color:var(--muted); margin-top:2px;">${esc(pol.partial_tp_label)}</div>
              </div>
              <div style="background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 10px;">
                <div style="color:var(--muted); font-size:11px;">눌림목 재진입 · 감축 · 타임스탑</div>
                <div style="font-weight:800; margin-top:3px;">
                  재진입: ${pol.reentry_allowed ? 'MA20 지지 시 허용' : '보류 (보수적 운용)'}<br>
                  감축: |S0| &lt; ${n(pol.trim_thr, 2)}<br>
                  타임스탑: D+${pol.time_stop_days}일
                </div>
              </div>
            </div>

            <!-- Stressed FX Pairs & FX Futures Strip -->
            <div style="margin-top:10px; padding-top:8px; border-top:1px dashed var(--line); font-size:11.5px; display:flex; flex-direction:column; gap:4px;">
              <div>
                <b style="color:var(--muted);">평균회귀 이탈 상위 FX 페어:</b>
                ${(fx.top_stressed_fx_pairs || [])
                  .slice(0, 4)
                  .map(
                    (p) =>
                      `<span class="tag" style="margin-left:4px; font-size:11px;">${esc(p.name)} OOS ${sg(p.oos_z, 2)} / 괴리 ${n(p.z_drift, 2)}σ</span>`
                  )
                  .join('')}
              </div>
              <div>
                <b style="color:var(--muted);">7대 통화선물 달러 모멘텀:</b>
                ${(fx.fx_futures || [])
                  .map(
                    (f) =>
                      `<span style="margin-left:6px;"><b>${esc(f.id)}</b>(${sg(f.recipe1_score, 2)})</span>`
                  )
                  .join(' · ')}
              </div>
            </div>
          </div>
        </div>

        ${
          showRegimeMatrix
            ? `
        <div class="table-scroll" style="margin-top:14px;">
          <table>
            <thead>
              <tr>
                <th>FX 스트레스 구간</th>
                <th>전략 운용 국면</th>
                <th>DV01 배수</th>
                <th>1차 진입 (1/3)</th>
                <th>2차 배분 (2/3)</th>
                <th>3차 최대 배분 (3/3)</th>
                <th>부분익절 / 추세 보유 기준</th>
                <th>MA20 눌림목 재진입</th>
                <th>선제 감축 기준</th>
                <th>타임스탑</th>
              </tr>
            </thead>
            <tbody>
              ${(pol.regime_matrix || [])
                .map(
                  (r) => `
                <tr style="${r.is_active ? `background:rgba(234,88,12,0.08); font-weight:700;` : ''}">
                  <td><b>${esc(r.range)}</b> ${r.is_active ? '<span class="tag primary">현재 적용</span>' : ''}</td>
                  <td style="color:${r.color}; font-weight:800;">${esc(r.name)}</td>
                  <td>${esc(r.fx_stress_mult)}</td>
                  <td>${esc(r.scout_thr)}</td>
                  <td>${esc(r.main_thr)}</td>
                  <td><b>${esc(r.full_thr)}</b></td>
                  <td>${esc(r.partial_tp)}</td>
                  <td>${esc(r.reentry)}</td>
                  <td>${esc(r.trim_rule)}</td>
                  <td>${esc(r.time_stop)}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>`
            : ''
        }
      </div>

      <!-- SECTION 2A: Signal Selection & Direct Position Entry Desk (User-Decided Entry -> Position Monitor Sync) -->
      <div class="panel" style="border-top:3px solid #0284c7;">
        <div class="panel-head" style="flex-wrap:wrap; gap:10px;">
          <div>
            <div class="eyebrow" style="color:#0284c7; font-weight:800;">SIGNAL SELECTION & DIRECT POSITION ENTRY DESK</div>
            <h2>시그널 종목 선택 & 포지션 진입 입력 데스크 (포지션 모니터 연동)</h2>
            <small>시스템이 임의로 포지션을 자동 등록하지 않습니다. 시그널을 확인한 뒤 <b>진입할 종목·배분 단계·계약수·체결 진입 레벨</b>을 직접 입력해 등록하면 <b>포지션 모니터(#book)</b>와 아래 보유 포지션 현황판에 즉시 반영됩니다.</small>
          </div>
        </div>

        <!-- Quick Signal Candidate Pills (Click to load into Entry Form) -->
        <div style="margin-bottom:12px;">
          <div style="font-size:12px; font-weight:700; color:var(--muted); margin-bottom:6px;">
            1. 국가 커브별 대표 테너 시그널 (클릭 시 아래 진입 입력 폼에 해당 종목 및 권장 계약수 자동 반영)
          </div>
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px;">
            ${curves
              .map((cg) => {
                const bInst = instruments.find((x) => x.id === cg.best_id) || {};
                const isPicked = entryInst?.id === cg.best_id;
                return `
              <button type="button" data-pick-entry-core="${esc(cg.best_id)}" class="btn quiet" style="text-align:left; padding:10px 12px; border-radius:10px; border:2px solid ${isPicked ? '#0284c7' : 'var(--line)'}; background:${isPicked ? 'rgba(2,132,199,0.08)' : 'var(--panel2)'};">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-weight:800; font-size:13px;">${cg.flag} ${esc(cg.best_id)} (${esc(cg.best_contract)})</span>
                  <span class="tag ${cg.aligned_count >= 2 ? 'primary' : ''}" style="font-size:10.5px;">${esc(cg.conv_badge)}</span>
                </div>
                <div style="font-weight:900; font-size:13.5px; margin-top:4px; color:${cg.best_direction > 0 ? '#059669' : '#dc2626'};">
                  S0 ${sg(cg.best_score, 3)} · ${esc(cg.best_dir_label)}
                </div>
                <div style="font-size:11px; color:var(--muted); margin-top:3px;">
                  권장 계약: 1차 ${bInst.scout_contracts} / 2차 <b>${bInst.main_contracts}</b> / 3차 <b>${bInst.full_contracts}계약</b> (@${n(bInst.raw_close, 3)})
                </div>
              </button>`;
              })
              .join('')}
          </div>
        </div>

        <!-- Inline Entry Form -->
        <form id="mom-inline-entry-form" style="background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <div style="font-size:13px; font-weight:800;">
              2. 포지션 진입 상세 입력 · 선택 종목: <span style="color:#0284c7;">${entryInst.curve_flag} ${esc(entryInst.name)} (${esc(entryInst.contract)})</span>
              <span style="font-size:12px; color:var(--muted); font-weight:600; margin-left:6px;">
                (현재 시그널: ${esc(entryInst.signal_stage_label)} · 1계약 DV01 $${n(entryInst.dv01_per_contract_usd, 0)}/bp)
              </span>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn quiet inline-stage-btn ${entryFormStage === 'STAGE_1_SCOUT' ? 'primary' : ''}" data-inline-stage="STAGE_1_SCOUT" data-contracts="${entryInst.scout_contracts}" style="padding:4px 10px; font-size:12px;">
                1차 초기 진입 (${entryInst.scout_contracts}계약)
              </button>
              <button type="button" class="btn quiet inline-stage-btn ${entryFormStage === 'STAGE_2_MAIN' ? 'primary' : ''}" data-inline-stage="STAGE_2_MAIN" data-contracts="${entryInst.main_contracts}" style="padding:4px 10px; font-size:12px;">
                2차 표준 배분 (${entryInst.main_contracts}계약)
              </button>
              <button type="button" class="btn quiet inline-stage-btn ${entryFormStage === 'STAGE_3_FULL' ? 'primary' : ''}" data-inline-stage="STAGE_3_FULL" data-contracts="${entryInst.full_contracts}" style="padding:4px 10px; font-size:12px;">
                3차 최대 배분 (${entryInst.full_contracts}계약)
              </button>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:10px; align-items:end;">
            <label style="font-size:12px;">진입 종목 선택
              <select id="ie-core" style="margin-top:4px;">
                ${instruments
                  .map(
                    (inst) =>
                      `<option value="${esc(inst.id)}" ${inst.id === entryInst.id ? 'selected' : ''}>${inst.curve_flag} ${esc(inst.id)} (${esc(inst.contract)}) · ${sg(inst.recipe1?.score, 2)}</option>`
                  )
                  .join('')}
              </select>
            </label>

            <label style="font-size:12px;">포지션 방향
              <select id="ie-side1" style="margin-top:4px;">
                <option value="-1" ${entryInst.direction < 0 ? 'selected' : ''}>▼ 채권 SHORT (금리↑)</option>
                <option value="1" ${entryInst.direction > 0 ? 'selected' : ''}>▲ 채권 LONG (금리↓)</option>
              </select>
            </label>

            <label style="font-size:12px;">계약수 (Contracts)
              <input id="ie-contracts" type="number" min="1" max="2000" step="1" value="${entryDefaultContracts}" required style="margin-top:4px; font-weight:800;">
            </label>

            <label style="font-size:12px;">진입 선물 레벨 (${esc(entryInst.contract)})
              <input id="ie-fpx" type="number" step="any" value="${entryInst.raw_close}" required style="margin-top:4px; font-weight:800;">
            </label>

            <label style="font-size:12px;">대응 금리 레벨 (%)
              <input id="ie-quote1" type="number" step="any" value="${entryInst.current_yield_pct}" required style="margin-top:4px;">
            </label>

            <label style="font-size:12px;">초기 변동성 스탑 (2.5×SD20)
              <input id="ie-stop" type="number" step="any" value="${entryInst.levels.stop_raw}" required style="margin-top:4px; color:#dc2626; font-weight:700;">
            </label>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-top:12px; padding-top:10px; border-top:1px dashed var(--line);">
            <div id="ie-preview" style="font-size:12.5px; font-weight:700; color:var(--text);"></div>
            <div style="display:flex; gap:8px; align-items:center;">
              <input id="ie-date" type="date" value="${esc(s?.as_of || today())}" max="${today()}" style="padding:5px 8px; font-size:12px;">
              <select id="ie-ccy" style="padding:5px 8px; font-size:12px;">
                <option value="USD" selected>USD ($/bp)</option>
                <option value="KRW">KRW (만원/bp)</option>
              </select>
              <button type="submit" id="ie-submit-btn" class="btn primary" style="padding:8px 16px; font-weight:800;">
                진입 확정 및 포지션 모니터 등록
              </button>
            </div>
          </div>
        </form>
      </div>

      <!-- SECTION 2B: Active Momentum Positions Cockpit & Scale-Up / Scale-Down Action Guide -->
      <div class="panel">
        <div class="panel-head" style="flex-wrap:wrap; gap:10px;">
          <div>
            <div class="eyebrow">ACTIVE MOMENTUM POSITIONS & DYNAMIC SCALING GUIDE</div>
            <h2>보유 모멘텀 포지션 현황 & 계약 규모 조정(Scale-Up / Scale-Down) 가이드</h2>
            <small>직접 진입 등록한 포지션의 현재 상태와 FX 스트레스 국면에 따른 목표 계약수 편차, 이후 계약을 증액·축소·청산해야 하는 가격 및 신호 기준을 확인하고 실행합니다.</small>
          </div>
          <div class="control-buttons">
            <button type="button" class="btn quiet" id="mom-goto-book-2">▤ 포지션 모니터(#book)에서 전체 포트폴리오 보기 ↗</button>
          </div>
        </div>

        ${
          activePositions.length === 0
            ? `<div class="empty" style="padding:28px;">현재 진입 등록된 모멘텀 포지션이 없습니다. 위 <b>[시그널 종목 선택 & 포지션 진입 입력 데스크]</b>에서 계약수와 진입 레벨을 입력하고 <b>[진입 확정 및 포지션 모니터 등록]</b>을 클릭하면 이곳과 <b>포지션 모니터(#book)</b>에 동시에 표시됩니다.</div>`
            : activePositions
                .map((pos) => {
                  const t = pos.triggers || {};
                  return `
          <div style="border:2px solid ${pos.action_color}; border-radius:12px; padding:16px; margin-top:10px; background:var(--panel);">
            <!-- Dynamic Action Headline Banner -->
            <div style="background:${pos.action_color}14; border-left:4px solid ${pos.action_color}; padding:10px 14px; border-radius:8px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
              <div>
                <div style="font-weight:900; font-size:15px; color:${pos.action_color};">${esc(pos.action_title)}</div>
                <div style="font-size:12.5px; color:var(--text); margin-top:3px;">${esc(pos.action_detail)}</div>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button type="button" class="btn primary" data-pos-scaleup="${esc(pos.id)}" style="background:#ea580c; border-color:#ea580c;">
                  +계약 증액 (${pos.contract_delta > 0 ? `+${pos.contract_delta}` : `+${t.full_add_contracts || 10}`}계약)
                </button>
                <button type="button" class="btn quiet" data-pos-tp="${esc(pos.id)}" style="color:#059669; border-color:#059669; font-weight:700;">
                  50% 부분익절 (-${t.partial_tp_contracts}계약)
                </button>
                <button type="button" class="btn quiet" data-pos-trim="${esc(pos.id)}" style="color:#d97706; border-color:#d97706;">
                  비중 축소 (-${pos.contract_delta < 0 ? Math.abs(pos.contract_delta) : t.trim_contracts}계약)
                </button>
                <button type="button" class="btn quiet" data-pos-edit="${esc(pos.id)}">✎ 수정</button>
                <button type="button" class="btn quiet" data-pos-close="${esc(pos.id)}" style="color:#dc2626;">✕ 전량 청산</button>
                <button type="button" class="btn quiet" data-pos-inspect="${esc(pos.core_id)}">상세 기준표</button>
              </div>
            </div>

            <!-- Position Core Status Strip -->
            <div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:10px; margin-bottom:14px;">
              <div style="background:var(--panel2); border:1px solid var(--line); border-radius:8px; padding:10px;">
                <div style="font-size:11px; color:var(--muted);">종목 · 방향 · 커브 동조</div>
                <div style="font-weight:900; font-size:14px; margin-top:2px;">${pos.curve_flag} ${esc(pos.name)}</div>
                <div style="font-size:12px; font-weight:800; color:${pos.side1 > 0 ? '#059669' : '#dc2626'};">${esc(pos.direction_label)}</div>
                <div style="font-size:11px; color:var(--muted); margin-top:2px;">${esc(pos.conv_badge)} (${n(pos.total_dv01_mult, 2)}x)</div>
              </div>

              <div style="background:var(--panel2); border:1px solid var(--line); border-radius:8px; padding:10px;">
                <div style="font-size:11px; color:var(--muted);">현재 보유 vs 국면 목표 계약</div>
                <div style="font-weight:900; font-size:16px; margin-top:2px;">
                  ${pos.current_contracts}계약
                  <span style="font-size:12px; color:var(--muted);">/ 목표 ${pos.regime_target_contracts}계약</span>
                </div>
                <div style="font-size:11.5px; font-weight:700; color:${pos.contract_delta > 0 ? '#ea580c' : pos.contract_delta < 0 ? '#d97706' : '#059669'}; margin-top:2px;">
                  편차 ${sg(pos.contract_delta, 0)}계약 (${esc(pos.regime_target_stage_label)})
                </div>
              </div>

              <div style="background:var(--panel2); border:1px solid var(--line); border-radius:8px; padding:10px;">
                <div style="font-size:11px; color:var(--muted);">현재 금리 민감도 (DV01)</div>
                <div style="font-weight:900; font-size:15px; margin-top:2px;">$${n(pos.current_dv01_usd, 0)} / bp</div>
                <div style="font-size:12px; color:var(--muted); margin-top:2px;">약 ${n(pos.current_dv01_manwon, 1)}만원 / bp</div>
                <div style="font-size:11px; color:var(--muted);">1계약당 $${n(pos.dv01_per_contract_usd, 0)}/bp</div>
              </div>

              <div style="background:var(--panel2); border:1px solid var(--line); border-radius:8px; padding:10px;">
                <div style="font-size:11px; color:var(--muted);">평균 진입 레벨 → 현재가</div>
                <div style="font-weight:900; font-size:15px; margin-top:2px;">
                  ${n(pos.entry_futures_px, 4)} → <span style="color:#0284c7;">${n(pos.current_futures_px, 4)}</span>
                </div>
                <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">
                  대응 금리 ${n(pos.entry_quote1, 3)}% → ${n(pos.current_quote1, 3)}%
                </div>
              </div>

              <div style="background:var(--panel2); border:1px solid var(--line); border-radius:8px; padding:10px;">
                <div style="font-size:11px; color:var(--muted);">평가손익 · R-배수 (위험예산 대비)</div>
                <div style="font-weight:900; font-size:16px; margin-top:2px; color:${pos.pnl_usd >= 0 ? '#059669' : '#dc2626'};">
                  $${sg(pos.pnl_usd, 0)} (${sg(pos.r_multiple, 2)}R)
                </div>
                <div style="font-size:11px; color:var(--muted); margin-top:2px;">
                  실현 $${sg(pos.realized_pnl, 0)} · 최고 ${sg(pos.hwm_r, 2)}R
                </div>
              </div>

              <div style="background:var(--panel2); border:1px solid var(--line); border-radius:8px; padding:10px;">
                <div style="font-size:11px; color:var(--muted);">현재 모멘텀 신호 · 보유 기간</div>
                <div style="font-weight:900; font-size:15px; margin-top:2px;">
                  S0 = ${sg(pos.current_score, 3)} (|${n(pos.current_abs_score, 3)}|)
                </div>
                <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">
                  진입 ${esc(pos.entry_date)} (D+${pos.days_held} / 타임스탑 ${pos.time_stop_limit}일)
                </div>
              </div>
            </div>

            <!-- 6-Card Trigger Strip: Exact Criteria for Scaling Up & Scaling Down -->
            <div style="font-size:12px; font-weight:800; color:var(--muted); margin-bottom:6px;">
              포지션 계약 규모 확대(Scale-Up) · 축소(Scale-Down) · 청산(Exit) 실행 기준선
            </div>
            <div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:8px; font-size:12px;">
              <div style="border:1px solid var(--line); border-left:3px solid #7c3aed; border-radius:8px; padding:8px 10px;">
                <div style="font-weight:800; color:#7c3aed;">2차 표준 배분 (2/3) 기준</div>
                <div style="font-weight:900; font-size:13.5px; margin-top:2px;">선물가 ${n(t.add20_px, 3)}</div>
                <div style="font-size:11px; color:var(--muted);">|S0| ≥ ${n(pol.main_thr, 2)} & 20D 돌파 → 목표 ${pos.main_contracts}계약</div>
              </div>

              <div style="border:1px solid var(--line); border-left:3px solid #ea580c; border-radius:8px; padding:8px 10px;">
                <div style="font-weight:800; color:#ea580c;">3차 최대 배분 (3/3) 기준</div>
                <div style="font-weight:900; font-size:13.5px; margin-top:2px;">선물가 ${n(t.full_upgrade_px, 3)}</div>
                <div style="font-size:11px; color:var(--muted);">|S0| ≥ ${n(pol.full_thr, 2)} 도달 시 <b>+${t.full_add_contracts}계약</b> (총 ${pos.full_contracts}계약)</div>
              </div>

              <div style="border:1px solid var(--line); border-left:3px solid #059669; border-radius:8px; padding:8px 10px;">
                <div style="font-weight:800; color:#059669;">1차 부분익절 / 추세 보유</div>
                <div style="font-weight:900; font-size:13.5px; margin-top:2px;">선물가 ${n(t.partial_tp_px, 3)} (+${n(t.partial_tp_r, 2)}R)</div>
                <div style="font-size:11px; color:var(--muted);">
                  ${pol.partial_tp_mode === 'HOLD_RUNNER_135R' ? '+0.90R 부분익절 유예 · +1.35R까지 추세 보유' : `도달 시 <b>-${t.partial_tp_contracts}계약(50%)</b> 익절 & BE스탑`}
                </div>
              </div>

              <div style="border:1px solid var(--line); border-left:3px solid #0284c7; border-radius:8px; padding:8px 10px;">
                <div style="font-weight:800; color:#0284c7;">부분익절 후 눌림목 재진입</div>
                <div style="font-weight:900; font-size:13.5px; margin-top:2px;">MA20 ${n(t.pullback_ma20_px, 3)}</div>
                <div style="font-size:11px; color:var(--muted);">
                  ${pol.reentry_allowed ? `부분익절 후 MA20 지지 시 <b>+${t.partial_tp_contracts}계약</b> 재진입` : '현재 보수적 운용 국면으로 재진입 비활성'}
                </div>
              </div>

              <div style="border:1px solid var(--line); border-left:3px solid #d97706; border-radius:8px; padding:8px 10px;">
                <div style="font-weight:800; color:#d97706;">모멘텀 둔화 감축 기준</div>
                <div style="font-weight:900; font-size:13.5px; margin-top:2px;">|S0| &lt; ${n(pol.trim_thr, 2)} 둔화 시</div>
                <div style="font-size:11px; color:var(--muted);">채널 이탈 전 선제적으로 <b>-${t.trim_contracts}계약(1/3)</b> 축소</div>
              </div>

              <div style="border:1px solid var(--line); border-left:3px solid #dc2626; border-radius:8px; padding:8px 10px;">
                <div style="font-weight:800; color:#dc2626;">변동성 스탑 / 10D 청산선</div>
                <div style="font-weight:900; font-size:13.5px; margin-top:2px;">스탑 ${n(t.stop_px, 3)} / 채널 ${n(t.chan10_exit_px, 3)}</div>
                <div style="font-size:11px; color:var(--muted);">도달 시 잔여 <b>${pos.current_contracts}계약 전량 청산</b></div>
              </div>
            </div>
          </div>`;
                })
                .join('')
        }
      </div>

      <!-- SECTION 3: Country Curve Best-Tenor Concentration Cards -->
      <div class="panel">
        <div class="panel-head" style="flex-wrap:wrap; gap:10px;">
          <div>
            <div class="eyebrow">REPRESENTATIVE TENOR DV01 ALLOCATION BY CURVE</div>
            <h2>국가 커브별 대표 테너 선정 & 전체 금리선물 시그널 모니터</h2>
            <small>동일 커브 내 복수 테너(예: 미국 TU·FV·TY, 독일 DU·OE·RX)에서 동시 신호가 발생할 경우 만기를 분산하지 않고, 신호 강도가 가장 높은 <b>대표 테너에 단일 진입하되 커브 동조 배수만큼 DV01을 확대 배분</b>합니다.</small>
          </div>
          <div class="segmented">
            ${[
              ['ALL', '전체 커브 (13종목)'],
              ['US', '🇺🇸 미국 국채'],
              ['DE', '🇩🇪 독일 국채'],
              ['KR', '🇰🇷 한국 국채'],
              ['EU', '🇪🇺 유럽(이탈리아·프랑스)'],
            ]
              .map(
                ([k, label]) =>
                  `<button type="button" data-curve-filter="${k}" class="${curveFilter === k ? 'on' : ''}">${label}</button>`
              )
              .join('')}
          </div>
        </div>

        <!-- 4 Curve Group Cards -->
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; margin-bottom:16px;">
          ${curves
            .map((cg) => {
              const bestInst = instruments.find((x) => x.id === cg.best_id);
              return `
            <div style="border:1px solid var(--line); border-top:3px solid ${cg.best_direction > 0 ? '#059669' : '#dc2626'}; border-radius:10px; padding:12px; background:var(--panel2); display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-weight:800; font-size:13.5px;">${cg.flag} ${esc(cg.name)}</span>
                  <span class="tag ${cg.aligned_count >= 2 ? 'primary' : ''}" style="font-size:11px;">${esc(cg.conv_badge)}</span>
                </div>
                <div style="margin:8px 0; padding:8px 10px; background:var(--panel); border:1px solid var(--line); border-radius:8px;">
                  <div style="font-size:11px; color:var(--muted);">★ 커브 대표 테너 (DV01 집중 배분)</div>
                  <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:2px;">
                    <b style="font-size:15px;">${esc(cg.best_id)} (${esc(cg.best_contract)})</b>
                    <span style="font-weight:900; font-size:14px; color:${cg.best_direction > 0 ? '#059669' : '#dc2626'};">
                      ${sg(cg.best_score, 3)} · ${esc(cg.best_dir_label)}
                    </span>
                  </div>
                  <div style="font-size:11.5px; color:var(--muted); margin-top:4px;">
                    커브배수 <b>${n(cg.curve_mult, 2)}x</b> × FX스트레스 <b>${n(cg.fx_stress_mult, 2)}x</b> = 총 <b>${n(cg.total_dv01_mult, 2)}x DV01</b>
                  </div>
                </div>
                <!-- Tenor Comparison Pills -->
                <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">
                  ${(cg.tenor_pills || [])
                    .map(
                      (tp) => `
                    <span style="font-size:11px; padding:2px 6px; border-radius:4px; border:1px solid ${tp.is_best ? '#0284c7' : 'var(--line)'}; background:${tp.is_best ? '#e0f2fe' : 'var(--panel)'}; color:${tp.is_best ? '#0369a1' : 'var(--text)'}; font-weight:${tp.is_best ? '800' : '500'};">
                      ${tp.is_best ? '★ ' : ''}${esc(tp.id)}(${esc(tp.tenor)}): ${sg(tp.score, 2)}
                    </span>`
                    )
                    .join('')}
                </div>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding-top:8px; border-top:1px dashed var(--line);">
                <span style="font-size:11.5px; font-weight:700;">
                  권장: ${bestInst ? `${bestInst.main_contracts}~${bestInst.full_contracts}계약` : '—'}
                </span>
                <div style="display:flex; gap:4px;">
                  <button type="button" class="btn quiet" data-select-core="${esc(cg.best_id)}" style="padding:4px 8px; font-size:11.5px;">기준표</button>
                  <button type="button" class="btn primary" data-open-core="${esc(cg.best_id)}" style="padding:4px 8px; font-size:11.5px;">포지션 진입 입력</button>
                </div>
              </div>
            </div>`;
            })
            .join('')}
        </div>

        <!-- 13 Rates Futures Table -->
        <div class="table-scroll">
          <table class="wide-table">
            <thead>
              <tr>
                <th>커브 / 종목 (월물)</th>
                <th>커브 내 순위 · 배분 역할</th>
                <th class="number">현재 선물가<br>(대응 금리)</th>
                <th class="number">모멘텀 점수 (S0)<br>시그널 방향</th>
                <th>현재 국면 신호 단계</th>
                <th class="number">단계별 목표 계약수<br>(1차 1/3 · 2차 2/3 · 3차 3/3)</th>
                <th class="number">주요 실행 가격 기준선<br>(20D 증액 / 부분익절 / 2.5σ 스탑)</th>
                <th>포지션 진입 / 상세</th>
              </tr>
            </thead>
            <tbody>
              ${filteredInstruments
                .map((inst) => {
                  const isSel = inst.id === chosenInst?.id;
                  const heldPos = activePositions.find((p) => p.core_id === inst.id);
                  return `
                <tr data-select-row="${esc(inst.id)}" class="${isSel ? 'selected' : ''}" style="cursor:pointer;">
                  <td>
                    <b>${inst.curve_flag} ${esc(inst.name)}</b> <span class="tag">${esc(inst.contract)}</span>
                    <div class="pair-sub">${esc(inst.node_name)} · 1계약 DV01 $${n(inst.dv01_per_contract_usd, 0)}/bp</div>
                  </td>
                  <td>
                    ${
                      inst.is_best_in_curve
                        ? `<span class="tag primary" style="font-weight:800;">★ 커브 대표 테너 (${n(inst.total_dv01_mult, 2)}x)</span>`
                        : `<span class="tag" style="opacity:0.75;">커브 ${inst.rank_in_curve}순위 (${esc(inst.best_id_in_curve)} 대표 배분)</span>`
                    }
                    <div class="pair-sub">${esc(inst.conv_badge)}</div>
                  </td>
                  <td class="number">
                    <b>${n(inst.raw_close, 4)}</b>
                    <div class="pair-sub">${n(inst.current_yield_pct, 3)}% · SD20 ${n(inst.sd20, 4)}</div>
                  </td>
                  <td class="number" style="color:${inst.direction > 0 ? '#059669' : '#dc2626'}; font-weight:800;">
                    ${sg(inst.recipe1?.score, 3)}
                    <div class="pair-sub">${esc(inst.direction_label)}</div>
                  </td>
                  <td>
                    <span class="tag ${inst.signal_stage === 'STAGE_3_FULL' ? 'primary' : inst.signal_stage === 'WAIT' ? '' : 'hold'}">${esc(inst.signal_stage_label)}</span>
                    ${heldPos ? `<div class="pair-sub" style="color:#0284c7; font-weight:800;">● 현재 ${heldPos.current_contracts}계약 보유 중</div>` : ''}
                  </td>
                  <td class="number">
                    <b>${inst.scout_contracts}</b> / <b style="color:#7c3aed;">${inst.main_contracts}</b> / <b style="color:#ea580c;">${inst.full_contracts}계약</b>
                    <div class="pair-sub">최대 $${n(inst.full_dv01_usd, 0)}/bp (${n((inst.full_dv01_usd * momPayload.usd_krw_rate) / 10000, 0)}만원/bp)</div>
                  </td>
                  <td class="number">
                    증액 <b>${n(inst.levels.add_main_raw, 3)}</b> · 익절 <b style="color:#059669;">${n(inst.levels.partial_tp_raw, 3)}</b>
                    <div class="pair-sub">스탑 <span style="color:#dc2626; font-weight:700;">${n(inst.levels.stop_raw, 3)}</span> · 10D채널 ${n(inst.levels.chan10_exit_raw, 3)}</div>
                  </td>
                  <td>
                    <div style="display:flex; gap:4px; flex-wrap:wrap;">
                      <button type="button" class="btn primary" data-open-core="${esc(inst.id)}" style="padding:4px 8px; font-size:11.5px;">진입 입력</button>
                      <button type="button" class="btn quiet" data-select-core="${esc(inst.id)}" style="padding:4px 8px; font-size:11.5px;">상세 기준</button>
                    </div>
                  </td>
                </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- SECTION 4: Selected Instrument Detailed Scale-Up / Scale-Down Rules & 6-Horizon Decomposition -->
      ${
        chosenInst
          ? `
      <div class="panel" id="mom-detail-workbench">
        <div class="panel-head" style="flex-wrap:wrap; gap:10px;">
          <div>
            <div class="eyebrow">DETAILED POSITION SCALING & EXIT RULES WORKBENCH</div>
            <h2>${chosenInst.curve_flag} ${esc(chosenInst.name)} (${esc(chosenInst.contract)}) · 계약 규모 증액·축소·청산 상세 기준표</h2>
            <small>
              현재 선물가 <b>${n(chosenInst.raw_close, 4)}</b> · 모멘텀 점수 <b>${sg(chosenInst.recipe1?.score, 3)}</b> ·
              커브 배수 <b>${n(chosenInst.curve_mult, 2)}x</b> × FX 스트레스 배수 <b>${n(chosenInst.fx_stress_mult, 2)}x</b> = 총 <b>${n(chosenInst.total_dv01_mult, 2)}x</b> 배분 기준
            </small>
          </div>
          <div class="control-buttons" style="display:flex; gap:6px;">
            <button type="button" class="btn quiet" data-open-core-stage="${esc(chosenInst.id)}:STAGE_1_SCOUT">1차 초기 진입 (${chosenInst.scout_contracts}계약)</button>
            <button type="button" class="btn primary" data-open-core-stage="${esc(chosenInst.id)}:STAGE_2_MAIN">2차 표준 배분 (${chosenInst.main_contracts}계약)</button>
            <button type="button" class="btn quiet" data-open-core-stage="${esc(chosenInst.id)}:STAGE_3_FULL" style="color:#ea580c; border-color:#ea580c; font-weight:800;">3차 최대 배분 (${chosenInst.full_contracts}계약)</button>
          </div>
        </div>

        <!-- 8-Row Scale-Up / Scale-Down / Exit Rule Table -->
        <div class="table-scroll" style="margin-bottom:16px;">
          <table class="wide-table">
            <thead>
              <tr>
                <th>구분 / 단계</th>
                <th>발동 조건 (가격 돌파 · 모멘텀 점수 · FX 스트레스 국면 연동)</th>
                <th class="number">기준 선물가격<br>(${esc(chosenInst.contract)})</th>
                <th>계약 규모 조정 액션</th>
                <th>DV01 변동 및 조정 후 규모</th>
                <th>현재 충족 상태</th>
                <th>운용 기준 설명</th>
              </tr>
            </thead>
            <tbody>
              ${(chosenInst.scale_rules || [])
                .map(
                  (r) => `
                <tr>
                  <td><b>${esc(r.badge)}</b></td>
                  <td>${esc(r.condition)}</td>
                  <td class="number"><b>${n(r.trigger_px, 4)}</b></td>
                  <td style="font-weight:800; color:${r.category === 'SCALE_UP' || r.category === 'ENTRY' ? '#ea580c' : r.category === 'SCALE_DOWN' ? '#059669' : '#dc2626'};">
                    ${esc(r.contract_action)}
                  </td>
                  <td>
                    <b>${esc(r.dv01_action)}</b>
                    <div class="pair-sub">조정 후 잔여: ${r.after_contracts}계약</div>
                  </td>
                  <td>
                    ${
                      r.is_met
                        ? '<span class="tag primary" style="font-weight:800;">조건 충족</span>'
                        : '<span class="tag">대기 / 감시</span>'
                    }
                  </td>
                  <td class="pair-sub" style="max-width:260px;">${esc(r.note)}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>

        <!-- Bottom Split: 60-Day SVG Chart + 6-Horizon Signal Decomposition -->
        <div style="display:grid; grid-template-columns:1.25fr 1fr; gap:16px;">
          <div style="background:#ffffff; color:#0f172a; border:1px solid #cbd5e1; border-radius:10px; padding:14px;">
            <h3 style="margin:0 0 8px; font-size:14px; color:#0f172a; font-weight:800;">최근 60거래일 선물 종가 · 모멘텀 신호 · 스탑/익절 기준선</h3>
            ${renderHistorySvgChart(chosenInst)}
          </div>

          <div style="background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:12px;">
            <h3 style="margin:0 0 8px; font-size:14px;">6개 관측 주기(7D~112D) 모멘텀 신호 분해 (변위 70% + 이평 30%)</h3>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>관측 주기</th>
                    <th class="number">가중치</th>
                    <th class="number">변위 Z (70%)</th>
                    <th class="number">이평 Z (30%)</th>
                    <th class="number">주기 신호 S_k</th>
                  </tr>
                </thead>
                <tbody>
                  ${(chosenInst.horizon_details || [])
                    .map(
                      (h, idx) => `
                    <tr>
                      <td><b>${esc(h.label)} (${h.days}D)</b></td>
                      <td class="number">${n((chosenInst.recipe1?.weights?.[idx] || 0) * 100, 1)}%</td>
                      <td class="number">${sg(h.z_disp, 2)}</td>
                      <td class="number">${sg(h.z_ma, 2)}</td>
                      <td class="number" style="font-weight:800; color:${h.s_rec1 > 0 ? '#059669' : '#dc2626'};">
                        ${sg(h.s_rec1, 3)}
                      </td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>`
          : ''
      }
    </div>
  `;

  // Bind Inline Entry Desk Logic
  function updateInlinePreview() {
    const c = Math.max(1, Math.round(Number($('#ie-contracts')?.value) || 1));
    const dvPerC = Number(entryInst.dv01_per_contract_usd || 70);
    const krwRate = Number(momPayload.usd_krw_rate || 1390);
    const dvUsd = c * dvPerC;
    const dvManwon = (dvUsd * krwRate) / 10000;
    const estRiskUsd = c * Number(entryInst.loss_per_contract_usd || 800);
    const prevEl = $('#ie-preview');
    if (prevEl) {
      prevEl.innerHTML =
        `진입 요약: <b>${esc(entryInst.contract)} ${c}계약</b> (${Number($('#ie-side1')?.value) > 0 ? '▲ LONG' : '▼ SHORT'}) · ` +
        `단일 금리 민감도(DV01) <b>$${n(dvUsd, 1)}/bp</b> (약 <b>${n(dvManwon, 1)}만원/bp</b>) · ` +
        `2.5×SD20 변동성 스탑 기준 예상 위험예산 <b>$${n(estRiskUsd, 0)}</b>`;
    }
  }
  updateInlinePreview();

  target.querySelectorAll('[data-pick-entry-core]').forEach((btn) => {
    btn.onclick = () => {
      entryFormCoreId = btn.dataset.pickEntryCore;
      selectedCoreId = entryFormCoreId;
      renderMomentumStrategy(target);
    };
  });

  const ieCoreSel = $('#ie-core');
  if (ieCoreSel) {
    ieCoreSel.onchange = () => {
      entryFormCoreId = ieCoreSel.value;
      selectedCoreId = entryFormCoreId;
      renderMomentumStrategy(target);
    };
  }

  target.querySelectorAll('.inline-stage-btn').forEach((btn) => {
    btn.onclick = () => {
      entryFormStage = btn.dataset.inlineStage;
      const cInput = $('#ie-contracts');
      if (cInput) cInput.value = btn.dataset.contracts;
      target.querySelectorAll('.inline-stage-btn').forEach((b) => b.classList.remove('primary'));
      btn.classList.add('primary');
      updateInlinePreview();
    };
  });

  if ($('#ie-contracts')) $('#ie-contracts').oninput = updateInlinePreview;
  if ($('#ie-side1')) {
    $('#ie-side1').onchange = () => {
      const s1 = Number($('#ie-side1').value);
      const fpx = Number($('#ie-fpx').value) || entryInst.raw_close;
      if ($('#ie-stop')) $('#ie-stop').value = (fpx - s1 * entryInst.stop_dist_pt).toFixed(4);
      updateInlinePreview();
    };
  }
  if ($('#ie-fpx')) {
    $('#ie-fpx').oninput = () => {
      const s1 = Number($('#ie-side1').value);
      const fpx = Number($('#ie-fpx').value);
      if (Number.isFinite(fpx) && fpx > 0 && $('#ie-stop')) {
        $('#ie-stop').value = (fpx - s1 * entryInst.stop_dist_pt).toFixed(4);
      }
    };
  }

  const inlineForm = $('#mom-inline-entry-form');
  if (inlineForm) {
    inlineForm.onsubmit = async (e) => {
      e.preventDefault();
      const c = Math.max(1, Math.round(Number($('#ie-contracts').value) || 1));
      const ccy = $('#ie-ccy').value;
      const dvPerC = Number(entryInst.dv01_per_contract_usd || 70);
      const krwRate = Number(momPayload.usd_krw_rate || 1390);
      const dvUsd = c * dvPerC;
      const dvManwon = (dvUsd * krwRate) / 10000;
      const side1 = Number($('#ie-side1').value);
      const fpx = Number($('#ie-fpx').value);
      const quote1 = Number($('#ie-quote1').value);
      const stopFpx = Number($('#ie-stop').value);
      const stgLabel =
        entryFormStage === 'STAGE_3_FULL'
          ? `3차 최대 배분 (${c}계약)`
          : entryFormStage === 'STAGE_1_SCOUT'
          ? `1차 초기 진입 (${c}계약)`
          : `2차 표준 배분 (${c}계약)`;

      const payload = {
        action: 'manual_open',
        shape: 'SINGLE',
        strategy: 'MOMENTUM',
        rates_currency: ccy,
        name: `${entryInst.node_name} (${entryInst.contract} 국채선물)`,
        node1: `${entryInst.node_name} (${entryInst.contract})`,
        leg1: entryInst.leg1_id,
        leg2: null,
        side1,
        side2: 0,
        entry_date: $('#ie-date').value,
        quote1,
        quote2: 0,
        contracts: c,
        entry_futures_px: fpx,
        total_dv01_usd: dvUsd,
        total_sensitivity_manwon: dvManwon,
        leg1_weight: 100,
        hardcap: Math.round(c * Number(entryInst.loss_per_contract_usd || 850) * (ccy === 'KRW' ? krwRate : 1)),
        notes: `모멘텀 전략 · ${entryInst.curve_group_name} (${entryInst.contract}) ${side1 < 0 ? 'SHORT' : 'LONG'} ${c}계약 @ ${fpx} 직접 진입 (${pol.regime_short})`,
        momentum_meta: {
          core_id: entryInst.id,
          contract: entryInst.contract,
          curve_group: entryInst.curve_group,
          pricing_mode: 'FUTURES',
          contracts: c,
          initial_contracts: c,
          peak_contracts: c,
          entry_futures_px: fpx,
          initial_futures_px: fpx,
          current_futures_px: entryInst.raw_close,
          point_value: entryInst.point_value,
          tick_size: entryInst.tick_size,
          tick_value: entryInst.tick_value,
          fx_rate: entryInst.fx || 1.0,
          dv01_per_contract_usd: dvPerC,
          stage: entryFormStage,
          stage_label: stgLabel,
          main_stage_done: entryFormStage !== 'STAGE_1_SCOUT',
          full_stage_done: entryFormStage === 'STAGE_3_FULL',
          partial_tp_done: false,
          be_stop_armed: false,
          days_held: 1,
          hwm_r: 0.0,
          planned_risk_usd: Math.round(c * Number(entryInst.loss_per_contract_usd || 850)),
          stop_futures_px: stopFpx,
          partial_tp_futures_px: entryInst.levels.partial_tp_raw,
          full_upgrade_futures_px: entryInst.levels.full_upgrade_raw,
          chan10_exit_futures_px: entryInst.levels.chan10_exit_raw,
        },
      };

      try {
        const subBtn = $('#ie-submit-btn');
        if (subBtn) subBtn.disabled = true;
        await ctx.api('/api/positions', payload);
        await ctx.onChange();
        await fetchMomentumPayload(false);
        renderMomentumStrategy(target);
        ctx.toast(`${entryInst.contract} ${c}계약(@ ${fpx}) 진입이 완료되어 포지션 모니터(#book)에 등록되었습니다.`);
      } catch (err) {
        ctx.toast('포지션 진입 오류: ' + err.message);
      } finally {
        const subBtn = $('#ie-submit-btn');
        if (subBtn) subBtn.disabled = false;
      }
    };
  }

  // Bind interactive handlers
  const toggleBtn = $('#mom-toggle-matrix');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      showRegimeMatrix = !showRegimeMatrix;
      renderMomentumStrategy(target);
    };
  }

  const refreshDbBtn = $('#mom-refresh-db');
  if (refreshDbBtn) {
    refreshDbBtn.onclick = async () => {
      refreshDbBtn.disabled = true;
      refreshDbBtn.textContent = '↻ DB 동기화 중...';
      await fetchMomentumPayload(true);
      renderMomentumStrategy(target);
      ctx.toast('FITD 선물 DB 최신 바 및 모멘텀 전략 신호를 동기화했습니다.');
    };
  }

  const gotoBookBtn = $('#mom-goto-book');
  if (gotoBookBtn) gotoBookBtn.onclick = () => ctx.setTab('book');
  const gotoBookBtn2 = $('#mom-goto-book-2');
  if (gotoBookBtn2) gotoBookBtn2.onclick = () => ctx.setTab('book');

  // FX Stress Preset buttons & Slider
  target.querySelectorAll('[data-stress-preset]').forEach((btn) => {
    btn.onclick = async () => {
      const val = btn.dataset.stressPreset;
      stressOverride = val === 'auto' ? null : Number(val);
      await fetchMomentumPayload(false);
      renderMomentumStrategy(target);
      ctx.toast(
        stressOverride === null
          ? `실시간 FX 스트레스 지수(${n(momPayload.fx_stress.actual_score, 1)}점) 자동 연동 모드로 전환되었습니다.`
          : `FX 스트레스 지수 ${stressOverride}점 시뮬레이션 적용 → [${momPayload.active_policy.regime_name}] 전환 완료`
      );
    };
  });

  const slider = $('#mom-stress-slider');
  if (slider) {
    slider.oninput = () => {
      const lbl = $('#mom-stress-slider-val');
      if (lbl) lbl.textContent = `${slider.value}점`;
    };
    slider.onchange = async () => {
      stressOverride = Number(slider.value);
      await fetchMomentumPayload(false);
      renderMomentumStrategy(target);
      ctx.toast(`FX 스트레스 지수 ${stressOverride}점 기준 전략 및 보유 포지션 상태가 갱신되었습니다.`);
    };
  }

  // Curve group filter buttons
  target.querySelectorAll('[data-curve-filter]').forEach((btn) => {
    btn.onclick = () => {
      curveFilter = btn.dataset.curveFilter;
      renderMomentumStrategy(target);
    };
  });

  // Select core instrument for detailed workbench
  target.querySelectorAll('[data-select-core]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      selectedCoreId = btn.dataset.selectCore;
      renderMomentumStrategy(target);
      document.getElementById('mom-detail-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  target.querySelectorAll('[data-select-row]').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest('button')) return;
      selectedCoreId = row.dataset.selectRow;
      entryFormCoreId = selectedCoreId;
      renderMomentumStrategy(target);
    };
  });

  // Open new Momentum position dialogs
  target.querySelectorAll('[data-open-core]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const inst = instruments.find((x) => x.id === btn.dataset.openCore);
      if (inst) openMomentumEntryDialog(inst, 'STAGE_2_MAIN');
    };
  });

  target.querySelectorAll('[data-open-core-stage]').forEach((btn) => {
    btn.onclick = () => {
      const [cid, stg] = btn.dataset.openCoreStage.split(':');
      const inst = instruments.find((x) => x.id === cid);
      if (inst) openMomentumEntryDialog(inst, stg);
    };
  });

  // Active Position Action Buttons
  target.querySelectorAll('[data-pos-scaleup]').forEach((btn) => {
    btn.onclick = () => {
      const pos = activePositions.find((p) => p.id === btn.dataset.posScaleup);
      if (pos) openScaleUpDialog(pos);
    };
  });

  target.querySelectorAll('[data-pos-tp]').forEach((btn) => {
    btn.onclick = () => {
      const pos = activePositions.find((p) => p.id === btn.dataset.posTp);
      if (pos) openScaleDownOrCloseDialog(pos, 'PARTIAL_TP');
    };
  });

  target.querySelectorAll('[data-pos-trim]').forEach((btn) => {
    btn.onclick = () => {
      const pos = activePositions.find((p) => p.id === btn.dataset.posTrim);
      if (pos) openScaleDownOrCloseDialog(pos, 'TRIM');
    };
  });

  target.querySelectorAll('[data-pos-close]').forEach((btn) => {
    btn.onclick = () => {
      const pos = activePositions.find((p) => p.id === btn.dataset.posClose);
      if (pos) openScaleDownOrCloseDialog(pos, 'FULL_CLOSE');
    };
  });

  target.querySelectorAll('[data-pos-edit]').forEach((btn) => {
    btn.onclick = () => {
      const pos = activePositions.find((p) => p.id === btn.dataset.posEdit);
      if (pos) openMomentumEditDialog(pos);
    };
  });

  target.querySelectorAll('[data-pos-inspect]').forEach((btn) => {
    btn.onclick = () => {
      selectedCoreId = btn.dataset.posInspect;
      renderMomentumStrategy(target);
      document.getElementById('mom-detail-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}
