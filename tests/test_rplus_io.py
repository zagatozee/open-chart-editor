"""R+ song folders: reading charts/lyrics/metadata, and adding new chart files only.

All fixtures are synthetic: made-up songs written in the R+ XML layout.
"""
import io
import json
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import export_targets as e
import pack_io as p
import rplus_io as r

SONG = '11111111-2222-3333-4444-555555555555'
LEAD = 'aaaaaaaa-0000-0000-0000-000000000001'
STRUM = 'aaaaaaaa-0000-0000-0000-000000000002'
KEYS = 'aaaaaaaa-0000-0000-0000-000000000003'


def ebeats(count=16, step=0.5, first_measure=1):
    rows = ''.join(f'<ebeat time="{i * step:.3f}" measure="{first_measure + i // 4 if i % 4 == 0 else -1}" />' for i in range(count))
    return f'<ebeats count="{count}">{rows}</ebeats>'


def chart(kind, instrument, body, *, beats=None):
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<song version="19"><songId>{SONG}</songId><arrangementId>x</arrangementId><title>Test Song</title>
<arrangement>{kind}</arrangement><instrument>{instrument}</instrument><offset>0.500</offset><centOffset>0</centOffset>
<songLength>8.000</songLength><internalName>TestSong</internalName><songNameSort>test song</songNameSort><startBeat>0.000</startBeat>
<averageTempo>120.000</averageTempo><tuning string0="0" string1="0" string2="0" string3="0" string4="0" string5="0" /><capo>0</capo>
<artistName>Nobody</artistName><albumName>Demo</albumName><albumYear>2024</albumYear>
<phrases count="3"><phrase color="0" disparity="0" ignore="0" maxDifficulty="2" name="default" solo="0" />
<phrase color="1" disparity="0" ignore="0" maxDifficulty="2" name="A" solo="0" /><phrase color="2" disparity="0" ignore="0" maxDifficulty="0" name="END" solo="0" /></phrases>
<phraseIterations count="3"><phraseIteration phraseId="0" time="0.000" variation="" /><phraseIteration phraseId="1" time="2.000" variation="" />
<phraseIteration phraseId="2" time="7.500" variation="" /></phraseIterations>
{beats or ebeats()}<sections count="1"><section name="verse" number="1" startTime="2.000" /></sections>
<events count="0" /><toneIterations count="1"><toneIteration toneId="t1" startTime="0.000" /></toneIterations>{body}</song>'''.encode('utf-8')


LEAD_BODY = '''<chordTemplates count="0" /><levels count="1"><level difficulty="0"><notes count="2">
<note time="2.000" fret="3" string="5" sustain="0.000" /><note time="2.500" fret="5" string="4" sustain="0.250" /></notes>
<chords count="0" /><anchors count="1"><anchor time="2.000" fret="3" width="4" /></anchors><handShapes count="0" /></level></levels>'''
# Six-string chord chart that R+ files under its Bass instrument.
STRUM_BODY = '''<chordTemplates count="1"><chordTemplate chordName="G" displayName="G" fret0="3" fret1="2" fret2="0" fret3="0" fret4="0" fret5="3"
finger0="2" finger1="1" finger2="-1" finger3="-1" finger4="-1" finger5="3" /></chordTemplates><levels count="1"><level difficulty="0"><notes count="0" />
<chords count="1"><chord time="2.000" chordId="0"><chordNote string="0" fret="3" /><chordNote string="1" fret="2" /><chordNote string="2" fret="0" />
<chordNote string="3" fret="0" /><chordNote string="4" fret="0" /><chordNote string="5" fret="3" /></chord></chords>
<anchors count="0" /><handShapes count="0" /></level></levels>'''
KEYS_BODY = '''<chordTemplates count="0" /><levels count="1"><level difficulty="0"><chords count="0" /><handShapes count="0" /><notes count="2">
<note clef="treble" fret="40" midi="60" name="C" octave="4" rightHand="1" staff="1" string="0" sustain="0.375" time="2.000" accent="1">
<beats><beat dots="0" length="1.0000" measure="2" position="1.0000" /></beats></note>
<note clef="bass" fret="28" leftHand="5" midi="48" name="C" octave="3" staff="0" string="0" sustain="0.875" time="2.000">
<beats><beat dots="0" length="2.0000" measure="2" position="1.0000" /></beats></note></notes>
<anchors count="1"><anchor fret="28" time="2.000" width="13.0" /></anchors><tuplets count="0" /></level></levels>'''
LYRICS = f'''<?xml version="1.0" encoding="UTF-8"?><trueVocals><songId>{SONG}</songId><title>Test Song</title>
<vocals count="2"><vocal time="2.000" note="60" length="0.400" lyric="Hel-" /><vocal time="2.500" note="62" length="0.400" lyric="lo" /></vocals>
{ebeats()}</trueVocals>'''.encode('utf-8')


def folder(**extra):
    entries = {f'Official_Lead1_{LEAD}_v4.xml': chart('Lead', 'Guitar', LEAD_BODY),
               f'Official_HumStrum1_{STRUM}_v2.xml': chart('HumStrum', 'Bass', STRUM_BODY, beats=ebeats(16, 0.52)),
               f'Official_Keyboard1_{KEYS}_v7.xml': chart('Keyboard', 'Keyboard', KEYS_BODY),
               f'lyrics_{SONG}_en_v0.xml': LYRICS,
               'metadata.json': json.dumps({'songName': 'Test Song', 'artistName': 'Nobody', 'albumName': 'Demo', 'songYear': 2024,
                                            'arrangementInfoList': []}).encode(),
               'tone_t1.json': b'{"toneId": "t1"}', 'album_art.jpg': b'\xff\xd8 not really a jpeg',
               'audio.wem': b'RIFF\x00\x00\x00\x00WAVEfmt \x10\x00\x00\x00\xff\xff' + b'\x00' * 32}
    entries.update(extra)
    return entries


def as_zip(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return out.getvalue()


def open_folder(**extra):
    return e.load_folder_archive(as_zip(folder(**extra)))


class ReadTests(unittest.TestCase):
    def test_folder_is_detected_and_read(self):
        self.assertTrue(r.is_rplus_folder(folder()))
        project = open_folder()
        self.assertEqual((project['title'], project['artist'], project['album'], project['year']), ('Test Song', 'Nobody', 'Demo', 2024))
        by_kind = {a['_rplus']['kind']: a for a in project['arrangements']}
        self.assertEqual(by_kind['Lead']['type'], 'guitar')
        self.assertEqual(len(by_kind['Lead']['notes']), 2)
        # A six-string chord chart filed under Bass stays a guitar chart.
        strum = by_kind['HumStrum']
        self.assertEqual((strum['type'], strum['role'], strum['stringCount'], strum['name']), ('guitar', 'rhythm', 6, 'HumStrum (Bass)'))
        keys = by_kind['Keyboard']
        self.assertEqual(keys['type'], 'keys')
        self.assertEqual([(n['pitch'], n['hand']) for n in keys['notes']], [(60, 'rh'), (48, 'lh')])
        self.assertEqual([v['text'] for v in project['vocals']], ['Hel-', 'lo'])
        self.assertEqual(project['_pack']['manifest']['stems'][0]['file'], 'audio.wem')
        self.assertEqual(len(project['beats']), 15)
        self.assertAlmostEqual(project['duration'], 7.5)

    def test_arrangement_and_lyrics_offsets_shift_their_timelines_earlier(self):
        lyrics = LYRICS.replace(b'<trueVocals>', b'<trueVocals><offset>0.500</offset>')
        project = open_folder(**{f'lyrics_{SONG}_en_v0.xml': lyrics})
        self.assertEqual([v['time'] for v in project['vocals']], [1.5, 2.0])
        self.assertEqual([v['length'] for v in project['vocals']], [0.4, 0.4])
        self.assertAlmostEqual(project['beats'][0]['time'], 0.0)
        self.assertAlmostEqual(project['beats'][1]['time'], 0.5)
        lead = next(a for a in project['arrangements'] if a['_rplus']['kind'] == 'Lead')
        self.assertEqual([n['time'] for n in lead['notes']], [1.5, 2.0])
        self.assertEqual([p['time'] for p in lead['phrases']], [0.0, 1.5, 7.0])
        self.assertEqual(lead['_xml'].find('<offset>0.000</offset>') >= 0, True)

    def test_anchor_stays_exactly_colocated_with_its_phrase_start_through_a_non_round_offset(self):
        """Regression for issue #11: imported R+ charts were reported with spurious
        "Phrase needs an anchor at its start" findings. A non-round offset (2.321, as seen
        on a real song) is subtracted from every timestamped element independently
        (anchors, phraseIterations, notes), so this checks they land on the exact same
        instant afterward rather than drifting apart by float error or being read from a
        different source element."""
        offset = 2.321
        body = ('<chordTemplates count="0" /><levels count="1"><level difficulty="0"><notes count="1">'
                '<note time="14.026" fret="3" string="5" sustain="0.500" /></notes><chords count="0" />'
                '<anchors count="1"><anchor time="14.026" fret="3" width="4" /></anchors><handShapes count="0" /></level></levels>')
        lead = chart('Lead', 'Guitar', body).replace(b'<offset>0.500</offset>', f'<offset>{offset:.3f}</offset>'.encode())
        lead = lead.replace(b'<phraseIteration phraseId="1" time="2.000" variation="" />', b'<phraseIteration phraseId="1" time="14.026" variation="" />')
        project = open_folder(**{f'Official_Lead1_{LEAD}_v4.xml': lead})
        arr = next(a for a in project['arrangements'] if a['_rplus']['kind'] == 'Lead')
        self.assertEqual(len(arr['anchors']), 1)
        self.assertEqual(arr['anchors'][0]['time'], arr['phrases'][1]['time'])
        self.assertAlmostEqual(arr['notes'][0]['time'], arr['anchors'][0]['time'])

    def test_bend_point_at_the_exact_end_of_sustain_survives_a_non_round_offset(self):
        """Regression for issue #11: imported R+ charts were reported with spurious
        "Bend point lies outside the note sustain." findings. A bend point placed at the
        very end of its note's sustain in the source (a common, valid shape: the bend
        peaks right as the note ends) should land at t == sustain after import, not drift
        past it, through the same per-file offset normalization as the note/anchor test above."""
        offset = 2.321
        body = ('<chordTemplates count="0" /><levels count="1"><level difficulty="0"><notes count="1">'
                '<note time="14.026" fret="3" string="5" sustain="0.500">'
                '<bendValues count="1"><bendValue time="14.526" step="1.0"/></bendValues></note></notes>'
                '<chords count="0" /><anchors count="0" /><handShapes count="0" /></level></levels>')
        lead = chart('Lead', 'Guitar', body).replace(b'<offset>0.500</offset>', f'<offset>{offset:.3f}</offset>'.encode())
        project = open_folder(**{f'Official_Lead1_{LEAD}_v4.xml': lead})
        arr = next(a for a in project['arrangements'] if a['_rplus']['kind'] == 'Lead')
        note = arr['notes'][0]
        point = note['techniques']['bend_values'][0]
        self.assertLessEqual(point['t'], note['sustain'] + 1e-6)
        self.assertAlmostEqual(point['t'], note['sustain'])

    def test_majority_non_humstrum_maps_excludes_humstrum_grid_outlier(self):
        bass_id = 'aaaaaaaa-0000-0000-0000-000000000004'
        bass_body = LEAD_BODY.replace('string="5"', 'string="3"').replace('string="4"', 'string="2"')
        entries = folder(**{
            f'Official_Bass1_{bass_id}_v1.xml': chart('Bass', 'Bass', bass_body),
            f'lyrics_{SONG}_en_v0.xml': LYRICS.replace(b'<trueVocals>', b'<trueVocals><offset>0.500</offset>')
        })
        project = e.load_folder_archive(as_zip(entries))
        bass = next(a for a in project['arrangements'] if a['_rplus']['kind'] == 'Bass')
        self.assertEqual([n['time'] for n in bass['notes']], [1.5, 2.0])
        self.assertAlmostEqual(project['beats'][0]['time'], 0.0)
        self.assertIn('different beat map', ' '.join(project['import_warnings']))

    def test_own_beat_map_is_reported(self):
        warnings = ' '.join(open_folder()['import_warnings'])
        self.assertIn(f'Official_HumStrum1_{STRUM}_v2.xml has a different beat map from Official_Lead1_{LEAD}_v4.xml', warnings)

    def test_tones_come_from_the_tone_files(self):
        tone, other = 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'
        gear = {'Amp': {'Key': 'Amp_Test', 'Type': 'Amps', 'KnobValues': {'Amp_Test_Gain': 40.0}}}
        body = LEAD_BODY
        lead = chart('Lead', 'Guitar', body).replace(b'<toneIterations count="1"><toneIteration toneId="t1" startTime="0.000" /></toneIterations>',
                                                     f'<toneIterations count="2"><toneIteration toneId="{tone.upper()}" startTime="0.000" />'
                                                     f'<toneIteration toneId="{other}" startTime="4.000" /></toneIterations>'.encode())
        project = open_folder(**{f'Official_Lead1_{LEAD}_v4.xml': lead,
                                 f'tone_{tone}.json': json.dumps({'toneId': tone, 'toneData': {'Key': 'Crunch', 'Name': 'Crunch', 'Volume': -12.0, 'GearList': gear}}).encode(),
                                 f'tone_{other}.json': json.dumps({'toneId': other, 'toneData': {'Key': 'Lead', 'Name': 'Lead', 'GearList': gear}}).encode()})
        arr = next(a for a in project['arrangements'] if a['_rplus']['kind'] == 'Lead')
        self.assertEqual((arr['tones']['base'], arr['tones']['changes']), ('Crunch', [{'time': 3.5, 'name': 'Lead'}]))
        self.assertEqual(arr['tones']['definitions']['Crunch']['GearList'], gear)
        # An edited chart names the same tones again.
        arr['notes'][0]['fret'] += 1
        files, _ = r.rplus_folder(project)
        root = ET.fromstring(files[f'Official_Lead1_{LEAD}_v5.xml'])
        self.assertEqual([(t.get('startTime'), t.get('toneId')) for t in root.findall('./toneIterations/toneIteration')],
                         [('0.000', tone), ('3.500', other)])

    def test_folder_without_audio_still_opens(self):
        entries = folder()
        entries.pop('audio.wem')
        project = e.load_folder_archive(as_zip(entries))
        self.assertEqual(project['_pack']['manifest']['stems'], [])
        self.assertIn('no audio.wem', ' '.join(project['import_warnings']))

    def test_four_string_bass_chart(self):
        body = LEAD_BODY.replace('string="5"', 'string="0"').replace('string="4"', 'string="1"')
        project = open_folder(**{f'Official_Bass1_{STRUM}_v1.xml': chart('Bass', 'Bass', body)})
        bass = next(a for a in project['arrangements'] if a['_rplus']['kind'] == 'Bass')
        self.assertEqual((bass['type'], bass['role'], bass['stringCount']), ('bass', 'bass', 4))


class UgcTests(unittest.TestCase):
    """User-made (UGC) charts sit beside official ones with the same naming scheme."""
    UGC_LEAD = '08da9de7-2e66-4a0d-89a8-d2d2d740f5b3'

    def project(self):
        meta = json.dumps({'songName': 'Test Song', 'arrangementInfoList': [
            {'arrangementId': self.UGC_LEAD, 'creatorType': 'UGC', 'profileId': 'ef2155c1-afae-46c3-b5ed-3140ff6ed7c7',
             'publishedAt': '2022-09-25T03:51:02.000Z', 'rating': 3, 'isVerified': False}]}).encode()
        return open_folder(**{f'UGC_Lead2_{self.UGC_LEAD}_v1.xml': chart('Lead', 'Guitar', LEAD_BODY),
                              f'UGC_AltRhythm1_{STRUM}_v1.xml': chart('AltRhythm', 'Guitar', LEAD_BODY), 'metadata.json': meta})

    def test_ugc_charts_open_beside_official_ones(self):
        project = self.project()
        by_name = {a['name']: a for a in project['arrangements']}
        self.assertIn('Lead', by_name, 'the official lead is still there')
        self.assertEqual(by_name['Lead 2 (UGC)']['_rplus']['info'], {'creatorType': 'UGC', 'profileId': 'ef2155c1-afae-46c3-b5ed-3140ff6ed7c7',
                                                                    'publishedAt': '2022-09-25T03:51:02.000Z', 'rating': 3, 'isVerified': False})
        alt = by_name['Alt Rhythm (UGC)']
        self.assertEqual((alt['role'], alt['priority']), ('rhythm', 'alternative'))
        self.assertTrue(r.is_rplus_folder({f'UGC_Lead1_{LEAD}_v1.xml': chart('Lead', 'Guitar', LEAD_BODY)}))

    def test_song_beat_map_comes_from_an_official_chart(self):
        # The UGC lead sits on a flat placeholder tempo; the official charts carry the song's beat map.
        project = open_folder(**{f'Official_Lead1_{LEAD}_v4.xml': chart('Lead', 'Guitar', LEAD_BODY, beats=ebeats(16, 0.52)),
                                 f'UGC_Lead2_{self.UGC_LEAD}_v1.xml': chart('Lead', 'Guitar', LEAD_BODY, beats=ebeats(8, 1.0))})
        self.assertEqual(project['_import']['grid'], f'Official_Lead1_{LEAD}_v4.xml')
        self.assertAlmostEqual(project['beats'][0]['time'], 0.02)
        self.assertFalse([w for w in project['import_warnings'] if w.startswith('UGC_')], 'one song, one beat map: UGC grids are not reported')

    def test_edited_ugc_chart_keeps_its_prefix_and_number(self):
        project = self.project()
        arr = next(a for a in project['arrangements'] if a['name'] == 'Lead 2 (UGC)')
        arr['notes'][0]['fret'] += 1
        files, _ = r.rplus_folder(project)
        self.assertIn(f'UGC_Lead2_{self.UGC_LEAD}_v2.xml', files)


class WriteTests(unittest.TestCase):
    def test_nothing_changed_writes_nothing(self):
        with self.assertRaisesRegex(p.ProjectError, 'Nothing to add'):
            r.rplus_folder(open_folder())

    def test_edited_chart_exports_without_shifting_its_timeline(self):
        project = open_folder()
        lead = next(a for a in project['arrangements'] if a['_rplus']['kind'] == 'Lead')
        lead['notes'][0]['fret'] += 1
        files, _ = r.rplus_folder(project)
        name = f'Official_Lead1_{LEAD}_v5.xml'
        root = ET.fromstring(files[name])
        self.assertEqual(root.findtext('offset'), '0.000')
        self.assertEqual(root.find('levels/level/notes/note').get('time'), '1.5')
        self.assertEqual(float(root.find('ebeats/ebeat').get('time')), 0.0)

    def test_edited_keyboard_becomes_next_revision_and_keeps_untouched_notes(self):
        project = open_folder()
        keys = next(a for a in project['arrangements'] if a['type'] == 'keys')
        keys['notes'].append({'id': 'new', 'time': 3.0, 'sustain': 0.4375, 'string': 64 // 24, 'fret': 64 % 24, 'pitch': 64, 'hand': 'rh', 'techniques': {}})
        files, report = r.rplus_folder(project)
        name = f'Official_Keyboard1_{KEYS}_v8.xml'
        self.assertEqual(sorted(files), [name, f"tone_{r.GRAND_PIANO['id']}.json"])
        self.assertFalse(set(files) & set(folder()), 'never reuses an original file name')
        root = ET.fromstring(files[name])
        self.assertEqual((root.get('version'), root.findtext('arrangementId'), root.findtext('songId')), ('19', KEYS, SONG))
        self.assertEqual((root.findtext('keyLower'), root.findtext('keyUpper')), ('28', '44'))
        notes = root.findall('levels/level/notes/note')
        self.assertEqual(len(notes), 3)
        # Untouched notes keep fingering, articulation and notation exactly.
        first = next(n for n in notes if n.get('midi') == '60')
        self.assertEqual((first.get('rightHand'), first.get('accent')), ('1', '1'))
        added = next(n for n in notes if n.get('midi') == '64')
        self.assertEqual({k: added.get(k) for k in ('clef', 'fret', 'name', 'octave', 'staff', 'string')},
                         {'clef': 'treble', 'fret': '44', 'name': 'E', 'octave': '4', 'staff': '1', 'string': '0'})
        # 3.0 s is beat 3 of bar 2 on the offset-corrected timeline.
        self.assertEqual([b.attrib for b in added.findall('beats/beat')], [{'dots': '0', 'length': '1.0000', 'measure': '2', 'position': '4.0000'}])
        for tag in ('chords', 'handShapes', 'anchors', 'tuplets'):
            self.assertIsNotNone(root.find(f'levels/level/{tag}'), tag)
        self.assertEqual({a.get('fret') for a in root.findall('levels/level/anchors/anchor')}, {'28'})
        self.assertEqual({p.get('maxDifficulty') for p in root.findall('phrases/phrase')}, {'0'})
        self.assertEqual(root.find('toneIterations/toneIteration').get('toneId'), r.GRAND_PIANO['id'])
        self.assertIn('arrangementInfoList', report['warnings'][0])

    def test_new_keys_part_gets_a_stable_id_and_free_revision(self):
        project = open_folder()
        notes = [{'id': f'n{i}', 'time': 2 + i * 0.5, 'sustain': 0.4, 'string': p_ // 24, 'fret': p_ % 24, 'pitch': p_, 'techniques': {}}
                 for i, p_ in enumerate((57, 60, 64, 67))]
        project['arrangements'].append({'id': 'piano', 'name': 'Piano', 'type': 'keys', 'stringCount': 6, 'tuning': [0] * 6, 'basePitches': [],
                                        'capo': 0, 'notes': notes, 'chords': [], 'chord_templates': [], 'anchors': [], 'handshapes': []})
        first, _ = r.rplus_folder(project)
        again, _ = r.rplus_folder(project)
        name = next(n for n in first if n.startswith('Official_Keyboard1_'))
        self.assertEqual(name, next(n for n in again if n.startswith('Official_Keyboard1_')))
        self.assertTrue(name.endswith('_v1.xml'))
        root = ET.fromstring(first[name])
        # Unassigned hands split at middle C; A3 sits on the bass staff.
        self.assertEqual([(n.get('midi'), n.get('staff')) for n in root.findall('levels/level/notes/note')],
                         [('57', '0'), ('60', '1'), ('64', '1'), ('67', '1')])
        self.assertEqual([e.get('code') for e in root.findall('events/event')], ['Key:C', 'tone:grandpiano'])

    def test_existing_tone_file_is_not_rewritten(self):
        project = open_folder(**{f"tone_{r.GRAND_PIANO['id']}.json": b'{}'})
        next(a for a in project['arrangements'] if a['type'] == 'keys')['notes'][0]['sustain'] = 0.5
        files, _ = r.rplus_folder(project)
        self.assertEqual([n for n in files if n.startswith('tone_')], [])

    def test_export_tree_wrapper(self):
        project = open_folder()
        next(a for a in project['arrangements'] if a['type'] == 'keys')['notes'].pop()
        tree, report = e.rplus_folder(project)
        self.assertEqual(sorted(tree.entries), sorted(w['file'] for w in report['written']) + [f"tone_{r.GRAND_PIANO['id']}.json"])


class NotationTests(unittest.TestCase):
    grid = r._grid({'beats': [{'time': i * 0.5, 'measure': i // 4 + 1 if i % 4 == 0 else -1} for i in range(17)]})

    def test_note_across_a_barline_is_tied(self):
        # Starts on beat 4 of bar 1 and lasts two beats.
        pieces = r._beats_for(self.grid, 1.5, 0.9375)
        self.assertEqual([(b['measure'], b['position'], b['length'], b['dots']) for b in pieces], [(1, 4.0, 1.0, 0), (2, 1.0, 1.0, 0)])

    def test_dotted_values(self):
        pieces = r._beats_for(self.grid, 0.0, 0.6875)
        self.assertEqual([(b['length'], b['dots']) for b in pieces], [(1.0, 1)])

    def test_key_guess(self):
        self.assertEqual(r.guess_key([60, 62, 64, 65, 67, 69, 71, 72, 64, 67, 60]), 'C')
        self.assertEqual(r.guess_key([58, 61, 65, 58, 61, 65, 63, 66, 68, 70]), 'Bbm')


class ChordNameTests(unittest.TestCase):
    def test_unnamed_shapes_are_named_by_sound_in_the_tuning_not_over_the_capo(self):
        arr = {'type': 'guitar', 'basePitches': p.BASES['guitar'], 'tuning': [0] * 6, 'capo': 0,
               'chord_templates': [{'name': '', 'displayName': '', 'frets': [3, 2, 0, 0, 3, 3]},
                                   {'name': 'Mine', 'displayName': '', 'frets': [3, 2, 0, 0, 3, 3]}]}
        self.assertEqual(p.name_chord_templates(arr), 1)
        self.assertEqual([t['name'] for t in arr['chord_templates']], ['G', 'Mine'])
        arr['chord_templates'][0]['name'] = arr['chord_templates'][0]['displayName'] = ''
        arr.update(tuning=[-1] * 6, capo=3)
        p.name_chord_templates(arr)
        self.assertEqual(arr['chord_templates'][0]['name'], 'F#')


class WemTests(unittest.TestCase):
    def test_wwise_detection(self):
        import tempfile
        import routes
        with tempfile.TemporaryDirectory() as directory:
            wem = Path(directory) / 'song.bin'
            wem.write_bytes(b'RIFF\x00\x00\x00\x00WAVEfmt \x10\x00\x00\x00\xff\xff' + b'\x00' * 8)
            plain = Path(directory) / 'song.wav'
            plain.write_bytes(b'RIFF\x00\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00' + b'\x00' * 8)
            self.assertTrue(routes.is_wwise_audio(wem))
            self.assertFalse(routes.is_wwise_audio(plain))


if __name__ == '__main__':
    unittest.main()
