import {findVocalIssues} from './vocal-validation.js';
/**
 * Original, read-only chart error finder. No proprietary implementation used.
 *
 * Evidence: the prerelease OCE documents an Error Finder, anchors at phrase
 * starts, chord templates/fingers, bends/slides and four tone slots. Local
 * Feedpak schemas define seconds, per-phrase difficulty ladders and time-signature
 * pairs. Local Rocksmith2014.NET has six-string tuning/stock bass constraints and
 * requires native GearList tone definitions when packaging. Retail validation
 * rules have NOT been established: this module does not claim to reproduce them.
 *
 * Design choices: overlaps/physical stretches/finger conflicts are advisory;
 * malformed data/references are errors. Curve times are relative to the note.
 * A one-millisecond tolerance prevents floating-point boundary noise. A shared
 * finger at one fret is a valid barre. The optional stock export target adds
 * compatibility checks; Feedpak extended instruments remain valid. Unknown
 * fields survive because validation never rewrites or repairs input.
 */

const list = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const has = (value, key) => value != null && Object.hasOwn(value, key);
const timeOf = value => value?.time ?? value?.t ?? value?.start_time ?? value?.startTime;
const sustainOf = value => value?.sustain ?? value?.sus ?? 0;
const fretOf = value => value?.fret ?? value?.f;
const stringOf = value => value?.string ?? value?.s;
const chordId = value => value?.chord_id ?? value?.chordId ?? value?.id;
const fretted = value => value?.type === 'guitar' || value?.type === 'bass';
const ownObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const getTechnique = (note, ...names) => {
  for (const name of names) {
    if (has(note?.techniques, name)) return note.techniques[name];
    if (has(note, name)) return note[name];
  }
  return undefined;
};

export function findChartIssues(project, options = {}) {
  if (typeof options === 'string') options = {target: options};
  const target = options.target ?? 'feedpak';
  const stock = target === 'cdlc' || target === 'xml';
  const epsilon = finite(options.epsilon) && options.epsilon >= 0 ? options.epsilon : 0.001;
  // Chart XML stores times to the millisecond; a linked note and its target can each round by half of that.
  const linkTolerance = Math.max(epsilon, 0.002);
  // Times this far apart (song-length subtractions) carry float64 rounding noise around 1e-13;
  // a chart whose bend point or linked sustain lands exactly on the epsilon boundary by design
  // must not flip to an error/warning purely on which side of that noise the subtraction landed.
  const floatNoise = 1e-9;
  const maxFret = Number.isInteger(options.maxFret) && options.maxFret > 0 ? options.maxFret : 24;
  const issues = [];
  let arrangement = null;
  const emit = (code, message, {severity = 'error', item = null, path = '', time, related} = {}) => {
    const eventTime = time ?? timeOf(item);
    const issue = {code, severity, arrangement: arrangement?.id, note: item?.id,
      time: finite(eventTime) ? eventTime : 0, message, path};
    if (related) issue.related = related;
    issues.push(issue);
  };
  if (!ownObject(project)) {
    emit('project.invalid', 'Project must be an object.');
    return issues;
  }
  if(options.includeVocals!==false)issues.push(...findVocalIssues(project,{target,epsilon}));
  const duration = project.duration;
  if (!finite(duration) || duration < 0) emit('project.duration', 'Song duration must be finite and non-negative.', {path: 'duration'});
  const checkTime = (item, path, {tail = false, fallbackTime} = {}) => {
    const time = timeOf(item) ?? fallbackTime;
    if (!finite(time) || time < 0) emit('time.invalid', 'Event time must be finite and non-negative.', {item, path, time});
    else if (finite(duration) && time > duration + epsilon) emit('time.afterSong', 'Event starts after the end of the song.', {item, path, time});
    if (tail) {
      const sustain = sustainOf(item);
      if (!finite(sustain) || sustain < 0) emit('sustain.invalid', 'Sustain must be finite and non-negative.', {item, path, time});
      else if (finite(time) && finite(duration) && time + sustain > duration + epsilon) emit('sustain.afterSong', 'Sustain extends beyond the end of the song.', {item, path, time});
    }
    return time;
  };
  const checkSignatures = (rows, path) => {
    let previous = -Infinity;
    const seen = new Set();
    for (const [index, signature] of list(rows).entries()) {
      const location = `${path}[${index}]`, time = checkTime(signature, location);
      const pair = signature?.ts ?? signature?.time_signature ?? signature?.timeSignature ??
        [signature?.numerator, signature?.denominator];
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) || pair[0] < 1 || !Number.isInteger(pair[1]) || pair[1] < 1) {
        emit('meter.invalid', 'Time signature needs a positive integer numerator and denominator.', {item: signature, path: location});
      } else if ((pair[1] & (pair[1] - 1)) !== 0 || pair[1] > 128) {
        // The Feedpak schema allows positive denominators. The conventional
        // notation/export restriction is consequently advisory for Feedpak.
        emit('meter.denominator', 'Conventional notation needs a power-of-two denominator up to 128.', {item: signature, path: location, severity: stock ? 'error' : 'warning'});
      }
      if (finite(time)) {
        if (seen.has(time)) emit('meter.duplicate', 'More than one time signature occurs at this time.', {item: signature, path: location});
        if (time < previous - epsilon) emit('meter.order', 'Time signatures are not in chronological order.', {item: signature, path: location, severity: 'warning'});
        seen.add(time); previous = time;
      }
    }
  };
  checkSignatures(project.time_signatures ?? project.timeSignatures, 'time_signatures');
  if (project.timeline) checkSignatures(project.timeline.time_signatures, 'timeline.time_signatures');
  const beats = list(project.beats);
  for (const [index, beat] of beats.entries()) {
    if (!finite(timeOf(beat)) || timeOf(beat) < 0 || (index && timeOf(beat) <= timeOf(beats[index - 1]))) emit('beats.order', 'Beat times must be finite, non-negative and strictly increasing.', {item: beat, path: `beats[${index}]`});
    if (has(beat, 'ts')) checkSignatures([beat], `beats[${index}].meter`);
  }
  for (const [index, section] of list(project.sections).entries()) checkTime(section, `sections[${index}]`);
  if (!Array.isArray(project.arrangements) || !project.arrangements.length) emit('arrangements.empty', 'Project needs at least one arrangement.', {path: 'arrangements'});

  for (const [arrIndex, arr] of list(project.arrangements).entries()) {
    arrangement = ownObject(arr) ? arr : null;
    const basePath = `arrangements[${arrIndex}]`;
    if (!arrangement) { emit('arrangement.invalid', 'Arrangement must be an object.', {path: basePath}); continue; }
    if (stock && arrangement.editorOnly) continue;
    if (arrangement.hidden === true) continue;   // hidden parts are not built; checked again once unhidden
    for (const [i, o] of list(arrangement.combineReview).entries()) if (ownObject(o) && finite(o.start)) emit('combine.overlap', `Combined parts overlapped here (${list(o.sources).join(', ')}): ${o.kept === 'both' ? 'both kept' : `kept ${o.kept}`}. Check it, then Arrangement > Clear overlap highlights.`, {severity: 'warning', time: o.start, path: `arrangements[${arrIndex}].combineReview[${i}]`});
    const a = arrangement, isFretted = fretted(a), count = a.stringCount ?? a.tuning?.length ?? (a.type === 'bass' ? 4 : 6);
    const templates = list(a.chord_templates ?? a.templates);
    if (stock && (!isFretted || count !== (a.type === 'bass' ? 4 : 6))) emit('export.instrument', 'Stock RS2014 requires exactly six-string guitar or four-string bass; retain other layouts in the source project / FeedBack.', {path: basePath});
    if (isFretted && (!Number.isInteger(count) || count < 1)) emit('strings.invalid', 'String count must be a positive integer.', {path: `${basePath}.stringCount`});
    checkSignatures(a.time_signatures ?? a.timeSignatures, `${basePath}.time_signatures`);

    for (const [index, template] of templates.entries()) {
      const path = `${basePath}.chord_templates[${index}]`;
      if (!ownObject(template)) { emit('template.invalid', 'Chord template must be an object.', {path}); continue; }
      const frets = list(template.frets), fingers = list(template.fingers);
      if (frets.length !== count || (has(template, 'fingers') && fingers.length !== count)) emit('template.width', 'Chord template fret/finger arrays must match the string count.', {path});
      const fingerFrets = new Map();
      for (let lane = 0; lane < frets.length; lane++) {
        const fret = frets[lane], finger = fingers[lane];
        if (!Number.isInteger(fret) || fret < -1 || fret > maxFret) emit('template.fret', `Invalid chord fret on string ${lane + 1}.`, {path: `${path}.frets[${lane}]`});
        if (stock && fret > 0 && fret + (a.capo || 0) > maxFret) emit('template.capoRange', 'Chord exceeds the physical fret range with this capo.', {path});
        if (finger !== undefined && (!Number.isInteger(finger) || finger < -1 || finger > 4)) emit('template.finger', `Chord finger on string ${lane + 1} must be -1 through 4.`, {path: `${path}.fingers[${lane}]`});
        if (Number.isInteger(finger) && finger >= 0 && fret <= 0) emit('template.unusedFinger', 'Finger assigned to an open or unused string.', {path, severity: 'warning'});
        if (Number.isInteger(finger) && finger >= 0 && fret > 0) {
          if (fingerFrets.has(finger) && fingerFrets.get(finger) !== fret) emit('template.fingerConflict', 'One finger is assigned to different frets; check the fingering.', {path, severity: 'warning'});
          fingerFrets.set(finger, fret);
        }
      }
      const positive = frets.filter(fret => Number.isInteger(fret) && fret > 0);
      if (positive.length && Math.max(...positive) - Math.min(...positive) > 4) emit('template.stretch', 'Chord spans more than five frets; check playability.', {path, severity: 'warning'});
    }

    const anchors = list(a.anchors).filter(ownObject).slice().sort((x, y) => timeOf(x) - timeOf(y));
    for (const [index, anchor] of list(a.anchors).entries()) {
      const path = `${basePath}.anchors[${index}]`;
      checkTime(anchor, path);
      if (!Number.isInteger(anchor?.fret) || anchor.fret < (a.capo > 0 ? 0 : 1) || anchor.fret > maxFret || !finite(anchor.width ?? 4) || (anchor.width ?? 4) <= 0) emit('anchor.invalid', 'Anchor needs a valid fret and positive width.', {item: anchor, path});
      if (stock && anchor?.fret + (a.capo || 0) > maxFret) emit('anchor.capoRange', 'Anchor exceeds the physical fret range with this capo.', {item: anchor, path});
      if (index && finite(timeOf(anchor)) && timeOf(anchor) === timeOf(list(a.anchors)[index - 1])) emit('anchor.duplicate', 'Two anchors start at the same time.', {item: anchor, path});
    }
    const inspectNotes = (notes, chords, path, {start = 0, end = duration, anchorRows = anchors} = {}) => {
      const orderedAnchors=list(anchorRows).filter(anchor=>finite(timeOf(anchor))).slice().sort((a,b)=>timeOf(a)-timeOf(b));
      const anchorAt=time=>{if(!finite(time))return undefined;let lo=0,hi=orderedAnchors.length;while(lo<hi){const mid=(lo+hi)>>>1;if(timeOf(orderedAnchors[mid])<=time+epsilon)lo=mid+1;else hi=mid;}return orderedAnchors[lo-1];};
      const events = [];
      const checkNote = (note, location, parentTime) => {
        if (!ownObject(note)) { emit('note.invalid', 'Note/hit must be an object.', {path: location}); return; }
        const time = checkTime(note, location, {tail: true, fallbackTime: parentTime}), sustain = sustainOf(note);
        const lane = stringOf(note), fret = fretOf(note);
        if (finite(time) && (time < start - epsilon || (finite(end) && time >= end + epsilon))) emit('difficulty.noteRange', 'Difficulty note lies outside its phrase interval.', {item: note, path: location, time});
        if (isFretted) {
          if (!Number.isInteger(lane) || lane < 0 || lane >= count) emit('note.string', 'Note refers to a missing string.', {item: note, path: location, time});
          if (!Number.isInteger(fret) || fret < 0 || fret > maxFret) emit('note.fret', `Fret must be an integer from 0 to ${maxFret}.`, {item: note, path: location, time});
          if (stock && fret > 0 && fret + (a.capo || 0) > maxFret) emit('note.capoRange', 'Note exceeds the physical fret range with this capo.', {item: note, path: location, time});
          const anchor = anchorAt(time);
          if (finite(fret) && fret > 0 && (!anchor || fret < anchor.fret || fret >= anchor.fret + (anchor.width ?? 4))) emit('note.anchor', 'Fretted note falls outside the current anchor zone.', {item: note, path: location, time, severity: 'warning'});
        }
        const pitch = note.pitch ?? (a.type === 'keys' ? lane * 24 + fret : null);
        if (a.type === 'keys' && (!Number.isInteger(pitch) || pitch < 0 || pitch > 127)) emit('note.pitch', 'Piano pitch must be an integer MIDI note from 0 to 127.', {item: note, path: location, time});
        if (a.type === 'keys' && note.velocity !== undefined && (!Number.isInteger(note.velocity) || note.velocity < 0 || note.velocity > 127)) emit('note.velocity', 'Piano velocity must be an integer from 0 to 127.', {item: note, path: location, time});
        if (a.type === 'drums') {
          if (typeof (note.piece ?? note.p) !== 'string' || !(note.piece ?? note.p).trim()) emit('drum.piece', 'Drum hit needs a piece identity.', {item: note, path: location, time});
          const velocity = note.velocity ?? note.v;
          if (velocity !== undefined && (!Number.isInteger(velocity) || velocity < 1 || velocity > 127)) emit('drum.velocity', 'Drum velocity must be an integer from 1 to 127.', {item: note, path: location, time});
        }
        for (const [label, names] of [['pitched', ['slide_to', 'slideTo', 'sl']], ['unpitched', ['slide_unpitch_to', 'slideUnpitchTo', 'slu']]]) {
          const destination = getTechnique(note, ...names);
          if (destination === undefined || destination === -1 || destination === null) continue;
          if (!Number.isInteger(destination) || destination < 0 || destination > maxFret) emit('slide.destination', `Invalid ${label} slide destination fret.`, {item: note, path: location, time});
          if (destination === fret) emit('slide.stationary', 'Slide destination equals the starting fret.', {item: note, path: location, time, severity: 'warning'});
          // Rocksmith 2014 cannot show a slide with no length, so its export treats it as an error.
          if (!(sustain > epsilon)) emit('slide.noSustain', 'Slide needs a non-zero duration.', {item: note, path: location, time, severity: target === 'cdlc' ? 'error' : 'warning'});
        }
        const destinationPitch = getTechnique(note, 'force_destination_pitch', 'forceDestPitch');
        if (destinationPitch !== undefined && ![0,1,2].includes(destinationPitch)) emit('destinationPitch.invalid', 'Force destination pitch must be Auto (0), On (1) or Off (2).', {item: note, path: location, time});
        else if (stock && destinationPitch > 0) emit('destinationPitch.unsupported', 'Stock RS2014 has no confirmed force destination pitch equivalent. Choose Auto or save editable JSON / FeedBack.', {item: note, path: location, time});
        const bend = getTechnique(note, 'bend', 'bn'), curve = getTechnique(note, 'bend_values', 'bendValues', 'bnv');
        if (bend !== undefined && (!finite(bend) || bend < 0)) emit('bend.amount', 'Bend amount must be finite and non-negative.', {item: note, path: location, time});
        if (isFretted && fret === 0 && (bend > 0 || list(curve).some(point => (point?.v ?? point?.step) > 0))) emit('bend.openString', 'Open-string bend requires a special technique; check the chart.', {item: note, path: location, time, severity: 'warning'});
        if (curve !== undefined && !Array.isArray(curve)) emit('bend.curve', 'Bend curve must be a list of relative-time/value points.', {item: note, path: location, time});
        let previous = -Infinity;
        for (const [pointIndex, point] of list(curve).entries()) {
          const relative = point?.t ?? point?.time, value = point?.v ?? point?.step;
          if (!finite(relative) || relative < -epsilon || (finite(sustain) && relative > sustain + epsilon + floatNoise)) emit('bend.pointTime', 'Bend point lies outside the note sustain.', {item: note, path: `${location}.bend[${pointIndex}]`, time});
          if (!finite(value) || value < 0) emit('bend.pointValue', 'Bend point value must be finite and non-negative.', {item: note, path: `${location}.bend[${pointIndex}]`, time});
          if (finite(relative) && relative <= previous) emit('bend.pointOrder', 'Bend points must have strictly increasing relative times.', {item: note, path: `${location}.bend[${pointIndex}]`, time});
          if (finite(relative)) previous = relative;
        }
        const key = a.type === 'drums' ? note.piece ?? note.p : a.type === 'keys' ? pitch : lane;
        if (finite(time) && finite(sustain) && sustain >= 0 && key !== undefined) events.push({note, time, sustain, key, path: location});
      };
      for (const [index, note] of list(notes).entries()) checkNote(note, `${path}.notes[${index}]`);
      for (const [index, chord] of list(chords).entries()) {
        const location = `${path}.chords[${index}]`, time = checkTime(chord, location), ref = chordId(chord);
        if (!Number.isInteger(ref) || ref < 0 || ref >= templates.length) emit('chord.template', 'Chord refers to a missing template.', {item: chord, path: location});
        const lanes = new Set();
        const members = list(chord?.notes);
        const realized = members.length ? members : list(templates[ref]?.frets).flatMap((fret, lane) => fret >= 0 ? [{time, string: lane, fret, sustain: sustainOf(chord)}] : []);
        for (const [memberIndex, note] of realized.entries()) {
          checkNote(note, `${location}.notes[${memberIndex}]`, time);
          const lane = stringOf(note);
          if (lanes.has(lane)) emit('chord.stringConflict', 'Chord has more than one note on the same string.', {item: note, path: location, time});
          lanes.add(lane);
          if (finite(timeOf(note)) && finite(time) && Math.abs(timeOf(note) - time) > epsilon) emit('chord.memberTime', 'Chord member starts at a different time from its chord.', {item: note, path: location});
          if (Number.isInteger(ref) && templates[ref]?.frets?.[lane] !== undefined && templates[ref].frets[lane] !== fretOf(note)) emit('chord.fretMismatch', 'Chord member fret differs from the referenced template.', {item: note, path: location, time});
        }
      }
      const byLane = new Map();
      for (const event of events) {
        if (!byLane.has(event.key)) byLane.set(event.key, []);
        byLane.get(event.key).push(event);
      }
      for (const lane of byLane.values()) {
        lane.sort((x, y) => x.time - y.time);
        // Track the furthest tail, not just the previous onset: a short note
        // between a long sustain and a later note must not hide the overlap.
        let active = null;
        for (let index = 0; index < lane.length; index++) {
          const event = lane[index], next = lane[index + 1], previous = lane[index - 1];
          if (previous && Math.abs(event.time - previous.time) <= epsilon) emit('note.duplicate', 'Two events occupy the same lane/pitch and time.', {item: event.note, path: event.path, time: event.time, related: [previous.note.id].filter(Boolean)});
          else if (a.type !== 'drums' && active && active.time + active.sustain > event.time + epsilon + floatNoise) emit('sustain.overlap', 'A sustain crosses a later note on the same string or pitch.', {item: event.note, path: event.path, time: event.time, severity: 'warning', related: [active.note.id].filter(Boolean)});
          if (getTechnique(event.note, 'link_next', 'linkNext', 'ln') && (!next || Math.abs(event.time + event.sustain - next.time) > linkTolerance)) emit('link.disconnected', 'Link-next does not reach the next event on this lane.', {item: event.note, path: event.path, time: event.time, severity: 'warning'});
          if (!active || event.time + event.sustain >= active.time + active.sustain) active = event;
        }
      }
    };
    inspectNotes(a.notes, a.chords, basePath);
    for (const [index, shape] of list(a.handshapes).entries()) {
      const path = `${basePath}.handshapes[${index}]`, start = timeOf(shape), end = shape?.end_time ?? shape?.endTime;
      checkTime(shape, path);
      const ref = chordId(shape);
      if (!Number.isInteger(ref) || ref < 0 || ref >= templates.length) emit('handshape.template', 'Handshape refers to a missing chord template.', {item: shape, path});
      if (!finite(end) || !finite(start) || end <= start) emit('handshape.interval', 'Handshape end must be after its start.', {item: shape, path});
      if (finite(end) && finite(duration) && end > duration + epsilon) emit('handshape.afterSong', 'Handshape extends beyond the song.', {item: shape, path});
    }
    const phrases = list(a.phrases);
    // Empty phrases (count-in, outro) have nothing to play, so they need no anchor.
    const eventTimes = [...list(a.notes), ...list(a.chords)].map(timeOf).filter(finite);
    const phraseStarts = phrases.map(timeOf);
    for (const [index, phrase] of phrases.entries()) {
      const path = `${basePath}.phrases[${index}]`, start = checkTime(phrase, path), end = phrase?.end_time ?? phrase?.endTime;
      const until = phraseStarts.slice(index + 1).find(t => finite(t) && t > start) ?? (finite(end) ? end : Infinity);
      const played = eventTimes.some(t => t >= start - epsilon && t < until - epsilon);
      if (isFretted && played && finite(start) && !anchors.some(anchor => finite(timeOf(anchor)) && Math.abs(timeOf(anchor) - start) <= epsilon)) emit('phrase.anchor', 'Phrase needs an anchor at its start.', {item: phrase, path, time: start, severity: 'warning'});
      if (end !== undefined && (!finite(end) || !finite(start) || end <= start)) emit('phrase.interval', 'Phrase end must be after its start.', {item: phrase, path});
      if (finite(end) && finite(duration) && end > duration + epsilon) emit('phrase.afterSong', 'Phrase extends beyond the song.', {item: phrase, path});
      if (!has(phrase, 'levels')) continue; // plain editor markers have no DD ladder
      if (!Array.isArray(phrase.levels) || !phrase.levels.length) { emit('difficulty.empty', 'Difficulty ladder must contain at least one level.', {item: phrase, path}); continue; }
      const difficulties = new Set();
      for (const [levelIndex, level] of phrase.levels.entries()) {
        const location = `${path}.levels[${levelIndex}]`, difficulty = level?.difficulty;
        if (!Number.isInteger(difficulty) || difficulty < 0) emit('difficulty.index', 'Difficulty must be a non-negative integer.', {item: phrase, path: location});
        else if (difficulties.has(difficulty)) emit('difficulty.duplicate', 'Phrase repeats a difficulty level.', {item: phrase, path: location});
        difficulties.add(difficulty);
        inspectNotes(level?.notes, level?.chords, location, {start: finite(start) ? start : 0, end: finite(end) ? end : duration,
          anchorRows: list(level?.anchors).length ? list(level.anchors).slice().sort((x,y) => timeOf(x) - timeOf(y)) : anchors});
      }
      const maximum = phrase.max_difficulty ?? phrase.maxDifficulty;
      if (!Number.isInteger(maximum) || maximum < 0 || !difficulties.has(maximum) || [...difficulties].some(value => value > maximum)) emit('difficulty.maximum', 'Phrase maximum difficulty must name the highest available level.', {item: phrase, path});
    }
    const definitions = list(a.phraseDefinitions ?? a.phrase_definitions ?? a.phrases);
    for (const [index, iteration] of list(a.phraseIterations ?? a.phrase_iterations).entries()) {
      const path = `${basePath}.phraseIterations[${index}]`;
      checkTime(iteration, path);
      const ref = iteration?.phraseId ?? iteration?.phrase_id;
      const definition = Number.isInteger(ref) ? definitions[ref] : definitions.find(phrase => phrase?.id === ref);
      if (!definition) emit('difficulty.phraseReference', 'Phrase iteration refers to a missing phrase definition.', {item: iteration, path});
      else if (iteration.difficulty !== undefined && !list(definition.levels).some(level => level?.difficulty === iteration.difficulty)) emit('difficulty.levelReference', 'Phrase iteration refers to a missing difficulty level.', {item: iteration, path});
    }

    const tones = ownObject(a.tones) ? a.tones : ownObject(project.tones) ? project.tones : {};
    const toneDefinitions = ownObject(tones.definitions) ? tones.definitions : {};
    const used = new Set();
    if (typeof tones.base === 'string' && tones.base.trim()) used.add(tones.base);
    const changes = list(tones.changes ?? a.toneChanges);
    const changeTimes = new Set();
    let previousChange = -Infinity;
    for (const [index, change] of changes.entries()) {
      const path = `${basePath}.tones.changes[${index}]`, time = checkTime(change, path);
      if (typeof change?.name !== 'string' || !change.name.trim()) emit('tone.name', 'Tone change needs a tone name.', {item: change, path});
      else used.add(change.name);
      if (finite(time)) {
        if (changeTimes.has(time)) emit('tone.duplicateChange', 'Two tone changes occupy the same time.', {item: change, path});
        if (time < previousChange - epsilon) emit('tone.order', 'Tone changes are not chronological.', {item: change, path, severity: 'warning'});
        changeTimes.add(time); previousChange = time;
      }
    }
    const slots = Array.isArray(tones.slots) ? tones.slots : ownObject(tones.slots) ? Object.values(tones.slots) : null;
    if (slots) for (const name of used) if (!slots.includes(name)) emit('tone.unallocated', `Tone "${name}" is not assigned to an arrangement slot.`, {path: `${basePath}.tones.slots`, severity: stock ? 'error' : 'warning'});
    if (stock && used.size > 4) emit('tone.stockLimit', 'Stock RS2014 supports at most four distinct arrangement tones.', {path: `${basePath}.tones`});
    for (const name of used) {
      const definition = has(toneDefinitions, name) ? toneDefinitions[name] : null;
      if (!ownObject(definition)) { emit('tone.definitionMissing', `Tone "${name}" has no gear definition.`, {path: `${basePath}.tones.definitions`, severity: target === 'cdlc' ? 'error' : 'warning'}); continue; }
      const gear = definition.GearList ?? definition.gearList;
      if (target === 'cdlc' && (!ownObject(gear) || !ownObject(gear.Amp ?? gear.amp))) emit('tone.nativeDefinition', `Tone "${name}" needs a native RS2014 GearList/Amp definition for CDLC.`, {path: `${basePath}.tones.definitions`});
    }
  }
  return issues;
}

export function validateProject(project, target = 'feedpak') {
  return findChartIssues(project, typeof target === 'object' ? target : {target});
}

export default findChartIssues;
