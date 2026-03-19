<script lang="ts">
  import type { PlantConfig } from '$lib/config/plants.config';
  import { plants } from '$lib/config/plants.config';

  interface Props {
    collapsed?: boolean;
    onCollapsedChange?: (v: boolean) => void;
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
    essStepWarning: string | null;
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
    collapsed = false,
    onCollapsedChange,
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
    essStepWarning,
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

  // Local editable values — initialised from derived, user can type freely
  let localExpStart = $state('');
  let localStart = $state('');

  // Sync local inputs when props change (e.g. plant reset)
  $effect(() => { localExpStart = expStartStr; });
  $effect(() => { localStart = pertStartStr; });

  function commitExpStart(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(val) && val >= 0) {
      localExpStart = val.toFixed(3);
      onExperimentStartChange(val);
    } else {
      // Revert to last valid value
      localExpStart = experimentStart.toFixed(3);
    }
  }

  function commitStart(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(val) && val >= 0) {
      localStart = val.toFixed(3);
      onPerturbationChange(val, perturbationWindow);
    } else {
      localStart = perturbationStart.toFixed(3);
    }
  }


  function onKeydown(handler: (e: Event) => void) {
    return (e: KeyboardEvent) => {
      if (e.key === 'Enter') handler(e);
    };
  }
</script>

<div class="selection-panel" class:collapsed>

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
              oninput={(e) => localExpStart = (e.target as HTMLInputElement).value}
              onblur={commitExpStart}
              onkeydown={onKeydown(commitExpStart)}
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
              oninput={(e) => localStart = (e.target as HTMLInputElement).value}
              onblur={commitStart}
              onkeydown={onKeydown(commitStart)}
            />

          </div>
        </div>

        <!-- Semaphore — only visible once domain is selected -->
        {#if pertWarning}
          <div class="exp-start-warning">{pertWarning}</div>
        {/if}

        {#if essStepWarning}
          <div class="exp-start-warning">{essStepWarning}</div>
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

<!-- Expand/collapse controls — outside the panel so overflow:hidden doesn't clip them -->
{#if collapsed}
  <button class="expand-hint" onclick={() => onCollapsedChange?.(false)}>
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>expandir para configurar</span>
  </button>
{:else if hasData}
  <button class="collapse-btn" onclick={() => onCollapsedChange?.(true)} title="Contraer panel">
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 7.5L6 3.5L10 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
{/if}

<style>
  .selection-panel {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    position: relative;
    transition: all 0.25s ease;
  }

  /* ── Collapsed state ────────────────────────────────────────────── */
  .selection-panel {
    transition: max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                opacity 0.2s ease;
    max-height: 600px;  /* large enough for fully expanded */
  }

  .selection-panel.collapsed {
    max-height: 4.5rem;
    overflow: hidden;
  }



  /* ── Expand hint (shown when collapsed) ─────────────────────────── */
  .expand-hint {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.63rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: #6b7280;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.15rem 0;
    transition: color 0.15s ease;
    margin-left: auto;
  }

  .expand-hint:hover { color: #9ca3af; }

  /* ── Collapse button (↑ bottom-right when expanded) ─────────────── */
  .collapse-btn {
    animation: fadeIn 0.15s ease forwards;
  }

  .collapse-btn {
    display: flex;
    margin-left: auto;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: #6b7280;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    padding: 0;
  }

  .collapse-btn:hover {
    color: var(--foreground);
    border-color: var(--foreground);
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