#!/usr/bin/env node

/**
 * Migration script: Nest topics under subjects, remove deprecated fields
 *
 * Changes:
 * 1. Move topics from flat topics[] array to nested primaryTopics[] and secondaryTopics[] under each subject
 * 2. Remove deprecated fields: type, subjectId, order
 * 3. Remove globalTopics[] array completely
 * 4. Remove flat topics[] array
 */

const fs = require('fs');
const path = require('path');

const SUBJECTS_FILE = path.join(__dirname, 'app-data', 'subjects.json');

console.log('=== Subjects.json Migration Script ===\n');

// Read current subjects.json
console.log('Reading subjects.json...');
const data = JSON.parse(fs.readFileSync(SUBJECTS_FILE, 'utf8'));

console.log(`Found ${data.subjects?.length || 0} subjects`);
console.log(`Found ${data.topics?.length || 0} topics (flat array)`);
console.log(`Found ${data.globalTopics?.length || 0} global topics\n`);

// Check if migration is needed
if (!data.topics || data.topics.length === 0) {
  console.log('✓ No flat topics[] array found - already migrated!');
  if (data.globalTopics && data.globalTopics.length > 0) {
    console.log('⚠ Found globalTopics[] array - will be removed');
  } else {
    console.log('✓ All clean - nothing to migrate');
    process.exit(0);
  }
}

// Backup original file
const backupFile = SUBJECTS_FILE + '.backup.' + Date.now();
console.log(`Creating backup: ${path.basename(backupFile)}`);
fs.copyFileSync(SUBJECTS_FILE, backupFile);

// Group topics by subjectId and type
console.log('\nGrouping topics by subject...');
const topicsBySubject = new Map();

data.topics.forEach(topic => {
  const subjectId = topic.subjectId;
  if (!subjectId) {
    console.warn(`⚠ Topic without subjectId, skipping: ${topic.id} (${topic.name})`);
    return;
  }

  if (!topicsBySubject.has(subjectId)) {
    topicsBySubject.set(subjectId, { primary: [], secondary: [] });
  }

  const group = topicsBySubject.get(subjectId);
  const isPrimary = topic.type === 'primary';

  // Clean up topic: remove deprecated fields
  const cleanTopic = { ...topic };
  delete cleanTopic.type;
  delete cleanTopic.subjectId;
  delete cleanTopic.order;

  if (isPrimary) {
    group.primary.push(cleanTopic);
  } else {
    group.secondary.push(cleanTopic);
  }
});

console.log(`Grouped topics into ${topicsBySubject.size} subjects\n`);

// Nest topics under subjects
console.log('Nesting topics under subjects...');
data.subjects.forEach(subject => {
  const topics = topicsBySubject.get(subject.id);
  if (topics) {
    if (topics.primary.length > 0) {
      subject.primaryTopics = topics.primary;
      console.log(`  ${subject.name}: ${topics.primary.length} primary topics`);
    }
    if (topics.secondary.length > 0) {
      subject.secondaryTopics = topics.secondary;
      console.log(`  ${subject.name}: ${topics.secondary.length} secondary topics`);
    }
  }
});

// Remove flat topics array
console.log('\nRemoving flat topics[] array...');
delete data.topics;

// Remove globalTopics array
if (data.globalTopics) {
  console.log(`Removing globalTopics[] array (${data.globalTopics.length} topics)...`);
  delete data.globalTopics;
}

// Write migrated file
console.log('\nWriting migrated subjects.json...');
fs.writeFileSync(SUBJECTS_FILE, JSON.stringify(data, null, 2));

console.log('\n✓ Migration completed successfully!');
console.log(`✓ Backup saved: ${path.basename(backupFile)}`);
console.log('\nSummary:');
console.log(`  - Migrated ${data.subjects.length} subjects`);
let totalPrimary = 0;
let totalSecondary = 0;
data.subjects.forEach(s => {
  totalPrimary += s.primaryTopics?.length || 0;
  totalSecondary += s.secondaryTopics?.length || 0;
});
console.log(`  - ${totalPrimary} primary topics (nested)`);
console.log(`  - ${totalSecondary} secondary topics (nested)`);
console.log(`  - Removed flat topics[] array`);
console.log(`  - Removed globalTopics[] array`);
console.log(`  - Removed deprecated fields: type, subjectId, order`);
