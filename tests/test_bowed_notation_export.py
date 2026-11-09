"""Export side of generic notation-only charts: an open-ended arrangement `type` (not just a
keys-family whitelist) and a freshly generated notation_<id>.json for single-line pitched
instruments, so a future highway plugin keyed on `type` + notation can show them (see
I:\\Dev\\feedback-plugin-bowed-string-instruments\\docs\\CHART-AUTHORING-HANDOVER.md)."""
import base64
import io
import json
import sys
import wave
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pack_io as p


def pitched_project(instrument, notes):
    """A project with one keys-family ('type':'keys') arrangement carrying the given live
    instrument label, exactly as OCE's own "Instrument label" field (main.js) sets it -
    not an imported manifest's `type`, which is a separate thing _arrangement() handles."""
    audio = io.BytesIO()
    with wave.open(audio, 'wb') as wav:
        wav.setparams((1, 2, 8000, 0, 'NONE', 'not compressed')); wav.writeframes(b'\x00\x00' * 8000)
    return {
        'version': 1, 'title': 'Pitched test chart', 'artist': 'Author', 'duration': 4,
        'beats': [{'time': 0, 'measure': 1}, {'time': 0.5, 'measure': -1}, {'time': 1.0, 'measure': -1}, {'time': 1.5, 'measure': -1}],
        'sections': [], 'arrangements': [{
            'id': 'strings', 'name': 'Strings', 'type': 'keys', 'instrument': instrument,
            'stringCount': 6, 'tuning': [0] * 6, 'notes': notes, 'chords': [], 'chord_templates': [], 'anchors': [], 'handshapes': [],
        }],
        '_pack': {'manifest': {'stems': [{'id': 'full', 'file': 'audio/original.wav', 'default': True}]},
                   'entries': {'audio/original.wav': base64.b64encode(audio.getvalue()).decode('ascii')}},
    }


def members(data):
    with zipfile.ZipFile(io.BytesIO(data)) as pack:
        return {name: pack.read(name) for name in pack.namelist()}


def manifest_arrangement(out, arr_id):
    import yaml
    doc = yaml.safe_load(out['manifest.yaml'])
    return next(e for e in doc['arrangements'] if e['id'] == arr_id)


def test_violin_instrument_exports_as_its_own_type_with_generated_notation():
    notes = [
        {'id': 'n1', 'time': 0.5, 'pitch': 72, 'sustain': 0.5},
        {'id': 'n2', 'time': 0.5, 'pitch': 67, 'sustain': 0.5},  # same onset -> one double-stop beat
    ]
    out = members(p.save_feedpak(pitched_project('violin', notes)))
    entry = manifest_arrangement(out, 'strings')
    assert entry['type'] == 'violin'
    assert entry['notation'] == 'notation_strings.json'
    assert entry.get('file')  # the wire-chart stays alongside the notation, per the plan

    doc = json.loads(out[entry['notation']])
    assert doc['version'] == 1
    assert doc['staves'][0]['clef'] == 'G2'  # violin -> treble, per stave-view.js's MELODIC table
    measures = doc['measures']
    assert measures, 'at least one measure was written'
    prev_t = -1
    for m in measures:
        assert isinstance(m['idx'], int)
        assert isinstance(m['t'], (int, float)) and m['t'] >= prev_t
        prev_t = m['t']
    midis = set()
    for m in measures:
        for stave in m.get('staves', {}).values():
            for voice in stave['voices']:
                for beat in voice['beats']:
                    assert isinstance(beat['t'], (int, float))
                    for note in beat['notes']:
                        assert 0 <= note['midi'] <= 127
                        midis.add(note['midi'])
    assert midis == {72, 67}


def test_cello_instrument_gets_bass_clef():
    notes = [{'id': 'n1', 'time': 0.5, 'pitch': 43, 'sustain': 1.0}]
    out = members(p.save_feedpak(pitched_project('cello', notes)))
    entry = manifest_arrangement(out, 'strings')
    assert entry['type'] == 'cello'
    doc = json.loads(out[entry['notation']])
    assert doc['staves'][0]['clef'] == 'F4'


def test_plain_piano_keeps_generic_type_and_no_generated_notation():
    """Regression: a generic keys/piano part must not change behavior - no single-stave
    notation gets synthesized for it (it's a grand-staff instrument), and 'piano' itself
    already passed the old KEYS_FAMILY_TYPES whitelist, so its exported type is unchanged."""
    notes = [{'id': 'n1', 'time': 0.5, 'pitch': 60, 'sustain': 0.5}]
    out = members(p.save_feedpak(pitched_project('piano', notes)))
    entry = manifest_arrangement(out, 'strings')
    assert entry['type'] == 'piano'
    assert 'notation' not in entry


def test_reserved_words_are_not_treated_as_instrument_tags():
    for reserved in ('guitar', 'bass', 'drums', 'vocals'):
        assert reserved in p.RESERVED_TYPES
    notes = [{'id': 'n1', 'time': 0.5, 'pitch': 60, 'sustain': 0.5}]
    project = pitched_project('bass', notes)
    out = members(p.save_feedpak(project))
    entry = manifest_arrangement(out, 'strings')
    assert entry['type'] == 'keys'  # 'bass' is reserved, so it falls back to the family word
