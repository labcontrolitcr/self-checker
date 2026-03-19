// Plant configuration file
// csv_cols: ordered column names in the CSV
// control_col: which column is the controlled variable

export interface PlantConfig {
  id: string;
  label: string;
  available: boolean;
  csv_cols: string[];         // e.g. ["Tiempo", "Velocidad", "Corriente", "Entrada"]
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
  pert_recovery_tol: number;     // recovery tolerance (fraction, e.g. 0.02 = 2%) — same scoring logic as ess_tol

  // Scoring weights (must sum to 100)
  weights: {
    ST: number;
    OS: number;
    ESS: number;
    Pert: number;
  };

  y_limits: [number, number] | null;  // Y axis [min, max], null = auto
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
    tol_st: 0.02,        // ±2%
    t_obj: 0.3,          // must settle by 300 ms
    t_win: 2.0,          // check window: [0.3s, 2.3s]
    tol_os: 0.03,        // max 3% overshoot
    ess_tol: 0.01,       // ±1% steady-state error
    ess_k_win: 50,       // 50-sample window for ESS mean
    perturbation_start: 6.0,
    perturbation_window: 0.3,
    pert_recovery_k_win: 50,
    pert_recovery_tol: 0.02,      // ±2% recovery tolerance
    weights: { ST: 25, OS: 25, ESS: 25, Pert: 25 },
    y_limits: [3.8, 4.2],
    domains: ['continuo', 'discreto'],
    exp_start_t: { continuo: 0, discreto: 1 },
  },
  {
    id: 'grua',
    label: 'Grúa',
    available: false,
    csv_cols: ['Tiempo', 'Posicion', 'Angulo', 'Entrada'],
    time_col: 'Tiempo',
    control_col: 'Posicion',
    ref: 1.0,
    tol_st: 0.02,
    t_obj: 3.0,
    t_win: 2.0,
    tol_os: 0.05,
    ess_tol: 0.01,
    ess_k_win: 50,
    perturbation_start: 10.0,
    perturbation_window: 0.5,
    pert_recovery_k_win: 50,
    pert_recovery_tol: 0.02,
    weights: { ST: 25, OS: 25, ESS: 25, Pert: 25 },
    y_limits: null,
    domains: ['continuo', 'discreto'],
    exp_start_t: {},
  },
  {
    id: 'pamh',
    label: 'PAMH',
    available: false,
    csv_cols: ['Tiempo', 'Altura', 'Corriente', 'Entrada'],
    time_col: 'Tiempo',
    control_col: 'Altura',
    ref: 2.5,
    tol_st: 0.02,
    t_obj: 2.0,
    t_win: 2.0,
    tol_os: 0.03,
    ess_tol: 0.01,
    ess_k_win: 50,
    perturbation_start: 8.0,
    perturbation_window: 0.3,
    pert_recovery_k_win: 50,
    pert_recovery_tol: 0.02,
    weights: { ST: 25, OS: 25, ESS: 25, Pert: 25 },
    y_limits: null,
    domains: ['continuo'],
    exp_start_t: {},
  },
  {
    id: 'heli_2dof',
    label: 'Heli 2DOF',
    available: false,
    csv_cols: ['Tiempo', 'Pitch', 'Yaw', 'Entrada'],
    time_col: 'Tiempo',
    control_col: 'Pitch',
    ref: 15.0,
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
    weights: { ST: 25, OS: 25, ESS: 25, Pert: 25 },
    y_limits: null,
    domains: ['continuo', 'discreto'],
    exp_start_t: {},
  },
];