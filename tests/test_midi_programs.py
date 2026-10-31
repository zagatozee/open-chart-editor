"""Actual production MIDI program source/rig/merge regression tests."""
import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import unittest
import zipfile
from unittest.mock import patch
from probe_midi_programs import own_midi
from probe_midi_programs import track
from subprocess import run as run_process
from test_pack_io import project as audio_fixture
ROOT=Path(__file__).resolve().parents[1]
import pack_io as p
m=p._midi_programs

def source(tracks):
    return b'MThd'+struct.pack('>IHHH',6,0 if len(tracks)==1 else 1,len(tracks),480)+b''.join(track(events) for events in tracks)

def voices(project):
    script="import {resolveGuideVoice,guideVoiceTimelineDTO} from './src/guide-voice.js';let raw='';for await(const part of process.stdin)raw+=part;const p=JSON.parse(raw),a=p.arrangements[0];console.log(JSON.stringify({regions:[0,.5].map(time=>{const v=resolveGuideVoice(a,{rigLibrary:p.rigLibrary,time});return {time,source:v.source,family:v.family,program:v.program}}),timeline:guideVoiceTimelineDTO(a,{rigLibrary:p.rigLibrary})}))"
    return json.loads(run_process(['node','--input-type=module','-e',script],input=json.dumps(project),text=True,capture_output=True,cwd=ROOT,check=True).stdout)


def backing(project):
    fixture=audio_fixture()['_pack'];project.setdefault('_pack',{}).setdefault('manifest',{})['stems']=fixture['manifest']['stems'];project['_pack'].setdefault('entries',{}).update(fixture['entries']);return project

def rewrite(archive,name,content):
    result=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(archive)) as old,zipfile.ZipFile(result,'w') as new:
        for member in old.namelist():new.writestr(member,content if member==name else old.read(member))
    return result.getvalue()

class MidiProgramTests(unittest.TestCase):
    def test_actual_import_one_parse_single_payload_and_timed_native_voice(self):
        self.assertEqual(Path(p.__file__).resolve(),(ROOT/'pack_io.py').resolve())
        data=own_midi()
        with patch.object(p,'_timeline',wraps=p._timeline) as calls:project=p.load_project(data,'own.mid');self.assertEqual(calls.call_count,1)
        self.assertNotIn('source',project['_import']);self.assertEqual(m.source_bytes(project),data);self.assertEqual(p.save_project(project,'json')[0].count(base64.b64encode(data)),1)
        self.assertEqual([(r['family'],r['program']) for r in voices(project)['regions']],[('pipe',73),('strings',40)]);self.assertTrue(any('approximate GM' in w for w in project['import_warnings']))
        import jsonschema
        jsonschema.validate(project['rigLibrary'],json.loads(Path(r'I:\Dev\freedBack\feedback-feedpak-spec\schemas\rigs.schema.json').read_text(encoding='utf-8')))

    def test_native_roundtrip_edited_chart_and_source_binding(self):
        data=own_midi();project=backing(p.load_project(data,'own.mid'));project['arrangements'][0]['notes'][0].update(pitch=72,string=3,fret=0);before=copy.deepcopy(project)
        archive=p.save_feedpak(project)
        with patch.object(p,'_midi_stream',wraps=p._midi_stream) as calls:reopened=p.load_project(archive,'own.feedpak');self.assertEqual(calls.call_count,1)
        reopened=p.load_project(p.save_project(reopened,'json')[0],'own.json');self.assertEqual(m.source_bytes(reopened),data);self.assertEqual(reopened['arrangements'][0]['notes'][0]['pitch'],72);self.assertEqual(reopened['arrangements'][0]['midiProgramIntent'],project['arrangements'][0]['midiProgramIntent']);self.assertEqual(voices(reopened),voices(project));self.assertTrue(any('approximate GM' in w for w in reopened['import_warnings']));self.assertEqual(project,before)

    def test_unknown_future_or_malformed_sidecar_preserves_opaque_bytes_no_guess(self):
        archive=p.save_feedpak(backing(p.load_project(own_midi(),'own.mid')))
        for content in [b'{bad',b'['*1000+b']'*1000,json.dumps({'format':m.FORMAT,'version':2}).encode(),b'{"unrelated":true}']:
            restored=p.load_project(rewrite(archive,m.PATH,content),'own.feedpak');self.assertNotIn('_import',restored);self.assertNotIn('midiProgramIntent',restored['arrangements'][0]);self.assertEqual(base64.b64decode(restored['_pack']['entries'][m.PATH]),content);self.assertTrue(any('withheld' in w for w in restored['import_warnings']))
            again=p.load_project(p.save_feedpak(restored),'own.feedpak');self.assertEqual(base64.b64decode(again['_pack']['entries'][m.PATH]),content)

    def test_source_native_and_manifest_rig_tamper_withhold_without_reimporting(self):
        project=backing(p.load_project(own_midi(),'own.mid'));archive=p.save_feedpak(project)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:doc=json.loads(z.read(m.PATH));manifest=p.yaml.safe_load(z.read('manifest.yaml'))
        ref=doc['sources'][0];restored=p.load_project(rewrite(archive,ref['entry'],b'changed'),'own.feedpak');self.assertNotIn('_import',restored);self.assertNotIn('midiProgramIntent',restored['arrangements'][0])
        with zipfile.ZipFile(io.BytesIO(archive)) as z:raw=json.loads(z.read(doc['arrangements'][0]['native']['entry']))
        raw['notes'][0]['f']=1
        restored=p.load_project(rewrite(archive,doc['arrangements'][0]['native']['entry'],json.dumps(raw).encode()),'own.feedpak');self.assertNotIn('midiProgramIntent',restored['arrangements'][0]);self.assertEqual(m.source_bytes(restored),own_midi())
        # Changing only the manifest rig reference must also invalidate the owned authoring binding.
        changed=copy.deepcopy(manifest);changed['rigs']=doc['arrangements'][0]['native']['entry']
        with self.assertRaises(p.ProjectError):p.load_project(rewrite(archive,'manifest.yaml',p.yaml.safe_dump(changed).encode()),'own.feedpak')
        # An entry tone override pointing at an unresolved rig id is lenient at the contract level
        # (FeedPak §4): the pack still opens, with a warning, rather than being refused outright.
        # The owned MIDI authoring binding is still correctly withheld, since the entry no longer
        # hashes to what store() originally wrote.
        changed=copy.deepcopy(manifest);changed['arrangements'][0]['tones']={'base':'Different source','base_rig':'different'}
        restored=p.load_project(rewrite(archive,'manifest.yaml',p.yaml.safe_dump(changed).encode()),'own.feedpak')
        self.assertNotIn('midiProgramIntent',restored['arrangements'][0])
        self.assertEqual(restored['arrangements'][0]['tones']['base_rig'],'different')
        self.assertTrue(any('missing rig id' in w for w in restored['import_warnings']))

    def test_invalid_canonical_ref_and_reserved_collision_are_transactional(self):
        project=backing(p.load_project(own_midi(),'own.mid'));project['_pack']['entries'][m.PATH]=base64.b64encode(b'{"unrelated":true}').decode();before=copy.deepcopy(project)
        with self.assertRaises(p.ProjectError):p.save_feedpak(project)
        self.assertEqual(project,before)
        for field,value in [('entry','../source.mid'),('sha256','0'*64),('size',1)]:
            bad=copy.deepcopy(project);bad['_import']['sourceRef'][field]=value
            with self.assertRaises(p.ProjectError):p.save_project(bad,'json')

    def test_merged_arr_ids_rig_ids_source_paths_and_warped_bindings_survive_native(self):
        data=own_midi();incoming=p.load_project(data,'own.mid');target=audio_fixture();before_target=copy.deepcopy(target);before_source=copy.deepcopy(incoming)
        merged=p.merge_projects(target,incoming,offset=2)['project'];self.assertEqual(target,before_target);self.assertEqual(incoming,before_source)
        imported=merged['arrangements'][-1];self.assertNotEqual(imported['id'],incoming['arrangements'][0]['id']);self.assertEqual(imported['tones']['changes'][0]['time'],2.5);self.assertNotEqual(imported['tones']['base_rig'],incoming['arrangements'][0]['tones']['base_rig']);self.assertTrue(imported['midiProgramIntent']['sourceRef']['entry'].startswith('imports/import-'))
        encoded=p.save_project(merged,'json')[0];self.assertEqual(encoded.count(base64.b64encode(data)),1)
        reopened=p.load_project(p.save_feedpak(merged),'own.feedpak');reopened=p.load_project(p.save_project(reopened,'json')[0],'own.json');arr=reopened['arrangements'][-1];self.assertEqual(m.source_bytes(reopened,arr['midiProgramIntent']['sourceRef']),data);self.assertEqual(arr['id'],imported['id']);normalized=copy.deepcopy(arr['tones']);[change.pop('t',None) for change in normalized.get('changes',[])];self.assertEqual(normalized,imported['tones']);self.assertEqual(arr['midiProgramIntent'],imported['midiProgramIntent'])
        # Existing production resolver sees remapped native rigs at the imported attacks.
        custom=copy.deepcopy(reopened);custom['arrangements']=[arr];arr['tones']['changes'][0]['time']=.5;self.assertEqual([r['program'] for r in voices(custom)['regions']],[73,40])

    def test_repeated_same_source_merge_reuses_one_payload_with_distinct_parts_and_rigs(self):
        data=own_midi();incoming=p.load_project(data,'own.mid');target=audio_fixture();first=p.merge_projects(target,incoming)['project'];second=p.merge_projects(first,incoming,offset=1)['project']
        self.assertEqual(p.save_project(second,'json')[0].count(base64.b64encode(data)),1);self.assertNotEqual(second['arrangements'][-1]['id'],second['arrangements'][-2]['id']);self.assertNotEqual(second['arrangements'][-1]['tones']['base_rig'],second['arrangements'][-2]['tones']['base_rig'])
        reopened=p.load_project(p.save_feedpak(second),'own.feedpak');self.assertEqual(len([a for a in reopened['arrangements'] if a.get('midiProgramIntent')]),2);self.assertEqual(p.save_project(reopened,'json')[0].count(base64.b64encode(data)),1)

    def test_all_uncertain_channels_keep_raw_intent_and_original_source(self):
        notes=[(0,b'\x92\x3c\x64'),(480,b'\x82\x3c\0')]
        for data in [own_midi(1),source([notes[:1]+[(0,b'\xc2\x49')]+notes[1:]]),source([[(0,b'\xb2\0\x01'),(0,b'\xc2\x49')]+notes]),source([[(0,b'\xf0\x03\x7d\x01\xf7'),(0,b'\xc2\x49')]+notes])]:
            project=p.load_project(data,'own.mid');arr=project['arrangements'][0];self.assertEqual(arr['midiProgramIntent']['interpretation'],'raw');self.assertNotIn('tones',arr);self.assertEqual(m.source_bytes(project),data);self.assertTrue(any('withheld' in w for w in project['import_warnings']))

    def test_absent_programs_keep_old_inline_source_and_no_added_guide(self):
        data=source([[(0,b'\x92\x3c\x64'),(480,b'\x82\x3c\0')]]);project=p.load_project(data,'own.mid');self.assertEqual(base64.b64decode(project['_import']['source']),data);self.assertNotIn('sourceRef',project['_import']);self.assertNotIn('_pack',project);self.assertNotIn('midiProgramIntent',project['arrangements'][0])

    def test_canonical_raw_intent_cannot_lie_about_program_source(self):
        project=p.load_project(own_midi(),'own.mid');bad=copy.deepcopy(project);bad['arrangements'][0]['midiProgramIntent']['events'][0]['value']=1;before=copy.deepcopy(bad)
        with self.assertRaisesRegex(p.ProjectError,'does not match'):p.save_project(bad,'json')
        self.assertEqual(bad,before)
        malformed=copy.deepcopy(project);malformed['arrangements'][0]['midiProgramIntent'].pop('sourceRef')
        with self.assertRaises(p.ProjectError):p.save_project(malformed,'json')

    def test_malformed_owned_collision_refuses_and_stale_metadata_replacement_keeps_exact_backup(self):
        project=backing(p.load_project(own_midi(),'own.mid'));archive=p.save_feedpak(project)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:metadata=z.read(m.PATH);doc=json.loads(metadata);native=json.loads(z.read(doc['arrangements'][0]['native']['entry']))
        known=p.load_project(archive,'own.feedpak');tampered=copy.deepcopy(doc);tampered['arrangements'][0]['intent']['events'][0]['value']=1;known['_pack']['entries'][m.PATH]=base64.b64encode(json.dumps(tampered).encode()).decode()
        with self.assertRaises(p.ProjectError):p.save_feedpak(known)
        native['notes'][0]['f']=1;stale=p.load_project(rewrite(archive,doc['arrangements'][0]['native']['entry'],json.dumps(native).encode()),'own.feedpak');replacement=p.save_feedpak(stale)
        with zipfile.ZipFile(io.BytesIO(replacement)) as z:self.assertEqual(z.read('editor/midi-program-sources/'+m.digest(metadata)+'.json'),metadata)

    def test_source_cache_eviction_and_concurrent_validation_do_not_change_results(self):
        from concurrent.futures import ThreadPoolExecutor
        original=own_midi();projects=[]
        for program in [73,74,75,76,77,78]:
            data=original.replace(b'\xc2\x49',bytes([0xc2,program]),1);projects.append(p.load_project(data,'own.mid'))
        with ThreadPoolExecutor(max_workers=3) as pool:
            results=list(pool.map(lambda project:p.save_project(project,'json')[0],projects*2))
        self.assertEqual(results[:6],results[6:]);self.assertLessEqual(len(m._STREAMS),4)

    def test_malformed_arrangement_containers_direct_save_remains_project_error(self):
        for value in [None,{},['bad'],[None],[1]]:
            bad=audio_fixture();bad['arrangements']=value;before=copy.deepcopy(bad)
            with self.assertRaises(p.ProjectError):p.save_project(bad,'json')
            self.assertEqual(bad,before)

    def test_source_track_must_be_a_genuine_note_track_for_the_original_channel(self):
        data=own_midi(1);project=backing(p.load_project(data,'own.mid'))
        for track_id in [999,0]:
            bad=copy.deepcopy(project);bad['arrangements'][0]['midiProgramIntent']['sourceTrack']=track_id
            with self.assertRaises(p.ProjectError):p.save_project(bad,'json')
        archive=p.save_feedpak(project)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:doc=json.loads(z.read(m.PATH))
        for track_id in [999,0]:
            bad=copy.deepcopy(doc);bad['arrangements'][0]['intent']['sourceTrack']=track_id
            restored=p.load_project(rewrite(archive,m.PATH,json.dumps(bad).encode()),'own.feedpak');self.assertNotIn('midiProgramIntent',restored['arrangements'][0]);self.assertTrue(any('withheld' in w for w in restored['import_warnings']))

    def test_bank_only_source_has_precise_no_program_disclosure_without_invented_voice(self):
        data=source([[(0,b'\xb2\0\x01'),(0,b'\xb2\x20\0'),(0,b'\x92\x3c\x64'),(480,b'\x82\x3c\0')]])
        project=p.load_project(data,'own.mid');arr=project['arrangements'][0];self.assertNotIn('tones',arr);self.assertEqual(arr['midiProgramIntent']['interpretation'],'raw');self.assertTrue(any('bank selection' in w and 'no Program Change' in w for w in project['import_warnings']))
        restored=p.load_project(p.save_feedpak(backing(project)),'own.feedpak');self.assertTrue(any('bank selection' in w and 'no Program Change' in w for w in restored['import_warnings']))

    def test_metadata_and_serialized_json_limits(self):
        project=backing(p.load_project(own_midi(),'own.mid'));before=copy.deepcopy(project)
        with patch.object(m,'MAX_METADATA',16):
            with self.assertRaises(p.ProjectError):p.save_feedpak(project)
        with patch.object(p,'MAX_BYTES',len(p.save_project(project,'json')[0])-1):
            with self.assertRaisesRegex(p.ProjectError,'reopen limit'):p.save_project(project,'json')
        self.assertEqual(project,before)

if __name__=='__main__':unittest.main()
