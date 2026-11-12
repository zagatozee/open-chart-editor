import io
import json
import copy
import sys
import unittest
import zipfile
import tempfile
import wave
import shutil
import base64
from types import SimpleNamespace
from unittest.mock import patch
from xml.etree import ElementTree as ET
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
from fastapi.testclient import TestClient
import routes
from test_pack_io import project,original_gp_binary,original_png,psarc_fixture


class RouteTests(unittest.TestCase):
    def test_guide_voice_and_native_rig_read_context_survive_http_roundtrip(self):
        song=project('keys');setting={'version':1,'family':'pipe','program':73}
        song['arrangements'][0]['guideVoice']=setting
        raw=b'{"version":1,"rigs":[{"id":"own","blocks":[{"role":"source","bypassed":true,"intent":{"kind":"instrument","gm":{"program":73}}}]}]}'
        song['_pack']['manifest']['rigs']='sound/own-rigs.json'
        song['_pack']['entries']['sound/own-rigs.json']=base64.b64encode(raw).decode()
        response=self.client.post(self.prefix+'/save',json={'project':song,'format':'feedpak'})
        self.assertEqual(response.status_code,200,response.text)
        loaded=self.client.post(self.prefix+'/load',files={'file':('own.feedpak',response.content,'application/zip')})
        self.assertEqual(loaded.status_code,200,loaded.text)
        restored=loaded.json()['project']
        self.assertEqual(restored['arrangements'][0]['guideVoice'],setting)
        self.assertTrue(restored['rigLibrary']['rigs'][0]['blocks'][0]['bypassed'])
        saved=self.client.post(self.prefix+'/save',json={'project':restored,'format':'feedpak'})
        self.assertEqual(saved.status_code,200,saved.text)
        with zipfile.ZipFile(io.BytesIO(saved.content)) as z:self.assertEqual(z.read('sound/own-rigs.json'),raw)

    def test_drum_authoring_download_warns_and_restores_through_load(self):
        song=project('drums');arr=song['arrangements'][0]
        arr['notes']=[{'id':'own','time':2,'sustain':.25,'piece':'snare','velocity':80}]
        arr['difficulties']=[{'difficulty':0,'notes':[]},{'difficulty':3,'notes':copy.deepcopy(arr['notes'])}]
        arr['activeDifficulty']=3
        response=self.client.post(self.prefix+'/save',json={'project':song,'format':'feedpak'})
        self.assertEqual(response.status_code,200,response.text)
        warnings=json.loads(response.headers['X-OCE-Export-Warnings'])
        self.assertTrue(any('highest authored hit level' in item and 'OCE-only sidecar' in item for item in warnings))
        reopened=self.client.post(self.prefix+'/load',files={'file':('own.feedpak',response.content,'application/zip')})
        self.assertEqual(reopened.status_code,200,reopened.text)
        restored=reopened.json()['project']['arrangements'][0]
        self.assertEqual(restored['notes'],arr['notes']);self.assertEqual(restored['activeDifficulty'],3)
        self.assertEqual([row['difficulty'] for row in restored['difficulties']],[0,3])

    def test_hidden_malformed_musical_record_returns400_before_build_process(self):
        song=project();arr=song['arrangements'][0]
        arr['difficulties']=[{'difficulty':0,'notes':[]},{'difficulty':3,'notes':[{'time':2,'string':0,'fret':3,'sustain':-1}]}];arr['activeDifficulty']=0
        for format in ('json','feedpak','xml'):
            result=self.client.post(self.prefix+'/save',json={'project':song,'format':format})
            self.assertEqual(result.status_code,400,result.text);self.assertIn('difficulty 3',result.text)


    def test_stock_xml_advisory_metadata_warning_has_no_invented_attributes(self):
        song=project();song['arrangements'][0]['notes'][0]['techniques'].update(bend_type=4,strum_group=2,scale_degree=7)
        response=self.client.post(self.prefix+'/save',json={'project':song,'format':'xml'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertIn('bend_type',json.loads(response.headers['X-OCE-Export-Warnings'])[0])
        note=ET.fromstring(response.content).find('./levels/level/notes/note')
        for key in ('bendType','chordId','scaleDegree'):self.assertNotIn(key,note.attrib)

    def test_feedpak_save_reports_detached_unverified_notation(self):
        song=project('keys')
        song['arrangements'][0]['_entry']={'notation':'notation/source.json'}
        song['_pack']['entries']['notation/source.json']=base64.b64encode(b'original score bytes').decode()
        response=self.client.post(self.prefix+'/save',json={'project':song,'format':'feedpak'})
        self.assertEqual(response.status_code,200,response.text)
        warnings=json.loads(response.headers['X-OCE-Export-Warnings'])
        self.assertIn('notation',warnings[0])
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(archive.read('notation/source.json'),b'original score bytes')

    def setUp(self):
        self.app=FastAPI()
        routes.setup(self.app,{})
        self.client=TestClient(self.app)
        self.prefix=routes.PREFIX

    def tearDown(self):
        self.client.close()
        self.app.state.open_chart_editor_scratch.cleanup()

    def test_plugin_registration_health_and_load_save(self):
        count=len(self.app.routes)
        routes.setup(self.app,{})
        self.assertEqual(len(self.app.routes),count)
        self.assertTrue(self.client.get(self.prefix+'/health').json()['ok'])
        response=self.client.post(self.prefix+'/load',files={'file':('test.json',json.dumps(project()),'application/json')})
        self.assertEqual(response.status_code,200,response.text)
        loaded=response.json()['project']
        response=self.client.post(self.prefix+'/save',json={'project':loaded,'format':'xml'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertIn('attachment;',response.headers['content-disposition'])
        self.assertIn(b'<song version="7">',response.content)

    def test_upload_serve_embed_and_reload_original_audio(self):
        wave=b'RIFF\x00\x00\x00\x00WAVEfmt original user audio'
        response=self.client.post(self.prefix+'/audio',files={'file':('Original.wav',wave,'audio/wav')})
        self.assertEqual(response.status_code,200,response.text)
        audio=response.json()
        self.assertEqual(self.client.get(audio['url']).content,wave)
        song=project(); song['audio']=audio
        saved=self.client.post(self.prefix+'/save',json={'project':song,'format':'feedpak'})
        self.assertEqual(saved.status_code,200,saved.text)
        with zipfile.ZipFile(io.BytesIO(saved.content)) as z:
            self.assertEqual(z.read('audio/original.wav'),wave)
        loaded=self.client.post(self.prefix+'/load',files={'file':('test.feedpak',saved.content,'application/zip')})
        self.assertEqual(loaded.status_code,200,loaded.text)
        self.assertEqual(self.client.get(loaded.json()['project']['audio']['url']).content,wave)

    def test_json_project_embeds_audio_across_server_restart(self):
        wave=b'RIFF original persistent project audio'
        audio=self.client.post(self.prefix+'/audio',files={'file':('original.wav',wave)}).json()
        song=project();song['audio']=audio
        saved=self.client.post(self.prefix+'/save',json={'project':song,'format':'json'})
        self.assertEqual(saved.status_code,200,saved.text)
        fresh=FastAPI();routes.setup(fresh,{})
        try:
            with TestClient(fresh) as client:
                loaded=client.post(self.prefix+'/load',files={'file':('saved.oce.json',saved.content,'application/json')})
                self.assertEqual(loaded.status_code,200,loaded.text)
                self.assertEqual(client.get(loaded.json()['project']['audio']['url']).content,wave)
        finally:
            fresh.state.open_chart_editor_scratch.cleanup()

    def test_cover_upload_and_portable_json(self):
        data=original_png()
        upload=self.client.post(self.prefix+'/cover',files={'file':('Own.png',data,'image/png')})
        self.assertEqual(upload.status_code,200,upload.text)
        result=upload.json();self.assertEqual((result['width'],result['height']),(16,16))
        self.assertEqual(self.client.get(result['url']).content,data)
        self.assertEqual(self.client.get(self.prefix+'/audio/'+result['token']).status_code,404)
        song=project();song['cover']=result['cover']
        saved=self.client.post(self.prefix+'/save',json={'project':song,'format':'json'})
        fresh=FastAPI();routes.setup(fresh,{})
        try:
            with TestClient(fresh) as client:
                loaded=client.post(self.prefix+'/load',files={'file':('Own.oce.json',saved.content)}).json()['project']
                self.assertEqual(base64.b64decode(loaded['cover']['data']),data)
        finally:fresh.state.open_chart_editor_scratch.cleanup()


    def test_combiner_audio_falls_back_to_original_when_undecodable(self):
        garbage=b'RIFF\x00\x00\x00\x00WAVEfmt not real audio'
        response=self.client.post(self.prefix+'/combiner-audio',files={'file':('combined.wav',garbage,'audio/wav')})
        self.assertEqual(response.status_code,200,response.text)
        asset=response.json()
        self.assertEqual(self.client.get(asset['url']).content,garbage)

    @unittest.skipUnless(shutil.which('ffmpeg'),'FFmpeg unavailable')
    def test_combiner_audio_compresses_real_pcm_to_ogg(self):
        buffer=io.BytesIO()
        with wave.open(buffer,'wb') as writer:
            writer.setparams((1,2,22050,0,'NONE','not compressed'))
            writer.writeframes(b'\x34\x12'*22050)
        wav_bytes=buffer.getvalue()
        response=self.client.post(self.prefix+'/combiner-audio',files={'file':('combined.wav',wav_bytes,'audio/wav')})
        self.assertEqual(response.status_code,200,response.text)
        asset=response.json()
        self.assertTrue(asset['name'].endswith('.ogg'),asset['name'])
        compressed=self.client.get(asset['url']).content
        self.assertLess(len(compressed),len(wav_bytes))

    @unittest.skipUnless(shutil.which('ffmpeg'),'FFmpeg unavailable')
    def test_explicit_pcm_preview_keeps_original_export_source_and_rejects_bad_audio(self):
        buffer=io.BytesIO()
        with wave.open(buffer,'wb') as writer:
            writer.setparams((1,2,22050,0,'NONE','not compressed'))
            writer.writeframes(b'\x34\x12'*2205)
        original=buffer.getvalue()
        source=self.client.post(self.prefix+'/audio',files={'file':('own.wav',original)}).json()
        preview=self.client.post(self.prefix+'/audio-preview',json={'url':source['url']})
        self.assertEqual(preview.status_code,200,preview.text)
        result=preview.json()
        self.assertTrue(result['preview']);self.assertEqual(result['source_url'],source['url'])
        with wave.open(io.BytesIO(self.client.get(result['url']).content),'rb') as reader:
            self.assertEqual(reader.getframerate(),48000)
            self.assertEqual(reader.getnchannels(),2)
            self.assertAlmostEqual(reader.getnframes()/reader.getframerate(),0.1,places=3)
        self.assertEqual(self.client.post(self.prefix+'/audio-preview',json={'url':source['url']}).json()['url'],result['url'])
        song=project();song['audio']=result
        saved=self.client.post(self.prefix+'/save',json={'project':song,'format':'json'})
        self.assertEqual(saved.status_code,200,saved.text)
        pack=saved.json()['_pack'];stem=next(s for s in pack['manifest']['stems'] if s['id']=='full')
        self.assertEqual(base64.b64decode(pack['entries'][stem['file']]),original)
        malformed=self.client.post(self.prefix+'/audio',files={'file':('own.aac',b'not audio')}).json()
        failure=self.client.post(self.prefix+'/audio-preview',json={'url':malformed['url']})
        self.assertEqual(failure.status_code,400,failure.text)
        self.assertEqual(self.client.get(malformed['url']).content,b'not audio')
        for invalid in ('https://example.com/audio','C:/secret.wav',source['url']+'?query=1'):
            self.assertIn(self.client.post(self.prefix+'/audio-preview',json={'url':invalid}).status_code,(400,404))

    def test_health_and_coverage_are_truthful(self):
        health=self.client.get(self.prefix+'/health').json()
        self.assertIn('midi-format-0-1-ppqn',health['import_formats'])
        self.assertNotIn('cdlc',health);self.assertNotIn('psarc_import',health)
        with tempfile.TemporaryDirectory(prefix='oce-coverage-test-') as directory:
            root=Path(directory)
            with patch.object(routes,'__file__',str(root/'routes.py')):
                self.assertEqual(self.client.get(self.prefix+'/coverage').status_code,404)
                (root/'feature-coverage.json').write_text('{"complete":false,"tested":["tempo"]}')
                self.assertEqual(self.client.get(self.prefix+'/coverage').json()['tested'],['tempo'])

    def test_vocal_xml_download_upload_and_invalid_encoding_error(self):
        song=project();song['vocals']=[{'id':'own','time':1,'length':0.5,'pitch':64,'text':'Original & own'}]
        result=self.client.post(self.prefix+'/save',json={'project':song,'format':'vocal_xml'})
        self.assertEqual(result.status_code,200,result.text)
        loaded=self.client.post(self.prefix+'/load',files={'file':('own_vocals.xml',result.content,'application/xml')})
        self.assertEqual(loaded.status_code,200,loaded.text)
        self.assertEqual(loaded.json()['project']['vocals'][0]['text'],'Original & own')
        malicious='<!DOCTYPE song [<!ENTITY a "x">]><song version="7"/>'.encode('utf-16')
        self.assertEqual(self.client.post(self.prefix+'/load',files={'file':('bad.xml',malicious)}).status_code,400)

    def test_merge_api_preserves_target_and_returns_new_arrangement_ids(self):
        target=project();target['title']='Backing song'
        incoming=project();incoming['title']='Part source'
        result=self.client.post(self.prefix+'/merge',json={'target':target,'incoming':incoming,'offset':1})
        self.assertEqual(result.status_code,200,result.text)
        merged=result.json()
        self.assertEqual(merged['project']['title'],'Backing song')
        self.assertEqual(merged['project']['beats'],target['beats'])
        self.assertEqual(merged['project']['arrangements'][1]['notes'][0]['time'],3)
        self.assertEqual(merged['arrangement_ids'],[merged['project']['arrangements'][1]['id']])
        self.assertEqual(self.client.post(self.prefix+'/merge',json={'target':target,'incoming':incoming,'offset':-1}).status_code,400)

    def test_gp_upload_uses_local_adapter_and_retains_original_source(self):
        try:data=original_gp_binary()
        except ImportError:self.skipTest('Installed PyGuitarPro unavailable')
        core=(routes.pack_io.feedback_core() or Path('missing'))/'gp2rs.py'
        if not core.is_file():self.skipTest('Installed public GP converter unavailable')
        result=self.client.post(self.prefix+'/load',files={'file':('own.gp5',data,'application/octet-stream')})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['project']['arrangements'][0]['notes'][0]['fret'],3)

    def test_errors_are_actionable_and_no_file_access_by_token(self):
        self.assertEqual(self.client.post(self.prefix+'/load',files={'file':('bad.json',b'{}')}).status_code,400)
        self.assertEqual(self.client.post(self.prefix+'/save',json={'project':project('guitar',8),'format':'xml'}).status_code,400)
        self.assertEqual(self.client.post(self.prefix+'/audio',files={'file':('script.py',b'print(1)')}).status_code,400)
        self.assertEqual(self.client.get(self.prefix+'/audio/not-a-token').status_code,404)
        self.assertEqual(self.client.post(self.prefix+'/save',json={'project':project(),'format':'exe'}).status_code,400)
        song=project(); song['audio']={'url':self.prefix+'/audio/expired'}
        self.assertEqual(self.client.post(self.prefix+'/save',json={'project':song,'format':'feedpak'}).status_code,400)

if __name__=='__main__':
    unittest.main()
