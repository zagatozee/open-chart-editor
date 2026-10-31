// Live view: a Rocksmith-style highway of the current part, drawn on a 2D canvas with a simple
// perspective camera. Notes come toward the player on their strings; the fret-hand position
// (anchor) is lit on the board and the camera follows it.
//
// The geometry follows Charter's 3D preview (https://github.com/Lordszynencja/Charter,
// Preview3DUtils and Preview3DCameraHandler; BSD 3-Clause, Copyright (c) 2025, Lordszynencja):
// equal fret lanes one unit wide, strings stacked above the board at a fixed spacing (low string
// on top unless inverted), time running into the screen, a left-handed mirror, and a camera that
// eases toward the fret-hand position and widens with its span. The drawing is this editor's own.

const FRET_WIDTH = 1, STRING_BASE = 0.35, NOTE_HALF = 0.38, GEM_HALF_H = 0.16, TAIL_HALF = 0.11;
const PAST_SECONDS = 0.25, TILT = 0.36, CAMERA_HEIGHT = 4.4, CAMERA_BACK = -6.8;

export const DEFAULT_LIVE_OPTIONS = Object.freeze({lowStringTop: true, leftHanded: false, speed: 1});

/** Seconds of chart shown ahead of the playhead at a highway speed (1 = default). */
export const lookahead = speed => 3.2 / Math.max(0.4, Math.min(2.5, speed || 1));

/** World height of string `s` (0 = lowest) on a part with `count` strings. */
export function stringHeight(s, count, lowStringTop = true) {
 const spacing = Math.min(0.42, 2.1 / Math.max(1, count - 1)), row = lowStringTop ? count - 1 - s : s;
 return STRING_BASE + row * spacing;
}

/** Where the camera looks: the middle of the fret-hand position, and how many frets to show. */
export function cameraTarget(anchor) {
 const fret = Math.max(1, anchor?.fret || 1), width = Math.max(1, anchor?.width || 4);
 return {center: fret - 1 + width / 2, span: Math.max(5, width + 3)};
}

/**
 * A perspective camera fitted to a canvas `width` x `height`: the board runs from 88% of the height
 * at the playhead to 8% at `zFar`, and frets keep their shape (wide panels show more around them
 * rather than stretching). Returns project(x, y, z) -> {x, y, scale} or null behind the camera.
 */
export function makeCamera({width, height, center, span, leftHanded = false, zFar = 30}) {
 const cos = Math.cos(TILT), sin = Math.sin(TILT), mirror = leftHanded ? -1 : 1;
 const depth = (y, z) => -(y - CAMERA_HEIGHT) * sin + (z - CAMERA_BACK) * cos;
 const rise = (y, z) => (y - CAMERA_HEIGHT) * cos + (z - CAMERA_BACK) * sin;
 const nearRatio = rise(0, 0) / depth(0, 0), farRatio = rise(0, zFar) / depth(0, zFar);
 const fy = height * 0.8 / (farRatio - nearRatio), horizon = height * 0.88 + fy * nearRatio;
 const fx = Math.min(fy * 1.3, width * 0.46 * depth(0, 0) / (span / 2));
 return (x, y, z) => {
  const zc = depth(y, z);
  if (zc < 0.2) return null;
  return {x: width / 2 + fx * mirror * (x - center) / zc, y: horizon - fy * rise(y, z) / zc, scale: fy / zc};
 };
}

const camera = new WeakMap();
const stringNoteCache = new WeakMap();

/** Notes on one string, time-sorted, cached per arrangement object (edits produce a new array). */
function sortedStringNotes(a) {
 let cached = stringNoteCache.get(a);
 if (!cached) {
  cached = new Map();
  for (const n of a.notes || []) {
   if (!Number.isFinite(n.time) || !Number.isInteger(n.string)) continue;
   if (!cached.has(n.string)) cached.set(n.string, []);
   cached.get(n.string).push(n);
  }
  for (const list of cached.values()) list.sort((p, q) => p.time - q.time);
  stringNoteCache.set(a, cached);
 }
 return cached;
}

/** The note immediately before `note` on the same string; the hammer-on/pull-off source. */
function previousOnString(a, note) {
 const list = sortedStringNotes(a).get(note.string);
 if (!list) return null;
 let lo = 0, hi = list.length;
 while (lo < hi) {const mid = (lo + hi) >>> 1; if (list[mid].time < note.time) lo = mid + 1; else hi = mid;}
 return lo > 0 ? list[lo - 1] : null;
}

/** A zig-zag through already-projected screen points, offset perpendicular to each segment. */
function wavyLine(ctx, points, amp, color, width) {
 if (points.length < 2) return;
 ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
 for (let i = 1; i < points.length; i++) {
  const p0 = points[i - 1], p1 = points[i], dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len, a = (i % 2 ? 1 : -1) * amp;
  ctx.lineTo((p0.x + p1.x) / 2 + nx * a, (p0.y + p1.y) / 2 + ny * a); ctx.lineTo(p1.x, p1.y);
 }
 ctx.stroke();
}

/** Bend amount in semitones as a standard tab fraction of a whole-step ("Full") bend. */
function bendFraction(semitones) {
 const steps = Math.max(0, semitones) / 2, whole = Math.floor(steps + 1e-6), frac = steps - whole;
 const fractionGlyph = frac >= 0.7 ? '¾' : frac >= 0.37 ? '½' : frac >= 0.12 ? '¼' : '';
 return (whole ? String(whole) : '') + fractionGlyph || '¼';
}

/**
 * Draw the highway. `view`: {width, height, arrangement, time, playing, options, notes(t0,t1),
 * chords(t0,t1), zones(t0,t1), anchorAt(t), templates, beats, phraseAt(t), sectionAt(t),
 * stringColor(s), chordLabel(template, members), techniqueTags(note), shownFret(f)}.
 */
export function drawLiveView(ctx, view) {
 const {width, height, arrangement: a, time} = view, options = {...DEFAULT_LIVE_OPTIONS, ...view.options};
 ctx.fillStyle = '#0f1116'; ctx.fillRect(0, 0, width, height);
 if (!['guitar', 'bass'].includes(a?.type)) {
  ctx.fillStyle = '#9aa3b5'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('The live view shows guitar and bass parts.', width / 2, height / 2); ctx.textAlign = 'left'; return;
 }
 const count = a.stringCount || 6, window = lookahead(options.speed), zPerSecond = 30 / window;
 // Camera eases toward the fret-hand position a moment ahead; it jumps when paused or seeking.
 const target = cameraTarget(view.anchorAt(time + 0.4) || view.anchorAt(time)), state = camera.get(ctx.canvas) || {...target, at: 0};
 const now = performance.now(), dt = Math.min(0.25, (now - state.at) / 1000), ease = view.playing && state.at ? Math.min(1, dt * 2.5) : 1;
 state.center += (target.center - state.center) * ease; state.span += (target.span - state.span) * ease; state.at = now; camera.set(ctx.canvas, state);
 const zFar = window * zPerSecond, project = makeCamera({width, height, center: state.center, span: state.span, leftHanded: options.leftHanded, zFar});
 const zOf = t => (t - time) * zPerSecond, y = s => stringHeight(s, count, options.lowStringTop);
 const firstFret = Math.max(0, Math.floor(state.center - state.span / 2 - 2)), lastFret = Math.min(24, Math.ceil(state.center + state.span / 2 + 2));
 const poly = (points, fill, stroke, lineWidth = 1) => {
  const p = points.map(([x, yy, z]) => project(x, yy, z));
  if (p.some(q => !q)) return false;
  ctx.beginPath(); p.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
  if (fill) {ctx.fillStyle = fill; ctx.fill();}
  if (stroke) {ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke();}
  return true;
 };
 const line = (a1, a2, stroke, lineWidth = 1) => {const p = project(...a1), q = project(...a2); if (!p || !q) return; ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();};
 const xLeft = firstFret * FRET_WIDTH, xRight = lastFret * FRET_WIDTH, zNearEdge = -Math.min(1.2, PAST_SECONDS * zPerSecond);
 // Board, with alternate lanes, the lit fret-hand position and the beat lines.
 poly([[xLeft, 0, zNearEdge], [xRight, 0, zNearEdge], [xRight, 0, zFar], [xLeft, 0, zFar]], '#181b23');
 for (let f = firstFret; f < lastFret; f++) if (f % 2) poly([[f, 0, zNearEdge], [f + 1, 0, zNearEdge], [f + 1, 0, zFar], [f, 0, zFar]], '#1c2029');
 for (const segment of anchorSegments(view, time - PAST_SECONDS, time + window)) {
  const z0 = Math.max(zNearEdge, zOf(segment.start)), z1 = Math.min(zFar, zOf(segment.end)), x0 = segment.fret - 1, x1 = x0 + segment.width;
  poly([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], 'rgba(70,140,230,0.22)', 'rgba(110,175,255,0.45)');
 }
 for (const beat of view.beats) {
  if (beat.time < time - PAST_SECONDS || beat.time > time + window) continue;
  const z = zOf(beat.time);
  line([xLeft, 0, z], [xRight, 0, z], beat.measure >= 0 ? 'rgba(200,210,230,0.45)' : 'rgba(150,160,180,0.16)', beat.measure >= 0 ? 1.5 : 1);
 }
 for (let f = firstFret; f <= lastFret; f++) line([f, 0, zNearEdge], [f, 0, zFar], f === 0 ? '#6c7484' : '#353b48', f === 0 ? 2 : 1);
 // Hand shapes as frames on the board (arpeggios dashed); chords carry their own names.
 for (const shape of view.zones(time - PAST_SECONDS, time + window)) {
  const template = view.templates[shape.chord_id]; if (!template) continue;
  const frets = (template.frets || []).filter(f => f > 0), lo = frets.length ? Math.min(...frets) - 1 : 0, hi = frets.length ? Math.max(...frets) : 3;
  const z0 = Math.max(zNearEdge, zOf(shape.start_time)), z1 = Math.min(zFar, zOf(shape.end_time));
  ctx.setLineDash(String(template.displayName || '').endsWith('-arp') ? [5, 4] : []);
  poly([[lo, 0.02, z0], [hi, 0.02, z0], [hi, 0.02, z1], [lo, 0.02, z1]], null, 'rgba(190,160,255,0.55)', 1.5);
  ctx.setLineDash([]);
 }
 // Strings at the playhead, and fret numbers under it (the fret-hand position's numbers lit).
 const anchorNow = view.anchorAt(time);
 for (let s = 0; s < count; s++) line([xLeft, y(s), 0], [xRight, y(s), 0], view.stringColor(s), 2.5);
 ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
 for (let f = Math.max(1, firstFret + 1); f <= lastFret; f++) {
  const p = project(f - 0.5, 0, 0); if (!p) continue;
  const lit = anchorNow && f >= anchorNow.fret && f < anchorNow.fret + (anchorNow.width || 4);
  ctx.fillStyle = lit ? '#9fd0ff' : '#6d7586'; ctx.fillText(String(view.shownFret(f)), p.x, p.y + 4);
 }
 // Notes and chords, far to near.
 const items = [];
 for (const note of view.notes(time - PAST_SECONDS, time + window)) items.push({time: note.time, note});
 for (const chord of view.chords(time - PAST_SECONDS, time + window)) items.push({time: chord.time, chord});
 items.sort((p, q) => q.time - p.time);
 for (const item of items) item.chord ? drawChord(item.chord) : drawNote(item.note, false);
 // Where you are: phrase and section.
 ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#c9d2e3';
 const phrase = view.phraseAt(time), section = view.sectionAt(time);
 ctx.fillText([section, phrase].filter(Boolean).join(' · '), 10, 8);
 ctx.textBaseline = 'alphabetic';

 // The fret-hand position for a note or chord; a marker placed on the note itself (or a hair after,
 // from rounding) counts.
 function handAt(t) {return view.anchorAt(t + 0.02) || view.anchorAt(t);}
 function noteX(fret) {return fret > 0 ? fret - 0.5 : null;}
 // `span` is the chord box's fret range for a chord's open strings; a lone open string spans the
 // fret-hand position, as in the game.
 function drawNote(n, inChord, span = null, label = undefined) {
  const z = zOf(n.time), s = n.string, h = y(s), color = view.stringColor(s), past = n.time < time;
  const t = n.techniques || {}, ignored = t.ignore === true;
  ctx.globalAlpha = (past ? Math.max(0.15, 1 + (n.time - time) / PAST_SECONDS) : 1) * (ignored ? 0.45 : 1);
  const sustainEnd = Math.min(zFar, zOf(n.time + (n.sustain || 0)));
  const fretHandMuted = t.mute || t.fret_hand_mute, palmMuted = t.palm_mute && !fretHandMuted;
  if (n.fret === 0) {
   // Open string: a slim bar in the string's colour.
   const anchor = handAt(n.time) || {fret: 1, width: 4}, [x0, x1] = span ? [span[0] + 0.15, span[1] - 0.15] : [anchor.fret - 1 + 0.15, anchor.fret - 1 + (anchor.width || 4) - 0.15];
   if (n.sustain > 0) poly([[x0, h, z], [x1, h, z], [x1, h, sustainEnd], [x0, h, sustainEnd]], hexAlpha(color, 0.08));
   // A glowing line rather than a box: soft halo first, then a bright core.
   ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.lineCap = 'round';
   line([x0, h, z], [x1, h, z], hexAlpha(color, 0.9), 4); ctx.shadowBlur = 0; line([x0, h, z], [x1, h, z], '#ffffff', 1.2); ctx.restore();
  } else {
   const x = noteX(n.fret), slide = t.slide_to >= 0 ? t.slide_to : t.slide_unpitch_to >= 0 ? t.slide_unpitch_to : null, xEnd = slide !== null && slide > 0 ? slide - 0.5 : x;
   const bend = Math.max(0, Number(t.bend) || 0), hEnd = h + Math.min(2, bend) * 0.3;
   if (n.sustain > 0) {
    poly([[x - TAIL_HALF, h, z], [x + TAIL_HALF, h, z], [xEnd + TAIL_HALF, hEnd, sustainEnd], [xEnd - TAIL_HALF, hEnd, sustainEnd]], hexAlpha(color, t.slide_unpitch_to >= 0 ? 0.25 : 0.45));
    // Vibrato: a wavy overlay along the sustain tail, in screen space so the wiggle stays legible at any depth.
    if (t.vibrato === true || (typeof t.vibrato === 'number' && t.vibrato > 0)) {
     const steps = Math.max(4, Math.min(24, Math.round((sustainEnd - z) / 0.5))), pts = [];
     for (let i = 0; i <= steps; i++) {const f = i / steps, p = project(x + (xEnd - x) * f, h + (hEnd - h) * f, z + (sustainEnd - z) * f); if (!p) {pts.length = 0; break;} pts.push(p);}
     wavyLine(ctx, pts, 2.5, '#ffe2a8', 1.5);
    }
    // Tremolo picking: short cross-ticks along the tail, as in standard tab notation.
    if (t.tremolo === true || (typeof t.tremolo === 'number' && t.tremolo > 0)) {
     const ticks = Math.max(2, Math.min(10, Math.round((sustainEnd - z) / 1.2)));
     for (let i = 1; i <= ticks; i++) {
      const f = i / (ticks + 1), zz = z + (sustainEnd - z) * f, xx = x + (xEnd - x) * f, hh = h + (hEnd - h) * f;
      const p = project(xx, hh, zz); if (!p) continue;
      ctx.strokeStyle = '#ffe2a8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x - 4 * p.scale * 0.02 - 2, p.y + 3); ctx.lineTo(p.x + 4 * p.scale * 0.02 + 2, p.y - 3); ctx.stroke();
     }
    }
   }
   // Hammer-on / pull-off: an arc from the previous note on this string, the way a slur reads
   // in standard tab, rather than a bare floating letter the player has to decode alone.
   if (!inChord && (t.hammer_on || t.pull_off)) {
    const prev = previousOnString(a, n);
    if (prev && prev.fret !== n.fret) {
     const p0 = project(noteX(prev.fret) ?? 0, y(prev.string), zOf(prev.time)), p1 = project(x, h, z);
     if (p0 && p1) {
      const midX = (p0.x + p1.x) / 2, apex = Math.min(p0.y, p1.y) - Math.max(7, Math.abs(p1.x - p0.x) * 0.2);
      ctx.strokeStyle = t.hammer_on ? '#8fe3a8' : '#ffb199'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(midX, apex, p1.x, p1.y); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(t.hammer_on ? 'H' : 'P', midX, apex - 2);
     }
    }
   }
   if (!inChord) line([x, h, z], [x, 0, z], hexAlpha(color, 0.35), 1);
   // Natural/pinch harmonics get a diamond gem instead of a square one, as in printed tab.
   const harmonic = t.harmonic || t.harmonic_pinch;
   const square = [[x - NOTE_HALF, h - GEM_HALF_H, z], [x + NOTE_HALF, h - GEM_HALF_H, z], [x + NOTE_HALF, h + GEM_HALF_H, z], [x - NOTE_HALF, h + GEM_HALF_H, z]];
   const diamond = [[x, h - GEM_HALF_H - 0.1, z], [x + NOTE_HALF, h, z], [x, h + GEM_HALF_H + 0.1, z], [x - NOTE_HALF, h, z]];
   // Palm-muted notes keep their pitch legible (unlike a fret-hand mute's blank "X"), but a
   // dashed rather than solid outline marks them as muffled, matching the "dotted/ghosted" look
   // printed tab uses for palm mutes.
   if (ignored || palmMuted) ctx.setLineDash(ignored ? [3, 2] : [4, 2]);
   const drawn = poly(harmonic ? diamond : square, fretHandMuted ? '#2a2d36' : palmMuted ? hexAlpha(color, 0.55) : color, past ? '#ffffff' : '#0b0d12', 1.5);
   ctx.setLineDash([]);
   const p = drawn && project(x, h, z);
   if (p && p.scale > 45) {
    ctx.fillStyle = fretHandMuted ? '#e6e8ee' : '#0b0d12'; ctx.font = `bold ${Math.round(Math.max(9, Math.min(18, p.scale * 0.24)))}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const text = fretHandMuted ? 'X' : label !== undefined ? label : String(view.shownFret(n.fret));
    if (text) ctx.fillText(text, p.x, p.y + 1);
    // Slap/pop (bass) get a small corner glyph on the gem itself, in addition to the text tag below.
    if (t.slap) {ctx.fillStyle = '#0b0d12'; ctx.font = `bold ${Math.round(Math.max(7, p.scale * 0.14))}px system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('▲', p.x + p.scale * NOTE_HALF, p.y - p.scale * GEM_HALF_H);}
    if (t.pluck) {ctx.fillStyle = '#0b0d12'; ctx.font = `bold ${Math.round(Math.max(7, p.scale * 0.14))}px system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('●', p.x + p.scale * NOTE_HALF, p.y - p.scale * GEM_HALF_H);}
    const tags = view.techniqueTags(n).filter(tag => !['FM', 'H', 'P'].includes(tag));
    if (tags.length && p.scale > 80) {ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = '#ffe2a8'; ctx.fillText(tags.join(' '), p.x, p.y - p.scale * GEM_HALF_H - 8);}
    if (bend > 0 && p.scale > 60) {ctx.fillStyle = '#ffd27a'; ctx.font = `bold ${Math.round(Math.max(8, Math.min(12, p.scale * 0.14)))}px system-ui, sans-serif`; ctx.fillText('↑' + bendFraction(bend), p.x, p.y - p.scale * GEM_HALF_H - (tags.length ? 20 : 8));}
   }
  }
  ctx.globalAlpha = 1;
 }
 function drawChord(chord) {
  const members = chord.notes || [], template = view.templates[chord.chord_id], z = zOf(chord.time), repeat = view.isRepeat?.(chord);
  if (!members.length) return;
  const fretted = members.filter(n => n.fret > 0);
  let lo = fretted.length ? Math.min(...fretted.map(n => n.fret)) - 1 : (handAt(chord.time)?.fret || 1) - 1;
  let hi = fretted.length ? Math.max(...fretted.map(n => n.fret)) : lo + (handAt(chord.time)?.width || 4);
  // The box (and so its open strings) covers the fret-hand position as well as the fretted notes.
  const hand = handAt(chord.time);
  if (hand) {lo = Math.min(lo, Math.max(1, hand.fret || 1) - 1); hi = Math.max(hi, Math.max(1, hand.fret || 1) - 1 + (hand.width || 4));}
  const heights = members.map(n => y(n.string)), bottom = Math.min(...heights) - 0.25, top = Math.max(...heights) + 0.25;
  ctx.globalAlpha = chord.time < time ? 0.4 : 1;
  poly([[lo, bottom, z], [hi, bottom, z], [hi, top, z], [lo, top, z]], repeat ? 'rgba(120,200,160,0.10)' : 'rgba(120,200,160,0.06)', '#8bd3ad', repeat ? 2.5 : 1.5);
  ctx.globalAlpha = 1;
  if (!repeat) {
   // Chord notes show their fingering, as in the game (T for the thumb); single notes show frets.
   const finger = n => {const f = Number.isInteger(template?.fingers?.[n.string]) && template.fingers[n.string] >= 0 ? template.fingers[n.string] : n.techniques?.left_hand; return Number.isInteger(f) && f >= 0 ? (f === 0 ? 'T' : String(f)) : '';};
   for (const n of members.slice().sort((p, q) => y(q.string) - y(p.string))) drawNote({...n, time: chord.time}, true, [lo, hi], finger(n));
   const name = template ? view.chordLabel(template, members) : '';
   const p = project((lo + hi) / 2, top, z);
   if (name && p && p.scale > 40 && !String(template?.displayName || '').endsWith('-nop')) {
    ctx.fillStyle = '#d8f2e4'; ctx.font = `bold ${Math.round(Math.min(16, p.scale * 0.17))}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(name, p.x, p.y - 3);
   }
  }
 }
}

function anchorSegments(view, start, end) {
 const out = [], anchors = view.anchors || [];
 for (let i = 0; i < anchors.length; i++) {
  const a = anchors[i], until = anchors[i + 1]?.time ?? Infinity;
  if (until < start || a.time > end) continue;
  out.push({start: Math.max(a.time, start), end: Math.min(until, end), fret: Math.max(1, a.fret || 1), width: a.width || 4});
 }
 return out;
}

function hexAlpha(color, alpha) {
 const m = /^#([0-9a-f]{6})$/i.exec(color || '');
 if (!m) return color;
 const v = parseInt(m[1], 16);
 return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${alpha})`;
}
