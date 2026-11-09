"""R+ (Rocksmith+) song folders: open, edit and add charts.

A downloaded R+ song folder holds `Official_<Type><n>_<arrangementId>_v<rev>.xml`
charts (song XML version 19), `metadata.json`, `tone_<id>.json`, a
`lyrics_<songId>_<lang>_v<rev>.xml` (`<trueVocals>`), `album_art.jpg` and
`audio.wem`. Guitar and bass charts use the RS2014 note/chord vocabulary, so
they load through the editor's v7 reader. Keyboard charts store the MIDI pitch
in `midi` (`fret` is the key number, midi-20) and a per-note notation timing
(`<beats>`), which this module reads and writes.

Saving never rewrites a source file: changed or new charts become new
`Official_*` files (the next revision for an existing arrangement), every
original file is left as it was.
"""
import base64
import bisect
import copy
import datetime
import hashlib
import json
import math
import re
import uuid
import xml.etree.ElementTree as ET
from pathlib import PurePosixPath

try:
    from . import pack_io
except ImportError:
    import pack_io

RPLUS_VERSIONS = ('17', '19')
# Official charts and user-made (UGC) charts share one naming scheme: <source>_<Type><n>_<id>_v<rev>.xml
CHART_NAME = re.compile(r'(Official|UGC)_([A-Za-z]+)(\d*)_([0-9a-fA-F-]{36})_v(\d+)\.xml')
# Shared R+ keyboard tone preset: grand piano (the most used keyboard tone).
GRAND_PIANO = {'id': 'a619a34a-a3d4-5c4e-120d-52e2514542cb', 'event': 'tone:grandpiano',
               'key': 'KeysSwitchGrandPiano', 'synth': 'keys_switch_GrandPiano'}
SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
# Keys whose signature uses flats (majors, then minors).
FLAT_KEYS = {'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm'}
# Krumhansl-Kessler key profiles, for a key-signature guess when none is known.
MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
# Note values (in beats) a notation length is built from: plain, then triplet.
PLAIN = (4.0, 2.0, 1.0, 0.5, 0.25, 0.125)
TRIPLET = (4 / 3, 2 / 3, 1 / 3, 1 / 6)


def _root_xml(entries):
    return {name: data for name, data in entries.items() if '/' not in name and name.lower().endswith('.xml')}


def _parse(data):
    return ET.fromstring(pack_io._xml_input(data))


def is_rplus_folder(entries):
    """A folder with at least one root-level Official_*.xml or UGC_*.xml in R+ song XML."""
    for name, data in _root_xml(entries).items():
        if CHART_NAME.fullmatch(name) and re.search(rb'<song version="(17|19)"', data[:512]):
            return True
    return False


def _fingerprint(arr):
    """Content identity of a chart: what a save must notice as an edit."""
    def notes(rows):
        return [(round(n.get('time', 0), 3), n.get('string'), n.get('fret'), n.get('pitch'), round(n.get('sustain', 0), 3)) for n in rows]
    rows = {'notes': sorted(notes(arr.get('notes', []))),
            'chords': sorted((round(c.get('time', 0), 3), tuple(notes(c.get('notes', [])))) for c in arr.get('chords', [])),
            'tuning': arr.get('tuning'), 'capo': arr.get('capo'), 'type': arr.get('type')}
    return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()


def _pitch(note):
    pitch = note.get('pitch')
    return pitch if isinstance(pitch, int) and not isinstance(pitch, bool) else note.get('string', 0) * 24 + note.get('fret', 0)


def _key_spelling(key):
    return FLATS if key in FLAT_KEYS else SHARPS


def guess_key(pitches):
    """Most likely key signature name (e.g. 'Bbm', 'F') for a set of MIDI pitches."""
    if not pitches:
        return None
    counts = [0] * 12
    for pitch in pitches:
        counts[pitch % 12] += 1
    best = None
    for tonic in range(12):
        for profile, suffix in ((MAJOR, ''), (MINOR, 'm')):
            rotated = [profile[(pc - tonic) % 12] for pc in range(12)]
            mean_a, mean_b = sum(counts) / 12, sum(rotated) / 12
            num = sum((a - mean_a) * (b - mean_b) for a, b in zip(counts, rotated))
            den = (sum((a - mean_a) ** 2 for a in counts) * sum((b - mean_b) ** 2 for b in rotated)) ** 0.5 or 1
            score = num / den
            name = FLATS[tonic] if FLATS[tonic] + suffix in FLAT_KEYS else SHARPS[tonic]
            if best is None or score > best[0]:
                best = (score, name + suffix)
    return best[1]


def _load_keyboard(root, name, index):
    levels = root.findall('./levels/level')
    level = max(levels, key=lambda l: int(l.get('difficulty', 0))) if levels else ET.Element('level')
    notes, extras = [], {}
    for i, element in enumerate(level.findall('./notes/note')):
        pitch = int(element.get('midi') or int(element.get('fret', 0)) + 20)
        if not 0 <= pitch <= 127:
            raise pack_io.ProjectError(f'Keyboard note MIDI pitch out of range in {name}')
        note = {'id': f'k{index}-{i}', 'time': float(element.get('time', 0)), 'sustain': float(element.get('sustain', 0)),
                'string': pitch // 24, 'fret': pitch % 24, 'pitch': pitch, 'techniques': {},
                'hand': 'rh' if element.get('staff') == '1' else 'lh' if element.get('staff') == '0' else None}
        if note['hand'] is None:
            note.pop('hand')
        notes.append(note)
        # Notation, fingering and articulation the editor does not edit yet ride along.
        extras[note['id']] = {'attrib': dict(element.attrib), 'children': [ET.tostring(c, encoding='unicode') for c in element]}
    arr = {'id': f'rplus-{index}', 'name': root.findtext('arrangement', 'Keyboard'), 'type': 'keys', 'instrument': 'keys',
           'stringCount': 6, 'tuning': [0] * 6, 'basePitches': [], 'capo': 0, 'notes': notes, 'chords': [],
           'chord_templates': [], 'anchors': [], 'handshapes': []}
    definitions = root.findall('./phrases/phrase')
    arr['phrases'] = [{'id': f'p{i}', 'name': definitions[int(it.get('phraseId', 0))].get('name', 'phrase') if int(it.get('phraseId', 0)) < len(definitions) else 'phrase',
                       'time': float(it.get('time', 0))} for i, it in enumerate(root.findall('./phraseIterations/phraseIteration'))]
    events = [{'time': float(e.get('time', 0)), 'code': e.get('code', '')} for e in root.findall('./events/event')]
    return arr, extras, events


def _vocals(root):
    """<trueVocals> -> the native <vocals> document the editor already reads."""
    out = ET.Element('vocals')
    offset = _song_offset(root, 'R+ lyrics')
    for vocal in root.findall('./vocals/vocal'):
        attrs = {k: v for k, v in vocal.attrib.items() if k in ('time', 'note', 'length', 'lyric')}
        try:
            time = float(attrs.get('time', '0')) - offset
        except ValueError as exc:
            raise pack_io.ProjectError('R+ lyrics contain an invalid vocal time') from exc
        if not math.isfinite(time) or time < 0:
            raise pack_io.ProjectError('R+ lyrics offset moves a vocal event before the song start')
        attrs['time'] = str(time)
        ET.SubElement(out, 'vocal', attrs)
    out.set('count', str(len(out)))
    return ET.tostring(out, encoding='utf-8', xml_declaration=True)


def _song_offset(root, name):
    try:
        offset = float(root.findtext('offset', '0') or 0)
    except ValueError as exc:
        raise pack_io.ProjectError(f'{name} has an invalid song offset') from exc
    if not math.isfinite(offset):
        raise pack_io.ProjectError(f'{name} has an invalid song offset')
    return offset


def _normalized_chart(root, name):
    offset = _song_offset(root, name)
    normalized = copy.deepcopy(root)
    for element in normalized.iter():
        if element.tag == 'ebeat':
            continue
        for field in ('time', 'startTime', 'endTime'):
            value = element.get(field)
            if value is None:
                continue
            try:
                timestamp = float(value) - offset
            except ValueError as exc:
                raise pack_io.ProjectError(f'{name} has an invalid timestamp') from exc
            if not math.isfinite(timestamp):
                raise pack_io.ProjectError(f'{name} has an invalid timestamp')
            element.set(field, str(max(0.0, timestamp)))
    ebeats = normalized.find('ebeats')
    if ebeats is not None:
        for beat in list(ebeats):
            try:
                timestamp = float(beat.get('time', '0')) - offset
            except ValueError as exc:
                raise pack_io.ProjectError(f'{name} has an invalid beat time') from exc
            if not math.isfinite(timestamp):
                raise pack_io.ProjectError(f'{name} has an invalid beat time')
            if timestamp < 0:
                ebeats.remove(beat)
            else:
                beat.set('time', str(timestamp))
        ebeats.set('count', str(len(ebeats)))
    start_beat = normalized.find('startBeat')
    if start_beat is not None and start_beat.text:
        try:
            timestamp = float(start_beat.text) - offset
        except ValueError as exc:
            raise pack_io.ProjectError(f'{name} has an invalid startBeat') from exc
        if not math.isfinite(timestamp):
            raise pack_io.ProjectError(f'{name} has an invalid startBeat')
        start_beat.text = str(max(0.0, timestamp))
    song_length = normalized.find('songLength')
    if song_length is not None and song_length.text:
        try:
            length = float(song_length.text) - offset
        except ValueError as exc:
            raise pack_io.ProjectError(f'{name} has an invalid songLength') from exc
        if not math.isfinite(length):
            raise pack_io.ProjectError(f'{name} has an invalid songLength')
        song_length.text = str(max(0.0, length))
    offset_element = normalized.find('offset')
    if offset_element is None:
        offset_element = ET.SubElement(normalized, 'offset')
    offset_element.text = '0.000'
    return normalized, ET.tostring(normalized, encoding='utf-8', xml_declaration=True), offset


def _beat_times(root, name):
    offset = _song_offset(root, name)
    times = []
    for beat in root.findall('./ebeats/ebeat'):
        try:
            time = float(beat.get('time', '0')) - offset
        except ValueError as exc:
            raise pack_io.ProjectError(f'{name} has an invalid beat time') from exc
        if not math.isfinite(time):
            raise pack_io.ProjectError(f'{name} has an invalid beat time')
        times.append(time)
    return times


def _beat_maps_agree(left, right):
    return len(left) == len(right) and all(abs(a - b) <= 0.02 for a, b in zip(left, right))


def _tone_files(entries):
    """R+ tone_<id>.json files by lower-case tone id: their toneData is Rocksmith tone gear."""
    tones = {}
    for name, data in entries.items():
        match = re.fullmatch(r'tone_([0-9a-fA-F-]{36})\.json', name)
        if not match:
            continue
        try:
            doc = json.loads(data.decode('utf-8-sig'))
        except (ValueError, UnicodeDecodeError):
            continue
        if isinstance(doc, dict) and isinstance(doc.get('toneData'), dict):
            tones[match.group(1).lower()] = doc['toneData']
    return tones


def _chart_tones(arr, root, tones):
    """A chart's toneIterations as the editor's tones; returns {tone name: R+ tone id}."""
    iterations = sorted(((float(t.get('startTime', 0)), (t.get('toneId') or '').lower()) for t in root.findall('./toneIterations/toneIteration')), key=lambda r: r[0])
    if not iterations:
        return {}
    names, definitions = {}, {}
    for _, tone_id in iterations:
        if tone_id in names.values():
            continue
        data = tones.get(tone_id) or {}
        label = str(data.get('Name') or data.get('Key') or tone_id[:8])
        name, n = label, 2
        while name in names:
            name, n = f'{label} {n}', n + 1
        names[name] = tone_id
        if data:
            definitions[name] = copy.deepcopy(data)
    by_id = {v: k for k, v in names.items()}
    arr['tones'] = {'base': by_id[iterations[0][1]],
                    'changes': [{'time': t, 'name': by_id[i]} for t, i in iterations[1:]],
                    'definitions': definitions}
    return names


def _nearest_gap(times, t):
    i = bisect.bisect_left(times, t)
    return min((abs(times[j] - t) for j in (i - 1, i) if 0 <= j < len(times)), default=0)


def _chart_label(chart):
    """A short display name for a chart in the beat-map picker: not the full arr['name'] logic
    (that also folds in the chart's own instrument/role), just enough to tell charts apart."""
    name, match, root, data = chart
    source, kind, number = match.group(1), match.group(2), match.group(3)
    return re.sub(r'^Alt(?=[A-Z])', 'Alt ', kind) + (f' {number}' if number not in ('', '1') else '') + (' (UGC)' if source == 'UGC' else '')


def _chart_beats(chart):
    """A chart's song-shaped beat list (the same shape project['beats'] takes), via the same
    normalize + load_xml pipeline load_rplus_folder uses to build its own chosen grid."""
    name, match, root, data = chart
    normalized, chart_data, _ = _normalized_chart(root, name)
    if root.findtext('instrument') == 'Keyboard':
        # Same reason load_rplus_folder strips a keyboard grid chart's own notes before this
        # parse: only the beat map is wanted here, and piano fingering doesn't fit the fretted
        # schema load_xml validates.
        for level in normalized.findall('./levels/level'):
            for child_tag in ('notes', 'chords', 'anchors', 'handShapes'):
                child = level.find(child_tag)
                if child is not None:
                    child.set('count', '0')
                    for item in list(child):
                        child.remove(item)
        chart_data = ET.tostring(normalized, encoding='utf-8', xml_declaration=True)
    patched = chart_data.replace(b'<song version="' + root.get('version').encode() + b'"', b'<song version="7"', 1)
    return pack_io.load_xml(patched)['beats']


def _beat_map_clusters(charts):
    """Group every chart (Official and UGC alike) by mutual beat-map agreement
    (_beat_maps_agree against each cluster's founding chart). A chart with no ebeats of its own
    contributes nothing here and is left out, rather than collapsing with every other empty one."""
    times = [_beat_times(c[2], c[0]) for c in charts]
    clusters = []
    for i, t in enumerate(times):
        if not t:
            continue
        for cluster in clusters:
            if _beat_maps_agree(t, times[cluster[0]]):
                cluster.append(i)
                break
        else:
            clusters.append([i])
    return clusters, times


def _beat_map_choice(charts, grid, grid_times, grid_beats):
    """A picker-ready description of every distinct beat map found across `charts`, scored
    against the one actually chosen (`grid_times`/`grid_beats`) - or None when everyone agrees,
    which is the common case and costs nothing beyond the clustering pass itself."""
    clusters, _ = _beat_map_clusters(charts)
    if len(clusters) < 2:
        return None
    rows = []
    chosen_index = 0
    for cluster_index, indices in enumerate(clusters):
        is_chosen = any(charts[i] is grid for i in indices)
        if is_chosen:
            chosen_index = cluster_index
            chart_map = grid_beats
        else:
            # The representative's own normalized, offset-applied beats - the same map that
            # would actually be applied, not the raw ebeats clustering grouped by (which can
            # carry one extra beat before the chart's own offset pulls it before 0 s).
            chart_map = _chart_beats(charts[indices[0]])
        chart_times = [b['time'] for b in chart_map]
        compared = len(chart_times)
        agree = sum(1 for t in chart_times if _nearest_gap(grid_times, t) <= 0.02)
        drift_max = max((_nearest_gap(grid_times, t) for t in chart_times), default=0.0)
        rows.append({
            'charts': [_chart_label(charts[i]) for i in indices],
            'beats': compared,
            'agree': agree,
            'compared': compared,
            'driftMax': round(drift_max, 3),
            'map': chart_map,
        })
    return {'chosen': chosen_index, 'clusters': rows}


def load_rplus_folder(entries):
    """Editable project from an R+ song folder's root files."""
    metadata = {}
    if 'metadata.json' in entries:
        metadata = json.loads(entries['metadata.json'].decode('utf-8-sig'))
        if not isinstance(metadata, dict):
            raise pack_io.ProjectError('R+ metadata.json must be an object')
    charts = []
    for name, data in sorted(_root_xml(entries).items()):
        match = CHART_NAME.fullmatch(name)
        if not match:
            continue
        root = _parse(data)
        if root.tag != 'song' or root.get('version') not in RPLUS_VERSIONS:
            continue
        charts.append((name, match, root, data))
    if not charts:
        raise pack_io.ProjectError('No R+ song XML (Official_*.xml or UGC_*.xml, version 17/19) in this folder')
    # Select the majority map from non-HumStrum official charts and lyrics. HumStrum files can
    # carry a divergent map; UGC maps are commonly placeholders.
    official = [c for c in charts if c[1].group(1) == 'Official']
    non_humstrum = [c for c in official if c[1].group(2).lower() not in ('humstrum', 'altrhythm')]
    non_keyboard = [c for c in non_humstrum if c[2].findtext('instrument') != 'Keyboard']
    if non_keyboard:
        non_humstrum = non_keyboard
    candidates = non_humstrum or official or charts
    voters = non_humstrum or official or charts
    lyrics = sorted(n for n in entries if '/' not in n and n.lower().startswith('lyrics_') and n.lower().endswith('.xml'))
    lyric_roots = [(_parse(entries[name]), name) for name in lyrics]
    lyric_maps = [(_beat_times(root, name), name) for root, name in lyric_roots if root.tag == 'trueVocals']
    chart_maps = [(c, _beat_times(c[2], c[0])) for c in voters]
    order = {'lead': 0, 'bass': 1, 'rhythm': 2}
    grid = min(candidates, key=lambda c: (
        -sum(_beat_maps_agree(_beat_times(c[2], c[0]), times) for _, times in chart_maps)
        -sum(_beat_maps_agree(_beat_times(c[2], c[0]), times) for times, _ in lyric_maps),
        order.get(c[1].group(2).lower(), 3), c[0]))
    grid_normalized, grid_data, _ = _normalized_chart(grid[2], grid[0])
    if grid[2].findtext('instrument') == 'Keyboard':
        # This parse only feeds the song-level beat grid/duration below; the arrangement it
        # produces is discarded. A keyboard chart's note/finger encoding doesn't fit the
        # fretted-note schema load_xml validates (e.g. piano fingering runs 1-5, one past the
        # fretted left-hand range), so strip the notes rather than coerce them to fit.
        for level in grid_normalized.findall('./levels/level'):
            for child_tag in ('notes', 'chords', 'anchors', 'handShapes'):
                child = level.find(child_tag)
                if child is not None:
                    child.set('count', '0')
                    for item in list(child):
                        child.remove(item)
        grid_data = ET.tostring(grid_normalized, encoding='utf-8', xml_declaration=True)
    base = pack_io.load_xml(grid_data.replace(b'<song version="' + grid[2].get('version').encode() + b'"', b'<song version="7"', 1))
    project = copy.deepcopy(base)
    project['arrangements'] = []
    project.pop('import_warnings', None)
    warnings, charts_info, grid_times = [], [], [b['time'] for b in base['beats']]
    beat_map_choice = _beat_map_choice(charts, grid, grid_times, base['beats'])
    tones = _tone_files(entries)
    duration = float(base.get('duration', 0))
    for index, (name, match, root, data) in enumerate(charts):
        instrument = root.findtext('instrument', '')
        source, kind, number = match.group(1), match.group(2), match.group(3)
        normalized, normalized_data, offset = _normalized_chart(root, name)
        duration = max(duration, float(normalized.findtext('songLength', '0') or 0))
        events = []
        if instrument == 'Keyboard':
            arr, extras, events = _load_keyboard(normalized, name, index)
        else:
            patched = normalized_data.replace(b'<song version="' + root.get('version').encode() + b'"', b'<song version="7"', 1)
            # R+ also files 6-string HumStrum chord charts under its Bass instrument.
            strings = [int(n.get('string', 0)) for n in root.iter() if n.tag in ('note', 'chordNote')]
            bass = kind.lower().endswith('bass') or instrument == 'Bass' and max(strings, default=0) < 4
            if bass:
                # A bass HumStrum chart: the v7 reader routes by the arrangement name.
                patched = re.sub(rb'<arrangement>[^<]*</arrangement>', b'<arrangement>Bass</arrangement>', patched, count=1)
            tuning = root.find('tuning')
            layout = {'type': 'bass', 'stringCount': 4, 'basePitches': pack_io.BASES['bass'][:],
                      'tuning': [int(tuning.get(f'string{i}', 0)) if tuning is not None else 0 for i in range(4)]} if bass else None
            arr = pack_io.load_xml(patched, layout)['arrangements'][0]
            arr['id'] = f'rplus-{index}'
            arr['role'] = 'bass' if bass else 'rhythm' if kind.lower() in ('humstrum', 'rhythm', 'altrhythm') else 'lead'
            arr['name'] = kind + (f' ({instrument})' if instrument and instrument.lower() not in kind.lower() and kind.lower() == 'humstrum' else '')
            if kind.lower().startswith('alt'):
                arr['priority'] = 'alternative'
            extras = None
        # Lead 2, Alt Lead and so on; user-made charts are marked so they stand apart from official ones.
        arr['name'] = re.sub(r'^Alt(?=[A-Z])', 'Alt ', arr['name']) + (f' {number}' if number not in ('', '1') else '') + (' (UGC)' if source == 'UGC' else '')
        # Only a second official chart can disagree with the song's beat map; a UGC chart's own grid is
        # dropped (its notes are timed in seconds and keep their times).
        if source == 'Official' and grid[1].group(1) == 'Official':
            chart_grid = [float(b.get('time', 0)) for b in normalized.findall('./ebeats/ebeat')]
            drift = max((_nearest_gap(grid_times, t) for t in chart_grid), default=0)
            if drift > 0.02:
                warnings.append(f'{name} has a different beat map from {grid[0]} (beats up to {drift:.2f} s apart); the song uses the {grid[0]} beat map')
        if instrument != 'Keyboard':
            names = _chart_tones(arr, normalized, tones)
        arr['_rplus'] = {'file': name, 'source': source, 'kind': kind, 'number': number, 'arrangementId': match.group(4).lower(), 'revision': int(match.group(5)),
                         'instrument': instrument, 'version': root.get('version'), 'songId': root.findtext('songId', ''),
                         'offset': offset,
                         'toneIds': [t.get('toneId') for t in root.findall('./toneIterations/toneIteration')]}
        if instrument != 'Keyboard' and names:
            arr['_rplus']['toneNames'] = names
        # Who made it, as far as metadata.json says: creator type and an opaque profile id, no name.
        row = next((r for r in metadata.get('arrangementInfoList') or [] if isinstance(r, dict)
                    and str(r.get('arrangementId', '')).lower() == arr['_rplus']['arrangementId']), None)
        if row:
            arr['_rplus']['info'] = {k: row[k] for k in ('creatorType', 'profileId', 'publishedAt', 'rating', 'isVerified') if k in row}
        if extras is not None:
            arr['_rplus'].update(noteExtras=extras, events=events)
            signature = next((pack_io.key_signature_from_name(e['code'][4:]) for e in events if e.get('code', '').startswith('Key:')), None)
            if signature:
                arr['keySignature'] = signature
        arr['_rplus']['fingerprint'] = _fingerprint(arr)
        project['arrangements'].append(arr)
        charts_info.append(name)
    project['duration'] = duration
    for key, field in (('title', 'songName'), ('artist', 'artistName'), ('album', 'albumName'), ('year', 'songYear')):
        if metadata.get(field) not in (None, ''):
            project[key] = metadata[field]
    if lyrics:
        root = lyric_roots[0][0]
        if root.tag == 'trueVocals':
            vocals = pack_io.load_vocal_xml(_vocals(root), lyrics[0])
            for key in ('vocals', '_vocalXml'):
                project[key] = copy.deepcopy(vocals.get(key, [] if key == 'vocals' else ''))
    audio = [n for n in entries if '/' not in n and PurePosixPath(n).suffix.lower() in ('.wem', '.ogg', '.mp3', '.wav') and 'preview' not in n.lower()]
    stems = []
    if audio:
        stems = [{'id': 'full', 'file': 'audio.wem' if 'audio.wem' in audio else max(audio, key=lambda n: len(entries[n])), 'default': True, 'name': 'Full mix'}]
    else:
        warnings.append('This R+ folder has no audio.wem; select the song audio to play along')
    project['_pack'] = {'manifest': {'stems': stems},
                        'entries': {n: base64.b64encode(d).decode('ascii') for n, d in entries.items()}}
    project['_import'] = {'format': 'rplus-folder', 'songId': grid[2].findtext('songId', ''), 'grid': grid[0],
                          'charts': charts_info, 'files': sorted(entries),
                          'tones': sorted(n for n in entries if n.startswith('tone_') and n.endswith('.json'))}
    warnings.append('R+ tones, metadata.json and album art are kept unchanged; saving to the R+ folder only adds new chart files')
    project['import_warnings'] = warnings
    if beat_map_choice is not None:
        # Transient, like _gpaSync: a hint the client reads once right after import to offer a
        # choice, never persisted or re-validated on save.
        project['_rplusBeatMapChoice'] = beat_map_choice
    return pack_io.validate_project(project)


def _grid(project):
    beats = sorted(project.get('beats', []), key=lambda b: b['time'])
    if len(beats) < 2:
        raise pack_io.ProjectError('An R+ chart needs a beat map with at least two beats')
    # Bars are counted from 1 whatever the ebeat measure numbering starts at.
    times, bar_of, in_bar, bar, count = [], [], [], 0, 0
    for i, beat in enumerate(beats):
        if beat.get('measure', -1) >= 0 or i == 0:
            bar += 1
            count = 0
        times.append(float(beat['time']))
        bar_of.append(bar)
        in_bar.append(count)
        count += 1
    bar_len = {}
    for b, k in zip(bar_of, in_bar):
        bar_len[b] = max(bar_len.get(b, 0), k + 1)
    return beats, times, bar_of, in_bar, bar_len


def _locate(grid, t):
    _, times, bar_of, in_bar, _ = grid
    i = max(0, min(len(times) - 2, bisect.bisect_right(times, t + 1e-6) - 1))
    span = times[i + 1] - times[i]
    beat = i + (t - times[i]) / span if span > 0 else i
    if beat >= len(times) - 1:
        i = len(times) - 1
    # Positions on a 1/24-beat grid cover 32nds and triplets.
    whole = min(int(beat), len(times) - 1)
    frac = round((beat - whole) * 24) / 24
    if frac >= 1:
        whole, frac = min(whole + 1, len(times) - 1), 0.0
    return whole + frac, bar_of[whole], in_bar[whole] + frac


def _pieces(length):
    """Split a length in beats into notatable values: (base, dots, value, triplet)."""
    out, left = [], round(length * 24) / 24
    candidates = sorted([(b * 1.5, b, 1, False) for b in PLAIN[:-1]] + [(b, b, 0, False) for b in PLAIN] +
                        [(b, b, 0, True) for b in TRIPLET], key=lambda c: -c[0])
    while left > 1e-6 and len(out) < 16:
        value, base, dots, triplet = next((c for c in candidates if c[0] <= left + 1e-6), candidates[-1])
        out.append((base, dots, value, triplet))
        left = round((left - value) * 24) / 24
    return out


def _beats_for(grid, time, sustain):
    """R+ <beats>: tied pieces per bar; measure is the bar's ordinal from 1."""
    start, bar, position = _locate(grid, time)
    # Official sustains stop 1/8 beat (1/12 in triplets) short of the written value.
    exact = (_locate(grid, time + sustain)[0] - start) if sustain > 0 else 0.125
    plain, triplet = round((exact + 0.125) * 8) / 8, round((exact + 1 / 12) * 6) / 6
    written = triplet if abs(triplet - exact - 1 / 12) + 0.02 < abs(plain - exact - 0.125) else plain
    end = start + max(0.125, written)
    _, _, bar_of, in_bar, bar_len = grid
    out, cursor = [], start
    while cursor < end - 1e-6 and len(out) < 32:
        whole = min(int(cursor + 1e-6), len(bar_of) - 1)
        bar, offset = bar_of[whole], in_bar[whole] + (cursor - whole)
        room = bar_len.get(bar, 4) - offset
        if room <= 1e-6:
            room = 4
        pieces = _pieces(min(end - cursor, room))
        if not pieces:
            break
        for base, dots, value, triplet in pieces:
            out.append({'measure': bar, 'position': 1 + offset, 'length': base, 'dots': dots, 'triplet': triplet})
            offset += value
            cursor += value
    return out


def _fmt(value, places=3):
    return f'{value:.{places}f}'


def _copy_text(template, out, tag, default=''):
    el = ET.SubElement(out, tag)
    el.text = template.findtext(tag, default) if template is not None else default
    return el


def save_keyboard_xml(project, arrangement_id, *, template=None, song_id=None, arrangement_uuid=None, tone=GRAND_PIANO):
    """R+ keyboard chart (song XML version 19) for one keys arrangement.

    `template` is a parsed R+ chart from the same song (header fields and
    phrases); without one, fields come from the project.
    """
    arr = next((a for a in project['arrangements'] if a['id'] == arrangement_id), None)
    if arr is None or arr.get('type') != 'keys':
        raise pack_io.ProjectError('R+ keyboard export needs a keys arrangement')
    offset = _song_offset(template, 'R+ keyboard template') if template is not None else 0.0
    # Chord members are notes too (keys charts from Guitar Pro / MusicXML store them as chords).
    members = [{**n, 'time': n.get('time', c.get('time', 0))} for c in arr.get('chords', []) for n in c.get('notes', [])]
    notes = sorted((n for n in arr.get('notes', []) + members if 21 <= _pitch(n) <= 108), key=lambda n: (n['time'], _pitch(n)))
    if not notes:
        raise pack_io.ProjectError('The keys arrangement has no notes to export')
    grid = _grid(project)
    extras = arr.get('_rplus', {}).get('noteExtras', {})
    pitches = [_pitch(n) for n in notes]
    events = arr.get('_rplus', {}).get('events') or []
    key = next((e['code'][4:] for e in events if e['code'].startswith('Key:')), None) or pack_io.key_signature_name(arr.get('keySignature')) or guess_key(pitches)
    spelling = _key_spelling(key)
    keys = [p - 20 for p in pitches]
    lower, upper = max(1, min(keys)), min(88, max(keys))
    song = ET.Element('song', version='19')
    ET.SubElement(song, 'songId').text = song_id or (template.findtext('songId') if template is not None else str(uuid.uuid4()))
    ET.SubElement(song, 'arrangementId').text = arrangement_uuid or str(uuid.uuid4())
    ET.SubElement(song, 'title').text = str(project.get('title') or (template.findtext('title') if template is not None else 'Untitled'))
    ET.SubElement(song, 'arrangement').text = 'Keyboard'
    ET.SubElement(song, 'keyLower').text = str(lower)
    ET.SubElement(song, 'keyUpper').text = str(upper)
    ET.SubElement(song, 'instrument').text = 'Keyboard'
    ET.SubElement(song, 'offset').text = '0.000'
    ET.SubElement(song, 'centOffset').text = '0'
    ET.SubElement(song, 'songLength').text = _fmt(max(project.get('duration', 0), notes[-1]['time'] + notes[-1].get('sustain', 0)))
    _copy_text(template, song, 'internalName')
    _copy_text(template, song, 'songNameSort', str(project.get('title', '')).lower())
    try:
        start_beat = float(template.findtext('startBeat', '0') or 0) + offset if template is not None else (project.get('beats') or [{'time': 0}])[0]['time']
    except ValueError as exc:
        raise pack_io.ProjectError('R+ keyboard template has an invalid start beat') from exc
    ET.SubElement(song, 'startBeat').text = _fmt(start_beat)
    _copy_text(template, song, 'averageTempo', '0.000')
    _copy_text(template, song, 'wavefilepath')
    ET.SubElement(song, 'tuning', {f'string{i}': '0' for i in range(6)})
    ET.SubElement(song, 'capo').text = '0'
    ET.SubElement(song, 'artistName').text = str(project.get('artist', ''))
    _copy_text(template, song, 'artistNameSort', str(project.get('artist', '')))
    ET.SubElement(song, 'albumName').text = str(project.get('album', ''))
    _copy_text(template, song, 'albumNameSort', str(project.get('album', '')))
    ET.SubElement(song, 'albumYear').text = str(pack_io.song_year(project.get('year')) or '')
    ET.SubElement(song, 'albumArt')
    ET.SubElement(song, 'lastConversionDateTime').text = datetime.datetime.now().strftime('%m-%d-%y %H:%M')
    ET.SubElement(song, 'instrumentTone', id='00000000-0000-0000-0000-000000000000')
    # Phrases: the song's own (from the template chart), single difficulty.
    if template is not None and template.find('phrases') is not None:
        phrases = copy.deepcopy(template.find('phrases'))
        for phrase in phrases:
            phrase.set('maxDifficulty', '0')
        iterations = copy.deepcopy(template.find('phraseIterations'))
        for iteration in iterations:
            try:
                time = float(iteration.get('time', '0')) + offset
            except ValueError as exc:
                raise pack_io.ProjectError('R+ keyboard template has an invalid phrase time') from exc
            if not math.isfinite(time):
                raise pack_io.ProjectError('R+ keyboard template has an invalid phrase time')
            iteration.set('time', _fmt(time))
    else:
        rows = sorted(arr.get('phrases') or [{'name': s.get('name', 'A'), 'time': s.get('time', s.get('startTime', 0))} for s in project.get('sections', [])] or [{'name': 'A', 'time': 0}], key=lambda p: p['time'])
        names = ['default'] + sorted({p['name'] for p in rows} - {'default', 'END'}) + ['END']
        phrases = ET.Element('phrases')
        for i, phrase_name in enumerate(names):
            ET.SubElement(phrases, 'phrase', color=str(i), disparity='0', ignore='0', maxDifficulty='0', name=phrase_name, solo='0')
        iterations = ET.Element('phraseIterations')
        for i, row in enumerate(rows):
            ET.SubElement(iterations, 'phraseIteration', phraseId=str(names.index(row['name']) if row['name'] in names else 0), time=_fmt(row['time']), variation=str(i + 1))
    phrases.set('count', str(len(phrases)))
    iterations.set('count', str(len(iterations)))
    song.append(phrases)
    song.append(iterations)
    ET.SubElement(song, 'phraseProperties', count='0')
    ET.SubElement(song, 'chordTemplates', count='0')
    ebeats = ET.SubElement(song, 'ebeats', count=str(len(grid[0])))
    for i, beat in enumerate(grid[0]):
        attrib = {'time': _fmt(beat['time']), 'measure': str(int(beat.get('measure', -1)))}
        if i + 1 < len(grid[0]):
            attrib['bpm'] = _fmt(60 / max(1e-6, grid[0][i + 1]['time'] - beat['time']))
        if i == 0:
            attrib['mainTempoLock'] = '1'
        ET.SubElement(ebeats, 'ebeat', attrib)
    sections = ET.SubElement(song, 'sections')
    numbers = {}
    for section in sorted(project.get('sections', []), key=lambda s: s.get('time', s.get('startTime', 0))):
        name = section.get('name', 'verse')
        numbers[name] = numbers.get(name, 0) + 1
        ET.SubElement(sections, 'section', name=name, number=str(section.get('number', numbers[name])), startTime=_fmt(section.get('time', section.get('startTime', 0))))
    sections.set('count', str(len(sections)))
    event_rows = [e for e in events if not e['code'].startswith(('Key:', 'tone'))]
    event_rows += [{'time': 0.0, 'code': 'Key:' + key}] if key else []
    event_rows += [{'time': 0.0, 'code': tone['event']}]
    events_el = ET.SubElement(song, 'events', count=str(len(event_rows)))
    for event in sorted(event_rows, key=lambda e: e['time']):
        ET.SubElement(events_el, 'event', code=event['code'], time=_fmt(event['time']))
    levels = ET.SubElement(song, 'levels', count='1')
    level = ET.SubElement(levels, 'level', difficulty='0')
    ET.SubElement(level, 'chords', count='0')
    ET.SubElement(level, 'handShapes', count='0')
    notes_el = ET.SubElement(level, 'notes', count=str(len(notes)))
    tuplets = {}
    for note, pitch in zip(notes, pitches):
        hand = note.get('hand') or ('rh' if pitch >= 60 else 'lh')
        staff = '1' if hand == 'rh' else '0'
        source = extras.get(note.get('id'), {})
        original = source.get('attrib', {})
        unchanged = original and int(original.get('midi', -1)) == pitch and abs(float(original.get('time', -1)) - note['time']) < 5e-4 and \
            abs(float(original.get('sustain', 0)) - note.get('sustain', 0)) < 5e-4 and original.get('staff') == staff
        if unchanged:
            element = ET.SubElement(notes_el, 'note', original)
            for child in source.get('children', []):
                element.append(ET.fromstring(child))
            continue
        attrib = {'clef': 'treble' if staff == '1' else 'bass', 'fret': str(pitch - 20)}
        finger = original.get('rightHand' if staff == '1' else 'leftHand') if original and int(original.get('midi', -1)) == pitch else None
        if finger:
            attrib['rightHand' if staff == '1' else 'leftHand'] = finger
        attrib.update(midi=str(pitch), name=spelling[pitch % 12], octave=str(pitch // 12 - 1), staff=staff, string='0',
                      sustain=_fmt(note.get('sustain', 0)), time=_fmt(note['time']))
        element = ET.SubElement(notes_el, 'note', attrib)
        beats_el = ET.SubElement(element, 'beats')
        for piece in _beats_for(grid, note['time'], note.get('sustain', 0)):
            ET.SubElement(beats_el, 'beat', dots=str(piece['dots']), length=f"{piece['length']:.4f}", measure=str(piece['measure']), position=f"{piece['position']:.4f}")
            if piece['triplet']:
                group = (piece['measure'], staff, int((piece['position'] - 1) // (piece['length'] * 3)))
                tuplets.setdefault(group, []).append(piece['position'])
    anchors = ET.SubElement(level, 'anchors')
    starts = sorted(float(it.get('time', 0)) for it in iterations)
    note_times = [n['time'] for n in notes]
    for i, start in enumerate(starts):
        stop = starts[i + 1] if i + 1 < len(starts) else float('inf')
        first = bisect.bisect_left(note_times, start)
        if i == 0 or first < len(note_times) and note_times[first] < stop:
            ET.SubElement(anchors, 'anchor', fret=str(lower), time=_fmt(start), width=f'{upper - lower + 1:.1f}')
    anchors.set('count', str(len(anchors)))
    tuplets_el = ET.SubElement(level, 'tuplets', count=str(len(tuplets)))
    for (measure, staff, _), positions in sorted(tuplets.items()):
        ET.SubElement(tuplets_el, 'tuplet', measure=str(measure), positionEnd=f'{max(positions):.4f}', positionStart=f'{min(positions):.4f}', staff=staff, type='3')
    tones = ET.SubElement(song, 'toneIterations', count='1')
    ET.SubElement(tones, 'toneIteration', startTime='0.000', toneId=tone['id'])
    ET.indent(song, space='    ')
    return ET.tostring(song, encoding='utf-8', xml_declaration=True)


def keyboard_tone_json(tone=GRAND_PIANO):
    """Tone preset file for a keyboard chart (identifiers only)."""
    return json.dumps({'toneId': tone['id'], 'approvalStatus': 'Approved',
                       'toneData': {'Key': tone['key'], 'Name': tone['key'],
                                    'GearList': {'Synth': {'Key': tone['synth'], 'Type': 'Synth', 'SlotName': 'Synth'}},
                                    'SortOrder': 0.0, 'Instruments': ['Keyboard'], 'ToneMainUID': tone['id'].upper(), 'ToneVariant': 'Main'},
                       'fbrToneData': None}, indent=2).encode('utf-8')


def _existing(project):
    return set(project.get('_pack', {}).get('entries', {})) | set(project.get('_import', {}).get('files', []))


def _template(project):
    grid = project.get('_import', {}).get('grid')
    data = project.get('_pack', {}).get('entries', {}).get(grid) if grid else None
    return _parse(base64.b64decode(data)) if data else None


def _write_tone_iterations(root, arr, source):
    """R+ charts name their tones by id; map the editor's tone names back to the ids they came from."""
    ids = (source.get('toneNames') or {})
    tones = arr.get('tones') or {}
    rows = [(0.0, tones.get('base'))] + [(float(c.get('time', 0)), c.get('name')) for c in tones.get('changes') or []]
    rows = [(t, ids[n]) for t, n in rows if n in ids]
    if not rows:
        return
    for old in root.findall('toneIterations'):
        root.remove(old)
    element = ET.SubElement(root, 'toneIterations', count=str(len(rows)))
    for t, tone_id in rows:
        ET.SubElement(element, 'toneIteration', startTime=_fmt(t), toneId=tone_id)


def rplus_folder(project):
    """New files for the song's R+ folder: changed/new charts only.

    Returns ({name: bytes}, report). Existing names are never reused, so
    writing the files into the source folder cannot replace an original.
    """
    pack_io.validate_project(project)
    existing, files, written, skipped = _existing(project), {}, [], []
    template = _template(project)
    song_id = project.get('_import', {}).get('songId') or (template.findtext('songId') if template is not None else None) or str(uuid.uuid4())

    def free_name(kind, arrangement_uuid, revision, prefix='Official', number='1'):
        name = f'{prefix}_{kind}{number or 1}_{arrangement_uuid}_v{revision}.xml'
        while name in existing or name in files:
            revision += 1
            name = f'{prefix}_{kind}{number or 1}_{arrangement_uuid}_v{revision}.xml'
        return name

    for arr in project['arrangements']:
        if arr.get('hidden') is True:
            continue
        source = arr.get('_rplus') or {}
        changed = not source or source.get('fingerprint') != _fingerprint(arr)
        if not changed:
            continue
        # New arrangements get a stable id derived from the song, so saving twice adds a revision.
        arrangement_uuid = source.get('arrangementId') or str(uuid.uuid5(uuid.UUID(song_id) if re.fullmatch(r'[0-9a-fA-F-]{36}', song_id) else uuid.NAMESPACE_URL, 'oce:' + arr['id']))
        revision = source.get('revision', 0) + 1
        if arr.get('type') == 'keys':
            name = free_name('Keyboard', arrangement_uuid, revision)
            files[name] = (save_keyboard_xml(project, arr['id'], template=template, song_id=song_id, arrangement_uuid=arrangement_uuid))
            if f"tone_{GRAND_PIANO['id']}.json" not in existing:
                files[f"tone_{GRAND_PIANO['id']}.json"] = keyboard_tone_json()
        elif arr.get('type') in ('guitar', 'bass'):
            kind = source.get('kind') or {'bass': 'Bass', 'rhythm': 'Rhythm'}.get(pack_io.arrangement_role(arr), 'Lead')
            root = ET.fromstring(pack_io.save_xml(copy.deepcopy(project), arr['id']))
            root.set('version', '19')
            for tag, value in (('songId', song_id), ('arrangementId', arrangement_uuid)):
                el = root.find(tag)
                if el is None:
                    el = ET.Element(tag)
                    root.insert(0 if tag == 'songId' else 1, el)
                el.text = value
            offset = root.find('offset')
            if offset is None:
                offset = ET.SubElement(root, 'offset')
            offset.text = '0.000'
            _write_tone_iterations(root, arr, source)
            # An edited chart keeps its source (Official or UGC) and number; new charts are Official, number 1.
            name = free_name(kind, arrangement_uuid, revision, source.get('source', 'Official'), source.get('number') or '1')
            files[name] = ET.tostring(root, encoding='utf-8', xml_declaration=True)
        else:
            skipped.append({'id': arr['id'], 'name': arr.get('name'), 'reason': f"R+ has no {arr.get('type')} chart type"})
            continue
        written.append({'id': arr['id'], 'name': arr.get('name'), 'file': name, 'arrangementId': arrangement_uuid})
    if not written:
        raise pack_io.ProjectError('Nothing to add: no chart changed since the R+ folder was opened')
    rows = [{'arrangementId': w['arrangementId'], 'arrangementName': 'Keyboard' if w['file'].startswith('Official_Keyboard') else w['file'].split('_')[1].rstrip('0123456789'),
             'file': w['file']} for w in written]
    warnings = ['metadata.json was not changed. R+ lists arrangements in its arrangementInfoList; add rows for the new charts if your R+ loader needs them.']
    if any(w['file'].startswith('Official_Keyboard') is False for w in written):
        warnings.append('Edited guitar/bass charts are written from the editor\'s RS2014 writer with an R+ header; check them in your R+ loader.')
    report = {'version': 1, 'format': 'rplus-folder', 'written': written, 'skipped': skipped,
              'arrangementInfo': rows, 'warnings': warnings}
    return files, report
