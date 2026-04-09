/**
 * Subject Store
 * Manages subjects and topics data stored in app-data/subjects.json
 */

import { get, writable } from 'svelte/store';
import type { SubjectsData } from '../shared/subjects-data';
import type { Subject } from '../interfaces/Subject';
import type { Topic } from '../interfaces/Topic';
import { PATHS } from '../shared/data-paths';

// Svelte store for subjects data
export const subjectsStore = writable<SubjectsData>({ subjects: [] });

// Reference to plugin instance (for data loading/saving)
let plugin: any = null;

export function initSubjectStore(pluginInstance: any): void {
  plugin = pluginInstance;
}

// Subjects and Topics data persistence
// Uses adapter pattern (stores in app-data/subjects.json)
export async function loadSubjects(): Promise<void> {
  if (!plugin) return;

  try {
    const data = await plugin.adapter.read(PATHS.SUBJECTS);
    const subjectsData = JSON.parse(data) || { subjects: [] };
    subjectsStore.set(subjectsData);
    console.log('[Subjects] Loaded subjects:', subjectsData.subjects?.length || 0);
  } catch (error) {
    // File doesn't exist yet or parse error - use empty data
    console.log('[Subjects] No subjects file found, starting with empty data');
    subjectsStore.set({ subjects: [] });
  }
}

export async function saveSubjects(): Promise<void> {
  if (!plugin) {
    console.error('[Subjects] Plugin not initialized');
    return;
  }

  const currentSubjects = get(subjectsStore);

  // Count topics for logging
  let totalTopics = 0;
  currentSubjects.subjects.forEach(s => {
    totalTopics += (s.primaryTopics?.length || 0) + (s.secondaryTopics?.length || 0);
  });

  console.log('[Subjects] Saving subjects:', {
    subjects: currentSubjects.subjects.length,
    topics: totalTopics
  });

  await plugin.adapter.write(PATHS.SUBJECTS, JSON.stringify(currentSubjects, null, 2));
}

// Subjects functions
export function addSubject(name: string): string {
  const newId = `subject-${Date.now()}`;
  subjectsStore.update((data) => {
    data.subjects.push({
      id: newId,
      name: name.trim(),
      enabled: true
    });
    return data;
  });
  saveSubjects();
  return newId;
}

export function removeSubject(subjectId: string): void {
  subjectsStore.update((data) => {
    data.subjects = data.subjects.filter((s: Subject) => s.id !== subjectId);
    // Topics are nested under subjects, so they're automatically removed
    return data;
  });
  saveSubjects();
}

export function updateSubject(subjectId: string, updates: Partial<Subject>): void {
  subjectsStore.update((data) => {
    const subject = data.subjects.find((s: Subject) => s.id === subjectId);
    if (subject) {
      Object.assign(subject, updates);
    }
    return data;
  });
  saveSubjects();
}

// Topics functions - work with nested arrays
export function addTopic(subjectId: string, topic: Topic, isPrimary: boolean): void {
  subjectsStore.update((data) => {
    const subject = data.subjects.find((s: Subject) => s.id === subjectId);
    if (subject) {
      if (isPrimary) {
        if (!subject.primaryTopics) subject.primaryTopics = [];
        subject.primaryTopics.push(topic);
      } else {
        if (!subject.secondaryTopics) subject.secondaryTopics = [];
        subject.secondaryTopics.push(topic);
      }
    }
    return data;
  });
  saveSubjects();
}

export function removeTopic(topicId: string): void {
  subjectsStore.update((data) => {
    // Find and remove topic from whichever subject contains it
    for (const subject of data.subjects) {
      if (subject.primaryTopics) {
        const index = subject.primaryTopics.findIndex(t => t.id === topicId);
        if (index >= 0) {
          subject.primaryTopics.splice(index, 1);
          if (subject.primaryTopics.length === 0) delete subject.primaryTopics;
          return data;
        }
      }
      if (subject.secondaryTopics) {
        const index = subject.secondaryTopics.findIndex(t => t.id === topicId);
        if (index >= 0) {
          subject.secondaryTopics.splice(index, 1);
          if (subject.secondaryTopics.length === 0) delete subject.secondaryTopics;
          return data;
        }
      }
    }
    return data;
  });
  saveSubjects();
}

export function updateTopic(topicId: string, updates: Partial<Topic>): void {
  subjectsStore.update((data) => {
    // Find topic in any subject and update it
    for (const subject of data.subjects) {
      if (subject.primaryTopics) {
        const topic = subject.primaryTopics.find(t => t.id === topicId);
        if (topic) {
          Object.assign(topic, updates);
          return data;
        }
      }
      if (subject.secondaryTopics) {
        const topic = subject.secondaryTopics.find(t => t.id === topicId);
        if (topic) {
          Object.assign(topic, updates);
          return data;
        }
      }
    }
    return data;
  });
  saveSubjects();
}

export function addPrimaryTopic(subjectId: string): void {
  const newTopic: Topic = {
    id: `topic-${Date.now()}`,
    name: '',
    icon: '📌',
    topicTag: '',
    topicKeyword: '',
    topicText: ''
  };
  addTopic(subjectId, newTopic, true);
}

export function addSecondaryTopic(subjectId: string): void {
  const newTopic: Topic = {
    id: `topic-${Date.now()}`,
    name: '',
    icon: '🔗',
    topicTag: '',
    topicKeyword: ''
  };
  addTopic(subjectId, newTopic, false);
}
