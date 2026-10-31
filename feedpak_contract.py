"""Local FeedPak 1.25 schema/pointer boundary, independent of playback engines.

Published schemas are vendored under assets/feedpak-schemas with their MIT license.
No schema, URI or realization is fetched. Unknown properties and unindexed files
are not interpreted, rewritten or rejected. Media decoding is outside this gate.
"""
from __future__ import annotations

import functools
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
from urllib.parse import urlsplit

SCHEMA_ROOT = Path(__file__).with_name('assets') / 'feedpak-schemas'
SIDE_SCHEMAS = {
    'lyrics': 'lyrics', 'vocal_pitch': 'vocal-pitch',
    'vocal_pitch_contour': 'vocal-pitch-contour', 'song_timeline': 'song-timeline',
    'drum_tab': 'drum-tab', 'keys': 'keys', 'harmony': 'harmony', 'rigs': 'rigs',
}


class ContractError(ValueError):
    pass


def status():
    try:
        from jsonschema import Draft202012Validator
        installed = importlib.metadata.version('jsonschema')
        numbers = tuple(int(part) for part in installed.split('.')[:2])
        if not (numbers >= (4, 18) and numbers[0] < 5):
            raise ValueError('installed jsonschema version ' + installed)
        if not all((SCHEMA_ROOT / (kind + '.schema.json')).is_file()
                   for kind in {'manifest', 'arrangement', 'notation', 'lesson'} | set(SIDE_SCHEMAS.values())):
            raise ValueError('bundled FeedPak schemas are incomplete')
        return {'available': True, 'schemaVersion': '1.25.0', 'engine': 'jsonschema Draft202012Validator',
                'engineVersion': installed, 'requiredVersion': '>=4.18,<5',
                'notationOnly': 'Source notation is retained read-only; editable wire events are not inferred.'}
    except (ImportError, importlib.metadata.PackageNotFoundError, ValueError) as exc:
        return {'available': False, 'schemaVersion': '1.25.0', 'error':
                'FeedPak validation requires jsonschema>=4.18,<5 and its bundled schemas. '
                'FeedBack installs it from the plugin requirements.txt; for the standalone editor install requirements-standalone.txt. ' + str(exc)}


@functools.lru_cache(maxsize=12)
def _validator(kind):
    capability = status()
    if not capability['available']:
        raise ContractError(capability['error'])
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:
        raise ContractError(status()['error']) from exc
    schema = json.loads((SCHEMA_ROOT / (kind + '.schema.json')).read_text(encoding='utf-8'))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _schema(document, kind, label):
    error = next(_validator(kind).iter_errors(document), None)
    if error is not None:
        location = '/'.join(str(part) for part in error.absolute_path) or '<root>'
        raise ContractError(f'{label}: {location}: {error.message}')


def _unique(rows, field, label):
    values = [row[field] for row in rows if field in row]
    if len(values) != len(set(values)):
        raise ContractError(f'{label}: duplicate {field} values are ambiguous')


def _ordered(rows, key, label):
    times = [row[key] for row in rows]
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) or
           not math.isfinite(value) or value < 0 for value in times):
        raise ContractError(f'{label}: {key} must be a finite nonnegative number')
    if times != sorted(times):
        raise ContractError(f'{label}: {key} must be in non-descending order')


def validate(manifest, entries, decode_json, safe_path, check_tree):
    """Validate every present known stream, leaving absent/unknown streams alone.

    Known incompatible object-sidefile versions are refused explicitly, rather
    than interpreting a future incompatible schema as version 1. Package minor
    and patch versions are unrestricted; higher format majors are refused.
    Returns observations only; neither manifest nor original bytes are mutated.
    """
    check_tree(manifest)
    _schema(manifest, 'manifest', 'manifest.yaml')
    declared = manifest.get('feedpak_version', '1.0.0')
    if int(declared.split('.')[0]) != 1:
        raise ContractError('Unsupported FeedPak format major: ' + declared)
    _unique(manifest['arrangements'], 'id', 'arrangements')
    _unique(manifest['stems'], 'id', 'stems')
    _unique(manifest.get('lyric_tracks', []), 'id', 'lyric_tracks')
    documents = {}
    checked = []
    warnings = []

    def member(name, label):
        name = safe_path(name)
        if name not in entries:
            raise ContractError(f'{label}: referenced package member is missing: {name}')
        return name

    def structured(name, kind, label):
        name = member(name, label)
        if not name.lower().endswith(('.json', '.jsonc')):
            raise ContractError(f'{label}: structured data requires .json or .jsonc: {name}')
        if name not in documents:
            try:
                documents[name] = decode_json(entries[name], name)
            except (ValueError, UnicodeError, RecursionError) as exc:
                raise ContractError(f'{name}: invalid JSON: {exc}') from exc
            check_tree(documents[name])
        doc = documents[name]
        _schema(doc, kind, name)
        if kind not in ('lyrics', 'arrangement') and doc.get('version') != 1:
            raise ContractError(f'{name}: unsupported {kind} schema version {doc.get("version")}; original source is not modified')
        checked.append({'path': name, 'schema': kind, 'sha256': hashlib.sha256(entries[name]).hexdigest()})
        return doc

    for index, entry in enumerate(manifest['arrangements']):
        label = f'arrangements[{index}]'
        if entry.get('drum_tab') and (entry.get('file') or entry.get('notation')):
            raise ContractError(label + ': a drum part cannot also carry file or notation')
        if entry.get('type') == 'drums' and not entry.get('drum_tab'):
            raise ContractError(label + ': type drums requires its drum_tab pointer')
        for field, kind in [('file', 'arrangement'), ('notation', 'notation'), ('drum_tab', 'drum-tab')]:
            if field in entry:
                structured(entry[field], kind, label + '.' + field)
    for index, stem in enumerate(manifest['stems']):
        member(stem['file'], f'stems[{index}].file')
    for field, kind in SIDE_SCHEMAS.items():
        if field in manifest:
            structured(manifest[field], kind, field)
    for index, track in enumerate(manifest.get('lyric_tracks', [])):
        structured(track['file'], 'lyrics', f'lyric_tracks[{index}].file')
        if 'stem' in track and track['stem'] not in {stem['id'] for stem in manifest['stems']}:
            raise ContractError(f'lyric_tracks[{index}].stem: unknown stem id {track["stem"]}')
    for field in ('cover', 'preview'):
        if field in manifest:
            member(manifest[field], field)
    if 'cover' in manifest and Path(manifest['cover']).suffix.lower() not in ('.png', '.jpg', '.jpeg'):
        raise ContractError('cover: FeedPak cover art must be JPEG or PNG')

    for row in checked:
        name, kind = row['path'], row['schema']
        doc = documents[name]
        if kind in ('song-timeline', 'arrangement'):
            for field in ('tempos', 'time_signatures', 'beats', 'sections'):
                if field in doc:
                    _ordered(doc[field], 'time', name + '.' + field)
        if kind == 'drum-tab':
            _ordered(doc['hits'], 't', name + '.hits')
            _unique(doc.get('kit', []), 'id', name + '.kit')
        if kind in ('keys', 'harmony'):
            _ordered(doc['events'], 't', name + '.events')
        if kind in ('lyrics', 'vocal-pitch', 'vocal-pitch-contour'):
            rows = doc if kind == 'lyrics' else doc['notes' if kind == 'vocal-pitch' else 'samples']
            _ordered(rows, 't', name)
        if kind == 'notation':
            staff_ids = {staff['id'] for staff in doc['staves']}
            _unique(doc['staves'], 'id', name + '.staves')
            _ordered(doc['measures'], 't', name + '.measures')
            numerator = 4
            for index, measure in enumerate(doc['measures']):
                if measure['idx'] == 0 and index != 0:
                    raise ContractError(name + ': measure idx 0 is reserved for the opening pickup')
                numerator = measure.get('ts', [numerator, 4])[0]
                if 'beat_groups' in measure and sum(measure['beat_groups']) != numerator:
                    raise ContractError(name + ': beat_groups must sum to the active time-signature numerator')
                if not set(measure.get('staves', {})) <= staff_ids:
                    raise ContractError(name + ': measure references an undefined staff id')
    if 'rigs' in manifest:
        library = documents[manifest['rigs']]
        _unique(library['rigs'], 'id', 'rigs')
        for rig in library['rigs']:
            _unique(rig['blocks'], 'id', 'rigs ' + rig['id'] + '.blocks')
            block_ids = {block['id'] for block in rig['blocks'] if 'id' in block}
            if 'graph' in rig:
                graph = rig['graph']
                if not set(graph['nodes']) <= block_ids | {'input', 'output'}:
                    raise ContractError(manifest['rigs'] + ': graph references an undefined block id')
                if any(node not in graph['nodes'] for edge in graph['edges'] for node in edge):
                    raise ContractError(manifest['rigs'] + ': graph edge references an undefined node')
            for index, block in enumerate(rig['blocks']):
                if 'intent' not in block and not block.get('realizations'):
                    raise ContractError(manifest['rigs'] + ': each block requires intent or a realization')
                if block.get('role') == 'source' and 'graph' not in rig and index != 0:
                    raise ContractError(manifest['rigs'] + ': source must be the head block')
                for lane in block.get('automation', []):
                    _ordered(lane['points'], 't', manifest['rigs'] + '.automation')
                for realization in block.get('realizations', []):
                    if realization['engine'] == 'soundfont' and (block.get('role') != 'source' or 'ref' not in realization):
                        raise ContractError(manifest['rigs'] + ': soundfont requires a source block and ref')
                    if 'state' in realization and not any(key in block for key in ('intent', 'params')) and 'params' not in realization:
                        raise ContractError(manifest['rigs'] + ': plugin state cannot be the only representation')
                    if realization['engine'] in ('nam', 'ir', 'soundfont') and 'ref' in realization:
                        ref = realization['ref']
                        # URI references remain references: never fetch them.
                        if not urlsplit(ref).scheme:
                            safe_path(ref)
                            if ref not in entries:
                                # This editor does not render NAM/IR/SF2 assets.
                                # §7.9 forbids failing the song when no realization
                                # can be rendered; retain the authored reference.
                                warnings.append('Rig asset ' + ref + ' is not present; the authored reference is retained, and this editor does not load that realization.')
                            elif 'sha256' in realization and hashlib.sha256(entries[ref]).hexdigest().lower() != realization['sha256'].lower():
                                raise ContractError(manifest['rigs'] + ': local realization asset SHA-256 does not match')
                        elif len(urlsplit(ref).scheme) == 1 or '\\' in ref:
                            raise ContractError('rig realization.ref: drive/UNC paths are not package assets or URIs')
    for index, lesson in enumerate(manifest.get('lessons', [])):
        # A lesson that does not match the schema is kept unchanged; FeedBack judges it, not OCE.
        try:
            structured(lesson['file'], 'lesson', f'lessons[{index}].file')
        except ContractError as exc:
            warnings.append(f"Lesson {lesson.get('id', index)} does not match the lesson schema ({exc}); the file is kept unchanged.")
    rig_ids = {rig['id'] for rig in documents.get(manifest.get('rigs'), {}).get('rigs', [])}
    bindings = [entry['tones'] for entry in manifest['arrangements'] if 'tones' in entry]
    if 'drum_tones' in manifest:
        bindings.append(manifest['drum_tones'])
    bindings.extend(doc['tones'] for name, doc in documents.items()
                    if isinstance(doc, dict) and 'tones' in doc)
    for binding in bindings:
        changes = binding.get('changes', [])
        if not isinstance(changes, list) or any(not isinstance(change, dict) or 't' not in change for change in changes):
            raise ContractError('tones.changes: expected objects with a numeric t')
        times = [change['t'] for change in changes]
        if any(not isinstance(value, (int, float)) or isinstance(value, bool) or
                not math.isfinite(value) or value < 0 for value in times):
            raise ContractError('tones.changes: t must be a finite nonnegative number')
        # A missing name or an out-of-order t is lenient (warn, keep as authored): a reader that
        # cannot resolve a tone's display name or relies on strict ordering falls back gracefully,
        # so there is no playback-breaking reason to refuse the whole pack over it.
        if any(not isinstance(change.get('name'), str) for change in changes):
            warnings.append('tones.changes: a tone change has no name; the authored object is retained unchanged')
        if times != sorted(times):
            warnings.append('tones.changes: t is not in non-descending order; the authored order is retained unchanged')
        refs = ([binding['base_rig']] if 'base_rig' in binding else []) + [
            change['rig'] for change in changes if 'rig' in change]
        # An unresolved rig id is lenient too: §7.9 already requires a reader with no matching
        # rig to fall back to GM/no sound rather than refuse the song, so refusing the whole pack
        # here over a dangling reference (e.g. to a rig stripped or renamed upstream) is stricter
        # than the spec's own playback behavior requires.
        for ref in refs:
            if not isinstance(ref, str) or ref not in rig_ids:
                warnings.append('tones: a rig binding refers to a missing rig id; the authored binding is retained unchanged')
    return {'specificationVersion': '1.25.0', 'declaredVersion': declared,
            'streams': checked, 'unknownDataPreserved': True,
            'warnings': warnings, 'mediaDecoded': False, 'playbackConformance': False}
