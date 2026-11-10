"""Working-folder browser (issue #31): configured-roots persistence and
per-song-folder tag sniffing, against real small folders on disk for each
supported format. All fixtures are synthetic/original, never real chart data."""
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import folder_browser as fb
import folder_io
import eof_io as e
from test_eof_io import _str, _note, _track, _pro_guitar_track, _sections
from test_rplus_io import chart, ebeats, LEAD_BODY, STRUM_BODY, LYRICS, SONG, LEAD, STRUM
from test_charter_io import build_rscp, arrangement


def _write(directory, name, data):
    path = directory / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode('utf-8'))


_FOOTER = _sections({}) + struct.pack('<I', 0)  # empty sections + empty custom-data blocks


def _vocal_track_body(lyric_count=1):
    out = bytes([0]) + struct.pack('<I', lyric_count)
    for _ in range(lyric_count):
        out += _str('la') + bytes([0, 0]) + struct.pack('<III', 0, 500, 0)
    return out + _FOOTER


def _pro_keys_track_body(chord_count=1):
    out = bytes([0, 60, 72]) + struct.pack('<I', chord_count)
    for _ in range(chord_count):
        out += _str('') + bytes([0, 0, 0, 0]) + struct.pack('<III', 0, 500, 0)
    return out + _FOOTER


def _legacy_track_body(note_count=1):
    out = struct.pack('<I', note_count)
    for _ in range(note_count):
        out += _str('') + bytes([0, 0]) + struct.pack('<III', 0, 500, 0)
    return out + _FOOTER


def _build_eof(tracks):
    header = e.MAGIC + b'\x00' * 8
    header += struct.pack('<I', 1) + bytes([0]) + struct.pack('<I', 0)
    strings = [(3, 'Test Song'), (2, 'Test Artist')]
    header += struct.pack('<H', len(strings))
    for kind, value in strings:
        header += bytes([kind]) + _str(value)
    header += struct.pack('<H', 0) + struct.pack('<H', 0) + struct.pack('<H', 0)
    beats = [(0, 0, e.BEAT_FLAG_START_4_4, 0), (500, 0, 0, 0)]
    header += struct.pack('<I', len(beats))
    for ppqn, pos, flags, key in beats:
        header += struct.pack('<III', ppqn, pos, flags) + struct.pack('<b', key)
    header += struct.pack('<I', 0) + struct.pack('<I', 0)
    header += struct.pack('<I', 1 + len(tracks))
    header += _track('', 0, struct.pack('<H', 0) + struct.pack('<I', 0))
    for track_bytes in tracks:
        header += track_bytes
    return header


class RootsTests(unittest.TestCase):
    def test_round_trip_and_rejects_missing_path(self):
        with tempfile.TemporaryDirectory() as plugin_dir, tempfile.TemporaryDirectory() as working:
            self.assertEqual(fb.read_roots(plugin_dir), [])
            saved = fb.write_roots(plugin_dir, [working])
            self.assertEqual(saved, [str(Path(working).resolve())])
            self.assertEqual(fb.read_roots(plugin_dir), saved)
            with self.assertRaises(fb.FolderBrowserError):
                fb.write_roots(plugin_dir, [str(Path(working) / 'does-not-exist')])

    def test_rejects_duplicate_roots(self):
        with tempfile.TemporaryDirectory() as plugin_dir, tempfile.TemporaryDirectory() as working:
            with self.assertRaises(fb.FolderBrowserError):
                fb.write_roots(plugin_dir, [working, working])

    def test_rejects_too_many_roots(self):
        with tempfile.TemporaryDirectory() as plugin_dir:
            with self.assertRaises(fb.FolderBrowserError):
                fb.write_roots(plugin_dir, ['x'] * (fb.MAX_ROOTS + 1))


class ResolveSongFolderTests(unittest.TestCase):
    def test_resolves_a_nested_leaf_and_can_snapshot_it(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            song = directory / 'Some Artist' / 'Some Album' / 'Some Song'
            song.mkdir(parents=True)
            _write(song, f'Official_Lead1_{LEAD}_v4.xml', chart('Lead', 'Guitar', LEAD_BODY))
            resolved = fb.resolve_song_folder(root, ['Some Artist', 'Some Album', 'Some Song'])
            self.assertEqual(resolved, song.resolve())
            zip_bytes = folder_io.snapshot_directory(resolved, 10 * 1024 * 1024)
            self.assertTrue(zip_bytes.startswith(b'PK'))

    def test_rejects_path_traversal_segments(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(fb.FolderBrowserError):
                fb.resolve_song_folder(root, ['..'])
            with self.assertRaises(fb.FolderBrowserError):
                fb.resolve_song_folder(root, ['a/../../b'])


class RplusTagTests(unittest.TestCase):
    def test_lead_humstrum_keyboard_vocals(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            _write(directory, f'Official_Lead1_{LEAD}_v4.xml', chart('Lead', 'Guitar', LEAD_BODY))
            _write(directory, f'Official_HumStrum1_{STRUM}_v2.xml', chart('HumStrum', 'Bass', STRUM_BODY, beats=ebeats(16, 0.52)))
            _write(directory, f'lyrics_{SONG}_en_v0.xml', LYRICS)
            _write(directory, 'audio.wem', b'fake')
            node = fb.list_tree(directory)
            self.assertEqual(node['format'], 'rplus')
            tags = node['tags']
            self.assertTrue(tags['lead'])
            self.assertTrue(tags['vocals'])
            self.assertTrue(tags['humstrum'])
            self.assertTrue(tags['audio'])
            self.assertFalse(tags['bass'])
            self.assertFalse(tags['rhythm'])
            self.assertFalse(tags['piano'])
            self.assertFalse(tags['drums'])

    def test_simple_and_alt_lead_bass_count_toward_lead_and_bass_not_other(self):
        # Real-world kinds confirmed against an actual R+ library (not just HumStrum/Lead/
        # Rhythm/Bass/Keyboard): Simple and AltLead are simplified/alternate Lead charts,
        # AltBass is an alternate Bass chart - none of them belong in the "Other" catch-all.
        simple = 'bbbbbbbb-0000-0000-0000-000000000001'
        alt_lead = 'bbbbbbbb-0000-0000-0000-000000000002'
        alt_bass = 'bbbbbbbb-0000-0000-0000-000000000003'
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            _write(directory, f'Official_Simple1_{simple}_v1.xml', chart('Simple', 'Guitar', LEAD_BODY))
            _write(directory, f'Official_AltLead1_{alt_lead}_v1.xml', chart('AltLead', 'Guitar', LEAD_BODY))
            _write(directory, f'Official_AltBass1_{alt_bass}_v1.xml', chart('AltBass', 'Bass', LEAD_BODY))
            tags = fb.list_tree(directory)['tags']
            self.assertTrue(tags['lead'])
            self.assertTrue(tags['bass'])
            self.assertFalse(tags['other'])

    def test_grouping_directories_are_not_song_folders(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            song = directory / 'Some Artist' / 'Some Album' / 'Some Song'
            song.mkdir(parents=True)
            _write(song, f'Official_Lead1_{LEAD}_v4.xml', chart('Lead', 'Guitar', LEAD_BODY))
            node = fb.list_tree(directory)
            self.assertEqual(node['kind'], 'group')
            artist = node['children'][0]
            self.assertEqual(artist['kind'], 'group')
            album = artist['children'][0]
            self.assertEqual(album['kind'], 'group')
            leaf = album['children'][0]
            self.assertEqual(leaf['kind'], 'song')
            self.assertEqual(leaf['format'], 'rplus')
            self.assertTrue(leaf['tags']['lead'])


class EofTagTests(unittest.TestCase):
    def test_guitar_bass_vocal_and_empty_track(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            guitar_note = _note(frets=(3, 5), string_mask=0b000011)
            bass_track = _track('PART REAL_BASS', e.TRACK_FORMAT_PRO_GUITAR,
                                 _pro_guitar_track([guitar_note], numstrings=4, tuning=[0, 0, 0, 0]), altname='Bass')
            lead_track = _track('PART REAL_GUITAR', e.TRACK_FORMAT_PRO_GUITAR,
                                 _pro_guitar_track([guitar_note]), altname='Lead')
            vocal_track = _track('PART VOCALS', e.TRACK_FORMAT_VOCAL, _vocal_track_body(1))
            empty_keys_track = _track('PART REAL_KEYS', e.TRACK_FORMAT_PRO_KEYS, _pro_keys_track_body(0))
            data = _build_eof([bass_track, lead_track, vocal_track, empty_keys_track])
            _write(directory, 'notes.eof', data)
            node = fb.list_tree(directory)
            self.assertEqual(node['format'], 'eof')
            tags = node['tags']
            self.assertTrue(tags['bass'])
            self.assertTrue(tags['lead'])
            self.assertTrue(tags['vocals'])
            self.assertFalse(tags['piano'])  # the keys track has zero chords: not "authored"
            self.assertFalse(tags['drums'])

    def test_rhythm_name_heuristic(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            note = _note(frets=(3,), string_mask=0b000001)
            track = _track('PART REAL_GUITAR_RHYTHM', e.TRACK_FORMAT_PRO_GUITAR, _pro_guitar_track([note]), altname='Rhythm')
            _write(directory, 'notes.eof', _build_eof([track]))
            tags = fb.list_tree(directory)['tags']
            self.assertTrue(tags['rhythm'])
            self.assertFalse(tags['lead'])


class FeedpakTagTests(unittest.TestCase):
    def test_manifest_yaml_arrangements_and_lyrics(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            manifest = '''
title: Test Song
artist: Test Artist
duration: 180
stems:
  - path: audio/full.wav
arrangements:
  - id: lead
    name: Lead
    type: guitar
    file: charts/lead.json
  - id: bass
    name: Bass
    type: bass
    file: charts/bass.json
  - id: drums
    name: Drums
    type: drums
    file: charts/drums.json
lyrics: lyrics.json
'''
            _write(directory, 'manifest.yaml', manifest)
            node = fb.list_tree(directory)
            self.assertEqual(node['format'], 'feedpak')
            tags = node['tags']
            self.assertTrue(tags['lead'])
            self.assertTrue(tags['bass'])
            self.assertTrue(tags['drums'])
            self.assertTrue(tags['vocals'])
            self.assertFalse(tags['rhythm'])
            self.assertFalse(tags['piano'])


class CharterTagTests(unittest.TestCase):
    def test_lead_and_bass_arrangements(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            lead_sound = '<sound p="0 0/1" ep="0 1/1" string="0" fret="1"/>'
            lead = arrangement(f'<levels><level><sounds>{lead_sound}</sounds></level></levels>', arr_type='Lead')
            bass = arrangement('<levels><level><sounds></sounds></level></levels>', arr_type='Bass',
                                tuning='<tuning type="E_STANDARD" strings="4"/>')
            _write(directory, 'project.rscp', build_rscp(lead + bass))
            node = fb.list_tree(directory)
            self.assertEqual(node['format'], 'charter')
            tags = node['tags']
            self.assertTrue(tags['lead'])
            self.assertFalse(tags['bass'])  # the bass arrangement has no sounds: not "authored"


class GpaTagTests(unittest.TestCase):
    def test_gpa_folder_is_a_format_badge_only(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            _write(directory, 'song.xml', '<track><scoreUrl>song.gp5</scoreUrl><sync/></track>')
            _write(directory, 'song.gp5', b'not a real score')
            node = fb.list_tree(directory)
            self.assertEqual(node['format'], 'gpa')
            self.assertIsNone(node['tags'])


if __name__ == '__main__':
    unittest.main()
