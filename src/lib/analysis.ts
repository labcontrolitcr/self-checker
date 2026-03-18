import type { PlantConfig } from '$lib/config/plants.config';

export interface ESSWindow {
  center_time: number;
  mean: number;
  error_pct: number;
  k_start: number;
  k_end: number;
}

export interface AnalysisResult {
  // Settling time
  ST_score: number;
  ST_comment: string;
  ST_prop_ok: number;
  settling_time_actual: number | null;

  // Overshoot (IAE^1.5 based)
  OS_score: number;
  OS_comment: string;
  OS_val: number;          // peak of smoothed signal in transient
  OS_lim: number;
  OS_iae: number;          // raw IAE^1.5 area (debug)

  // Undershoot (symmetric, same metric)
  US_score: number;
  US_comment: string;
  US_val: number;
  US_iae: number;

  // ESS
  ESS_pre_score: number;
  ESS_pre_comment: string;
  ESS_pre: ESSWindow;
  ESS_post_score: number;
  ESS_post_comment: string;
  ESS_post: ESSWindow;
  ESS_score: number;

  // Perturbation
  Pert_score: number;          // combined (recovery + settling) / 2
  Pert_comment: string;
  Pert_err_pct: number;
  Pert_recovery_score: number;
  Pert_recovery_comment: string;
  Pert_ST_score: number;
  Pert_ST_comment: string;
  Pert_ST_prop_ok: number;

  // Final
  final_score: number;
  rise_time: number | null;

  // Warnings
  exp_start_warning: string | null;
  ess_step_warning: string | null;
  pert_warning: string | null;

  // Smoothed signal for chart
  smoothed: number[];
  smoothed_dt: number;     // dt used (for chart x-axis alignment)
  ma_window: number;       // MA window size used (samples)
}

// ─────────────────────────────────────────────────────────────────────────────

export function parseCSVHeaders(raw: string): string[] | null {
  const lines = raw.trim().split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return null;
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const firstCell = lines[0].split(delimiter)[0].trim();
  if (!isNaN(Number(firstCell))) return null;
  return lines[0].split(delimiter).map(h => h.trim());
}

export function parseCSV(raw: string, col_names: string[]): Record<string, number>[] {
  const lines = raw.trim().split('\n').filter(l => l.trim().length > 0);
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const firstCell = lines[0].split(delimiter)[0].trim();
  const startRow = isNaN(Number(firstCell)) ? 1 : 0;
  return lines.slice(startRow).map(line => {
    const parts = line.split(delimiter);
    const row: Record<string, number> = {};
    col_names.forEach((name, idx) => { row[name] = parseFloat(parts[idx] ?? '0'); });
    return row;
  });
}

function nearestIdx(time: number[], t: number): number {
  let best = 0, bestDist = Math.abs(time[0] - t);
  for (let i = 1; i < time.length; i++) {
    const d = Math.abs(time[i] - t);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// ── Adaptive MA filter ────────────────────────────────────────────────────────
// Window = max(5, round(TARGET_MS / dt)).  Short enough to follow the signal,
// long enough to kill sample-to-sample noise.
const MA_TARGET_MS = 80;   // ms — empirically good for Motor CD at 5–20ms/sample

function adaptiveMA(signal: number[], dt: number): { smoothed: number[]; winSize: number } {
  const winSize = Math.max(5, Math.round((MA_TARGET_MS / 1000) / dt));
  const half    = Math.floor(winSize / 2);
  const n       = signal.length;
  const out     = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo  = Math.max(0, i - half);
    const hi  = Math.min(n - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += signal[j];
    out[i] = sum / (hi - lo + 1);
  }
  return { smoothed: out, winSize };
}

// ── IAE^α over-band area ──────────────────────────────────────────────────────
// Integrates |error|^alpha * dt only where signal is outside [lo, hi].
// "error" is measured from the nearest band edge (0 inside band).
const IAE_ALPHA = 1.5;

function iaeOutOfBand(
  signal: number[], time: number[],
  lo: number, hi: number,
  fromIdx: number, toIdx: number
): number {
  let area = 0;
  for (let i = fromIdx; i < toIdx; i++) {
    const v = signal[i];
    const err = v > hi ? v - hi : v < lo ? lo - v : 0;
    if (err > 0) {
      const dt = time[i + 1] !== undefined ? time[i + 1] - time[i] : time[i] - time[i - 1];
      area += Math.pow(err, IAE_ALPHA) * Math.abs(dt);
    }
  }
  return area;
}

// ── Calibration constant k ────────────────────────────────────────────────────
// Chosen so that OS_lim sustained from settling_idx to t_obj gives score = 70.
// Derivation:
//   boundary error = ref * tol_os  (signal exactly at OS_lim)
//   calibration_duration = t_win   (duration of evaluation window)
//   iae_ref = (ref * tol_os)^1.5 * t_win
//   penalty_at_70 = 30
//   k = 30 / iae_ref
// This is computed per-call because ref, tol_os, t_win vary per plant.
function calibrateK(ref: number, tol_os: number, t_win: number): number {
  const boundary_err  = ref * tol_os;
  const iae_ref       = Math.pow(boundary_err, IAE_ALPHA) * t_win;
  return iae_ref > 0 ? 30 / iae_ref : 1;
}

// ─────────────────────────────────────────────────────────────────────────────

export function analyzeResponse(
  rows: Record<string, number>[],
  config: PlantConfig & { experiment_start?: number }
): AnalysisResult {
  const {
    time_col, control_col,
    ref, tol_st, t_obj, t_win, tol_os, ess_tol, ess_k_win,
    perturbation_start, perturbation_window, pert_recovery_k_win,
    weights,
    experiment_start = 0,
  } = config;

  const trimmed = experiment_start > 0
    ? rows.filter(r => r[time_col] >= experiment_start)
    : rows;

  const time   = trimmed.map(r => r[time_col]);
  const velRaw = trimmed.map(r => r[control_col]);

  // ── Spike filter ──────────────────────────────────────────────────────────
  const SPIKE_DELTA = 0.5;
  const vel = velRaw.slice();
  for (let i = 1; i < vel.length; i++) {
    if (Math.abs(vel[i] - vel[i - 1]) > SPIKE_DELTA) vel[i] = vel[i - 1];
  }

  const n  = vel.length;
  const dt = n > 1 ? (time[n - 1] - time[0]) / (n - 1) : 0.005;

  // ── Adaptive MA smoothed signal ───────────────────────────────────────────
  const { smoothed, winSize: ma_window } = adaptiveMA(vel, dt);

  // ── Experiment start validation ───────────────────────────────────────────
  const EXP_START_WIN      = 10;
  const EXP_START_ABS_TOL  = 0.20;
  const EXP_START_ZSCORE   = 5;

  let preSlice: number[];
  if (experiment_start > 0) {
    const preRows = rows.filter(r => r[time_col] < experiment_start);
    const preSig  = preRows.map(r => r[control_col]);
    preSlice = preSig.slice(Math.max(0, preSig.length - EXP_START_WIN));
  } else {
    preSlice = vel.slice(0, Math.min(EXP_START_WIN, n));
  }

  const initMean = preSlice.length > 0
    ? preSlice.reduce((a, b) => a + b, 0) / preSlice.length : 0;
  const initStd  = preSlice.length > 1
    ? Math.sqrt(preSlice.reduce((acc, v) => acc + (v - initMean) ** 2, 0) / (preSlice.length - 1))
    : 0;
  const initAbsOk  = Math.abs(initMean) < EXP_START_ABS_TOL * ref;
  const initZScore = initStd > 0 ? Math.abs(initMean) / initStd : 0;
  const initZOk    = initZScore <= EXP_START_ZSCORE;
  const exp_start_warning: string | null = (!initAbsOk && !initZOk)
    ? `Inicio de experimento inválido: las ${preSlice.length} muestras en el punto de inicio promedian ${initMean.toFixed(4)} (${(Math.abs(initMean)/ref*100).toFixed(1)}% de la referencia, z=${initZScore.toFixed(1)}). El sistema debe estar en reposo al inicio del experimento.`
    : null;

  const st_lo = ref * (1 - tol_st);
  const st_hi = ref * (1 + tol_st);
  const os_lo = ref * (1 - tol_os);   // undershoot limit
  const os_hi = ref * (1 + tol_os);   // overshoot limit

  const pert_start_for_st = nearestIdx(time, perturbation_start);

  // ── ST real: last entry into band on smoothed signal ─────────────────────
  // Find the LAST time the smoothed signal crosses into the band and stays.
  // "Stays" = MA never exits the band again before perturbation.
  // Algorithm: scan forward, track last_entry_idx each time MA re-enters band.
  const ST_MA_WIN    = 10;
  const ST_MA_CONSEC = 40;

  let st_stable_idx: number | null = null;
  let st_consec = 0;
  for (let i = ST_MA_WIN; i < pert_start_for_st; i++) {
    const ma = smoothed[i];
    if (ma >= st_lo && ma <= st_hi) {
      st_consec++;
      if (st_consec >= ST_MA_CONSEC && st_stable_idx === null) {
        st_stable_idx = i - ST_MA_CONSEC + 1;
      }
    } else {
      st_consec = 0;
    }
  }

  // Real ST: scan from st_stable_idx forward, find LAST exit+reentry before perturbation
  // (if the smoothed signal leaves the band and comes back, the real ST is that last reentry)
  let real_st_idx = st_stable_idx;
  if (st_stable_idx !== null) {
    let last_exit_reentry: number | null = null;
    let in_band = true;
    for (let i = st_stable_idx + 1; i < pert_start_for_st; i++) {
      const ma = smoothed[i];
      const now_in = ma >= st_lo && ma <= st_hi;
      if (in_band && !now_in) {
        in_band = false;
      } else if (!in_band && now_in) {
        last_exit_reentry = i;
        in_band = true;
      }
    }
    if (last_exit_reentry !== null) real_st_idx = last_exit_reentry;
  }

  const t_obj_idx      = time.findIndex(t => t >= t_obj);
  const st_eval_start  = real_st_idx !== null
    ? Math.max(t_obj_idx >= 0 ? t_obj_idx : 0, real_st_idx)
    : (t_obj_idx >= 0 ? t_obj_idx : 0);

  const idx_win  = time.reduce<number[]>((acc, t, i) => {
    if (i >= st_eval_start && t <= t_obj + t_win) acc.push(i);
    return acc;
  }, []);
  const y_check  = idx_win.map(i => smoothed[i]);
  const prop_ok  = y_check.length > 0
    ? y_check.filter(v => v >= st_lo && v <= st_hi).length / y_check.length : 0;

  const st_eval_t      = real_st_idx !== null ? time[st_eval_start] : t_obj;
  const st_eval_t_rel  = st_eval_t - experiment_start;  // relative to exp start
  const ST_score   = 100 * prop_ok;
  const ST_comment = `${(prop_ok*100).toFixed(0)}% de muestras en banda [${st_lo.toFixed(3)}, ${st_hi.toFixed(3)}] desde t=${st_eval_t_rel.toFixed(3)}s — ${ST_score.toFixed(1)}/100`;

  // settling_time_actual = first raw sample in band (informational marker)
  let settling_time_actual: number | null = null;
  for (let i = 0; i < pert_start_for_st; i++) {
    if (vel[i] >= st_lo && vel[i] <= st_hi) { settling_time_actual = time[i] - experiment_start; break; }
  }

  // ── Rise time ─────────────────────────────────────────────────────────────
  let rise_time: number | null = null;
  for (let i = 1; i < n; i++) {
    if (vel[i-1] < ref && vel[i] >= ref) {
      const t0 = time[i-1], t1 = time[i], v0 = vel[i-1], v1 = vel[i];
      rise_time = t0 + (ref - v0) / (v1 - v0) * (t1 - t0) - experiment_start;
      break;
    }
  }

  // ── OS / Undershoot: threshold-based scoring on smoothed peak ───────────────
  // Scoring curve:
  //   pct ∈ [0, tol_os]        → score = 100  (cumple el requisito del instructivo)
  //   pct ∈ (tol_os, 2*tol_os] → score = 100 → 0  (penaliza proporcionalmente al exceso)
  //   pct > 2*tol_os            → score = 0
  function osScore(pct: number): number {
    if (pct <= tol_os)         return 100;
    if (pct <= 2 * tol_os)     return 100 - ((pct - tol_os) / tol_os) * 100;
    return 0;
  }

  // First raw entry into ST band — US only valid after signal arrives
  let first_in_band_idx = pert_start_for_st - 1;
  for (let i = 0; i < pert_start_for_st; i++) {
    if (vel[i] >= st_lo && vel[i] <= st_hi) { first_in_band_idx = i; break; }
  }

  // OS: peak of smoothed from start → pert_start (full pre-pert transient)
  const OS_val     = smoothed.slice(0, pert_start_for_st).reduce((m, v) => v > m ? v : m, -Infinity);
  const OS_pct     = Math.max(0, (OS_val - ref) / ref);
  const OS_score   = osScore(OS_pct);
  const OS_iae     = 0;  // kept for interface compatibility

  // US not graded — keep val for possible future use
  const US_val    = smoothed.slice(first_in_band_idx, pert_start_for_st).reduce((m, v) => v < m ? v : m, Infinity);
  const US_iae    = 0;
  const US_comment = '';

  const OS_comment = OS_pct < 0.001
    ? `OS: sin sobreimpulso (pico ${OS_val.toFixed(4)}) — ${OS_score.toFixed(1)}/100`
    : OS_pct <= tol_os
      ? `OS: ${(OS_pct*100).toFixed(2)}% < ${(tol_os*100).toFixed(1)}% — dentro del límite — ${OS_score.toFixed(1)}/100`
      : `OS: ${(OS_pct*100).toFixed(2)}% de sobreimpulso — excede límite ${(tol_os*100).toFixed(1)}% (exceso ${((OS_pct - tol_os)*100).toFixed(2)}%) — ${OS_score.toFixed(1)}/100`;

  const OS_score_combined = OS_score;

  // ── ESS step guard ────────────────────────────────────────────────────────
  const ESS_MAX_STEP = 1.0;
  function hasExcessiveStep(slice: number[]): boolean {
    for (let i = 1; i < slice.length; i++) {
      if (Math.abs(slice[i] - slice[i - 1]) > ESS_MAX_STEP) return true;
    }
    return false;
  }

  // ── ESS pre ───────────────────────────────────────────────────────────────
  const ess_band_half      = tol_st * ref;
  const ESS_STD_WARN       = 0.6;   // std > 60% of band_half → starts penalizing
  const ESS_STD_ZERO       = 1.0;
  const ess_tol_pct        = ess_tol * 100;

  const ess_pre_end_i   = Math.max(0, pert_start_for_st - 1);
  const ess_pre_start_i = Math.max(0, ess_pre_end_i - ess_k_win + 1);
  const ess_pre_slice   = vel.slice(ess_pre_start_i, ess_pre_end_i + 1);
  const ess_pre_mean    = ess_pre_slice.length > 0
    ? ess_pre_slice.reduce((a, b) => a + b, 0) / ess_pre_slice.length : ref;
  const ess_pre_err     = Math.abs(ess_pre_mean - ref) / ref * 100;
  const ESS_pre: ESSWindow = { center_time: time[ess_pre_end_i], mean: ess_pre_mean, error_pct: ess_pre_err, k_start: ess_pre_start_i, k_end: ess_pre_end_i };

  const ess_pre_step_bad   = hasExcessiveStep(ess_pre_slice);
  const ess_pre_std        = ess_pre_slice.length > 1
    ? Math.sqrt(ess_pre_slice.reduce((acc, v) => acc + (v - ess_pre_mean) ** 2, 0) / (ess_pre_slice.length - 1)) : 0;
  const ess_pre_std_ratio  = ess_pre_std / ess_band_half;
  const ess_pre_std_factor = ess_pre_std_ratio <= ESS_STD_WARN ? 1.0
    : ess_pre_std_ratio >= ESS_STD_ZERO ? 0.0
    : 1.0 - (ess_pre_std_ratio - ESS_STD_WARN) / (ESS_STD_ZERO - ESS_STD_WARN);

  let ESS_pre_score: number, ESS_pre_comment: string;
  if (ess_pre_step_bad) {
    ESS_pre_score   = 0;
    ESS_pre_comment = `ESS pre inválido: salto > ${ESS_MAX_STEP}V en ventana — 0/100`;
  } else if (ess_pre_std_factor === 0.0) {
    ESS_pre_score   = 0;
    ESS_pre_comment = `Señal demasiado ruidosa pre-perturbación (std=${ess_pre_std.toFixed(4)}, ${ess_pre_std_ratio.toFixed(2)}× banda ±${ess_band_half.toFixed(3)}) — el sistema no está controlado — 0/100`;
  } else {
    if (ess_pre_err <= ess_tol_pct) {
      ESS_pre_score   = 100 * ess_pre_std_factor;
      ESS_pre_comment = ess_pre_std_factor < 1.0
        ? `ESS ${ess_pre_err.toFixed(3)}% en rango pero ruidoso (std=${ess_pre_std.toFixed(4)}) — ${ESS_pre_score.toFixed(1)}/100`
        : `ESS ${ess_pre_err.toFixed(3)}% dentro del rango (tol ${ess_tol_pct.toFixed(1)}%) — 100/100`;
    } else {
      const pre_over = ess_pre_err - ess_tol_pct;
      const base = pre_over <= ess_tol_pct
        ? Math.max(0, 100 - pre_over * (50 / ess_tol_pct))
        : Math.max(0, 50  - (pre_over - ess_tol_pct) * (50 / (2 * ess_tol_pct)));
      ESS_pre_score   = base * ess_pre_std_factor;
      ESS_pre_comment = `ESS ${ess_pre_err.toFixed(3)}% fuera del rango (tol ${ess_tol_pct.toFixed(1)}%, exceso ${pre_over.toFixed(3)}%${ess_pre_std_factor < 1.0 ? `, ruidoso std=${ess_pre_std.toFixed(4)}` : ''}) — ${ESS_pre_score.toFixed(1)}/100`;
    }
  }

  // ── ESS post ──────────────────────────────────────────────────────────────
  const ess_post_search_start = time.findIndex(t => t >= perturbation_start + perturbation_window);
  const ess_post_search_si    = ess_post_search_start >= 0 ? ess_post_search_start : n - 1;

  let ess_post_stable_idx: number | null = null;
  let ess_post_consec = 0;
  for (let i = ess_post_search_si + ST_MA_WIN; i < n; i++) {
    const ma = smoothed[i];
    if (ma >= st_lo && ma <= st_hi) {
      ess_post_consec++;
      if (ess_post_consec >= ST_MA_CONSEC && ess_post_stable_idx === null) {
        ess_post_stable_idx = i - ST_MA_CONSEC + 1;
      }
    } else {
      ess_post_consec = 0;
    }
  }

  const ess_post_si    = ess_post_stable_idx ?? ess_post_search_si;
  const ess_post_ei    = Math.min(n - 1, ess_post_si + pert_recovery_k_win - 1);
  const ess_post_slice = vel.slice(ess_post_si, ess_post_ei + 1);
  const ess_post_mean  = ess_post_slice.length > 0
    ? ess_post_slice.reduce((a, b) => a + b, 0) / ess_post_slice.length : ref;
  const ess_post_err   = Math.abs(ess_post_mean - ref) / ref * 100;
  const ESS_post: ESSWindow = { center_time: time[ess_post_si], mean: ess_post_mean, error_pct: ess_post_err, k_start: ess_post_si, k_end: ess_post_ei };

  const ess_post_step_bad   = hasExcessiveStep(ess_post_slice);
  const ess_post_std        = ess_post_slice.length > 1
    ? Math.sqrt(ess_post_slice.reduce((acc, v) => acc + (v - ess_post_mean) ** 2, 0) / (ess_post_slice.length - 1)) : 0;
  const ess_post_std_ratio  = ess_post_std / ess_band_half;
  const ess_post_std_factor = ess_post_std_ratio <= ESS_STD_WARN ? 1.0
    : ess_post_std_ratio >= ESS_STD_ZERO ? 0.0
    : 1.0 - (ess_post_std_ratio - ESS_STD_WARN) / (ESS_STD_ZERO - ESS_STD_WARN);

  let ESS_post_score: number, ESS_post_comment: string;
  if (ess_post_step_bad) {
    ESS_post_score   = 0;
    ESS_post_comment = `ESS post inválido: salto > ${ESS_MAX_STEP}V en ventana — 0/100`;
  } else if (ess_post_std_factor === 0.0) {
    ESS_post_score   = 0;
    ESS_post_comment = `Señal demasiado ruidosa post-perturbación (std=${ess_post_std.toFixed(4)}, ${ess_post_std_ratio.toFixed(2)}× banda ±${ess_band_half.toFixed(3)}) — el sistema no está controlado — 0/100`;
  } else {
    if (ess_post_err <= ess_tol_pct) {
      ESS_post_score   = 100 * ess_post_std_factor;
      ESS_post_comment = ess_post_std_factor < 1.0
        ? `ESS ${ess_post_err.toFixed(3)}% en rango pero ruidoso (std=${ess_post_std.toFixed(4)}) — ${ESS_post_score.toFixed(1)}/100`
        : `ESS ${ess_post_err.toFixed(3)}% dentro del rango (tol ${ess_tol_pct.toFixed(1)}%) — 100/100`;
    } else {
      const post_over = ess_post_err - ess_tol_pct;
      const base = post_over <= ess_tol_pct
        ? Math.max(0, 100 - post_over * (50 / ess_tol_pct))
        : Math.max(0, 50  - (post_over - ess_tol_pct) * (50 / (2 * ess_tol_pct)));
      ESS_post_score   = base * ess_post_std_factor;
      ESS_post_comment = `ESS ${ess_post_err.toFixed(3)}% fuera del rango (tol ${ess_tol_pct.toFixed(1)}%, exceso ${post_over.toFixed(3)}%${ess_post_std_factor < 1.0 ? `, ruidoso std=${ess_post_std.toFixed(4)}` : ''}) — ${ESS_post_score.toFixed(1)}/100`;
    }
  }

  const ess_noise_pre  = ess_pre_std_ratio  > ESS_STD_WARN;
  const ess_noise_post = ess_post_std_ratio > ESS_STD_WARN;
  const ess_step_warning: string | null =
    (ess_pre_step_bad || ess_post_step_bad)
      ? `Salto brusco entre muestras (> ${ESS_MAX_STEP}V) detectado${ess_pre_step_bad && ess_post_step_bad ? ' pre y post perturbación' : ess_pre_step_bad ? ' pre perturbación' : ' post perturbación'}. Verificá que el CSV no tenga datos corruptos.`
    : (ess_noise_pre || ess_noise_post)
      ? `Señal ruidosa en estado estable${ess_noise_pre && ess_noise_post ? ' pre y post perturbación' : ess_noise_pre ? ' pre perturbación' : ' post perturbación'}: ${ess_noise_pre ? `std_pre=${ess_pre_std.toFixed(4)} (${(ess_pre_std_ratio*100).toFixed(0)}% de la banda ±${ess_band_half.toFixed(3)})` : ''}${ess_noise_pre && ess_noise_post ? ' · ' : ''}${ess_noise_post ? `std_post=${ess_post_std.toFixed(4)} (${(ess_post_std_ratio*100).toFixed(0)}% de la banda ±${ess_band_half.toFixed(3)})` : ''}. El sistema parece no estar bien controlado (umbral: 60% de la banda).`
    : null;

  const ESS_score = (ESS_pre_score + ESS_post_score) / 2;

  // ── Perturbation recovery (ESS error after golpe) ───────────────────────
  const Pert_err_pct   = ess_post_err;
  const pert_eval_time = time[ess_post_si];
  const pert_eval_time_rel = pert_eval_time - perturbation_start;
  let Pert_recovery_score: number, Pert_recovery_comment: string;
  if (Pert_err_pct <= 2) {
    Pert_recovery_score   = 100;
    Pert_recovery_comment = `Recovery: error ${Pert_err_pct.toFixed(3)}% en t+${pert_eval_time_rel.toFixed(3)}s — 100/100`;
  } else {
    Pert_recovery_score   = Math.max(0, 100 - Pert_err_pct * 20);
    Pert_recovery_comment = `Recovery: error ${Pert_err_pct.toFixed(3)}% en t+${pert_eval_time_rel.toFixed(3)}s — ${Pert_recovery_score.toFixed(1)}/100`;
  }

  // ── Perturbation settling (fraction of smoothed signal in band after golpe) ──
  // Window: [pert_start + pert_window, pert_start + pert_window + t_win]
  // Absolute: works regardless of perturbation direction (positive or negative).
  // Uses smoothed signal (same as pre-perturbation ST) to avoid noise counting as out-of-band.
  const pert_st_start_t = perturbation_start + perturbation_window;
  const pert_st_end_t   = pert_st_start_t + t_win;
  const pert_st_idx_win = time.reduce<number[]>((acc, t, i) => {
    if (t >= pert_st_start_t && t <= pert_st_end_t) acc.push(i);
    return acc;
  }, []);
  const pert_st_samples  = pert_st_idx_win.map(i => smoothed[i]);
  const Pert_ST_prop_ok  = pert_st_samples.length > 0
    ? pert_st_samples.filter(v => v >= st_lo && v <= st_hi).length / pert_st_samples.length
    : 0;
  const Pert_ST_score    = 100 * Pert_ST_prop_ok;
  const Pert_ST_comment  = `Settling post-pert: ${(Pert_ST_prop_ok*100).toFixed(0)}% en banda en ventana [t+${(pert_st_start_t - perturbation_start).toFixed(3)}s, t+${(pert_st_end_t - perturbation_start).toFixed(3)}s] — ${Pert_ST_score.toFixed(1)}/100`;

  // Combined PERT = mean of recovery and settling
  const Pert_score   = (Pert_recovery_score + Pert_ST_score) / 2;
  const Pert_comment = `PERT combinado: recovery=${Pert_recovery_score.toFixed(1)} · settling=${Pert_ST_score.toFixed(1)} → ${Pert_score.toFixed(1)}/100`;

  // ── Perturbation validation ───────────────────────────────────────────────
  const PERT_WIN        = 40;
  const PERT_PRE_TOL    = 0.10;
  const PERT_ZSCORE_MIN = 3;
  const pert_start_idx  = nearestIdx(time, perturbation_start);
  const pert_pre_start  = Math.max(0, pert_start_idx - PERT_WIN);
  const pert_preSlice   = vel.slice(pert_pre_start, pert_start_idx);
  const pert_preMean    = pert_preSlice.length > 0
    ? pert_preSlice.reduce((a, b) => a + b, 0) / pert_preSlice.length : ref;
  const pert_preErr_pct = Math.abs(pert_preMean - ref) / ref * 100;
  const pert_preStd     = pert_preSlice.length > 1
    ? Math.sqrt(pert_preSlice.reduce((acc, v) => acc + (v - pert_preMean) ** 2, 0) / (pert_preSlice.length - 1)) : 0;
  const pert_post_end   = Math.min(n, pert_start_idx + PERT_WIN);
  const pert_postSlice  = vel.slice(pert_start_idx, pert_post_end);
  const pert_postMean   = pert_postSlice.length > 0
    ? pert_postSlice.reduce((a, b) => a + b, 0) / pert_postSlice.length : ref;
  const PERT_MIN_SHIFT_PCT = 0.10;
  const pert_shift      = Math.abs(pert_postMean - pert_preMean);
  const pert_shift_pct  = pert_shift / ref;
  const pert_zScore     = pert_preStd > 0
    ? pert_shift / pert_preStd
    : (pert_shift_pct >= PERT_MIN_SHIFT_PCT ? Infinity : 0);

  let pert_warning: string | null = null;
  if (pert_preErr_pct > PERT_PRE_TOL * 100) {
    pert_warning = `Las ${pert_preSlice.length} muestras antes de la perturbación promedian ${pert_preMean.toFixed(4)} (error ${pert_preErr_pct.toFixed(1)}% respecto a la referencia). El sistema debe estar en estado estable antes de la perturbación.`;
  } else if (pert_zScore < PERT_ZSCORE_MIN) {
    const detail = pert_preStd > 0
      ? `desplazamiento: ${pert_zScore.toFixed(1)}σ, se esperaba > ${PERT_ZSCORE_MIN}σ`
      : `desplazamiento: ${(pert_shift_pct * 100).toFixed(1)}% de la referencia, se esperaba > ${(PERT_MIN_SHIFT_PCT * 100).toFixed(0)}%`;
    pert_warning = `No se detecta una perturbación significativa (${detail}). Verificá el tiempo de inicio.`;
  }

  // ── Score overrides ───────────────────────────────────────────────────────
  const eff_ST_score       = exp_start_warning ? 0 : ST_score;
  const eff_OS_score       = exp_start_warning ? 0 : OS_score_combined;
  const eff_ESS_pre_score  = exp_start_warning ? 0 : ESS_pre_score;
  const eff_ESS_post_score = exp_start_warning ? 0 : ESS_post_score;
  const eff_ESS_score      = exp_start_warning ? 0 : ESS_score;
  const eff_Pert_score     = pert_warning       ? 0 : Pert_score;

  const final_score =
    (eff_ST_score * weights.ST + eff_OS_score * weights.OS + eff_ESS_score * weights.ESS + eff_Pert_score * weights.Pert) / 100;

  return {
    ST_score: eff_ST_score, ST_comment, ST_prop_ok: prop_ok, settling_time_actual,
    OS_score: eff_OS_score, OS_comment, OS_val, OS_lim: os_hi, OS_iae,
    US_score: 100, US_comment, US_val, US_iae,  // US not graded
    ESS_pre_score: eff_ESS_pre_score, ESS_pre_comment, ESS_pre,
    ESS_post_score: eff_ESS_post_score, ESS_post_comment, ESS_post,
    ESS_score: eff_ESS_score,
    Pert_score: eff_Pert_score, Pert_comment, Pert_err_pct,
    Pert_recovery_score: pert_warning ? 0 : Pert_recovery_score,
    Pert_recovery_comment,
    Pert_ST_score: pert_warning ? 0 : Pert_ST_score,
    Pert_ST_comment,
    Pert_ST_prop_ok,
    final_score,
    rise_time,
    exp_start_warning,
    ess_step_warning,
    pert_warning,
    smoothed,
    smoothed_dt: dt,
    ma_window,
  };
}