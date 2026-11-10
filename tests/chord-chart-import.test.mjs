import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject} from '../src/model.js';
import {parseChordChart,resolveChordShape,importChordChart} from '../src/chord-chart-import.js';

const SHEET = `[Verse 1]
G          D          Em7
Little song about the morning light
G          D          C
Nothing fancy, nothing bright
`;

test('parseChordChart pairs chord lines with the lyric line underneath, skipping section markers', () => {
 const {groups} = parseChordChart(SHEET);
 assert.equal(groups.length, 2);
 assert.deepEqual(groups[0].chords.map(c => c.name), ['G', 'D', 'Em7']);
 assert.equal(groups[0].lyricText, 'Little song about the morning light');
 assert.deepEqual(groups[1].chords.map(c => c.name), ['G', 'D', 'C']);
});

test('a chord line with no following lyric line still forms a group', () => {
 const {groups} = parseChordChart('Intro\nG D\nG D\n');
 assert.equal(groups.length, 2);
 assert.equal(groups[0].lyricText, null);
 assert.equal(groups[1].lyricText, null);
});

test('resolveChordShape resolves common open/barre shapes and transposes by root', () => {
 assert.deepEqual(resolveChordShape('G').frets, [3, 5, 5, 4, 3, 3]);
 assert.deepEqual(resolveChordShape('Em').frets, [0, 2, 2, 0, 0, 0]);
 assert.deepEqual(resolveChordShape('A7').frets, [5, 7, 5, 6, 5, 5]);
 assert.equal(resolveChordShape('Cdim'), null); // recognised chord, no shape yet
 assert.equal(resolveChordShape('not a chord'), null);
});

test('importChordChart adds a new rhythm arrangement with strummed chords placed across the song', () => {
 const project = makeProject();
 project.duration = 20;
 const result = importChordChart(project, SHEET);
 assert.equal(project.arrangements.length, 2);
 assert.equal(result.arrangement, project.arrangements[1]);
 assert.equal(result.arrangement.role, 'rhythm');
 assert.equal(result.groups, 2);
 assert.equal(result.inserted, 6);
 assert.deepEqual(result.unresolved, []);
 assert.ok(result.arrangement.chord_templates.some(t => t.name === 'G'));
 assert.ok(result.arrangement.chords.every(c => c.time >= 0 && c.time <= project.duration));
 // chords are placed in time order, each with notes drawn from its resolved shape
 const times = result.arrangement.chords.map(c => c.time);
 assert.deepEqual(times, [...times].sort((a, b) => a - b));
 assert.ok(result.arrangement.chords.every(c => c.notes.length >= 2));
});

test('unresolved chord suffixes are reported, not silently dropped as if resolved', () => {
 const project = makeProject();
 const result = importChordChart(project, 'G\nverse one\nCdim\nverse two\n');
 assert.deepEqual(result.unresolved, ['Cdim']);
 assert.equal(result.inserted, 1);
});

test('an empty or chord-less chart is refused rather than importing nothing silently', () => {
 const project = makeProject();
 assert.throws(() => importChordChart(project, 'just some lyrics\nwith no chords at all\n'));
});

test('importing into an existing arrangement index reuses it instead of adding a new one', () => {
 const project = makeProject();
 const result = importChordChart(project, 'G\nverse one\n', {arrangementIndex: 0});
 assert.equal(project.arrangements.length, 1);
 assert.equal(result.arrangement, project.arrangements[0]);
});
