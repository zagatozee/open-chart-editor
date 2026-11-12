"""FeedBack plugin API, also usable by the standalone local preview server."""
from __future__ import annotations

import base64
import copy
import hashlib
import asyncio
import importlib.util
import json
import mimetypes
from pathlib import Path
from xml.etree import ElementTree as ET
import tempfile
import time
import uuid
import subprocess
import shutil
import os
import threading
import wave
import math
import zipfile
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response

try:
    from . import pack_io
except ImportError:
    _spec = importlib.util.spec_from_file_location('open_chart_editor_pack_io', Path(__file__).with_name('pack_io.py'))
    pack_io = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(pack_io)

try:
    from . import library_source
except ImportError:
    _library_spec=importlib.util.spec_from_file_location('open_chart_editor_library_source',Path(__file__).with_name('library_source.py'))
    library_source=importlib.util.module_from_spec(_library_spec)
    _library_spec.loader.exec_module(library_source)

try:
    from . import export_targets
except ImportError:
    import sys
    _exports_spec=importlib.util.spec_from_file_location('open_chart_editor_export_targets',Path(__file__).with_name('export_targets.py'))
    export_targets=importlib.util.module_from_spec(_exports_spec)
    # Standalone fallback shares the already loaded pack_io; no duplicate backend.
    _previous_pack=sys.modules.get('pack_io')
    sys.modules['pack_io']=pack_io
    try:
        _exports_spec.loader.exec_module(export_targets)
    finally:
        if _previous_pack is None:sys.modules.pop('pack_io',None)
        else:sys.modules['pack_io']=_previous_pack

try:
    from . import folder_io
except ImportError:
    _folder_spec=importlib.util.spec_from_file_location('open_chart_editor_folder_io',Path(__file__).with_name('folder_io.py'))
    folder_io=importlib.util.module_from_spec(_folder_spec)
    _folder_spec.loader.exec_module(folder_io)

try:
    from . import folder_browser
except ImportError:
    _browser_spec=importlib.util.spec_from_file_location('open_chart_editor_folder_browser',Path(__file__).with_name('folder_browser.py'))
    folder_browser=importlib.util.module_from_spec(_browser_spec)
    _browser_spec.loader.exec_module(folder_browser)

try:
    from . import at5_vst3
except ImportError:
    _at5_spec=importlib.util.spec_from_file_location('open_chart_editor_at5_vst3',Path(__file__).with_name('at5_vst3.py'))
    at5_vst3=importlib.util.module_from_spec(_at5_spec)
    _at5_spec.loader.exec_module(at5_vst3)

try:
    from . import stem_split
except ImportError:
    _stem_split_spec=importlib.util.spec_from_file_location('open_chart_editor_stem_split',Path(__file__).with_name('stem_split.py'))
    stem_split=importlib.util.module_from_spec(_stem_split_spec)
    _stem_split_spec.loader.exec_module(stem_split)

PREFIX = '/api/plugins/open_chart_editor' 

def vgmstream_executable():
    """vgmstream-cli for Wwise (.wem) audio, which FFmpeg cannot decode: OCE_VGMSTREAM,
    then PATH, then a Slopsmith desktop install (it bundles vgmstream)."""
    configured=os.environ.get('OCE_VGMSTREAM')
    candidates=[configured,shutil.which('vgmstream-cli')]
    for base in (os.environ.get('ProgramFiles'),os.environ.get('LOCALAPPDATA')):
        if base:candidates.append(str(Path(base)/'Slopsmith'/'current'/'resources'/'bin'/'vgmstream-cli.exe'))
    return next((c for c in candidates if c and Path(c).is_file()),None)


def is_wwise_audio(path):
    """A .wem file, or RIFF/WAVE with Wwise Vorbis's 0xFFFF format tag."""
    with open(path,'rb') as stream:head=stream.read(24)
    if head[:4]!=b'RIFF' or head[8:12]!=b'WAVE':return False
    return Path(path).suffix.lower()=='.wem' or head[12:16]==b'fmt ' and head[20:22]==b'\xff\xff'

MAX_AUDIO = 4 * 1024 * 1024 * 1024
AUDIO_EXTENSIONS = {'.wav', '.ogg', '.mp3', '.flac', '.opus', '.m4a', '.aac', '.wem'}
MAX_CACHE = 8 * 1024 * 1024 * 1024


def setup(app, context=None):
    """Register once; host invokes setup(app, context) at plugin load."""
    if getattr(app.state, 'open_chart_editor_registered', False):
        return
    app.state.open_chart_editor_registered = True
    library_source.install_library_source(app,context or {},max_bytes=pack_io.MAX_BYTES)
    folder_io.install_folder_source(app,max_bytes=pack_io.MAX_BYTES)
    folder_browser.install_folder_browser(app,context or {},max_bytes=pack_io.MAX_BYTES)
    # TemporaryDirectory owns only this plugin's random local scratch directory.
    scratch = tempfile.TemporaryDirectory(prefix='open-chart-editor-')
    app.state.open_chart_editor_scratch = scratch
    cache = Path(scratch.name)
    assets = {}
    preview_gate = asyncio.Semaphore(1)
    preview_reserved = 0
    preview_inflight = set()
    at5_gate = asyncio.Lock()
    at5_executor = None
    at5_processor = None
    logger = logging.getLogger(__name__)

    async def close_at5_host():
        nonlocal at5_executor, at5_processor
        if at5_executor is None:
            return
        try:
            if at5_processor is not None:
                await asyncio.get_running_loop().run_in_executor(at5_executor, at5_processor.close)
        finally:
            at5_executor.shutdown(wait=True, cancel_futures=True)
            at5_executor = None
            at5_processor = None

    app.router.on_shutdown.append(close_at5_host)

    def original_asset(token):
        item = assets.get(token)
        if item and item.get('kind')=='cover':
            return None
        return assets.get(item['preview_of']) if item and item.get('preview_of') else item

    def prune():
        for token,item in list(assets.items()):
            if token not in preview_inflight and time.time() - item['created'] > 24*3600:
                item['path'].unlink(missing_ok=True)
                del assets[token]

    async def bounded_upload(file, limit):
        result = bytearray()
        while True:
            chunk = await file.read(min(1024*1024, limit+1-len(result)))
            if not chunk:
                return bytes(result)
            result.extend(chunk)
            if len(result) > limit:
                raise HTTPException(413, 'Upload exceeds the local size limit')

    def asset_url(token):
        return f'{PREFIX}/audio/{token}'

    def store_audio(data, name):
        prune()
        if sum(item['size'] for item in assets.values()) + len(data) + preview_reserved > MAX_CACHE:
            raise HTTPException(413, 'Local audio cache is full; restart the preview to clear it')
        suffix = Path(name).suffix.lower()
        if suffix not in AUDIO_EXTENSIONS:
            raise HTTPException(400, 'Supported audio: WAV, OGG, MP3, FLAC, Opus, M4A, AAC, WEM (preview decoding depends on FFmpeg)')
        token = uuid.uuid4().hex
        path = cache / (token+suffix)
        path.write_bytes(data)
        assets[token] = {'path':path, 'name':Path(name).name, 'size':len(data), 'created':time.time()}
        return {'url':asset_url(token), 'name':Path(name).name, 'token':token}

    @app.get(PREFIX+'/health')
    async def health():
        result={'ok':True,'version':1,'formats':['feedpak','json','xml','vocal_xml'],'import_formats':['feedpak','json','rs2014-xml-v7','rs2014-vocal-xml','midi-format-0-1-ppqn','musicxml-partwise','compressed-musicxml','guitar-pro-3-8-local-converter'], 'rs2014':'arrangement XML v7, separate vocal XML and DLC Builder project sources; no PSARC packaging','ffmpeg':bool(shutil.which('ffmpeg'))}
        return result

    @app.get(PREFIX+'/at5/status')
    async def at5_status():
        return at5_vst3.host_status()

    @app.websocket(PREFIX+'/at5/live')
    async def at5_live(websocket: WebSocket):
        nonlocal at5_executor, at5_processor
        client_host=websocket.client.host if websocket.client else ''
        if not at5_vst3.local_websocket_origin_allowed(
            websocket.headers.get('host',''),
            client_host,
            websocket.headers.get('origin',''),
        ):
            await websocket.close(code=1008,reason='AT5 preview is available only to the local OCE page')
            return

        await websocket.accept()
        status=at5_vst3.host_status()
        if not status['available']:
            await websocket.send_json({'type':'error','message':status['message']})
            await websocket.close(code=1011)
            return
        if at5_gate.locked():
            await websocket.send_json({'type':'error','message':'AmpliTube 5 is already in use by another live monitor'})
            await websocket.close(code=1013)
            return

        await at5_gate.acquire()
        if at5_executor is None:
            at5_executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='oce-at5-vst3')
        executor=at5_executor
        loop=asyncio.get_running_loop()
        try:
            config=await websocket.receive_json()
            if not isinstance(config,dict) or config.get('type')!='configure':
                raise at5_vst3.At5Vst3Error('The live host received an invalid configuration.')
            try:
                sample_rate=int(config.get('sample_rate',0))
                frame_count=int(config.get('frame_count',0))
            except (TypeError,ValueError) as exc:
                raise at5_vst3.At5Vst3Error('The browser audio format is invalid.') from exc
            if sample_rate<8000 or sample_rate>192000:
                raise at5_vst3.At5Vst3Error('The browser audio sample rate is unsupported.')
            if frame_count not in at5_vst3.SUPPORTED_FRAME_COUNTS:
                raise at5_vst3.At5Vst3Error('The browser requested an unsupported audio block size.')
            tone=config.get('tone')
            tier=config.get('tier','max')
            if not isinstance(tone,dict):
                raise at5_vst3.At5Vst3Error('A Rocksmith chart tone is required for AmpliTube live monitoring.')
            if tier not in at5_vst3.AT5_TIERS:
                raise at5_vst3.At5Vst3Error('The selected AmpliTube library tier is invalid.')
            tone_key=tone.get('key')
            tone_name=tone.get('name')
            gear=tone.get('gear')
            if not isinstance(tone_key,str) or not tone_key.strip():
                raise at5_vst3.At5Vst3Error('The selected Rocksmith tone has no valid key.')
            if not isinstance(tone_name,str) or not tone_name.strip():
                tone_name=tone_key
            if not isinstance(gear,dict):
                raise at5_vst3.At5Vst3Error('The selected Rocksmith tone has no GearList to convert.')
            if len(json.dumps(tone).encode('utf-8'))>64*1024:
                raise at5_vst3.At5Vst3Error('The selected Rocksmith tone exceeds the live conversion size limit.')
            preset_xml,conversion_messages=await loop.run_in_executor(
                executor,
                at5_vst3.convert_rocksmith_tone_with_warnings,
                tone_key,
                tone_name,
                gear,
                tier,
            )
            preset_name=tone_name or tone_key

            if at5_processor is None:
                at5_processor=await loop.run_in_executor(
                    executor,
                    at5_vst3.open_live_processor,
                    status['plugin_path'],
                    preset_xml,
                    preset_name,
                )
            else:
                await loop.run_in_executor(
                    executor,
                    at5_processor.configure,
                    preset_xml,
                    preset_name,
                )
            processor=at5_processor
            await websocket.send_json({
                'type':'ready',
                'engine':'AmpliTube 5 VST3',
                'preset':preset_name,
                'frame_count':frame_count,
                'warnings':conversion_messages,
            })
            while True:
                message=await websocket.receive()
                if message['type']=='websocket.disconnect':
                    break
                if message.get('text') is not None:
                    tone_label=''
                    try:
                        command=json.loads(message['text'])
                        if not isinstance(command,dict) or command.get('type')!='tone':
                            raise at5_vst3.At5Vst3Error('The live host received an unsupported command.')
                        next_tone=command.get('tone')
                        if isinstance(next_tone,dict):
                            tone_label=next_tone.get('name') or next_tone.get('key') or ''
                        if not isinstance(next_tone,dict) or not isinstance(next_tone.get('gear'),dict):
                            raise at5_vst3.At5Vst3Error('The selected Rocksmith tone has no GearList to convert.')
                        if len(message['text'].encode('utf-8'))>64*1024:
                            raise at5_vst3.At5Vst3Error('The selected Rocksmith tone exceeds the live conversion size limit.')
                        next_tier=command.get('tier','max')
                        if next_tier not in at5_vst3.AT5_TIERS:
                            raise at5_vst3.At5Vst3Error('The selected AmpliTube library tier is invalid.')
                        next_key=next_tone.get('key')
                        next_name=next_tone.get('name')
                        if not isinstance(next_key,str) or not next_key.strip():
                            raise at5_vst3.At5Vst3Error('The selected Rocksmith tone has no valid key.')
                        if not isinstance(next_name,str) or not next_name.strip():
                            next_name=next_key
                        next_preset,next_warnings=await loop.run_in_executor(
                            executor,
                            at5_vst3.convert_rocksmith_tone_with_warnings,
                            next_key,
                            next_name,
                            next_tone['gear'],
                            next_tier,
                        )
                        await loop.run_in_executor(
                            executor,
                            processor.configure,
                            next_preset,
                            next_name or next_key,
                        )
                        await websocket.send_json({
                            'type':'tone-ready',
                            'tone':next_name or next_key,
                            'tier':next_tier,
                            'warnings':next_warnings,
                        })
                    except (ValueError,at5_vst3.At5Vst3Error) as exc:
                        await websocket.send_json({
                            'type':'tone-error',
                            'tone':tone_label,
                            'message':str(exc),
                        })
                    continue
                pcm=message.get('bytes')
                if pcm is None:
                    raise at5_vst3.At5Vst3Error('The live host received an invalid audio message.')
                output=await loop.run_in_executor(
                    executor,
                    processor.process_chunk,
                    pcm,
                    sample_rate,
                    frame_count,
                )
                await websocket.send_bytes(output)
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.exception('AmpliTube 5 live VST3 session failed')
            try:
                await websocket.send_json({'type':'error','message':str(exc)})
                await websocket.close(code=1011)
            except (WebSocketDisconnect,RuntimeError) as send_error:
                logger.debug('AT5 VST3 client disconnected before error notification: %s',send_error)
        finally:
            at5_gate.release()

    @app.get(PREFIX+'/coverage')
    async def coverage():
        path=Path(__file__).resolve().parent/'feature-coverage.json'
        if not path.is_file():
            raise HTTPException(404,'Feature coverage report has not been generated')
        try:
            return json.loads(path.read_text(encoding='utf-8-sig'))
        except (ValueError,OSError) as exc:
            raise HTTPException(503,'Feature coverage report could not be read') from exc

    @app.post(PREFIX+'/load')
    async def load(file: UploadFile = File(...)):
        data = await bounded_upload(file, pack_io.MAX_BYTES)
        try:
            if (file.filename or '').lower().endswith('.oce-folder.zip'):
                project=await asyncio.to_thread(export_targets.load_folder_archive,data)
            else:
                project = await asyncio.to_thread(pack_io.load_project,data,file.filename or 'project.json')
            pack = project.get('_pack',{})
            stems = pack.get('manifest',{}).get('stems',[])
            selected = next((s for s in stems if s.get('id') == 'full'),None) or next((s for s in stems if pack_io.stem_is_default(s)),None) or (stems[0] if stems else None)
            if selected:
                name = selected.get('file')
                content = pack.get('entries',{}).get(name)
                if content and Path(name).suffix.lower() in AUDIO_EXTENSIONS:
                    project['audio'] = store_audio(base64.b64decode(content),name)
            return {'project':project}
        except (pack_io.ProjectError,ValueError,TypeError,KeyError,ET.ParseError,zipfile.BadZipFile) as exc:
            raise HTTPException(400,str(exc)) from exc

    @app.post(PREFIX+'/save')
    async def save(payload: dict):
        try:
            project = payload.get('project')
            if not isinstance(project,dict):
                raise pack_io.ProjectError('Request requires a project object')
            if payload.get('format','feedpak') in ('feedpak','json') and project.get('audio',{}).get('url','').startswith(PREFIX+'/audio/'):
                token = project['audio']['url'].rsplit('/',1)[-1]
                item = original_asset(token)
                if item is None:
                    raise pack_io.ProjectError('Uploaded audio expired; select the local audio file again before exporting')
                pack = project.setdefault('_pack',{})
                # Preserve all existing stems, and replace only the full guide mix.
                manifest = pack.setdefault('manifest',{})
                stems = manifest.setdefault('stems',[])
                stem = next((s for s in stems if s.get('id') == 'full'),None)
                if stem is None:
                    stem = {'id':'full','default':True}
                    stems.append(stem)
                name = stem.get('file') or 'audio/full'+item['path'].suffix
                if Path(name).suffix.lower() != item['path'].suffix:
                    name = 'audio/full'+item['path'].suffix
                # FeedPak codec names (5.3): an explicit codec overrides the extension, so never write
                # the extension itself ("wav") as the codec; omit it where the extension pins the codec.
                stem.update(file=name,name='Full mix');stem.pop('codec',None)
                codec={'.m4a':'aac','.aac':'aac','.wem':'wwise-vorbis'}.get(item['path'].suffix.lower())
                if codec:stem['codec']=codec
                pack.setdefault('entries',{})[name] = base64.b64encode(item['path'].read_bytes()).decode('ascii')
            baseline=await asyncio.to_thread(ensure_baseline_stem,project) if payload.get('format','feedpak')=='feedpak' else None
            data,name,media_type = pack_io.save_project(project,payload.get('format','feedpak'),payload.get('arrangement_id'),vocal_only=payload.get('vocal_only') is True)
            from urllib.parse import quote
            headers={'Content-Disposition':"attachment; filename*=UTF-8''"+quote(name)}
            warnings=[baseline] if baseline else []
            if payload.get('format','feedpak')=='feedpak':
                warnings+=[item['warning'] for item in pack_io.notation_export_warnings(project)]+[note for note in pack_io.save_notices(project) if note.startswith('Lesson')]+pack_io.drum_export_warnings(project)+pack_io.vocal_export_warnings(project)+pack_io.flat_phrase_export_warnings(project)
            elif payload.get('format')=='xml':
                identifier=payload.get('arrangement_id') or project['arrangements'][0]['id']
                warnings=pack_io.stock_export_warnings(project,identifier)
            if warnings:
                messages=[warning[:600] for warning in warnings[:8]]
                if len(warnings)>8:messages.append(f'{len(warnings)-8} additional export warnings')
                headers['X-OCE-Export-Warnings']=json.dumps(messages,ensure_ascii=True)
            if payload.get('delivery')=='entries':
                if payload.get('format','feedpak')!='feedpak':
                    raise pack_io.ProjectError('Folder delivery is supported for FeedPak, source and loose output trees')
                tree=export_targets.entry_tree_from_zip(data)
                return Response(json.dumps(tree.transport()),media_type='application/json',headers=headers)
            return Response(data,media_type=media_type,headers=headers)
        except (pack_io.ProjectError,ValueError,TypeError,KeyError,ET.ParseError) as exc:
            raise HTTPException(400,str(exc)) from exc

    @app.post(PREFIX+'/live-bundle')
    async def live_bundle(payload: dict):
        """The current part in FeedBack's highway shapes, for the live view's FeedBack renderers."""
        try:
            arrangement=payload.get('arrangement')
            if not isinstance(arrangement,dict):
                raise pack_io.ProjectError('Request requires an arrangement object')
            return await asyncio.to_thread(pack_io.live_bundle,arrangement,payload.get('beats') or [],payload.get('sections') or [],payload.get('info') or {})
        except (pack_io.ProjectError,ValueError,TypeError,KeyError) as exc:
            raise HTTPException(400,str(exc)) from exc

    @app.post(PREFIX+'/save-check')
    async def save_check(payload: dict):
        """Notices to confirm before a FeedPak or loose-folder save (nothing is written)."""
        try:
            project=payload.get('project')
            if not isinstance(project,dict):
                raise pack_io.ProjectError('Request requires a project object')
            return {'notices':await asyncio.to_thread(pack_io.save_notices,project)}
        except (pack_io.ProjectError,ValueError,TypeError,KeyError) as exc:
            raise HTTPException(400,str(exc)) from exc

    @app.post(PREFIX+'/export-sources')
    async def export_sources(payload: dict):
        try:
            project=payload.get('project')
            if not isinstance(project,dict):
                raise pack_io.ProjectError('Request requires a project object')
            supplied=None
            audio=project.get('audio',{})
            if str(audio.get('url','')).startswith(PREFIX+'/audio/'):
                item=original_asset(audio['url'].rsplit('/',1)[-1])
                if item is None:raise pack_io.ProjectError('Original audio expired; select it again')
                supplied=(item['name'],item['path'].read_bytes())
            original_name,original_bytes=export_targets.source_audio(project,supplied)
            normalized=None
            if not (Path(original_name).suffix.lower()=='.wav' and export_targets._pcm_wav(original_bytes)):
                if Path(original_name).suffix.lower()=='.wem':
                    raise pack_io.ProjectError('Source handoff retains owned WEM in the master; select original PCM/audio for the editable DLC Builder project')
                executable=shutil.which('ffmpeg')
                if not executable:raise pack_io.ProjectError('FFmpeg is needed only to make a PCM source copy; original WAV needs no encoder')
                with tempfile.TemporaryDirectory(prefix='source-export-',dir=cache) as directory:
                    source=Path(directory)/('original'+Path(original_name).suffix.lower())
                    destination=Path(directory)/'source.wav'
                    source.write_bytes(original_bytes)
                    await asyncio.to_thread(convert_preview,executable,source,destination,purpose='Source audio export')
                    normalized=destination.read_bytes()
            tree,report=await asyncio.to_thread(export_targets.rs2014_sources,
                project,payload.get('arrangement_ids'),include_vocals=payload.get('include_vocals') is True,
                audio=supplied,normalized_wav=normalized,
                author=payload.get('author') or project.get('charterName') or 'Open Chart Editor',dlc_key=payload.get('dlcKey'))
            if payload.get('delivery')=='entries':
                return {**tree.transport(),'manifest':report}
            from urllib.parse import quote
            name=''.join(c if c.isalnum() or c in ' .-_' else '_' for c in str(project.get('title') or 'OCE'))[:100].strip('. ') or 'OCE'
            return Response(tree.zip_bytes(),media_type='application/zip',headers={
                'Content-Disposition':"attachment; filename*=UTF-8''"+quote(name+'-rs2014-sources.zip'),
                'X-OCE-Export-Warnings':json.dumps(report['warnings'][:8],ensure_ascii=True)})
        except (pack_io.ProjectError,ValueError,TypeError,KeyError,ET.ParseError) as exc:
            raise HTTPException(400,str(exc)) from exc

    @app.post(PREFIX+'/export-loose')
    async def export_loose(payload: dict):
        try:
            project=payload.get('project')
            if not isinstance(project,dict):raise pack_io.ProjectError('Request requires a project object')
            supplied=None
            audio=project.get('audio',{})
            if str(audio.get('url','')).startswith(PREFIX+'/audio/'):
                item=original_asset(audio['url'].rsplit('/',1)[-1])
                if item is None:raise pack_io.ProjectError('Original audio expired; select it again')
                supplied=(item['name'],item['path'].read_bytes())
            name,original=export_targets.source_audio(project,supplied)
            normalized=flat_mp3=None
            # FeedBack's loose loader plays audio.wem or audio.mp3 only: encode an MP3 when possible.
            if Path(name).suffix.lower() not in ('.mp3','.wem') and shutil.which('ffmpeg'):
                flat_mp3=await asyncio.to_thread(encode_mp3,shutil.which('ffmpeg'),name,original)
            if flat_mp3 is None and Path(name).suffix.lower() not in ('.wav','.ogg','.mp3','.wem'):
                executable=shutil.which('ffmpeg')
                if not executable:raise pack_io.ProjectError('FFmpeg is needed to make a WAV copy of this original audio format')
                with tempfile.TemporaryDirectory(prefix='loose-export-',dir=cache) as directory:
                    source=Path(directory)/('original'+Path(name).suffix.lower());destination=Path(directory)/'audio.wav'
                    source.write_bytes(original)
                    await asyncio.to_thread(convert_preview,executable,source,destination,purpose='Loose folder audio export')
                    normalized=destination.read_bytes()
            tree,report=await asyncio.to_thread(export_targets.feedback_loose,project,audio=supplied,normalized_wav=normalized,flat_mp3=flat_mp3)
            headers={'X-OCE-Export-Warnings':json.dumps(report['warnings'],ensure_ascii=True)}
            if payload.get('delivery')=='entries':
                return Response(json.dumps({**tree.transport(),'manifest':report}),media_type='application/json',headers=headers)
            from urllib.parse import quote
            name=''.join(c if c.isalnum() or c in ' .-_' else '_' for c in str(project.get('title') or 'OCE'))[:100].strip('. ') or 'OCE'
            headers['Content-Disposition']="attachment; filename*=UTF-8''"+quote(name+'-feedback-loose.zip')
            return Response(tree.zip_bytes(),media_type='application/zip',headers=headers)
        except (pack_io.ProjectError,ValueError,TypeError,KeyError,ET.ParseError,zipfile.BadZipFile) as exc:
            raise HTTPException(400,str(exc)) from exc

    @app.post(PREFIX+'/export-rplus')
    async def export_rplus(payload: dict):
        # New chart files only; the browser writes them into the opened R+ song folder.
        try:
            project=payload.get('project')
            if not isinstance(project,dict):raise pack_io.ProjectError('Request requires a project object')
            tree,report=await asyncio.to_thread(export_targets.rplus_folder,project)
            headers={'X-OCE-Export-Warnings':json.dumps(report['warnings'],ensure_ascii=True)}
            if payload.get('delivery')=='entries':
                return Response(json.dumps({**tree.transport(),'manifest':report}),media_type='application/json',headers=headers)
            from urllib.parse import quote
            name=''.join(c if c.isalnum() or c in ' .-_' else '_' for c in str(project.get('title') or 'OCE'))[:100].strip('. ') or 'OCE'
            headers['Content-Disposition']="attachment; filename*=UTF-8''"+quote(name+'-rplus-charts.zip')
            return Response(tree.zip_bytes(),media_type='application/zip',headers=headers)
        except (pack_io.ProjectError,ValueError,TypeError,KeyError,ET.ParseError) as exc:
            raise HTTPException(400,str(exc)) from exc

    @app.post(PREFIX+'/merge')
    async def merge(payload: dict):
        try:
            return await asyncio.to_thread(pack_io.merge_projects,payload.get('target'),payload.get('incoming'),payload.get('arrangement_ids'),payload.get('align','time'),payload.get('offset',0),payload.get('include_vocals') is True,payload.get('audio_map'))
        except (pack_io.ProjectError,ValueError,TypeError,KeyError) as exc:
            raise HTTPException(400,str(exc)) from exc

    audio_tags=pack_io.audio_file_tags

    # Optional import assistance from a local gp-to-feedpak checkout (tools/assist/gp_assist.py).
    def assist_config():
        root=Path(os.environ.get('GP_TO_FEEDPAK',r'I:\Dev\gp to feedpak docker'))
        python=Path(os.environ.get('OCE_ASSIST_PYTHON',str(root/'_parangonar_venv'/'Scripts'/'python.exe')))
        image=os.environ.get('OCE_ASSIST_IMAGE','gp-to-feedpak:eval-beatthis')
        local=python.is_file() and (root/'lib'/'gp_pipeline.py').is_file()
        return {'root':root,'python':python,'image':image,'local':local,'models':local and (root/'models'/'v6'/'anchor_v6b.pt').is_file()}
    docker_ready={}
    def ensemble_available(config):
        if config['image'] not in docker_ready:
            docker=shutil.which('docker');ready=False
            if docker and (config['root']/'_msb_batch'/'beat_ssm_sync.py').is_file():
                try:ready=subprocess.run([docker,'image','inspect',config['image']],capture_output=True,timeout=20,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).returncode==0
                except (OSError,subprocess.TimeoutExpired):ready=False
            docker_ready[config['image']]=ready
        return docker_ready[config['image']]

    @app.get(PREFIX+'/assist')
    async def assist_status():
        config=assist_config()
        return {'syncEngine':config['local'],'ensemble':await asyncio.to_thread(ensemble_available,config),'suggestions':config['models']}

    @app.post(PREFIX+'/assist-import')
    async def assist_import(payload: dict):
        """Measure a score-to-audio map and/or add ML suggestion arrangements to an incoming Guitar Pro project."""
        incoming=payload.get('incoming');method=payload.get('align');suggest=payload.get('suggest') is True
        source=(incoming or {}).get('_import') or {}
        if source.get('format')!='guitarpro' or not source.get('source'):raise HTTPException(400,'Import assistance needs a Guitar Pro score')
        if method not in (None,'sync-engine','ensemble'):raise HTTPException(400,'Unknown alignment method')
        config=assist_config();script=Path(__file__).resolve().parent/'tools'/'assist'/'gp_assist.py'
        if (method=='sync-engine' or suggest) and not config['local']:raise HTTPException(503,'The gp-to-feedpak checkout or its Python environment was not found')
        if method=='ensemble' and not await asyncio.to_thread(ensemble_available,config):raise HTTPException(503,'Docker or the gp-to-feedpak:eval-beatthis image is not available')
        audio_item=None
        if method:
            url=str(payload.get('audio_url',''));audio_item=original_asset(url.rsplit('/',1)[-1]) if url.startswith(PREFIX+'/audio/') else None
            if audio_item is None:raise HTTPException(400,'Import the song audio first; alignment measures the score against it')
        result={'skipped':[]}
        with tempfile.TemporaryDirectory(prefix='assist-',dir=cache) as directory:
            work=Path(directory);score=work/('score'+(Path(source.get('filename','score.gpx')).suffix.lower() or '.gpx'))
            score.write_bytes(base64.b64decode(source['source']))
            environment={**os.environ,'GP_TO_FEEDPAK_LIB':str(config['root']/'lib'),'PYTHONIOENCODING':'utf-8'}
            def run(command,timeout):
                try:process=subprocess.run(command,capture_output=True,text=True,timeout=timeout,env=environment,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                except subprocess.TimeoutExpired as exc:raise HTTPException(504,'Import assistance timed out') from exc
                if process.returncode:raise HTTPException(500,'Import assistance failed: '+(process.stderr.strip().splitlines() or ['no output'])[-1][:400])
            if method:
                audio_copy=work/('audio'+audio_item['path'].suffix);shutil.copyfile(audio_item['path'],audio_copy);out=work/'align.json'
                if method=='sync-engine':
                    await asyncio.to_thread(run,[str(config['python']),'-B',str(script),'align-sync',str(score),str(audio_copy),str(out)],900)
                else:
                    editor=Path(__file__).resolve().parent
                    await asyncio.to_thread(run,['docker','run','--rm','--network','none','-v',f"{config['root']/'_msb_batch'}:/batch:ro",'-v',f'{editor}:/editor:ro','-v',f'{work}:/work',
                        '-e','GP_TO_FEEDPAK_LIB=/app/lib','-e','GP_TO_FEEDPAK_BATCH=/batch','-e','OCE_EDITOR=/editor',config['image'],'python3','-B','/editor/tools/assist/gp_assist.py','align-ensemble',f'/work/{score.name}',f'/work/{audio_copy.name}','/work/align.json'],900)
                result['audioMap']=json.loads(out.read_text(encoding='utf-8'))
            if suggest:
                out=work/'suggest.json'
                roles={'Lead','Rhythm','Bass','Keys','Combo'}
                tracks=[f"{int(t['track'])}:{t['role']}" if t.get('role') in roles else str(int(t['track'])) for t in payload.get('tracks',[]) if isinstance(t,dict) and isinstance(t.get('track'),int)]
                await asyncio.to_thread(run,[str(config['python']),'-B',str(script),'suggest',str(score),str(out),*tracks],900)
                found=json.loads(out.read_text(encoding='utf-8'));result['skipped']=found.get('skipped',[])
                incoming=copy.deepcopy(incoming)
                for index,item in enumerate(found.get('suggestions',[])):
                    arrangement=pack_io._arrangement(item['arrangement'],{'id':f"ml-{item['track']}",'name':f"{item['name']} (ML suggestion)",'type':item['type']},len(incoming['arrangements'])+index)
                    arrangement.update(sourceTrack=item['track'],role='bass' if item['type']=='bass' else arrangement.get('role','lead'),mlSuggestion=True)
                    incoming['arrangements'].append(arrangement)
                try:pack_io.validate_project(incoming)
                except pack_io.ProjectError as exc:raise HTTPException(500,'ML suggestions did not validate: '+str(exc)) from exc
                result['incoming']=incoming
        return result

    @app.post(PREFIX+'/audio')
    async def audio(file: UploadFile = File(...)):
        result=store_audio(await bounded_upload(file,MAX_AUDIO),file.filename or 'audio.wav')
        tags=await asyncio.to_thread(audio_tags,assets[result['token']]['path'])
        if tags:result['tags']=tags
        return result

    def compress_combined_audio(data, name):
        """The Combiner assembles raw PCM client-side; an album-length combine is
        hundreds of MB of WAV, which a downstream Feedpak stem reader may cap
        (e.g. FeedBack's own per-stem decompression limit). Encode to OGG here,
        same ffmpeg settings ensure_baseline_stem already uses for a full mix, so
        the editor, Playtest and export all see the compact file from the start."""
        executable = shutil.which('ffmpeg')
        if not executable:
            return data, name
        with tempfile.TemporaryDirectory(prefix='combiner-audio-', dir=cache) as directory:
            source = Path(directory)/('source'+Path(name).suffix.lower())
            source.write_bytes(data)
            target = Path(directory)/'combined.ogg'
            run = subprocess.run([executable,'-nostdin','-hide_banner','-loglevel','error','-n','-i',str(source),
                                  '-vn','-c:a','libvorbis','-q:a','6',str(target)],
                                  stdin=subprocess.DEVNULL,capture_output=True,timeout=600,
                                  creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if run.returncode==0 and target.is_file() and target.stat().st_size>0:
                return target.read_bytes(), 'combined.ogg'
        return data, name

    @app.post(PREFIX+'/combiner-audio')
    async def combiner_audio(file: UploadFile = File(...)):
        data = await bounded_upload(file, MAX_AUDIO)
        try:
            data, name = await asyncio.to_thread(compress_combined_audio, data, file.filename or 'combined.wav')
        except subprocess.TimeoutExpired:
            raise HTTPException(504,'Combined audio compression exceeded 10 minutes; use the uncompressed build instead')
        result=store_audio(data, name)
        tags=await asyncio.to_thread(audio_tags,assets[result['token']]['path'])
        if tags:result['tags']=tags
        return result

    # ── Stem splitting ──────────────────────────────────────────────────────
    # OCE ships no separation engine of its own. This POSTs the project's audio
    # to a separation-server URL the user supplies (see stem_split.py) and
    # relays the stems back; nothing is installed or downloaded by OCE itself.
    @app.post(PREFIX+'/stems/split')
    async def stems_split(file: UploadFile = File(...), server_url: str = Form(''), model: str = Form('')):
        data=await bounded_upload(file,MAX_AUDIO)
        if not server_url:
            raise HTTPException(400,'Enter a split server URL first')
        try:
            result=await asyncio.wait_for(
                asyncio.to_thread(
                    stem_split.split_full_mix,data,file.filename or 'mix.wav',
                    server_url=server_url,model=model or None,
                ),
                timeout=20*60,
            )
        except asyncio.TimeoutError:
            raise HTTPException(504,'Stem splitting exceeded 20 minutes')
        except Exception as exc:
            raise HTTPException(400,str(exc)) from exc
        return {'ok':True,'stem_separation':result['stem_separation'],
                'stems':[{'id':s['id'],'codec':s['codec'],
                          'bytes_base64':base64.b64encode(s['bytes']).decode('ascii')}
                         for s in result['stems']]}

    @app.post(PREFIX+'/cover')
    async def upload_cover(file: UploadFile = File(...)):
        data=await bounded_upload(file,pack_io.MAX_COVER)
        cover={'name':Path(file.filename or 'cover.png').name,'data':base64.b64encode(data).decode('ascii')}
        try:
            _,width,height,name=await asyncio.to_thread(pack_io.validate_cover,cover)
        except pack_io.ProjectError as exc:
            raise HTTPException(400,str(exc)) from exc
        prune()
        if sum(item['size'] for item in assets.values())+len(data)+preview_reserved>MAX_CACHE:
            raise HTTPException(413,'Local asset cache is full; restart to clear it')
        token=uuid.uuid4().hex;path=cache/(token+'.png');path.write_bytes(data)
        cover['name']=name
        assets[token]={'path':path,'name':name,'size':len(data),'created':time.time(),'kind':'cover'}
        return {'cover':cover,'token':token,'url':f'{PREFIX}/cover/{token}','name':name,'width':width,'height':height}

    @app.get(PREFIX+'/cover/{token}')
    async def serve_cover(token: str):
        prune();item=assets.get(token)
        if not item or item.get('kind')!='cover':
            raise HTTPException(404,'Cover preview is unavailable; the embedded project image remains portable')
        return FileResponse(item['path'],media_type='image/png')

    def convert_preview(executable, source, destination, *, purpose='Audio preview'):
        # This decodes the full selected audio stream: no duration trim. -fs is
        # above the accepted cap so a size-limited/truncated result is rejected.
        # Demuxer/protocol allowlists prevent playlist inputs from reading other files.
        decoder = vgmstream_executable() if is_wwise_audio(source) else None
        if decoder:
            command = [decoder,'-o',str(destination),str(source)]
        elif not executable:
            raise HTTPException(503,purpose+': FFmpeg is unavailable; original audio is retained')
        else:
            command = [executable,'-nostdin','-hide_banner','-loglevel','error','-n',
                       '-protocol_whitelist','file,pipe','-format_whitelist','wav,ogg,mp3,flac,aac,mov',
                       '-i',str(source),'-map','0:a:0','-vn','-sn','-dn','-ac','2','-ar','48000',
                       '-c:a','pcm_s16le','-fs',str(MAX_AUDIO+4096),str(destination)]
        process = subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
                                   stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        diagnostic = bytearray()
        def drain():
            while chunk := process.stderr.read(4096):
                diagnostic.extend(chunk[:max(0,65536-len(diagnostic))])
        reader = threading.Thread(target=drain,daemon=True)
        reader.start()
        try:
            try:
                code = process.wait(timeout=90)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
                raise HTTPException(504,purpose+' conversion exceeded 90 seconds; original audio is retained')
        finally:
            reader.join(timeout=5)
            process.stderr.close()
        if code:
            detail = diagnostic.decode('utf-8','replace')[-1500:]
            raise HTTPException(400,purpose+(': vgmstream' if decoder else ': FFmpeg')+' cannot decode this audio variant; original audio is retained. '+detail)
        if not destination.is_file() or destination.stat().st_size >= MAX_AUDIO:
            raise HTTPException(413,purpose+': decoded full audio exceeds the 128 MiB limit; no truncated source was exported and the original is retained')
        try:
            with wave.open(str(destination),'rb') as audio:
                if audio.getcomptype() != 'NONE' or not audio.getnframes():
                    raise wave.Error('Empty or non-PCM audio')
                return audio.getnframes()/audio.getframerate()
        except (wave.Error,EOFError) as exc:
            raise HTTPException(400,'Decoder produced no usable PCM preview; original audio is retained') from exc

    def encode_mp3(executable,name,data):
        """MP3 copy of song audio for a FeedBack loose folder (WEM is decoded by vgmstream first), or None."""
        with tempfile.TemporaryDirectory(prefix='loose-mp3-',dir=cache) as directory:
            source=Path(directory)/('source'+Path(name).suffix.lower());source.write_bytes(data);target=Path(directory)/'audio.mp3'
            if is_wwise_audio(source):
                wav=Path(directory)/'decoded.wav';convert_preview(executable,source,wav,purpose='Loose folder audio');source=wav
            run=subprocess.run([executable,'-nostdin','-hide_banner','-loglevel','error','-n','-i',str(source),'-vn','-c:a','libmp3lame','-q:a','2',str(target)],
                               stdin=subprocess.DEVNULL,capture_output=True,timeout=300,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            return target.read_bytes() if run.returncode==0 and target.is_file() and target.stat().st_size>0 else None

    BASELINE_CODECS={'.ogg':'vorbis','.wav':'pcm'}
    def ensure_baseline_stem(project,*,purpose='FeedPak audio'):
        """FeedPak 5.3.2: a distributable pack needs an OGG or WAV stem. When every stem is in
        another codec (an R+ folder's audio.wem, an MP3), decode the default stem once and add an
        OGG full mix (WAV without FFmpeg); the original stays in the pack as a non-default stem."""
        pack=project.get('_pack') or {};stems=(pack.get('manifest') or {}).get('stems') or []
        def resolved(stem):
            # Older projects stored the extension as the codec ("wav", "ogg"); read those as aliases.
            codec={'wav':'pcm','ogg':'vorbis'}.get(str(stem.get('codec') or '').lower(),str(stem.get('codec') or '').lower())
            return codec if codec in ('vorbis','pcm') else None if codec else BASELINE_CODECS.get(Path(str(stem.get('file',''))).suffix.lower())
        if not stems or any(resolved(stem) for stem in stems):return None
        source=next((s for s in stems if pack_io.stem_is_default(s)),stems[0]);data=pack.get('entries',{}).get(source.get('file'))
        if data is None:return None
        executable=shutil.which('ffmpeg')
        with tempfile.TemporaryDirectory(prefix='baseline-stem-',dir=cache) as directory:
            original=Path(directory)/('source'+Path(str(source['file'])).suffix.lower());original.write_bytes(base64.b64decode(data))
            wav=Path(directory)/'full.wav';convert_preview(executable,original,wav,purpose=purpose)
            name,codec,encoded='audio/full.wav','pcm',wav
            if executable:
                ogg=Path(directory)/'full.ogg'
                run=subprocess.run([executable,'-nostdin','-hide_banner','-loglevel','error','-n','-i',str(wav),'-c:a','libvorbis','-q:a','6',str(ogg)],
                                   stdin=subprocess.DEVNULL,capture_output=True,timeout=300,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                if run.returncode==0 and ogg.is_file() and ogg.stat().st_size>0:name,codec,encoded='audio/full.ogg','vorbis',ogg
            entries=pack['entries']
            while name in entries:name=name.replace('full','full-baseline',1)
            entries[name]=base64.b64encode(encoded.read_bytes()).decode('ascii')
        # The decoded mix becomes the default "full" stem; the original keeps its bytes as "source".
        for stem in stems:
            if stem.get('id')=='full':stem.update(id='source',name='Original audio')
            stem['default']=False
        stems.insert(0,{'id':'full','file':name,'default':True,'name':'Full mix','codec':codec})
        return f'Added {"an OGG" if codec=="vorbis" else "a WAV"} full mix decoded from {Path(str(source["file"])).name}: a FeedPak needs an OGG or WAV stem to play everywhere; the original audio stays in the pack'

    @app.post(PREFIX+'/audio-preview')
    async def audio_preview(payload: dict):
        nonlocal preview_reserved
        url = payload.get('url')
        token = url.rsplit('/',1)[-1] if isinstance(url,str) else ''
        if not token or url != asset_url(token):
            raise HTTPException(400,'Preview requires an existing plugin audio URL, not a path or remote URL')
        async with preview_gate:
            prune()
            item = original_asset(token)
            if item is None:
                raise HTTPException(404,'Source audio expired; upload the original audio again')
            source_token = next(key for key,value in assets.items() if value is item)
            existing = assets.get(item.get('preview_token'))
            if existing:
                preview_token = item['preview_token']
                return {'url':asset_url(preview_token),'token':preview_token,'name':existing['name'],'source_url':asset_url(source_token),'preview':True,'duration':existing['duration'],'media_type':'audio/wav'}
            executable = shutil.which('ffmpeg')
            if not executable and not (is_wwise_audio(item['path']) and vgmstream_executable()):
                raise HTTPException(503,'FFmpeg is unavailable; original audio is retained')
            if sum(asset['size'] for asset in assets.values())+MAX_AUDIO > MAX_CACHE:
                raise HTTPException(413,'Local audio cache cannot reserve a bounded preview; restart to clear it')
            preview_reserved += MAX_AUDIO
            preview_inflight.add(source_token)
            preview_token = uuid.uuid4().hex
            destination = cache/(preview_token+'.wav')
            try:
                task = asyncio.create_task(asyncio.to_thread(convert_preview,executable,item['path'],destination))
                try:
                    duration = await asyncio.shield(task)
                except asyncio.CancelledError:
                    # Keep the reservation and source alive until the bounded worker stops.
                    try: await task
                    finally: raise
                name = Path(item['name']).stem+'-preview.wav'
                assets[preview_token] = {'path':destination,'name':name,'size':destination.stat().st_size,'created':time.time(),'preview_of':source_token,'duration':duration}
                item['preview_token'] = preview_token
                return {'url':asset_url(preview_token),'token':preview_token,'name':name,'source_url':asset_url(source_token),'preview':True,'duration':duration,'media_type':'audio/wav'}
            finally:
                preview_reserved -= MAX_AUDIO
                preview_inflight.discard(source_token)
                if preview_token not in assets:
                    destination.unlink(missing_ok=True)

    @app.get(PREFIX+'/audio/{token}')
    async def serve_audio(token: str):
        prune()
        item = assets.get(token)
        if not item or item.get('kind')=='cover':
            raise HTTPException(404,'Audio is unavailable')
        return FileResponse(item['path'], media_type=mimetypes.guess_type(item['name'])[0] or 'application/octet-stream')
