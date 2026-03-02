<script lang="ts">
  import PlantSelector from '$lib/components/PlantSelector.svelte';
  import ResponseChart from '$lib/components/ResponseChart.svelte';
  import StatsPanel from '$lib/components/StatsPanel.svelte';
  import type { PlantConfig } from '$lib/config/plants.config';
  import { parseCSV, parseCSVHeaders, analyzeResponse } from '$lib/analysis';
  import type { AnalysisResult } from '$lib/analysis';

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedPlant  = $state<PlantConfig | null>(null);
  let selectedDomain = $state<'continuo' | 'discreto' | null>(null);
  let rows           = $state<Record<string, number>[]>([]);
  let result         = $state<AnalysisResult | null>(null);
  let fileName       = $state<string>('');
  let error          = $state<string>('');

  let perturbationStart  = $state<number>(0);
  let perturbationWindow = $state<number>(0.3);

  let cachedCSVText  = $state<string>('');
  let cachedFileName = $state<string>('');

  let showReusePrompt = $state(false);
  let pendingDomain   = $state<'continuo' | 'discreto' | null>(null);

  let csvHeaders         = $state<string[] | null>(null);
  let headersMatch       = $state(false);
  let selectedTimeCol    = $state<string>('');
  let selectedControlCol = $state<string>('');

  // ── Time column regex ──────────────────────────────────────────────────────
  // Matches: tiempo, Tiempo, TIEMPO, t, T, k, K (exact match only)
  const TIME_RE = /^(tiempo|t|k)$/i;

  function findTimeCol(headers: string[]): string | null {
    return headers.find(h => TIME_RE.test(h.trim())) ?? null;
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const ready           = $derived(selectedPlant !== null && selectedDomain !== null && !showReusePrompt);
  const hasData         = $derived(rows.length > 0 && result !== null);
  const showColSelector = $derived(csvHeaders !== null && fileName !== '');

  // ── Analysis runner — plain function, called explicitly, NEVER from $effect ─
  function runAnalysis(timeCol: string, ctrlCol: string, csvText: string, plant: PlantConfig) {
    console.log(`[SC] runAnalysis → time=${timeCol} ctrl=${ctrlCol}`);
    error = '';
    try {
      const hdrs = csvHeaders;
      const cfg = {
        ...plant,
        perturbation_start: perturbationStart,
        perturbation_window: perturbationWindow,
        csv_cols: hdrs ?? plant.csv_cols,
        time_col: timeCol,
        control_col: ctrlCol,
      };
      const parsed = parseCSV(csvText, cfg.csv_cols);
      console.log(`[SC] parsed ${parsed.length} rows`);
      if (parsed.length < 10) throw new Error('Archivo muy corto o formato incorrecto.');
      rows = parsed;
      result = analyzeResponse(parsed, cfg);
      console.log(`[SC] OK — score: ${result.final_score.toFixed(1)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[SC] ERROR: ${msg}`);
      error = msg;
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

  // ── Plant / domain ─────────────────────────────────────────────────────────
  function handlePlantSelect(plant: PlantConfig) {
    selectedPlant = plant;
    perturbationStart  = plant.perturbation_start;
    perturbationWindow = plant.perturbation_window;
    selectedDomain = null;
    showReusePrompt = false;
    pendingDomain = null;
    clearAll();
  }

  function handleDomainSelect(domain: 'continuo' | 'discreto') {
    if (cachedCSVText && selectedPlant && domain !== selectedDomain) {
      pendingDomain = domain;
      showReusePrompt = true;
      return;
    }
    applyDomain(domain);
  }

  function applyDomain(domain: 'continuo' | 'discreto', reuse = false) {
    selectedDomain = domain;
    showReusePrompt = false;
    pendingDomain = null;

    if (reuse && cachedCSVText && selectedPlant && selectedTimeCol && selectedControlCol) {
      fileName = cachedFileName;
      runAnalysis(selectedTimeCol, selectedControlCol, cachedCSVText, selectedPlant);
    } else {
      clearAll();
    }
  }

  function confirmReuse(reuse: boolean) {
    if (pendingDomain) applyDomain(pendingDomain, reuse);
  }

  // ── Perturbation change ────────────────────────────────────────────────────
  function handlePerturbationChange(start: number, win: number) {
    perturbationStart  = start;
    perturbationWindow = win;
    if (cachedCSVText && selectedPlant && selectedTimeCol && selectedControlCol) {
      runAnalysis(selectedTimeCol, selectedControlCol, cachedCSVText, selectedPlant);
    }
  }

  // ── File upload ────────────────────────────────────────────────────────────
  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !selectedPlant) return;

    rows = []; result = null; error = '';
    selectedTimeCol = ''; selectedControlCol = '';
    csvHeaders = null; headersMatch = false;

    const text = await file.text();
    cachedCSVText  = text;
    cachedFileName = file.name;
    fileName       = file.name;

    const headers = parseCSVHeaders(text);
    console.log(`[SC] headers: ${headers ? headers.join(', ') : 'none'}`);

    if (!headers) {
      // No header row — validate time col from plant config
      if (!TIME_RE.test(selectedPlant.time_col.trim())) {
        error = `No encontré la columna de tiempo (tiempo, t, Tiempo, TIEMPO, k, K).`;
        return;
      }
      csvHeaders = selectedPlant.csv_cols;
      headersMatch = true;
      selectedTimeCol    = selectedPlant.time_col;
      selectedControlCol = selectedPlant.control_col;
      runAnalysis(selectedTimeCol, selectedControlCol, text, selectedPlant);
      return;
    }

    csvHeaders = headers;

    // Find time column
    const timeCol = findTimeCol(headers);
    if (!timeCol) {
      error = `No encontré la columna de tiempo (tiempo, t, Tiempo, TIEMPO, k, K). Columnas: ${headers.join(', ')}`;
      console.log('[SC] ERROR: no time col');
      return;
    }
    selectedTimeCol = timeCol;

    // Check if all expected cols are present
    const expected = selectedPlant.csv_cols.map(c => c.toLowerCase());
    const actual   = headers.map(h => h.toLowerCase());
    headersMatch = expected.every(ex => actual.includes(ex));
    console.log(`[SC] headersMatch=${headersMatch}`);

    if (headersMatch) {
      // Auto-select ctrl col and run immediately — exactly once
      const ctrlCol = headers.find(h => h.toLowerCase() === selectedPlant!.control_col.toLowerCase())
        ?? headers.find(h => h !== timeCol)
        ?? headers[0];
      selectedControlCol = ctrlCol;
      runAnalysis(timeCol, ctrlCol, text, selectedPlant);
    } else {
      // Mismatch — pre-select best guess but wait for user to click a ctrl button
      selectedControlCol = headers.find(h => h !== timeCol) ?? headers[0];
      console.log('[SC] waiting for user to select ctrl col');
    }
  }

  // ── Column button clicks — each runs analysis exactly once ────────────────
  function selectTimeCol(col: string) {
    selectedTimeCol = col;
    console.log(`[SC] user → time col: ${col}`);
    if (selectedControlCol && cachedCSVText && selectedPlant) {
      runAnalysis(col, selectedControlCol, cachedCSVText, selectedPlant);
    }
  }

  function selectControlCol(col: string) {
    selectedControlCol = col;
    console.log(`[SC] user → ctrl col: ${col}`);
    if (selectedTimeCol && cachedCSVText && selectedPlant) {
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
      {selectedPlant}
      {selectedDomain}
      {perturbationStart}
      {perturbationWindow}
      onPlantSelect={handlePlantSelect}
      onDomainSelect={handleDomainSelect}
      onPerturbationChange={handlePerturbationChange}
    />

    {#if showReusePrompt}
      <div class="reuse-prompt">
        <span class="reuse-msg">
          Cambio de dominio. Usar el mismo archivo
          <span class="reuse-filename">{cachedFileName}</span>?
        </span>
        <div class="reuse-btns">
          <button class="sel-btn active" onclick={() => confirmReuse(true)}>SI, REUTILIZAR</button>
          <button class="sel-btn" onclick={() => confirmReuse(false)}>NO, SUBIR NUEVO</button>
        </div>
      </div>
    {/if}

    {#if ready}
      <div class="step">
        <span class="step-label">3. ARCHIVO CSV</span>
        <label class="upload-btn">
          {fileName || 'Seleccionar archivo...'}
          <input type="file" accept=".csv" onchange={handleFile} />
        </label>
        {#if !fileName && selectedPlant}
          <span class="col-hint">esperado: {selectedPlant.csv_cols.join(', ')}</span>
        {/if}
      </div>

      {#if showColSelector && csvHeaders && selectedPlant}
        <div class="col-detection" class:mismatch={!headersMatch}>

          {#if !headersMatch}
            <div class="col-warning">
              COLUMNAS NO RECONOCIDAS — esperado: {selectedPlant.csv_cols.join(', ')}
            </div>
          {/if}

          <div class="col-selector-row">
            <span class="col-selector-label">TIEMPO</span>
            <div class="btn-row">
              {#each csvHeaders as col}
                <button
                  class="col-btn"
                  class:active={selectedTimeCol === col}
                  onclick={() => selectTimeCol(col)}
                >{col}</button>
              {/each}
            </div>
          </div>

          <div class="col-selector-row">
            <span class="col-selector-label">COLUMNA</span>
            <div class="btn-row">
              {#each csvHeaders as col}
                <button
                  class="col-btn"
                  class:active={selectedControlCol === col}
                  onclick={() => selectControlCol(col)}
                >{col}</button>
              {/each}
            </div>
          </div>

          <div class="semaphore-row">
            <span class="semaphore" class:open={hasData}>
              {hasData ? '● ANALIZADO' : '○ SELECCIONA COLUMNAS'}
            </span>
          </div>

        </div>
      {/if}
    {/if}

  </section>

  {#if error}
    <div class="error-box">{error}</div>
  {/if}

{#if hasData && selectedDomain && result && selectedPlant}
    {@const cfg = {
      ...selectedPlant,
      perturbation_start: perturbationStart,
      perturbation_window: perturbationWindow,
      csv_cols: csvHeaders ?? selectedPlant.csv_cols,
      time_col: selectedTimeCol,
      control_col: selectedControlCol,
    }}
    <section class="results-section">
      <div class="chart-area">
        <ResponseChart {rows} config={cfg} {result} domain={selectedDomain} />
      </div>
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

  .step { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }

  .step-label {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--muted-foreground);
    white-space: nowrap;
    min-width: 5.5rem;
  }

  .upload-btn {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.75rem;
    padding: 0.35rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    color: var(--foreground);
  }
  .upload-btn:hover { background: var(--accent); border-color: var(--foreground); }
  .upload-btn input { display: none; }

  .col-hint {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.65rem;
    color: var(--muted-foreground);
  }

  .col-detection {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--accent, #141414);
  }

  .col-detection.mismatch {
    border-color: rgba(239, 68, 68, 0.45);
    background: rgba(239, 68, 68, 0.05);
  }

  .col-warning {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.63rem;
    color: rgba(239, 68, 68, 0.9);
    font-weight: 600;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid rgba(239, 68, 68, 0.2);
  }

  .col-selector-row { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }

  .col-selector-label {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--muted-foreground);
    white-space: nowrap;
    min-width: 4.5rem;
  }

  .btn-row { display: flex; gap: 0.4rem; flex-wrap: wrap; }

  .col-btn {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.7rem;
    padding: 0.25rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--background);
    color: var(--muted-foreground);
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .col-btn:hover { border-color: var(--foreground); color: var(--foreground); }
  .col-btn.active { background: var(--foreground); color: var(--background); border-color: var(--foreground); }

  .semaphore-row { padding-top: 0.2rem; border-top: 1px solid var(--border); }
  .semaphore {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    color: var(--muted-foreground);
  }
  .semaphore.open { color: #4ade80; }

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

  .error-box {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.72rem;
    color: #f87171;
    border: 1px solid rgba(248,113,113,0.5);
    border-radius: 4px;
    padding: 0.5rem 0.8rem;
  }

  .results-section {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }


</style>