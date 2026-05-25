<script lang="ts">
  import WorkflowLab from './WorkflowLab.svelte';
</script>

<main class="lab">
  <header>
    <h1>Svelte Lab (Beta)</h1>
    <p>
      Läuft unabhängig von der React-App. Gleiche Engine-Familie wie der Workflow-Editor:
      <code>@xyflow/svelte</code> (Svelte Flow) ↔ <code>@xyflow/react</code> v12.
    </p>
  </header>
  <WorkflowLab />
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
  }
  .lab {
    padding: 1rem 1.25rem 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  header h1 {
    margin: 0 0 0.35rem;
    font-size: 1.25rem;
  }
  header p {
    margin: 0 0 1rem;
    font-size: 0.875rem;
    color: #94a3b8;
    line-height: 1.45;
  }
  code {
    font-size: 0.8em;
    background: #1e293b;
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
</style>
