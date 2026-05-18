<script lang="ts">
  import type { AnalysisResult, ConstraintResult } from '$lib/analysis';
  import type { PlantConfig } from '$lib/config/plants.config';

  interface Props {
    result: AnalysisResult;
    result2?: AnalysisResult | null;
    constraintResult?: ConstraintResult | null;
    combinedScore?: number | null;
    primaryNoPertScore?: number | null;
    config: PlantConfig & { experiment_start?: number };
    cfg2?: (PlantConfig & { experiment_start?: number }) | null;
    domain: 'continuo' | 'discreto';
    rows: Record<string, number>[];
    csvRaw: string;
    csvFileName: string;
  }

  let { result, result2, constraintResult, combinedScore, primaryNoPertScore, config, cfg2, domain, rows, csvRaw, csvFileName }: Props = $props();

  // Google Sheets Web App URL — deploy your Apps Script as web app and paste here
  // SHEETS_URL set below

  // ── State ──────────────────────────────────────────────────────────────────
  let open          = $state(false);
  let teamName      = $state('');
  let generating    = $state(false);
  let errorMsg      = $state('');

  // ── Filename: editable, auto-suggested from plant+domain+team ───────────────
  function suggestFileName(): string {
    const plant = config.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const dom   = domain.toLowerCase();
    const team  = teamName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return team ? 'reporte_' + plant + '_' + dom + '_' + team : 'reporte_' + plant + '_' + dom;
  }
  let pdfFileName = $state(suggestFileName());

  // Auto-update filename when team changes, but only if user hasn't manually edited it
  let fileNameTouched = $state(false);
  $effect(() => {
    const _t = teamName; // reactivity dep
    if (!fileNameTouched) pdfFileName = suggestFileName();
  });


  // Google Sheets Web App URL — set VITE_SHEETS_WEBHOOK_URL in .env
  // or replace with your deployed Apps Script URL directly
  const SHEETS_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SHEETS_WEBHOOK_URL) || '';

  // ── Serial code — SC-<20 chars fingerprint>-<24 hex SHA> ─────────────────
  // Fingerprint: 5 indices deterministically chosen from SHA seed,
  // each encoded as 2 chars idx (base36) + 2 chars quantized value (base36).
  // Reproducible: same CSV → same code. Tampering → mismatch.
  const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  function toB36(n: number, w: number): string {
    let s = '';
    for (let i = 0; i < w; i++) { s = B36[n % 36] + s; n = Math.floor(n / 36); }
    return s;
  }
  function makeLCG(seed: number) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s; };
  }
  function quantize(v: number, min: number, max: number): number {
    return Math.min(1295, Math.max(0, Math.round(((v - min) / (max - min || 1)) * 1295)));
  }

  async function buildSerial(signal: number[]): Promise<string> {
    const bytes   = new Uint8Array(new TextEncoder().encode(csvRaw));
    const digest  = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hexFull = Array.from(digest).map(b => b.toString(16).padStart(2, '0')).join('');
    const seed    = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) ^ digest[4];
    const lcg     = makeLCG(seed);
    const n       = signal.length;
    const sMin    = Math.min(...signal), sMax = Math.max(...signal);
    const indices: number[] = [];
    while (indices.length < 5) { const i = lcg() % n; if (!indices.includes(i)) indices.push(i); }
    indices.sort((a, b) => a - b);
    const fp = indices.map(i => toB36(i % 1296, 2) + toB36(quantize(signal[i], sMin, sMax), 2)).join('');
    return 'SC-' + fp + '-' + hexFull.slice(0, 24);
  }

  let serialCode = '';

  // ── Single chart snapshot → JPEG data URL (OffscreenCanvas) ──────────────
  async function renderSnap(
    Chart: any,
    title: string,
    tStart: number, tEnd: number,
    timeArr: number[], signal: number[], sm: number[],
    expStart: number, ref: number, stLo: number, stHi: number, osHi: number,
    vLines: { x: number; color: string; dash: number[]; lbl: string }[],
    boxes: { x0: number; x1: number; color: string }[],
    snapCfg: typeof config = config,
  ): Promise<string> {
    const CW = 1600, CH = 900, SF = CW / 800;
    const ctrl = snapCfg.control_col;

    const si    = Math.max(0, timeArr.findIndex(t => t >= tStart));
    const ei0   = timeArr.findIndex(t => t > tEnd);
    const ei    = ei0 < 0 ? timeArr.length : ei0;
    const tSl   = timeArr.slice(si, ei);
    const rawSl = signal.slice(si, ei);
    const smOff = timeArr.findIndex(t => t >= expStart);
    const smSl  = tSl.map((_, k) => {
      const idx = si + k - (smOff >= 0 ? smOff : 0);
      return (idx >= 0 && idx < sm.length) ? sm[idx] : null;
    });

    const cvs = new OffscreenCanvas(CW, CH);
    const ctx  = cvs.getContext('2d') as OffscreenCanvasRenderingContext2D;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CW, CH);

    const overlay = {
      id: 'overlay',
      beforeDraw(ch: any) {
        const c = ch.ctx;
        c.save(); c.fillStyle = '#ffffff'; c.fillRect(0, 0, ch.width, ch.height); c.restore();
      },
      afterDraw(ch: any) {
        const { ctx: c, scales: { x, y } } = ch;
        c.save();
        // ST band
        const yLo = y.getPixelForValue(stLo), yHi = y.getPixelForValue(stHi);
        c.fillStyle = 'rgba(37,99,235,0.06)';
        c.fillRect(x.left, Math.min(yLo, yHi), x.right - x.left, Math.abs(yLo - yHi));
        // Shade boxes
        boxes.forEach(b => {
          const px0 = x.getPixelForValue(b.x0), px1 = x.getPixelForValue(b.x1);
          c.fillStyle = b.color;
          c.fillRect(Math.min(px0, px1), ch.chartArea.top, Math.abs(px1 - px0), ch.chartArea.bottom - ch.chartArea.top);
        });
        // H-lines: ref, stHi, stLo, osHi
        const hl: [number, string, number[]][] = [
          [ref,  'rgba(37,99,235,0.85)',  [8, 6]],
          [stHi, 'rgba(37,99,235,0.40)',  [5, 8]],
          [stLo, 'rgba(37,99,235,0.40)',  [5, 8]],
          [osHi, 'rgba(220,38,38,0.65)',  [9, 5]],
        ];
        hl.forEach(([v, col, dash]) => {
          const py = y.getPixelForValue(v);
          c.strokeStyle = col; c.lineWidth = 1.5 * SF;
          c.setLineDash((dash as number[]).map(d => d * SF));
          c.beginPath(); c.moveTo(x.left, py); c.lineTo(x.right, py); c.stroke();
        });
        c.setLineDash([]);
        // V-lines
        vLines.forEach(a => {
          const px = x.getPixelForValue(a.x);
          if (px < x.left - 1 || px > x.right + 1) return;
          c.strokeStyle = a.color; c.lineWidth = 1.8 * SF;
          c.setLineDash(a.dash.map(d => d * SF));
          c.beginPath(); c.moveTo(px, ch.chartArea.top); c.lineTo(px, ch.chartArea.bottom); c.stroke();
          c.setLineDash([]);
          c.fillStyle = a.color;
          c.font = 'bold ' + Math.round(13 * SF) + 'px monospace';
          c.fillText(a.lbl, px + 4 * SF, ch.chartArea.top + 16 * SF);
        });
        c.restore();
      }
    };

    const fs = Math.round(10 * SF);
    const ch = new Chart(cvs as unknown as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: tSl,
        datasets: [
          { label: ctrl, data: rawSl, borderColor: snapCfg.smooth !== false ? 'rgba(130,60,200,0.30)' : 'rgba(130,60,200,0.85)', borderWidth: 1.5 * SF, pointRadius: 0, tension: 0 },
          { label: 'sm', data: smSl,  borderColor: snapCfg.smooth !== false ? 'rgba(120,20,100,0.85)' : 'transparent',              borderWidth: 2.5 * SF, pointRadius: 0, tension: 0 },
        ]
      },
      options: {
        animation: false, responsive: false,
        layout: { padding: { top: 6, right: 10, bottom: 4, left: 4 } },
        plugins: {
          legend: { display: false },
          title: { display: true, text: title, color: '#1a1a1a', font: { family: 'Courier New', size: Math.round(14 * SF), weight: 'bold' as const }, padding: { bottom: 6 } },
        },
        scales: {
          x: { type: 'linear', ticks: { font: { family: 'Courier New', size: fs }, color: '#444', maxTicksLimit: 10, maxRotation: 0 }, grid: { color: 'rgba(0,0,0,0.06)' }, border: { color: 'rgba(0,0,0,0.15)' }, title: { display: true, text: 'Tiempo (s)', font: { family: 'Courier New', size: fs }, color: '#333' } },
          y: { ticks: { font: { family: 'Courier New', size: fs }, color: '#444' }, grid: { color: 'rgba(0,0,0,0.06)' }, border: { color: 'rgba(0,0,0,0.15)' }, title: { display: true, text: ctrl, font: { family: 'Courier New', size: fs }, color: '#333' }, ...(snapCfg.y_limits ? { min: snapCfg.y_limits[0], max: snapCfg.y_limits[1] } : {}) }
        }
      },
      plugins: [overlay],
    });
    ch.draw();
    const blob = await (cvs as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 1.0 });
    const dataUrl = await new Promise<string>(res => {
      const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob);
    });
    ch.destroy();
    return dataUrl;
  }

  // ── Generate PDF ──────────────────────────────────────────────────────────
  async function generate() {
    generating = true; errorMsg = ''; serialCode = '';
    try {
      const { jsPDF }               = await import('jspdf');
      const { Chart, registerables } = await import('chart.js');
      Chart.register(...registerables);

      const timeCol = config.time_col;
      const timeArr = rows.map(r => r[timeCol]);

      // ── Serial code — built from CSV fingerprint (primary signal) ─────────
      const primarySignal = rows.map(r => r[config.control_col]);
      serialCode = await buildSerial(primarySignal);

      // ── Helper: render one page into jsPDF doc ────────────────────────────
      async function renderPage(
        doc: any,
        pageResult: AnalysisResult,
        pageCfg: typeof config,
        pageSignal: number[],
        pageLabel: string,
        isFirstPage: boolean,
      ) {
        if (!isFirstPage) doc.addPage();

        const expStart = pageCfg.experiment_start ?? 0;
        const { t_obj, t_win, tol_st, tol_os, ref,
                perturbation_start, perturbation_window } = pageCfg;
        const sm      = pageResult.smoothed as number[];
        const stLo = ref * (1 - tol_st), stHi = ref * (1 + tol_st), osHi = ref * (1 + tol_os);
        const tObjAbs = expStart + t_obj;
        const pertEnd = perturbation_start + perturbation_window;
        const fullEnd = pertEnd + t_win + 1;

        const vTobj  = { x: tObjAbs,           color: '#b07d00', dash: [5, 4], lbl: 't=' + t_obj + 's' };
        const vPert  = { x: perturbation_start, color: '#6d4fc2', dash: [4, 4], lbl: 'PERT' };
        const vPertE = { x: pertEnd,            color: '#5a4898', dash: [3, 5], lbl: 'fin' };
        const bxEval = { x0: tObjAbs,           x1: tObjAbs + t_win, color: 'rgba(160,204,218,0.35)' };
        const bxPert = { x0: perturbation_start, x1: pertEnd,         color: 'rgba(200,173,85,0.30)'  };
        const bxRec  = { x0: pertEnd,            x1: pertEnd + t_win, color: 'rgba(130,166,177,0.28)' };

        const S = (title: string, ts: number, te: number, vl: typeof vTobj[], bx: typeof bxEval[]) =>
          renderSnap(Chart, title, ts, te, timeArr, pageSignal, sm, expStart, ref, stLo, stHi, osHi, vl, bx, pageCfg);

        const [png1, png2, png3, png4] = await Promise.all([
          S('Respuesta completa ' + pageCfg.label + ' – ' + pageLabel,
            expStart, fullEnd, [vTobj, vPert, vPertE], [bxEval, bxPert, bxRec]),
          S('Settling t_obj=' + t_obj + 's banda +-' + (tol_st * 100).toFixed(0) + '%',
            expStart, Math.min(tObjAbs + t_win * 1.3, perturbation_start - 0.1), [vTobj], [bxEval]),
          S('Sobreimpulso limite +-' + (tol_os * 100).toFixed(1) + '%',
            expStart, Math.min(tObjAbs + t_win * 0.6, perturbation_start - 0.1), [], []),
          S('Perturbacion inicio=' + perturbation_start + 's ventana=' + perturbation_window + 's',
            perturbation_start - 0.5, pertEnd + t_win + 0.5, [vPert, vPertE], [bxPert, bxRec]),
        ]);

        const PW = 297, PH = 210, M = 12;
        const safe = (s: string) => s.replace(/[^\x00-\x7F]/g, ' ').replace(/  +/g, ' ').trim();
        const now = new Date().toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' });

        // Header
        doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.2); doc.line(M, 8, PW - M, 8);
        doc.setTextColor(40, 40, 40); doc.setFont('courier', 'bold'); doc.setFontSize(10);
        doc.text('SELF-CHECKER', M, 6);
        doc.setFont('courier', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 100, 100);
        doc.text(pageCfg.label + ' – ' + pageLabel + '  |  ' + domain.toUpperCase() + '  |  ' + (teamName || '—') + '  |  ' + now, PW - M, 6, { align: 'right' });

        // Score — show combined score if available (constraint mode), else per-page score
        const displayScore = (isFirstPage && combinedScore != null) ? combinedScore : pageResult.final_score;
        const sc = displayScore;
        const sRgb = sc >= 90 ? [34,197,94] as const : sc >= 70 ? [202,138,4] as const : [220,38,38] as const;
        doc.setFont('courier', 'bold'); doc.setFontSize(9); doc.setTextColor(...sRgb);
        doc.text(sc.toFixed(1), M, 14.5);
        doc.setTextColor(80, 80, 80); doc.setFont('courier', 'normal'); doc.setFontSize(7.5);
        if (isFirstPage && combinedScore != null) {
          doc.text('/ 100  COMBINADA', M + 9, 14.5);
        } else {
          doc.text('/ 100', M + 9, 14.5);
        }
        // sx: start after score text. Combined label is wider so push further right
        let sx = isFirstPage && combinedScore != null ? M + 58 : M + 28;
        // For constraint mode first page, show ST/OS/ESS + PERT + CONSTRAINT breakdown
        if (isFirstPage && combinedScore != null && constraintResult) {
          const secLbl = (config as any).secondary_label ?? cfg2?.control_col ?? 'VAR2';
          const items = [
            { lbl: 'ST+OS+ESS', v: primaryNoPertScore ?? pageResult.ST_score },
            { lbl: 'PERT',      v: pageResult.Pert_score },
            { lbl: secLbl.toUpperCase().slice(0,6), v: constraintResult.score },
          ];
          items.forEach(({ lbl, v }) => {
            const rgb = v >= 90 ? [34,197,94] as const : v >= 70 ? [202,138,4] as const : [220,38,38] as const;
            doc.setTextColor(110,110,110); doc.setFontSize(6); doc.text(lbl, sx, 12.5);
            doc.setTextColor(...rgb); doc.setFontSize(8); doc.setFont('courier','bold');
            doc.text(v.toFixed(0), sx, 16); doc.setFont('courier','normal'); sx += 26;
          });
        } else {
          [
            { lbl: 'ST', v: pageResult.ST_score }, { lbl: 'OS', v: pageResult.OS_score },
            { lbl: 'ESS', v: pageResult.ESS_score }, { lbl: 'PERT', v: pageResult.Pert_score },
          ].forEach(({ lbl, v }) => {
            const rgb = v >= 90 ? [34,197,94] as const : v >= 70 ? [202,138,4] as const : [220,38,38] as const;
            doc.setTextColor(110,110,110); doc.setFontSize(6.5); doc.text(lbl, sx, 12.5);
            doc.setTextColor(...rgb); doc.setFontSize(8); doc.setFont('courier','bold');
            doc.text(v.toFixed(0), sx, 16); doc.setFont('courier','normal'); sx += 18;
          });
        }
        doc.setDrawColor(210,210,210); doc.setLineWidth(0.15); doc.line(M, 18, PW - M, 18);

        // Charts 2×2
        const gridTop = 20, gridH = PH - gridTop - 46;
        const cW = (PW - M * 2 - 3) / 2, cH = gridH / 2;
        const pos = [
          { x: M,          y: gridTop },
          { x: M + cW + 3, y: gridTop },
          { x: M,          y: gridTop + cH + 2 },
          { x: M + cW + 3, y: gridTop + cH + 2 },
        ];
        [png1, png2, png3, png4].forEach((png, i) => {
          doc.addImage(png, 'JPEG', pos[i].x, pos[i].y, cW, cH);
          doc.setDrawColor(210,210,210); doc.setLineWidth(0.12);
          doc.rect(pos[i].x, pos[i].y, cW, cH);
        });

        // Comments
        const commY = gridTop + gridH + 4;
        doc.setDrawColor(210,210,210); doc.setLineWidth(0.15); doc.line(M, commY - 1, PW - M, commY - 1);
        const colW2 = (PW - M * 2 - 6) / 2;
        [
          { lbl: 'ST',   txt: pageResult.ST_comment,      score: pageResult.ST_score   },
          { lbl: 'OS',   txt: pageResult.OS_comment,      score: pageResult.OS_score   },
          { lbl: 'ESS',  txt: pageResult.ESS_pre_comment, score: pageResult.ESS_score  },
          { lbl: 'PERT', txt: pageResult.Pert_comment,    score: pageResult.Pert_score },
        ].forEach(({ lbl, txt, score }, i) => {
          const cx = M + (i % 2) * (colW2 + 6), cy = commY + 4 + Math.floor(i / 2) * 9;
          const rgb = score >= 90 ? [34,197,94] as const : score >= 70 ? [202,138,4] as const : [220,38,38] as const;
          doc.setFont('courier','bold'); doc.setFontSize(6.5); doc.setTextColor(...rgb);
          doc.text(lbl + ' ' + score.toFixed(0), cx, cy);
          doc.setFont('courier','normal'); doc.setFontSize(6); doc.setTextColor(100,100,100);
          doc.text(safe(txt.length > 110 ? txt.slice(0, 110) : txt), cx, cy + 4, { maxWidth: colW2 - 2 });
        });

        // Warnings
        const warns = [pageResult.exp_start_warning, pageResult.pert_warning, pageResult.ess_step_warning].filter(Boolean) as string[];
        warns.forEach((w, i) => {
          doc.setTextColor(180,120,20); doc.setFontSize(5.8);
          doc.text('! ' + safe(w.slice(0, 160)), M, commY + 19 + i * 4, { maxWidth: PW - M * 2 });
        });

        // Config
        const cfgY = commY + 22;
        doc.setDrawColor(220,220,220); doc.setLineWidth(0.1);
        doc.line(M, cfgY - 1, PW - M, cfgY - 1);
        doc.setFont('courier','bold'); doc.setFontSize(5.5); doc.setTextColor(140,140,140);
        doc.text('CONFIGURACION', M, cfgY + 2.5);
        const cfgStr = [
          'var='        + pageLabel,
          'p_id='       + pageCfg.id,
          'ref='        + ref,
          'tol_st='     + (tol_st  * 100).toFixed(1) + '%',
          'tol_os='     + (tol_os  * 100).toFixed(1) + '%',
          'ess_tol='    + (pageCfg.ess_tol * 100).toFixed(1) + '%',
          'ess_k='      + pageCfg.ess_k_win,
          't_obj='      + t_obj    + 's',
          't_win='      + t_win    + 's',
          'pert_start=' + perturbation_start + 's',
          'pert_win='   + perturbation_window + 's',
          'rec_tol='    + ((pageCfg as any).pert_recovery_tol * 100).toFixed(1) + '%',
          'exp_ini='    + expStart + 's',
          'dominio='    + domain,
          'csv='        + csvFileName,
        ].join('  ');
        doc.setFont('courier','normal'); doc.setFontSize(5); doc.setTextColor(155,155,155);
        doc.text(cfgStr, M, cfgY + 6, { maxWidth: PW - M * 2 });

        // Footer
        doc.setTextColor(150,150,150); doc.setFontSize(5.5);
        doc.text('Self Checker — IE TEC', M, PH - 2);
        doc.setFont('courier','normal'); doc.setFontSize(4.8); doc.setTextColor(175,175,175);
        doc.text(serialCode, PW - M, PH - 2, { align: 'right' });
      }

      // ── Build PDF (1 or 2 pages) ──────────────────────────────────────────
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      const primaryLabel = config.control_col;
      const secondaryLabel2 = (config as any).secondary_label ?? cfg2?.control_col ?? 'Variable 2';

      await renderPage(doc, result, config, primarySignal, primaryLabel, true);

      if (result2 && cfg2 && !constraintResult) {
        // Normal secondary: full chart page
        const signal2 = rows.map(r => r[cfg2.control_col]);
        await renderPage(doc, result2, cfg2, signal2, secondaryLabel2, false);
      } else if (constraintResult && cfg2 && result2) {
        // Constraint secondary: page with chart + details panel
        doc.addPage();
        const PW = 297, PH = 210, M = 12;
        const safe = (s: string) => s.replace(/[^\x00-\x7F]/g, ' ').replace(/  +/g, ' ').trim();
        const now = new Date().toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' });

        // Header
        doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.2); doc.line(M, 8, PW - M, 8);
        doc.setTextColor(40, 40, 40); doc.setFont('courier', 'bold'); doc.setFontSize(10);
        doc.text('SELF-CHECKER', M, 6);
        doc.setFont('courier', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 100, 100);
        doc.text(config.label + ' – ' + secondaryLabel2.toUpperCase() + ' CONSTRAINT  |  ' + domain.toUpperCase() + '  |  ' + (teamName || '—') + '  |  ' + now, PW - M, 6, { align: 'right' });

        // Constraint score
        const cs = constraintResult.score;
        const csRgb = cs >= 90 ? [34,197,94] as const : cs >= 70 ? [202,138,4] as const : [220,38,38] as const;
        doc.setFont('courier', 'bold'); doc.setFontSize(9); doc.setTextColor(...csRgb);
        doc.text(cs.toFixed(1), M, 14.5);
        doc.setTextColor(80, 80, 80); doc.setFont('courier', 'normal'); doc.setFontSize(7.5);
        doc.text('/ 100  CONSTRAINT', M + 9, 14.5);
        doc.setDrawColor(210,210,210); doc.setLineWidth(0.15); doc.line(M, 18, PW - M, 18);

        // Layout: chart left (wide), details panel right (narrow)
        const chartTop = 20, chartH = PH - chartTop - 20;
        const chartW = 175, panelX = M + chartW + 4, panelW = PW - panelX - M;

        // Render full signal chart with ±limit bands
        const signal2 = rows.map((r: any) => r[cfg2.control_col]);
        const timeArr2 = rows.map((r: any) => r[cfg2.time_col]);
        const sm2 = result2.smoothed as number[];
        const expStart2 = cfg2.experiment_start ?? 0;
        const lim = constraintResult.constraint_limit;
        const lim0 = constraintResult.constraint_zero;

        // Build chart manually for constraint (±limit lines instead of normal bands)
        const CW2 = 1400, CH2 = 900, SF2 = CW2 / 800;
        const cvs2 = new OffscreenCanvas(CW2, CH2);
        const ctx2 = cvs2.getContext('2d') as OffscreenCanvasRenderingContext2D;
        ctx2.fillStyle = '#ffffff'; ctx2.fillRect(0, 0, CW2, CH2);

        const tArr2 = timeArr2;
        const si2 = Math.max(0, tArr2.findIndex((t: number) => t >= expStart2));
        const rawSl2 = signal2.slice(si2);
        const tSl2   = tArr2.slice(si2);
        const smOff2 = tArr2.findIndex((t: number) => t >= expStart2);
        const smSl2  = tSl2.map((_: any, k: number) => {
          const idx = k;
          return (idx >= 0 && idx < sm2.length) ? sm2[idx] : null;
        });

        const overlay2 = {
          id: 'overlay2',
          beforeDraw(ch: any) {
            const c = ch.ctx;
            c.save(); c.fillStyle = '#ffffff'; c.fillRect(0, 0, ch.width, ch.height); c.restore();
          },
          afterDraw(ch: any) {
            const { ctx: c, scales: { x, y } } = ch;
            c.save();
            // Danger zones: above +lim and below -lim
            const yLimHi = y.getPixelForValue(lim);
            const yLimLo = y.getPixelForValue(-lim);
            const yTop   = ch.chartArea.top;
            const yBot   = ch.chartArea.bottom;
            c.fillStyle = 'rgba(220,38,38,0.10)';
            c.fillRect(x.left, yTop, x.right - x.left, yLimHi - yTop);
            c.fillRect(x.left, yLimLo, x.right - x.left, yBot - yLimLo);
            // ±limit lines
            [[lim, '+' + lim.toFixed(4)], [-lim, '-' + lim.toFixed(4)]].forEach(([v, lbl]) => {
              const py = y.getPixelForValue(v as number);
              c.strokeStyle = 'rgba(220,38,38,0.80)'; c.lineWidth = 1.8 * SF2;
              c.setLineDash([9 * SF2, 5 * SF2]);
              c.beginPath(); c.moveTo(x.left, py); c.lineTo(x.right, py); c.stroke();
              c.setLineDash([]);
              c.fillStyle = 'rgba(220,38,38,0.85)';
              c.font = 'bold ' + Math.round(11 * SF2) + 'px monospace';
              c.fillText(lbl as string, x.left + 4 * SF2, py - 4 * SF2);
            });
            // zero line
            const py0 = y.getPixelForValue(0);
            c.strokeStyle = 'rgba(100,100,100,0.4)'; c.lineWidth = SF2;
            c.setLineDash([4 * SF2, 6 * SF2]);
            c.beginPath(); c.moveTo(x.left, py0); c.lineTo(x.right, py0); c.stroke();
            c.setLineDash([]);
            // pert line
            const pxPert = x.getPixelForValue(config.perturbation_start);
            if (pxPert >= x.left && pxPert <= x.right) {
              c.strokeStyle = 'rgba(109,79,194,0.7)'; c.lineWidth = 1.8 * SF2;
              c.setLineDash([4 * SF2, 4 * SF2]);
              c.beginPath(); c.moveTo(pxPert, ch.chartArea.top); c.lineTo(pxPert, ch.chartArea.bottom); c.stroke();
              c.setLineDash([]);
              c.fillStyle = 'rgba(109,79,194,0.85)';
              c.font = 'bold ' + Math.round(13 * SF2) + 'px monospace';
              c.fillText('PERT', pxPert + 4 * SF2, ch.chartArea.top + 16 * SF2);
            }
            c.restore();
          }
        };

        const fs2 = Math.round(10 * SF2);
        const ch2 = new Chart(cvs2 as unknown as HTMLCanvasElement, {
          type: 'line',
          data: {
            labels: tSl2,
            datasets: [
              { label: cfg2.control_col, data: rawSl2, borderColor: 'rgba(130,60,200,0.30)', borderWidth: 1.5 * SF2, pointRadius: 0, tension: 0 },
              { label: 'sm', data: smSl2, borderColor: 'rgba(120,20,100,0.85)', borderWidth: 2.5 * SF2, pointRadius: 0, tension: 0 },
            ]
          },
          options: {
            animation: false, responsive: false,
            layout: { padding: { top: 6, right: 10, bottom: 4, left: 4 } },
            plugins: {
              legend: { display: false },
              title: { display: true, text: 'Señal ' + secondaryLabel2 + ' — restricción ±' + lim.toFixed(4), color: '#1a1a1a', font: { family: 'Courier New', size: Math.round(14 * SF2), weight: 'bold' as const }, padding: { bottom: 6 } },
            },
            scales: {
              x: { type: 'linear', ticks: { font: { family: 'Courier New', size: fs2 }, color: '#444', maxTicksLimit: 10, maxRotation: 0 }, grid: { color: 'rgba(0,0,0,0.06)' }, border: { color: 'rgba(0,0,0,0.15)' }, title: { display: true, text: 'Tiempo (s)', font: { family: 'Courier New', size: fs2 }, color: '#333' } },
              y: { ticks: { font: { family: 'Courier New', size: fs2 }, color: '#444' }, grid: { color: 'rgba(0,0,0,0.06)' }, border: { color: 'rgba(0,0,0,0.15)' }, title: { display: true, text: cfg2.control_col, font: { family: 'Courier New', size: fs2 }, color: '#333' }, ...(cfg2.y_limits ? { min: cfg2.y_limits[0], max: cfg2.y_limits[1] } : {}) }
            }
          },
          plugins: [overlay2],
        });
        ch2.draw();
        const blob2 = await (cvs2 as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 1.0 });
        const pngConstraint = await new Promise<string>(res => {
          const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob2);
        });
        ch2.destroy();

        doc.addImage(pngConstraint, 'JPEG', M, chartTop, chartW, chartH);
        doc.setDrawColor(210,210,210); doc.setLineWidth(0.12);
        doc.rect(M, chartTop, chartW, chartH);

        // Right panel: score + details
        let py = chartTop + 4;
        doc.setFont('courier', 'bold'); doc.setFontSize(6); doc.setTextColor(130, 130, 130);
        doc.text('NOTA CONSTRAINT', panelX, py); py += 6;
        doc.setFont('courier', 'bold'); doc.setFontSize(14); doc.setTextColor(...csRgb);
        doc.text(cs.toFixed(1) + ' / 100', panelX, py); py += 7;

        doc.setDrawColor(210,210,210); doc.setLineWidth(0.12); doc.line(panelX, py, panelX + panelW, py); py += 4;

        doc.setFont('courier', 'bold'); doc.setFontSize(6); doc.setTextColor(100, 100, 100);
        doc.text('MAX ABSOLUTO', panelX, py); py += 4;
        doc.setFont('courier', 'normal'); doc.setFontSize(6); doc.setTextColor(60, 60, 60);
        doc.text('max|' + secondaryLabel2 + '| = ' + constraintResult.max_abs_val.toFixed(5), panelX, py); py += 3.5;
        doc.text('lim 100  = ' + lim.toFixed(5), panelX, py); py += 3.5;
        doc.text('lim 0    = ' + lim0.toFixed(5), panelX, py); py += 5;

        doc.setDrawColor(210,210,210); doc.line(panelX, py, panelX + panelW, py); py += 4;
        doc.setFont('courier', 'bold'); doc.setFontSize(6); doc.setTextColor(100, 100, 100);
        doc.text('OBSERVACIÓN', panelX, py); py += 4;
        doc.setFont('courier', 'normal'); doc.setFontSize(5.5); doc.setTextColor(80, 80, 80);
        doc.text('> ' + safe(constraintResult.comment), panelX, py, { maxWidth: panelW });

        // Footer
        doc.setTextColor(150,150,150); doc.setFontSize(5.5);
        doc.text('Self Checker — IE TEC', M, PH - 2);
        doc.setFont('courier','normal'); doc.setFontSize(4.8); doc.setTextColor(175,175,175);
        doc.text(serialCode, PW - M, PH - 2, { align: 'right' });
      }

      // Metadata
      (doc as any).setDocumentProperties?.({
        title:    'Self-Checker ' + config.label + ' ' + domain,
        author:   teamName.trim() || 'unknown',
        subject:  teamName.trim() || '—',
        keywords: serialCode,
        creator:  'Self Checker IE TEC',
      });

      const safeName = (pdfFileName || 'reporte').replace(/[^a-z0-9_\-]/gi, '_');
      doc.save(safeName + '.pdf');

      // ── Log to Google Sheets ──────────────────────────────────────────────
      const logPayload = {
        timestamp:  new Date().toISOString(),
        user:       '—',
        team:       teamName.trim()      || '—',
        plant:      config.label,
        domain,
        score:      result.final_score.toFixed(1),
        st:         result.ST_score.toFixed(1),
        os:         result.OS_score.toFixed(1),
        ess:        result.ESS_score.toFixed(1),
        pert:       result.Pert_score.toFixed(1),
        serial:     serialCode,
        csv_file:   csvFileName,
      };
      try {
        const params = new URLSearchParams(logPayload as any).toString();
        await fetch(SHEETS_URL + '?' + params, { method: 'GET', mode: 'no-cors' });
      } catch (_) { /* log failure is non-fatal */ }
    } catch (e: any) {
      errorMsg = 'Error: ' + (e?.message ?? String(e));
      console.error(e);
    } finally {
      generating = false;
    }
  }
</script>

<!-- Trigger button ─────────────────────────────────────────────────────────── -->
<button
  class="report-btn"
  onclick={() => { open = true; errorMsg = ''; }}
>
  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
       fill="none" stroke="currentColor" stroke-width="2.5"
       stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
  REPORTE
</button>

<!-- Modal ──────────────────────────────────────────────────────────────────── -->
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_interactive_supports_focus -->
  <div class="backdrop" role="presentation"
       onclick={(e) => { if (e.target === e.currentTarget && !generating) open = false; }}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">

      <div class="modal-head">
        <div>
          <span class="modal-title">GENERAR REPORTE</span>
          <span class="modal-sub">{config.label} · {domain.toUpperCase()} · A4</span>
        </div>
        <button class="close-btn" onclick={() => { if (!generating) open = false; }}
                disabled={generating}>✕</button>
      </div>


      <!-- Team name -->
      <div class="field-row-wrap">
        <label class="field-label" for="rg-team">Equipo:</label>
        <input id="rg-team" class="field-input" type="text"
               bind:value={teamName} placeholder="Ej: Equipo 3 — Sección 1" />
      </div>

      <!-- Filename editable -->
      <div class="filename-edit-row">
        <input
          class="field-input filename-edit-input"
          type="text"
          bind:value={pdfFileName}
          oninput={() => fileNameTouched = true}
          placeholder="nombre_del_archivo"
        />
        <span class="filename-ext">.pdf</span>
        <button
          class="filename-reset"
          onclick={() => { pdfFileName = suggestFileName(); fileNameTouched = false; }}
          title="Restaurar nombre sugerido"
        >↺</button>
      </div>

      {#if errorMsg}
        <div class="err-row">{errorMsg}</div>
      {/if}

      <div class="actions">
        <button class="btn-cancel" onclick={() => { if (!generating) open = false; }}
                disabled={generating}>CANCELAR</button>
        <button class="btn-go" onclick={generate} disabled={generating}>
          {#if generating}
            <span class="spinner"></span>GENERANDO...
          {:else}
            ↓ DESCARGAR PDF
          {/if}
        </button>
      </div>

    </div>
  </div>
{/if}

<style>
  .report-btn {
    display: flex; align-items: center; gap: 0.3rem;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.58rem; font-weight: 700; letter-spacing: 0.1em;
    padding: 0.18rem 0.55rem;
    border: 1px solid var(--border, #444); border-radius: 3px;
    background: var(--background, #0d0d0d); color: var(--muted-foreground, #888);
    cursor: pointer; transition: all 0.15s;
  }
  .report-btn:hover { border-color: var(--foreground, #eee); color: var(--foreground, #eee); }

  .backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.65); backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center;
  }

  .modal {
    font-family: 'Courier New', Courier, monospace;
    background: var(--card, #111);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 6px;
    padding: 1.25rem 1.5rem;
    width: min(400px, 90vw);
    display: flex; flex-direction: column; gap: 0.85rem;
    box-shadow: 0 20px 60px rgba(0,0,0,0.7);
  }

  .modal-head {
    display: flex; justify-content: space-between; align-items: flex-start;
  }
  .modal-title {
    display: block; font-size: 0.72rem; font-weight: 700;
    letter-spacing: 0.14em; color: var(--foreground, #e5e5e5);
  }
  .modal-sub {
    display: block; font-size: 0.6rem;
    color: var(--muted-foreground, #555); margin-top: 0.2rem;
  }
  .close-btn {
    font-family: 'Courier New', Courier, monospace; font-size: 0.75rem;
    background: none; border: none; color: var(--muted-foreground, #555);
    cursor: pointer; padding: 0.1rem 0.3rem; line-height: 1; transition: color 0.15s;
  }
  .close-btn:hover { color: var(--foreground, #eee); }


  .sep { height: 1px; background: var(--border, #1e1e1e); }

  .field-row-wrap {
    display: flex; align-items: center; gap: 0.6rem;
  }
  .field-label {
    font-size: 0.62rem; font-weight: 700; letter-spacing: 0.08em;
    color: var(--muted-foreground, #666); white-space: nowrap;
  }
  .field-input {
    font-family: 'Courier New', Courier, monospace; font-size: 0.72rem;
    padding: 0.3rem 0.6rem;
    background: var(--background, #0d0d0d);
    border: 1px solid var(--border, #2a2a2a); border-radius: 4px;
    color: var(--foreground, #e5e5e5); width: 100%; transition: border-color 0.15s;
  }
  .field-input:focus { outline: none; border-color: var(--muted-foreground, #555); }
  .field-input::placeholder { color: var(--muted-foreground, #333); }

  .filename-edit-row {
    display: flex; align-items: center; gap: 0.35rem;
  }
  .filename-edit-input {
    flex: 1; font-size: 0.68rem !important; min-width: 0;
  }
  .filename-ext {
    font-size: 0.62rem; color: var(--muted-foreground, #555); white-space: nowrap; flex-shrink: 0;
  }
  .filename-reset {
    font-family: 'Courier New', Courier, monospace; font-size: 0.75rem;
    background: none; border: 1px solid var(--border, #2a2a2a); border-radius: 3px;
    color: var(--muted-foreground, #555); cursor: pointer; padding: 0.2rem 0.4rem;
    transition: all 0.12s; flex-shrink: 0; line-height: 1;
  }
  .filename-reset:hover { border-color: var(--foreground); color: var(--foreground); }


  .err-row {
    font-size: 0.65rem; color: #f87171;
    background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25);
    border-radius: 3px; padding: 0.4rem 0.6rem;
  }

  .actions { display: flex; gap: 0.6rem; }
  .btn-cancel, .btn-go {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em;
    padding: 0.45rem 0.8rem; border-radius: 4px; cursor: pointer;
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.4rem;
    transition: all 0.15s;
  }
  .btn-cancel {
    background: var(--background, #0d0d0d); border: 1px solid var(--border, #2a2a2a);
    color: var(--muted-foreground, #777);
  }
  .btn-cancel:hover:not(:disabled) { border-color: var(--foreground); color: var(--foreground); }
  .btn-go {
    background: var(--foreground, #e5e5e5); border: 1px solid var(--foreground, #e5e5e5);
    color: var(--background, #0d0d0d);
  }
  .btn-go:hover:not(:disabled) { opacity: 0.85; }
  .btn-cancel:disabled, .btn-go:disabled { opacity: 0.35; cursor: not-allowed; }

  .spinner {
    width: 10px; height: 10px; border: 1.5px solid currentColor;
    border-top-color: transparent; border-radius: 50%;
    animation: spin 0.7s linear infinite; display: inline-block;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>