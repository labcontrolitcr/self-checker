<script lang="ts">
  import PlantSelector from '$lib/components/PlantSelector.svelte';
  import ResponseChart from '$lib/components/ResponseChart.svelte';
  import StatsPanel from '$lib/components/StatsPanel.svelte';
  import type { PlantConfig } from '$lib/config/plants.config';
  import { parseCSV, parseCSVHeaders, analyzeResponse } from '$lib/analysis';
  import type { AnalysisResult } from '$lib/analysis';

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
  let selectedTimeCol    = $state<string>('');
  let selectedControlCol = $state<string>('');

  // ── Time column regex ──────────────────────────────────────────────────────
  const TIME_RE = /^(tiempo|t|k)$/i;

  function findTimeCol(headers: string[]): string | null {
    return headers.find(h => TIME_RE.test(h.trim())) ?? null;
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const hasData         = $derived(rows.length > 0 && result !== null);
  const showColSelector = $derived(csvHeaders !== null && fileName !== '' && !error);

  // csvReady: file loaded, no error, and time col identified — unlocks domain step
  const csvReady = $derived(
    fileName !== '' && !error && selectedTimeCol !== '' && selectedControlCol !== ''
  );

  // ── Analysis runner — only called when domain is already set ───────────────
  function runAnalysis(timeCol: string, ctrlCol: string, csvText: string, plant: PlantConfig) {
    error = '';
    try {
      const cfg = {
        ...plant,
        experiment_start: experimentStart,
        perturbation_start: perturbationStart,
        perturbation_window: perturbationWindow,
        csv_cols: csvHeaders ?? plant.csv_cols,
        time_col: timeCol,
        control_col: ctrlCol,
      };
      const parsed = parseCSV(csvText, cfg.csv_cols);
      if (parsed.length < 10) throw new Error('Archivo muy corto o formato incorrecto.');
      rows = parsed;
      result = analyzeResponse(parsed, cfg);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      rows = []; result = null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function clearAll() {
    rows = []; result = null; error = '';
    fileName = ''; cachedCSVText = ''; cachedFileName = '';
    csvHeaders = null; headersMatch = false;
    selectedTimeCol = ''; selectedControlCol = '';
  }

  function clearResults() {
    rows = []; result = null;
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
    selectedTimeCol = ''; selectedControlCol = '';
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
      csvHeaders         = selectedPlant.csv_cols;
      headersMatch       = true;
      selectedTimeCol    = selectedPlant.time_col;
      selectedControlCol = selectedPlant.control_col;
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

    const expected   = selectedPlant.csv_cols.map(c => c.toLowerCase());
    const actual     = headers.map(h => h.toLowerCase());
    headersMatch     = expected.every(ex => actual.includes(ex));

    if (headersMatch) {
      const ctrlCol = headers.find(h => h.toLowerCase() === selectedPlant!.control_col.toLowerCase())
        ?? headers.find(h => h !== timeCol)
        ?? headers[0];
      selectedControlCol = ctrlCol;
    } else {
      // Mismatch — pre-select best guess, user can change
      selectedControlCol = headers.find(h => h !== timeCol) ?? headers[0];
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
      csvColHint={selectedPlant ? selectedPlant.csv_cols.join(', ') : ''}
      csvError={error}
      {csvReady}
      {showColSelector}
      {csvHeaders}
      {headersMatch}
      {selectedTimeCol}
      {selectedControlCol}
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
      csv_cols: csvHeaders ?? selectedPlant.csv_cols,
      time_col: selectedTimeCol,
      control_col: selectedControlCol,
    }}
    <section class="results-section" class:panel-collapsed={panelCollapsed}>
      <div class="chart-area">
        <ResponseChart {rows} config={cfg} {result} domain={selectedDomain} {chartHeight} />
      </div>

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
        <StatsPanel {result} config={cfg} domain={selectedDomain} />
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