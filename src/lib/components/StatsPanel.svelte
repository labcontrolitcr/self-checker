<script lang="ts">
  import type { AnalysisResult } from '$lib/analysis';
  import type { PlantConfig } from '$lib/config/plants.config';
  import ReportGenerator from '$lib/components/ReportGenerator.svelte';

  interface Props {
    result: AnalysisResult;
    config: PlantConfig & { experiment_start?: number };
    domain: 'continuo' | 'discreto';
    rows: Record<string, number>[];
    csvRaw: string;       // raw CSV text — used for fingerprint hash
    csvFileName: string;  // original filename — shown in PDF config section
  }

  let { result, config, domain, rows, csvRaw, csvFileName }: Props = $props();

  function scoreClass(score: number): string {
    if (score >= 90) return 'ok';
    if (score >= 70) return 'warn';
    return 'fail';
  }

  function fmt(n: number, d = 3): string {
    return n.toFixed(d);
  }

  const unit = 's';  // always seconds
  const r = $derived(result as any);
</script>

<div class="stats-panel">

  <div class="panel-header">
    <span class="panel-title">RESULTADO DE REVISION</span>
    <div class="header-tags">
      {#if r.ma_window}
        <span class="tag muted">MA={r.ma_window}</span>
      {/if}
      <span class="tag">{domain.toUpperCase()}</span>
      <ReportGenerator {result} {config} {domain} {rows} {csvRaw} {csvFileName} />
    </div>
  </div>

  <div class="score-row">
    <span class="score-label">NOTA FINAL</span>
    <span class="score-value {scoreClass(result.final_score)}">{fmt(result.final_score, 1)} / 100</span>
  </div>

  <!-- Score breakdown bars -->
  <div class="breakdown-bars">
    {#each [
      { label: 'ST',   score: result.ST_score,   weight: config.weights.ST },
      { label: 'OS',   score: result.OS_score,   weight: config.weights.OS },
      { label: 'ESS',  score: result.ESS_score,  weight: config.weights.ESS },
      { label: 'PERT', score: result.Pert_score, weight: config.weights.Pert },
    ] as item}
      <div class="bar-row">
        <span class="bar-label">{item.label}</span>
        <div class="bar-track">
          <div class="bar-fill {scoreClass(item.score)}" style:width="{item.score}%"></div>
        </div>
        <span class="bar-score {scoreClass(item.score)}">{fmt(item.score, 1)}</span>
        <span class="bar-weight">{item.weight}%</span>
      </div>
    {/each}
  </div>

  <div class="divider"></div>

  <table class="metrics-table">
    <thead>
      <tr>
        <th>CRITERIO</th>
        <th>DETALLE</th>
        <th>NOTA</th>
      </tr>
    </thead>
    <tbody>

      <!-- Settling Time -->
      <tr>
        <td class="crit-name">SETTLING<br/>TIME</td>
        <td>
          {#if result.settling_time_actual !== null}
            T_st = {fmt(result.settling_time_actual)}{unit} (desde inicio)<br />
          {:else}
            <span class="fail-text">NO CONVERGE</span><br />
          {/if}
          {fmt(result.ST_prop_ok * 100, 1)}% en banda<br />
          {#if result.rise_time !== null}
            T_r = {fmt(result.rise_time)}{unit} (desde inicio)
          {/if}
        </td>
        <td class="{scoreClass(result.ST_score)}">{fmt(result.ST_score, 1)}</td>
      </tr>

      <!-- Overshoot -->
      <tr>
        <td class="crit-name">OVERSHOOT</td>
        <td>
          pico = {fmt(r.OS_val ?? result.OS_val)}<br />
          OS%  = {fmt(Math.max(0, (result.OS_val - config.ref) / config.ref) * 100, 2)}%<br />
          lím  = ±{fmt(config.tol_os * 100, 1)}%
        </td>
        <td class="{scoreClass(result.OS_score)}">{fmt(result.OS_score, 1)}</td>
      </tr>

      <!-- ESS pre -->
      <tr>
        <td class="crit-name">ESS<br/>PRE-PERT</td>
        <td>
          IAE  = {fmt(r.ESS_pre_iae ?? 0, 3)} (norm)<br />
          fuera = {fmt(r.ESS_pre_pct_out ?? 0, 1)}% del tiempo<br />
          mean = {fmt(result.ESS_pre.mean)} · err={fmt(result.ESS_pre.error_pct, 3)}%<br />
          <span class="sub-detail">win={config.ess_k_win} muestras · suavizada · peso {config.weights.ESS/2}%</span>
        </td>
        <td class="{scoreClass(result.ESS_pre_score)}">{fmt(result.ESS_pre_score, 1)}</td>
      </tr>

      <!-- ESS post -->
      <tr>
        <td class="crit-name">ESS<br/>POST-PERT</td>
        <td>
          IAE  = {fmt(r.ESS_post_iae ?? 0, 3)} (norm)<br />
          fuera = {fmt(r.ESS_post_pct_out ?? 0, 1)}% del tiempo<br />
          mean = {fmt(result.ESS_post.mean)} · err={fmt(result.ESS_post.error_pct, 3)}%<br />
          <span class="sub-detail">últimas {config.ess_k_win} muestras · suavizada · peso {config.weights.ESS/2}%</span>
        </td>
        <td class="{scoreClass(result.ESS_post_score)}">{fmt(result.ESS_post_score, 1)}</td>
      </tr>

      <!-- ESS combined -->
      <tr class="combined-row">
        <td class="crit-name">ESS<br/>COMBINADO</td>
        <td>media(pre, post) · peso {config.weights.ESS}%</td>
        <td class="{scoreClass(result.ESS_score)}">{fmt(result.ESS_score, 1)}</td>
      </tr>

      <!-- Perturbation settling -->
      <tr>
        <td class="crit-name">PERT<br/>SETTLING</td>
        <td>
          {#if r.Pert_ST_prop_ok !== undefined}
            {fmt(r.Pert_ST_prop_ok * 100, 1)}% en banda<br />
          {/if}
          ventana [t+{fmt(config.perturbation_window)}, t+{fmt(config.perturbation_window + config.t_win)}]{unit}<br />
          <span class="sub-detail">1/3 del peso · suavizada</span>
        </td>
        <td class="{scoreClass(r.Pert_ST_score ?? 0)}">{fmt(r.Pert_ST_score ?? 0, 1)}</td>
      </tr>

      <!-- Perturbation ESS -->
      <tr>
        <td class="crit-name">PERT<br/>ESS</td>
        <td>
          IAE  = {fmt(r.Pert_ESS_iae ?? 0, 3)} (norm)<br />
          fuera = {fmt(r.Pert_ESS_pct_out ?? 0, 1)}% del tiempo<br />
          <span class="sub-detail">tol={(config as any).pert_recovery_tol !== undefined ? ((config as any).pert_recovery_tol*100).toFixed(1) : "2.0"}% · 1/3 del peso · suavizada</span>
        </td>
        <td class="{scoreClass(r.Pert_ESS_score ?? 0)}">{fmt(r.Pert_ESS_score ?? 0, 1)}</td>
      </tr>

      <!-- Perturbation combined -->
      <tr class="combined-row">
        <td class="crit-name">PERT<br/>COMBINADO</td>
        <td>(detectada + settling + ESS_pert) / 3 · peso {config.weights.Pert}%</td>
        <td class="{scoreClass(result.Pert_score)}">{fmt(result.Pert_score, 1)}</td>
      </tr>


    </tbody>
  </table>

  <div class="divider"></div>

  <div class="comments">
    <span class="comments-title">OBSERVACIONES</span>
    {#if result.exp_start_warning}
      <pre class="comment-line warn-line">> {result.exp_start_warning}</pre>
    {/if}
    {#if result.pert_warning}
      <pre class="comment-line warn-line">> {result.pert_warning}</pre>
    {/if}
    {#if result.ess_step_warning}
      <pre class="comment-line warn-line">> {result.ess_step_warning}</pre>
    {/if}
    <pre class="comment-line">> {result.ST_comment}</pre>
    <pre class="comment-line">> {result.OS_comment}</pre>

    <pre class="comment-line">> {result.ESS_pre_comment}</pre>
    <pre class="comment-line">> {result.ESS_post_comment}</pre>
    <pre class="comment-line">> {result.Pert_comment}</pre>
    {#if r.Pert_ST_comment}
      <pre class="comment-line">> {r.Pert_ST_comment}</pre>
    {/if}
    {#if r.Pert_ESS_comment}
      <pre class="comment-line">> {r.Pert_ESS_comment}</pre>
    {/if}
  </div>

</div>

<style>
  .stats-panel {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.75rem;
    background: var(--card, #111);
    border: 1px solid var(--border, #333);
    border-radius: 6px;
    padding: 1rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    color: var(--foreground, #e5e5e5);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .panel-title {
    font-size: 0.65rem;
    letter-spacing: 0.12em;
    font-weight: 700;
    color: var(--muted-foreground, #888);
  }

  .header-tags { display: flex; gap: 0.4rem; align-items: center; }

  .tag {
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--border, #444);
    border-radius: 3px;
    color: var(--muted-foreground, #888);
  }
  .tag.muted { opacity: 0.6; border-style: dashed; }

  .score-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .score-label {
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    color: var(--muted-foreground, #888);
  }

  .score-value {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  /* ── Breakdown bars ──────────────────────────────────────────── */
  .breakdown-bars {
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
  }

  .bar-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .bar-label {
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    color: var(--muted-foreground, #888);
    width: 2.6rem;
    flex-shrink: 0;
  }

  .bar-track {
    flex: 1;
    height: 4px;
    background: var(--border, #333);
    border-radius: 999px;
    overflow: hidden;
  }

  .bar-fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    transition: width 0.4s ease;
    background: currentColor;
    min-width: 2px;
  }

  .bar-score {
    font-size: 0.65rem;
    font-weight: 700;
    width: 2.8rem;
    text-align: right;
    flex-shrink: 0;
  }

  .bar-weight {
    font-size: 0.58rem;
    color: var(--muted-foreground, #555);
    width: 2rem;
    text-align: right;
    flex-shrink: 0;
  }

  .divider { height: 1px; background: var(--border, #333); }

  /* ── Metrics table ───────────────────────────────────────────── */
  .metrics-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.7rem;
  }

  .metrics-table th {
    text-align: left;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    color: var(--muted-foreground, #666);
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border, #333);
    font-weight: 600;
  }

  .metrics-table td {
    padding: 0.4rem 0.3rem;
    vertical-align: top;
    border-bottom: 1px solid var(--border, #1e1e1e);
    line-height: 1.6;
  }

  .crit-name {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    white-space: nowrap;
    color: var(--muted-foreground, #aaa);
  }

  .combined-row td {
    background: var(--accent, #1a1a1a);
    font-weight: 600;
  }

  .metrics-table td:last-child {
    text-align: right;
    font-size: 0.85rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .fail-text { color: #f87171; }

  .sub-detail {
    font-size: 0.6rem;
    color: var(--muted-foreground, #666);
  }

  .iae-tag {
    font-size: 0.62rem;
    color: var(--muted-foreground, #777);
    display: inline-block;
  }

  /* ── Comments ────────────────────────────────────────────────── */
  .comments { display: flex; flex-direction: column; gap: 0.2rem; }

  .comments-title {
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    color: var(--muted-foreground, #666);
    font-weight: 700;
    margin-bottom: 0.2rem;
  }

  .comment-line {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.65rem;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--muted-foreground, #aaa);
    line-height: 1.6;
  }

  .warn-line { color: #fbbf24; }

  .ok   { color: #4ade80; }
  .warn { color: #facc15; }
  .fail { color: #f87171; }



  /* ── Modal ───────────────────────────────────────────────────────── */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-box {
    font-family: 'Courier New', Courier, monospace;
    background: var(--card, #111);
    border: 1px solid var(--border, #333);
    border-radius: 6px;
    padding: 1.2rem 1.4rem;
    width: min(420px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    box-shadow: 0 16px 48px rgba(0,0,0,0.6);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .modal-title {
    display: block;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--foreground, #e5e5e5);
  }

  .modal-sub {
    display: block;
    font-size: 0.6rem;
    color: var(--muted-foreground, #666);
    margin-top: 0.15rem;
  }

  .modal-close {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.75rem;
    background: none;
    border: none;
    color: var(--muted-foreground, #666);
    cursor: pointer;
    padding: 0.1rem 0.3rem;
    transition: color 0.15s;
    line-height: 1;
  }
  .modal-close:hover { color: var(--foreground, #eee); }

  .modal-fields {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .field-label {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.09em;
    color: var(--muted-foreground, #777);
    margin-bottom: 0.15rem;
    display: block;
  }

  .field-input {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.72rem;
    padding: 0.3rem 0.6rem;
    background: var(--background, #0d0d0d);
    border: 1px solid var(--border, #333);
    border-radius: 4px;
    color: var(--foreground, #e5e5e5);
    width: 100%;
    transition: border-color 0.15s;
  }
  .field-input:focus { outline: none; border-color: var(--foreground, #888); }
  .field-input::placeholder { color: var(--muted-foreground, #444); }

  .field-row { display: flex; align-items: center; gap: 0.5rem; }
  .field-ext { font-size: 0.65rem; color: var(--muted-foreground, #555); white-space: nowrap; }

  .modal-info {
    background: var(--accent, #141414);
    border: 1px solid var(--border, #222);
    border-radius: 4px;
    padding: 0.6rem 0.8rem;
  }

  .info-title {
    display: block;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--muted-foreground, #555);
    margin-bottom: 0.4rem;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 0.2rem 0.5rem;
    font-size: 0.62rem;
  }

  .info-grid span:nth-child(odd) { color: var(--muted-foreground, #555); }
  .info-grid span:nth-child(even) { color: var(--foreground, #ccc); }

  .modal-error {
    font-size: 0.65rem;
    color: #f87171;
    background: rgba(239,68,68,0.08);
    border: 1px solid rgba(239,68,68,0.3);
    border-radius: 3px;
    padding: 0.4rem 0.6rem;
  }

  .modal-actions {
    display: flex;
    gap: 0.6rem;
  }

  .action-btn {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
  }

  .action-btn.cancel {
    background: var(--background, #0d0d0d);
    border: 1px solid var(--border, #333);
    color: var(--muted-foreground, #888);
  }
  .action-btn.cancel:hover:not(:disabled) { border-color: var(--foreground); color: var(--foreground); }

  .action-btn.confirm {
    background: var(--foreground, #e5e5e5);
    border: 1px solid var(--foreground, #e5e5e5);
    color: var(--background, #0d0d0d);
  }
  .action-btn.confirm:hover:not(:disabled) { opacity: 0.85; }
  .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .spinner {
    width: 10px; height: 10px;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    display: inline-block;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

</style>