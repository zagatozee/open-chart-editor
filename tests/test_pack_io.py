import base64
import copy
import io
import json
import sys
import unittest
import zipfile
import struct
import wave
import zlib
import hashlib
import tempfile
from unittest.mock import patch
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pack_io as p
import yaml
try:
    import jsonschema
except ImportError:
    jsonschema=None

SCHEMAS=Path(r'I:\Dev\freedBack\feedback-feedpak-spec\schemas')


def original_png(width=16,height=16,color=(17,101,199)):
    def chunk(kind,payload):
        return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)
    pixels=(b'\x00'+bytes(color)*width)*height
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')


def original_gp_binary(version=(5,1,0),multiple=False,capo=0):
    import guitarpro
    m=guitarpro.models
    song=m.Song(title='Original GP adapter study',artist='Local author');song.tracks=[]
    rows=[('Own guitar',[64,59,55,50,45,40],25,3,6,False)]
    if multiple:
        rows=[('Own 7 string',[64,59,55,50,45,40,35],25,3,7,False),('Own 5 bass',[43,38,33,28,23],33,2,1,False),('Piano',[64,59,55,50,45,40],0,0,1,False),('Drums',[0]*6,0,36,1,True)]
    for index,(name,pitches,program,value,string,drum) in enumerate(rows):
        track=m.Track(song,number=index+1,name=name,strings=[m.GuitarString(i+1,pitch) for i,pitch in enumerate(pitches)],channel=m.MidiChannel(channel=9 if drum else index*2,effectChannel=9 if drum else index*2+1,instrument=program),isPercussionTrack=drum)
        song.tracks.append(track)
        track.offset=capo
        measure=m.Measure(track,song.measureHeaders[0]);track.measures=[measure]
        voice=measure.voices[0];beat=m.Beat(voice,start=960,status=m.BeatStatus.normal,duration=m.Duration(value=4));voice.beats=[beat]
        beat.notes=[m.Note(beat,value=value,string=string,type=m.NoteType.normal)]
    output=io.BytesIO();guitarpro.write(song,output,version=version)
    return output.getvalue()


def original_gpif():
    return b'''<GPIF><Score><Title>Original GPIF study</Title><Artist>Local author</Artist></Score><Tracks><Track id="0"><Name>Own guitar</Name><Property name="Tuning"><Pitches>40 45 50 55 59 64</Pitches></Property></Track></Tracks><MasterBars><MasterBar><Time>4/4</Time><Bars>0</Bars></MasterBar></MasterBars><Bars><Bar id="0"><Voices>0</Voices></Bar></Bars><Voices><Voice id="0"><Beats>0</Beats></Voice></Voices><Beats><Beat id="0"><Rhythm ref="r0"/><Notes>0</Notes></Beat></Beats><Notes><Note id="0"><Property name="String"><String>0</String></Property><Property name="Fret"><Fret>3</Fret></Property></Note></Notes><Rhythms><Rhythm id="r0"><NoteValue>Quarter</NoteValue></Rhythm></Rhythms></GPIF>'''


def project(kind='guitar', count=6):
    audio=io.BytesIO()
    with wave.open(audio,'wb') as wav:
        wav.setparams((1,2,8000,0,'NONE','not compressed'));wav.writeframes(b'\x00\x00'*800)
    return {'version':1,'title':'Original test chart','artist':'Author','duration':12,'beats':[{'time':0,'measure':1},{'time':0.5,'measure':-1}], 'sections':[{'name':'verse','number':1,'start_time':2}], 'arrangements':[{'id':'lead','name':'Lead','type':kind,'stringCount':count,'tuning':[0]*count,'notes':[{'id':'n1','time':2,'string':0,'fret':3,'sustain':0.5,'techniques':{'pm':True,'bn':1,'bnv':[{'t':0,'v':0},{'t':0.5,'v':1}]}}],'chords':[],'chord_templates':[],'anchors':[],'handshapes':[]}], '_pack':{'manifest':{'stems':[{'id':'full','file':'audio/original.wav','default':True}]},'entries':{'audio/original.wav':base64.b64encode(audio.getvalue()).decode('ascii')}}}


def archive(entries):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as z:
        for name,value in entries.items():
            z.writestr(name,value)
    return output.getvalue()


def psarc_fixture(directory,pcm=False,multiple=False):
    root=Path(directory);source=b'PSAR'+b'original bounded mock package source'*3
    wav=base64.b64decode(project()['_pack']['entries']['audio/original.wav'])
    if pcm:
        buffer=io.BytesIO()
        with wave.open(buffer,'wb') as output:
            output.setparams((2,2,48000,0,'NONE','not compressed'));output.writeframes(b'\0'*128)
        wav=buffer.getvalue()
    roles=[('lead','bonus'),('rhythm','main'),('bass','main'),('lead','alternative'),('lead','main')] if multiple else [('lead','main')]
    rows=[];entries=[]
    for index,(role,priority) in enumerate(roles):
        song=project('bass' if role=='bass' else 'guitar',4 if role=='bass' else 6);arr=song['arrangements'][0];arr.update(role=role,priority=priority)
        if multiple:
            arr['difficulties']=[{'difficulty':0,'notes':[],'chords':[],'anchors':[],'handshapes':[]},{'difficulty':4,'notes':copy.deepcopy(arr['notes']),'chords':[],'anchors':[],'handshapes':[]}];arr['activeDifficulty']=4
        xml=root/f'arr{index}.xml';xml.write_bytes(p.save_xml(song))
        manifest=root/f'manifest{index}.json';manifest.write_text(json.dumps({'Entries':{'entry':{'Attributes':{'Tone_Base':'OwnClean','Tones':[{'Key':'OwnClean','Name':'OwnClean','Volume':'-12','GearList':{'Amp':{'Key':'Amp_Test','KnobValues':{'own':.5}}}}]}}}}))
        rows.append({'xml':str(xml),'manifest':str(manifest),'sourceName':f'songs/arr{index}.sng','kind':'instrumental','role':role,'priority':priority,'bank':'song_own.bnk','dlcKey':'OwnSource','levels':2 if multiple else 1})
    if multiple:
        xml=root/'vocals.xml';xml.write_bytes(p.save_vocal_xml({**project(),'vocals':[{'id':'v','time':2,'length':.5,'text':'Own'}]}))
        rows.append({'xml':str(xml),'sourceName':'songs/vocals.sng','kind':'vocals','role':'vocals','priority':'main','bank':'song_own.bnk','dlcKey':'OwnSource'})
    audio=[]
    for preview in (False,True):
        native=root/('preview.wem' if preview else 'full.wem')
        native.write_bytes(wav if pcm else b'RIFF'+struct.pack('<I',40)+b'WAVEfmt '+struct.pack('<I',16)+struct.pack('<HHIIHH',0xffff,2,48000,192000,4,16)+b'data'+struct.pack('<I',4)+b'own!')
        decoded=root/('preview.wav' if preview else 'full.wav');decoded.write_bytes(wav)
        name='audio/preview.wem' if preview else 'audio/full.wem'
        audio.append({'bank':'song_own_preview.bnk' if preview else 'song_own.bnk','preview':preview,'sourceName':name,'path':str(native),'decoded':str(decoded),'volume':-11.5})
        entries.append({'sourceName':name,'path':str(native),'size':native.stat().st_size,'sha256':hashlib.sha256(native.read_bytes()).hexdigest()})
    return source,{'sourceSha256':hashlib.sha256(source).hexdigest(),'arrangements':rows,'audio':audio,'entries':entries,'art':[],'platform':'PC','warnings':['Compiled chart reconstruction; source details unavailable.']}


class PackIOTests(unittest.TestCase):
    def test_guide_voice_override_is_lossless_namespaced_and_schema_compatible(self):
        for kind in ('guitar','keys','drums'):
            song=project(kind);arr=song['arrangements'][0]
            if kind=='drums':arr['notes']=[{'time':2,'piece':'snare','velocity':99}]
            setting={'version':1,'family':'pipe','program':73,'futureParameter':{'keep':['own',2]}}
            arr['guideVoice']=setting
            before=copy.deepcopy(song)
            packed=p.save_feedpak(song)
            self.assertEqual(song,before)
            with zipfile.ZipFile(io.BytesIO(packed)) as z:
                manifest=yaml.safe_load(z.read('manifest.yaml'));entry=manifest['arrangements'][0]
                native=json.loads(z.read(entry.get('file',entry.get('drum_tab'))))
                self.assertEqual(native['oceGuideVoice'],setting)
                self.assertNotIn('rigs',manifest)
                if jsonschema and SCHEMAS.exists():
                    schema='drum-tab.schema.json' if kind=='drums' else 'arrangement.schema.json'
                    jsonschema.validate(native,json.loads((SCHEMAS/schema).read_text()))
            loaded=p.load_feedpak(packed)
            self.assertEqual(loaded['arrangements'][0]['guideVoice'],setting)
            self.assertEqual(p.load_project(p.save_project(loaded,'json')[0])['arrangements'][0]['guideVoice'],setting)
            del loaded['arrangements'][0]['guideVoice']
            cleared=p.load_feedpak(p.save_feedpak(loaded))['arrangements'][0]
            self.assertNotIn('guideVoice',cleared);self.assertNotIn('oceGuideVoice',cleared['_wire'])

    def test_guide_voice_future_setting_and_null_preserved_without_native_rig_generation(self):
        for setting in ({'version':2048,'unknownEngine':{'uri':'https://invalid.example/never-load','bytes':'opaque'}},None):
            song=project();song['arrangements'][0]['guideVoice']=setting
            loaded=p.load_feedpak(p.save_feedpak(song))
            self.assertEqual(loaded['arrangements'][0]['guideVoice'],setting)
            self.assertNotIn('rigs',loaded['_pack']['manifest'])
            self.assertNotIn('rigLibrary',loaded)
        with patch.object(p,'MAX_GUIDE_VOICE',3):
            with self.assertRaisesRegex(p.ProjectError,'64 KiB'):p.save_feedpak(song)

    def test_native_rig_audition_context_preserves_source_bytes_bindings_and_effect_data(self):
        song=project('keys')
        library={'version':1,'futureLibrary':True,'rigs':[
            {'id':'own-pipe','blocks':[{'role':'source','intent':{'kind':'instrument','gm':{'program':73}},'realizations':[{'engine':'unknown','ref':'https://invalid.example/no-assets'}]}, {'role':'effect','intent':{'kind':'future-effect'},'opaqueParameters':{'keep':.25}}]},
            {'id':'own-muted','blocks':[{'role':'source','bypassed':True,'intent':{'kind':'instrument','gm':{'program':48}}}]}]}
        raw=b'// original rig comment\n'+json.dumps(library,indent=4).encode()+b'\n'
        song['_pack']['manifest']['rigs']='sound/original-rigs.jsonc'
        song['_pack']['entries']['sound/original-rigs.jsonc']=base64.b64encode(raw).decode()
        song['arrangements'][0]['tones']={'base':'Own pipe','base_rig':'own-pipe','changes':[{'time':3,'name':'Own muted','rig':'own-muted','opaque':7}],'unknownBinding':True}
        loaded=p.load_feedpak(p.save_feedpak(song))
        self.assertEqual(loaded['rigLibrary'],library)
        expected_binding=copy.deepcopy(song['arrangements'][0]['tones']);expected_binding['changes'][0]['t']=3
        self.assertEqual(loaded['arrangements'][0]['tones'],expected_binding)
        loaded['arrangements'][0]['guideVoice']={'version':1,'family':'brass','program':56}
        loaded['rigLibrary']['rigs'][0]['blocks'][0]['intent']['gm']['program']=0
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(loaded))) as z:
            self.assertEqual(z.read('sound/original-rigs.jsonc'),raw)
            manifest=yaml.safe_load(z.read('manifest.yaml'))
            self.assertEqual(manifest['rigs'],'sound/original-rigs.jsonc')
        reopened=p.load_feedpak(p.save_feedpak(loaded))
        self.assertEqual(reopened['rigLibrary'],library)
        self.assertEqual(reopened['arrangements'][0]['tones'],expected_binding)

    def test_invalid_rig_stream_is_rejected_but_valid_oversized_audition_context_preserved(self):
        for source in (b'not-json',b'{"version":1,"rigs":{}}'):
            song=project();song['_pack']['manifest']['rigs']='rigs.json'
            song['_pack']['entries']['rigs.json']=base64.b64encode(source).decode()
            before=copy.deepcopy(song)
            with self.assertRaises(p.ProjectError):p.save_feedpak(song)
            self.assertEqual(song,before)
        source=b'{"version":1,"rigs":[]}'
        song=project();song['_pack']['manifest']['rigs']='rigs.json'
        song['_pack']['entries']['rigs.json']=base64.b64encode(source).decode()
        with patch.object(p,'MAX_RIG_LIBRARY',10):loaded=p.load_feedpak(p.save_feedpak(song))
        self.assertNotIn('rigLibrary',loaded)
        self.assertTrue(any('rig audition context unavailable' in warning for warning in loaded['import_warnings']))
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(loaded))) as z:self.assertEqual(z.read('rigs.json'),source)
        song=project();song['_pack']['manifest']['rigs']='missing-rigs.json'
        with self.assertRaisesRegex(p.ProjectError,'missing'):p.save_feedpak(song)

    def test_custom_drum_kit_and_difficulty_authoring_survive_feedpak(self):
        song=project('drums');arr=song['arrangements'][0]
        arr['notes']=[{'id':'own','time':2,'sustain':0,'piece':'own-custom-metal','velocity':96}]
        arr['_wire']={'kit':[{'id':'own-custom-metal','name':'Original custom kit','future':True}]}
        loaded=p.load_feedpak(p.save_feedpak(song))['arrangements'][0]
        self.assertEqual(loaded['notes'][0]['piece'],'own-custom-metal');self.assertEqual(loaded['_wire']['kit'],arr['_wire']['kit'])
        arr['difficulties']=[{'difficulty':0,'notes':[]},{'difficulty':1,'notes':copy.deepcopy(arr['notes'])}];arr['activeDifficulty']=1
        p.save_project(song,'json')
        restored=p.load_feedpak(p.save_feedpak(song))['arrangements'][0]
        self.assertEqual(restored['difficulties'],p._snapshot_arrangement(arr)['difficulties'])

    def test_drum_tone_edits_survive_feedpak_instead_of_being_silently_discarded(self):
        song=project('drums');arr=song['arrangements'][0]
        arr['notes']=[{'id':'own','time':2,'sustain':0,'piece':'kick','velocity':96}]
        arr['tones']={'base':'KitA','changes':[{'time':2,'name':'KitB'}],'definitions':{'KitA':{'opaque':True,'data':1},'KitB':{'opaque':True,'data':2}}}
        restored=p.load_feedpak(p.save_feedpak(song))['arrangements'][0]
        self.assertEqual(restored['tones']['base'],'KitA')
        self.assertEqual(restored['tones']['changes'],[{'name':'KitB','t':2,'time':2}])
        self.assertEqual(restored['tones']['definitions']['KitA'],{'opaque':True,'data':1,'name':'KitA'})
        self.assertEqual(restored['tones']['definitions']['KitB'],{'opaque':True,'data':2,'name':'KitB'})

    def test_guide_voice_rig_binding_is_explicit_opt_in_and_does_not_mutate_the_caller(self):
        song=project('keys');arr=song['arrangements'][0]
        arr['notes']=[{'id':'n','time':0,'sustain':0,'fret':60}]
        arr['guideVoice']={'version':1,'family':'piano','program':0}
        # Without the explicit opt-in flag, the guide voice stays an editor-only
        # preview and never touches tones/rigs.json.
        unopted=p.load_feedpak(p.save_feedpak(song))['arrangements'][0]
        self.assertNotIn('rigLibrary',p.load_feedpak(p.save_feedpak(song)))
        self.assertNotIn('base_rig',unopted.get('tones',{}))
        arr['writeGuideVoiceRig']=True
        before=copy.deepcopy(song)
        packed=p.save_feedpak(song)
        self.assertEqual(song,before)
        loaded=p.load_feedpak(packed)
        bound=loaded['arrangements'][0]
        self.assertEqual(bound['tones']['base_rig'],'oce-guide-lead')
        self.assertEqual(loaded['rigLibrary'],{'version':1,'rigs':[{'id':'oce-guide-lead','blocks':[{'role':'source','intent':{'kind':'instrument','family':'piano','gm':{'program':0}}}]}]})
        # A second part bound in the same save gets a disambiguated id and the
        # mute flag becomes an author-silence `bypassed` block, without disturbing
        # the first part's rig.
        other=p._import_arrangement('other','Other','keys');other['notes']=[{'id':'n','time':0,'sustain':0,'fret':60}];other['guideVoice']={'version':1,'family':'strings','program':42};other['writeGuideVoiceRig']=True;other['guideVoiceMuted']=True
        song['arrangements'].append(other)
        loaded2=p.load_feedpak(p.save_feedpak(song))
        rigs={rig['id']:rig for rig in loaded2['rigLibrary']['rigs']}
        self.assertEqual(set(rigs),{'oce-guide-lead','oce-guide-other'})
        self.assertEqual(rigs['oce-guide-other']['blocks'][0]['bypassed'],True)

    def test_drum_authoring_sidecar_native_highest_and_live_low_level_roundtrip(self):
        song=project('drums');arr=song['arrangements'][0]
        low={'id':'low','time':2,'sustain':.75,'piece':'snare','velocity':77,'ghost':True}
        high={'id':'high','time':3,'sustain':0,'piece':'kick','velocity':120,'flam':True,'choke':.2}
        arr.update(notes=[low],chord_templates=[{'frets':[3,-1,-1,-1,-1,-1]}],chords=[{'id':'strum','time':4,'chord_id':0,'notes':[{'time':4,'piece':'snare','velocity':88}]}],anchors=[{'time':2,'fret':3,'width':4}],handshapes=[{'chord_id':0,'start_time':2,'end_time':5}],activeDifficulty=2)
        arr['difficulties']=[{'difficulty':2,'notes':[]},{'difficulty':9,'notes':[high],'chords':[],'anchors':[],'handshapes':[]}]
        before=copy.deepcopy(song)
        packed=p.save_feedpak(song)
        self.assertEqual(song,before)
        with zipfile.ZipFile(io.BytesIO(packed)) as z:
            manifest=yaml.safe_load(z.read('manifest.yaml'));name=manifest['arrangements'][0]['drum_tab']
            native=z.read(name);hits=json.loads(native)['hits']
            self.assertEqual([(h['t'],h['p'],h['v']) for h in hits],[(3,'kick',120)])
            sidecar=json.loads(z.read(p.DRUM_AUTHORING_PATH))
            self.assertEqual(sidecar['arrangements'][0]['sha256'],hashlib.sha256(native).hexdigest())
            if jsonschema and SCHEMAS.exists():
                jsonschema.validate(json.loads(native),json.loads((SCHEMAS/'drum-tab.schema.json').read_text()))
        restored=p.load_feedpak(packed)['arrangements'][0]
        for field in p.DRUM_AUTHORING_FIELDS:
            if field in arr:self.assertEqual(restored[field],p._snapshot_arrangement(arr)[field],field)
        self.assertTrue(p.drum_export_warnings(song))
        self.assertEqual(p.load_feedpak(p.save_feedpak(p.load_feedpak(packed)))['arrangements'][0]['notes'],[low])

    def test_drum_authoring_stale_hash_withholds_and_preserves_source_sidecar(self):
        song=project('drums');arr=song['arrangements'][0]
        arr['notes']=[{'id':'authored','time':2,'sustain':1,'piece':'snare','velocity':96}]
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(song))) as z:entries={name:z.read(name) for name in z.namelist()}
        original=entries[p.DRUM_AUTHORING_PATH]
        row=json.loads(original)['arrangements'][0];native=json.loads(entries[row['drum_tab']]);native['hits'][0]['p']='kick'
        entries[row['drum_tab']]=json.dumps(native).encode()
        loaded=p.load_feedpak(archive(entries));restored=loaded['arrangements'][0]
        self.assertEqual(restored['notes'][0]['piece'],'kick');self.assertEqual(restored['notes'][0]['sustain'],0)
        self.assertTrue(any('withheld' in w for w in loaded['import_warnings']))
        self.assertEqual(base64.b64decode(loaded['_pack']['entries'][p.DRUM_AUTHORING_PATH]),original)
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(loaded))) as z:
            backup='editor/drum-authoring-sources/'+hashlib.sha256(original).hexdigest()+'.json'
            self.assertEqual(z.read(backup),original)
        self.assertEqual(p.load_feedpak(p.save_feedpak(loaded))['arrangements'][0]['notes'][0]['piece'],'kick')

    def test_drum_authoring_reserved_collision_bounds_and_legacy_song_alias(self):
        song=project('drums');arr=song['arrangements'][0]
        arr['notes']=[{'time':2,'piece':'snare','velocity':96,'sustain':0}]
        song['_pack']['entries'][p.DRUM_AUTHORING_PATH]=base64.b64encode(b'opaque unrelated source').decode()
        with self.assertRaisesRegex(p.ProjectError,'unrelated source'):p.save_feedpak(song)
        del song['_pack']['entries'][p.DRUM_AUTHORING_PATH]
        with patch.object(p,'MAX_DRUM_AUTHORING',20):
            with self.assertRaisesRegex(p.ProjectError,'16 MiB'):p.save_feedpak(song)
        song['arrangements'].append(project()['arrangements'][0]);song['arrangements'][1]['id']='other'
        arr['_entry']={'_songLevel':True}
        restored=p.load_feedpak(p.save_feedpak(song))
        self.assertEqual(len(restored['arrangements']),2)
        self.assertEqual(restored['arrangements'][0]['id'],'lead')
        self.assertEqual(restored['arrangements'][0]['notes'],arr['notes'])

    def test_drum_authoring_unchanged_is_stable_and_removed_track_cannot_reappear(self):
        song=project('drums');arr=song['arrangements'][0]
        arr['notes']=[{'id':'own','time':2,'piece':'snare','velocity':96,'sustain':.5}]
        packed=p.save_feedpak(song);loaded=p.load_feedpak(packed)
        with zipfile.ZipFile(io.BytesIO(packed)) as z:original=z.read(p.DRUM_AUTHORING_PATH)
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(loaded))) as z:
            self.assertEqual(z.read(p.DRUM_AUTHORING_PATH),original)
            self.assertFalse(any(name.startswith('editor/drum-authoring-sources/') for name in z.namelist()))
        loaded['arrangements']=[project()['arrangements'][0]]
        loaded['arrangements'][0]['id']='replacement'
        result=p.load_feedpak(p.save_feedpak(loaded))
        self.assertEqual([arr['type'] for arr in result['arrangements']],['guitar'])
        backup='editor/drum-authoring-sources/'+hashlib.sha256(original).hexdigest()+'.json'
        self.assertEqual(base64.b64decode(result['_pack']['entries'][backup]),original)

    def test_native_drum_hits_include_every_highest_chord_voice_without_deduplication(self):
        song=project('drums');arr=song['arrangements'][0]
        arr['notes']=[{'id':'live-low','time':1,'piece':'kick','velocity':70}]
        voices=[{'id':'a','piece':'snare','velocity':91,'ghost':True,'flam':False,'choke':.15},
                {'id':'b','time':3,'piece':'snare','velocity':109,'ghost':False,'flam':True,'choke':.4},
                {'t':3,'p':'own-metal','v':87,'g':True,'f':True,'k':.2,'opaque':'retained'}]
        arr.update(activeDifficulty=0,difficulties=[{'difficulty':0,'notes':[]},
            {'difficulty':5,'notes':[{'id':'single','time':3,'piece':'snare','velocity':115}],
             'chords':[{'id':'group','time':3,'notes':voices}],'anchors':[],'handshapes':[]}])
        before=copy.deepcopy(song)
        packed=p.save_feedpak(song)
        self.assertEqual(song,before)
        with zipfile.ZipFile(io.BytesIO(packed)) as z:
            manifest=yaml.safe_load(z.read('manifest.yaml'));native=json.loads(z.read(manifest['arrangements'][0]['drum_tab']))
            self.assertEqual([(hit['t'],hit['p'],hit['v'],hit['g'],hit['f'],hit['k']) for hit in native['hits']],
                [(3,'snare',115,False,False,0),(3,'snare',91,True,False,.15),(3,'snare',109,False,True,.4),(3,'own-metal',87,True,True,.2)])
            self.assertEqual(native['hits'][3]['opaque'],'retained')
            if jsonschema and SCHEMAS.exists():jsonschema.validate(native,json.loads((SCHEMAS/'drum-tab.schema.json').read_text()))
        restored=p.load_feedpak(packed)['arrangements'][0]
        self.assertEqual(restored['difficulties'][1]['chords'][0]['notes'],voices)
        self.assertEqual(restored['notes'],arr['notes'])
        arr['difficulties'][1]['chords'][0]['notes'][0]['velocity']=0
        with self.assertRaisesRegex(p.ProjectError,'velocity'):p.save_feedpak(song)

    def test_drum_authoring_malformed_rows_and_backup_collision_fail_transactionally(self):
        song=project('drums');song['arrangements'][0]['notes']=[{'time':2,'piece':'snare','velocity':96,'sustain':0}]
        packed=p.save_feedpak(song)
        with zipfile.ZipFile(io.BytesIO(packed)) as z:entries={name:z.read(name) for name in z.namelist()}
        original=entries[p.DRUM_AUTHORING_PATH];document=json.loads(original)
        for change in ('duplicate','invalid_note'):
            malformed=copy.deepcopy(document)
            if change=='duplicate':malformed['arrangements'].append(copy.deepcopy(malformed['arrangements'][0]))
            else:malformed['arrangements'][0]['authoring']['notes'][0]['time']=-1
            with self.assertRaises(p.ProjectError):p.load_feedpak(archive({**entries,p.DRUM_AUTHORING_PATH:json.dumps(malformed)}))
        with patch.object(p,'MAX_DRUM_AUTHORING',20):
            with self.assertRaisesRegex(p.ProjectError,'16 MiB'):p.load_feedpak(packed)
        loaded=p.load_feedpak(packed)
        backup='editor/drum-authoring-sources/'+hashlib.sha256(original).hexdigest()+'.json'
        loaded['_pack']['entries'][backup]=base64.b64encode(b'unrelated original source').decode()
        loaded['arrangements'][0]['notes'][0]['velocity']=70
        before=copy.deepcopy(loaded)
        with self.assertRaisesRegex(p.ProjectError,'conflicting source data'):p.save_feedpak(loaded)
        self.assertEqual(loaded,before)

    def test_every_stored_level_and_chord_child_is_validated_without_mutating_project(self):
        for malformed in [
            {'time':float('nan'),'string':0,'fret':3}, {'time':2,'string':99,'fret':3},
            {'time':2,'string':0,'fret':3,'sustain':-1}, {'time':2,'string':0,'fret':3,'velocity':128},
            {'time':2,'string':0,'fret':3,'techniques':{'bend_values':[{'t':1,'v':0},{'t':0,'v':1}]}},
        ]:
            for placement in ('notes','child'):
                song=project();arr=song['arrangements'][0]
                arr['chord_templates']=[{'frets':[3,-1,-1,-1,-1,-1]}]
                level={'difficulty':4,'notes':[],'chords':[],'anchors':[],'handshapes':[]}
                if placement=='notes':level['notes']=[malformed]
                else:level['chords']=[{'time':2,'chord_id':0,'notes':[malformed]}]
                arr['difficulties']=[level];arr['activeDifficulty']=4
                before=json.dumps(song,sort_keys=True)
                for format in ('json','feedpak','xml'):
                    with self.assertRaises(p.ProjectError):p.save_project(song,format)
                    self.assertEqual(json.dumps(song,sort_keys=True),before)

    def test_inherited_chord_attack_serializes_full_canonical_voices_and_keys_metadata(self):
        song=project();arr=song['arrangements'][0]
        arr['chord_templates']=[{'frets':[3,-1,-1,-1,-1,-1]}]
        arr['chords']=[{'time':2,'chord_id':0,'notes':[{'string':0,'fret':3,'sustain':.5,'techniques':{'palm_mute':True}}]}]
        loaded=p.load_feedpak(p.save_feedpak(song))['arrangements'][0]['chords'][0]['notes'][0]
        self.assertEqual((loaded['time'],loaded['string'],loaded['fret'],loaded['sustain']),(2,0,3,.5))
        self.assertTrue(loaded['techniques']['palm_mute'])
        native=ET.fromstring(p.save_xml(song)).find('./levels/level/chords/chord/chordNote')
        self.assertEqual((native.get('fret'),native.get('palmMute')),('3','1'))
        keys=project('keys');keys['arrangements'][0]['chords']=[{'time':2,'notes':[{'pitch':73,'hand':'lh','velocity':0,'sustain':1,'techniques':{},'_wire':{'future':'preserved'}}]}]
        packed=p.load_feedpak(p.save_feedpak(keys));chord=packed['arrangements'][0]['chords'][0]
        self.assertIsNone(chord['chord_id']);self.assertEqual((chord['notes'][0]['pitch'],chord['notes'][0]['hand'],chord['notes'][0]['velocity']),(73,'lh',0))
        self.assertEqual(chord['notes'][0]['_wire']['future'],'preserved')

    def test_structural_references_and_lane_intervals_fail_precisely_but_unused_empty_templates_survive(self):
        for key,value in [('anchors',[{'time':1,'fret':3,'width':0}]),('handshapes',[{'chord_id':0,'start_time':2,'end_time':1}]),('chords',[{'time':2,'chord_id':5,'notes':[]}])]:
            song=project();song['arrangements'][0].update(chord_templates=[{}],**{key:value})
            with self.assertRaises(p.ProjectError):p.validate_project(song)
        song=project();song['arrangements'][0]['chord_templates']=[{}, {'frets':[-1]*8,'fingers':[-1]*8,'future':{'keep':True}}]
        self.assertEqual(p.load_feedpak(p.save_feedpak(song))['arrangements'][0]['chord_templates'],song['arrangements'][0]['chord_templates'])
        song['arrangements'][0]['chords']=[{'time':2,'chord_id':0,'notes':[{'time':3,'string':0,'fret':3}]}]
        with self.assertRaisesRegex(p.ProjectError,'must equal its chord attack'):p.validate_project(song)

    def test_native_partial_chord_import_restores_all_template_pitches_and_stock_loss_guards(self):
        song=project();arr=song['arrangements'][0]
        arr['chord_templates']=[{'frets':[3,5,-1,-1,-1,-1],'fingers':[0,2,-1,-1,-1,-1]}]
        arr['chords']=[{'time':2,'chord_id':0,'notes':[]}]
        native=ET.fromstring(p.save_xml(song));chord=native.find('./levels/level/chords/chord')
        ET.SubElement(chord,'chordNote',string='0',fret='3',sustain='.5',palmMute='1')
        imported=p.load_xml(ET.tostring(native));voices=imported['arrangements'][0]['chords'][0]['notes']
        self.assertEqual([(n['string'],n['fret']) for n in voices],[(0,3),(1,5)])
        self.assertEqual(voices[1]['techniques']['left_hand'],2)
        p.save_xml(imported)
        arr['chords'][0]['notes']=[{'string':0,'fret':4,'techniques':{}}]
        p.save_feedpak(song)
        with self.assertRaisesRegex(p.ProjectError,'native packaging changes pitches'):p.save_xml(song)
        song=project();song['arrangements'][0]['notes'][0]['techniques']['bend_values']=[{'t':i/100,'v':i/100} for i in range(33)]
        p.save_feedpak(song)
        with self.assertRaisesRegex(p.ProjectError,'32 bend points'):p.save_xml(song)

    def test_custom_open_pitches_export_effective_native_tuning_without_source_mutation(self):
        song=project();arr=song['arrangements'][0]
        arr['basePitches']=[38,44,49,54,58,63];arr['tuning']=[-1,1,0,2,0,-2];arr['capo']=2
        before=copy.deepcopy(song)
        xml=p.save_xml(song);root=ET.fromstring(xml)
        self.assertEqual([int(root.find('tuning').get(f'string{i}')) for i in range(6)],[-3,0,-1,1,-1,-3])
        self.assertEqual(song,before)
        restored=p.load_xml(xml)['arrangements'][0]
        self.assertEqual([b+t for b,t in zip(restored['basePitches'],restored['tuning'])],[b+t for b,t in zip(arr['basePitches'],arr['tuning'])])

    def test_custom_open_pitches_feedpak_native_wire_and_authoring_layout_roundtrip(self):
        for kind,count in [('guitar',6),('guitar',8),('bass',5),('bass',6)]:
            with self.subTest(kind=kind,count=count):
                song=project(kind,count);arr=song['arrangements'][0]
                standard=p._instrument_bases(kind,count)
                arr['basePitches']=[pitch-2+(i==2) for i,pitch in enumerate(standard)]
                arr['tuning']=[1 if i==1 else 0 for i in range(count)]
                before=copy.deepcopy(song);data=p.save_feedpak(song)
                with zipfile.ZipFile(io.BytesIO(data)) as package:
                    manifest=yaml.safe_load(package.read('manifest.yaml'));entry=manifest['arrangements'][0]
                    raw=json.loads(package.read(entry['file']))
                wire_standard=([40,45,50,55,59,64] if kind=='bass' and count==6 else standard)
                expected=[b+t-s for b,t,s in zip(arr['basePitches'],arr['tuning'],wire_standard)]
                self.assertEqual(entry['tuning'],expected);self.assertEqual(raw['tuning'],expected)
                self.assertEqual(raw['basePitches'],wire_standard)
                self.assertEqual(raw['stringCount'],count)
                self.assertEqual([b+t for b,t in zip(raw['basePitches'],raw['tuning'])],[b+t for b,t in zip(arr['basePitches'],arr['tuning'])])
                self.assertEqual(raw['oceStringLayout']['version'],2)
                self.assertEqual(raw['oceStringLayout']['authoring'],{'basePitches':arr['basePitches'],'tuning':arr['tuning']})
                restored=p.load_feedpak(data)['arrangements'][0]
                self.assertEqual(restored['basePitches'],arr['basePitches']);self.assertEqual(restored['tuning'],arr['tuning'])
                self.assertEqual(song,before)
                # A manifest edit cannot silently reapply stale authoring
                # offsets. Keep the original archive intact and refuse it.
                original_hash=hashlib.sha256(data).hexdigest()
                entry['tuning'][0]+=1
                with zipfile.ZipFile(io.BytesIO(data)) as package:entries={n:package.read(n) for n in package.namelist()}
                entries['manifest.yaml']=yaml.safe_dump(manifest).encode()
                with self.assertRaisesRegex(p.ProjectError,'stale|disagrees'):
                    p.load_feedpak(archive(entries))
                self.assertEqual(hashlib.sha256(data).hexdigest(),original_hash)
                # Explicitly dropping the editor-only record leaves public
                # bases/manifest offsets authoritative for the foreign edit.
                raw.pop('oceStringLayout')
                entries[entry['file']]=json.dumps(raw).encode()
                edited=p.load_feedpak(archive(entries))['arrangements'][0]
                self.assertEqual(edited['basePitches'],wire_standard)
                self.assertEqual(edited['tuning'],entry['tuning'])
                self.assertEqual([b+t for b,t in zip(edited['basePitches'],edited['tuning'])],[(b+t)+(1 if i==0 else 0) for i,(b,t) in enumerate(zip(arr['basePitches'],arr['tuning']))])

    def test_external_extended_layout_without_editor_base_extension_gets_correct_standard(self):
        for kind,count in [('guitar',8),('bass',5)]:
            raw={'stringCount':count,'tuning':[0]*count,'notes':[]}
            arr=p._arrangement(raw,{'id':'own','name':kind,'type':kind},0)
            self.assertEqual(arr['basePitches'],p._instrument_bases(kind,count))

    def test_implicit_chord_known_thumb_finger_is_retained(self):
        song=project();arr=song['arrangements'][0]
        arr['chord_templates']=[{'name':'Own thumb','frets':[3,-1,-1,-1,-1,-1],'fingers':[0,-1,-1,-1,-1,-1]}]
        arr['chords']=[{'time':2,'chord_id':0,'notes':[]}]
        loaded=p.load_feedpak(p.save_feedpak(song))
        self.assertEqual(loaded['arrangements'][0]['chords'][0]['notes'][0]['techniques']['left_hand'],0)
        xml=ET.fromstring(p.save_xml(loaded))
        self.assertEqual(xml.find('./levels/level/chords/chord/chordNote').get('leftHand'),'0')

    def test_teaching_fields_validate_domains_across_hidden_levels(self):
        for field,value in [('bend_type',5),('left_hand',5),('strum_group',-2),('scale_degree',12),('pick_direction',2),('right_hand',-2),('tap',128)]:
            song=project();arr=song['arrangements'][0]
            arr['difficulties']=[{'difficulty':0,'notes':[{'techniques':{field:value}}]}]
            with self.assertRaises(p.ProjectError):p.save_project(song,'json')

    def test_native_numeric_tap_survives_feedpak_and_clears_without_stale_extension(self):
        song=project();song['arrangements'][0]['notes'][0]['techniques']['tap']=3
        imported=p.load_xml(p.save_xml(song));imported['_pack']=copy.deepcopy(song['_pack'])
        self.assertEqual(imported['arrangements'][0]['notes'][0]['techniques']['tap'],3)
        packed=p.load_feedpak(p.save_feedpak(imported))
        note=packed['arrangements'][0]['notes'][0]
        self.assertIs(note['_wire']['tp'],True);self.assertEqual(note['_wire']['tap'],3)
        self.assertEqual(ET.fromstring(p.save_xml(packed)).find('./levels/level/notes/note').get('tap'),'3')
        note['techniques']['tap']=False
        cleared=p.load_feedpak(p.save_feedpak(packed))['arrangements'][0]['notes'][0]
        self.assertFalse(cleared['techniques']['tap']);self.assertNotIn('tap',cleared['_wire'])

    def test_unmuting_one_inherited_chord_voice_clears_parent_but_preserves_other_voices(self):
        song=project();arr=song['arrangements'][0]
        arr['notes']=[];arr['chord_templates']=[{'name':'Own','frets':[1,3,3,-1,-1,-1],'fingers':[-1]*6}]
        arr['chords']=[{'time':2,'chord_id':0,'fhm':True,'notes':[]}]
        imported=p.load_xml(p.save_xml(p.load_feedpak(p.save_feedpak(song))))
        imported['_pack']=copy.deepcopy(song['_pack'])
        chord=imported['arrangements'][0]['chords'][0]
        self.assertTrue(all(n['techniques']['mute'] for n in chord['notes']))
        chord['notes'][0]['techniques'].update(mute=False,fret_hand_mute=False)
        element=ET.fromstring(p.save_xml(imported)).find('./levels/level/chords/chord')
        self.assertEqual(element.get('fretHandMute'),'0')
        self.assertEqual([n.get('mute') for n in element.findall('chordNote')],['0','1','1'])
        p.validate_cdlc_strings(imported,[imported['arrangements'][0]['id']])
        rebuilt=p.load_feedpak(p.save_feedpak(imported))['arrangements'][0]['chords'][0]
        self.assertFalse(rebuilt['_wire'].get('fhm',False))
        self.assertFalse(rebuilt['notes'][0]['techniques']['fret_hand_mute'])

    def test_native_slap_pluck_sentinels_mute_alias_and_advisory_fields(self):
        song=project();note=song['arrangements'][0]['notes'][0]
        note['techniques']={'pluck':False,'slap':False,'pick_direction':-1,'fret_hand_mute':True,'bend_type':4,'strum_group':9,'scale_degree':3}
        element=ET.fromstring(p.save_xml(song)).find('./levels/level/notes/note')
        self.assertEqual((element.get('pluck'),element.get('slap'),element.get('mute')),('-1','-1','1'))
        for attribute in ('pickDirection','fretHandMute','bendType','chordId','scaleDegree'):self.assertNotIn(attribute,element.attrib)
        self.assertTrue(p.stock_export_warnings(song))
        loaded=p.load_xml(p.save_xml(song))['arrangements'][0]['notes'][0]
        self.assertIs(loaded['techniques']['pluck'],False);self.assertIs(loaded['techniques']['slap'],False)
        self.assertIs(loaded['techniques']['mute'],True)
        for value in (False,True):
            note['techniques'].update(pluck=value,slap=value,fret_hand_mute=value,pick_direction=1)
            element=ET.fromstring(p.save_xml(song)).find('./levels/level/notes/note')
            self.assertEqual(element.get('pluck'),'1' if value else '-1')
            self.assertEqual(element.get('slap'),'1' if value else '-1')
            self.assertEqual(element.get('mute'),str(int(value)))
            self.assertEqual(element.get('pickDirection'),'1')
        note['techniques'].update(pluck=False,slap=False)
        restored=p.load_feedpak(p.save_feedpak(song))['arrangements'][0]['notes'][0]
        for key in ('pluck','slap','bend_type','strum_group','scale_degree'):
            self.assertEqual(restored['techniques'][key],note['techniques'][key])
        raw=p._xml_note(ET.fromstring('<note time="1" string="0" fret="3" pluck="0" slap="0" unknownNative="yes"/>'),0)
        self.assertTrue(raw['techniques']['pluck']);self.assertTrue(raw['techniques']['slap'])
        self.assertEqual(p._emit_note(raw).get('unknownNative'),'yes')
        legacy={'time':1,'string':0,'fret':3,'techniques':{'pluck':-1,'slap':0}}
        self.assertEqual((p._emit_note(legacy).get('pluck'),p._emit_note(legacy).get('slap')),('-1','1'))
        self.assertIs(p._wire_note(legacy)['plk'],False);self.assertIs(p._wire_note(legacy)['slp'],True)

    def test_keys_zero_velocity_survives_json_and_feedpak_but_drums_require_attack(self):
        song=project('keys');song['arrangements'][0]['notes'][0].update(pitch=60,velocity=0)
        self.assertEqual(json.loads(p.save_project(song,'json')[0])['arrangements'][0]['notes'][0]['velocity'],0)
        self.assertEqual(p.load_feedpak(p.save_feedpak(song))['arrangements'][0]['notes'][0]['velocity'],0)
        for invalid in (-1,128,True,0.5):
            song['arrangements'][0]['notes'][0]['velocity']=invalid
            with self.assertRaisesRegex(p.ProjectError,'velocity'):p.validate_project(song)
        drum=project('drums');drum['arrangements'][0]['notes'][0].update(piece='kick',velocity=0)
        with self.assertRaisesRegex(p.ProjectError,'between 1 and 127'):p.validate_project(drum)

    def test_notation_reference_baseline_retains_source_and_detaches_after_edit(self):
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(project('keys')))) as archive:
            entries={name:archive.read(name) for name in archive.namelist()}
        manifest_name=next(name for name in entries if name.endswith('.yaml'))
        manifest=yaml.safe_load(entries[manifest_name]);manifest['arrangements'][0]['notation']='notation/own.json'
        entries[manifest_name]=yaml.safe_dump(manifest).encode();entries['notation/own.json']=b'{"version":1,"staves":[],"measures":[],"original":"opaque score"}'
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w') as archive:
            for name,content in entries.items():archive.writestr(name,content)
        loaded=p.load_feedpak(data.getvalue())
        self.assertIn('_notationBaseline',loaded['arrangements'][0])
        self.assertEqual(p.notation_export_warnings(loaded),[])
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(loaded))) as archive:
            self.assertEqual(yaml.safe_load(archive.read(manifest_name))['arrangements'][0]['notation'],'notation/own.json')
        loaded['arrangements'][0]['notes'][0].update(pitch=127,hand='lh')
        self.assertIn('notation',p.notation_export_warnings(loaded)[0]['warning'])
        restored=p.load_project(p.save_project(loaded,'json')[0],'edited.json')
        self.assertTrue(p.notation_export_warnings(restored))
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(restored))) as archive:
            self.assertNotIn('notation',yaml.safe_load(archive.read(manifest_name))['arrangements'][0])
            self.assertEqual(archive.read('notation/own.json'),entries['notation/own.json'])

    def test_new_reordered_charts_never_overwrite_existing_or_opaque_members(self):
        source=project();source['arrangements'][0]['_entry']={'file':'arrangements/arr_1.json'}
        loaded=p.load_feedpak(p.save_feedpak(source))
        loaded['_pack']['entries']['arrangements/arr_0.json']=base64.b64encode(b'opaque retained member').decode()
        new=copy.deepcopy(loaded['arrangements'][0]);new.update(id='new',name='New');new['_entry']={};new['notes'][0]['fret']=9
        loaded['arrangements'].append(new)
        saved=p.save_feedpak(loaded)
        with zipfile.ZipFile(io.BytesIO(saved)) as z:
            manifest=yaml.safe_load(z.read('manifest.yaml'));paths=[entry['file'] for entry in manifest['arrangements']]
            self.assertEqual(len(set(paths)),2)
            self.assertEqual(z.read('arrangements/arr_0.json'),b'opaque retained member')
        self.assertEqual([arr['notes'][0]['fret'] for arr in p.load_feedpak(saved)['arrangements']],[3,9])
        loaded['arrangements'].reverse()
        again=p.load_feedpak(p.save_feedpak(loaded))
        self.assertEqual([(arr['id'],arr['notes'][0]['fret']) for arr in again['arrangements']],[('new',9),('lead',3)])

    def test_shared_source_chart_aliases_split_without_touching_original_bytes(self):
        packed=p.save_feedpak(project())
        with zipfile.ZipFile(io.BytesIO(packed)) as z:entries={name:z.read(name) for name in z.namelist()}
        manifest=yaml.safe_load(entries['manifest.yaml']);original=manifest['arrangements'][0]['file'];original_bytes=entries[original]
        alias=copy.deepcopy(manifest['arrangements'][0]);alias.update(id='alias',name='Alias',tuning=[-1]*6)
        manifest['arrangements'].append(alias);entries['manifest.yaml']=yaml.safe_dump(manifest).encode()
        loaded=p.load_feedpak(archive(entries));loaded['arrangements'][0]['notes'][0]['fret']=4;loaded['arrangements'][1]['notes'][0]['fret']=8
        saved=p.save_feedpak(loaded)
        with zipfile.ZipFile(io.BytesIO(saved)) as z:
            updated=yaml.safe_load(z.read('manifest.yaml'));paths=[entry['file'] for entry in updated['arrangements']]
            self.assertEqual(len(set(paths)),2);self.assertNotIn(original,paths)
            self.assertEqual(z.read(original),original_bytes)
        restored=p.load_feedpak(saved)
        self.assertEqual([arr['notes'][0]['fret'] for arr in restored['arrangements']],[4,8])
        self.assertEqual(restored['arrangements'][1]['tuning'],[-1]*6)

    def test_primary_drum_alias_deduplicates_and_deleted_source_alias_detaches(self):
        song=project();drums=project('drums')['arrangements'][0]
        drums.update(id='kit',name='Own kit',notes=[{'id':'hit','time':1,'piece':'kick','velocity':90,'sustain':0}])
        song['arrangements'].append(drums)
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(song))) as z:entries={name:z.read(name) for name in z.namelist()}
        manifest=yaml.safe_load(entries['manifest.yaml']);drum_path=manifest['arrangements'][1]['drum_tab']
        manifest['drum_tab']=drum_path;entries['manifest.yaml']=yaml.safe_dump(manifest).encode()
        loaded=p.load_feedpak(archive(entries))
        self.assertEqual([arr['id'] for arr in loaded['arrangements']],['lead','kit'])
        loaded['arrangements'].reverse()
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(loaded))) as z:
            updated=yaml.safe_load(z.read('manifest.yaml'))
            self.assertEqual(updated['drum_tab'],updated['arrangements'][0]['drum_tab'])
        loaded['arrangements']=[arr for arr in loaded['arrangements'] if arr['type']!='drums']
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(loaded))) as z:
            self.assertNotIn('drum_tab',yaml.safe_load(z.read('manifest.yaml')))
            self.assertEqual(z.read(drum_path),entries[drum_path])
        # A standalone legacy alias gains a per-arrangement pointer if it is
        # the sole remaining chart, keeping modern manifest.arrangements valid.
        manifest['arrangements']=manifest['arrangements'][:1]
        entries['manifest.yaml']=yaml.safe_dump(manifest).encode()
        legacy=p.load_feedpak(archive(entries))
        legacy['arrangements']=[arr for arr in legacy['arrangements'] if arr['type']=='drums']
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(legacy))) as z:
            updated=yaml.safe_load(z.read('manifest.yaml'))
            self.assertEqual(len(updated['arrangements']),1)
            self.assertEqual(updated['arrangements'][0]['drum_tab'],updated['drum_tab'])

    def test_cent_offset_manifest_precedence_editing_and_no_semitone_double_application(self):
        song=project();arr=song['arrangements'][0]
        arr['_wire']={'centOffset':-1200,'futurePitchMetadata':{'retain':True}}
        arr['_entry']={'file':'arrangements/own.json','centOffset':11.8,'futureEntry':True}
        loaded=p.load_feedpak(p.save_feedpak(song));part=loaded['arrangements'][0]
        self.assertEqual(part['centOffset'],11.8)
        self.assertEqual(part['notes'][0]['fret'],3);self.assertEqual(part['tuning'],[0]*6)
        part['centOffset']=-1200
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(loaded))) as z:
            manifest=yaml.safe_load(z.read('manifest.yaml'));entry=manifest['arrangements'][0]
            self.assertEqual(entry['centOffset'],-1200);self.assertTrue(entry['futureEntry'])
            raw=json.loads(z.read(entry['file']))
            self.assertNotIn('centOffset',raw);self.assertEqual(raw['futurePitchMetadata'],{'retain':True})
        self.assertEqual(p.load_xml(p.save_xml(loaded))['arrangements'][0]['centOffset'],-1200)
        part['centOffset']=11.8
        native=ET.fromstring(p.save_xml(loaded))
        self.assertEqual(native.findtext('centOffset'),'11.8')
        self.assertEqual(native.find('./levels/level/notes/note').get('fret'),'3')
        for invalid in (True,'12',float('inf'),float('nan')):
            part['centOffset']=invalid
            with self.assertRaisesRegex(p.ProjectError,'finite number'):p.save_project(loaded,'json')

    def test_original_png_cover_json_and_native_manifest_preserve_bytes(self):
        data=original_png();cover={'name':'Own cover.png','data':base64.b64encode(data).decode()}
        self.assertEqual(p.validate_cover(cover),(data,16,16,'Own cover.png'))
        song=project();song['cover']=cover
        song['_pack']['manifest']['cover']='old-original.jpg'
        song['_pack']['entries']['old-original.jpg']=base64.b64encode(b'opaque original JPEG source').decode()
        saved=p.save_feedpak(song)
        with zipfile.ZipFile(io.BytesIO(saved)) as z:
            manifest=yaml.safe_load(z.read('manifest.yaml'))
            self.assertEqual(z.read(manifest['cover']),data)
            self.assertEqual(z.read('old-original.jpg'),b'opaque original JPEG source')
        loaded=p.load_feedpak(saved)
        self.assertEqual(base64.b64decode(loaded['cover']['data']),data)
        self.assertEqual(p.load_project(p.save_project(song,'json')[0])['cover'],cover)
        loaded['cover']=None
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(loaded))) as z:
            self.assertNotIn('cover',yaml.safe_load(z.read('manifest.yaml')))
        for invalid in ({'name':'url','data':'https://example.com/art.png'},{'name':'bad.png','data':base64.b64encode(data[:-1]+b'!').decode()},{'name':'bad.png','data':base64.b64encode(b'not PNG').decode()}):
            with self.assertRaises(p.ProjectError):p.validate_cover(invalid)
        oversized=bytearray(data);oversized[16:20]=struct.pack('>I',4097)
        oversized[29:33]=struct.pack('>I',zlib.crc32(oversized[12:29])&0xffffffff)
        with self.assertRaisesRegex(p.ProjectError,'dimensions'):p.validate_cover({'data':base64.b64encode(oversized).decode()})

    def test_repeated_chord_strums_native_density_flags_and_times_roundtrip(self):
        song=project();arr=song['arrangements'][0];arr['notes']=[]
        arr['chord_templates']=[{'name':'Own','frets':[0,2,-1,-1,-1,-1],'fingers':[0,1,-1,-1,-1,-1]}]
        arr['chords']=[{'time':time,'chord_id':0,'notes':[],'highDensity':index>0,'pm':index==1,'ac':index==2} for index,time in enumerate((2,2.5,3))]
        loaded=p.load_feedpak(p.save_feedpak(song));part=loaded['arrangements'][0]
        self.assertEqual([c['highDensity'] for c in part['chords']],[False,True,True])
        self.assertEqual([c['time'] for c in part['chords']],[2,2.5,3])
        native=ET.fromstring(p.save_xml(loaded));chords=native.findall('./levels/level/chords/chord')
        self.assertEqual([c.get('highDensity') for c in chords],['0','1','1'])
        self.assertEqual([len(c.findall('chordNote')) for c in chords],[2,2,2])
        imported=p.load_xml(ET.tostring(native));imported['_pack']=song['_pack']
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(imported))) as z:
            wire=json.loads(z.read('arrangements/arr_0.json'))['chords']
            self.assertEqual([c['hd'] for c in wire],[False,True,True])
            self.assertFalse(any('highDensity' in c for c in wire))
            self.assertTrue(wire[1]['pm']);self.assertTrue(wire[2]['ac'])

    def test_force_destination_pitch_authoring_enum_survives_feedpak_but_stock_export_refuses(self):
        song=project();arr=song['arrangements'][0]
        for state in (1,2):
            arr['notes'][0]['techniques']['force_destination_pitch']=state
            with self.assertRaisesRegex(p.ProjectError,'does not support Force Destination Pitch'):p.save_xml(song)
            packed=p.save_feedpak(song)
            with zipfile.ZipFile(io.BytesIO(packed)) as z:
                self.assertEqual(json.loads(z.read('arrangements/arr_0.json'))['notes'][0]['forceDestPitch'],state)
            loaded=p.load_feedpak(packed)
            self.assertEqual(loaded['arrangements'][0]['notes'][0]['techniques']['force_destination_pitch'],state)
        loaded['arrangements'][0]['notes'][0]['techniques']['force_destination_pitch']=0
        cleared=p.load_feedpak(p.save_feedpak(loaded))
        self.assertNotIn('forceDestPitch',cleared['arrangements'][0]['notes'][0]['_wire'])
        self.assertNotIn(b'forceDestPitch',p.save_xml(cleared))
        source=ET.fromstring(p.save_xml(project()));note=source.find('./levels/level/notes/note')
        note.set('forceDestPitch','2');note.set('ownUnknownField','preserved')
        imported=p.load_xml(ET.tostring(source));part=imported['arrangements'][0]
        self.assertEqual(part['notes'][0]['techniques']['force_destination_pitch'],2)
        self.assertTrue(any('prerelease forceDestPitch' in warning for warning in imported['import_warnings']))
        with self.assertRaises(p.ProjectError):p.save_xml(imported)
        part['notes'][0]['techniques']['force_destination_pitch']=0
        native=ET.fromstring(p.save_xml(imported)).find('./levels/level/notes/note')
        self.assertNotIn('forceDestPitch',native.attrib);self.assertEqual(native.get('ownUnknownField'),'preserved')
        arr['notes'][0]['techniques']['force_destination_pitch']=True
        with self.assertRaisesRegex(p.ProjectError,'must be0'):p.save_feedpak(song)

    def test_force_destination_pitch_implicit_chord_inheritance_and_difficulty_guard(self):
        song=project();arr=song['arrangements'][0];arr['notes']=[]
        arr['chord_templates']=[{'name':'Own','frets':[0,2,-1,-1,-1,-1],'fingers':[0,1,-1,-1,-1,-1]}]
        arr['chords']=[{'time':2,'chord_id':0,'notes':[],'forceDestPitch':1}]
        loaded=p.load_feedpak(p.save_feedpak(song));part=loaded['arrangements'][0]
        self.assertEqual([n['techniques']['force_destination_pitch'] for n in part['chords'][0]['notes']],[1,1])
        with self.assertRaises(p.ProjectError):p.save_xml(loaded)
        for note in part['chords'][0]['notes']:note['techniques']['force_destination_pitch']=0
        self.assertNotIn(b'forceDestPitch',p.save_xml(loaded))
        recleared=p.load_feedpak(p.save_feedpak(loaded))
        self.assertNotIn('forceDestPitch',recleared['arrangements'][0]['chords'][0]['_wire'])
        part['difficulties']=[{'difficulty':0,'notes':[{'id':'old','time':1,'string':0,'fret':1,'sustain':0,'techniques':{'force_destination_pitch':2}}],'chords':[],'anchors':[],'handshapes':[]},{'difficulty':1,'notes':[],'chords':[],'anchors':[],'handshapes':[]}]
        part['activeDifficulty']=1
        with self.assertRaises(p.ProjectError):p.save_xml(loaded)

    def test_native_vibrato_bytes_preserved_and_feedpak_boolean_extension_cleared(self):
        song=project();arr=song['arrangements'][0]
        for strength in (0,1,40,80,120,255):
            arr['notes'][0]['techniques']={'vibrato':strength}
            xml=p.save_xml(song)
            self.assertEqual(ET.fromstring(xml).find('./levels/level/notes/note').get('vibrato'),str(strength))
            loaded=p.load_xml(xml)
            self.assertEqual(loaded['arrangements'][0]['notes'][0]['techniques']['vibrato'],strength)
            loaded['_pack']=song['_pack']
            packed=p.save_feedpak(loaded)
            with zipfile.ZipFile(io.BytesIO(packed)) as z:
                wire=json.loads(z.read('arrangements/arr_0.json'))['notes'][0]
                self.assertIs(wire['vb'],bool(strength))
                if strength:self.assertEqual(wire['vibrato'],strength)
                else:self.assertNotIn('vibrato',wire)
            restored=p.load_feedpak(packed)
            self.assertEqual(ET.fromstring(p.save_xml(restored)).find('./levels/level/notes/note').get('vibrato'),str(strength))
        edited=restored['arrangements'][0]['notes'][0]
        edited['techniques']['vibrato']=0
        cleared=p.load_feedpak(p.save_feedpak(restored))['arrangements'][0]['notes'][0]
        self.assertFalse(cleared['techniques']['vibrato']);self.assertNotIn('vibrato',cleared['_wire'])
        arr['notes'][0]['techniques']['vibrato']=True
        self.assertEqual(ET.fromstring(p.save_xml(song)).find('./levels/level/notes/note').get('vibrato'),'80')

    def test_zone_style_native_suffix_and_authoring_fields_not_in_xml(self):
        song=project();arr=song['arrangements'][0]
        arr['chord_templates']=[{'name':'Own','displayName':'Own','arp':True,'frets':[0,2,-1,-1,-1,-1],'fingers':[0,1,-1,-1,-1,-1]}]
        arr['handshapes']=[{'chord_id':0,'start_time':1,'end_time':3,'kind':'arpeggio','arp':True,'hideName':False}]
        root=ET.fromstring(p.save_xml(song))
        self.assertEqual(root.find('./chordTemplates/chordTemplate').get('displayName'),'Own-arp')
        zone=root.find('./levels/level/handShapes/handShape')
        self.assertEqual(set(zone.attrib),{'chordId','startTime','endTime'})
        loaded=p.load_feedpak(p.save_feedpak(song))
        self.assertEqual(loaded['arrangements'][0]['handshapes'][0]['kind'],'arpeggio')
        arr['handshapes'][0]['hideName']=True
        with self.assertRaisesRegex(p.ProjectError,'mutually exclusive'):p.save_xml(song)
        with self.assertRaisesRegex(p.ProjectError,'mutually exclusive'):p.save_feedpak(song)
        # Project JSON remains a lossless authoring recovery format.
        self.assertTrue(json.loads(p.save_project(song,'json')[0])['arrangements'][0]['handshapes'][0]['hideName'])
        arr['handshapes'][0].pop('hideName');arr['chord_templates'][0].pop('arp')
        with self.assertRaisesRegex(p.ProjectError,'requires its own arpeggio template'):p.save_xml(song)
        self.assertTrue(p.load_feedpak(p.save_feedpak(song))['arrangements'][0]['handshapes'][0]['arp'])

    def test_merge_remaps_scratch_links_or_explicitly_detaches_unselected_main(self):
        source=project();scratch=copy.deepcopy(source['arrangements'][0]);scratch.update(id='scratch',editorOnly=True,scratchFor='lead')
        source['arrangements'].append(scratch)
        both=p.merge_projects(project(),source)
        imported=both['project']['arrangements'][-2:]
        self.assertEqual(imported[1]['scratchFor'],imported[0]['id'])
        only=p.merge_projects(project(),source,['scratch'])
        self.assertNotIn('scratchFor',only['project']['arrangements'][-1])
        self.assertTrue(any('detached' in warning for warning in only['warnings']))

    def test_xml_average_tempo_counts_quarters_and_recovers_explicit_ts_events(self):
        song=project()
        song['beats']=[{'time':i/4,'measure':1 if i==0 else 2 if i==6 else -1} for i in range(7)]
        song['time_signatures']=[{'time':0,'ts':[6,8]}]
        root=ET.fromstring(p.save_xml(song))
        self.assertEqual(float(root.findtext('averageTempo')),120)
        self.assertEqual([float(b.get('time')) for b in root.findall('./ebeats/ebeat')],[i/4 for i in range(7)])
        loaded=p.load_xml(ET.tostring(root))
        self.assertEqual(loaded['time_signatures'],song['time_signatures'])
        self.assertEqual(loaded['beats'][0]['denominator'],8)
        self.assertNotIn('import_warnings',loaded)
        annotated=copy.deepcopy(loaded);annotated.pop('time_signatures')
        self.assertEqual(p.load_xml(p.save_xml(annotated))['time_signatures'],song['time_signatures'])
        # Three eighth intervals then two quarters: 3.5 quarters in 1.75 sec.
        song['beats']=[{'time':time,'measure':1 if i==0 else -1} for i,time in enumerate([0,.25,.5,.75,1.25,1.75])]
        song['time_signatures']=[{'time':0,'ts':[3,8]},{'time':.75,'ts':[2,4]}]
        mixed=ET.fromstring(p.save_xml(song))
        self.assertEqual(float(mixed.findtext('averageTempo')),120)
        self.assertEqual(p.load_xml(ET.tostring(mixed))['time_signatures'],song['time_signatures'])
        mixed.find('events').clear()
        unknown=p.load_xml(ET.tostring(mixed))
        self.assertNotIn('time_signatures',unknown)
        self.assertTrue(any('denominator' in warning for warning in unknown['import_warnings']))

    def test_binary_gp_capo_restored_from_public_parser_track_offset(self):
        try:data=original_gp_binary(capo=3)
        except ImportError:self.skipTest('PyGuitarPro unavailable')
        if p.feedback_core() is None:self.skipTest('Local converter unavailable')
        loaded=p.load_project(data,'own.gp5');arr=loaded['arrangements'][0]
        self.assertEqual(arr['capo'],3);self.assertEqual(arr['notes'][0]['fret'],3)
        self.assertEqual(ET.fromstring(p.save_xml(loaded)).find('./levels/level/notes/note').get('fret'),'6')

    def test_scratch_tracks_are_editable_sidecars_excluded_from_native_playable_entries(self):
        song=project();scratch=copy.deepcopy(song['arrangements'][0])
        scratch.update(id='scratch',name='Own scratch',editorOnly=True,role='rhythm')
        scratch['difficulties']=[{'difficulty':0,**{field:copy.deepcopy(scratch.get(field,[])) for field in p.LEVEL_FIELDS}}]
        scratch['activeDifficulty']=0
        song['arrangements'].append(scratch)
        saved=p.save_feedpak(song)
        with zipfile.ZipFile(io.BytesIO(saved)) as z:
            manifest=yaml.safe_load(z.read('manifest.yaml'))
            self.assertEqual([row['id'] for row in manifest['arrangements']],['lead'])
            self.assertEqual(json.loads(z.read(p.SCRATCH_PATH))['arrangements'][0]['role'],'rhythm')
        loaded=p.load_feedpak(saved)
        self.assertEqual([row['id'] for row in loaded['arrangements']],['lead','scratch'])
        self.assertTrue(loaded['arrangements'][1]['editorOnly'])
        self.assertEqual(loaded['arrangements'][1]['difficulties'][0]['notes'][0]['fret'],3)
        with self.assertRaisesRegex(p.ProjectError,'editor-only'):p.save_xml(loaded,'scratch')
        loaded['arrangements'].pop()
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(loaded))) as z:
            self.assertNotIn(p.SCRATCH_PATH,z.namelist())
        song['_pack']['entries'][p.SCRATCH_PATH]=base64.b64encode(b'Original unrelated sidecar').decode()
        with self.assertRaisesRegex(p.ProjectError,'unrelated'):p.save_feedpak(song)
        song['arrangements']=[scratch]
        with self.assertRaisesRegex(p.ProjectError,'playable arrangement'):p.save_feedpak(song)

    def test_capo_relative_xml_pitch_templates_slides_anchors_and_difficulty(self):
        song=project();arr=song['arrangements'][0];arr['capo']=3
        arr['notes'][0].update(fret=2,techniques={'slide_to':5,'slide_unpitch_to':0,'left_hand':0})
        arr['notes'].append({'id':'open','time':3,'string':1,'fret':0,'sustain':0,'techniques':{}})
        arr['chord_templates']=[{'name':'Own','frets':[0,2,-1,-1,-1,-1],'fingers':[0,1,-1,-1,-1,-1]}]
        arr['chords']=[{'time':4,'chord_id':0,'notes':[]}]
        arr['anchors']=[{'time':0,'fret':1,'width':4}]
        arr['difficulties']=[{'difficulty':0,'notes':copy.deepcopy(arr['notes']),'chords':[],'anchors':[{'time':0,'fret':2,'width':4}],'handshapes':[]},{'difficulty':2,'notes':copy.deepcopy(arr['notes']),'chords':copy.deepcopy(arr['chords']),'anchors':copy.deepcopy(arr['anchors']),'handshapes':[]}]
        arr['activeDifficulty']=2
        root=ET.fromstring(p.save_xml(song))
        for level in root.findall('./levels/level'):
            notes=level.findall('./notes/note')
            self.assertEqual([int(n.get('fret')) for n in notes],[5,0])
            self.assertEqual(notes[0].get('slideTo'),'8')
            self.assertEqual(notes[0].get('slideUnpitchTo'),'0')
            self.assertEqual(notes[0].get('leftHand'),'0')
            # Public Rocksmith2014.Conversion/Midi.fs: only native fret0 adds capo.
            for note,relative in zip(notes,(2,0)):
                native=int(note.get('fret'));base=(40,45)[int(note.get('string'))]
                self.assertEqual(base+(3 if native==0 else native),base+3+relative)
        self.assertEqual(root.find('./chordTemplates/chordTemplate').get('fret1'),'5')
        self.assertEqual(root.find('./levels/level[@difficulty="2"]/anchors/anchor').get('fret'),'4')
        loaded=p.load_xml(ET.tostring(root));part=loaded['arrangements'][0]
        self.assertEqual(part['notes'][0]['fret'],2)
        self.assertEqual(part['chord_templates'][0]['frets'][:3],[0,2,-1])
        self.assertEqual(part['chords'][0]['notes'][1]['fret'],2)
        self.assertEqual(part['difficulties'][0]['anchors'][0]['fret'],2)
        again=ET.fromstring(p.save_xml(loaded))
        self.assertEqual([n.get('fret') for n in again.findall('./levels/level/notes/note')],['5','0','5','0'])
        self.assertEqual(again.find('./chordTemplates/chordTemplate').get('fret1'),'5')
        below=copy.deepcopy(root);below.find('./levels/level/notes/note').set('fret','2')
        with self.assertRaisesRegex(p.ProjectError,'below capo'):p.load_xml(ET.tostring(below))
        arr['notes'][0]['fret']=22
        with self.assertRaisesRegex(p.ProjectError,'physical fret limit'):p.save_xml(song)

    def test_merge_preserves_backing_namespaces_sources_and_aligns_authored_timing(self):
        target=project();target.update(title='Target backing',audio={'url':'/target.wav'})
        target['beats']=[{'time':0,'measure':1},{'time':1,'measure':-1}]
        incoming=project();incoming['title']='Incoming chart'
        arr=incoming['arrangements'][0];arr['anchors']=[{'time':2,'fret':3,'width':4}]
        arr['chord_templates']=[{'name':'Own shape','frets':[3,-1,-1,-1,-1,-1],'fingers':[-1]*6}]
        arr['handshapes']=[{'chord_id':0,'start_time':2,'end_time':3}]
        arr['phrases']=[{'id':'phrase','time':0,'name':'main'}]
        arr['tones']={'base':'Own','changes':[{'time':2,'name':'Own'}],'definitions':{}}
        arr['difficulties']=[{'difficulty':0,'notes':[],'chords':[],'anchors':[],'handshapes':[]},{'difficulty':3,'notes':copy.deepcopy(arr['notes']),'chords':[],'anchors':copy.deepcopy(arr['anchors']),'handshapes':copy.deepcopy(arr['handshapes'])}]
        arr['activeDifficulty']=3
        arr['_entry']={'file':'arrangements/source.json','notation':'notation/source.json','futureReference':'preserved'}
        arr['_wire']={'phrases':[{'start_time':0,'end_time':12,'levels':[]}]}
        notation={'version':1,'staves':[{'id':'rh','clef':'G2'}],'measures':[{'idx':1,'t':0,'staves':{'rh':{'voices':[{'v':1,'beats':[{'t':2,'dur':4,'notes':[{'midi':60}]}]}]}}}]}
        incoming['_pack']['entries']['opaque.bin']=base64.b64encode(b'opaque original bytes').decode('ascii')
        incoming['_pack']['entries']['arrangements/source.json']=base64.b64encode(b'{"future":true}').decode('ascii')
        incoming['_pack']['entries']['notation/source.json']=base64.b64encode(json.dumps(notation).encode()).decode('ascii')
        incoming['vocals']=[{'id':'word','time':2,'length':0.5,'pitch':60,'text':'Own'}]
        second=copy.deepcopy(arr);second['id']='unselected';incoming['arrangements'].append(second)
        original_target=copy.deepcopy(target);original_incoming=copy.deepcopy(incoming)
        result=p.merge_projects(target,incoming,['lead'],align='beats',offset=1,include_vocals=True)
        merged=result['project'];added=merged['arrangements'][-1]
        self.assertEqual(target,original_target);self.assertEqual(incoming,original_incoming)
        for field in ('title','artist','audio','duration','beats','sections'):
            self.assertEqual(merged[field],target[field])
        self.assertEqual(len(merged['arrangements']),2)
        self.assertNotEqual(added['id'],'lead')
        self.assertEqual((added['notes'][0]['time'],added['notes'][0]['sustain']),(5,1))
        self.assertEqual(added['notes'][0]['techniques']['bnv'][1]['t'],1)
        self.assertEqual(added['difficulties'][1]['notes'][0]['time'],5)
        self.assertEqual(added['anchors'][0]['time'],5)
        self.assertEqual(added['handshapes'][0]['end_time'],7)
        self.assertEqual(added['tones']['changes'][0]['time'],5)
        self.assertEqual((merged['vocals'][0]['time'],merged['vocals'][0]['length']),(5,1))
        snapshot=merged['_imports'][0]['snapshot']
        self.assertEqual(json.loads(base64.b64decode(merged['_pack']['entries'][snapshot])),incoming)
        active_notation=json.loads(base64.b64decode(merged['_pack']['entries'][added['_entry']['notation']]))
        self.assertEqual(active_notation['measures'][0]['staves']['rh']['voices'][0]['beats'][0]['t'],5)
        self.assertEqual(added['_entry']['futureReference'],'preserved')
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(merged))) as z:
            self.assertEqual(json.loads(z.read(snapshot)),incoming)
            self.assertTrue(any(z.read(name)==b'opaque original bytes' for name in z.namelist() if name.endswith('opaque.bin')))
        excluded=p.merge_projects(target,incoming,['lead'])['project']
        self.assertNotIn('vocals',excluded)
        for options in ({'offset':-1},{'align':'unknown'},{'arrangement_ids':['missing']},{'arrangement_ids':[]}):
            with self.assertRaises(p.ProjectError):p.merge_projects(target,incoming,**options)
    def test_guitar_pro_3_4_5_and_all_tracks_extended_bass_keys_drums(self):
        try:import guitarpro
        except ImportError:self.skipTest('Installed PyGuitarPro unavailable')
        core=(p.feedback_core() or Path('missing'))/'gp2rs.py'
        if not core.is_file():self.skipTest('Installed public GP converter unavailable')
        for version,extension in [((3,0,0),'gp3'),((4,0,6),'gp4'),((5,1,0),'gp5')]:
            data=original_gp_binary(version)
            with self.subTest(version=version):
                song=p.load_project(data,'own.'+extension)
                self.assertEqual(song['title'],'Original GP adapter study')
                self.assertEqual((song['arrangements'][0]['notes'][0]['string'],song['arrangements'][0]['notes'][0]['fret']),(0,3))
                self.assertEqual(base64.b64decode(song['_import']['source']),data)
        data=original_gp_binary(multiple=True)
        song=p.load_project(data,'own.gp5')
        self.assertEqual([a['type'] for a in song['arrangements']],['guitar','bass','keys','drums'])
        self.assertEqual(song['arrangements'][0]['stringCount'],7)
        self.assertEqual(song['arrangements'][1]['stringCount'],5)
        self.assertEqual(song['arrangements'][1]['notes'][0]['string'],4)
        self.assertEqual(song['arrangements'][2]['notes'][0]['pitch'],64)
        self.assertEqual(song['arrangements'][3]['notes'][0]['piece'],'kick')
        self.assertTrue(any('restored' in warning for warning in song['import_warnings']))
        audio=project()['_pack'];song['_pack']['manifest']=audio['manifest'];song['_pack']['entries'].update(audio['entries'])
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(song))) as z:
            self.assertEqual(z.read('sources/original.gp5'),data)

    def test_guitar_pro_gpif_zip_and_gp6_bcfs_bcfz_containers(self):
        core=(p.feedback_core() or Path('missing'))/'gp2rs.py'
        if not core.is_file():self.skipTest('Installed public GP converter unavailable')
        gpif=original_gpif()
        bcfs=bytearray(4+3*4096);bcfs[:4]=b'BCFS';directory=4+4096
        struct.pack_into('<I',bcfs,directory,2);bcfs[directory+4:directory+14]=b'score.gpif'
        struct.pack_into('<I',bcfs,directory+0x8c,len(gpif));struct.pack_into('<I',bcfs,directory+0x94,2)
        bcfs[4+8192:4+8192+len(gpif)]=gpif
        chunks=[bytes(bcfs[i:i+3]) for i in range(0,len(bcfs),3)]
        bits=''.join('0'+format(len(chunk),'02b')[::-1]+''.join(format(byte,'08b') for byte in chunk) for chunk in chunks)
        bits+='0'*((-len(bits))%8)
        bcfz=b'BCFZ'+struct.pack('<I',len(bcfs))+bytes(int(bits[i:i+8],2) for i in range(0,len(bits),8))
        zipped=archive({'Content/score.gpif':gpif})
        for data,extension in [(zipped,'gp'),(zipped,'gp7'),(zipped,'gp8'),(bytes(bcfs),'gpx'),(bcfz,'gp6')]:
            with self.subTest(extension=extension):
                song=p.load_project(data,'original.'+extension)
                self.assertEqual(song['title'],'Original GPIF study')
                self.assertEqual(song['arrangements'][0]['notes'][0]['fret'],3)
                self.assertEqual(base64.b64decode(song['_import']['source']),data)
        extended=gpif.replace(b'40 45 50 55 59 64',b'30 35 40 45 50 55 59 64')
        eight=p.load_project(archive({'Content/score.gpif':extended}),'original.gp8')
        self.assertEqual(eight['arrangements'][0]['stringCount'],8)
        self.assertEqual(eight['arrangements'][0]['notes'][0]['string'],0)
        piano=gpif.replace(b'Own guitar',b'Piano')
        keys=p.load_project(archive({'Content/score.gpif':piano}),'original.gp')
        self.assertEqual(keys['arrangements'][0]['type'],'keys')
        self.assertEqual(keys['arrangements'][0]['notes'][0]['pitch'],43)
        malicious=archive({'Content/score.gpif':b'<!DOCTYPE GPIF [<!ENTITY a "x">]><GPIF>&a;</GPIF>'})
        with self.assertRaisesRegex(p.ProjectError,'entity'):
            p.load_project(malicious,'unsafe.gp')
        with self.assertRaises(p.ProjectError):p.load_project(b'not Guitar Pro','bad.gpx')
    def test_explicit_roles_survive_renaming_and_xml_priority_flags(self):
        song=project();arr=song['arrangements'][0]
        arr.update(name='My renamed part',role='rhythm',priority='bonus')
        xml=ET.fromstring(p.save_xml(song))
        self.assertEqual(xml.findtext('arrangement'),'Rhythm')
        flags=xml.find('arrangementProperties').attrib
        self.assertEqual((flags['pathLead'],flags['pathRhythm'],flags['represent'],flags['bonusArr']),('0','1','0','1'))
        imported=p.load_xml(ET.tostring(xml))['arrangements'][0]
        self.assertEqual((imported['role'],imported['priority']),('rhythm','bonus'))
        self.assertEqual(json.loads(p.save_project(song,'json')[0])['arrangements'][0]['name'],'My renamed part')
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(song))) as z:
            manifest=yaml.safe_load(z.read('manifest.yaml'))
            self.assertEqual(manifest['arrangements'][0]['name'],'My renamed part')
            self.assertEqual(manifest['arrangements'][0]['type'],'guitar')
            self.assertNotIn('role',manifest['arrangements'][0])
        arr['name']='Looks like Rhythm';arr['role']='lead';arr['priority']='alternative'
        xml=ET.fromstring(p.save_xml(song))
        self.assertEqual(xml.findtext('arrangement'),'Lead')
        self.assertEqual(xml.find('arrangementProperties').get('represent'),'0')
        self.assertEqual(xml.find('arrangementProperties').get('bonusArr'),'0')
        arr.pop('role')
        self.assertEqual(ET.fromstring(p.save_xml(song)).findtext('arrangement'),'Rhythm')
        arr['role']='bass'
        with self.assertRaisesRegex(p.ProjectError,'conflicts'):p.save_xml(song)

    def test_fixed_sng_string_limits_are_bytes_and_preserve_authoring_exports(self):
        song=project();arr=song['arrangements'][0]
        arr['chord_templates']=[{'name':'é'*16,'frets':[0]*6,'fingers':[-1]*6}]
        self.assertEqual(ET.fromstring(p.save_xml(song)).find('./chordTemplates/chordTemplate').get('chordName'),'é'*16)
        p.save_feedpak(song)
        with self.assertRaisesRegex(p.ProjectError,'31 UTF-8'):p.validate_cdlc_strings(song,['lead'])
        arr['chord_templates'][0]['name']='é'*15
        p.validate_cdlc_strings(song,['lead'])
        song['vocals']=[{'id':'v0','time':1,'length':1,'text':'é'*24}]
        p.save_vocal_xml(song)
        with self.assertRaisesRegex(p.ProjectError,'47 UTF-8'):p.validate_cdlc_strings(song,['lead'],True)

    def test_implicit_chord_templates_expand_with_parent_flags_without_invented_fingers(self):
        song=project();arr=song['arrangements'][0]
        arr['chord_templates']=[{'name':'F','frets':[1,3,3,2,1,1],'fingers':[1,-1,-1,-1,-1,-1]}]
        arr['chords']=[{'time':2,'chord_id':0,'notes':[],'pm':True,'ac':True,'futureChord':{'retain':True}}]
        loaded=p.load_feedpak(p.save_feedpak(song))
        chord=loaded['arrangements'][0]['chords'][0]
        self.assertEqual((chord['time'],chord['chord_id']),(2,0))
        self.assertEqual([n['fret'] for n in chord['notes']],[1,3,3,2,1,1])
        self.assertTrue(all(n['time']==2 and n['techniques']['palm_mute'] and n['techniques']['accent'] for n in chord['notes']))
        self.assertEqual(chord['notes'][0]['techniques']['left_hand'],1)
        self.assertTrue(all('left_hand' not in n['techniques'] for n in chord['notes'][1:]))
        packed=p.load_feedpak(p.save_feedpak(loaded))['arrangements'][0]['chords'][0]
        self.assertEqual(packed['_wire']['futureChord'],{'retain':True})
        xml=ET.fromstring(p.save_xml(loaded))
        native=xml.find('./levels/level/chords/chord')
        self.assertEqual((native.get('palmMute'),native.get('accent')),('1','1'))
        self.assertEqual(len(native.findall('chordNote')),6)
        self.assertTrue(all(n.get('palmMute')=='1' and n.get('accent')=='1' for n in native.findall('chordNote')))
        # The XML shorthand form must expand identically on import.
        for child in list(native):native.remove(child)
        native.set('futureSource','preserved')
        imported=p.load_xml(ET.tostring(xml))
        voices=imported['arrangements'][0]['chords'][0]['notes']
        self.assertEqual(len(voices),6)
        self.assertTrue(all(n['techniques']['palm_mute'] and n['techniques']['accent'] for n in voices))
        voices[0]['techniques']['palm_mute']=False
        changed=ET.fromstring(p.save_xml(imported)).find('./levels/level/chords/chord')
        self.assertEqual(changed.get('futureSource'),'preserved')
        self.assertEqual(changed.get('palmMute'),'0')
        self.assertEqual(changed.find('chordNote').get('palmMute'),'0')

    def test_chord_note_bend_curve_uses_parent_onset_as_its_time_origin(self):
        song=project();arr=song['arrangements'][0]
        arr['chord_templates']=[{'name':'Two notes','frets':[3,5,-1,-1,-1,-1],'fingers':[-1]*6}]
        arr['chords']=[{'time':4,'chord_id':0,'notes':[{'id':'bend','time':4,'string':0,'fret':3,'sustain':0.5,'techniques':{'bend':1,'bend_values':[{'t':0,'v':0},{'t':0.25,'v':1}]}},{'id':'plain','time':4,'string':1,'fret':5,'sustain':0.5,'techniques':{}}]}]
        imported=p.load_xml(p.save_xml(song))
        note=imported['arrangements'][0]['chords'][0]['notes'][0]
        self.assertEqual(note['time'],4)
        self.assertEqual(note['techniques']['bend_values'],[{'t':0,'v':0},{'t':0.25,'v':1}])
        saved=ET.fromstring(p.save_xml(imported))
        self.assertEqual(saved.find('./levels/level/chords/chord/chordNote/bendValues/bendValue[2]').get('time'),'4.25')
    def test_all_native_feedpak_exports_validate_against_installed_119_schemas(self):
        if jsonschema is None or not SCHEMAS.is_dir():
            self.skipTest('Installed public Feedpak1.19 schemas/jsonschema unavailable')
        song=project()
        for identifier,kind,count in [('extended','guitar',8),('bass','bass',5),('piano','keys',6),('drums','drums',6)]:
            arr=project(kind,count)['arrangements'][0];arr['id']=identifier
            if kind=='keys':arr['notes'][0]['pitch']=73
            if kind=='drums':arr['notes']=[{'id':'hit','time':1,'piece':'ride_bell','velocity':88,'ghost':True,'flam':True,'choke':0.2}]
            song['arrangements'].append(arr)
        song['arrangements'][3]['notes'][0].update(hand='lh',velocity=73)
        lead=song['arrangements'][0]
        lead['notes'][0]['techniques'].update(vibrato=120,force_destination_pitch=1)
        lead['tones']={'base':'Own','changes':[{'time':3,'name':'Own'}],'definitions':{'Own':{'name':'Own','GearList':{'Amp':{'Key':'Amp_Original'}}}}}
        lead['difficulties']=[{'difficulty':0,'notes':[],'chords':[],'anchors':[],'handshapes':[]},{'difficulty':3,'notes':copy.deepcopy(lead['notes']),'chords':[],'anchors':[],'handshapes':[]}]
        lead['activeDifficulty']=3
        song['beats']=[{'time':0,'measure':1,'numerator':6,'denominator':8,'meterStart':True},{'time':0.25,'measure':-1,'numerator':6,'denominator':8},{'time':1.5,'measure':2,'numerator':3,'denominator':4,'meterStart':True}]
        song['vocals']=[{'id':'v1','time':1,'length':0.3,'pitch':64,'text':'Our & own'},{'id':'v2','time':2,'length':0.2,'text':'word'}]
        keys=b'{"version":1,"events":[{"t":0,"key":"C","scale":"major"}],"future":true}'
        song['_pack']['manifest'].update(keys='keys.json',futureManifest={'preserve':True})
        song['_pack']['entries']['keys.json']=base64.b64encode(keys).decode('ascii')
        with zipfile.ZipFile(io.BytesIO(p.save_feedpak(song))) as z:
            manifest=yaml.safe_load(z.read('manifest.yaml'))
            def validate(payload,schema):
                jsonschema.Draft202012Validator(json.loads((SCHEMAS/(schema+'.schema.json')).read_text(encoding='utf-8'))).validate(payload)
            validate(manifest,'manifest')
            for arr in manifest['arrangements']:
                pointer=arr.get('file') or arr.get('drum_tab')
                validate(json.loads(z.read(pointer)),'drum-tab' if arr.get('drum_tab') else 'arrangement')
            for field,schema in [('song_timeline','song-timeline'),('lyrics','lyrics'),('vocal_pitch','vocal-pitch'),('keys','keys')]:
                validate(json.loads(z.read(manifest[field])),schema)
            self.assertEqual(z.read('keys.json'),keys)
            self.assertEqual(manifest['futureManifest'],{'preserve':True})
            timeline=json.loads(z.read(manifest['song_timeline']))
            self.assertEqual(timeline['time_signatures'],[{'time':0,'ts':[6,8]},{'time':1.5,'ts':[3,4]}])
            self.assertNotIn('numerator',timeline['beats'][0])
            self.assertEqual(json.loads(z.read(manifest['lyrics']))[0]['w'],'Our & own')

    def test_vocals_native_xml_and_feedpak_roundtrip_with_unknown_fields(self):
        song=project()
        song['vocals']=[{'id':'word1','time':1.25,'length':0.5,'pitch':65,'text':'Own & <original>'},{'id':'word2','time':2,'length':0.25,'text':'words'}]
        xml,name,mime=p.save_project(song,'vocal_xml')
        root=ET.fromstring(xml)
        self.assertEqual(root.tag,'vocals');self.assertEqual(root.get('count'),'2')
        self.assertEqual(root[0].get('lyric'),'Own & <original>')
        self.assertEqual(root[1].get('note'),'60')
        imported=p.load_project(xml,name)
        self.assertEqual(imported['vocals'][0]['pitch'],65)
        self.assertEqual(imported['vocals'][0]['length'],0.5)
        packed=p.save_feedpak(song)
        loaded=p.load_feedpak(packed)
        loaded['vocals'][0]['_lyricWire']['futureSyllable']={'keep':True}
        loaded['vocals'][0]['_pitchWire']['confidence']=0.75
        loaded['vocals'][0].update(time=1.5,length=0.75,text='Edited original',pitch=67)
        restored=p.load_feedpak(p.save_feedpak(loaded))
        vocal=restored['vocals'][0]
        self.assertEqual((vocal['time'],vocal['length'],vocal['text'],vocal['pitch']),(1.5,0.75,'Edited original',67))
        self.assertEqual(vocal['_lyricWire']['futureSyllable'],{'keep':True})
        self.assertEqual(vocal['_pitchWire']['confidence'],0.75)
        self.assertNotIn('pitch',restored['vocals'][1])
        self.assertEqual(json.loads(p.save_project(song,'json')[0])['vocals'],song['vocals'])
        for field,value in [('time',-1),('length',float('inf')),('pitch',128),('text',None)]:
            bad=copy.deepcopy(song);bad['vocals'][0][field]=value
            with self.assertRaises(p.ProjectError):p.save_project(bad,'vocal_xml')

    def test_piano_hands_absolute_pitch_and_exact_velocity_survive_authored_edits(self):
        song=project('keys');note=song['arrangements'][0]['notes'][0]
        note.update(pitch=73,hand='lh',velocity=87)
        loaded=p.load_feedpak(p.save_feedpak(song))
        restored=loaded['arrangements'][0]['notes'][0]
        self.assertEqual((restored['pitch'],restored['hand'],restored['velocity']),(73,'lh',87))
        self.assertEqual(restored['_wire']['m'],73)
        self.assertEqual(restored['_wire']['s']*24+restored['_wire']['f'],73)
        restored.update(hand='rh',velocity=32)
        reloaded=p.load_feedpak(p.save_feedpak(loaded))['arrangements'][0]['notes'][0]
        self.assertEqual((reloaded['hand'],reloaded['velocity']),('rh',32))
        restored['hand']=None
        self.assertNotIn('hand',p.load_feedpak(p.save_feedpak(loaded))['arrangements'][0]['notes'][0])
        self.assertEqual(json.loads(p.save_project(song,'json')[0])['arrangements'][0]['notes'][0]['velocity'],87)
        source=p._note({'t':1,'s':0,'f':3,'m':80,'hand':'lh','velocity':111},0,keys=True)
        self.assertEqual(source['pitch'],80)
    @staticmethod
    def midi_track(events):
        def vlq(value):
            result=[value&127];value>>=7
            while value:
                result.insert(0,128|(value&127));value>>=7
            return bytes(result)
        body=b''.join(vlq(delta)+event for delta,event in events)+b'\x00\xff\x2f\x00'
        return b'MTrk'+struct.pack('>I',len(body))+body

    def test_midi_tempo_meter_channels_running_status_and_drums(self):
        conductor=self.midi_track([(0,b'\xff\x51\x03\x07\xa1\x20'),(0,b'\xff\x58\x04\x03\x02\x18\x08'),(480,b'\xff\x51\x03\x0f\x42\x40'),(480,b'\xff\x58\x04\x04\x02\x18\x08')])
        keys=self.midi_track([(0,b'\x90\x3c\x64'),(480,b'\x91\x30\x5a'),(480,b'\x81\x30\x00'),(0,b'\x80\x3c\x00')])
        drums=self.midi_track([(0,b'\x99\x24\x70'),(120,b'\x24\x00')])
        data=b'MThd'+struct.pack('>IHHH',6,1,3,480)+conductor+keys+drums
        song=p.load_project(data,'original.mid')
        self.assertEqual(len(song['arrangements']),3)
        by_channel={a['sourceChannel']:a for a in song['arrangements']}
        self.assertEqual(by_channel[0]['notes'][0]['sustain'],1.5)
        self.assertEqual(by_channel[1]['notes'][0]['time'],0.5)
        self.assertEqual(by_channel[1]['notes'][0]['sustain'],1)
        self.assertEqual(by_channel[1]['notes'][0]['hand'],'lh')
        self.assertEqual(by_channel[9]['notes'][0]['piece'],'kick')
        self.assertEqual(by_channel[9]['notes'][0]['velocity'],112)
        self.assertEqual(song['tempos'],[{'time':0,'bpm':120},{'time':0.5,'bpm':60}])
        self.assertEqual(song['time_signatures'][1],{'time':1.5,'ts':[4,4]})
        song['_pack']=project()['_pack']
        self.assertEqual(p.load_feedpak(p.save_feedpak(song))['tempos'],song['tempos'])

    def test_midi_tempo_only_and_unsupported_cases(self):
        tempo=self.midi_track([(0,b'\xff\x51\x03\x07\xa1\x20')])
        data=b'MThd'+struct.pack('>IHHH',6,0,1,480)+tempo
        self.assertGreaterEqual(len(p.load_midi(data)['beats']),2)
        for malformed in [b'MThd'+struct.pack('>IHHH',6,2,1,480)+tempo,b'MThd'+struct.pack('>IHHH',6,0,1,0xe728)+tempo,b'MThd'+struct.pack('>IHHH',6,0,1,480)+self.midi_track([(0,b'\x90\x3c\x60')])]:
            with self.assertRaises(p.ProjectError):
                p.load_project(malformed,'test.mid')

    def test_musicxml_multiple_parts_hands_ties_tempos_and_mxl(self):
        xml=b'''<score-partwise version="4.0"><work><work-title>Original score</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part><score-part id="P2"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure number="0" implicit="yes"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/><staff>1</staff></note><backup><duration>2</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><staff>2</staff></note></measure><measure number="1" implicit="yes"><direction><sound tempo="60"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/><staff>1</staff></note></measure></part><part id="P2"><measure number="0" implicit="yes"><attributes><divisions>1</divisions><transpose><chromatic>-2</chromatic></transpose></attributes><note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration></note></measure></part></score-partwise>'''
        song=p.load_project(xml,'score.musicxml')
        self.assertEqual(len(song['arrangements']),2)
        piano=song['arrangements'][0]
        self.assertEqual(len(piano['notes']),2)
        by_pitch={n['pitch']:n for n in piano['notes']}
        self.assertEqual(by_pitch[60]['sustain'],1.5)
        self.assertEqual(by_pitch[48]['hand'],'lh')
        self.assertEqual(song['arrangements'][1]['notes'][0]['pitch'],72)
        self.assertEqual(song['tempos'][1],{'time':0.5,'bpm':60})
        compressed=archive({'META-INF/container.xml':'<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>','score.xml':xml})
        self.assertEqual(p.load_project(compressed,'score.mxl')['title'],'Original score')
        for bad in [xml.replace(b'<note>',b'<note><grace/>',1),xml.replace(b'<duration>2</duration>',b'<duration>2</duration><notations><octave-shift/></notations>',1),b'<score-timewise/>']:
            with self.assertRaises(p.ProjectError):
                p.load_project(bad,'score.musicxml')
    def test_musicxml_midi_program_binds_an_approximate_gm_rig_like_midi_import_but_respects_existing_tones(self):
        def part(id_,program=None,extra=''):
            instrument=f'<midi-instrument id="{id_}-I1"><midi-program>{program}</midi-program></midi-instrument>' if program is not None else ''
            return f'<score-part id="{id_}"><part-name>{id_}</part-name>{instrument}</score-part>',f'<part id="{id_}"><measure number="0" implicit="yes"><attributes><divisions>1</divisions></attributes><note>{extra}<pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part>'
        p1,m1=part('P1',1)
        p2,m2=part('P2',None)
        xml=('<score-partwise version="4.0"><part-list>'+p1+p2+'</part-list>'+m1+m2+'</score-partwise>').encode()
        song=p.load_project(xml,'score.musicxml')
        bound,unbound=song['arrangements']
        self.assertEqual(bound['sourceProgram'],0)
        self.assertEqual(bound['tones'],{'base':'Approximate GM program 0','base_rig':'oce-mxml-gm-0','changes':[]})
        self.assertEqual(bound['musicXmlProgramIntent'],{'version':1,'program':0})
        self.assertNotIn('sourceProgram',unbound);self.assertNotIn('tones',unbound)
        self.assertEqual(song['rigLibrary'],{'version':1,'rigs':[{'id':'oce-mxml-gm-0','name':'Approximate GM program 0','blocks':[{'role':'source','intent':{'kind':'instrument','family':'piano','gm':{'program':0}}}]}]})
        self.assertTrue(any('MusicXML <midi-program>' in w for w in song['import_warnings']))
        song['_pack']['manifest']['stems']=[{'id':'full','file':'audio/original.wav','default':True}]
        audio=io.BytesIO()
        with wave.open(audio,'wb') as wav:
            wav.setparams((1,2,8000,0,'NONE','not compressed'));wav.writeframes(b'\x00\x00'*800)
        song['_pack']['entries']['audio/original.wav']=base64.b64encode(audio.getvalue()).decode('ascii')
        reloaded=p.load_feedpak(p.save_feedpak(song))
        self.assertEqual(reloaded['arrangements'][0]['tones']['base_rig'],'oce-mxml-gm-0')
        self.assertEqual(reloaded['rigLibrary']['rigs'][0]['id'],'oce-mxml-gm-0')
        # An existing authored tones/guideVoice binding always wins over the import's rig pass.
        manual={'arrangements':[{'id':'a','sourceProgram':10,'tones':{'base':'Custom'}},{'id':'b','sourceProgram':11,'guideVoice':{'version':1,'family':'piano'}}],'import_warnings':[]}
        p._mxl_apply_programs(manual)
        self.assertEqual(manual['arrangements'][0]['tones'],{'base':'Custom'})
        self.assertNotIn('musicXmlProgramIntent',manual['arrangements'][0])
        self.assertNotIn('tones',manual['arrangements'][1])
        self.assertNotIn('rigLibrary',manual)

    def test_unknown_fields_and_opaque_assets_survive_edits(self):
        manifest={'title':'Original','artist':'Author','duration':8,'arrangements':[{'id':'lead','type':'guitar','file':'arr.json','futureEntry':{'x':5}},{'id':'notation','notation':'score.json','type':'cello'}],'stems':[{'id':'full','file':'song.wav'}], 'cover':'cover.png','futureManifest':['x'],'song_timeline':'timeline.json'}
        raw={'name':'Lead','tuning':[0]*6,'notes':[{'t':1,'s':0,'f':3,'futureNote':17,'pm':True}], 'futureArrangement':{'x':True}, 'phrases':[{'start_time':0,'end_time':8,'levels':[{'notes':[{'t':1,'s':0,'f':3}]}]}]}
        original=archive({'manifest.yaml':yaml.safe_dump(manifest),'arr.json':json.dumps(raw),'song.wav':b'RIFF arbitrary audio bytes','cover.png':b'png opaque','score.json':b'{"version":1,"staves":[],"measures":[],"futureNotation":true}','timeline.json':json.dumps({'version':1,'beats':[{'time':0,'measure':1}],'sections':[{'name':'intro','time':1}],'time_signatures':[{'time':0,'ts':[7,8]}]})})
        loaded=p.load_project(original,'test.feedpak')
        loaded['title']='Changed'
        loaded['arrangements'][0]['notes'][0]['fret']=7
        loaded['arrangements'][0]['notes'][0]['techniques']['palm_mute']=False
        result=p.save_feedpak(loaded)
        with zipfile.ZipFile(io.BytesIO(result)) as z:
            out_manifest=yaml.safe_load(z.read('manifest.yaml'))
            out_arr=json.loads(z.read('arr.json'))
            self.assertEqual(z.read('cover.png'),b'png opaque')
            self.assertEqual(z.read('song.wav'),b'RIFF arbitrary audio bytes')
            self.assertEqual(z.read('score.json'),b'{"version":1,"staves":[],"measures":[],"futureNotation":true}')
            self.assertEqual(out_manifest['futureManifest'],['x'])
            self.assertEqual(out_manifest['arrangements'][0]['futureEntry'],{'x':5})
            self.assertEqual(out_manifest['arrangements'][1]['id'],'notation')
            self.assertEqual(out_arr['notes'][0]['futureNote'],17)
            self.assertEqual(out_arr['notes'][0]['f'],7)
            self.assertFalse(out_arr['notes'][0]['pm'])
            self.assertNotIn('id',out_arr['notes'][0])
            self.assertNotIn('_wire',out_arr['notes'][0])
            self.assertEqual(out_arr['futureArrangement'],raw['futureArrangement'])
            self.assertEqual(out_arr['phrases'][0]['levels'][0]['notes'][0]['f'],7)
            self.assertEqual(json.loads(z.read('timeline.json'))['time_signatures'],[{'time':0,'ts':[7,8]}])
        self.assertEqual(p.load_feedpak(result)['sections'][0]['start_time'],1)

    def test_extended_keys_and_drums_roundtrip(self):
        song=project('guitar',8)
        song['arrangements'][0]['basePitches']=[30,35,40,45,50,55,59,64]
        song['arrangements'][0]['notes'][0]['string']=7
        keys=copy.deepcopy(song['arrangements'][0]); keys.update(id='piano',type='keys',name='Piano',stringCount=6,tuning=[0]*6)
        keys['notes']=[{'id':'p','time':1,'pitch':127,'sustain':2,'techniques':{}}]
        drums=copy.deepcopy(keys); drums.update(id='drums',type='drums',name='Drums')
        drums['notes']=[{'id':'d','time':1,'piece':'hh_open','velocity':91,'ghost':True,'flam':True,'choke':0.2}]
        song['arrangements'] += [keys,drums]
        restored=p.load_feedpak(p.save_feedpak(song))
        self.assertEqual(restored['arrangements'][0]['notes'][0]['string'],7)
        self.assertEqual(restored['arrangements'][1]['notes'][0]['pitch'],127)
        self.assertEqual(restored['arrangements'][2]['notes'][0]['piece'],'hh_open')
        self.assertTrue(restored['arrangements'][2]['notes'][0]['flam'])
        for arr in song['arrangements']:
            with self.assertRaises(p.ProjectError):
                p.save_xml(song,arr['id'])

    def test_xml_notes_techniques_beats_sections_and_chords(self):
        song=project()
        arr=song['arrangements'][0]
        arr['chord_templates']=[{'name':'A','frets':[-1,0,2,2,2,0],'fingers':[-1,-1,1,2,3,-1]}]
        arr['chords']=[{'t':3,'id':0,'notes':[{'s':1,'f':0},{'s':2,'f':2},{'s':3,'f':2},{'s':4,'f':2},{'s':5,'f':0}]}]
        arr['anchors']=[{'time':0,'fret':1,'width':4}]
        arr['handshapes']=[{'chord_id':0,'start_time':3,'end_time':4}]
        xml=p.save_xml(song)
        root=ET.fromstring(xml)
        self.assertEqual(root.get('version'),'7')
        loaded=p.load_xml(xml)
        self.assertEqual(loaded['sections'][0]['start_time'],2)
        self.assertEqual(loaded['arrangements'][0]['notes'][0]['techniques']['bend_values'],arr['notes'][0]['techniques']['bnv'])
        self.assertEqual(loaded['arrangements'][0]['chord_templates'][0]['frets'],arr['chord_templates'][0]['frets'])
        self.assertEqual(len(loaded['arrangements'][0]['chords'][0]['notes']),5)
        loaded['_pack']=project()['_pack']
        feedpak=p.save_feedpak(loaded)
        with zipfile.ZipFile(io.BytesIO(feedpak)) as z:
            wire=json.loads(z.read('arrangements/arr_0.json'))
            self.assertEqual(wire['chords'][0]['notes'][0]['s'],1)
            self.assertNotIn('_xml',wire['templates'][0])

    def test_imported_xml_retains_other_difficulty_and_unknown_data(self):
        root=ET.fromstring(p.save_xml(project()))
        root.set('future','value')
        ET.SubElement(root,'custom').text='retain'
        levels=root.find('levels')
        levels[0].set('difficulty','1')
        easy=ET.SubElement(levels,'level',difficulty='0')
        ET.SubElement(easy,'customNotes').text='keep easy'
        loaded=p.load_xml(ET.tostring(root))
        loaded['arrangements'][0]['notes'][0]['fret']=9
        saved=ET.fromstring(p.save_xml(loaded))
        self.assertEqual(saved.get('future'),'value')
        self.assertEqual(saved.findtext('custom'),'retain')
        self.assertEqual(saved.findtext('./levels/level[@difficulty="0"]/customNotes'),'keep easy')
        self.assertEqual(saved.find('./levels/level[@difficulty="1"]/notes/note').get('fret'),'9')

    def test_unsafe_paths_and_xml_entities_are_rejected(self):
        for name in ('../evil','/absolute','C:/evil','a\\b','a//b'):
            with self.subTest(name=name), self.assertRaises(p.ProjectError):
                p.load_project(archive({name:b'x'}),'bad.feedpak')
        with self.assertRaises(p.ProjectError):
            p.load_project(b'<!DOCTYPE song [<!ENTITY a "x">]><song version="7"/>','bad.xml')

    def test_encoded_xml_entities_yaml_aliases_and_zip_failures_are_actionable(self):
        malicious='<?xml version="1.0" encoding="utf-16"?><!DOCTYPE song [<!ENTITY a "expanded">]><song version="7"><title>&a;</title></song>'
        for encoding in ('utf-16','utf-16-le','utf-32'):
            with self.subTest(encoding=encoding),self.assertRaises(p.ProjectError):
                p.load_project(malicious.encode(encoding),'bad.xml')
        safe=p.save_xml(project()).decode('utf-8').replace("encoding='utf-8'","encoding='utf-16'")
        self.assertEqual(p.load_project(safe.encode('utf-16'),'safe.xml')['title'],'Original test chart')
        for manifest in ('title: Test\nfuture: &loop [*loop]\n','title: Test\nfuture: !!set {a: null}\n'):
            with self.assertRaises(p.ProjectError):p.load_project(archive({'manifest.yaml':manifest}),'bad.feedpak')
        protected=bytearray(archive({'manifest.yaml':'title: Test\n'}))
        protected[6] |= 1
        central=protected.index(b'PK\x01\x02');protected[central+8] |= 1
        with self.assertRaisesRegex(p.ProjectError,'Encrypted'):
            p.load_project(bytes(protected),'protected.feedpak')

    def test_jsonc_comments_preserve_literal_text_and_trailing_commas_are_rejected(self):
        data=b'{"text":"Keep literal, } and, ] and // words",/*comment*/"items":[1,2]}'
        result=p._decode_json(data,'original.jsonc')
        self.assertEqual(result['text'],'Keep literal, } and, ] and // words')
        self.assertEqual(result['items'],[1,2])
        with self.assertRaises(ValueError):p._decode_json(data,'strict.json')
        with self.assertRaises(ValueError):p._decode_json(b'{"items":[1,2,],}','original.jsonc')

    def test_project_validation_and_json_roundtrip(self):
        song=project()
        data,name,mime=p.save_project(song,'json')
        self.assertEqual(p.load_project(data),song)
        self.assertEqual(mime,'application/json')
        song['arrangements'][0]['notes'][0]['time']=float('nan')
        with self.assertRaises(p.ProjectError):
            p.save_project(song)

    def test_feedpak_requires_real_source_stem_bytes(self):
        song=project();song.pop('_pack')
        with self.assertRaisesRegex(p.ProjectError,'requires source audio'):
            p.save_feedpak(song)
        self.assertEqual(p.save_project(song,'json')[2],'application/json')
        song['_pack']={'manifest':{'stems':[{'id':'full','file':'missing.wav'}]},'entries':{}}
        with self.assertRaisesRegex(p.ProjectError,'missing its source bytes'):
            p.save_feedpak(song)

    def test_jsonc_reader(self):
        song=p.load_project(b'{"version":1,"arrangements":[{"id":"a","notes":[]}],"url":"http://example"/*keep string*/}','own.jsonc')
        self.assertEqual(song['url'],'http://example')

    def test_phrases_and_tones_export_and_feedpak_preservation(self):
        song=project()
        song['phrases']=[{'id':'p0','name':'intro','time':0},{'id':'p1','name':'verse','time':4}]
        song['tones']={'base':'Clean','changes':[{'time':4,'name':'Crunch'}],'definitions':{'Clean':{'gain':0.2},'Crunch':{'gain':0.8}}}
        xml=ET.fromstring(p.save_xml(song))
        self.assertEqual(xml.findtext('tonebase'),'Clean')
        self.assertEqual(xml.find('./tones/tone').get('name'),'Crunch')
        self.assertEqual(xml.find('./phraseIterations/phraseIteration[@phraseId="1"]').get('time'),'4')
        saved=p.load_feedpak(p.save_feedpak(song))
        restored=saved['arrangements'][0]
        self.assertNotIn('phrases',restored['_wire'])
        self.assertEqual(restored['tones']['base'],'Clean')
        self.assertEqual(restored['tones']['changes'][0]['time'],4)
        self.assertEqual(restored['tones']['definitions']['Clean']['gain'],0.2)

    def test_frontend_chord_and_long_technique_schema(self):
        song=project(); arr=song['arrangements'][0]
        arr['notes'][0]['techniques']={'palm_mute':True,'hammer_on':True,'slide_to':7,'bend':0.5}
        arr['chord_templates']=[{'name':'A','frets':[0]*6},{'name':'B','frets':[-1,2,-1,-1,-1,-1]}]
        arr['chords']=[{'time':4,'chord_id':1,'notes':[{'id':'c1','time':4,'string':1,'fret':2,'sustain':0.2,'techniques':{'accent':True}}]}]
        arr['tones']={'base':'Own','changes':[{'time':4,'name':'Own'}],'definitions':{'Own':{'gearList':{'Amp':{'Type':'Amp_Test'}}}}}
        xml=ET.fromstring(p.save_xml(song))
        note=xml.find('./levels/level/notes/note')
        self.assertEqual(note.get('palmMute'),'1')
        self.assertEqual(note.get('slideTo'),'7')
        self.assertEqual(xml.find('./levels/level/chords/chord').get('chordId'),'1')
        self.assertEqual(xml.findtext('tonebase'),'Own')
        loaded=p.load_feedpak(p.save_feedpak(song))['arrangements'][0]
        self.assertEqual(loaded['chords'][0]['chord_id'],1)
        self.assertEqual(loaded['chords'][0]['time'],4)
        self.assertTrue(loaded['notes'][0]['techniques']['palm_mute'])
        self.assertTrue(loaded['chords'][0]['notes'][0]['techniques']['accent'])

    def test_difficulty_ladders_snapshot_active_edits_xml_and_feedpak(self):
        song=project();arr=song['arrangements'][0]
        easy=copy.deepcopy(arr['notes'][0]);easy['fret']=1
        hard=copy.deepcopy(arr['notes'][0]);hard['fret']=9
        arr['difficulties']=[{'difficulty':0,'notes':[easy],'chords':[],'anchors':[],'handshapes':[]},{'difficulty':4,'notes':[hard],'chords':[],'anchors':[],'handshapes':[]}]
        arr['activeDifficulty']=0
        arr['notes']=[copy.deepcopy(easy)];arr['notes'][0]['fret']=2
        arr['phrases']=[{'id':'main','name':'main','time':0,'maxDifficulty':4}]
        xml=p.save_xml(song)
        loaded=p.load_xml(xml)['arrangements'][0]
        self.assertEqual([l['difficulty'] for l in loaded['difficulties']],[0,4])
        self.assertEqual(loaded['difficulties'][0]['notes'][0]['fret'],2)
        self.assertEqual(loaded['difficulties'][1]['notes'][0]['fret'],9)
        self.assertEqual(loaded['activeDifficulty'],4)
        packed=p.load_feedpak(p.save_feedpak(song))['arrangements'][0]
        self.assertEqual([l['difficulty'] for l in packed['difficulties']],[0,4])
        self.assertEqual(packed['difficulties'][0]['notes'][0]['fret'],2)
        self.assertEqual(packed['difficulties'][1]['notes'][0]['fret'],9)


if __name__=='__main__':
    unittest.main()
