<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let label: string;
  export let state = false;
  export let tooltip: string | undefined = undefined;

  const dispatch = createEventDispatcher();
</script>

<input type="checkbox" bind:checked={state} title={tooltip || label} on:change={() => dispatch('clicked', { state })} />

<style>
  input[type='checkbox'] {
    margin-inline-end: 0;
  }
</style>
