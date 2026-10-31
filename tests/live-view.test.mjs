import test from 'node:test';
import assert from 'node:assert/strict';
import {stringHeight,cameraTarget,makeCamera,lookahead,DEFAULT_LIVE_OPTIONS,drawLiveView} from '../src/live-view.js';
import {techniqueTags} from '../src/technique-tags.js';

// A minimal 2D-context recorder: enough of the canvas API for drawLiveView to run against,
// capturing every call and path point so technique rendering can be asserted without a browser.
class FakeContext {
 constructor() {
  this.canvas = {}; this.calls = []; this.texts = []; this.dashes = [];
  this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 1; this.font = ''; this.textAlign = ''; this.textBaseline = '';
  this.globalAlpha = 1; this.shadowColor = ''; this.shadowBlur = 0; this.lineCap = '';
 }
 call(name, ...args) {this.calls.push({name, args}); return this;}
 fillRect(...a) {return this.call('fillRect', ...a);}
 beginPath() {return this.call('beginPath');}
 closePath() {return this.call('closePath');}
 moveTo(...a) {return this.call('moveTo', ...a);}
 lineTo(...a) {return this.call('lineTo', ...a);}
 quadraticCurveTo(...a) {return this.call('quadraticCurveTo', ...a);}
 fill() {return this.call('fill');}
 stroke() {return this.call('stroke');}
 save() {return this.call('save');}
 restore() {return this.call('restore');}
 setLineDash(d) {this.dashes.push(d); return this.call('setLineDash', d);}
 fillText(text, x, y) {this.texts.push(String(text)); return this.call('fillText', text, x, y);}
}

function baseView(overrides = {}) {
 const {notes: noteList, ...rest} = overrides;
 return {
  width: 1200, height: 600, time: 1, playing: false, options: {},
  chords: () => [], zones: () => [], anchorAt: () => ({fret: 3, width: 4}), anchors: [],
  templates: {}, beats: [], phraseAt: () => null, sectionAt: () => null,
  stringColor: () => '#4488ff', chordLabel: () => '', techniqueTags, shownFret: f => f,
  ...rest,
  arrangement: {type: 'guitar', stringCount: 6, notes: noteList || [], ...rest.arrangement},
  notes: (t0, t1) => (noteList || []).filter(n => n.time >= t0 && n.time <= t1),
 };
}

function draw(notes, extra = {}) {
 const ctx = new FakeContext();
 drawLiveView(ctx, baseView({notes, ...extra}));
 return ctx;
}

test('strings stack low string on top by default, and the other way when inverted', () => {
 for (const count of [4, 5, 6, 7, 8]) {
  const heights = Array.from({length: count}, (_, s) => stringHeight(s, count));
  assert.ok(heights.every((h, i) => !i || h < heights[i - 1]), `${count} strings: low string highest`);
  assert.ok(stringHeight(0, count, false) < stringHeight(count - 1, count, false), 'inverted: low string at the bottom');
  assert.ok(heights[0] - heights.at(-1) <= 2.11, 'the stack keeps one height whatever the string count');
 }
});

test('the camera centres the fret-hand position and shows more frets for a wider one', () => {
 assert.deepEqual(cameraTarget({fret: 5, width: 4}), {center: 6, span: 7});
 assert.equal(cameraTarget({fret: 1, width: 6}).span, 9);
 assert.deepEqual(cameraTarget(null), {center: 2, span: 7});
});

test('the projection runs the board from near the bottom to near the top, and mirrors for left-handed', () => {
 const project = makeCamera({width: 1200, height: 300, center: 6, span: 7, zFar: 30});
 const near = project(6, 0, 0), far = project(6, 0, 30);
 assert.ok(Math.abs(near.y - 264) < 1 && Math.abs(far.y - 24) < 1, `board from ${near.y} to ${far.y}`);
 assert.ok(project(8, 0, 0).x > near.x, 'higher frets to the right');
 const lefty = makeCamera({width: 1200, height: 300, center: 6, span: 7, zFar: 30, leftHanded: true});
 assert.ok(lefty(8, 0, 0).x < lefty(6, 0, 0).x, 'left-handed: higher frets to the left');
 assert.ok(project(6, 0, 10).scale < near.scale, 'further notes are smaller');
 assert.equal(project(6, 0, -20), null, 'behind the camera is not drawn');
});

test('a faster highway shows less time ahead', () => {
 assert.ok(lookahead(2) < lookahead(1) && lookahead(0.5) > lookahead(1));
 assert.deepEqual(DEFAULT_LIVE_OPTIONS, {lowStringTop: true, leftHanded: false, speed: 1});
});

test('a hammer-on or pull-off draws a connecting arc from the previous note on the string, not just a floating letter', () => {
 const notes = [{id: 'a', time: 1, string: 2, fret: 3, sustain: 0, techniques: {}}, {id: 'b', time: 1.2, string: 2, fret: 5, sustain: 0, techniques: {hammer_on: true}}];
 const ctx = draw(notes);
 assert.ok(ctx.calls.some(c => c.name === 'quadraticCurveTo'), 'an arc is drawn between the two notes');
 assert.ok(ctx.texts.includes('H'), 'the arc carries an H label');
 const pull = draw([{...notes[0]}, {...notes[1], techniques: {pull_off: true}}]);
 assert.ok(pull.texts.includes('P'), 'a pull-off is labelled P on its arc');
 // No previous note on the string at all: nothing to connect, and no crash.
 const lone = draw([{id: 'c', time: 1, string: 0, fret: 5, sustain: 0, techniques: {hammer_on: true}}]);
 assert.ok(!lone.calls.some(c => c.name === 'quadraticCurveTo'));
});

test('hammer-on and pull-off single-letter tags no longer collide with slap and pop, and the floating tag is suppressed since the arc already shows it', () => {
 const pulledOff = {id: 'a', time: 1, string: 0, fret: 5, sustain: 0, techniques: {pull_off: true}};
 const slapped = {id: 'b', time: 1, string: 0, fret: 3, sustain: 0, techniques: {slap: true}};
 const popped = {id: 'c', time: 1, string: 0, fret: 3, sustain: 0, techniques: {pluck: true}};
 assert.deepEqual(techniqueTags(pulledOff), ['P']);
 assert.deepEqual(techniqueTags(slapped), ['SLP']);
 assert.deepEqual(techniqueTags(popped), ['POP']);
 const ctx = draw([pulledOff]);
 assert.ok(!ctx.texts.includes('P'), 'the bare P tag is not drawn a second time next to its own arc');
});

test('a natural or pinch harmonic draws a diamond gem, not the usual square one', () => {
 const square = draw([{id: 'a', time: 1, string: 0, fret: 5, sustain: 0, techniques: {}}]);
 const diamond = draw([{id: 'b', time: 1, string: 0, fret: 5, sustain: 0, techniques: {harmonic: true}}]);
 // The square's first corner is up-and-left of the fret centre; the diamond's first vertex sits
 // directly above it (same x as the gem centre) - a different moveTo x identifies the shape.
 // The board's own fret-number row also draws plain digits, so compare the gem's own path (its
 // last moveTo, since nothing but text follows it) rather than searching all text/calls.
 const lastMoveTo = ctx => ctx.calls.filter(c => c.name === 'moveTo').at(-1)?.args[0];
 assert.notEqual(lastMoveTo(diamond), lastMoveTo(square));
});

test('palm mute keeps the fret number legible with a dashed outline, unlike fret-hand mute\'s blank X gem', () => {
 const palmMuted = draw([{id: 'a', time: 1, string: 0, fret: 5, sustain: 0, techniques: {palm_mute: true}}]);
 const fretHandMuted = draw([{id: 'b', time: 1, string: 0, fret: 5, sustain: 0, techniques: {fret_hand_mute: true}}]);
 assert.ok(fretHandMuted.texts.includes('X'), 'fret-hand mute shows X');
 assert.ok(!palmMuted.texts.includes('X'), 'palm mute does not blank the fret out with X');
 assert.ok(palmMuted.dashes.some(d => d && d.length), 'palm mute draws a dashed outline');
});

test('vibrato draws a wavy overlay and tremolo draws cross-ticks along a sustained note\'s tail', () => {
 const plain = draw([{id: 'a', time: 1, string: 0, fret: 5, sustain: 1, techniques: {}}]);
 const vibrato = draw([{id: 'b', time: 1, string: 0, fret: 5, sustain: 1, techniques: {vibrato: 80}}]);
 const tremolo = draw([{id: 'c', time: 1, string: 0, fret: 5, sustain: 1, techniques: {tremolo: true}}]);
 assert.ok(vibrato.calls.length > plain.calls.length, 'vibrato adds extra drawing beyond the plain sustain tail');
 assert.ok(tremolo.calls.length > plain.calls.length, 'tremolo adds extra drawing beyond the plain sustain tail');
});

test('a sustained bend shows a direction and fraction label near the gem', () => {
 const ctx = draw([{id: 'a', time: 1, string: 0, fret: 5, sustain: 1, techniques: {bend: 2}}]);
 assert.ok(ctx.texts.some(t => t.startsWith('↑')), 'a bend arrow/fraction label is drawn');
});

test('an ignored (authoring-only, not scored) note is rendered with a dashed outline rather than looking like a normal playable note', () => {
 const ignored = draw([{id: 'b', time: 1, string: 0, fret: 5, sustain: 0, techniques: {ignore: true}}]);
 assert.ok(ignored.dashes.some(d => d && d.length), 'ignored notes get a dashed outline');
 assert.ok(ignored.texts.includes('5'), 'the ignored note still shows its fret, since it remains visible to play');
});
