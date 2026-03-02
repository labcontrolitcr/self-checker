<script lang="ts">
  import type { PlantConfig } from '$lib/config/plants.config';
  import { plants } from '$lib/config/plants.config';

  interface Props {
    selectedPlant: PlantConfig | null;
    selectedDomain: 'continuo' | 'discreto' | null;
    perturbationStart: number;
    perturbationWindow: number;
    onPlantSelect: (plant: PlantConfig) => void;
    onDomainSelect: (domain: 'continuo' | 'discreto') => void;
    onPerturbationChange: (start: number, window: number) => void;
  }

  let {
    selectedPlant,
    selectedDomain,
    perturbationStart,
    perturbationWindow,
    onPlantSelect,
    onDomainSelect,
    onPerturbationChange,
  }: Props = $props();

  // Derived strings — always in sync with props, no stale capture
  const pertStartStr = $derived(perturbationStart.toFixed(3));
  const pertWinStr   = $derived(perturbationWindow.toFixed(3));

  // Local editable values — initialised from derived, user can type freely
  let localStart  = $state('');
  let localWindow = $state('');

  // Sync local inputs when props change (e.g. plant reset)
  $effect(() => { localStart  = pertStartStr; });
  $effect(() => { localWindow = pertWinStr; });

  function handleStartInput(e: Event) {
    localStart = (e.target as HTMLInputElement).value;
    const val = parseFloat(localStart);
    if (!isNaN(val) && val >= 0) {
      onPerturbationChange(val, perturbationWindow);
    }
  }

  function handleWindowInput(e: Event) {
    localWindow = (e.target as HTMLInputElement).value;
    const val = parseFloat(localWindow);
    if (!isNaN(val) && val > 0) {
      onPerturbationChange(perturbationStart, val);
    }
  }
</script>

<div class="selection-panel">

  <!-- Step 1: Plant -->
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

  <!-- Step 2: Domain -->
  {#if selectedPlant}
    <div class="step">
      <span class="step-label">2. DOMINIO</span>
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
  {/if}

  <!-- Step 4: Perturbation params -->
  {#if selectedPlant}
    <div class="step">
      <span class="step-label">4. PERTURBACION</span>
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
</style>