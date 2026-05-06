<script lang="ts">
  import PlantSelector from '$lib/components/PlantSelector.svelte';
  import ResponseChart from '$lib/components/ResponseChart.svelte';
  import StatsPanel from '$lib/components/StatsPanel.svelte';
  import type { PlantConfig } from '$lib/config/plants.config';
  import { resolveCsvCols, csvColsHint } from '$lib/config/plants.config';
  import { parseCSV, parseCSVHeaders, analyzeResponse, analyzeConstraint, scorePrimaryNoPert } from '$lib/analysis';
  import type { AnalysisResult, ConstraintResult } from '$lib/analysis';

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedPlant  = $state<PlantConfig | null>(null);
  let panelCollapsed = $state(false);

  // ── Chart resize handle (lives in page, between config and results) ────────
  const CHART_MIN = 200;
  const CHART_MAX = 900;
  let chartHeight  = $state(400);
  let isResizing   = $state(false);
  let resizeStartY = 0;
  let resizeStartH = 0;

  function onResizeDown(e: PointerEvent) {
    e.preventDefault();
    isResizing   = true;
    resizeStartY = e.clientY;
    resizeStartH = chartHeight;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizeMove(e: PointerEvent) {
    if (!isResizing) return;
    chartHeight = Math.min(CHART_MAX, Math.max(CHART_MIN, resizeStartH + e.clientY - resizeStartY));
  }

  function onResizeUp(e: PointerEvent) {
    if (!isResizing) return;
    isResizing = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }
  let selectedDomain = $state<'continuo' | 'discreto' | null>(null);
  let rows           = $state<Record<string, number>[]>([]);
  let result         = $state<AnalysisResult | null>(null);
  let result2          = $state<AnalysisResult | null>(null);     // secondary variable (normal mode)
  let constraintResult = $state<ConstraintResult | null>(null);  // secondary variable (constraint mode)
  let fileName       = $state<string>('');
  let error          = $state<string>('');   // CSV-level error (no time col, too short, etc.)

  let experimentStart    = $state<number>(0);
  let perturbationStart  = $state<number>(0);
  let perturbationWindow = $state<number>(0.3);

  let cachedCSVText  = $state<string>('');
  let cachedFileName = $state<string>('');

  let showReusePrompt    = $state(false);
  let pendingDomain      = $state<'continuo' | 'discreto' | null>(null);
  let domainEverSelected = $state(false);  // true once user has picked a domain at least once

  let csvHeaders         = $state<string[] | null>(null);
  let headersMatch       = $state(false);
  let selectedTimeCol      = $state<string>('');
  let selectedControlCol   = $state<string>('');
  let selectedSecondaryCol = $state<string>('');

  // ── Time column regex ──────────────────────────────────────────────────────
  const TIME_RE = /^(tiempo|t|k)$/i;

  function findTimeCol(headers: string[]): string | null {
    return headers.find(h => TIME_RE.test(h.trim())) ?? null;
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const hasData         = $derived(rows.length > 0 && result !== null);
  const showColSelector = $derived(csvHeaders !== null && fileName !== '' && !error);

  // csvReady: file loaded, no error, and time col identified — unlocks domain step
  // For plants with a secondary variable, both cols must be chosen before unlocking domain
  const csvReady = $derived(
    fileName !== '' && !error && selectedTimeCol !== '' && selectedControlCol !== '' &&
    (selectedPlant?.secondary_control_col ? selectedSecondaryCol !== '' : true)
  );

  // ── Analysis runner — only called when domain is already set ───────────────
  function runAnalysis(timeCol: string, ctrlCol: string, csvText: string, plant: PlantConfig, secCol?: string) {
    error = '';
    try {
      const resolvedForRun = resolveCsvCols(plant.csv_cols, csvHeaders ?? []);
      const cfg = {
        ...plant,
        experiment_start: experimentStart,
        perturbation_start: perturbationStart,
        perturbation_window: perturbationWindow,
        csv_cols: csvHeaders ?? resolvedForRun.cols,
        time_col: timeCol,
        control_col: ctrlCol,
      };
      const parsed = parseCSV(csvText, cfg.csv_cols as string[]);
      if (parsed.length < 10) throw new Error('Archivo muy corto o formato incorrecto.');

      console.group(`[SelfChecker] ${plant.id} | ${selectedDomain} | ${new Date().toLocaleTimeString('es-CR')}`);
      console.log('── Configuración ──────────────────────────────');
      console.log(`  planta:           ${plant.id} (${plant.label})`);
      console.log(`  dominio:          ${selectedDomain}`);
      console.log(`  col tiempo:       ${timeCol}`);
      console.log(`  col primaria:     ${ctrlCol}  ref=${cfg.ref}`);
      console.log(`  exp_start:        ${experimentStart}s`);
      console.log(`  pert_start:       ${perturbationStart}s  window=${perturbationWindow}s`);
      console.log(`  t_obj:            ${plant.t_obj}s  t_win=${plant.t_win}s`);
      console.log(`  tol_st/os:        ±${(plant.tol_st*100).toFixed(1)}% / ${(plant.tol_os*100).toFixed(1)}%`);
      console.log(`  weights:          ST=${plant.weights.ST} OS=${plant.weights.OS} ESS=${plant.weights.ESS} Pert=${plant.weights.Pert}`);
      if ((plant as any).primary_weights_no_pert) {
        const w = (plant as any).primary_weights_no_pert;
        console.log(`  p_weights_noPert: ST=${w.ST} OS=${w.OS} ESS=${w.ESS}`);
      }
      console.log(`  filas:            ${parsed.length}  headers: [${Object.keys(parsed[0]).join(', ')}]`);
      const tArr = parsed.map((r: any) => r[timeCol]);
      const dt = (tArr[tArr.length-1] - tArr[0]) / (tArr.length - 1);
      console.log(`  t rango:          [${tArr[0]?.toFixed(3)}, ${tArr[tArr.length-1]?.toFixed(3)}]s  dt≈${(dt*1000).toFixed(2)}ms`);
      const sig = parsed.map((r: any) => r[ctrlCol]);
      const sigAfterStart = parsed.filter((r: any) => r[timeCol] >= experimentStart).map((r: any) => r[ctrlCol]);
      console.log(`  señal primaria:   min=${Math.min(...sig).toFixed(4)}  max=${Math.max(...sig).toFixed(4)}  final=${sigAfterStart[sigAfterStart.length-1]?.toFixed(4)}`);

      rows = parsed;
      result = analyzeResponse(parsed, cfg);

      console.log('── Resultado primario ─────────────────────────');
      console.log(`  final_score:  ${result.final_score.toFixed(2)}`);
      console.log(`  ST:   ${result.ST_score.toFixed(1)}  t_st=${result.settling_time_actual?.toFixed(3) ?? 'null'}s  prop_ok=${(result.ST_prop_ok*100).toFixed(1)}%`);
      console.log(`  OS:   ${result.OS_score.toFixed(1)}  pico=${result.OS_val.toFixed(4)}  OS%=${((Math.max(0, result.OS_val - cfg.ref) / cfg.ref) * 100).toFixed(2)}%`);
      console.log(`  ESS:  ${result.ESS_score.toFixed(1)}  pre_mean=${result.ESS_pre.mean.toFixed(4)}  err%=${result.ESS_pre.error_pct.toFixed(3)}  IAE=${(result as any).ESS_pre_iae?.toFixed(4)}`);
      console.log(`  Pert: ${result.Pert_score.toFixed(1)}  ST_pert=${result.Pert_ST_score.toFixed(1)}  ESS_post=${result.ESS_post_score.toFixed(1)}`);
      if (result.exp_start_warning) console.warn(`  ⚠ exp_start:  ${result.exp_start_warning}`);
      if (result.pert_warning)      console.warn(`  ⚠ pert:       ${result.pert_warning}`);
      if (result.ess_step_warning)  console.warn(`  ⚠ ess_step:   ${result.ess_step_warning}`);

      // Secondary variable
      const resolvedSecCol = secCol ?? selectedSecondaryCol;
      if ((plant as any).secondary_control_col && resolvedSecCol) {
        console.log('── Variable secundaria ────────────────────────');
        console.log(`  col:   ${resolvedSecCol}  (config: ${(plant as any).secondary_control_col})`);
        console.log(`  mode:  ${(plant as any).secondary_mode ?? 'normal'}`);
        const sig2 = parsed.map((r: any) => r[resolvedSecCol]);
        const sig2AfterStart = parsed.filter((r: any) => r[timeCol] >= experimentStart).map((r: any) => r[resolvedSecCol]);
        console.log(`  señal: min=${Math.min(...sig2).toFixed(4)}  max=${Math.max(...sig2).toFixed(4)}  max_abs=${Math.max(...sig2.map(Math.abs)).toFixed(4)} (post exp_start max_abs=${Math.max(...sig2AfterStart.map(Math.abs)).toFixed(4)})`);

        if ((plant as any).secondary_mode === 'constraint') {
          console.log(`  limit_100: ${(plant as any).constraint_limit?.toFixed(5)}  limit_0: ${(plant as any).constraint_zero?.toFixed(5)}`);
          constraintResult = analyzeConstraint(
            parsed, resolvedSecCol, cfg.time_col, experimentStart, perturbationStart,
            (plant as any).constraint_limit!, (plant as any).constraint_zero!,
          );
          console.log(`  constraint score: ${constraintResult.score.toFixed(2)}  max_abs=${constraintResult.max_abs_val.toFixed(5)}`);
          console.log(`  → ${constraintResult.comment}`);
          if ((plant as any).primary_weights_no_pert) {
            const w = (plant as any).primary_weights_no_pert;
            const total = w.ST + w.OS + w.ESS;
            const nopert = (result.ST_score*w.ST + result.OS_score*w.OS + result.ESS_score*w.ESS) / total;
            const combined = (nopert + result.Pert_score + constraintResult.score) / 3;
            console.log(`  nota combinada: (ST_OS_ESS=${nopert.toFixed(2)} + Pert=${result.Pert_score.toFixed(2)} + constraint=${constraintResult.score.toFixed(2)}) / 3 = ${combined.toFixed(2)}`);
          }
          const cfg2c = { ...cfg, control_col: resolvedSecCol, ref: 0, y_limits: (plant as any).secondary_y_limits ?? null };
          result2 = analyzeResponse(parsed, cfg2c);
        } else {
          constraintResult = null;
          const cfg2 = { ...cfg, control_col: resolvedSecCol, ref: (plant as any).secondary_ref ?? 0, y_limits: (plant as any).secondary_y_limits ?? null };
          result2 = analyzeResponse(parsed, cfg2);
          console.log(`  final_score: ${result2.final_score.toFixed(2)}  ST=${result2.ST_score.toFixed(1)}  OS=${result2.OS_score.toFixed(1)}  ESS=${result2.ESS_score.toFixed(1)}  Pert=${result2.Pert_score.toFixed(1)}`);
        }
      } else {
        if ((plant as any).secondary_control_col && !resolvedSecCol)
          console.warn(`  ⚠ secondary_control_col='${(plant as any).secondary_control_col}' pero resolvedSecCol vacío — columna no seleccionada`);
        result2 = null;
        constraintResult = null;
      }

      console.groupEnd();
    } catch (e) {
      console.error('[SelfChecker] Error en análisis:', e);
      error = e instanceof Error ? e.message : String(e);
      rows = []; result = null; result2 = null; constraintResult = null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function clearAll() {
    rows = []; result = null; result2 = null; constraintResult = null; error = '';
    fileName = ''; cachedCSVText = ''; cachedFileName = '';
    csvHeaders = null; headersMatch = false;
    selectedTimeCol = ''; selectedControlCol = ''; selectedSecondaryCol = '';
  }

  function clearResults() {
    rows = []; result = null; result2 = null; constraintResult = null;
  }

  // ── Plant select ───────────────────────────────────────────────────────────
  function handlePlantSelect(plant: PlantConfig) {
    selectedPlant      = plant;
    perturbationStart  = plant.perturbation_start;
    perturbationWindow = plant.perturbation_window;
    experimentStart    = 0;
    selectedDomain     = null;
    showReusePrompt    = false;
    pendingDomain      = null;
    domainEverSelected = false;
    clearAll();
  }

  // ── Domain select ──────────────────────────────────────────────────────────
  function handleDomainSelect(domain: 'continuo' | 'discreto') {
    // Only show reuse prompt when switching domains after having already chosen one
    if (domainEverSelected && cachedCSVText && selectedPlant && domain !== selectedDomain && fileName) {
      pendingDomain   = domain;
      showReusePrompt = true;
      return;
    }
    applyDomain(domain);
  }

  function applyDomain(domain: 'continuo' | 'discreto', reuse = false) {
    selectedDomain     = domain;
    domainEverSelected = true;
    showReusePrompt    = false;
    pendingDomain      = null;

    // Set experiment start from plant config for this domain
    if (selectedPlant) {
      experimentStart = selectedPlant.exp_start_t?.[domain] ?? 0;
    }

    if (reuse && cachedCSVText && selectedPlant && selectedTimeCol && selectedControlCol) {
      fileName = cachedFileName;
      // First analysis run after domain is chosen
      runAnalysis(selectedTimeCol, selectedControlCol, cachedCSVText, selectedPlant);
    } else if (!reuse && cachedCSVText && selectedPlant && selectedTimeCol && selectedControlCol) {
      // Domain selected fresh (not switching) — run analysis
      runAnalysis(selectedTimeCol, selectedControlCol, cachedCSVText, selectedPlant);
    } else {
      clearResults();
    }
  }

  function confirmReuse(reuse: boolean) {
    if (pendingDomain) applyDomain(pendingDomain, reuse);
    else showReusePrompt = false;
  }

  // ── Experiment start change ────────────────────────────────────────────────
  function handleExperimentStartChange(t: number) {
    experimentStart = t;
    if (selectedDomain && cachedCSVText && selectedPlant && selectedTimeCol && selectedControlCol) {
      runAnalysis(selectedTimeCol, selectedControlCol, cachedCSVText, selectedPlant);
    }
  }

  // ── Perturbation change ────────────────────────────────────────────────────
  function handlePerturbationChange(start: number, win: number) {
    perturbationStart  = start;
    perturbationWindow = win;
    if (selectedDomain && cachedCSVText && selectedPlant && selectedTimeCol && selectedControlCol) {
      runAnalysis(selectedTimeCol, selectedControlCol, cachedCSVText, selectedPlant);
    }
  }

  // ── File upload — parse only, do NOT run analysis yet ─────────────────────
  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file  = input.files?.[0];
    input.value = '';
    if (!file || !selectedPlant) return;

    // Reset everything except plant
    rows = []; result = null; error = '';
    selectedTimeCol = ''; selectedControlCol = ''; selectedSecondaryCol = '';
    csvHeaders = null; headersMatch = false;
    selectedDomain     = null;   // reset domain so user re-picks after new file
    domainEverSelected = false;

    const text = await file.text();
    cachedCSVText  = text;
    cachedFileName = file.name;
    fileName       = file.name;

    const headers = parseCSVHeaders(text);

    if (!headers) {
      // No header row — use plant config columns
      if (!TIME_RE.test(selectedPlant.time_col.trim())) {
        error = `No encontré la columna de tiempo (tiempo, t, k).`;
        return;
      }
      csvHeaders         = resolveCsvCols(selectedPlant.csv_cols, []).cols;
      headersMatch       = true;
      selectedTimeCol    = selectedPlant.time_col;
      selectedControlCol = selectedPlant.control_col;
      selectedSecondaryCol = selectedPlant.secondary_control_col ?? '';
      // Don't run analysis — wait for domain
      return;
    }

    csvHeaders = headers;

    const timeCol = findTimeCol(headers);
    if (!timeCol) {
      error = `No encontré la columna de tiempo (tiempo, t, k). Columnas: ${headers.join(', ')}`;
      return;
    }
    selectedTimeCol = timeCol;

    const { cols: resolvedCols, matched } = resolveCsvCols(selectedPlant.csv_cols, headers);
    headersMatch = matched;

    if (headersMatch) {
      const ctrlCol = headers.find(h => h.toLowerCase() === selectedPlant!.control_col.toLowerCase())
        ?? resolvedCols.find(c => c !== timeCol)
        ?? headers.find(h => h !== timeCol)
        ?? headers[0];
      selectedControlCol = ctrlCol;
      // Auto-detect secondary column
      if (selectedPlant!.secondary_control_col) {
        const sec = headers.find(h => h.toLowerCase() === selectedPlant!.secondary_control_col!.toLowerCase())
          ?? headers.find(h => h !== timeCol && h !== ctrlCol)
          ?? '';
        selectedSecondaryCol = sec;
      }
    } else {
      // Mismatch — map by position in csv_cols so the right column is pre-selected
      // e.g. grúa csv_cols = ['Tiempo','Posicion','Angulo','Entrada']
      // control_col = 'Posicion' is index 1 → map to headers[1] (skipping time)
      const cfgCols    = selectedPlant!.csv_cols as string[];
      const nonTimeCfg = cfgCols.filter(c => c.toLowerCase() !== selectedPlant!.time_col.toLowerCase());
      const nonTimeHdr = headers.filter(h => h !== timeCol);

      // Primary: position of control_col in non-time cfg cols → same position in actual headers
      const primaryIdx = nonTimeCfg.findIndex(
        c => c.toLowerCase() === selectedPlant!.control_col.toLowerCase()
      );
      selectedControlCol = nonTimeHdr[primaryIdx] ?? nonTimeHdr[0] ?? headers[0];

      if (selectedPlant!.secondary_control_col) {
        const secondaryIdx = nonTimeCfg.findIndex(
          c => c.toLowerCase() === selectedPlant!.secondary_control_col!.toLowerCase()
        );
        selectedSecondaryCol = nonTimeHdr[secondaryIdx] ?? nonTimeHdr.find(h => h !== selectedControlCol) ?? '';
      }
    }
    // Don't run analysis — wait for domain selection
  }

  // ── Column button clicks ───────────────────────────────────────────────────
  function selectTimeCol(col: string) {
    selectedTimeCol = col;
    // Don't re-run — domain hasn't been picked yet at this stage
  }

  function selectControlCol(col: string) {
    selectedControlCol = col;
    // If domain is already chosen (e.g. user changes col after analysis), re-run
    if (selectedDomain && cachedCSVText && selectedPlant && selectedTimeCol) {
      runAnalysis(selectedTimeCol, col, cachedCSVText, selectedPlant);
    }
  }

  function selectSecondaryCol(col: string) {
    selectedSecondaryCol = col;
    if (selectedDomain && cachedCSVText && selectedPlant && selectedTimeCol && selectedControlCol) {
      runAnalysis(selectedTimeCol, selectedControlCol, cachedCSVText, selectedPlant);
    }
  }
</script>

<main class="page">

  <header class="page-header">
    <span class="page-title">SELF-CHECKER</span>
    <span class="page-sub">Verificador de Respuesta de Controladores</span>
  </header>

  <section class="config-section">
    <PlantSelector
      collapsed={panelCollapsed}
      onCollapsedChange={(v) => panelCollapsed = v}
      {selectedPlant}
      {selectedDomain}
      {experimentStart}
      {perturbationStart}
      {perturbationWindow}
      {fileName}
      csvColHint={selectedPlant ? csvColsHint(selectedPlant.csv_cols) : ''}
      csvError={error}
      {csvReady}
      {showColSelector}
      {csvHeaders}
      {headersMatch}
      {selectedTimeCol}
      {selectedControlCol}
      {selectedSecondaryCol}
      {hasData}
      expStartWarning={result?.exp_start_warning ?? null}
      essStepWarning={result?.ess_step_warning ?? null}
      pertWarning={result?.pert_warning ?? null}
      onPlantSelect={handlePlantSelect}
      onDomainSelect={handleDomainSelect}
      onExperimentStartChange={handleExperimentStartChange}
      onPerturbationChange={handlePerturbationChange}
      onFileChange={handleFile}
      onTimeColSelect={selectTimeCol}
      onControlColSelect={selectControlCol}
      onSecondaryColSelect={selectSecondaryCol}
    />

    {#if showReusePrompt}
      <div class="reuse-prompt">
        <span class="reuse-msg">
          Cambio de dominio. ¿Usar el mismo archivo
          <span class="reuse-filename">{cachedFileName}</span>?
        </span>
        <div class="reuse-btns">
          <button class="sel-btn active" onclick={() => confirmReuse(true)}>SI, REUTILIZAR</button>
          <button class="sel-btn" onclick={() => confirmReuse(false)}>NO, SUBIR NUEVO</button>
        </div>
      </div>
    {/if}
  </section>

  {#if hasData && selectedDomain && result && selectedPlant}
    {@const cfg = {
      ...selectedPlant,
      experiment_start: experimentStart,
      perturbation_start: perturbationStart,
      perturbation_window: perturbationWindow,
      csv_cols: csvHeaders ?? resolveCsvCols(selectedPlant.csv_cols, []).cols,
      time_col: selectedTimeCol,
      control_col: selectedControlCol,
    }}
    {@const cfg2 = selectedPlant.secondary_control_col ? {
      ...cfg,
      control_col: selectedSecondaryCol || selectedPlant.secondary_control_col,
      ref: selectedPlant.secondary_mode === 'constraint' ? 0 : (selectedPlant.secondary_ref ?? 0),
      y_limits: selectedPlant.secondary_y_limits ?? null,
    } : null}
    {@const constraintScore = constraintResult?.score ?? null}
    {@const primaryNoPertScore = selectedPlant.primary_weights_no_pert
      ? scorePrimaryNoPert(result, selectedPlant.primary_weights_no_pert)
      : null}
    {@const combinedScore = constraintResult && primaryNoPertScore !== null
      ? (primaryNoPertScore + result.Pert_score + constraintScore!) / 3
      : null}
    <section class="results-section" class:panel-collapsed={panelCollapsed}>
      <div class="chart-area">
        <ResponseChart {rows} config={cfg} {result} domain={selectedDomain} {chartHeight} />
      </div>

      {#if cfg2 && result2}
        <div class="chart-area" style="margin-top: 0.5rem;">
          <ResponseChart
            {rows}
            config={cfg2}
            result={result2}
            domain={selectedDomain}
            {chartHeight}
            constraintBands={constraintResult ? {
              limit: selectedPlant.constraint_limit!,
              zero:  selectedPlant.constraint_zero!,
            } : undefined}
          />
        </div>
      {/if}

      <div
        class="resize-separator"
        class:dragging={isResizing}
        role="separator"
        aria-label="Arrastrar para redimensionar gráfico"
        onpointerdown={onResizeDown}
        onpointermove={onResizeMove}
        onpointerup={onResizeUp}
        onpointercancel={onResizeUp}
      ><div class="resize-grip"><span></span></div></div>

      <div class="stats-area">
        <StatsPanel
          {result}
          result2={result2 ?? undefined}
          {constraintResult}
          {combinedScore}
          {primaryNoPertScore}
          {cfg2}
          config={cfg}
          domain={selectedDomain}
          {rows}
          csvRaw={cachedCSVText}
          csvFileName={cachedFileName}
        />
      </div>
    </section>
  {/if}

</main>

<style>
  .page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .page-header { display: flex; flex-direction: column; gap: 0.2rem; }

  .page-title {
    font-family: 'Courier New', Courier, monospace;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.15em;
  }

  .page-sub {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    color: var(--muted-foreground);
  }

  .config-section {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .reuse-prompt {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--accent, #1a1a1a);
  }
  .reuse-msg { font-family: 'Courier New', Courier, monospace; font-size: 0.7rem; color: var(--foreground); }
  .reuse-filename { color: var(--muted-foreground); font-style: italic; }
  .reuse-btns { display: flex; gap: 0.5rem; }

  .sel-btn {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: 0.3rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--background);
    color: var(--foreground);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .sel-btn:hover { background: var(--accent); border-color: var(--foreground); }
  .sel-btn.active { background: var(--foreground); color: var(--background); }

  .results-section {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  /* ── Resize separator between chart and stats ───────────────────── */
  .resize-separator {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 1.25rem;
    cursor: ns-resize;
    user-select: none;
  }

  .resize-grip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 4rem;
    height: 10px;
    border-radius: 999px;
    background: #374151;
    transition: background 0.15s ease, width 0.15s ease;
  }

  .resize-grip::before,
  .resize-grip::after,
  .resize-grip span {
    content: '';
    display: block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #fff;
    opacity: 0.55;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }

  .resize-separator:hover .resize-grip {
    background: #4b5563;
    width: 5rem;
  }

  .resize-separator:hover .resize-grip::before,
  .resize-separator:hover .resize-grip::after,
  .resize-separator:hover .resize-grip span {
    opacity: 0.85;
  }

  .resize-separator.dragging .resize-grip {
    background: #6b7280;
    width: 5.5rem;
  }

  .resize-separator.dragging .resize-grip::before,
  .resize-separator.dragging .resize-grip::after,
  .resize-separator.dragging .resize-grip span {
    opacity: 1;
  }
</style>