// Plant configuration file
// csv_cols: ordered column names in the CSV (or multiple variants when controllers differ)
// control_col: which column is the controlled variable

/**
 * csv_cols can be specified in three ways:
 *
 *   1. string[]                    — same columns for all controllers
 *      e.g.  ['Tiempo', 'Altura', 'Corriente', 'Entrada']
 *
 *   2. string[][]                  — list of anonymous variants
 *      e.g.  [['Tiempo', 'Altura', 'I', 'U'], ['Tiempo', 'h', 'Corriente', 'Entrada']]
 *
 *   3. Record<string, string[]>    — named variants (controller label → columns)
 *      e.g.  { REI: ['Tiempo', 'Altura', 'I', 'Entrada'], PID: ['Tiempo', 'Altura', 'Corriente', 'U'] }
 *
 * Use resolveCsvCols() to find the best-matching variant given real CSV headers.
 */
export type CsvColsSpec = string[] | string[][] | Record<string, string[]>;

/**
 * Given a CsvColsSpec and the actual headers from an uploaded CSV,
 * returns the best-matching variant plus metadata.
 *
 * "Best match" = variant whose columns have the most overlap with actual headers.
 * Falls back to the first variant if nothing matches well.
 */
export function resolveCsvCols(
  spec: CsvColsSpec,
  actualHeaders: string[]
): { cols: string[]; label: string; matched: boolean } {
  const actual = actualHeaders.map(h => h.toLowerCase());

  // 1. Plain string[]
  if (Array.isArray(spec) && (spec.length === 0 || typeof spec[0] === 'string')) {
    const cols = spec as string[];
    const matched = cols.map(c => c.toLowerCase()).every(c => actual.includes(c));
    return { cols, label: '', matched };
  }

  // Build candidates
  let candidates: { cols: string[]; label: string }[];
  if (Array.isArray(spec)) {
    // string[][]
    candidates = (spec as string[][]).map((cols, i) => ({ cols, label: `variante ${i + 1}` }));
  } else {
    // Record<string, string[]>
    candidates = Object.entries(spec as Record<string, string[]>).map(([label, cols]) => ({ cols, label }));
  }

  // Score each candidate
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const score = c.cols.filter(col => actual.includes(col.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = c; }
  }

  const matched = best.cols.map(c => c.toLowerCase()).every(c => actual.includes(c));
  return { cols: best.cols, label: best.label, matched };
}

/**
 * Returns a human-readable hint string listing all column variants.
 * Used in PlantSelector to show what's expected.
 */
export function csvColsHint(spec: CsvColsSpec): string {
  if (Array.isArray(spec) && (spec.length === 0 || typeof spec[0] === 'string')) {
    return (spec as string[]).join(', ');
  }
  if (Array.isArray(spec)) {
    return (spec as string[][]).map((v, i) => `[${i + 1}] ${v.join(', ')}`).join(' | ');
  }
  return Object.entries(spec as Record<string, string[]>)
    .map(([label, cols]) => `${label}: ${cols.join(', ')}`)
    .join(' | ');
}

export interface PlantConfig {
  id: string;
  label: string;
  available: boolean;
  csv_cols: CsvColsSpec;      // e.g. ['Tiempo', 'Velocidad', ...] or multiple variants
  smooth: boolean;            // apply adaptive MA filter before analysis (false = use raw signal)
  st_proportion_only: boolean; // skip real_st_idx search, evaluate proportion in [t_obj, t_obj+t_win] directly (for oscillatory plants)
  time_col: string;           // column to use as X axis
  control_col: string;        // column to evaluate (Y axis)
  ref: number;                // setpoint reference value

  tol_st: number;             // settling time band (fraction, e.g. 0.02 = ±2%)
  t_obj: number;              // settling time DEADLINE (s) — must settle by this time
  t_win: number;              // window after t_obj to check settling fraction (s)

  tol_os: number;             // overshoot tolerance (fraction, e.g. 0.03 = 3%)

  ess_tol: number;            // ESS tolerance (fraction, e.g. 0.01 = 1%)
  ess_k_win: number;          // number of samples for ESS evaluation window
                              // evaluated at: actual settling time (pre-pert) and
                              // perturbation_start + perturbation_window (post-pert)

  perturbation_start: number;  // time (s) where perturbation begins
  perturbation_window: number; // duration (s) of perturbation event
  pert_recovery_k_win: number; // samples to average after perturbation_window ends
  pert_recovery_tol: number;   // recovery tolerance (fraction, e.g. 0.02 = 2%)

  // Perturbation detection tuning
  pert_zscore_min: number;     // min z-score to consider perturbation detected (default 3, lower for smooth signals)
  pert_detect_win: number;     // samples before/after pert_start used for detection (default 40)

  // Scoring weights (must sum to 100)
  weights: {
    ST: number;
    OS: number;
    ESS: number;
    Pert: number;
  };

  y_limits: [number, number] | null;  // Y axis [min, max], null = auto

  // Optional second variable — either independent analysis or constraint check
  secondary_control_col?: string;
  secondary_ref?: number;
  secondary_y_limits?: [number, number] | null;
  secondary_label?: string;  // display name override (default: secondary_control_col)

  // Constraint mode: secondary variable is a limit to not exceed, not a setpoint to track
  // Score: 100 if max_abs <= constraint_limit, 0 if max_abs >= constraint_zero, linear between
  secondary_mode?: 'normal' | 'constraint';
  constraint_limit?: number;   // threshold for 100 (e.g. 0.1745 rad = 10°)
  constraint_zero?: number;    // threshold for 0   (e.g. 0.3491 rad = 20°)

  // When secondary_mode='constraint', the primary variable's Pert is scored separately.
  // primary_weights_no_pert: weights used for the ST/OS/ESS portion (Pert must be 0)
  // The final combined score = primary_no_pert(33.33%) + primary_pert(33.33%) + constraint(33.33%)
  primary_weights_no_pert?: { ST: number; OS: number; ESS: number; Pert: 0 };

  domains: ('continuo' | 'discreto')[];
  exp_start_t: Partial<Record<'continuo' | 'discreto', number>>;  // experiment start time per domain (default 0)
  chart_config?: Partial<ChartConfig>;  // optional per-plant visual overrides
}

export interface ChartConfig {
  font_size: number;   // chart tick/label font size in px
  raw:       string;   // raw signal line color
  smoothed:  string;   // smoothed signal line color
  ref:       string;   // reference horizontal line color
  st_band:   string;   // settling time band lines color
  os_lim:    string;   // overshoot limit line color
  eval_win:  string;   // settling eval window region color
  ess_win:   string;   // ESS window region color (pre + post)
  pert_win:  string;   // perturbation window region color
}

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  font_size: 12,
  raw:       '#c084fc',
  smoothed:  '#b4328c',
  ref:       '#3b82f6',
  st_band:   '#3b82f6',
  os_lim:    '#ef4444',
  eval_win:  '#A0CCDA',
  ess_win:   '#82A6B1',
  pert_win:  '#C8AD55',
};

export const plants: PlantConfig[] = [
  {
    id: 'motor_cd',
    label: 'Motor CD',
    available: true,
    csv_cols: ['Tiempo', 'Velocidad', 'Control', 'Referencia'],
    time_col: 'Tiempo',
    control_col: 'Velocidad',
    ref: 4,
    tol_st: 0.02,
    t_obj: 0.3,
    t_win: 2.0,
    tol_os: 0.03,
    ess_tol: 0.01,
    ess_k_win: 50,
    perturbation_start: 6.0,
    perturbation_window: 0.3,
    pert_recovery_k_win: 50,
    pert_recovery_tol: 0.02,
    weights: { ST: 25, OS: 25, ESS: 25, Pert: 25 },
    pert_zscore_min: 3,
    pert_detect_win: 40,
    smooth: true,
    st_proportion_only: false,
    y_limits: [3.8, 4.2],
    domains: ['continuo', 'discreto'],
    exp_start_t: { continuo: 0, discreto: 1 },
  },
  {
    id: 'grua',
    label: 'Grúa',
    available: true,
    secondary_control_col: 'Angulo',
    secondary_ref: 0.0,
    secondary_y_limits: [-0.4, 0.4],
    secondary_label: 'Ángulo',
    secondary_mode: 'constraint',
    constraint_limit: 0.17453292519943295,  // 10° in rad
    constraint_zero:  0.3490658503988659,   // 20° in rad
    primary_weights_no_pert: { ST: 33, OS: 33, ESS: 34, Pert: 0 as const },
    csv_cols: ['Tiempo', 'Carrito', 'Angulo', 'Entrada'],
    time_col: 'Tiempo',
    control_col: 'Carrito',
    ref: 0.5,
    tol_st: 0.02,
    t_obj: 6,
    t_win: 2,
    tol_os: 0.05,
    ess_tol: 0.01,
    ess_k_win: 50,
    perturbation_start: 10.0,
    perturbation_window: 0.5,
    pert_recovery_k_win: 50,
    pert_recovery_tol: 0.02,
    weights: { ST: 0, OS: 0, ESS: 0, Pert: 100 },  // primary: Pert scored separately; ST/OS/ESS via primary_weights_no_pert
    pert_zscore_min: 3,
    pert_detect_win: 40,
    smooth: true,
    st_proportion_only: false,
    y_limits: null,
    domains: ['continuo'],
    exp_start_t: {},
  },
  {
    id: 'pamh',
    label: 'PAMH',
    available: true,
    // REI agrega VELOCIDAD; PID e IPD no la tienen — se detecta automáticamente
    csv_cols: {
      PID: ['Tiempo', 'CONTROL', 'PID',      'ANGULO', 'REFERENCIA', 'PERTURBACION'],
      IPD: ['Tiempo', 'CONTROL', 'IPD',      'ANGULO', 'REFERENCIA', 'PERTURBACION'],
      REI: ['Tiempo', 'CONTROL', 'REI', 'VELOCIDAD', 'ANGULO', 'REFERENCIA', 'PERTURBACION'],
    },
    time_col: 'Tiempo',
    control_col: 'ANGULO',
    ref: 0.6,                   // rad — referencia de ángulo
    tol_st: 0.02,               // ±2%
    t_obj: 5.0,                 // límite settling time (s)
    t_win: 5.0,                 // ventana de comprobación ST (s)
    tol_os: 0.03,               // 3% overshoot
    ess_tol: 0.01,              // ±1% ESS
    ess_k_win: 100,             // últimas ~200 muestras para ESS
    perturbation_start: 20.0,   // default — ajustable en UI por grupo
    perturbation_window: 5.0,   // duración perturbación (s)
    pert_recovery_k_win: 50,
    pert_recovery_tol: 0.02,
    weights: { ST: 25, OS: 25, ESS: 25, Pert: 25 },
    pert_zscore_min: 1,      // señal suave — perturbación menos abrupta
    pert_detect_win: 250,    // ~5s a 20ms/muestra — cubre la duración completa de la perturbación
    smooth: false,
    st_proportion_only: true, // señal oscilatoria — evaluar proporción en banda directo sin buscar real_st_idx
    y_limits: [0.5, 0.7],
    domains: ['continuo', 'discreto'],
    exp_start_t: {},
  },
  {
    id: 'heli_2dof',
    label: 'Heli 2DOF',
    available: true,
    csv_cols: ['Tiempo', 'Pitch', 'Yaw', 'Entrada'],
    time_col: 'Tiempo',
    control_col: 'Pitch',
    ref: 15.0,
    secondary_control_col: 'Yaw',
    secondary_ref: 0.0,
    secondary_y_limits: [-0.2, 0.2],
    secondary_label: 'Yaw',
    secondary_mode: 'constraint',
    constraint_limit: 0.1,   // 0.1 rad
    constraint_zero:  0.2,   // 0.2 rad
    primary_weights_no_pert: { ST: 33, OS: 33, ESS: 34, Pert: 0 as const },
    tol_st: 0.02,
    t_obj: 2.5,
    t_win: 2.0,
    tol_os: 0.03,
    ess_tol: 0.01,
    ess_k_win: 50,
    perturbation_start: 12.0,
    perturbation_window: 0.5,
    pert_recovery_k_win: 50,
    pert_recovery_tol: 0.02,
    weights: { ST: 0, OS: 0, ESS: 0, Pert: 100 },  // primary: Pert scored separately; ST/OS/ESS via primary_weights_no_pert
    pert_zscore_min: 3,
    pert_detect_win: 40,
    smooth: true,
    st_proportion_only: false,
    y_limits: null,
    domains: ['continuo', 'discreto'],
    exp_start_t: {},
  },
];