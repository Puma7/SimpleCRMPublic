<script lang="ts">
  import { SvelteFlow, Background, Controls } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  let nodes = $state.raw([
    { id: 'trigger', data: { label: 'Trigger (Demo)' }, position: { x: 40, y: 80 } },
    { id: 'action', data: { label: 'Aktion (Demo)' }, position: { x: 280, y: 80 } },
  ]);

  let edges = $state.raw([{ id: 'e1', source: 'trigger', target: 'action' }]);
</script>

<div class="flow-wrap">
  <SvelteFlow bind:nodes bind:edges fitView colorMode="dark">
    <Background />
    <Controls />
  </SvelteFlow>
</div>

<style>
  .flow-wrap {
    height: 420px;
    border: 1px solid #334155;
    border-radius: 8px;
    overflow: hidden;
  }
</style>
