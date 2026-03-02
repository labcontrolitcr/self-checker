<script lang="ts">
  import type { AnalysisResult } from '$lib/analysis';
  import type { PlantConfig } from '$lib/config/plants.config';

  interface Props {
    result: AnalysisResult;
    config: PlantConfig;
    domain: 'continuo' | 'discreto';
  }

  let { result, config, domain }: Props = $props();

  function scoreClass(score: number): string {
    if (score >= 90) return 'ok';
    if (score >= 70) return 'warn';
    return 'fail';
  }

  function fmt(n: number, d = 3): string {
    return n.toFixed(d);
  }
</script>

<div class="stats-panel">

  <div class="panel-header">
    <span class="panel-title">RESULTADO DE REVISION</span>
    <span class="domain-tag">{domain.toUpperCase()}</span>
  </div>

  <div class="score-row">
    <span class="score-label">NOTA FINAL</span>
    <span class="score-value {scoreClass(result.final_score)}">{fmt(result.final_score, 1)} / 100</span>
  </div>

  <div class="divider"></div>

  <table class="metrics-table">
    <thead>
      <tr>
        <th>CRITERIO</th>
        <th>DETALLE</th>
        <th>PESO</th>
        <th>NOTA</th>
      </tr>
    </thead>
    <tbody>

      <!-- Settling Time -->
      <tr>
        <td class="crit-name">SETTLING TIME</td>
        <td>
          {#if result.settling_time_actual !== null}
            Ts = {fmt(result.settling_time_actual)}s<br />
          {:else}
            NO CONVERGE<br />
          {/if}
          {fmt(result.ST_prop_ok * 100, 1)}% en banda<br />
          {#if result.rise_time !== null}
            Tr = {fmt(result.rise_time)}s
          {/if}
        </td>
        <td>{config.weights.ST}%</td>
        <td class="{scoreClass(result.ST_score)}">{fmt(result.ST_score, 1)}</td>
      </tr>

      <!-- Overshoot -->
      <tr>
        <td class="crit-name">OVERSHOOT</td>
        <td>
          OS   = {fmt(result.OS_val)}<br />
          Lim  = {fmt(result.OS_lim)}<br />
          Tol  = {fmt(config.tol_os * 100, 1)}%
        </td>
        <td>{config.weights.OS}%</td>
        <td class="{scoreClass(result.OS_score)}">{fmt(result.OS_score, 1)}</td>
      </tr>

      <!-- ESS pre-perturbation -->
      <tr>
        <td class="crit-name">ESS PRE-PERT</td>
        <td>
          t_c  = {fmt(result.ESS_pre.center_time)}s<br />
          mean = {fmt(result.ESS_pre.mean)}<br />
          err  = {fmt(result.ESS_pre.error_pct, 3)}%<br />
          win  = {config.ess_k_win} muestras
        </td>
        <td class="sub-weight">({config.weights.ESS/2}%)</td>
        <td class="{scoreClass(result.ESS_pre_score)}">{fmt(result.ESS_pre_score, 1)}</td>
      </tr>

      <!-- ESS post-perturbation -->
      <tr>
        <td class="crit-name">ESS POST-PERT</td>
        <td>
          t_c  = {fmt(result.ESS_post.center_time)}s<br />
          mean = {fmt(result.ESS_post.mean)}<br />
          err  = {fmt(result.ESS_post.error_pct, 3)}%<br />
          win  = {config.pert_recovery_k_win} muestras
        </td>
        <td class="sub-weight">({config.weights.ESS/2}%)</td>
        <td class="{scoreClass(result.ESS_post_score)}">{fmt(result.ESS_post_score, 1)}</td>
      </tr>

      <!-- ESS combined -->
      <tr class="combined-row">
        <td class="crit-name">ESS COMBINADO</td>
        <td>media(pre, post)</td>
        <td>{config.weights.ESS}%</td>
        <td class="{scoreClass(result.ESS_score)}">{fmt(result.ESS_score, 1)}</td>
      </tr>

      <!-- Perturbation -->
      <tr>
        <td class="crit-name">PERTURBACION</td>
        <td>
          err  = {fmt(result.Pert_err_pct, 3)}%<br />
          t_ev = {fmt(config.perturbation_start + config.perturbation_window)}s<br />
          tol  = 2%
        </td>
        <td>{config.weights.Pert}%</td>
        <td class="{scoreClass(result.Pert_score)}">{fmt(result.Pert_score, 1)}</td>
      </tr>

    </tbody>
  </table>

  <div class="divider"></div>

  <div class="comments">
    <span class="comments-title">OBSERVACIONES</span>
    <pre class="comment-line">> {result.ST_comment}</pre>
    <pre class="comment-line">> {result.OS_comment}</pre>
    <pre class="comment-line">> {result.ESS_pre_comment}</pre>
    <pre class="comment-line">> {result.ESS_post_comment}</pre>
    <pre class="comment-line">> {result.Pert_comment}</pre>
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

  .domain-tag {
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--border, #444);
    border-radius: 3px;
    color: var(--muted-foreground, #888);
  }

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

  .divider {
    height: 1px;
    background: var(--border, #333);
  }

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

  .sub-weight {
    font-size: 0.6rem;
    color: var(--muted-foreground, #666);
    text-align: right;
  }

  .combined-row td {
    background: var(--accent, #1a1a1a);
    font-weight: 600;
  }

  .metrics-table td:last-child {
    text-align: right;
    font-size: 0.85rem;
    font-weight: 700;
  }

  .comments {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

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

  .ok   { color: #4ade80; }
  .warn { color: #facc15; }
  .fail { color: #f87171; }
</style>