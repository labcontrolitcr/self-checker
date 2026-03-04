import type { PlantConfig } from '$lib/config/plants.config';

export interface ESSWindow {
  center_time: number;       // time of the center sample used
  mean: number;              // mean of the k_win samples around center
  error_pct: number;         // |mean - ref| / ref * 100
  k_start: number;           // first sample index used
  k_end: number;             // last sample index used
}

export interface AnalysisResult {
  // Settling time
  ST_score: number;
  ST_comment: string;
  ST_prop_ok: number;            // fraction 0-1 of samples in band during [t_obj, t_obj+t_win]
  settling_time_actual: number | null;  // first time signal enters and stays in band

  // Overshoot
  OS_score: number;
  OS_comment: string;
  OS_val: number;
  OS_lim: number;

  // ESS — pre-perturbation (evaluated at settling time or t_obj if not found)
  ESS_pre_score: number;
  ESS_pre_comment: string;
  ESS_pre: ESSWindow;

  // ESS — post-perturbation (evaluated at perturbation_start + perturbation_window)
  ESS_post_score: number;
  ESS_post_comment: string;
  ESS_post: ESSWindow;

  // Combined ESS score (mean of pre and post)
  ESS_score: number;

  // Perturbation recovery
  Pert_score: number;
  Pert_comment: string;
  Pert_err_pct: number;

  // Final weighted score
  final_score: number;

  // Rise time: first crossing of reference from below
  rise_time: number | null;

  // Experiment start validation
  exp_start_warning: string | null;   // null = ok, string = warning message

  // Perturbation validation
  pert_warning: string | null;         // null = ok, string = warning message
}

/**
 * Extract the actual column headers from a CSV string.
 * Returns null if the first row appears to be numeric (no headers).
 */
export function parseCSVHeaders(raw: string): string[] | null {
  const lines = raw.trim().split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return null;
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const firstCell = lines[0].split(delimiter)[0].trim();
  if (!isNaN(Number(firstCell))) return null; // no header row
  return lines[0].split(delimiter).map(h => h.trim());
}

/**
 * Parse a CSV string into row objects keyed by column name.
 * Handles comma or semicolon delimiters, skips header if present.
 */
export function parseCSV(raw: string, col_names: string[]): Record<string, number>[] {
  const lines = raw.trim().split('\n').filter(l => l.trim().length > 0);
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const firstCell = lines[0].split(delimiter)[0].trim();
  const startRow = isNaN(Number(firstCell)) ? 1 : 0;

  return lines.slice(startRow).map(line => {
    const parts = line.split(delimiter);
    const row: Record<string, number> = {};
    col_names.forEach((name, idx) => {
      row[name] = parseFloat(parts[idx] ?? '0');
    });
    return row;
  });
}

/**
 * Compute mean of a ±half_win sample window centered on index `center_idx`.
 * Clamps to array bounds.
 */
function windowedMean(
  signal: number[],
  time: number[],
  center_idx: number,
  k_win: number
): ESSWindow {
  const half = Math.floor(k_win / 2);
  const k_start = Math.max(0, center_idx - half);
  const k_end   = Math.min(signal.length - 1, center_idx + half);
  const slice   = signal.slice(k_start, k_end + 1);
  const mean    = slice.reduce((a, b) => a + b, 0) / slice.length;
  return {
    center_time: time[center_idx],
    mean,
    error_pct: 0, // filled in after ref is known
    k_start,
    k_end,
  };
}

/**
 * Score an ESS window result against tolerance.
 * Subtracts 20 pts per 1% over tolerance, floored at 0.
 */
function scoreESS(ess: ESSWindow, ref: number, ess_tol: number): { score: number; comment: string } {
  const err_pct = Math.abs(ess.mean - ref) / ref * 100;
  ess.error_pct = err_pct;
  const tol_pct = ess_tol * 100;

  if (err_pct <= tol_pct) {
    return { score: 100, comment: `ESS ${err_pct.toFixed(3)}% dentro del rango (tol ${tol_pct.toFixed(1)}%) — 100/100` };
  }
  const over = err_pct - tol_pct;
  const score = Math.max(0, 100 - over * 20);
  return { score, comment: `ESS ${err_pct.toFixed(3)}% fuera del rango (tol ${tol_pct.toFixed(1)}%, exceso ${over.toFixed(3)}%) — ${score.toFixed(1)}/100` };
}

/**
 * Find the nearest sample index for a given time value.
 */
function nearestIdx(time: number[], t: number): number {
  let best = 0;
  let bestDist = Math.abs(time[0] - t);
  for (let i = 1; i < time.length; i++) {
    const d = Math.abs(time[i] - t);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

/**
 * Full analysis — mirrors the MATLAB scripts with improved ESS evaluation.
 */
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

  // Trim rows to experiment window: only samples at or after experiment_start
  const trimmed = experiment_start > 0
    ? rows.filter(r => r[time_col] >= experiment_start)
    : rows;

  const time = trimmed.map(r => r[time_col]);
  const vel  = trimmed.map(r => r[control_col]);
  const n    = vel.length;

  // ── Experiment start validation ────────────────────────────────────────────
  // Look at the 10 samples around experiment_start to confirm the system is at rest
  // (signal near zero). Uses z-score: |mean| / std of those samples.
  // At true rest: mean ≈ 0, so z = |mean|/std ≈ 0-1.
  // Already at steady state: mean ≈ ref, so z = ref/std >> 1 (typically 50-200).
  // Threshold of 5 gives 0% false positives and 100% detection across typical noise levels.
  // If experiment_start > 0 uses the 10 samples just before it; otherwise uses the first 10.
  const EXP_START_WIN      = 10;
  const EXP_START_ZSCORE   = 5;    // |mean|/std threshold — above this = not at rest

  let preSlice: number[];
  if (experiment_start > 0) {
    const preRows = rows.filter(r => r[time_col] < experiment_start);
    const preSig  = preRows.map(r => r[control_col]);
    preSlice = preSig.slice(Math.max(0, preSig.length - EXP_START_WIN));
  } else {
    preSlice = vel.slice(0, Math.min(EXP_START_WIN, n));
  }

  const initMean = preSlice.length > 0
    ? preSlice.reduce((a, b) => a + b, 0) / preSlice.length
    : 0;
  const initStd = preSlice.length > 1
    ? Math.sqrt(preSlice.reduce((acc, v) => acc + (v - initMean) ** 2, 0) / (preSlice.length - 1))
    : 0;
  const initZScore = initStd > 0 ? Math.abs(initMean) / initStd : 0;

  const exp_start_warning: string | null = initZScore > EXP_START_ZSCORE
    ? `Inicio de experimento inválido: las ${preSlice.length} muestras en el punto de inicio promedian ${initMean.toFixed(4)} (z=${initZScore.toFixed(1)}, se esperaba < ${EXP_START_ZSCORE}). El sistema debe estar en reposo (señal cerca de cero) al inicio del experimento.`
    : null;

  const st_lo = ref * (1 - tol_st);
  const st_hi = ref * (1 + tol_st);

  // ── Settling Time ──────────────────────────────────────────────────────────
  // Fraction of samples in [t_obj, t_obj+t_win] inside the tolerance band
  const idx_win = time.reduce<number[]>((acc, t, i) => {
    if (t >= t_obj && t <= t_obj + t_win) acc.push(i);
    return acc;
  }, []);
  const y_check  = idx_win.map(i => vel[i]);
  const prop_ok  = y_check.length > 0
    ? y_check.filter(v => v >= st_lo && v <= st_hi).length / y_check.length
    : 0;

  const ST_score   = 100 * prop_ok;
  const ST_comment = `${(prop_ok*100).toFixed(0)}% de muestras en banda [${st_lo.toFixed(3)}, ${st_hi.toFixed(3)}] en [${t_obj}s, ${(t_obj+t_win).toFixed(1)}s] — ${ST_score.toFixed(1)}/100`;

  // Actual settling time — first index where signal stays in band until end
  let settling_time_actual: number | null = null;
  let settling_idx: number | null = null;
  for (let i = 0; i < n; i++) {
    if (vel.slice(i).every(v => v >= st_lo && v <= st_hi)) {
      settling_time_actual = time[i];
      settling_idx = i;
      break;
    }
  }

  // ── Rise time ──────────────────────────────────────────────────────────────
  let rise_time: number | null = null;
  for (let i = 1; i < n; i++) {
    if (vel[i-1] < ref && vel[i] >= ref) {
      const t0 = time[i-1], t1 = time[i], v0 = vel[i-1], v1 = vel[i];
      rise_time = t0 + (ref - v0) / (v1 - v0) * (t1 - t0);
      break;
    }
  }

  // ── Overshoot ──────────────────────────────────────────────────────────────
  // Search only in the transient: start → t_obj + t_win
  const trans_end = time.findIndex(t => t > t_obj + t_win);
  const transient = vel.slice(0, trans_end > 0 ? trans_end : n);
  const OS_val    = Math.max(...transient);
  const OS_lim    = ref * (1 + tol_os);

  let OS_score: number, OS_comment: string;
  if (OS_val <= OS_lim) {
    OS_score   = 100;
    OS_comment = `Overshoot correcto (${OS_val.toFixed(4)} <= ${OS_lim.toFixed(4)}) — 100/100`;
  } else {
    const exceso = (OS_val - OS_lim) / ref * 100;
    OS_score   = Math.max(0, 100 - exceso * 10);
    OS_comment = `Overshoot ${exceso.toFixed(2)}% sobre limite (${OS_val.toFixed(4)} > ${OS_lim.toFixed(4)}) — ${OS_score.toFixed(1)}/100`;
  }

  // ── ESS pre-perturbation ───────────────────────────────────────────────────
  // Center: actual settling time if found, otherwise nearest sample to t_obj
  const ess_pre_center_idx = settling_idx !== null
    ? settling_idx
    : nearestIdx(time, t_obj);

  const ESS_pre = windowedMean(vel, time, ess_pre_center_idx, ess_k_win);
  const { score: ESS_pre_score, comment: ESS_pre_comment } = scoreESS(ESS_pre, ref, ess_tol);

  // ── ESS post-perturbation ──────────────────────────────────────────────────
  // Center: nearest sample to perturbation_start + perturbation_window
  // (i.e. right when the disturbance ends and recovery should be complete)
  const pert_end_time      = perturbation_start + perturbation_window;
  const ess_post_center_idx = nearestIdx(time, pert_end_time);

  const ESS_post = windowedMean(vel, time, ess_post_center_idx, pert_recovery_k_win);
  const { score: ESS_post_score, comment: ESS_post_comment } = scoreESS(ESS_post, ref, ess_tol);

  // Combined ESS score: mean of pre and post
  const ESS_score = (ESS_pre_score + ESS_post_score) / 2;

  // ── Perturbation recovery ─────────────────────────────────────────────────
  // How far is the signal from ref at pert_end, expressed as %
  const pert_end_idx  = nearestIdx(time, pert_end_time);
  const Pert_err_pct  = Math.abs(vel[pert_end_idx] - ref) / ref * 100;

  let Pert_score: number, Pert_comment: string;
  if (Pert_err_pct <= 2) {
    Pert_score   = 100;
    Pert_comment = `Perturbacion controlada (error ${Pert_err_pct.toFixed(3)}% en t=${pert_end_time.toFixed(3)}s) — 100/100`;
  } else {
    Pert_score   = Math.max(0, 100 - Pert_err_pct * 20);
    Pert_comment = `Error de perturbacion ${Pert_err_pct.toFixed(3)}% en t=${pert_end_time.toFixed(3)}s — ${Pert_score.toFixed(1)}/100`;
  }

  // ── Perturbation validation ──────────────────────────────────────────────────
  // 10 samples BEFORE perturbation_start: must be within ±5% of ref (steady state)
  // 10 samples AFTER perturbation_start: at least one must exceed ±10% of ref (disturbance visible)
  // Perturbation validation using z-score of mean shift:
  //   Pre-window (20 samples): compute mean and std (captures noise level).
  //   Post-window (20 samples): compute mean.
  //   Detection: |post_mean - pre_mean| / pre_std > PERT_ZSCORE_MIN
  //   This is robust to slow/gradual perturbations and high-frequency noise alike,
  //   since even a slow sustained shift produces a large z-score when noise is small.
  const PERT_WIN         = 20;
  const PERT_PRE_TOL     = 0.05;   // 5% of ref — steady state tolerance pre-pert
  const PERT_ZSCORE_MIN  = 3;      // |mean_shift| must exceed N sigma of pre-window noise

  const pert_start_idx = nearestIdx(time, perturbation_start);

  const pert_pre_start = Math.max(0, pert_start_idx - PERT_WIN);
  const pert_preSlice  = vel.slice(pert_pre_start, pert_start_idx);
  const pert_preMean   = pert_preSlice.length > 0
    ? pert_preSlice.reduce((a, b) => a + b, 0) / pert_preSlice.length
    : ref;
  const pert_preErr_pct = Math.abs(pert_preMean - ref) / ref * 100;
  const pert_preStd = pert_preSlice.length > 1
    ? Math.sqrt(pert_preSlice.reduce((acc, v) => acc + (v - pert_preMean) ** 2, 0) / (pert_preSlice.length - 1))
    : 0;

  const pert_post_end  = Math.min(n, pert_start_idx + PERT_WIN);
  const pert_postSlice = vel.slice(pert_start_idx, pert_post_end);
  const pert_postMean  = pert_postSlice.length > 0
    ? pert_postSlice.reduce((a, b) => a + b, 0) / pert_postSlice.length
    : ref;

  // z-score of mean shift: how many sigma did the mean move?
  const pert_zScore = pert_preStd > 0
    ? Math.abs(pert_postMean - pert_preMean) / pert_preStd
    : 0;

  let pert_warning: string | null = null;
  if (pert_preErr_pct > PERT_PRE_TOL * 100) {
    pert_warning = `Las ${pert_preSlice.length} muestras antes de la perturbación promedian ${pert_preMean.toFixed(4)} (error ${pert_preErr_pct.toFixed(1)}% respecto a la referencia). El sistema debe estar en estado estable antes de la perturbación (< ${(PERT_PRE_TOL * 100).toFixed(0)}%).`;
  } else if (pert_zScore < PERT_ZSCORE_MIN) {
    pert_warning = `No se detecta una perturbación significativa (desplazamiento de media: ${pert_zScore.toFixed(1)}σ, se esperaba > ${PERT_ZSCORE_MIN}σ; ruido pre: std=${pert_preStd.toFixed(4)}). Verificá el tiempo de inicio de la perturbación.`;
  }

  // ── Score overrides for invalid start / perturbation ─────────────────────
  // If the experiment start is invalid, all pre-perturbation scores are zeroed.
  // If the perturbation is invalid, only the perturbation score is zeroed.
  const eff_ST_score   = exp_start_warning ? 0 : ST_score;
  const eff_OS_score   = exp_start_warning ? 0 : OS_score;
  const eff_ESS_score  = exp_start_warning ? 0 : ESS_score;
  const eff_Pert_score = pert_warning       ? 0 : Pert_score;

  // ── Final score ────────────────────────────────────────────────────────────
  const final_score =
    (eff_ST_score * weights.ST + eff_OS_score * weights.OS + eff_ESS_score * weights.ESS + eff_Pert_score * weights.Pert) / 100;

  return {
    ST_score: eff_ST_score, ST_comment, ST_prop_ok: prop_ok, settling_time_actual,
    OS_score: eff_OS_score, OS_comment, OS_val, OS_lim,
    ESS_pre_score: exp_start_warning ? 0 : ESS_pre_score, ESS_pre_comment, ESS_pre,
    ESS_post_score: exp_start_warning ? 0 : ESS_post_score, ESS_post_comment, ESS_post,
    ESS_score: eff_ESS_score,
    Pert_score: eff_Pert_score, Pert_comment, Pert_err_pct,
    final_score,
    rise_time,
    exp_start_warning,
    pert_warning,
  };
}