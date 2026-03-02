<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { PlantConfig } from '$lib/config/plants.config';
  import type { AnalysisResult } from '$lib/analysis';

  interface Props {
    rows: Record<string, number>[];
    config: PlantConfig;
    result: AnalysisResult;
    domain: 'continuo' | 'discreto';
  }

  let { rows, config, result, domain }: Props = $props();

  let canvas: HTMLCanvasElement;
  let chart: any = null;
  let menuOpen = $state(false);
  let menuEl: HTMLDivElement;

  let lockX = $state(false);
  let lockY = $state(false);
  let xMin = $state('');
  let xMax = $state('');
  let yMin = $state('');
  let yMax = $state('');

  // Build annotation object from current config + result
  function buildAnnotations() {
    const { ref, tol_st, tol_os, t_obj, perturbation_start, perturbation_window } = config;
    const exp_start = (config as any).experiment_start ?? 0;
    const t_obj_abs = t_obj + exp_start;  // absolute time: offset by experiment start
    const hi_st = ref * (1 + tol_st);
    const lo_st = ref * (1 - tol_st);
    const hi_os = ref * (1 + tol_os);

    const ann: Record<string, any> = {
      refLine: {
        type: 'line', yMin: ref, yMax: ref,
        borderColor: 'rgba(59,130,246,0.8)', borderWidth: 1.5, borderDash: [4, 4],
        label: { display: true, content: 'REF', position: 'start', color: 'rgba(59,130,246,0.9)', font: { family: 'Courier New', size: 10 } }
      },
      stHi: {
        type: 'line', yMin: hi_st, yMax: hi_st,
        borderColor: 'rgba(59,130,246,0.45)', borderWidth: 1, borderDash: [3, 6],
        label: { display: true, content: `+${(tol_st*100).toFixed(0)}%`, position: 'end', color: 'rgba(59,130,246,0.7)', font: { family: 'Courier New', size: 9 } }
      },
      stLo: {
        type: 'line', yMin: lo_st, yMax: lo_st,
        borderColor: 'rgba(59,130,246,0.45)', borderWidth: 1, borderDash: [3, 6],
        label: { display: true, content: `-${(tol_st*100).toFixed(0)}%`, position: 'end', color: 'rgba(59,130,246,0.7)', font: { family: 'Courier New', size: 9 } }
      },
      osLim: {
        type: 'line', yMin: hi_os, yMax: hi_os,
        borderColor: 'rgba(239,68,68,0.7)', borderWidth: 1.5, borderDash: [6, 3],
        label: { display: true, content: `OS ${(tol_os*100).toFixed(0)}%`, position: 'start', color: 'rgba(239,68,68,0.85)', font: { family: 'Courier New', size: 9 } }
      },
      prohibitedZone: {
        type: 'box',
        yMin: hi_os,
        yMax: config.y_limits ? config.y_limits[1] : hi_os * 1.05,
        backgroundColor: 'rgba(239,68,68,0.07)', borderWidth: 0,
      },
      stDeadline: {
        type: 'line', xMin: t_obj_abs, xMax: t_obj_abs,
        borderColor: 'rgba(234,179,8,0.7)', borderWidth: 1.5, borderDash: [5, 4],
        label: { display: true, content: 'T_st', position: 'start', color: 'rgba(234,179,8,0.9)', font: { family: 'Courier New', size: 9 } }
      },
      pertStart: {
        type: 'line', xMin: perturbation_start, xMax: perturbation_start,
        borderColor: 'rgba(168,85,247,0.7)', borderWidth: 1.5, borderDash: [4, 4],
        label: { display: true, content: 'PERT', position: 'end', color: 'rgba(168,85,247,0.9)', font: { family: 'Courier New', size: 9 } }
      },
      pertZone: {
        type: 'box',
        xMin: perturbation_start,
        xMax: perturbation_start + perturbation_window,
        backgroundColor: 'rgba(168,85,247,0.07)', borderWidth: 0,
      },
    };

    if (result.settling_time_actual !== null) {
      ann['stActual'] = {
        type: 'line', xMin: result.settling_time_actual, xMax: result.settling_time_actual,
        borderColor: 'rgba(34,197,94,0.7)', borderWidth: 1.5, borderDash: [3, 3],
        label: { display: true, content: 'ST', position: 'end', color: 'rgba(34,197,94,0.9)', font: { family: 'Courier New', size: 9 } }
      };
    }
    // ESS pre-perturbation center marker
    ann['essPreMarker'] = {
      type: 'line',
      xMin: result.ESS_pre.center_time, xMax: result.ESS_pre.center_time,
      borderColor: 'rgba(34,197,94,0.45)', borderWidth: 1, borderDash: [2, 5],
      label: { display: true, content: 'ESS-pre', position: 'start', color: 'rgba(34,197,94,0.65)', font: { family: 'Courier New', size: 8 } }
    };
    // ESS post-perturbation center marker (at end of perturbation window)
    const pert_eval_t = config.perturbation_start + config.perturbation_window;
    ann['essPostMarker'] = {
      type: 'line',
      xMin: pert_eval_t, xMax: pert_eval_t,
      borderColor: 'rgba(34,197,94,0.45)', borderWidth: 1, borderDash: [2, 5],
      label: { display: true, content: 'ESS-post', position: 'end', color: 'rgba(34,197,94,0.65)', font: { family: 'Courier New', size: 8 } }
    };
    return ann;
  }

  function buildChart(Chart: any, annotationPlugin: any, zoomPlugin: any) {
    Chart.register(annotationPlugin, zoomPlugin);

    const currentDomain = domain;
    const xLabel = currentDomain === 'discreto' ? 'Muestra (k)' : 'Tiempo (s)';
    const xUnit  = currentDomain === 'discreto' ? '' : 's';

    const time = rows.map(r => r[config.time_col]);
    const vel  = rows.map(r => r[config.control_col]);

    // Seed range inputs
    xMin = time[0].toFixed(3);
    xMax = time[time.length - 1].toFixed(3);
    yMin = config.y_limits ? config.y_limits[0].toFixed(3) : Math.min(...vel).toFixed(3);
    yMax = config.y_limits ? config.y_limits[1].toFixed(3) : Math.max(...vel).toFixed(3);

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: time,
        datasets: [{
          label: config.control_col,
          data: vel,
          borderColor: 'rgba(192,132,252,0.9)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
          fill: false,
        }]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          annotation: { annotations: buildAnnotations() },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(10,10,10,0.85)',
            titleFont: { family: 'Courier New', size: 10 },
            bodyFont: { family: 'Courier New', size: 10 },
            callbacks: {
              title: (items: any[]) => `t = ${Number(items[0].label).toFixed(3)}${xUnit}`,
              label: (item: any) => `${item.dataset.label}: ${item.parsed.y.toFixed(4)}`,
            }
          },
          zoom: {
            pan: {
              enabled: true,
              mode: 'xy',
              onPanComplete: syncRangeInputs,
            },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'xy',
              onZoomComplete: syncRangeInputs,
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: xLabel, font: { family: 'Courier New', size: 10 }, color: '#888' },
            ticks: { font: { family: 'Courier New', size: 9 }, color: '#777', maxTicksLimit: 12 },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            title: { display: true, text: config.control_col, font: { family: 'Courier New', size: 10 }, color: '#888' },
            ticks: { font: { family: 'Courier New', size: 9 }, color: '#777' },
            grid: { color: 'rgba(255,255,255,0.05)' },
            ...(config.y_limits ? { min: config.y_limits[0], max: config.y_limits[1] } : {}),
          }
        }
      }
    });
  }

  // Hot-update annotations when config (perturbation/experiment_start) or result changes
  // without rebuilding the whole chart
  $effect(() => {
    const _ps = config.perturbation_start;
    const _pw = config.perturbation_window;
    const _es = (config as any).experiment_start;
    const _st = result.settling_time_actual;
    if (chart) {
      chart.options.plugins.annotation.annotations = buildAnnotations();
      chart.update('none');
    }
  });

  // Apply zoom lock reactively — directly manipulate the live zoom plugin options
  $effect(() => {
    const _lx = lockX;
    const _ly = lockY;
    if (!chart) return;

    const zp = chart.options.plugins.zoom;

    if (lockX && lockY) {
      zp.zoom.wheel.enabled = false;
      zp.zoom.pinch.enabled = false;
      zp.pan.enabled = false;
    } else if (lockX) {
      zp.zoom.wheel.enabled = true;
      zp.zoom.pinch.enabled = true;
      zp.zoom.mode = 'y';
      zp.pan.enabled = true;
      zp.pan.mode = 'y';
    } else if (lockY) {
      zp.zoom.wheel.enabled = true;
      zp.zoom.pinch.enabled = true;
      zp.zoom.mode = 'x';
      zp.pan.enabled = true;
      zp.pan.mode = 'x';
    } else {
      zp.zoom.wheel.enabled = true;
      zp.zoom.pinch.enabled = true;
      zp.zoom.mode = 'xy';
      zp.pan.enabled = true;
      zp.pan.mode = 'xy';
    }
    chart.update('none');
  });

  function syncRangeInputs() {
    if (!chart) return;
    xMin = chart.scales.x.min.toFixed(3);
    xMax = chart.scales.x.max.toFixed(3);
    yMin = chart.scales.y.min.toFixed(3);
    yMax = chart.scales.y.max.toFixed(3);
  }

  function applyRange() {
    if (!chart) return;
    const xMinV = parseFloat(xMin), xMaxV = parseFloat(xMax);
    const yMinV = parseFloat(yMin), yMaxV = parseFloat(yMax);

    if (!lockX && !isNaN(xMinV) && !isNaN(xMaxV) && xMaxV > xMinV) {
      chart.options.scales.x.min = xMinV;
      chart.options.scales.x.max = xMaxV;
    }
    if (!lockY && !isNaN(yMinV) && !isNaN(yMaxV) && yMaxV > yMinV) {
      chart.options.scales.y.min = yMinV;
      chart.options.scales.y.max = yMaxV;
    }
    chart.update('none');
  }

  function resetZoom() {
    chart?.resetZoom();
    setTimeout(syncRangeInputs, 50);
  }

  async function initChart() {
    const [{ Chart, registerables }, annotationPlugin, zoomPlugin] = await Promise.all([
      import('chart.js'),
      import('chartjs-plugin-annotation').then(m => m.default),
      import('chartjs-plugin-zoom').then(m => m.default),
    ]);
    Chart.register(...registerables);
    buildChart(Chart, annotationPlugin, zoomPlugin);
  }

  function handleOutsideClick(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) menuOpen = false;
  }

  onMount(() => {
    initChart();
    document.addEventListener('click', handleOutsideClick);
  });

  onDestroy(() => {
    chart?.destroy();
    document.removeEventListener('click', handleOutsideClick);
  });

  // Full rebuild only when rows or domain change
  $effect(() => {
    const _r = rows.length;
    const _d = domain;
    if (chart) {
      chart.destroy();
      chart = null;
      xMin = ''; xMax = ''; yMin = ''; yMax = '';
      setTimeout(() => initChart(), 10);
    }
  });
</script>

<div class="chart-wrapper">
  <canvas bind:this={canvas}></canvas>

  <div class="chart-topbar">
    <span class="ctrl-hint">scroll = zoom &nbsp;|&nbsp; drag = pan</span>
    <button class="ctrl-btn" onclick={resetZoom}>RESET</button>

    <div class="menu-anchor" bind:this={menuEl}>
      <button
        class="ctrl-btn menu-trigger"
        onclick={(e) => { e.stopPropagation(); menuOpen = !menuOpen; }}
        title="Controles avanzados"
      >&#8943;</button>

      {#if menuOpen}
        <div class="adv-menu" role="menu">
          <span class="menu-title">CONTROLES AVANZADOS</span>

          <div class="menu-group">
            <span class="menu-group-label">EJE X</span>
            <div class="range-row">
              <label class="range-label" for="x-min">MIN</label>
              <input id="x-min" class="range-input" type="number" step="0.001" bind:value={xMin} disabled={lockX} />
              <label class="range-label" for="x-max">MAX</label>
              <input id="x-max" class="range-input" type="number" step="0.001" bind:value={xMax} disabled={lockX} />
            </div>
            <label class="lock-row">
              <input type="checkbox" bind:checked={lockX} />
              <span>Bloquear zoom/pan X</span>
            </label>
          </div>

          <div class="menu-group">
            <span class="menu-group-label">EJE Y</span>
            <div class="range-row">
              <label class="range-label" for="y-min">MIN</label>
              <input id="y-min" class="range-input" type="number" step="0.001" bind:value={yMin} disabled={lockY} />
              <label class="range-label" for="y-max">MAX</label>
              <input id="y-max" class="range-input" type="number" step="0.001" bind:value={yMax} disabled={lockY} />
            </div>
            <label class="lock-row">
              <input type="checkbox" bind:checked={lockY} />
              <span>Bloquear zoom/pan Y</span>
            </label>
          </div>

          <button class="apply-btn" onclick={applyRange}>APLICAR RANGO</button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .chart-wrapper {
    position: relative;
    width: 100%;
    height: 400px;
  }

  .chart-topbar {
    position: absolute;
    top: 0.35rem;
    right: 0.4rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    z-index: 10;
  }

  .ctrl-hint {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.55rem;
    color: var(--muted-foreground, #555);
    letter-spacing: 0.04em;
  }

  .ctrl-btn {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.62rem;
    letter-spacing: 0.07em;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--border, #444);
    border-radius: 3px;
    background: var(--background, #0d0d0d);
    color: var(--muted-foreground, #888);
    cursor: pointer;
    transition: all 0.15s;
    line-height: 1;
  }

  .ctrl-btn:hover {
    border-color: var(--foreground, #eee);
    color: var(--foreground, #eee);
  }

  .menu-trigger {
    font-size: 1rem;
    padding: 0 0.4rem;
    letter-spacing: 0;
  }

  .menu-anchor { position: relative; }

  .adv-menu {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    width: 260px;
    background: var(--card, #141414);
    border: 1px solid var(--border, #333);
    border-radius: 5px;
    padding: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }

  .menu-title {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    font-weight: 700;
    color: var(--muted-foreground, #666);
  }

  .menu-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .menu-group-label {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--foreground, #ccc);
  }

  .range-row {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    gap: 0.3rem;
    align-items: center;
  }

  .range-label {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.58rem;
    color: var(--muted-foreground, #777);
    letter-spacing: 0.06em;
  }

  .range-input {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.68rem;
    padding: 0.2rem 0.35rem;
    background: var(--background, #0d0d0d);
    border: 1px solid var(--border, #333);
    border-radius: 3px;
    color: var(--foreground, #e5e5e5);
    width: 100%;
    min-width: 0;
  }

  .range-input:disabled { opacity: 0.35; }
  .range-input:focus { outline: none; border-color: var(--foreground, #888); }

  .lock-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.62rem;
    color: var(--muted-foreground, #888);
    cursor: pointer;
  }

  .lock-row input[type="checkbox"] {
    accent-color: var(--foreground, #fff);
    cursor: pointer;
  }

  .apply-btn {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    padding: 0.35rem;
    border: 1px solid var(--border, #444);
    border-radius: 3px;
    background: var(--background, #0d0d0d);
    color: var(--foreground, #eee);
    cursor: pointer;
    transition: all 0.15s;
    width: 100%;
    margin-top: 0.1rem;
  }

  .apply-btn:hover {
    background: var(--foreground, #eee);
    color: var(--background, #0d0d0d);
  }
</style>