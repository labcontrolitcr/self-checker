<script lang="ts">
  // ChartLegend.svelte
  // Floating palette panel: visibility toggles + color + font-size for all chart elements.
  // Communicates via bound `items` array — parent owns the state.

  interface LegendItem {
    id: string;
    label: string;
    color: string;         // hex, e.g. "#82A6B1"
    visible: boolean;
    type: 'region' | 'line' | 'signal';  // region = filled box, line = dashed, signal = solid
    opacity?: number;      // 0–1, for regions only
  }

  interface Props {
    items: LegendItem[];
    fontSize: number;           // chart tick/label font size (px)
    onItemsChange: (items: LegendItem[]) => void;
    onFontSizeChange: (size: number) => void;
  }

  let { items, fontSize, onItemsChange, onFontSizeChange }: Props = $props();

  let open = $state(false);
  let panelEl: HTMLDivElement;

  function toggle(id: string) {
    onItemsChange(items.map(it => it.id === id ? { ...it, visible: !it.visible } : it));
  }

  function setColor(id: string, color: string) {
    onItemsChange(items.map(it => it.id === id ? { ...it, color } : it));
  }

  function handleOutside(e: MouseEvent) {
    if (panelEl && !panelEl.contains(e.target as Node)) open = false;
  }

  $effect(() => {
    if (open) document.addEventListener('click', handleOutside);
    else document.removeEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  });

  // Group items for display
  const signals = $derived(items.filter(i => i.type === 'signal'));
  const lines   = $derived(items.filter(i => i.type === 'line'));
  const regions = $derived(items.filter(i => i.type === 'region'));
</script>

<div class="legend-anchor" bind:this={panelEl}>
  <!-- Palette trigger button -->
  <button
    class="palette-btn"
    class:open
    onclick={(e) => { e.stopPropagation(); open = !open; }}
    title="Visualización"
    aria-label="Abrir panel de visualización"
  >
    <!-- Palette icon -->
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="8"  cy="10" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="7"  r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="16" cy="10" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="16" cy="15" r="1.5" fill="currentColor" stroke="none"/>
      <path d="M12 22c0 0-4-2-4-6" stroke-width="1.5"/>
    </svg>
  </button>

  {#if open}
    <div class="legend-panel" role="menu">
      <span class="panel-title">VISUALIZACIÓN</span>

      <!-- Font size -->
      <div class="font-row">
        <span class="group-label">FUENTE</span>
        <div class="font-controls">
          <button class="font-btn" onclick={() => onFontSizeChange(Math.max(7, fontSize - 1))}>−</button>
          <span class="font-val">{fontSize}px</span>
          <button class="font-btn" onclick={() => onFontSizeChange(Math.min(16, fontSize + 1))}>+</button>
        </div>
      </div>

      <div class="divider"></div>

      <!-- Signals -->
      {#if signals.length > 0}
        <span class="group-label">SEÑALES</span>
        {#each signals as item}
          <div class="item-row">
            <button
              class="eye-btn"
              class:hidden={!item.visible}
              onclick={() => toggle(item.id)}
              title={item.visible ? 'Ocultar' : 'Mostrar'}
            >
              {#if item.visible}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              {:else}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              {/if}
            </button>
            <span class="item-preview signal-preview" style="background:{item.color}; opacity:{item.visible ? 1 : 0.3}"></span>
            <span class="item-label" class:dim={!item.visible}>{item.label}</span>
            <label class="color-swatch" title="Cambiar color">
              <input type="color" value={item.color} oninput={(e) => setColor(item.id, (e.target as HTMLInputElement).value)} />
              <span class="hex-val">{item.color}</span>
            </label>
          </div>
        {/each}
        <div class="divider"></div>
      {/if}

      <!-- Lines -->
      {#if lines.length > 0}
        <span class="group-label">LÍNEAS</span>
        {#each lines as item}
          <div class="item-row">
            <button class="eye-btn" class:hidden={!item.visible} onclick={() => toggle(item.id)}
              title={item.visible ? 'Ocultar' : 'Mostrar'}>
              {#if item.visible}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              {:else}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                </svg>
              {/if}
            </button>
            <span class="item-preview line-preview" style="border-color:{item.color}; opacity:{item.visible ? 1 : 0.3}"></span>
            <span class="item-label" class:dim={!item.visible}>{item.label}</span>
            <label class="color-swatch" title="Cambiar color">
              <input type="color" value={item.color} oninput={(e) => setColor(item.id, (e.target as HTMLInputElement).value)} />
              <span class="hex-val">{item.color}</span>
            </label>
          </div>
        {/each}
        <div class="divider"></div>
      {/if}

      <!-- Regions -->
      {#if regions.length > 0}
        <span class="group-label">VENTANAS</span>
        {#each regions as item}
          <div class="item-row">
            <button class="eye-btn" class:hidden={!item.visible} onclick={() => toggle(item.id)}
              title={item.visible ? 'Ocultar' : 'Mostrar'}>
              {#if item.visible}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              {:else}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                </svg>
              {/if}
            </button>
            <span class="item-preview region-preview" style="background:{item.color}; opacity:{item.visible ? 0.6 : 0.15}"></span>
            <span class="item-label" class:dim={!item.visible}>{item.label}</span>
            <label class="color-swatch" title="Cambiar color">
              <input type="color" value={item.color} oninput={(e) => setColor(item.id, (e.target as HTMLInputElement).value)} />
              <span class="hex-val">{item.color}</span>
            </label>
          </div>
        {/each}
      {/if}

    </div>
  {/if}
</div>

<style>
  .legend-anchor { position: relative; }

  .palette-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.62rem;
    border: 1px solid var(--border, #444);
    border-radius: 3px;
    background: var(--background, #0d0d0d);
    color: var(--muted-foreground, #888);
    cursor: pointer;
    transition: all 0.15s;
    padding: 0;
  }
  .palette-btn:hover, .palette-btn.open {
    border-color: var(--foreground, #eee);
    color: var(--foreground, #eee);
  }

  .legend-panel {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    width: 230px;
    background: var(--card, #141414);
    border: 1px solid var(--border, #333);
    border-radius: 5px;
    padding: 0.75rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }

  .panel-title {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--muted-foreground, #555);
    margin-bottom: 0.1rem;
  }

  .group-label {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--muted-foreground, #555);
    margin-top: 0.15rem;
  }

  .divider { height: 1px; background: var(--border, #222); margin: 0.1rem 0; }

  /* Font size row */
  .font-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .font-controls { display: flex; align-items: center; gap: 0.4rem; }
  .font-btn {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.8rem;
    width: 1.2rem; height: 1.2rem;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--border, #333);
    border-radius: 2px;
    background: var(--background, #0d0d0d);
    color: var(--foreground, #ccc);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition: all 0.12s;
  }
  .font-btn:hover { border-color: var(--foreground); }
  .font-val {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.65rem;
    color: var(--foreground, #ccc);
    min-width: 2.2rem;
    text-align: center;
  }

  /* Item row */
  .item-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .eye-btn {
    display: flex; align-items: center; justify-content: center;
    width: 1rem; height: 1rem;
    background: none; border: none;
    color: var(--muted-foreground, #666);
    cursor: pointer; padding: 0; flex-shrink: 0;
    transition: color 0.12s;
  }
  .eye-btn:hover { color: var(--foreground, #eee); }
  .eye-btn.hidden { color: var(--muted-foreground, #444); }

  /* Preview swatches */
  .item-preview { flex-shrink: 0; border-radius: 2px; }
  .signal-preview { width: 18px; height: 3px; }
  .line-preview   { width: 18px; height: 0; border-top: 2px dashed; }
  .region-preview { width: 12px; height: 12px; border-radius: 2px; }

  .item-label {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.63rem;
    color: var(--foreground, #ccc);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: opacity 0.15s;
  }
  .item-label.dim { opacity: 0.35; }

  /* Color swatch + hex */
  .color-swatch {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    cursor: pointer;
    flex-shrink: 0;
  }
  .color-swatch input[type="color"] {
    width: 14px; height: 14px;
    padding: 0; border: 1px solid var(--border, #333);
    border-radius: 2px;
    background: none; cursor: pointer;
    -webkit-appearance: none;
  }
  .color-swatch input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
  .color-swatch input[type="color"]::-webkit-color-swatch { border: none; border-radius: 1px; }
  .hex-val {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.55rem;
    color: var(--muted-foreground, #555);
    letter-spacing: 0.04em;
  }
</style>