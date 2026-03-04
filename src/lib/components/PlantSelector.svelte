<script lang="ts">
  import type { PlantConfig } from '$lib/config/plants.config';
  import { plants } from '$lib/config/plants.config';

  interface Props {
    selectedPlant: PlantConfig | null;
    selectedDomain: 'continuo' | 'discreto' | null;
    experimentStart: number;
    perturbationStart: number;
    perturbationWindow: number;
    fileName: string;
    csvColHint: string;
    csvError: string;           // error message from CSV parsing (no time col, too short, etc.)
    csvReady: boolean;          // true when file loaded and time col found — unlocks domain step
    showColSelector: boolean;
    csvHeaders: string[] | null;
    headersMatch: boolean;
    selectedTimeCol: string;
    selectedControlCol: string;
    hasData: boolean;
    expStartWarning: string | null;
    pertWarning: string | null;
    onPlantSelect: (plant: PlantConfig) => void;
    onDomainSelect: (domain: 'continuo' | 'discreto') => void;
    onExperimentStartChange: (t: number) => void;
    onPerturbationChange: (start: number, window: number) => void;
    onFileChange: (e: Event) => void;
    onTimeColSelect: (col: string) => void;
    onControlColSelect: (col: string) => void;
  }

  let {
    selectedPlant,
    selectedDomain,
    experimentStart,
    perturbationStart,
    perturbationWindow,
    fileName,
    csvColHint,
    csvError,
    csvReady,
    showColSelector,
    csvHeaders,
    headersMatch,
    selectedTimeCol,
    selectedControlCol,
    hasData,
    expStartWarning,
    pertWarning,
    onPlantSelect,
    onDomainSelect,
    onExperimentStartChange,
    onPerturbationChange,
    onFileChange,
    onTimeColSelect,
    onControlColSelect,
  }: Props = $props();

  // Derived strings — always in sync with props, no stale capture
  const expStartStr = $derived(experimentStart.toFixed(3));
  const pertStartStr = $derived(perturbationStart.toFixed(3));
  const pertWinStr = $derived(perturbationWindow.toFixed(3));

  // Local editable values — initialised from derived, user can type freely
  let localExpStart = $state('');
  let localStart = $state('');
  let localWindow = $state('');

  // Sync local inputs when props change (e.g. plant reset)
  $effect(() => { localExpStart = expStartStr; });
  $effect(() => { localStart = pertStartStr; });
  $effect(() => { localWindow = pertWinStr; });

  function handleExpStartInput(e: Event) {
    localExpStart = (e.target as HTMLInputElement).value;
    const val = parseFloat(localExpStart);
    if (!isNaN(val) && val >= 0) onExperimentStartChange(val);
  }

  function handleStartInput(e: Event) {
    localStart = (e.target as HTMLInputElement).value;
    const val = parseFloat(localStart);
    if (!isNaN(val) && val >= 0) onPerturbationChange(val, perturbationWindow);
  }

  function handleWindowInput(e: Event) {
    localWindow = (e.target as HTMLInputElement).value;
    const val = parseFloat(localWindow);
    if (!isNaN(val) && val > 0) onPerturbationChange(perturbationStart, val);
  }
</script>

<div class="selection-panel">

  <!-- Step 1: Plant — always visible -->
  <div class="step">
    <span class="step-label">1. PLANTA</span>
    <div class="btn-row">
      {#each plants as plant}
        <button
          class="sel-btn"
          class:active={selectedPlant?.id === plant.id}
          class:disabled={!plant.available}
          disabled={!plant.available}
          onclick={() => plant.available && onPlantSelect(plant)}
        >
          {plant.label}
          {#if !plant.available}<span class="soon">pronto</span>{/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- Step 2: CSV — appears when plant is selected -->
  {#if selectedPlant}
    <div class="step">
      <span class="step-label">2. ARCHIVO CSV</span>
      <label class="upload-btn" class:has-file={!!fileName}>
        {fileName || 'Seleccionar archivo...'}
        <input type="file" accept=".csv" onchange={onFileChange} />
      </label>
      {#if !fileName}
        <span class="col-hint">esperado: {csvColHint}</span>
      {/if}
    </div>

    <!-- Col selector / error — appears after file is chosen -->
    {#if fileName}
      {#if csvError}
        <div class="csv-error">{csvError}</div>
      {:else if showColSelector && csvHeaders}
        <div class="col-detection" class:mismatch={!headersMatch}>
          {#if !headersMatch}
            <div class="col-warning">
              COLUMNAS NO RECONOCIDAS — esperado: {csvColHint}
            </div>
          {/if}
          <div class="col-selector-row">
            <span class="col-selector-label">TIEMPO</span>
            <div class="btn-row">
              {#each csvHeaders as col}
                <button
                  class="col-btn"
                  class:active={selectedTimeCol === col}
                  onclick={() => onTimeColSelect(col)}
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
                  onclick={() => onControlColSelect(col)}
                >{col}</button>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    {/if}

    <!-- Step 3: Domain — appears when CSV is valid (time col found) -->
    {#if csvReady}
      <div class="step">
        <span class="step-label">3. DOMINIO</span>
        <div class="btn-row">
          {#each selectedPlant.domains as d}
            <button
              class="sel-btn"
              class:active={selectedDomain === d}
              onclick={() => onDomainSelect(d)}
            >
              {d === 'continuo' ? 'Continuo (T / s)' : 'Discreto (Z)'}
            </button>
          {/each}
        </div>
      </div>

      <!-- Steps 4 & 5: Exp start + Perturbation — appear when domain is chosen -->
      {#if selectedDomain}
        <div class="step">
          <span class="step-label">4. EXPERIMENTO</span>
          <div class="pert-row">
            <label class="pert-label" for="exp-start">Inicio (s)</label>
            <input
              id="exp-start"
              class="pert-input"
              type="number"
              step="0.001"
              min="0"
              value={localExpStart}
              oninput={handleExpStartInput}
            />
          </div>
        </div>

        {#if expStartWarning}
          <div class="exp-start-warning">{expStartWarning}</div>
        {/if}

        <div class="step">
          <span class="step-label">5. PERTURBACION</span>
          <div class="pert-row">
            <label class="pert-label" for="pert-start">Inicio (s)</label>
            <input
              id="pert-start"
              class="pert-input"
              type="number"
              step="0.01"
              min="0"
              value={localStart}
              oninput={handleStartInput}
            />
            <label class="pert-label" for="pert-window">Ventana (s)</label>
            <input
              id="pert-window"
              class="pert-input"
              type="number"
              step="0.01"
              min="0.01"
              value={localWindow}
              oninput={handleWindowInput}
            />
          </div>
        </div>

        <!-- Semaphore — only visible once domain is selected -->
        {#if pertWarning}
          <div class="exp-start-warning">{pertWarning}</div>
        {/if}

        <div class="semaphore-row">
          <span class="semaphore" class:open={hasData}>
            {hasData ? '● ANALIZADO' : '○ PROCESANDO...'}
          </span>
        </div>
      {/if}
    {/if}
  {/if}

</div>

<style>
  .selection-panel {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .step {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .step-label {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--muted-foreground);
    white-space: nowrap;
    min-width: 5.5rem;
  }

  .btn-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .sel-btn {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: 0.35rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--background);
    color: var(--foreground);
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .sel-btn:hover:not(.disabled) {
    background: var(--accent);
    border-color: var(--foreground);
  }

  .sel-btn.active {
    background: var(--foreground);
    color: var(--background);
    border-color: var(--foreground);
  }

  .sel-btn.disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .soon {
    font-size: 0.6rem;
    opacity: 0.6;
    font-weight: 400;
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
  .upload-btn.has-file { border-color: var(--foreground); }
  .upload-btn input { display: none; }

  .col-hint {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.65rem;
    color: var(--muted-foreground);
  }

  .csv-error {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.72rem;
    color: #f87171;
    border: 1px solid rgba(248, 113, 113, 0.4);
    border-radius: 4px;
    padding: 0.4rem 0.7rem;
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

  .pert-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .pert-label {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.68rem;
    color: var(--muted-foreground);
    letter-spacing: 0.06em;
  }

  .pert-input {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    width: 6rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--foreground);
  }

  .pert-input:focus {
    outline: none;
    border-color: var(--foreground);
  }

  .semaphore-row { padding-top: 0.1rem; }
  .semaphore {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    color: var(--muted-foreground);
  }
  .semaphore.open { color: #4ade80; }

  .exp-start-warning {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.68rem;
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.35);
    border-radius: 4px;
    padding: 0.45rem 0.75rem;
    line-height: 1.5;
  }
</style>