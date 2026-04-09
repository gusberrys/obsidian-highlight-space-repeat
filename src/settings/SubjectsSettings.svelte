<script lang="ts">
  import type { Writable } from 'svelte/store';
  import type { PluginSettings } from 'src/stores/settings-store';
  import { subjectsStore, addSubject, removeSubject, saveSubjects } from 'src/stores/subject-store';
  import { SubjectModal } from './SubjectModal';
  import type { HighlightSpaceRepeatPlugin } from 'src/highlight-space-repeat-plugin';
  import type { Subject } from 'src/interfaces/Subject';

  export let settingsStore: Writable<PluginSettings>;
  export let plugin: HighlightSpaceRepeatPlugin;

  let subjects: Subject[] = [];

  // Update from store reactively
  $: if ($subjectsStore) {
    subjects = $subjectsStore.subjects || [];
  }

  function handleAddSubject() {
    const newName = 'New Subject';
    addSubject(newName);
  }

  function handleRemoveSubject(subjectId: string) {
    if (confirm('Are you sure you want to delete this subject? This will also delete all its topics.')) {
      removeSubject(subjectId);
    }
  }

  function handleEditSubject(subject: Subject) {
    new SubjectModal(plugin.app, plugin, subject, async (updatedSubject) => {
      // Update subject in store
      const index = $subjectsStore.subjects.findIndex(s => s.id === updatedSubject.id);
      if (index >= 0) {
        $subjectsStore.subjects[index] = updatedSubject;
        await saveSubjects();
      }
    }).open();
  }
</script>

<div class="subjects-settings">
  <h2>Subjects & Matrix</h2>

  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Add new subject</div>
      <div class="setting-item-description">Create a new subject with topics for matrix visualization</div>
    </div>
    <div class="setting-item-control">
      <button class="mod-cta" on:click={handleAddSubject}>Add Subject</button>
    </div>
  </div>

  <div class="subjects-list">
    {#if subjects.length === 0}
      <div class="empty-state">
        <p>No subjects configured yet. Add your first subject to get started.</p>
      </div>
    {:else}
      <table class="subjects-table">
        <thead>
          <tr>
            <th>Icon</th>
            <th>Name</th>
            <th>Tag</th>
            <th>Keyword</th>
            <th>Primary Topics</th>
            <th>Secondary Topics</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each subjects as subject}
            <tr>
              <td class="icon-cell">{subject.icon || '📊'}</td>
              <td class="name-cell">{subject.name}</td>
              <td class="tag-cell">{subject.mainTag || '-'}</td>
              <td class="keyword-cell">{subject.keyword || '-'}</td>
              <td class="count-cell">{subject.primaryTopics?.length || 0}</td>
              <td class="count-cell">{subject.secondaryTopics?.length || 0}</td>
              <td class="actions-cell">
                <button class="mod-cta small-btn" on:click={() => handleEditSubject(subject)}>Edit</button>
                <button class="mod-warning small-btn" on:click={() => handleRemoveSubject(subject.id)}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <div class="info-panel">
    <p><strong>About Subjects & Matrix:</strong></p>
    <p>Subjects organize your knowledge into matrix views with primary and secondary topics. Each cell shows filtered records based on topic combinations.</p>
    <p>Use the matrix view (open via command or ribbon icon) to visualize and navigate your knowledge base.</p>
  </div>
</div>

<style>
  .subjects-settings {
    padding: 1rem;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .setting-item-info {
    flex: 1;
  }

  .setting-item-name {
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .setting-item-description {
    font-size: 0.9em;
    color: var(--text-muted);
  }

  .setting-item-control {
    flex-shrink: 0;
  }

  .subjects-list {
    margin-top: 1rem;
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted);
    background-color: var(--background-secondary);
    border-radius: 4px;
  }

  .subjects-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
  }

  .subjects-table th,
  .subjects-table td {
    padding: 0.75rem;
    border: 1px solid var(--background-modifier-border);
    text-align: left;
  }

  .subjects-table th {
    background-color: var(--background-secondary);
    font-weight: 600;
    font-size: 0.85em;
  }

  .icon-cell {
    font-size: 1.2em;
    text-align: center;
    width: 50px;
  }

  .name-cell {
    font-weight: 500;
  }

  .tag-cell, .keyword-cell {
    font-family: monospace;
    font-size: 0.9em;
  }

  .count-cell {
    text-align: center;
    color: var(--text-muted);
    width: 80px;
  }

  .actions-cell {
    text-align: right;
    white-space: nowrap;
    width: 150px;
  }

  .info-panel {
    margin-top: 1.5rem;
    padding: 1rem;
    background-color: var(--background-secondary);
    border-radius: 4px;
    font-size: 0.9em;
  }

  .info-panel p {
    margin: 0.5rem 0;
  }

  button {
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--interactive-normal);
    color: var(--text-normal);
    cursor: pointer;
    font-size: 0.9em;
  }

  button:hover {
    background: var(--interactive-hover);
  }

  button.mod-cta {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  button.mod-warning {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  button.mod-warning:hover {
    opacity: 0.9;
  }

  button.small-btn {
    padding: 0.3rem 0.6rem;
    font-size: 0.85em;
    margin-left: 0.5rem;
  }
</style>
