"""Actual parser/writer boundaries against the complete vendored v1.25 schemas."""
import base64
import copy
import io
import json
from pathlib import Path
import sys
import zipfile

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p
from test_pack_io import archive, project


def members(data):
    with zipfile.ZipFile(io.BytesIO(data)) as pack:
        return {name: pack.read(name) for name in pack.namelist()}


def fixture():
    return members(p.save_feedpak(project()))


def manifest(entries):
    return yaml.safe_load(entries['manifest.yaml'])


def index(entries, doc):
    entries['manifest.yaml'] = yaml.safe_dump(doc, sort_keys=False).encode()
    return entries


def optional(entries, field, value, extension='.json'):
    doc = manifest(entries)
    name = 'custom/' + field + extension
    doc[field] = name
    entries[name] = json.dumps(value).encode()
    return index(entries, doc)


@pytest.mark.parametrize('suffix', ['', '.json', '.JSON'])
def test_comments_in_strict_json_are_not_silently_consumed(suffix):
    with pytest.raises(ValueError):
        p._decode_json(b'{"x": 1 // strict JSON cannot have comments\n}', 'chart' + suffix)


def test_jsonc_preserves_tokens_and_comment_markers_inside_strings():
    assert p._decode_json(b'{"url":"https://x/a/*b*/",/* block */"x":1//line\n}', 'chart.jsonc') == {'url':'https://x/a/*b*/','x':1}
    with pytest.raises(ValueError):
        p._decode_json(b'[1/* tokens cannot join */2]', 'chart.jsonc')


@pytest.mark.parametrize('source', [b'{"x":1,}', b'[1,]', b'{"x":NaN}', b'{"x":Infinity}', b'{"x":1/* unterminated}'])
@pytest.mark.parametrize('filename', ['x.json', 'x.jsonc'])
def test_non_json_syntax_is_rejected_for_both_extensions(source, filename):
    with pytest.raises(ValueError):
        p._decode_json(source, filename)


def test_jsonc_filename_propagates_to_chart_and_all_optional_streams():
    entries = fixture();doc = manifest(entries)
    old = doc['arrangements'][0]['file'];name = 'score/not-conventional.jsonc'
    entries[name] = b'/* source score */' + entries.pop(old)
    doc['arrangements'][0]['file'] = name
    index(entries, doc)
    optional(entries, 'keys', {'version':1, 'events':[{'t':0,'key':'Em','scale':'natural_minor','future':{'x':9}}]}, '.jsonc')
    entries['custom/keys.jsonc'] = b'// musical key, not a piano chart\n' + entries['custom/keys.jsonc']
    imported = p.load_feedpak(archive(entries))
    exported = members(p.save_feedpak(imported))
    assert exported['custom/keys.jsonc'] == entries['custom/keys.jsonc']
    assert imported['arrangements'][0]['notes'][0]['fret'] == 3
    assert any(row['path'] == name for row in imported['_feedpakValidation']['streams'])


@pytest.mark.parametrize('field,value', [
    ('lyrics', [{'t':0,'d':.2,'w':'Own'}]),
    ('vocal_pitch', {'version':1,'notes':[{'t':0,'d':.2,'midi':64}]}),
    ('vocal_pitch_contour', {'version':1,'samples':[{'t':0,'hz':220.5}]}),
    ('keys', {'version':1,'events':[{'t':0,'key':'Em','scale':'natural_minor'}]}),
    ('harmony', {'version':1,'events':[{'t':0,'root':None,'future':'retained'}]}),
    ('rigs', {'version':1,'rigs':[{'id':'own','blocks':[{'intent':{'future':True},'role':'future-engine-role'}]}]}),
])
def test_all_present_optional_streams_validate_and_preserve_unknowns(field, value):
    entries = optional(fixture(), field, value)
    name = manifest(entries)[field]
    imported = p.load_feedpak(archive(entries))
    exported = members(p.save_feedpak(imported))
    assert exported[name] == entries[name]
    assert manifest(exported)[field] == name


@pytest.mark.parametrize('field,value', [
    ('lyrics', [{'t':0,'d':.2,'w':15}]),
    ('vocal_pitch', {'version':1,'notes':[{'t':0,'d':.2,'midi':128}]}),
    ('vocal_pitch_contour', {'version':1,'samples':[{'hz':220.5}]}),
    ('keys', {'version':1,'events':[{'t':0}]}),
    ('harmony', {'version':1,'events':[{'root':None}]}),
    ('rigs', {'version':1,'rigs':[{'id':'own','blocks':[{}]}]}),
])
def test_invalid_optional_stream_is_not_hidden_by_opaque_passthrough(field, value):
    with pytest.raises(p.ProjectError, match='custom/'):
        p.load_feedpak(archive(optional(fixture(), field, value)))


def test_present_stream_references_are_required_including_alternate_lyrics_and_assets():
    for field in ['keys','harmony','vocal_pitch_contour','preview','cover']:
        entries = fixture();doc = manifest(entries);doc[field] = 'absent/file.json'
        with pytest.raises(p.ProjectError, match='missing'):
            p.load_feedpak(archive(index(entries, doc)))
    entries = fixture();doc = manifest(entries)
    doc['lyric_tracks'] = [{'id':'en','file':'absent.json','language':'en','kind':'future-kind'}]
    with pytest.raises(p.ProjectError, match='missing'):
        p.load_feedpak(archive(index(entries, doc)))


@pytest.mark.parametrize('path', ['../outside.json', '/absolute.json', 'C:drive.json', 'a\\b.json', 'a//b.json'])
def test_every_known_pointer_obeys_safe_package_paths(path):
    entries = fixture();doc = manifest(entries);doc['harmony'] = path
    with pytest.raises(p.ProjectError):
        p.load_feedpak(archive(index(entries, doc)))


def test_format_semver_and_sidefile_version_are_distinct():
    entries = fixture();doc = manifest(entries);doc['feedpak_version'] = '1.999.999-future+metadata'
    imported = p.load_feedpak(archive(index(entries, doc)))
    assert imported['_feedpakValidation']['declaredVersion'] == '1.999.999-future+metadata'
    for value in ['1.0', '1.0.0-01', '2.0.0']:
        broken = copy.deepcopy(entries);bad = manifest(broken);bad['feedpak_version'] = value
        with pytest.raises(p.ProjectError):
            p.load_feedpak(archive(index(broken, bad)))
    with pytest.raises(p.ProjectError, match='schema version 2'):
        p.load_feedpak(archive(optional(fixture(), 'keys', {'version':2,'events':[]})))


def notation_fixture():
    entries = fixture();doc = manifest(entries)
    doc['arrangements'] = [{'id':'piano','name':'Source score','type':'piano','notation':'source/score.jsonc','futureEntry':{'kept':True}}]
    entries['source/score.jsonc'] = b'/* score comments */\n' + json.dumps({'version':1,'instrument':'piano','staves':[{'id':'rh','clef':'G2'}],
        'measures':[{'idx':0,'pickup':True,'t':0,'ts':[3,4],'beat_groups':[1,2],
        'staves':{'rh':{'voices':[{'v':1,'beats':[{'t':0,'dur':4,'notes':[{'midi':64,'futureNote':'kept'}]}]}]}}}]}).encode()
    return index(entries, doc)


def test_notation_only_is_a_read_only_source_not_an_invented_empty_guitar(monkeypatch):
    # Without FeedBack core's notes-from-notation rule the part stays read-only.
    monkeypatch.setattr(p, 'core_notation', lambda: None)
    entries = notation_fixture();imported = p.load_feedpak(archive(entries));row = imported['arrangements'][0]
    assert row['_notationOnly'] is True and row['readOnly'] is True and row['type'] == 'notation'
    assert 'notes' not in row and 'tuning' not in row and 'basePitches' not in row
    exported = members(p.save_feedpak(imported))
    assert exported['source/score.jsonc'] == entries['source/score.jsonc']
    assert manifest(exported)['arrangements'] == manifest(entries)['arrangements']
    assert any('read-only' in warning for warning in imported['import_warnings'])
    row['notes'] = [{'id':'not-allowed','time':0,'fret':3}]
    with pytest.raises(p.ProjectError, match='cannot accept editable'):
        p.save_feedpak(imported)


@pytest.mark.skipif(p.core_notation() is None, reason='FeedBack core notation module not available')
def test_notation_only_keys_part_becomes_editable_with_core_rule():
    entries = notation_fixture();imported = p.load_feedpak(archive(entries));row = imported['arrangements'][0]
    assert row['type'] == 'keys' and not row.get('readOnly') and row['instrument'] == 'piano'
    assert [(n['time'], n['pitch'], n.get('hand')) for n in row['notes']] == [(0.0, 64, 'rh')]
    assert any('editable notes from its notation' in warning for warning in imported['import_warnings'])
    # Saved unedited, it stays exactly the notation-only part it was.
    exported = members(p.save_feedpak(copy.deepcopy(imported)))
    assert exported['source/score.jsonc'] == entries['source/score.jsonc']
    assert manifest(exported)['arrangements'] == manifest(entries)['arrangements']
    # Edited, it becomes a playable chart; the authored type is kept.
    row['notes'][0]['pitch'] = 65;row['notes'][0]['fret'] = 65 % 24
    entry = manifest(members(p.save_feedpak(imported)))['arrangements'][0]
    assert entry['type'] == 'piano' and entry.get('file') and 'notation' not in entry


def test_notation_schema_and_staff_semantics_are_checked():
    for change in ['nonopening-pickup','unknown-staff','groups']:
        entries = notation_fixture();doc = json.loads(entries['source/score.jsonc'].split(b'\n',1)[1]);measure = doc['measures'][0]
        if change == 'nonopening-pickup':doc['measures'].append(copy.deepcopy(measure))
        if change == 'unknown-staff':measure['staves']['undefined'] = measure['staves'].pop('rh')
        if change == 'groups':measure['beat_groups'] = [1,1]
        entries['source/score.jsonc'] = json.dumps(doc).encode()
        with pytest.raises(p.ProjectError):
            p.load_feedpak(archive(entries))


@pytest.mark.parametrize('alias', ['manifest.json','manifest.yml'])
def test_writer_emits_canonical_manifest_preserving_original_alias(alias):
    entries = fixture();old = entries.pop('manifest.yaml');entries[alias] = old
    output = members(p.save_feedpak(p.load_feedpak(archive(entries))))
    assert output[alias] == old and 'manifest.yaml' in output


def test_unknown_unindexed_bytes_are_not_parsed_and_missing_streams_not_invented():
    entries = fixture();entries['unknown/future.json'] = b'not JSON: unknown future representation'
    output = members(p.save_feedpak(p.load_feedpak(archive(entries))))
    assert output['unknown/future.json'] == entries['unknown/future.json']
    assert 'keys' not in manifest(output) and 'harmony' not in manifest(output)


def test_retained_notation_grid_edits_are_disclosed_without_false_detach_claim(monkeypatch):
    monkeypatch.setattr(p, 'core_notation', lambda: None)   # read-only fallback without FeedBack core
    imported = p.load_feedpak(archive(notation_fixture()))
    imported['beats'].append({'time':4,'measure':2})
    warnings = p.notation_export_warnings(imported)
    assert warnings[0]['code'] == 'notation-read-only-preserved'
    assert 'not retimed' in warnings[0]['warning']
    assert manifest(members(p.save_feedpak(imported)))['arrangements'][0]['notation'] == 'source/score.jsonc'


def test_rig_local_assets_and_hashes_validate_without_rejecting_unknown_engines():
    import hashlib
    entries = fixture();asset = b'own original model placeholder'
    entries['assets/own.nam'] = asset
    library = {'version':1,'rigs':[{'id':'own','blocks':[{'intent':{'kind':'future'},'realizations':[
        {'engine':'future-engine','ref':'opaque future reference'},
        {'engine':'nam','ref':'assets/own.nam','sha256':hashlib.sha256(asset).hexdigest()}]}]}]}
    optional(entries, 'rigs', library)
    p.load_feedpak(archive(entries))
    library['rigs'][0]['blocks'][0]['realizations'][1]['sha256'] = '0' * 64
    with pytest.raises(p.ProjectError, match='SHA-256'):
        p.load_feedpak(archive(optional(entries, 'rigs', library)))


def test_rig_graph_and_source_binding_semantics_not_covered_by_published_schema():
    cases = [
        {'id':'own','blocks':[{'id':'amp','intent':{}}], 'graph':{'nodes':['input','missing','output'],'edges':[]}},
        {'id':'own','blocks':[{'intent':{},'realizations':[{'engine':'soundfont','ref':'https://example.invalid/never-fetch.sf2'}]}]},
        {'id':'own','blocks':[{'intent':{}},{'role':'source','intent':{'gm':{'program':0}}}]},
    ]
    for rig in cases:
        with pytest.raises(p.ProjectError):
            p.load_feedpak(archive(optional(fixture(), 'rigs', {'version':1,'rigs':[rig]})))


def test_primary_and_alternate_lyrics_require_valid_rows_but_future_track_kinds_preserve():
    entries = fixture();doc = manifest(entries)
    doc['lyric_tracks'] = [{'id':'future','file':'language/lyrics.jsonc','language':'i-klingon','kind':'future-reading-view'}]
    entries['language/lyrics.jsonc'] = b'/* alternate */[{"t":0,"d":1,"w":"Own+","unknown":true}]'
    imported = p.load_feedpak(archive(index(entries, doc)))
    out = members(p.save_feedpak(imported))
    assert out['language/lyrics.jsonc'] == entries['language/lyrics.jsonc']
    assert manifest(out)['lyric_tracks'][0]['kind'] == 'future-reading-view'


def test_validator_unavailable_is_a_visible_capability_failure():
    from unittest.mock import patch
    helper = p._feedpak_contract
    helper._validator.cache_clear()
    with patch.object(helper.importlib.metadata, 'version', return_value='3.0.0'):
        assert helper.status()['available'] is False
        with pytest.raises(p.ProjectError, match='requirements-standalone.txt'):
            p.save_feedpak(project())
    helper._validator.cache_clear()
    assert helper.status()['available'] is True


def test_unrendered_rig_asset_missing_does_not_discard_or_reject_the_song():
    library = {'version':1,'rigs':[{'id':'own','blocks':[{'intent':{'kind':'amp'},
        'realizations':[{'engine':'nam','ref':'captures/unavailable.nam'}]}]}]}
    entries = optional(fixture(), 'rigs', library)
    imported = p.load_feedpak(archive(entries))
    assert any('unavailable.nam' in warning and 'retained' in warning for warning in imported['import_warnings'])
    out = members(p.save_feedpak(imported))
    assert out['custom/rigs.json'] == entries['custom/rigs.json']
    assert imported['_feedpakValidation']['playbackConformance'] is False


def _bind_tones(entries, tones):
    doc = manifest(entries)
    name = doc['arrangements'][0]['file']
    arr = json.loads(entries[name])
    arr['tones'] = tones
    entries[name] = json.dumps(arr).encode()
    return entries


def test_tone_change_with_no_name_is_a_warning_not_a_refused_pack():
    entries = _bind_tones(fixture(), {'base': 'Clean', 'changes': [{'t': 1}]})
    imported = p.load_feedpak(archive(entries))
    assert imported['arrangements'][0]['tones']['changes'] == [{'t': 1, 'time': 1}]
    assert any('has no name' in warning for warning in imported['import_warnings'])


def test_out_of_order_tone_changes_are_a_warning_not_a_refused_pack():
    entries = _bind_tones(fixture(), {'base': 'Clean',
        'changes': [{'t': 2, 'name': 'Drive'}, {'t': 1, 'name': 'Clean'}]})
    imported = p.load_feedpak(archive(entries))
    assert [c['t'] for c in imported['arrangements'][0]['tones']['changes']] == [2, 1]
    assert any('not in non-descending order' in warning for warning in imported['import_warnings'])


def test_unresolved_rig_binding_is_a_warning_not_a_refused_pack():
    entries = _bind_tones(fixture(), {'base': 'Clean', 'base_rig': 'missing', 'changes': []})
    imported = p.load_feedpak(archive(entries))
    assert imported['arrangements'][0]['tones']['base_rig'] == 'missing'
    assert any('refers to a missing rig id' in warning for warning in imported['import_warnings'])
    # A malformed tones.changes shape (not a list of objects with a numeric t) stays a hard
    # refusal; only the name/order/rig-resolution leniency above is new.
    broken = _bind_tones(fixture(), {'base': 'Clean', 'changes': [{'name': 'Drive'}]})
    with pytest.raises(p.ProjectError, match='numeric t'):
        p.load_feedpak(archive(broken))


def test_explicit_graph_overrides_metadata_block_order_for_source_head():
    library = {'version':1,'rigs':[{'id':'own','blocks':[
        {'id':'amp','intent':{'kind':'amp'}},
        {'id':'keys','role':'source','intent':{'gm':{'program':0}}}],
        'graph':{'nodes':['input','keys','amp','output'],
                 'edges':[['input','keys'],['keys','amp'],['amp','output']]}}]}
    entries = optional(fixture(), 'rigs', library)
    imported = p.load_feedpak(archive(entries))
    assert imported['rigLibrary'] == library
    assert members(p.save_feedpak(imported))['custom/rigs.json'] == entries['custom/rigs.json']
