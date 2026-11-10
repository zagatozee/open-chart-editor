/** Import a plain chord-over-lyrics chart (the common "Ultimate Guitar"-style
 * sheet: chord names on their own line, the sung lyric line underneath) as a
 * draft chord-rhythm arrangement, in the spirit of Rocksmith+'s Hum-n-Strum
 * charts: chord shapes strummed on the timeline, not note-for-note tab.
 *
 * The source text carries no tempo, duration or strum pattern - only chord
 * names and their rough position relative to the lyric lines. This is
 * explicitly a close-but-not-exact placement: each chord is spread across
 * the song's existing duration/beat grid in proportion to where its lyric
 * line falls in the pasted text, then strummed with a plain quarter-note
 * down-strum. The result is a starting draft; moving strums onto the right
 * beat and picking real strum patterns is expected follow-up editing.
 */
import {beatAt,assertGrid,makeArrangement} from './model.js';
import {insertChordZone} from './chord-tools.js';

const ROOT_SEMITONE = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
// Suffixes recognised as chords at all (used to tell a chord line from lyrics).
// Keys not present in CHORD_SHAPES are still valid chord names - just without a
// resolvable guitar shape yet - and are reported back as unresolved.
const CHORD_SHAPES = {
  '':[0,2,2,1,0,0], 'maj':[0,2,2,1,0,0],
  'm':[0,2,2,0,0,0], 'min':[0,2,2,0,0,0], '-':[0,2,2,0,0,0],
  '7':[0,2,0,1,0,0],
  'maj7':[0,2,1,1,0,0], 'M7':[0,2,1,1,0,0],
  'm7':[0,2,0,0,0,0], 'min7':[0,2,0,0,0,0],
  'sus4':[0,2,2,2,0,0],
  '5':[0,2,-1,-1,-1,-1],
};
const UNRESOLVED_SUFFIXES = ['dim','dim7','aug','sus2','add9','add11','6','m6','9','m9','maj9','m7b5','11','13'];
const SUFFIX_PATTERN = [...Object.keys(CHORD_SHAPES),...UNRESOLVED_SUFFIXES].sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
const CHORD_LINE_TOKEN = new RegExp(`^([A-G])([#b]?)(${SUFFIX_PATTERN.join('|')})(/[A-G][#b]?)?$`);

// Fret on the low E string for an E-shape barre rooted at this pitch class
// (E itself sits open, at fret 0).
function barreFret(root, accidental) {
  const value = ROOT_SEMITONE[root] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) - ROOT_SEMITONE.E;
  return ((value % 12) + 12) % 12;
}

/** Parse one token as a chord, or return null (used to classify whole lines). */
function parseChordToken(token) {
  const match = CHORD_LINE_TOKEN.exec(token.trim());
  if (!match) return null;
  const [, root, accidental, suffix] = match;
  return {root, accidental, suffix, name: root + accidental + suffix};
}

function isChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every(token => parseChordToken(token));
}

/** Group an ordered chord chart into {chords, lyricText} entries, in document
 * order. A chord line immediately followed by a plain text line pairs with
 * it; a chord line with no following lyric line (intro/outro, back-to-back
 * chord lines) gets lyricText:null, which just means it has no text to
 * position by and falls back to even spacing against its neighbours.
 */
export function parseChordChart(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const groups = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isChordLine(line)) continue;
    const chords = line.trim().split(/\s+/).filter(Boolean).map(parseChordToken);
    let lyricText = null;
    const next = lines[i + 1];
    if (next !== undefined) {
      const trimmed = next.trim();
      if (trimmed && !/^\[.*\]$/.test(trimmed) && !isChordLine(next)) { lyricText = trimmed; i++; }
    }
    groups.push({chords, lyricText});
  }
  return {groups};
}

/** A guitar shape for a chord name, or null if this suffix isn't resolved yet
 * (still a recognised chord - just needs a shape added by hand after import).
 */
export function resolveChordShape(name) {
  const match = CHORD_LINE_TOKEN.exec(name);
  if (!match) return null;
  const [, root, accidental, suffix] = match;
  const shape = CHORD_SHAPES[suffix];
  if (!shape) return null;
  const fret = barreFret(root, accidental);
  const frets = shape.map(offset => offset < 0 ? -1 : offset + fret);
  return {name, frets, fingers: frets.map(() => -1)};
}

function findOrAddTemplate(arrangement, template) {
  const existing = arrangement.chord_templates.findIndex(t => t.name === template.name);
  if (existing >= 0) return existing;
  arrangement.chord_templates.push({...template, displayName: template.name});
  return arrangement.chord_templates.length - 1;
}

const MIN_ZONE_BEATS = 0.25;

/** Mutates `project`: adds (or reuses) a rhythm arrangement and fills it with
 * a best-effort chord-strum draft from the pasted chord chart text.
 * Returns {arrangement, groups, inserted, unresolved} - `unresolved` lists
 * distinct chord names that were recognised but have no shape yet.
 */
export function importChordChart(project, text, {arrangementIndex = null} = {}) {
  assertGrid(project.beats);
  const {groups} = parseChordChart(text);
  if (!groups.length) throw Error('No chord lines were found. Chords need their own line, e.g. "G D Em7" above the lyric line.');

  const arrangement = Number.isInteger(arrangementIndex) ? project.arrangements[arrangementIndex] : makeArrangement('guitar', 6, {instrument: 'Chords'});
  if (!arrangement) throw Error('Choose an existing arrangement to import into');
  if (!Number.isInteger(arrangementIndex)) { arrangement.name = 'Chords (imported)'; arrangement.role = 'rhythm'; project.arrangements.push(arrangement); }

  const lyricChars = groups.map(g => g.lyricText ? g.lyricText.length : 0);
  const totalChars = lyricChars.reduce((a, b) => a + b, 0);
  const vocals = project.vocals || [];
  const rangeStart = vocals.length ? vocals[0].time : 0;
  const rangeEnd = vocals.length ? vocals.at(-1).time + (vocals.at(-1).length || 0) : project.duration;
  let offset = 0;
  const starts = groups.map((group, i) => {
    const fraction = totalChars > 0 ? offset / totalChars : i / groups.length;
    offset += lyricChars[i];
    return rangeStart + fraction * Math.max(0, rangeEnd - rangeStart);
  });
  starts.push(Math.max(rangeEnd, starts.at(-1) ?? rangeStart));

  const inserted = [], unresolved = new Set();
  for (let i = 0; i < groups.length; i++) {
    const {chords} = groups[i], groupStart = starts[i], groupEnd = Math.max(groupStart + MIN_ZONE_BEATS, starts[i + 1]);
    const span = (groupEnd - groupStart) / chords.length;
    for (let j = 0; j < chords.length; j++) {
      const chord = chords[j], time = groupStart + j * span, end = Math.min(project.duration, time + span);
      const template = resolveChordShape(chord.name);
      if (!template) { unresolved.add(chord.name); continue; }
      const lengthBeats = Math.max(MIN_ZONE_BEATS, beatAt(project.beats, end) - beatAt(project.beats, time));
      const index = findOrAddTemplate(arrangement, template);
      try {
        const result = insertChordZone(arrangement, project.beats, index, time, {lengthBeats, sustainBeats: Math.min(1, lengthBeats)});
        inserted.push(result);
      } catch { /* overlapping/duplicate placement at this rough time - skip rather than fail the whole import */ }
    }
  }
  return {arrangement, groups: groups.length, inserted: inserted.length, unresolved: [...unresolved]};
}
