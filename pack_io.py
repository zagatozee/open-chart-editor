"""Original Open Chart Editor interchange. No game code or assets are included.

Project times are seconds; strings are low to high; tuning is semitone offsets.
Opaque archive members and source records survive editing in private _pack/_wire
fields. These fields belong to the project, never to the Feedpak wire format.
"""
from __future__ import annotations

import base64
import copy
import io
import json
import math
import re
import struct
import subprocess
import sys
import tempfile
import uuid
import bisect
import zlib
import hashlib
import threading
import importlib.util
from pathlib import Path
from fractions import Fraction
from collections import deque,Counter
import zipfile
from xml.etree import ElementTree as ET
# Settings named before the project became Open Chart Editor (WORKSHOP_*) still apply.
import os
for _old in [k for k in os.environ if k.startswith('WORKSHOP_')]:
    os.environ.setdefault('OCE_'+_old[len('WORKSHOP_'):],os.environ[_old])

import yaml  # FeedBack host dependency; YAML is the Feedpak index format.

_contract_path=Path(__file__).with_name('feedpak_contract.py').resolve()
_contract_name='oce_feedpak_contract_'+hashlib.sha256(str(_contract_path).encode()).hexdigest()[:20]
_contract_spec=importlib.util.spec_from_file_location(_contract_name,_contract_path)
_feedpak_contract=importlib.util.module_from_spec(_contract_spec)
_contract_spec.loader.exec_module(_feedpak_contract)

try:
    from . import notation_state as _notation_state
except ImportError:
    import importlib.util
    _notation_spec=importlib.util.spec_from_file_location('open_chart_editor_notation_state',Path(__file__).with_name('notation_state.py'))
    _notation_state=importlib.util.module_from_spec(_notation_spec)
    _notation_spec.loader.exec_module(_notation_state)

try:
    from . import musicxml_dynamics as _musicxml_dynamics
except ImportError:
    # Standalone host loaders need an isolated, path-specific registered module
    # before exec: dataclasses resolve annotations through sys.modules.
    _dynamics_path=Path(__file__).with_name('musicxml_dynamics.py').resolve()
    _dynamics_name='open_chart_editor_dynamics_'+hashlib.sha256(str(_dynamics_path).encode()).hexdigest()[:20]
    _musicxml_dynamics=sys.modules.get(_dynamics_name)
    if _musicxml_dynamics is None or Path(getattr(_musicxml_dynamics,'__file__','')).resolve()!=_dynamics_path:
        _dynamics_spec=importlib.util.spec_from_file_location(_dynamics_name,_dynamics_path)
        _musicxml_dynamics=importlib.util.module_from_spec(_dynamics_spec)
        sys.modules[_dynamics_name]=_musicxml_dynamics
        try:
            _dynamics_spec.loader.exec_module(_musicxml_dynamics)
        except BaseException:
            sys.modules.pop(_dynamics_name,None)
            raise

try:
    from . import midi_programs as _midi_programs
except ImportError:
    _midi_path=Path(__file__).with_name('midi_programs.py').resolve()
    _midi_name='open_chart_editor_midi_programs_'+hashlib.sha256(str(_midi_path).encode()).hexdigest()[:20]
    _midi_programs=sys.modules.get(_midi_name)
    if _midi_programs is None or Path(getattr(_midi_programs,'__file__','')).resolve()!=_midi_path:
        _midi_spec=importlib.util.spec_from_file_location(_midi_name,_midi_path)
        _midi_programs=importlib.util.module_from_spec(_midi_spec);sys.modules[_midi_name]=_midi_programs
        try:_midi_spec.loader.exec_module(_midi_programs)
        except BaseException:
            sys.modules.pop(_midi_name,None)
            raise

MAX_BYTES = 256 * 1024 * 1024
MAX_MEMBERS = 4096
MAX_COVER = 8 * 1024 * 1024
MAX_RIG_LIBRARY = 8 * 1024 * 1024
MAX_GUIDE_VOICE = 64 * 1024
NOTE_TECH = ('sl slu bn bt bnv ho po hm hp pm mt vb tr ac tp ln fhm plk slp rh pkd fg ch sd ig').split()
XML_TECH = dict(zip(NOTE_TECH, ('slideTo slideUnpitchTo bend bendType bendValues hammerOn pullOff harmonic harmonicPinch palmMute mute vibrato tremolo accent tap linkNext fretHandMute pluck slap rightHand pickDirection leftHand chordId scaleDegree ignore').split()))
# These FeedBack advisory/teaching fields have no stock note XML attributes.
# Native chordId belongs to chord instances, never a per-note strum-group key.
for _wire_key in ('bt','ch','sd'):
    XML_TECH.pop(_wire_key)
BOOL_TECH = set('ho po hm hp pm mt tr ac ln fhm ig'.split())
TECH_NAMES = dict(zip(NOTE_TECH, ('slide_to slide_unpitch_to bend bend_type bend_values hammer_on pull_off harmonic harmonic_pinch palm_mute mute vibrato tremolo accent tap link_next fret_hand_mute pluck slap right_hand pick_direction left_hand strum_group scale_degree ignore').split()))
BASES = {'guitar': [40,45,50,55,59,64], 'bass': [28,33,38,43]}
MIDI_DRUMS = {35:'kick',36:'kick',38:'snare',40:'snare',37:'snare_xstick',50:'tom_hi',48:'tom_hi',47:'tom_mid',45:'tom_mid',43:'tom_low',41:'tom_floor',42:'hh_closed',46:'hh_open',44:'hh_pedal',49:'crash_l',57:'crash_r',55:'splash',52:'china',51:'ride',59:'ride',53:'ride_bell',80:'bell',30:'stack'}
LEVEL_FIELDS = ('notes','chords','anchors','handshapes')
MXL_SOURCE_PATH='editor/oce-musicxml-sources.json'
MXL_SOURCE_FORMAT='open-chart-editor-musicxml-source'
MAX_MXL_ATTACHMENT=32*1024*1024
MAX_MXL_METADATA=64*1024


class ProjectError(ValueError):
    """An actionable import/export validation error."""


def _instrument_bases(kind,count):
    """Original authoring defaults, low to high; labels never imply timbre."""
    guitar={4:[40,45,50,55],5:[40,45,50,55,59],6:[40,45,50,55,59,64],7:[35,40,45,50,55,59,64],8:[30,35,40,45,50,55,59,64]}
    bass={4:[28,33,38,43],5:[23,28,33,38,43],6:[23,28,33,38,43,48],7:[23,28,33,38,43,48,53],8:[23,28,33,38,43,48,53,58]}
    table=bass if kind=='bass' else guitar if kind=='guitar' else {}
    if count in table:return table[count][:]
    result=BASES.get(kind,[])[:count]
    while result and len(result)<count:result.append(result[-1]+5)
    return result


def _legacy_layout_bases(kind,count):
    """Frozen v1 writer basis; never substitute the new authoring defaults."""
    layouts={'guitar':{6:[40,45,50,55,59,64],7:[35,40,45,50,55,59,64],8:[30,35,40,45,50,55,59,64]},'bass':{4:[28,33,38,43],5:[23,28,33,38,43],6:[23,28,33,38,43,48]}}
    if count in layouts.get(kind,{}):return layouts[kind][count][:]
    result=BASES.get(kind,[])[:count]
    while result and len(result)<count:result.append(result[-1]+5)
    return result


def _feedpak_wire_bases(kind,count):
    """Existing public FeedBack baseline, separate from authored instrument bases."""
    if type(count) is not int or count not in range(4,9) or kind not in BASES:
        raise ProjectError('FeedBack fretted layouts require four through eight strings')
    if kind=='bass' and count in (4,5):return _instrument_bases(kind,count)
    return _instrument_bases('guitar',count)


def _layout_array(value,count,label,exact=True):
    if not isinstance(value,list) or any(type(v) is not int for v in value):
        raise ProjectError(label+' must contain integer semitone values')
    if exact and len(value)!=count or not exact and (len(value)>128 or any(value[count:])):
        raise ProjectError(label+' must agree with the declared string count')
    return value


def _effective_tuning(arr,*,target='stock'):
    count=arr.get('stringCount',len(arr.get('tuning',[])))
    standard=_feedpak_wire_bases(arr.get('type'),count) if target=='feedpak' else _instrument_bases(arr.get('type'),count)
    offsets=arr.get('tuning',[])
    bases=arr.get('basePitches') or _instrument_bases(arr.get('type'),count)
    if not standard:return copy.deepcopy(offsets),standard
    _layout_array(bases,count,'Open-string base pitches')
    _layout_array(offsets,count,'Authored tuning offsets',exact=False)
    return [bases[i]+(offsets[i] if i<len(offsets) else 0)-standard[i] for i in range(count)],standard


def _layout_wire_value(count,bases,tuning):
    _layout_array(bases,count,'Public base pitches')
    _layout_array(tuning,count,'Public tuning offsets')
    return {'stringCount':count,'basePitches':copy.deepcopy(bases),'tuning':copy.deepcopy(tuning)}


def _layout_digest(public):
    return hashlib.sha256(json.dumps(public,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf-8')).hexdigest()


def _layout_record(arr,public):
    bases=arr.get('basePitches') or _instrument_bases(arr['type'],arr['stringCount'])
    authored={'basePitches':copy.deepcopy(bases),'tuning':copy.deepcopy(arr.get('tuning',[]))}
    return {'version':2,'wire':copy.deepcopy(public),'sha256':_layout_digest(public),'authoring':authored}


def _restore_layout(arr,raw,entry):
    """Restore once from a verified projection; never apply offsets twice."""
    kind=arr['type']
    if kind not in BASES:return
    count=arr['stringCount']
    if type(count) is not int or count not in range(4,9):return
    offsets=arr['tuning']
    _layout_array(offsets,count,'FeedBack tuning offsets')
    layout=raw.get('oceStringLayout')
    if layout is None:
        # Public bases describe the actual basis of the accompanying offsets.
        bases=raw.get('basePitches') or _feedpak_wire_bases(kind,count)
        _layout_array(bases,count,'Public base pitches')
        arr['basePitches']=copy.deepcopy(bases)
        return
    if not isinstance(layout,dict):raise ProjectError('Malformed OCE string layout record')
    if layout.get('version')==1:
        bases=layout.get('basePitches');_layout_array(bases,count,'Legacy authored base pitches')
        legacy=_legacy_layout_bases(kind,count)
        # Both old emitter shapes are recognized: explicit legacy basis, or
        # an authored-base label beside offsets projected against legacy basis.
        public=raw.get('basePitches',legacy)
        if public not in (legacy,bases) or raw.get('tuning')!=offsets:
            raise ProjectError('Legacy string layout has ambiguous public bases or manifest tuning overrides; retain source JSON for explicit correction')
        arr['basePitches']=copy.deepcopy(bases)
        arr['tuning']=[offsets[i]+legacy[i]-bases[i] for i in range(count)]
        return
    if layout.get('version')!=2:
        raise ProjectError('Unsupported OCE string layout version; preserve the original project before editing its layout')
    public=_layout_wire_value(count,raw.get('basePitches'),raw.get('tuning'))
    if set(layout)!={'version','wire','sha256','authoring'} or layout.get('wire')!=public or layout.get('sha256')!=_layout_digest(public) or offsets!=public['tuning']:
        raise ProjectError('OCE string layout is stale or disagrees with the public chart/manifest tuning')
    authored=layout.get('authoring')
    if not isinstance(authored,dict) or set(authored)!={'basePitches','tuning'}:
        raise ProjectError('OCE authored layout has invalid fields')
    _layout_array(authored['basePitches'],count,'Authored base pitches')
    _layout_array(authored['tuning'],count,'Authored tuning offsets',exact=False)
    restored={**arr,'basePitches':authored['basePitches'],'tuning':authored['tuning']}
    projected,basis=_effective_tuning(restored,target='feedpak')
    if _layout_wire_value(count,basis,projected)!=public:
        raise ProjectError('OCE authored layout does not reproduce the bound public pitches')
    arr['basePitches']=copy.deepcopy(authored['basePitches']);arr['tuning']=copy.deepcopy(authored['tuning'])


def _notation_call(function,*args):
    try:return function(*args)
    except (ValueError,TypeError) as exc:raise ProjectError('Invalid notation preservation state: '+str(exc)) from exc


def notation_export_warnings(project):
    warnings=[row for row in _notation_call(_notation_state.notation_export_warnings,project)
              if not next((arr.get('_notationOnly') for arr in project.get('arrangements',[]) if arr.get('id')==row.get('arrangement')),False)]
    for arr in project.get('arrangements',[]):
        if arr.get('_notationOnly') and (arr.get('_notationBaseline') or {}).get('grid') != _notation_state.grid_fingerprint(project):
            warnings.append({'code':'notation-read-only-preserved','arrangement':arr['id'],
                'warning':f"{arr.get('name',arr['id'])}: retained source notation was not retimed to the edited song grid; its original reference and score bytes remain intact."})
    return warnings


def _lesson_references(document):
    """Arrangement ids a lesson judges in this pack (chart_ref objects without a feedpak path)."""
    found=set()
    def walk(value):
        if isinstance(value,dict):
            if isinstance(value.get('arrangement'),str) and 'bars' in value and not value.get('feedpak'):found.add(value['arrangement'])
            for item in value.values():walk(item)
        elif isinstance(value,list):
            for item in value:walk(item)
    walk(document)
    return found


def stamp_lesson_baseline(project):
    """Remember the beat map and arrangement names a pack's lessons were written against."""
    if ((project.get('_pack') or {}).get('manifest') or {}).get('lessons'):
        project['_lessonBaseline']={'grid':_notation_state.grid_fingerprint(project),
                                    'names':{a['id']:a.get('name',a['id']) for a in project.get('arrangements',[]) if isinstance(a,dict) and a.get('id')}}
    return project


def save_notices(project):
    """Plain-language notices for changes a FeedPak save makes that FeedBack will notice:
    parts losing their notation link, and lessons whose arrangement or bars changed."""
    notices=[]
    detached=set()
    for row in _notation_call(_notation_state.notation_export_warnings,project):
        arr=next((a for a in project.get('arrangements',[]) if a.get('id')==row.get('arrangement')),{})
        if arr.get('_notationOnly') or arr.get('hidden'):continue
        detached.add(row['arrangement']);name=arr.get('name',row['arrangement'])
        why='its notes were edited' if row.get('reason')=='chart-changed' else 'its notation could not be checked against the chart'
        notices.append(f'{name}: {why}, so it loses its link to the written notation. Keys 3D, Staff View and notation-based lessons will use the edited chart instead. The notation file stays in the pack.')
    pack=project.get('_pack') or {};lessons=(pack.get('manifest') or {}).get('lessons') or []
    baseline=project.get('_lessonBaseline') or {}
    kept={a['id']:a for a in project.get('arrangements',[]) if not a.get('editorOnly') and not a.get('hidden')}
    grid_changed=bool(baseline.get('grid')) and baseline['grid']!=_notation_state.grid_fingerprint(project)
    for lesson in lessons:
        member=lesson.get('file') if isinstance(lesson,dict) else None
        try:document=_decode_json(base64.b64decode(pack['entries'][member]),member)
        except (KeyError,TypeError,ValueError,UnicodeError):continue
        title=lesson.get('title') or (document.get('title') if isinstance(document,dict) else None) or lesson.get('id','lesson')
        for ref in sorted(_lesson_references(document)):
            arr=kept.get(ref)
            if arr is None:
                notices.append(f'Lesson "{title}" uses arrangement {ref}, which this save leaves out (deleted or hidden); the lesson will not find it.');continue
            name=arr.get('name',ref)
            if ref in detached:notices.append(f'Lesson "{title}" judges {name}, which loses its notation link in this save.')
            if grid_changed:notices.append(f'Lesson "{title}" points at bars of {name}, and the beat map has changed; check the lesson\'s bars still cover the same music.')
            old=(baseline.get('names') or {}).get(ref)
            if old is not None and old!=name:notices.append(f'Lesson "{title}" was written for "{old}", now named "{name}".')
    return notices


def stock_export_warnings(project,arrangement_id=None):
    warnings=[]
    for arr in project.get('arrangements',[]):
        if arr.get('editorOnly') or arrangement_id is not None and arr.get('id')!=arrangement_id:continue
        fields=set()
        for owner in [arr]+arr.get('difficulties',[]):
            notes=list(owner.get('notes',[]))+[n for chord in owner.get('chords',[]) for n in chord.get('notes',[])]
            for note in notes:
                tech=_short_techniques(note.get('techniques',{}))
                fields.update(TECH_NAMES[key] for key,default in [('bt',0),('ch',-1),('sd',-1)] if tech.get(key,default)!=default)
        if fields:
            warnings.append(f'{arr.get("name",arr.get("id","Arrangement"))}: stock Rocksmith2014 has no native note fields for {", ".join(sorted(fields))}; retain project JSON/Feedpak for these annotations. Explicit bend_values are exported; bend_type alone does not create a native bend curve.')
    return warnings


def validate_cover(cover):
    """Validate bounded embedded PNG bytes without executing an image decoder.

    CRCs, the complete bounded deflate stream and scanline filters are checked.
    Pixels are never rewritten; the original PNG remains the exported source.
    """
    if not isinstance(cover,dict) or not isinstance(cover.get('data'),str):
        raise ProjectError('Cover requires an embedded PNG object with name and base64 data; paths and URLs are unsupported')
    if len(cover['data'])>((MAX_COVER+2)//3)*4:
        raise ProjectError('Cover PNG exceeds the eight MiB limit')
    try:data=base64.b64decode(cover['data'],validate=True)
    except ValueError as exc:raise ProjectError('Cover data is not valid base64') from exc
    if len(data)>MAX_COVER or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ProjectError('Cover must be a PNG no larger than eight MiB')
    offset=8;count=0;header=None;compressed=[];palette=False;ended=False
    while offset<len(data):
        count+=1
        if count>8192 or offset+12>len(data):raise ProjectError('Cover PNG has invalid or excessive chunks')
        size=struct.unpack_from('>I',data,offset)[0];kind=data[offset+4:offset+8];stop=offset+12+size
        if stop>len(data) or not re.fullmatch(b'[A-Za-z]{4}',kind):raise ProjectError('Cover PNG has an invalid chunk boundary')
        payload=data[offset+8:offset+8+size]
        if zlib.crc32(kind+payload)&0xffffffff!=struct.unpack_from('>I',data,offset+8+size)[0]:raise ProjectError('Cover PNG checksum is invalid')
        if count==1 and kind!=b'IHDR':raise ProjectError('Cover PNG must begin with IHDR')
        if kind==b'IHDR':
            if header is not None or size!=13:raise ProjectError('Cover PNG has an invalid IHDR')
            header=struct.unpack('>IIBBBBB',payload)
        elif kind==b'IDAT':compressed.append(payload)
        elif kind==b'PLTE':
            if not size or size%3 or size>768 or palette:raise ProjectError('Cover PNG palette is invalid')
            palette=True
        elif kind==b'IEND':
            if size or stop!=len(data):raise ProjectError('Cover PNG has invalid trailing data')
            ended=True
        elif kind==b'acTL':raise ProjectError('Cover must be a static PNG, not an animated PNG')
        elif kind[0]<97:raise ProjectError('Cover PNG contains an unsupported critical chunk')
        offset=stop
    if not ended or not compressed or header is None:raise ProjectError('Cover PNG is incomplete')
    width,height,depth,color,compression,filtering,interlace=header
    allowed={0:(1,2,4,8,16),2:(8,16),3:(1,2,4,8),4:(8,16),6:(8,16)}
    if not 1<=width<=4096 or not 1<=height<=4096:raise ProjectError('Cover PNG dimensions must be between1 and4096 pixels')
    if color not in allowed or depth not in allowed[color] or compression or filtering or interlace not in (0,1):raise ProjectError('Cover PNG uses unsupported header values')
    if color==3 and not palette:raise ProjectError('Indexed cover PNG requires a palette')
    channels={0:1,2:3,3:1,4:2,6:4}[color]
    passes=[(0,0,1,1)] if not interlace else [(0,0,8,8),(4,0,8,8),(0,4,4,8),(2,0,4,4),(0,2,2,4),(1,0,2,2),(0,1,1,2)]
    rows=[]
    for x,y,dx,dy in passes:
        w=max(0,(width-x+dx-1)//dx);h=max(0,(height-y+dy-1)//dy)
        if w and h:rows.extend([1+(w*channels*depth+7)//8]*h)
    expected=sum(rows);total=0;row=0;position=0
    def consume(block):
        nonlocal total,row,position
        total+=len(block)
        if total>expected:raise ProjectError('Cover PNG expands beyond its declared bounded dimensions')
        start=0
        while start<len(block):
            if row>=len(rows) or position==0 and block[start]>4:raise ProjectError('Cover PNG has an invalid scanline filter')
            step=min(len(block)-start,rows[row]-position);start+=step;position+=step
            if position==rows[row]:row+=1;position=0
    decoder=zlib.decompressobj()
    try:
        for chunk in compressed:
            pending=chunk
            while pending:
                consume(decoder.decompress(pending,1024*1024));pending=decoder.unconsumed_tail
        while block:=decoder.decompress(b'',1024*1024):consume(block)
    except zlib.error as exc:raise ProjectError('Cover PNG has an invalid compressed pixel stream') from exc
    if not decoder.eof or decoder.unused_data or total!=expected:raise ProjectError('Cover PNG pixel data does not match its dimensions')
    name=cover.get('name','cover.png')
    if not isinstance(name,str):raise ProjectError('Cover name must be text')
    name=Path(name).name or 'cover.png'
    if not name.lower().endswith('.png'):name+='.png'
    return data,width,height,name


def _xml_input(data):
    """Normalize supported XML text encodings before checking declarations.

    Byte-only checks can miss UTF-16 entity declarations. Inspect normalized text
    first; external MusicXML doctypes are allowed later but entities never are.
    """
    if data.startswith((b'\xff\xfe\x00\x00',b'\x00\x00\xfe\xff')):
        text=data.decode('utf-32')
    elif data.startswith((b'\xff\xfe',b'\xfe\xff')):
        text=data.decode('utf-16')
    elif data.startswith(b'\x00\x00\x00<'):
        text=data.decode('utf-32-be')
    elif data.startswith(b'<\x00\x00\x00'):
        text=data.decode('utf-32-le')
    elif data.startswith(b'\x00<'):
        text=data.decode('utf-16-be')
    elif data.startswith(b'<\x00'):
        text=data.decode('utf-16-le')
    else:
        match=re.search(br'<\?xml[^>]*encoding\s*=\s*[\'"]([^\'"]+)',data[:512],re.I)
        encoding=match[1].decode('ascii').lower() if match else 'utf-8-sig'
        if encoding not in ('utf-8','utf8','utf-8-sig','iso-8859-1','iso8859-1','windows-1252','us-ascii'):
            raise ProjectError('Unsupported XML text encoding; convert the source to UTF-8')
        text=data.decode(encoding)
    if '\x00' in text:
        raise ProjectError('Unsupported or invalid XML text encoding; convert the source to UTF-8')
    if '<!ENTITY' in text.upper() or re.search(r'<!DOCTYPE[^>]*\[',text,re.I):
        raise ProjectError('XML internal DTD/entity declarations are unsupported')
    text=re.sub(r'(<\?xml[^>]*encoding\s*=\s*)([\'"])[^\'"]+\2',r'\1"utf-8"',text,count=1,flags=re.I)
    result=text.encode('utf-8')
    if len(result)>MAX_BYTES:
        raise ProjectError('Decoded XML exceeds the import size limit')
    return result


def _json(data):
    return json.dumps(data, ensure_ascii=False, allow_nan=False, indent=2).encode('utf-8')


def _path(name):
    if not isinstance(name, str) or not name or any(ord(char)<32 for char in name) or '\\' in name or ':' in name or name.startswith('/') or any(p in ('', '.', '..') for p in name.split('/')):
        raise ProjectError('Unsafe archive path')
    return name


def _decode_json_raw(data, filename=''):
    """Strict UTF-8 JSON; comments are allowed only by a .jsonc filename."""
    source = data.decode('utf-8-sig')
    if str(filename).lower().endswith('.jsonc'):
        source = re.sub(r'("(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/)',
            lambda match: match[0] if match[0].startswith('"') else
            ''.join('\n' if char == '\n' else '\r' if char == '\r' else ' ' for char in match[0]), source)
    def invalid_constant(value):
        raise ProjectError('JSON contains a non-finite constant: ' + value)
    def finite_float(value):
        number=float(value)
        if not math.isfinite(number):
            raise ProjectError('JSON number exceeds the finite numeric range: ' + value)
        return number
    return json.loads(source, parse_constant=invalid_constant, parse_float=finite_float)



# Field names and sidecar format markers written before the project was renamed Open
# Chart Editor. Old files keep opening: they are read as their current names.
_OLD_KEYS={'workshopStringLayout':'oceStringLayout','workshopGuideVoice':'oceGuideVoice'}
_OLD_FORMAT_PREFIX,_FORMAT_PREFIX='workshop-editor-','open-chart-editor-'


def _current_names(value):
    if isinstance(value,dict):
        for old,new in _OLD_KEYS.items():
            if old in value and new not in value:value[new]=value.pop(old)
        format_value=value.get('format')
        if isinstance(format_value,str) and format_value.startswith(_OLD_FORMAT_PREFIX):
            value['format']=_FORMAT_PREFIX+format_value[len(_OLD_FORMAT_PREFIX):]
        for item in value.values():_current_names(item)
    elif isinstance(value,list):
        for item in value:_current_names(item)
    return value


def _decode_json(data, filename=''):
    """Strict UTF-8 JSON (see _decode_json_raw), with names from before the rename updated."""
    return _current_names(_decode_json_raw(data, filename))

def feedpak_validation_status():
    return _feedpak_contract.status()


def validate_feedpak_entries(manifest, entries):
    try:
        return _feedpak_contract.validate(manifest, entries, _decode_json, _path, _check_manifest_tree)
    except _feedpak_contract.ContractError as exc:
        raise ProjectError(str(exc)) from exc


def _check_manifest_tree(value):
    active=set();count=0
    def walk(node,depth):
        nonlocal count
        count+=1
        if depth>64 or count>200000:
            raise ProjectError('Feedpak manifest nesting or expanded YAML aliases exceed the safe limit')
        if isinstance(node,(dict,list)):
            identity=id(node)
            if identity in active:
                raise ProjectError('Recursive YAML aliases are unsupported in a Feedpak manifest')
            active.add(identity)
            if isinstance(node,dict):
                if any(not isinstance(key,str) for key in node):
                    raise ProjectError('Feedpak manifest mapping keys must be strings')
                for child in node.values():walk(child,depth+1)
            else:
                for child in node:walk(child,depth+1)
            active.remove(identity)
        elif node is not None and (not isinstance(node,(str,int,float,bool)) or isinstance(node,float) and not math.isfinite(node)):
            raise ProjectError('Feedpak manifest must contain JSON-compatible YAML values; quote dates or custom values as strings')
    walk(value,0)


def _section(section):
    item = copy.deepcopy(section)
    item['start_time'] = item.pop('time', item.pop('startTime', item.get('start_time', 0)))
    return item


def _wire_section(section):
    item = copy.deepcopy(section)
    item['time'] = item.pop('start_time', item.get('time', 0))
    return item


def _note(note, index, keys=False, drums=False):
    out = {'id': f'n{index}', 'time': note.get('t', 0), 'string': note.get('s', 0), 'fret': note.get('f', 0), 'sustain': note.get('sus', 0), 'techniques': {TECH_NAMES[k]: copy.deepcopy(note[k]) for k in NOTE_TECH if k in note}, '_wire': copy.deepcopy(note)}
    if 'vibrato' in note and not drums:
        out['techniques']['vibrato']=_vibrato_intensity(note['vibrato'])
    if 'tap' in note and not drums:
        out['techniques']['tap']=_tap_finger(note['tap'])
    if 'forceDestPitch' in note and not drums:
        out['techniques']['force_destination_pitch']=_force_destination_pitch(note['forceDestPitch'])
    if keys:
        out['pitch'] = note.get('m',out['string'] * 24 + out['fret'])
        if note.get('hand') in ('lh','rh'):
            out['hand']=note['hand']
        if 'velocity' in note:
            out['velocity']=note['velocity']
    if drums:
        out.update(piece=note.get('p', 'snare'), velocity=note.get('v', 100), ghost=note.get('g', False), flam=note.get('f', False), choke=note.get('k', 0))
        out['fret'] = 0
    return out


def _wire_note(note, keys=False, drums=False):
    out = copy.deepcopy(note.get('_wire', {}))
    if drums:
        out.update(t=note['time'], p=note.get('piece', 'snare'), v=note.get('velocity', 100), g=note.get('ghost', False), f=note.get('flam', False), k=note.get('choke', 0))
    else:
        string, fret = note.get('string', 0), note.get('fret', 0)
        if keys and 'pitch' in note:
            string, fret = divmod(int(note['pitch']), 24)
        out.update(t=note['time'], s=string, f=fret, sus=note.get('sustain', 0))
        if keys:
            out['m']=int(note.get('pitch',string*24+fret))
            out.pop('hand',None)
            hand=note.get('hand',note.get('techniques',{}).get('hand'))
            if hand in ('lh','rh'):
                out['hand']=hand
            out.pop('velocity',None)
            if note.get('velocity') is not None:
                # Schema-permitted authoring extension; current host Note has
                # native hand/m fields but no keyboard velocity playback field.
                out['velocity']=note['velocity']
        for key in NOTE_TECH:
            out.pop(key, None)
        out.update(_short_techniques(note.get('techniques', {})))
        out.pop('vibrato',None)
        if 'vb' in out:
            value=out['vb']
            out['vb']=bool(_vibrato_intensity(value))
            # Feedpak vb is boolean. This explicit schema-permitted authoring
            # extension retains native XML strength; current host playback reads vb.
            if not isinstance(value,bool) and value:
                out['vibrato']=_vibrato_intensity(value)
        out.pop('tap',None)
        if 'tp' in out:
            value=out['tp']
            out['tp']=bool(_tap_finger(value))
            if not isinstance(value,bool) and value:
                out['tap']=_tap_finger(value)
        out.pop('forceDestPitch',None)
        force=_force_destination_pitch(note.get('techniques',{}).get('force_destination_pitch',0))
        if force:
            # Authoring extension only: FeedBack does not consume this flag for
            # scoring. Stock2014 exports explicitly reject non-Auto states.
            out['forceDestPitch']=force
    return out


def _force_destination_pitch(value):
    if not isinstance(value,int) or isinstance(value,bool) or value not in (0,1,2):
        raise ProjectError('Force Destination Pitch must be0(Auto),1(On)or2(Off)')
    return value


def _vibrato_intensity(value):
    # Note.cs documents byte strengths40/80/120. New boolean-on uses80;
    # imported numeric bytes including1 are preserved exactly.
    if isinstance(value,bool):
        return 80 if value else 0
    if not isinstance(value,int) or not 0<=value<=255:
        raise ProjectError('Vibrato strength must be an integer between0 and255')
    return value


def _tap_finger(value):
    # Native Note.Tap is a signed byte. Only positive values reach the
    # public converter's SNG Tap field; no finger labels are inferred here.
    if isinstance(value,bool):return int(value)
    if not isinstance(value,int) or not -128<=value<=127:
        raise ProjectError('Native tap value must be a signed byte between -128 and127')
    return value


def _mute_flag(value, key):
    """Project a mute flag while retaining the original authoring representation."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value > 0
    if isinstance(value, float) and math.isfinite(value):
        return value > 0
    raise ProjectError(f'{TECH_NAMES[key]} must be a boolean or finite number (positive means enabled)')


def _chord_mute_techniques(chord):
    """Canonical authored flags override raw parent/source aliases as a group."""
    parent = {key: chord[key] for key in ('pm', 'mt', 'fhm') if key in chord}
    for key in ('pm', 'mt', 'fhm'):
        if XML_TECH[key] in chord:
            parent[key] = chord[XML_TECH[key]]
    explicit = _short_techniques(chord.get('techniques', {}))
    if 'mt' in explicit or 'fhm' in explicit:
        parent.pop('mt', None)
        parent.pop('fhm', None)
    parent.update({key: value for key, value in explicit.items() if key in ('pm', 'mt', 'fhm')})
    return {key: _mute_flag(value, key) for key, value in parent.items()}


def _short_techniques(techniques):
    out = {k:copy.deepcopy(v) for k,v in techniques.items() if k in NOTE_TECH}
    for key,name in TECH_NAMES.items():
        if name in techniques:
            out[key] = copy.deepcopy(techniques[name])
    # Mute output flags follow the UI: only true or positive finite numbers
    # are active. This changes copies, never the editable/source values.
    for key in ('pm', 'mt', 'fhm'):
        if key in out:
            out[key] = _mute_flag(out[key], key)
    # Older project JSON from the XML adapter may contain native numeric
    # sentinels. Preserve their native meaning when normalizing to wire bools.
    for key in ('plk','slp'):
        if key in out and isinstance(out[key],int) and not isinstance(out[key],bool):
            out[key]=out[key]!=-1
    for key,minimum,maximum in [('bt',0,4),('fg',-1,4),('ch',-1,None),('sd',-1,11),('pkd',-1,1)]:
        if key in out:
            value=out[key]
            if not isinstance(value,int) or isinstance(value,bool) or value<minimum or maximum is not None and value>maximum:
                raise ProjectError(f'{TECH_NAMES[key]} must be an integer from {minimum}'+(f' to {maximum}' if maximum is not None else ' upwards'))
    if 'rh' in out and (not isinstance(out['rh'],int) or isinstance(out['rh'],bool) or out['rh']< -1):
        raise ProjectError('right_hand must be an integer at least -1 (-1 means unset)')
    if 'tp' in out:_tap_finger(out['tp'])
    return out


def _chord_child(note,time,keys=False,drums=False):
    if not isinstance(note,dict):raise ProjectError('Chord child must be a note object')
    if any(key in note for key in ('string','fret','pitch','techniques','sustain','piece','velocity','ghost','flam','choke')):
        return {**note,'time':note.get('time',time)}
    return _note({**note,'t':note.get('t',time)},0,keys=keys,drums=drums)


def _chord_reference(chord):
    return chord.get('chord_id') if 'chord_id' in chord else chord.get('id') if type(chord.get('id')) is int else None


def _wire_chord(chord,keys=False):
    parent_force=chord.get('techniques',{}).get('force_destination_pitch',chord.get('forceDestPitch'))
    if parent_force is not None and chord.get('notes'):
        chord=copy.deepcopy(chord)
        for note in chord['notes']:
            note.setdefault('techniques',{}).setdefault('force_destination_pitch',_force_destination_pitch(parent_force))
    out = copy.deepcopy(chord.get('_wire',{}))
    out.update({k: copy.deepcopy(v) for k,v in chord.items() if not k.startswith('_') and k != 'notes'})
    for key in ('pm', 'mt', 'fhm'):
        out.pop(key, None)
        out.pop(XML_TECH[key], None)
    out.update(_chord_mute_techniques(chord))
    out['hd']=bool(chord.get('highDensity',chord.get('hd',out.get('hd',False))))
    out.pop('highDensity',None)
    if 'time' in out:
        out['t'] = out.pop('time')
    if 'chord_id' in out:
        out['id'] = out.pop('chord_id')
        if out['id'] is None:out.pop('id')
    if chord.get('notes') is not None:
        out['notes'] = [_wire_note(_chord_child(n,chord.get('time',chord.get('t',0)),keys),keys=keys) for n in chord['notes']]
        for note in out['notes']:
            note.pop('t',None)
    flags = _chord_flags(chord)
    for key,value in flags.items():
        if value or key in out:
            out[key]=value
    if 'mt' in out:
        out['mt'] = flags['fhm']
    forces=[_force_destination_pitch(note.get('techniques',{}).get('force_destination_pitch',0)) for note in chord.get('notes',[])]
    force=forces[0] if forces and len(set(forces))==1 else 0 if forces else _force_destination_pitch(chord.get('techniques',{}).get('force_destination_pitch',chord.get('forceDestPitch',0)))
    out.pop('forceDestPitch',None)
    if force:out['forceDestPitch']=force
    return out


def live_bundle(arrangement, beats, sections=(), info=None):
    """One part in the shapes FeedBack's highway renderers draw (its chart WebSocket's wire
    format), for the editor's live view. Uses the FeedPak writers, so it needs no FeedBack."""
    arr=copy.deepcopy(arrangement); kind=arr.get('type','guitar'); keys=kind=='keys'; info=info or {}
    arp=lambda template:str(template.get('displayName','')).endswith('-arp')
    def label(template):
        # R+ fills displayName with its fret/finger code (Am_X02210_XX231X, XX9X12X_XX1X4X); show the name.
        shown=str(template.get('displayName') or template.get('name') or '')
        coded=re.fullmatch(r'(?:(.+?)_)?[X\d]+_[X\d]+(?:-arp|-nop)?',shown)
        return (template.get('name') or (coded.group(1) if coded and coded.group(1) else '')) if coded else shown
    templates=[{'name':t.get('name',''),'displayName':label(t),'arp':arp(t),
                'fingers':list(t.get('fingers',[])),'frets':list(t.get('frets',[]))} for t in arr.get('chord_templates',[])]
    handshapes=[{'chord_id':h.get('chord_id',0),'start_time':h.get('start_time',0),'end_time':h.get('end_time',0),
                 'arp':arp(templates[h['chord_id']]) if isinstance(h.get('chord_id'),int) and 0<=h['chord_id']<len(templates) else False}
                for h in sorted(arr.get('handshapes',[]),key=lambda h:h.get('start_time',0))]
    count=arr.get('stringCount') or len(arr.get('tuning') or [])
    return {
        'songInfo':{'title':info.get('title',''),'artist':info.get('artist',''),'duration':info.get('duration',0),'arrangement':arr.get('name',''),
                    'tuning':list(arr.get('tuning',[])) if kind in ('guitar','bass') else [],'stringCount':count,'capo':arr.get('capo',0),
                    'centOffset':arr.get('centOffset',0),'offset':0},
        'notes':[_wire_note(n,keys=keys) for n in sorted(arr.get('notes',[]),key=lambda n:n.get('time',0))],
        'chords':[_wire_chord(c,keys=keys) for c in sorted(arr.get('chords',[]),key=lambda c:c.get('time',0))],
        'anchors':[{'time':a.get('time',0),'fret':a.get('fret',1),'width':a.get('width',4)} for a in sorted(arr.get('anchors',[]),key=lambda a:a.get('time',0))],
        'handShapes':handshapes,'chordTemplates':templates,'stringCount':count,
        'beats':[{'time':b.get('time',0),'measure':b.get('measure',-1)} for b in beats],
        'sections':[{'name':x.get('name',''),'time':x.get('start_time',x.get('time',0))} for x in sections],
    }


def _chord(chord,index,keys=False):
    out = {k:copy.deepcopy(v) for k,v in chord.items() if k not in ('t','id','notes')}
    out.update(time=chord.get('t',0),chord_id=chord.get('id'),_wire=copy.deepcopy(chord))
    out['highDensity']=bool(out.pop('hd',chord.get('highDensity',False)))
    out['notes'] = [_note({**n,'t':chord.get('t',0)},i,keys=keys) for i,n in enumerate(chord.get('notes',[]))]
    return out


def _materialize_chords(arr,native=False):
    templates=arr.get('chord_templates',[])
    for index,chord in enumerate(arr.get('chords',[])):
        parent={key:chord[key] for key in NOTE_TECH if key in chord}
        for key,xml_key in XML_TECH.items():
            if key!='bnv' and xml_key in chord:
                parent[key]=chord[xml_key]
        parent.update(_short_techniques(chord.get('techniques',{})))
        for key in ('pm','mt','fhm'):
            parent.pop(key,None)
        parent.update(_chord_mute_techniques(chord))
        inherited={TECH_NAMES[key]:bool(value) if key in BOOL_TECH else copy.deepcopy(value) for key,value in parent.items()}
        if 'forceDestPitch' in chord or 'force_destination_pitch' in chord.get('techniques',{}):
            inherited['force_destination_pitch']=_force_destination_pitch(chord.get('techniques',{}).get('force_destination_pitch',chord.get('forceDestPitch')))
        if not chord.get('notes'):
            template_id=chord.get('chord_id',0)
            if not isinstance(template_id,int) or not 0<=template_id<len(templates):
                raise ProjectError('An implicit chord refers to a missing chord template')
            template=templates[template_id]
            chord['notes']=[]
            for string,fret in enumerate(template.get('frets',[])):
                if fret<0:
                    continue
                techniques=copy.deepcopy(inherited)
                fingers=template.get('fingers',[])
                if string<len(fingers) and fingers[string] in (0,1,2,3,4):
                    techniques.setdefault('left_hand',fingers[string])
                chord['notes'].append({'id':f'chord-{index}-string-{string}','time':chord.get('time',chord.get('t',0)),'string':string,'fret':fret,'sustain':chord.get('sustain',chord.get('sus',0)),'techniques':techniques})
        else:
            for note in chord['notes']:
                if 'time' in note and (not isinstance(note['time'],(int,float)) or not math.isfinite(note['time']) or abs(note['time']-chord.get('time',chord.get('t',0)))>1e-7):
                    raise ProjectError('Chord child time must equal its chord attack; independent timing cannot be represented inside a chord')
                note['time']=chord.get('time',chord.get('t',0))
                techniques=note.setdefault('techniques',{})
                for key,value in inherited.items():
                    techniques.setdefault(key,copy.deepcopy(value))
            # Native chord pitches always come from the complete template;
            # a partial chordNote list only adds techniques on selected strings.
            if native:
                reference=chord.get('chord_id')
                if type(reference) is not int or not 0<=reference<len(templates):raise ProjectError('Native chord refers to a missing template')
                present={note['string'] for note in chord['notes']}
                template=templates[reference];fingers=template.get('fingers',[])
                for string,fret in enumerate(template.get('frets',[])):
                    if fret<0 or string in present:continue
                    techniques=copy.deepcopy(inherited)
                    if string<len(fingers) and fingers[string] in (0,1,2,3,4):techniques.setdefault('left_hand',fingers[string])
                    chord['notes'].append({'id':f'chord-{index}-string-{string}','time':chord['time'],'string':string,'fret':fret,'sustain':0,'techniques':techniques})
                chord['notes'].sort(key=lambda note:note['string'])


def _chord_flags(chord):
    """Whole-chord flags agree with the editable child notes when present."""
    notes=chord.get('notes',[])
    if not notes:
        parent = _chord_mute_techniques(chord)
        return {'pm':parent.get('pm',False), 'fhm':parent.get('fhm',False) or parent.get('mt',False)}
    per_note=[_short_techniques(n.get('techniques',{})) for n in notes]
    for tech in per_note:
        tech['fhm']=bool(tech.get('fhm',False) or tech.get('mt',False))
    return {key:(any(bool(n.get(key,False)) for n in per_note) if key=='ln' else all(bool(n.get(key,False)) for n in per_note)) for key in ('pm','ac','fhm','ig','ln')}


def _snapshot_arrangement(arr):
    if not arr.get('difficulties'):
        return arr
    arr=copy.deepcopy(arr)
    ids=[level.get('difficulty') for level in arr['difficulties']]
    if any(not isinstance(d,int) or d<0 for d in ids) or len(set(ids))!=len(ids):
        raise ProjectError('Difficulty values must be unique nonnegative integers')
    active=arr.get('activeDifficulty',max(ids))
    if active not in ids:
        raise ProjectError('Active difficulty does not exist in the arrangement')
    current=next(level for level in arr['difficulties'] if level['difficulty']==active)
    current.update({field:copy.deepcopy(arr.get(field,[])) for field in LEVEL_FIELDS})
    arr['difficulties'].sort(key=lambda level:level['difficulty'])
    return arr


def arrangement_role(arr):
    """Export routing is independent of the user-editable display name."""
    role=arr.get('role')
    if role is None or role=='':
        role='bass' if arr.get('type')=='bass' else 'rhythm' if 'rhythm' in str(arr.get('name','')).lower() else 'lead'
    if role not in ('lead','rhythm','bass'):
        raise ProjectError('Stock arrangement role must be lead, rhythm or bass')
    if arr.get('type')=='bass' and role!='bass' or arr.get('type')=='guitar' and role=='bass':
        raise ProjectError('Arrangement role conflicts with its guitar/bass instrument type')
    return role


def validate_cdlc_strings(project,arrangement_ids,include_vocals=False):
    for arr in project.get('arrangements',[]):
        if arr['id'] not in arrangement_ids:
            continue
        for template in arr.get('chord_templates',[]):
            if len(str(template.get('name','')).encode('utf-8'))>31:
                raise ProjectError('A chord name exceeds the stock SNG limit of31 UTF-8 bytes; shorten its game label or save as project JSON/Feedpak')
        for phrase in arr.get('phrases',[]):
            if len(str(phrase.get('name','')).encode('utf-8'))>31:
                raise ProjectError('A phrase name exceeds the stock SNG limit of31 UTF-8 bytes; shorten its game label')
    if include_vocals:
        for vocal in project.get('vocals',[]):
            _validate_vocal_xml_text(vocal['text'])
            if len(vocal['text'].encode('utf-8'))>47:
                raise ProjectError('A vocal syllable exceeds the stock SNG limit of47 UTF-8 bytes; split it before packaging')


def _feedpak_difficulties(raw,kind):
    phrases=raw.get('phrases',[])
    difficulties=sorted({int(level.get('difficulty',0)) for phrase in phrases for level in phrase.get('levels',[])})
    result=[]
    for difficulty in difficulties:
        accumulated={field:[] for field in LEVEL_FIELDS}
        for phrase in phrases:
            eligible=[level for level in phrase.get('levels',[]) if int(level.get('difficulty',0))<=difficulty]
            if not eligible:
                continue
            source=max(eligible,key=lambda level:int(level.get('difficulty',0)))
            for field in LEVEL_FIELDS:
                accumulated[field].extend(copy.deepcopy(source.get(field,[])))
        accumulated['notes']=[_note(n,i,keys=kind=='keys') for i,n in enumerate(accumulated['notes'])]
        accumulated['chords']=[_chord(c,i,keys=kind=='keys') for i,c in enumerate(accumulated['chords'])]
        result.append({'difficulty':difficulty,**accumulated})
    return result


def _arrangement(raw, entry, index, drums=False):
    label = str(entry.get('name',raw.get('name',entry.get('id','')))).lower()
    inferred = 'bass' if 'bass' in label else 'keys' if any(k in label for k in ('piano','keys','keyboard','synth')) else 'guitar'
    kind = entry.get('type', raw.get('type', inferred))
    kind = 'keys' if kind in ('piano', 'keyboard') else kind
    tuning = copy.deepcopy(entry.get('tuning', raw.get('tuning', [0] * len(BASES.get(kind, [0]*6)))))
    arr = {'id': entry.get('id', f'arr{index}'), 'name': entry.get('name', raw.get('name', f'Arrangement {index+1}')), 'type': kind, 'tuning': tuning, 'stringCount': raw.get('stringCount', len(tuning)), 'basePitches': copy.deepcopy(raw.get('basePitches') or _instrument_bases(kind,raw.get('stringCount',len(tuning)))), 'capo': entry.get('capo', raw.get('capo', 0)), 'notes': [_note(n, i, kind == 'keys', drums) for i,n in enumerate(raw.get('hits' if drums else 'notes', []))], 'chords': copy.deepcopy(raw.get('chords', [])), 'chord_templates': copy.deepcopy(raw.get('templates', [])), 'anchors': copy.deepcopy(raw.get('anchors', [])), 'handshapes': copy.deepcopy(raw.get('handshapes', [])), '_wire': copy.deepcopy(raw), '_entry': copy.deepcopy(entry)}
    _restore_layout(arr,raw,entry)
    arr['centOffset']=entry.get('centOffset',raw.get('centOffset',0))
    if 'oceGuideVoice' in raw:
        arr['guideVoice']=copy.deepcopy(raw['oceGuideVoice'])
    if raw.get('phrases'):
        arr['phrases'] = [{'id':f'p{i}','name':p.get('name',f'Phrase {i+1}'),'time':p.get('start_time',0)} for i,p in enumerate(raw['phrases'])]
    tones = copy.deepcopy(entry.get('tones',raw.get('tones')))
    if isinstance(tones,dict):
        tones['changes'] = [{**c,'time':c.get('t',0)} for c in tones.get('changes',[])]
        if isinstance(tones.get('definitions'),list):
            # Two definitions sharing a name must not collapse into one on this list->dict
            # conversion (done for editing convenience); disambiguate instead of losing data.
            seen={}
            named={}
            for i,t in enumerate(tones['definitions']):
                name=str(t.get('name',t.get('id',f'Tone {i}')))
                if name in seen:
                    seen[name]+=1
                    name=f'{name} ({seen[name]})'
                else:
                    seen[name]=1
                named[name]=t
            tones['definitions'] = named
        arr['tones'] = tones
    arr['chords'] = [_chord(c,i,keys=kind=='keys') for i,c in enumerate(raw.get('chords',[]))]
    _materialize_chords(arr)
    arr['instrument']=raw.get('instrument',entry.get('instrument',kind))
    difficulties=_feedpak_difficulties(raw,kind)
    if difficulties:
        for authored in difficulties:
            _materialize_chords({'chords':authored['chords'],'chord_templates':arr['chord_templates']})
        arr['difficulties']=difficulties
        arr['activeDifficulty']=difficulties[-1]['difficulty']
        arr.update({field:copy.deepcopy(difficulties[-1][field]) for field in LEVEL_FIELDS if field not in raw})
    return arr


def _finite_record(value,label,minimum=0):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or minimum is not None and value<minimum:
        raise ProjectError(label+' must be finite'+(' and nonnegative' if minimum==0 else ''))
    return value


def _record_array(owner,key,label):
    rows=owner.get(key,[])
    if not isinstance(rows,list) or any(not isinstance(row,dict) for row in rows):
        raise ProjectError(label+' must be an array of objects')
    return rows


def _validate_note_record(note,arr,label,parent_time=None):
    if not isinstance(note,dict):raise ProjectError(label+' must be a note object')
    if parent_time is not None:
        note=_chord_child(note,parent_time,keys=arr.get('type')=='keys',drums=arr.get('type')=='drums')
    time=_finite_record(note.get('time'),label+' time')
    if parent_time is not None and abs(time-parent_time)>1e-7:
        raise ProjectError(label+' time must equal its chord attack; split independently timed voices into single notes')
    _finite_record(note.get('sustain',0),label+' sustain')
    kind=arr.get('type')
    if kind=='keys':
        if 'pitch' in note:pitch=note['pitch']
        else:
            string,fret=note.get('string',0),note.get('fret',0)
            if type(string) is not int or type(fret) is not int:raise ProjectError(label+' piano coordinates must be integers')
            pitch=string*24+fret
        if type(pitch) is not int or not 0<=pitch<=127:raise ProjectError(label+' Piano MIDI pitch must be an integer between 0 and 127')
        if note.get('hand') not in (None,'','lh','rh'):raise ProjectError(label+' Piano hand must be lh, rh or unassigned')
    elif kind=='drums':
        if not isinstance(note.get('piece','snare'),str) or not note.get('piece','snare'):
            raise ProjectError(label+' drum piece must be a nonempty string')
        for key in ('ghost','flam'):
            if key in note and not isinstance(note[key],bool):raise ProjectError(label+' '+key+' must be boolean')
        _finite_record(note.get('choke',0),label+' choke')
    else:
        count=arr.get('stringCount',len(arr.get('tuning',[])) or 6)
        if type(note.get('string')) is not int or not 0<=note['string']<count:raise ProjectError(label+' Note string lies outside the arrangement')
        if type(note.get('fret')) is not int or note['fret']<0:raise ProjectError(label+' Note fret must be a nonnegative integer')
    minimum=0 if kind=='keys' else 1
    if note.get('velocity') is not None and (type(note['velocity']) is not int or not minimum<=note['velocity']<=127):
        raise ProjectError(f'{label} Note velocity must be an integer between {minimum} and 127')
    techniques=note.get('techniques',{})
    if not isinstance(techniques,dict):raise ProjectError(label+' techniques must be an object')
    tech=_short_techniques(techniques)
    for key in ('sl','slu'):
        if key in tech and (type(tech[key]) is not int or tech[key]<-1):raise ProjectError(label+' slide destination must be an integer at least -1')
    if 'bn' in tech:_finite_record(tech['bn'],label+' bend',minimum=None)
    if 'vb' in tech:_vibrato_intensity(tech['vb'])
    if 'force_destination_pitch' in techniques:_force_destination_pitch(techniques['force_destination_pitch'])
    if 'bnv' in tech:
        points=_record_array({'points':tech['bnv']},'points',label+' bend_values')
        previous=-1
        for point in points:
            position=_finite_record(point.get('t'),label+' bend point time')
            _finite_record(point.get('v'),label+' bend point value',minimum=None)
            if position<previous:raise ProjectError(label+' bend point times must be nondecreasing')
            previous=position
    return note


def _validate_arrangement_records(arr):
    label='Arrangement '+str(arr['id'])
    templates=_record_array(arr,'chord_templates',label+' chord_templates')
    count=arr.get('stringCount',len(arr.get('tuning',[])) or 6)
    for index,template in enumerate(templates):
        for key in ('frets','fingers'):
            values=template.get(key,[])
            if not isinstance(values,list) or any(type(value) is not int for value in values):raise ProjectError(f'{label} template {index} {key} must contain integers')
        if any(fret < -1 for fret in template.get('frets',[])):raise ProjectError(label+' template frets must be at least -1')
        if arr.get('type') not in ('keys','drums') and any(fret>=0 for fret in template.get('frets',[])[count:]):raise ProjectError(label+' template has a sounding fret outside the arrangement strings')
    levels=_record_array(arr,'difficulties',label+' difficulties')
    values=[level.get('difficulty') for level in levels]
    if any(type(value) is not int or value<0 for value in values) or len(set(values))!=len(values):raise ProjectError(label+' difficulty values must be unique nonnegative integers')
    if levels and (type(arr.get('activeDifficulty',max(values))) is not int or arr.get('activeDifficulty',max(values)) not in values):raise ProjectError(label+' active difficulty does not exist')
    for owner in [arr]+levels:
        context=label+(f' difficulty {owner["difficulty"]}' if owner is not arr else ' live')
        for index,note in enumerate(_record_array(owner,'notes',context+' notes')):_validate_note_record(note,arr,f'{context} note {index}')
        for index,chord in enumerate(_record_array(owner,'chords',context+' chords')):
            path=f'{context} chord {index}'
            time=_finite_record(chord.get('time',chord.get('t')),path+' time')
            if 'sustain' in chord:_finite_record(chord['sustain'],path+' sustain')
            children=_record_array(chord,'notes',path+' notes')
            reference=_chord_reference(chord)
            if reference is not None and (type(reference) is not int or not 0<=reference<len(templates)):raise ProjectError(path+' refers to a missing chord template')
            if not children and reference is None:raise ProjectError(path+' needs explicit voices or a chord template')
            strings=set()
            for child_index,child in enumerate(children):
                view=_validate_note_record(child,arr,f'{path} child {child_index}',time)
                if arr.get('type') not in ('keys','drums'):
                    if view['string'] in strings:raise ProjectError(path+' has duplicate voices on one string; native chord masks would overwrite them')
                    strings.add(view['string'])
        for index,anchor in enumerate(_record_array(owner,'anchors',context+' anchors')):
            _finite_record(anchor.get('time'),context+f' anchor {index} time')
            if type(anchor.get('fret')) is not int or anchor['fret']<0:raise ProjectError(context+' anchor fret must be a nonnegative integer')
            if 'width' in anchor and (type(anchor['width']) is not int or anchor['width']<=0):raise ProjectError(context+' anchor width must be a positive integer')
        for index,shape in enumerate(_record_array(owner,'handshapes',context+' handshapes')):
            path=f'{context} handshape {index}'
            start=_finite_record(shape.get('start_time'),path+' start_time');end=_finite_record(shape.get('end_time'),path+' end_time')
            if end<start:raise ProjectError(path+' end precedes start')
            reference=shape.get('chord_id')
            if type(reference) is not int or not 0<=reference<len(templates):raise ProjectError(path+' refers to a missing chord template')


def _midi_call(function,*args,**kwargs):
    try:return function(*args,**kwargs)
    except _midi_programs.ProgramError as exc:raise ProjectError(str(exc)) from exc


def _validate_retained_notation(arr):
    entry=arr.get('_entry')
    if not isinstance(entry,dict) or not entry.get('notation') or entry.get('file') or entry.get('drum_tab'):
        raise ProjectError('Retained notation requires its original notation-only manifest entry')
    if arr.get('readOnly') is not True or arr.get('type')!='notation' or arr.get('id')!=entry.get('id') or arr.get('name')!=entry.get('name',entry['id']) or arr.get('instrument')!=entry.get('type','notation'):
        raise ProjectError('Retained notation is read-only; keep its source entry intact')
    if any(arr.get(field) for field in ('notes','chords','anchors','handshapes','chord_templates','difficulties','phrases')):
        raise ProjectError('Retained notation cannot accept editable wire events; convert explicitly in a supported workflow first')


def validate_project(project):
    if not isinstance(project, dict) or project.get('version') != 1:
        raise ProjectError('Expected a OCE project with version 1')
    if isinstance(project.get('_import'),dict) and ('sourceArchive' in project['_import'] or project['_import'].get('format')=='musicxml' and 'source' in project['_import']):
        _mxl_metadata(project,_mxl_decoded_entries(project))
    if project.get('cover') is not None:
        validate_cover(project['cover'])
    arrangements = project.get('arrangements')
    if not isinstance(arrangements, list) or not arrangements:
        raise ProjectError('Project requires at least one arrangement')
    ids = set()
    duration = project.get('duration',0)
    if not isinstance(duration,(int,float)) or not math.isfinite(duration) or duration < 0:
        raise ProjectError('Song duration must be finite and nonnegative')
    for row in project.get('beats',[]):
        if not isinstance(row,dict) or not isinstance(row.get('time'),(int,float)) or not math.isfinite(row['time']) or row['time'] < 0:
            raise ProjectError('Beat time must be finite and nonnegative')
    vocal_ids=set()
    for vocal in project.get('vocals',[]):
        if not isinstance(vocal,dict) or not vocal.get('id') or vocal['id'] in vocal_ids:
            raise ProjectError('Vocal IDs must be present and unique')
        vocal_ids.add(vocal['id'])
        for field in ('time','length'):
            value=vocal.get(field)
            if not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:
                raise ProjectError(f'Vocal {field} must be finite and nonnegative')
        if not isinstance(vocal.get('text'),str):
            raise ProjectError('Vocal text must be a string')
        if vocal.get('pitch') is not None and (not isinstance(vocal['pitch'],int) or isinstance(vocal['pitch'],bool) or not 0<=vocal['pitch']<=127):
            raise ProjectError('Vocal pitch must be an integer MIDI note between0 and127')
    for arr in arrangements:
        if not isinstance(arr, dict) or not arr.get('id') or arr['id'] in ids:
            raise ProjectError('Arrangement IDs must be present and unique')
        ids.add(arr['id'])
        if arr.get('_notationOnly'):
            _validate_retained_notation(arr)
            continue
        _cent_offset(arr)
        if 'guideVoice' in arr:
            _check_manifest_tree(arr['guideVoice'])
            if len(_json(arr['guideVoice']))>MAX_GUIDE_VOICE:
                raise ProjectError('Per-part guide voice metadata exceeds the 64 KiB limit')
        if arr.get('writeGuideVoiceRig') and not isinstance(arr.get('guideVoice'),dict):
            raise ProjectError('Binding the guide instrument as a native rig requires an explicit guide voice choice')
        if 'musicXmlProgramIntent' in arr:
            intent=arr['musicXmlProgramIntent']
            if not isinstance(intent,dict) or intent.get('version')!=1 or type(intent.get('program')) is not int or isinstance(intent.get('program'),bool) or not 0<=intent['program']<=127:
                raise ProjectError('Invalid MusicXML program intent')
        if arr.get('type') in ('guitar','bass') and arr.get('role') not in (None,''):
            arrangement_role(arr)
        if arr.get('priority') not in (None,'','main','alternative','bonus'):
            raise ProjectError('Arrangement priority must be main, alternative or bonus')
        tuning = arr.get('tuning',[])
        if not isinstance(tuning,list) or any(type(v) is not int for v in tuning):
            raise ProjectError('Tuning must contain integer semitone offsets')
        count = arr.get('stringCount',len(tuning) or 6)
        if type(count) is not int or not 1 <= count <= 128:
            raise ProjectError('String count must be an integer between 1 and 128')
        if any(tuning[count:]):raise ProjectError('Tuning has a nonzero offset outside the declared strings')
        if type(arr.get('capo',0)) is not int or not 0<=arr.get('capo',0)<=24:raise ProjectError('Capo must be an integer between 0 and24')
        if arr.get('type') in BASES and arr.get('basePitches'):
            _effective_tuning(arr)
        _validate_arrangement_records(arr)
    _midi_call(_midi_programs.validate,project,_midi_stream)
    return project


ROLE_PATH='editor/oce-arrangement-roles.json'
ROLE_FORMAT='open-chart-editor-arrangement-roles'
MAX_ROLE_METADATA=4*1024*1024


def _role_document(content):
    if len(content)>MAX_ROLE_METADATA:
        raise ProjectError('Arrangement role metadata exceeds the four MiB limit')
    document=_decode_json(content)
    if not isinstance(document,dict) or set(document)!={'format','version','arrangements'} or document.get('format')!=ROLE_FORMAT or type(document.get('version')) is not int or document['version']!=1:
        raise ProjectError('Unrecognized arrangement role metadata format/version')
    rows=document['arrangements']
    if not isinstance(rows,list) or len(rows)>MAX_MEMBERS:
        raise ProjectError('Arrangement role metadata has invalid row count')
    seen=set()
    for row in rows:
        if not isinstance(row,dict) or set(row)!={'id','type','file','sha256','values'} or not isinstance(row['id'],str) or not row['id'] or len(row['id'])>1024 or row['id'] in seen:
            raise ProjectError('Arrangement role metadata has invalid or duplicate identity')
        seen.add(row['id']);_path(row['file'])
        if not isinstance(row['type'],str) or not row['type'] or len(row['type'])>128 or not isinstance(row['sha256'],str) or re.fullmatch('[0-9a-f]{64}',row['sha256']) is None:
            raise ProjectError('Arrangement role metadata has invalid type/hash')
        values=row['values']
        if not isinstance(values,dict) or not values or set(values)-{'role','priority','locked'}:
            raise ProjectError('Arrangement role metadata has invalid fields')
        if 'locked' in values and values['locked'] is not True:
            raise ProjectError('Arrangement lock metadata must be true when present')
        if 'role' in values:
            role=values['role']
            if role is not None and (not isinstance(role,str) or len(role)>128):
                raise ProjectError('Arrangement role must be a bounded string or absent')
            if row['type'] in BASES and role not in (None,''):
                arrangement_role({'type':row['type'],'role':role})
        if 'priority' in values and values['priority'] not in (None,'','main','alternative','bonus'):
            raise ProjectError('Arrangement priority metadata is unsupported')
    return document


def _restore_roles(project,entries):
    content=entries.get(ROLE_PATH)
    if content is None:return
    try:
        document=_role_document(content)
    except (ValueError,TypeError,KeyError,AttributeError,RuntimeError,OverflowError) as exc:
        project.setdefault('import_warnings',[]).append('OCE role/priority metadata was withheld: '+str(exc)[:256]+'. Opaque source bytes remain preserved; review roles before stock export.')
        return
    indexed={arr['id']:arr for arr in project['arrangements']}
    for row in document['arrangements']:
        arr=indexed.get(row['id'])
        if arr is None:continue
        entry=arr.get('_entry',{});name=entry.get('drum_tab') or entry.get('file');content=entries.get(row['file'])
        if name!=row['file'] or arr.get('type')!=row['type'] or content is None or hashlib.sha256(content).hexdigest()!=row['sha256']:
            project.setdefault('import_warnings',[]).append(f"Role/priority for {str(row['id'])[:256]} was withheld because its native chart identity, type or bytes changed. Original role metadata remains preserved; review the arrangement role before stock export.")
            continue
        arr.update(copy.deepcopy(row['values']))


def _store_roles(project,entries,manifest):
    rows=[];indexed={entry.get('id'):entry for entry in manifest.get('arrangements',[])}
    for arr in project['arrangements']:
        if arr.get('editorOnly'):continue
        values={key:copy.deepcopy(arr[key]) for key in ('role','priority') if key in arr}
        if arr.get('locked') is True:values['locked']=True
        if not values:continue
        entry=indexed.get(arr['id']);name=(entry.get('drum_tab') or entry.get('file')) if entry else None
        if name is None or name not in entries:
            raise ProjectError('Role authoring has no staged native arrangement file')
        rows.append({'id':arr['id'],'type':arr.get('type','guitar'),'file':name,'sha256':hashlib.sha256(entries[name]).hexdigest(),'values':values})
    previous=entries.get(ROLE_PATH)
    if previous is not None:
        try:_role_document(previous)
        except (ValueError,TypeError,KeyError,AttributeError,RuntimeError,OverflowError) as exc:
            if rows:raise ProjectError('Reserved role metadata path contains unrelated, malformed or future-version data; preserve it under another member name before exporting explicit roles') from exc
            return
    if not rows and previous is None:return
    content=_json({'format':ROLE_FORMAT,'version':1,'arrangements':rows})
    _role_document(content)
    if previous is not None and previous!=content:
        backup='editor/arrangement-role-sources/'+hashlib.sha256(previous).hexdigest()+'.json'
        if backup in entries and entries[backup]!=previous:
            raise ProjectError('Reserved role metadata backup path contains conflicting bytes')
        entries[backup]=previous
    entries[ROLE_PATH]=content


FLAT_PHRASE_PATH='editor/oce-flat-phrases.json'
FLAT_PHRASE_FORMAT='open-chart-editor-flat-phrases'
MAX_FLAT_PHRASES=4*1024*1024


def _flat_phrase_document(content):
    if len(content)>MAX_FLAT_PHRASES:raise ProjectError('Flat phrase authoring exceeds the four MiB limit; save project JSON')
    document=_decode_json(content)
    if not isinstance(document,dict) or set(document)!={'format','version','arrangements'} or document.get('format')!=FLAT_PHRASE_FORMAT or type(document.get('version')) is not int or document['version']!=1:
        raise ProjectError('Unrecognized flat phrase authoring format/version')
    rows=document['arrangements']
    if not isinstance(rows,list) or len(rows)>MAX_MEMBERS:raise ProjectError('Flat phrase authoring has invalid row count')
    seen=set()
    for row in rows:
        if not isinstance(row,dict) or set(row)!={'id','type','file','sha256','present','phrases'} or not isinstance(row['id'],str) or not row['id'] or len(row['id'])>1024 or row['id'] in seen:
            raise ProjectError('Flat phrase authoring has invalid or duplicate identity')
        seen.add(row['id']);_path(row['file'])
        if not isinstance(row['type'],str) or not row['type'] or len(row['type'])>128 or not isinstance(row['sha256'],str) or re.fullmatch('[0-9a-f]{64}',row['sha256']) is None or type(row['present']) is not bool:
            raise ProjectError('Flat phrase authoring has invalid type/hash/presence')
        phrases=row['phrases']
        if not isinstance(phrases,list) or len(phrases)>200000 or not row['present'] and phrases:
            raise ProjectError('Flat phrase authoring markers must be a bounded array')
        for marker in phrases:
            if not isinstance(marker,dict):raise ProjectError('Flat phrase marker must be an object')
            _finite_record(marker.get('time'),'Flat phrase marker time')
            if 'name' in marker and not isinstance(marker['name'],str):raise ProjectError('Flat phrase marker name must be a string')
            if marker.get('id') is not None and not isinstance(marker['id'],str):raise ProjectError('Flat phrase marker identity must be a string')
        _check_manifest_tree(phrases)
    return document


def _restore_flat_phrases(project,entries):
    content=entries.get(FLAT_PHRASE_PATH)
    if content is None:return
    try:document=_flat_phrase_document(content)
    except (ValueError,TypeError,KeyError,AttributeError,RuntimeError,OverflowError) as exc:
        project.setdefault('import_warnings',[]).append('OCE flat phrase authoring was withheld: '+str(exc)[:256]+'. Opaque source bytes remain preserved.')
        return
    indexed={arr['id']:arr for arr in project['arrangements']}
    for row in document['arrangements']:
        arr=indexed.get(row['id'])
        if arr is None:continue
        entry=arr.get('_entry',{});name=entry.get('drum_tab') or entry.get('file');raw=entries.get(row['file'])
        if arr.get('editorOnly') or arr.get('type')=='drums' or arr.get('difficulties') or arr.get('type')!=row['type'] or name!=row['file'] or raw is None or hashlib.sha256(raw).hexdigest()!=row['sha256']:
            project.setdefault('import_warnings',[]).append('OCE flat phrase authoring for '+str(row['id'])[:256]+' was withheld because native chart identity, type, bytes or difficulty mode changed. Native content remains authoritative; opaque sidecar bytes remain preserved.')
            continue
        if row['present']:arr['phrases']=copy.deepcopy(row['phrases'])
        else:arr.pop('phrases',None)


def _store_flat_phrases(project,entries,manifest):
    previous=entries.get(FLAT_PHRASE_PATH);original=None
    if previous is not None:
        try:original=_flat_phrase_document(previous)
        except (ValueError,TypeError,KeyError,AttributeError,RuntimeError,OverflowError):pass
    prior_ids={row['id'] for row in original['arrangements']} if original is not None else set()
    indexed={row.get('id'):row for row in manifest.get('arrangements',[])};rows=[]
    for arr in project['arrangements']:
        if arr.get('editorOnly') or arr.get('type')=='drums' or arr.get('difficulties'):continue
        if 'phrases' in arr and not isinstance(arr['phrases'],list):raise ProjectError('Flat phrase markers must be an array; use an empty array to clear them')
        if not arr.get('phrases') and not arr.get('_wire',{}).get('phrases') and arr['id'] not in prior_ids:continue
        entry=indexed.get(arr['id']);name=(entry.get('drum_tab') or entry.get('file')) if entry else None
        if name is None or name not in entries:raise ProjectError('Flat phrase authoring has no staged native arrangement file')
        rows.append({'id':arr['id'],'type':arr.get('type','guitar'),'file':name,'sha256':hashlib.sha256(entries[name]).hexdigest(),'present':'phrases' in arr,'phrases':copy.deepcopy(arr.get('phrases',[]))})
    if previous is not None and original is None:
        if rows:raise ProjectError('Reserved flat phrase authoring path contains unrelated, malformed or future-version data; preserve it under another member name before exporting phrase markers')
        return
    if not rows and previous is None:return
    content=_json({'format':FLAT_PHRASE_FORMAT,'version':1,'arrangements':rows});_flat_phrase_document(content)
    if previous is not None and previous!=content:
        backup='editor/flat-phrase-sources/'+hashlib.sha256(previous).hexdigest()+'.json'
        if backup in entries and entries[backup]!=previous:raise ProjectError('Reserved flat phrase backup path contains conflicting bytes')
        entries[backup]=previous
    entries[FLAT_PHRASE_PATH]=content


def flat_phrase_export_warnings(project):
    return [str(arr.get('name',arr['id']))[:128]+': Phrase markers are saved for reopening in OCE. This flat chart has no native phrase ladder for FeedBack playback.' for arr in project.get('arrangements',[]) if not arr.get('editorOnly') and arr.get('type')!='drums' and not arr.get('difficulties') and arr.get('phrases')]


SCRATCH_PATH = 'editor/oce-scratch.json'
# Lyric sheet syllables not yet tapped to a time (Lyrics tab). Timed ones are the vocals.
LYRIC_SHEET_PATH = 'editor/oce-lyric-sheet.json'
LYRIC_SHEET_FORMAT = 'open-chart-editor-lyric-sheet-v1'
DRUM_AUTHORING_PATH = 'editor/oce-drums.json'
DRUM_AUTHORING_FORMAT = 'open-chart-editor-drums-v1'
MAX_DRUM_AUTHORING = 16 * 1024 * 1024
DRUM_AUTHORING_FIELDS = LEVEL_FIELDS + ('chord_templates','difficulties','activeDifficulty','phrases')


def _read_rig_library(project, entries, manifest):
    """Read audition context only. Never resolve a realization, URI or asset."""
    if 'rigs' not in manifest:
        return
    try:
        name=_path(manifest['rigs'])
        content=entries.get(name)
        if content is None:
            raise ProjectError('Referenced rig library is missing')
        if len(content)>MAX_RIG_LIBRARY:
            raise ProjectError('Rig library exceeds the eight MiB audition-context limit')
        library=_decode_json(content,name)
        _check_manifest_tree(library)
        if not isinstance(library,dict) or type(library.get('version')) is not int or library['version']<1 or not isinstance(library.get('rigs'),list) or len(library['rigs'])>MAX_MEMBERS:
            raise ProjectError('Rig library must contain a bounded rigs array')
        project['rigLibrary']=copy.deepcopy(library)
    except (ProjectError,ValueError,UnicodeError,RecursionError) as exc:
        project.setdefault('import_warnings',[]).append('Native rig audition context unavailable: '+str(exc)+'. Original rig reference and source bytes remain preserved; no native assets were loaded.')


def drum_export_warnings(project):
    warnings=[]
    for arr in project.get('arrangements',[]):
        if arr.get('type')!='drums' or arr.get('editorOnly'):
            continue
        owners=[arr]+arr.get('difficulties',[])
        if arr.get('difficulties') or any(owner.get(field) for owner in owners for field in ('chords','anchors','handshapes')) or any(note.get('sustain',0) for owner in owners for note in owner.get('notes',[])):
            warnings.append(f"Drums '{arr.get('name',arr['id'])}': FeedBack plays only the highest authored hit level, including flattened chord-member hits. Group presentation, difficulty levels, anchor/zone lanes and sustained-event authoring are retained in a OCE-only sidecar; native drum_tab has no equivalent playback fields.")
    return warnings


def _restore_drum_authoring(project, entries):
    content=entries.get(DRUM_AUTHORING_PATH)
    if content is None:
        return
    if len(content)>MAX_DRUM_AUTHORING:
        raise ProjectError('OCE drum authoring sidecar exceeds the 16 MiB limit')
    try:document=_decode_json(content)
    except (ValueError,UnicodeError):return  # Unrelated opaque source member.
    if not isinstance(document,dict) or document.get('format')!=DRUM_AUTHORING_FORMAT:
        return
    rows=document.get('arrangements')
    if not isinstance(rows,list) or len(rows)>MAX_MEMBERS:
        raise ProjectError('OCE drum authoring sidecar has invalid arrangements')
    seen=set()
    for row in rows:
        if not isinstance(row,dict) or not isinstance(row.get('id'),str) or row['id'] in seen or not isinstance(row.get('authoring'),dict):
            raise ProjectError('OCE drum authoring sidecar has invalid or duplicate arrangement records')
        seen.add(row['id'])
        name=_path(row.get('drum_tab',''))
        arr=next((arr for arr in project['arrangements'] if arr['id']==row['id'] and arr.get('type')=='drums' and arr.get('_entry',{}).get('drum_tab')==name),None)
        if arr is None or name not in entries or hashlib.sha256(entries[name]).hexdigest()!=row.get('sha256'):
            project.setdefault('import_warnings',[]).append(f"OCE drum authoring for '{row['id']}' was withheld because its native drum file changed or is missing. Native hits were imported; original sidecar bytes remain preserved.")
            continue
        for field in DRUM_AUTHORING_FIELDS:
            if field in row['authoring']:
                arr[field]=copy.deepcopy(row['authoring'][field])


def _store_drum_authoring(entries, rows):
    if not rows and DRUM_AUTHORING_PATH not in entries:
        return
    previous=entries.get(DRUM_AUTHORING_PATH)
    if previous is not None:
        try:document=_decode_json(previous)
        except (ValueError,UnicodeError):document=None
        if not isinstance(document,dict) or document.get('format')!=DRUM_AUTHORING_FORMAT:
            if rows:
                raise ProjectError('Reserved drum authoring sidecar path contains unrelated source data; preserve it under another member name before exporting drums')
            return
    content=_json({'format':DRUM_AUTHORING_FORMAT,'arrangements':rows})
    if len(content)>MAX_DRUM_AUTHORING:
        raise ProjectError('OCE drum authoring sidecar exceeds the 16 MiB limit; save project JSON instead')
    if previous is not None and previous!=content:
        name='editor/drum-authoring-sources/'+hashlib.sha256(previous).hexdigest()+'.json'
        if name in entries and entries[name]!=previous:
            raise ProjectError('Reserved drum authoring backup path contains conflicting source data')
        entries[name]=previous
    entries[DRUM_AUTHORING_PATH]=content
SCRATCH_FORMAT = 'open-chart-editor-scratch-v1'


def _read_vocal_rows(lyrics,pitch_document):
    """Join known syllables while retaining unmatched source pitch events.

    Feedpak 1.19 section7.2 expects matching t/d, but its readers consume the
    two files separately. A legacy unmatched pitch must not create a lyric.
    """
    rows=[{'id':f'v{i}','time':row['t'],'length':row['d'],'text':row['w'],'_lyricWire':copy.deepcopy(row)} for i,row in enumerate(lyrics)]
    candidates={}
    for i,row in enumerate(rows):candidates.setdefault((row['time'],row['length']),deque()).append(i)
    for pitch in pitch_document.get('notes',[]):
        queue=candidates.get((pitch['t'],pitch['d']))
        match=queue.popleft() if queue else None
        if match is None:
            match=len(rows)
            rows.append({'id':f'v{match}','time':pitch['t'],'length':pitch['d'],'text':'','_pitchOnly':True})
        rows[match].update(pitch=pitch['midi'],_pitchWire=copy.deepcopy(pitch))
    return sorted(rows,key=lambda row:row['time'])


def _vocal_export_state(project):
    # Reconstruct from retained source bytes rather than trusting an editable
    # baseline marker. IDs are UI identity; future wire fields remain meaningful.
    pack=project.get('_pack',{});manifest=pack.get('manifest',{});entries=pack.get('entries',{})
    source_bound=bool(manifest.get('lyrics') or manifest.get('vocal_pitch'))
    def read_source(field,default):
        name=manifest.get(field)
        if not name:return default
        name=_path(name)
        if name not in entries:return None
        return _decode_json(base64.b64decode(entries[name]),name)
    lyrics=read_source('lyrics',[]);pitch=read_source('vocal_pitch',{})
    source=_read_vocal_rows(lyrics,pitch) if lyrics is not None and pitch is not None else None
    rows=sorted(project.get('vocals',[]),key=lambda row:row['time'])
    def signature(items,kind):
        if items is None:return None
        if kind=='lyrics':return [(v['time'],v.get('length',0),v['text']) for v in items if not v.get('_pitchOnly') or v['text']]
        if kind=='pitch':return [(v['time'],v.get('length',0),v['pitch']) for v in items if v.get('pitch') is not None]
        return [{k:copy.deepcopy(v.get(k)) for k in ('time','length','text','pitch','_lyricWire','_pitchWire','_pitchOnly')} for v in items]
    def wire_signature(items,kind):
        if items is None:return None
        if kind=='lyrics':return [(v['time'],v.get('length',0),v['text'],v.get('_lyricWire')) for v in items if not v.get('_pitchOnly') or v['text']]
        return [(v['time'],v.get('length',0),v['pitch'],v.get('_pitchWire')) for v in items if v.get('pitch') is not None]
    return {'unchanged':source_bound and source is not None and signature(rows,'all')==signature(source,'all'),
            'lyricsChanged':signature(rows,'lyrics')!=signature(source,'lyrics'),
            'pitchChanged':signature(rows,'pitch')!=signature(source,'pitch'),
            'writeLyrics':wire_signature(rows,'lyrics')!=wire_signature(source,'lyrics'),
            'writePitch':wire_signature(rows,'pitch')!=wire_signature(source,'pitch')}


def vocal_export_warnings(project):
    if 'vocals' not in project:return []
    state=_vocal_export_state(project);manifest=project.get('_pack',{}).get('manifest',{});warnings=[]
    if state['pitchChanged'] and manifest.get('vocal_pitch_contour'):
        warnings.append('Vocal pitch/timing changed: detached the original fine-pitch contour and extraction provenance; original sidecar bytes remain in the archive.')
    if state['lyricsChanged'] and any(track.get('file')!=manifest.get('lyrics') for track in manifest.get('lyric_tracks',[])):
        warnings.append('Additional lyric tracks were preserved unchanged; translations and transliterations are not automatically rewritten or retimed.')
    return warnings


def _rename_old_sidecars(entries):
    """Fixed-name editor sidecars written before the rename (editor/workshop-*.json) are
    read under their current names; sidecars reached through manifest pointers need nothing."""
    for current in (MXL_SOURCE_PATH, ROLE_PATH, FLAT_PHRASE_PATH, SCRATCH_PATH, DRUM_AUTHORING_PATH, getattr(_midi_programs, 'PATH', None)):
        if not current:continue
        old='editor/workshop-'+current[len('editor/oce-'):]
        if old in entries and current not in entries:entries[current]=entries.pop(old)


def load_feedpak(data):
    entries = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        if len(members) > MAX_MEMBERS or sum(m.file_size for m in members) > MAX_BYTES:
            raise ProjectError('Archive exceeds the safe uncompressed size limit')
        for member in members:
            if member.is_dir():
                continue
            name = _path(member.filename)
            if name in entries:
                raise ProjectError('Archive contains duplicate paths')
            try:
                entries[name] = archive.read(member)
            except NotImplementedError as exc:
                raise ProjectError('This ZIP compression method is unsupported; recompress as a standard deflate ZIP') from exc
            except RuntimeError as exc:
                raise ProjectError('Encrypted Feedpak archives are unsupported; remove password protection before importing') from exc
    _rename_old_sidecars(entries)
    manifest_name = next((n for n in ('manifest.yaml', 'manifest.yml', 'manifest.json') if n in entries), None)
    if not manifest_name:
        raise ProjectError('Feedpak has no manifest.yaml')
    if len(entries[manifest_name])>4*1024*1024:
        raise ProjectError('Feedpak manifest exceeds the four MiB limit')
    manifest = yaml.safe_load(entries[manifest_name].decode('utf-8-sig'))
    _check_manifest_tree(manifest)
    if not isinstance(manifest, dict):
        raise ProjectError('Feedpak manifest must be a mapping')
    contract = validate_feedpak_entries(manifest, entries)
    def read(name):
        return _decode_json(entries[_path(name)],name)
    project = {'version': 1, **{k: copy.deepcopy(manifest.get(k, default)) for k,default in [('title','Untitled'),('artist',''),('duration',0)]}, 'arrangements': [], 'beats': [], 'sections': []}
    # Year and album are optional in the manifest; a pack without them stays without them.
    for key in ('album','year'):
        if key in manifest:project[key]=copy.deepcopy(manifest[key])
    for index, entry in enumerate(manifest.get('arrangements', [])):
        filename = entry.get('drum_tab') or entry.get('file')
        if not filename:
            # A source notation row is retained, not converted to a blank guitar.
            if entry.get('notation'):
                try:converted=_notation_only_arrangement(entry,read(entry['notation']),index)
                except (ValueError,KeyError,TypeError):converted=None
                if converted is not None:
                    project['arrangements'].append(converted)
                    project.setdefault('import_warnings',[]).append(f"{entry.get('name',entry['id'])}: built {len(converted['notes'])} editable notes from its notation with FeedBack's own rule. Saved unedited, the part stays notation-only.")
                    continue
                project['arrangements'].append({'id':entry['id'],'name':entry.get('name',entry['id']),
                    'type':'notation','instrument':entry.get('type','notation'),
                    '_notationOnly':True,'readOnly':True,'_entry':copy.deepcopy(entry)})
                project.setdefault('import_warnings',[]).append(
                    entry.get('name',entry['id']) + ': standard notation retained read-only; no editable wire chart was inferred')
            continue
        raw = read(filename)
        arr = _arrangement(raw, entry, index, bool(entry.get('drum_tab')))
        if arr.get('type')=='keys' and entry.get('notation'):
            try:notation=read(entry['notation'])
            except (ValueError,KeyError,TypeError):notation=None
            if isinstance(notation,dict):
                _fill_hands_from_notation(arr,notation)
                signature=_notation_key_signature(notation)
                if signature:arr['keySignature']=signature
        project['arrangements'].append(arr)
        if not project['beats']:
            project['beats'] = copy.deepcopy(raw.get('beats', []))
            project['sections'] = [_section(s) for s in raw.get('sections', [])]
    if manifest.get('drum_tab'):
        alias=_path(manifest['drum_tab'])
        primary=next((arr for arr in project['arrangements'] if arr.get('type')=='drums' and arr.get('_entry',{}).get('drum_tab')==alias),None)
        if primary is not None:
            primary['_entry']['_primaryDrumAlias']=True
        else:
            identifier='drums';suffix=1
            while any(arr['id']==identifier for arr in project['arrangements']):
                identifier='song-drums-'+str(suffix);suffix+=1
            entry = {'id': identifier, 'name': 'Drums', 'type': 'drums', 'drum_tab': alias, '_songLevel': True}
            project['arrangements'].append(_arrangement(read(alias), entry, len(project['arrangements']), True))
    if manifest.get('song_timeline'):
        timeline = read(manifest['song_timeline'])
        for field in ('beats', 'sections'):
            if field in timeline:
                project[field] = copy.deepcopy(timeline[field]) if field == 'beats' else [_section(s) for s in timeline[field]]
        for field in ('tempos','time_signatures'):
            if field in timeline:
                project[field] = copy.deepcopy(timeline[field])
    _annotate_meter(project)
    if manifest.get('lyrics') or manifest.get('vocal_pitch'):
        lyrics=read(manifest['lyrics']) if manifest.get('lyrics') else []
        pitch_document=read(manifest['vocal_pitch']) if manifest.get('vocal_pitch') else {}
        project['vocals']=_read_vocal_rows(lyrics,pitch_document)
        if any(v.get('_pitchOnly') for v in project['vocals']):
            project.setdefault('import_warnings',[]).append('A vocal pitch event had no matching lyric syllable; retained as a pitch-only editor event without inventing a source lyric')
        project['_vocalsOriginal']=[{key:vocal.get(key) for key in ('time','length','text','pitch')} for vocal in project['vocals']]
    if LYRIC_SHEET_PATH in entries:
        try:
            sheet=read(LYRIC_SHEET_PATH)
        except (ValueError,UnicodeError):
            sheet=None
        untimed=sheet.get('untimed') if isinstance(sheet,dict) and sheet.get('format')==LYRIC_SHEET_FORMAT else None
        if isinstance(untimed,list) and untimed and all(isinstance(text,str) for text in untimed):
            project['lyricSheet']={'untimed':untimed}
    if SCRATCH_PATH in entries:
        try:
            scratch=read(SCRATCH_PATH)
        except (ValueError,UnicodeError):
            scratch=None
        if isinstance(scratch,dict) and scratch.get('format')==SCRATCH_FORMAT:
            rows=scratch.get('arrangements')
            if not isinstance(rows,list) or any(not isinstance(row,dict) for row in rows):
                raise ProjectError('OCE scratch sidecar has invalid arrangements')
            for row in rows:
                # Hidden arrangements travel with the scratch tracks and come back hidden.
                if row.get('hidden') is True:row.pop('editorOnly',None)
                else:row['editorOnly']=True
            project['arrangements'].extend(rows)
    if not project['arrangements']:
        raise ProjectError('Pack has no supported chart or retained notation arrangement')
    project.setdefault('import_warnings',[]).extend(contract.get('warnings',[]))
    project['_feedpakValidation'] = contract
    project['_pack'] = {'manifest': manifest, 'manifest_name': manifest_name, 'entries': {n: base64.b64encode(v).decode('ascii') for n,v in entries.items()}}
    cover_name=manifest.get('cover')
    if cover_name and Path(cover_name).suffix.lower()=='.png':
        content=entries.get(_path(cover_name))
        if content is not None:
            candidate={'name':Path(cover_name).name,'data':base64.b64encode(content).decode('ascii')}
            try:
                validate_cover(candidate)
                project['cover']=candidate
            except ProjectError:
                project.setdefault('import_warnings',[]).append('Original PNG cover is preserved opaquely; import a bounded valid PNG to edit or use it in the CDLC builder')
    _read_rig_library(project,entries,manifest)
    _restore_drum_authoring(project,entries)
    _restore_roles(project,entries)
    _restore_flat_phrases(project,entries)
    _mxl_restore(project,entries)
    _midi_call(_midi_programs.restore,project,entries,_midi_stream)
    validate_project(project)
    stamp_lesson_baseline(project)
    return _notation_call(_notation_state.stamp_notation_baselines,project)


def _cent_offset(arr):
    value=arr.get('centOffset',arr.get('_entry',{}).get('centOffset',arr.get('_wire',{}).get('centOffset',0)))
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value):
        raise ProjectError('Arrangement centOffset must be a finite number of cents')
    return value


def _validate_zone_styles(arr, xml=False):
    for owner in [arr]+arr.get('difficulties',[]):
        for zone in owner.get('handshapes',[]):
            if zone.get('kind') not in (None,'chord','fingerprint','arpeggio'):
                raise ProjectError('Chord zone kind must be chord, fingerprint or arpeggio')
            if zone.get('hideName') and (zone.get('kind')=='arpeggio' or zone.get('arp')):
                raise ProjectError('Arpeggio plus hidden chord name cannot be represented by the mutually exclusive native arpeggio/nop template flags')
            if xml and (zone.get('arp') or zone.get('kind')=='arpeggio'):
                identifier=zone.get('chord_id',zone.get('chordId',-1))
                templates=arr.get('chord_templates',[])
                template=templates[identifier] if isinstance(identifier,int) and 0<=identifier<len(templates) else {}
                if not template.get('arp') and not template.get('displayName','').endswith('-arp'):
                    raise ProjectError('This arpeggio zone requires its own arpeggio template before Rocksmith XML export; apply the arpeggio zone style to clone and synchronize its template, or save as Feedpak')


def _feedpak_phrase_layout(arr,duration):
    """Plan native DD intervals without silently dropping authored records.

    Unchanged imported markers keep their native intervals. Explicit marker
    edits use the editor's original next-marker/song-end boundary policy.
    Notes, sustained tails and structures are never moved, split or clipped.
    """
    source=copy.deepcopy(arr.get('_wire',{}).get('phrases',[]))
    label='Arrangement '+str(arr['id'])
    if not isinstance(source,list) or any(not isinstance(row,dict) for row in source):
        raise ProjectError(label+' native phrases must be an array of objects')
    if not arr.get('difficulties'):
        if any(phrase.get('levels') for phrase in source):
            raise ProjectError(label+' canonical difficulties were removed while native source levels remain; restore the authored levels before Feedpak export, or save editable JSON to retain the explicit removal without resurrecting source notes')
        return None
    markers=arr.get('phrases')
    if 'phrases' in arr and (not isinstance(markers,list) or any(not isinstance(row,dict) for row in markers)):
        raise ProjectError(label+' phrase markers must be an array of objects')
    def marker_key(row):
        time=_finite_record(row.get('time'),label+' phrase marker time')
        name=row.get('name','phrase')
        if not isinstance(name,str):raise ProjectError(label+' phrase marker name must be a string')
        if row.get('id') is not None and not isinstance(row['id'],str):raise ProjectError(label+' phrase marker identity must be a string')
        return (time,name,str(row.get('id','')))
    original=[{'id':f'p{i}','time':row.get('start_time',0),'name':row.get('name',f'Phrase {i+1}')} for i,row in enumerate(source)]
    def identity(row):
        time,name,identifier=marker_key(row)
        return time,identifier
    changed=markers is not None and sorted(map(identity,markers))!=sorted(map(identity,original))
    if not source or changed:
        ordered=sorted(markers or [{'time':0,'name':'main'}],key=marker_key)
        starts=[marker_key(row)[0] for row in ordered]
        if len(set(starts))!=len(starts):raise ProjectError(label+' phrase marker times must be unique; separate or remove coincident phrase markers before export')
        ids=[row['id'] for row in ordered if row.get('id')]
        if len(set(ids))!=len(ids):raise ProjectError(label+' phrase marker identities must be unique before export')
        indexed={f'p{i}':row for i,row in enumerate(source)}
        phrases=[]
        for index,marker in enumerate(ordered):
            start,name,_=marker_key(marker)
            row=copy.deepcopy(indexed.get(marker.get('id'),{}))
            row.update(start_time=start,end_time=starts[index+1] if index+1<len(starts) else duration,name=name)
            phrases.append(row)
    else:
        phrases=source
        names={row.get('id'):marker_key(row)[1] for row in markers or []}
        for index,row in enumerate(phrases):
            if f'p{index}' in names:row['name']=names[f'p{index}']
    intervals=[]
    for row in phrases:
        start=_finite_record(row.get('start_time'),label+' native phrase start')
        end=_finite_record(row.get('end_time'),label+' native phrase end')
        if end<start:raise ProjectError(label+' phrase ends before it starts; edit phrase markers or extend the song duration before export')
        intervals.append((start,end))
    intervals.sort()
    for previous,current in zip(intervals,intervals[1:]):
        if current[0]<previous[1]:raise ProjectError(label+' native phrase intervals overlap; edit the canonical phrase markers to rebuild nonoverlapping intervals before export')
    starts=[start for start,end in intervals]
    for level in arr['difficulties']:
        for field in LEVEL_FIELDS:
            for index,row in enumerate(level.get(field,[])):
                time=row.get('time',row.get('t',row.get('start_time',0)))
                owner=bisect.bisect_right(starts,time)-1
                if owner<0 or not intervals[owner][0]<=time<intervals[owner][1]:
                    raise ProjectError(f'{label} difficulty {level["difficulty"]} {field} row {index} at {time:g}s is outside native phrase coverage; add or move a phrase marker at or before this onset to rebuild coverage. If the onset is at or after song end, also extend song duration past it. Renaming a marker alone keeps source intervals unchanged. Save JSON to retain all authoring data meanwhile')
    return phrases


def _grid_index(beats,time):
    """Fractional 0-based index of `time` in the song beat grid (FeedPak 6.9.1), or None outside it."""
    times=[b.get('time') for b in beats if isinstance(b,dict) and isinstance(b.get('time'),(int,float))]
    if len(times)<2 or not math.isfinite(time) or time<times[0] or time>times[-1]:return None
    i=max(0,min(len(times)-2,bisect.bisect_right(times,time)-1));span=times[i+1]-times[i]
    return round(i+((time-times[i])/span if span>0 else 0),6)


def _guide_voice_source_rig(guide_voice, rig_id, *, bypassed=False):
    """Mirrors guide-voice.js's own guideVoiceRig() adapter shape: a bare GM source
    block, no realizations, no local audio implementation referenced."""
    intent={'kind':'instrument'}
    if isinstance(guide_voice.get('family'),str) and guide_voice['family']:
        intent['family']=guide_voice['family']
    if isinstance(guide_voice.get('program'),int) and 0<=guide_voice['program']<=127:
        intent['gm']={'program':guide_voice['program']}
    block={'role':'source','intent':intent}
    if bypassed:
        block['bypassed']=True
    return {'id':rig_id,'blocks':[block]}


def _apply_guide_voice_rigs(project, manifest, entries):
    """Explicit opt-in only (arr['writeGuideVoiceRig']): binds the author's chosen
    offline guide instrument as a real portable source rig, so FeedBack and other
    readers play the same GM sound the editor's own guide audition approximates.
    Without the flag, guideVoice stays an OCE-only editor preview and never
    touches tones/rigs.json, matching guide-voice.js's documented adapter
    contract (an override must never silently rewrite source tone bindings)."""
    bound=[arr for arr in project['arrangements'] if not arr.get('editorOnly') and arr.get('writeGuideVoiceRig') and isinstance(arr.get('guideVoice'),dict)]
    if not bound:
        return
    existing_path=manifest.get('rigs')
    if isinstance(existing_path,str) and existing_path:
        name=_path(existing_path)
        try:
            library=_decode_json(entries[name]) if name in entries else None
        except (ValueError,UnicodeError):
            library=None
        if not isinstance(library,dict) or not isinstance(library.get('rigs'),list):
            raise ProjectError('Existing rig library is not a bounded rigs array; cannot add the guide voice rig')
        library=copy.deepcopy(library)
    else:
        name=_path('rigs/oce-guide-rigs.json')
        library={'version':1,'rigs':[]}
    existing_ids={rig.get('id') for rig in library['rigs'] if isinstance(rig,dict)}
    for arr in bound:
        rig_id=f"oce-guide-{arr['id']}"
        suffix=1
        while rig_id in existing_ids:
            suffix+=1
            rig_id=f"oce-guide-{arr['id']}-{suffix}"
        existing_ids.add(rig_id)
        library['rigs'].append(_guide_voice_source_rig(arr['guideVoice'],rig_id,bypassed=bool(arr.get('guideVoiceMuted'))))
        if len(library['rigs'])>MAX_MEMBERS:
            raise ProjectError('Rig library exceeds the bounded rigs array limit')
        arr['tones']={**(arr.get('tones') or {}),'base_rig':rig_id}
    content=_json(library)
    if len(content)>MAX_RIG_LIBRARY:
        raise ProjectError('Rig library exceeds the eight MiB audition-context limit after adding the guide voice rig')
    entries[name]=content
    manifest['rigs']=existing_path if isinstance(existing_path,str) and existing_path else 'rigs/oce-guide-rigs.json'


def save_feedpak(project,*,vocal_only=False):
    validate_project(project)
    # Hidden arrangements stay in the project but not in the playable pack: they are
    # saved with the scratch tracks in the editor sidecar.
    if any(arr.get('hidden') is True and not arr.get('editorOnly') for arr in project.get('arrangements',[])):
        project={**project,'arrangements':[{**arr,'editorOnly':True} if arr.get('hidden') is True else arr for arr in project['arrangements']]}
        if not any(not arr.get('editorOnly') for arr in project['arrangements']):
            raise ProjectError('Every arrangement is hidden; unhide at least one before saving a FeedPak')
    if vocal_only:
        if not any(v.get('pitch') is not None and v.get('length',0)>0 for v in project.get('vocals',[])):
            raise ProjectError('Vocal Highway preview requires a pitched vocal event with positive duration; lyric-only and zero-duration events remain editable and exportable.')
        # Explicit temporary export only. The authored project and normal full
        # Feedpak output keep their complete instrumental arrangement graph.
        project={**project,'arrangements':[_import_arrangement('oce-vocal-preview','Vocals','guitar')]}
        if project.get('_pack'):
            original=project['_pack'];index=copy.deepcopy(original.get('manifest',{}));index['arrangements']=[]
            for key in ('drum_tab','drum_tones','keys'):
                index.pop(key,None)
            project['_pack']={**original,'manifest':index}
    for arr in project['arrangements']:
        if not arr.get('editorOnly'):
            _validate_zone_styles(arr)
    if any(not arr.get('editorOnly') and arr.get('writeGuideVoiceRig') and isinstance(arr.get('guideVoice'),dict) for arr in project['arrangements']):
        project={**project,'arrangements':[copy.deepcopy(arr) if (not arr.get('editorOnly') and arr.get('writeGuideVoiceRig') and isinstance(arr.get('guideVoice'),dict)) else arr for arr in project['arrangements']]}
    pack = project.get('_pack', {})
    manifest = copy.deepcopy(pack.get('manifest', {}))
    entries = {}
    total = 0
    for name,value in pack.get('entries', {}).items():
        _path(name)
        content = base64.b64decode(value, validate=True)
        total += len(content)
        if total > MAX_BYTES or len(entries) >= MAX_MEMBERS:
            raise ProjectError('Project embedded assets exceed the archive size limit')
        entries[name] = content
    _apply_guide_voice_rigs(project, manifest, entries)
    if 'cover' in project:
        if project['cover'] is None:
            manifest.pop('cover',None)
        else:
            content,_,_,_=validate_cover(project['cover'])
            name=manifest.get('cover')
            if not name or not name.lower().endswith('.png'):
                name='artwork/oce-cover-'+uuid.uuid4().hex+'.png'
            entries[_path(name)]=content
            manifest['cover']=name
    scratch=[_snapshot_arrangement(arr) for arr in project['arrangements'] if arr.get('editorOnly') is True]
    playable=[arr for arr in project['arrangements'] if arr.get('editorOnly') is not True]
    if not playable:
        raise ProjectError('Feedpak requires at least one playable arrangement; scratch tracks are saved in project JSON until a playable arrangement exists')
    if SCRATCH_PATH in entries:
        try:
            existing=_decode_json(entries[SCRATCH_PATH])
        except (ValueError,UnicodeError):
            existing=None
        if isinstance(existing,dict) and existing.get('format')==SCRATCH_FORMAT:
            del entries[SCRATCH_PATH]
        elif scratch:
            raise ProjectError('Reserved scratch sidecar path already contains unrelated source content; preserve it under a different path before exporting scratch tracks')
    if scratch:
        entries[SCRATCH_PATH]=_json({'format':SCRATCH_FORMAT,'arrangements':scratch})
    untimed=(project.get('lyricSheet') or {}).get('untimed') or []
    if not isinstance(untimed,list) or any(not isinstance(text,str) for text in untimed):
        raise ProjectError('Lyric sheet untimed syllables must be a list of text')
    if LYRIC_SHEET_PATH in entries:
        try:
            existing=_decode_json(entries[LYRIC_SHEET_PATH])
        except (ValueError,UnicodeError):
            existing=None
        if isinstance(existing,dict) and existing.get('format')==LYRIC_SHEET_FORMAT:
            del entries[LYRIC_SHEET_PATH]
        elif untimed:
            raise ProjectError('Reserved lyric sheet path already contains unrelated source content')
    if untimed:
        entries[LYRIC_SHEET_PATH]=_json({'format':LYRIC_SHEET_FORMAT,'untimed':untimed})
    if any(arr.get('_entry',{}).get('_songLevel') for arr in scratch):
        manifest.pop('drum_tab',None)
    manifest.update({k: project.get(k, default) for k,default in [('title','Untitled'),('artist',''),('duration',0)]})
    for key in ('album','year'):
        value=project.get(key)
        if value in (None,''):manifest.pop(key,None)
        else:manifest[key]=value
    # Codec is a FeedPak codec name that overrides the extension: older projects stored the
    # extension itself ("wav", "ogg", "m4a"), which a Reader would not recognise.
    for stem in manifest.get('stems') or []:
        if isinstance(stem,dict) and isinstance(stem.get('codec'),str):
            alias={'wav':'pcm','wave':'pcm','ogg':'vorbis','m4a':'aac'}.get(stem['codec'].lower())
            if alias:stem['codec']=alias
    # The writer meets 1.25; an older declared version is raised, a newer one kept.
    declared=str(manifest.get('feedpak_version',''));parts=[int(x) for x in re.findall(r'\d+',declared)[:3]]
    if len(parts)<3 or tuple(parts)<(1,25,0):manifest['feedpak_version']='1.25.0'
    manifest.setdefault('stems', [])
    stems=manifest['stems']
    if not isinstance(stems,list) or not stems:
        raise ProjectError('Feedpak requires source audio. Load your own audio or render an original MIDI guide audio track before exporting; project JSON can save without audio.')
    for stem in stems:
        if not isinstance(stem,dict) or not stem.get('file') or _path(stem['file']) not in entries:
            raise ProjectError('A Feedpak audio stem is missing its source bytes; select the source audio again before exporting')
    old_entries = manifest.get('arrangements', [])
    original_alias=manifest.pop('drum_tab',None)
    original_owners={}
    for entry in old_entries:
        for field in ('file','drum_tab'):
            if entry.get(field):original_owners.setdefault(_path(entry[field]),set()).add(entry.get('id'))
    requests=[_path(arr.get('_entry',{})[field]) for arr in project['arrangements'] for field in ('file','drum_tab') if arr.get('_entry',{}).get(field)]
    request_counts=Counter(name.casefold() for name in requests)
    reserved={name.casefold() for name in entries}|{name.casefold() for name in requests}|{name.casefold() for name in original_owners}
    if original_alias:reserved.add(_path(original_alias).casefold())
    claimed=set()
    def chart_path(arr,entry,field,index):
        requested=entry.get(field)
        if requested:
            requested=_path(requested)
            owned=arr['id'] in original_owners.get(requested,set()) or bool(entry.get('_songLevel') and requested==original_alias)
            vacant=requested not in entries and requested not in original_owners and requested!=original_alias
            if request_counts[requested.casefold()]<=1 and requested.casefold() not in claimed and (owned or vacant):
                claimed.add(requested.casefold());return requested
        stem='arrangements/'+('drums_' if field=='drum_tab' else 'arr_')+str(index)
        name=stem+'.json';suffix=2
        while name.casefold() in reserved or name.casefold() in claimed:
            name=stem+'_'+str(suffix)+'.json';suffix+=1
        reserved.add(name.casefold());claimed.add(name.casefold())
        return name
    editable_ids = {a['id'] for a in project['arrangements']}
    # Removed editable entries are removed; unsupported, opaque entries remain.
    opaque = [e for e in old_entries if e.get('id') not in editable_ids and not e.get('file') and not e.get('drum_tab')]
    arrangement_entries = []
    drum_authoring = []
    for index, arr in enumerate(playable):
        if arr.get('_notationOnly'):
            _validate_retained_notation(arr)
            arrangement_entries.append(copy.deepcopy(arr['_entry']))
            continue
        original_arr=arr
        arr=_snapshot_arrangement(arr)
        if arr.get('difficulties'):
            arr.update({field:copy.deepcopy(arr['difficulties'][-1].get(field,[])) for field in LEVEL_FIELDS})
        entry = copy.deepcopy(arr.get('_entry', {}))
        notation_decision=_notation_call(_notation_state.notation_reference_decision,project,original_arr,arr)
        if not notation_decision['retain']:
            entry.pop('notation',None)
        elif original_arr.get('_fromNotation') and notation_decision['reason']=='unchanged':
            arrangement_entries.append(copy.deepcopy(original_arr['_entry']))
            continue
        if notation_decision.get('retime') and entry.get('notation') in entries:
            member=entry['notation']
            document=_decode_json(entries[member],member)
            warp=_notation_call(_notation_state.beat_warp,notation_decision['retime']['from'],notation_decision['retime']['to'])
            entries[member]=_json(_notation_call(_notation_state.retime_notation,document,warp))
        authored_type=str((original_arr.get('_entry') or {}).get('type','')).strip()
        song_level = bool(entry.get('_songLevel'))
        primary_alias = bool(entry.pop('_primaryDrumAlias',False))
        # A keys part keeps the instrument type it was authored with (piano, organ, ...).
        kind='vocals' if vocal_only else authored_type if arr.get('type')=='keys' and authored_type.lower() in KEYS_FAMILY_TYPES else arr.get('type','guitar')
        entry.update(id=arr['id'], name=arr.get('name', arr['id']), type=kind)
        raw = copy.deepcopy(arr.get('_wire', {}))
        if 'guideVoice' in arr:
            raw['oceGuideVoice']=copy.deepcopy(arr['guideVoice'])
        else:
            raw.pop('oceGuideVoice',None)
        drums = arr.get('type') == 'drums'
        cents=_cent_offset(arr)
        if 'centOffset' in entry or drums:
            entry['centOffset']=cents
            raw.pop('centOffset',None)
        else:
            raw['centOffset']=cents
        if drums:
            filename = chart_path(arr,entry,'drum_tab',index)
            entry['drum_tab'] = filename
            entry.pop('file',None);entry.pop('notation',None)
            hits=[_wire_note(n,drums=True) for n in arr.get('notes',[])]
            for chord in arr.get('chords',[]):
                hits.extend(_wire_note(_chord_child(note,chord.get('time',chord.get('t',0)),drums=True),drums=True) for note in chord.get('notes',[]))
            # Stable sorting preserves duplicate simultaneous hits and their voices.
            hits.sort(key=lambda hit:hit['t'])
            raw.update(version=raw.get('version', 1), name=arr.get('name', 'Drums'), hits=hits)
        else:
            filename = chart_path(arr,entry,'file',index)
            entry.pop('drum_tab',None)
            entry.update(file=filename, tuning=arr.get('tuning', []), capo=arr.get('capo', 0))
            raw.update(name=arr.get('name', ''), tuning=arr.get('tuning', []), capo=arr.get('capo', 0), stringCount=arr.get('stringCount', len(arr.get('tuning', []))), basePitches=arr.get('basePitches', []), notes=[_wire_note(n, keys=arr.get('type') == 'keys') for n in arr.get('notes', [])], chords=[_wire_chord(c,keys=arr.get('type')=='keys') for c in arr.get('chords', [])], templates=[{k:copy.deepcopy(v) for k,v in t.items() if not k.startswith('_')} for t in arr.get('chord_templates', [])], anchors=copy.deepcopy(arr.get('anchors', [])), handshapes=copy.deepcopy(arr.get('handshapes', [])))
            if arr.get('type') in BASES:
                wire_tuning,standard=_effective_tuning(arr,target='feedpak')
                entry['tuning']=wire_tuning
                raw['tuning']=wire_tuning
                raw['basePitches']=standard
                public=_layout_wire_value(raw['stringCount'],standard,wire_tuning)
                authored_bases=arr.get('basePitches') or _instrument_bases(arr['type'],raw['stringCount'])
                if authored_bases!=standard or arr.get('tuning',[])!=wire_tuning:
                    raw['oceStringLayout']=_layout_record(arr,public)
                else:
                    raw.pop('oceStringLayout',None)
            elif arr.get('type')=='keys':
                # Keys pitch is s x 24 + f (spec 6.2.3): string layout fields mean nothing here.
                for field in ('tuning','capo'):entry.pop(field,None)
                for field in ('tuning','capo','stringCount','basePitches'):raw.pop(field,None)
            if arr.get('instrument'):
                raw['instrument']=arr['instrument']
            # Native phrases contain difficulty ladders. Preserve unchanged
            # source boundaries, but honor explicit canonical marker edits and
            # refuse any projection that would omit or duplicate authored rows.
            phrases=_feedpak_phrase_layout(arr,project.get('duration',0))
            if arr.get('difficulties'):
                for phrase in phrases:
                    original={int(l.get('difficulty',0)):l for l in phrase.get('levels',[])}
                    levels=[]
                    for authored in arr['difficulties']:
                        level=copy.deepcopy(original.get(authored['difficulty'],{}))
                        level['difficulty']=authored['difficulty']
                        for field in LEVEL_FIELDS:
                            rows=[row for row in authored.get(field,[]) if phrase['start_time']<=row.get('time',row.get('t',row.get('start_time',0)))<phrase['end_time']]
                            level[field]=[_wire_note(n,keys=arr.get('type')=='keys') for n in rows] if field=='notes' else [_wire_chord(c,keys=arr.get('type')=='keys') for c in rows] if field=='chords' else copy.deepcopy(rows)
                        levels.append(level)
                    phrase['levels']=levels
                    occupied=[l['difficulty'] for l in levels if l['notes'] or l['chords']]
                    phrase['max_difficulty']=max(occupied,default=levels[0]['difficulty'])
                raw['phrases']=phrases
        # Tone changes apply to drum parts too (a drum rig/kit can change mid-song the same as a
        # guitar amp), so this is not nested under the guitar/bass/keys branch above.
        tones = copy.deepcopy(arr.get('tones',project.get('tones')))
        if isinstance(tones,dict):
            changes = []
            own_tempos=bool(arr.get('tempos'))
            for change in tones.get('changes',[]):
                change['t'] = change.pop('time',change.get('t',0))
                # FeedPak 1.20: keep an existing beat anchor coherent with t on the saved grid
                # (the editor's t is authoritative; tempo edits that move the music move t).
                if 'beat' in change:
                    if own_tempos:change.pop('beat')
                    else:
                        beat=_grid_index(project.get('beats',[]),change['t'])
                        if beat is None:change.pop('beat')
                        else:change['beat']=beat
                changes.append(change)
            tones['changes'] = changes
            if isinstance(tones.get('definitions'),dict):
                # An empty definitions dict (the normal in-editor default for a part with no
                # tone library yet) should not fabricate an empty "definitions": [] on a part
                # that never had one on the wire.
                if tones['definitions']:
                    tones['definitions'] = [{**definition,'name':name} for name,definition in tones['definitions'].items()]
                else:
                    tones.pop('definitions',None)
            if 'tones' in entry:
                entry['tones'] = tones
                raw.pop('tones',None)
            else:
                raw['tones'] = tones
        entries[_path(filename)] = _json(raw)
        if drums:
            authored=_snapshot_arrangement(original_arr)
            drum_authoring.append({'id':arr['id'],'drum_tab':filename,'sha256':hashlib.sha256(entries[filename]).hexdigest(),'authoring':{field:copy.deepcopy(authored[field]) for field in DRUM_AUTHORING_FIELDS if field in authored}})
        entry.pop('_songLevel',None)
        if song_level or primary_alias:
            manifest['drum_tab'] = filename
        # Explicit IDs also bind legacy song-level drums to their authoring row.
        # The primary song alias remains and is deduplicated on import.
        arrangement_entries.append(entry)
    _store_drum_authoring(entries,drum_authoring)
    manifest['arrangements'] = arrangement_entries + opaque
    timeline_name = _path(manifest.get('song_timeline', 'song_timeline.json'))
    timeline = _decode_json(entries[timeline_name],timeline_name) if timeline_name in entries else {'version': 1}
    timeline.update(beats=[{k:copy.deepcopy(v) for k,v in b.items() if k not in ('numerator','denominator','bar','beat','meterStart')} for b in project.get('beats', [])], sections=[_wire_section(s) for s in project.get('sections', [])])
    for field in ('tempos','time_signatures'):
        if field in project:
            timeline[field] = copy.deepcopy(project[field])
    authored_meter=_project_signatures(project)
    if authored_meter:
        timeline['time_signatures']=authored_meter
    entries[timeline_name] = _json(timeline)
    manifest['song_timeline'] = timeline_name
    vocal_state=_vocal_export_state(project)
    if 'vocals' in project and not vocal_state['unchanged']:
        def vocal_path(field,default):
            if manifest.get(field):return _path(manifest[field])
            occupied={name.casefold() for name in entries}
            name=default
            if name.casefold() in occupied:
                stem='editor/oce-'+Path(default).stem
                name=stem+'.json';suffix=2
                while name.casefold() in occupied:
                    name=stem+'-'+str(suffix)+'.json';suffix+=1
            return name
        lyrics_name=vocal_path('lyrics','lyrics.json')
        lyrics=[];pitches=[]
        for vocal in sorted(project['vocals'],key=lambda row:row['time']):
            lyric=copy.deepcopy(vocal.get('_lyricWire',{}))
            lyric.update(t=vocal['time'],d=vocal['length'],w=vocal['text'])
            if not vocal.get('_pitchOnly') or vocal['text']:
                lyrics.append(lyric)
            if vocal.get('pitch') is not None:
                pitch=copy.deepcopy(vocal.get('_pitchWire',{}))
                pitch.update(t=vocal['time'],d=vocal['length'],midi=vocal['pitch'])
                pitches.append(pitch)
        if vocal_state['writeLyrics'] and (lyrics or manifest.get('lyrics')):
            entries[lyrics_name]=_json(lyrics)
            manifest['lyrics']=lyrics_name
        if vocal_state['lyricsChanged']:
            manifest['lyrics_source']='authored'
            manifest.pop('lyric_transcription',None)
            for track in manifest.get('lyric_tracks',[]):
                if track.get('file')==manifest.get('lyrics'):
                    track['lyrics_source']='authored'
                    track.pop('lyric_transcription',None)
        if vocal_state['writePitch'] and (pitches or manifest.get('vocal_pitch')):
            pitch_name=vocal_path('vocal_pitch','vocal_pitch.json')
            pitch_document=_decode_json(entries[pitch_name],pitch_name) if pitch_name in entries else {'version':1}
            pitch_document.update(notes=pitches)
            entries[pitch_name]=_json(pitch_document)
            manifest['vocal_pitch']=pitch_name
            if vocal_state['pitchChanged']:
                manifest.pop('pitch_extraction',None)
        if vocal_state['pitchChanged']:
            manifest.pop('vocal_pitch_contour',None)
            manifest.pop('contour_extraction',None)
    _store_roles(project,entries,manifest)
    _store_flat_phrases(project,entries,manifest)
    _mxl_store(project,entries)
    _midi_call(_midi_programs.store,project,entries,manifest,_midi_stream)
    validate_feedpak_entries(manifest, entries)
    manifest_name = 'manifest.yaml'  # Canonical writer index; original alias bytes remain retained.
    entries[manifest_name] = yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False).encode('utf-8')
    if len(entries)>MAX_MEMBERS or sum(len(content) for content in entries.values())>MAX_BYTES:
        raise ProjectError('Exported archive exceeds the safe uncompressed size or member limit')
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name,content in entries.items():
            archive.writestr(name, content)
    return output.getvalue()


def _number(value):
    try:
        numeric = float(value)
        return int(numeric) if numeric.is_integer() else numeric
    except (ValueError, TypeError):
        return value


def _json_bend_curve(text):
    try:
        curve=json.loads(text) if isinstance(text,str) else None
    except ValueError:
        return None
    if not isinstance(curve,list):
        return None
    finite=lambda value:isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)
    points=[{'t':float(p['t']),'v':float(p['v'])} for p in curve if isinstance(p,dict) and finite(p.get('t')) and finite(p.get('v'))]
    return sorted(points,key=lambda p:p['t']) or None


def _xml_note(element, index, parent_time=0):
    raw = {k: _number(v) for k,v in element.attrib.items()}
    note = {'id': f'n{index}', 'time': raw.get('time', parent_time), 'string': raw.get('string', 0), 'fret': raw.get('fret', 0), 'sustain': raw.get('sustain', 0), 'techniques': {}, '_xml': ET.tostring(element, encoding='unicode')}
    if element.get('hand') in ('lh','rh'):
        note['hand']=element.get('hand')
    for key,xml_key in XML_TECH.items():
        if xml_key in raw:
            note['techniques'][TECH_NAMES[key]] = raw[xml_key]!=-1 if key in ('plk','slp') else bool(raw[xml_key]) if key in BOOL_TECH else raw[xml_key]
    if 'forceDestPitch' in raw:
        note['techniques']['force_destination_pitch']=_force_destination_pitch(raw['forceDestPitch'])
    if 'bendValues' in raw:
        # FeedBack's GP converter writes the curve as a JSON [{t,v}] attribute
        # (t seconds from onset). Malformed text stays only in the raw _xml.
        note['techniques'].pop('bend_values',None)
        curve=_json_bend_curve(raw['bendValues'])
        if curve:note['techniques']['bend_values']=curve
    bend = element.find('bendValues')
    if bend is not None:
        note['techniques']['bend_values'] = [{'t': float(n.get('time',0)) - note['time'], 'v': float(n.get('step',0))} for n in bend]
    return note


def _xml_level(level):
    result={'difficulty':int(level.get('difficulty',0)),'notes':[_xml_note(n,i) for i,n in enumerate(level.findall('./notes/note'))],'chords':[],'anchors':[],'handshapes':[]}
    for chord in level.findall('./chords/chord'):
        row={k:_number(v) for k,v in chord.attrib.items()}
        row.update(time=row.pop('time',0),chord_id=row.pop('chordId',0),_xml=ET.tostring(chord,encoding='unicode'))
        row['notes']=[_xml_note(n,i,row['time']) for i,n in enumerate(chord.findall('chordNote'))]
        result['chords'].append(row)
    for tag,field in [('anchors','anchors'),('handShapes','handshapes')]:
        result[field]=[{k:_number(v) for k,v in el.attrib.items()} for el in level.findall(f'./{tag}/*')]
    for shape in result['handshapes']:
        for old,new in [('chordId','chord_id'),('startTime','start_time'),('endTime','end_time')]:
            if old in shape:
                shape[new]=shape.pop(old)
    return result


def _xml_capo_coordinates(root, exporting=False, include_levels=True):
    """Native RS frets are physical; FeedBack frets are relative to the capo.

    RS fret zero means the capo itself. -1 remains an absent/muted sentinel.
    Anchors and slide endpoints share the physical fret coordinate system.
    """
    capo=int(root.findtext('capo','0'))
    if not 0 <= capo <= 24:
        raise ProjectError('Capo must be between 0 and 24')
    if not capo:
        return
    def convert(element,key):
        if key not in element.attrib:
            return
        fret=int(element.get(key))
        if fret < 0:
            return
        physical=capo+fret if exporting and fret else fret
        if physical > 24:
            raise ProjectError('Capo plus relative fret exceeds the Rocksmith 2014 physical fret limit of 24')
        if not exporting and fret and fret < capo:
            raise ProjectError(f'Rocksmith XML physical fret {fret} is below capo {capo}; cannot preserve its pitch in a capo-relative chart')
        element.set(key,str(physical if exporting else fret-capo if fret else 0))
    for template in root.findall('./chordTemplates/chordTemplate'):
        for string in range(8):
            convert(template,f'fret{string}')
    if include_levels:
        for level in root.findall('./levels/level'):
            for note in level.findall('./notes/note')+level.findall('./chords/chord/chordNote'):
                for key in ('fret','slideTo','slideUnpitchTo'):
                    convert(note,key)
            for anchor in level.findall('./anchors/anchor'):
                convert(anchor,'fret')


def _xml_string_count(root):
    """String count from the `strings` attribute Editor on Fire adds to <tuning>.

    EOF writes Rocksmith 2014 XML as version 8: the same chart format DLC Builder
    reads, with a nine-entry tuning, this count and a <fretHandMutes> list per level.
    The file is kept as written; returns None when there is no count."""
    tuning=root.find('tuning')
    if tuning is None or not tuning.get('strings'):
        return None
    try:
        count=int(tuning.get('strings'))
    except ValueError:
        raise ProjectError('The XML tuning has an invalid string count') from None
    if not 4<=count<=8:
        raise ProjectError(f'This chart has {count} strings; the editor supports 4 to 8')
    return count


def _xml_extended_strings(root):
    """Seven or eight when a file without a `strings` count still uses string 6 or 7
    (notes, chord notes or chord shape columns), as RS7X-order XML does."""
    used={int(n.get('string')) for n in [*root.iter('note'),*root.iter('chordNote')] if (n.get('string') or '').isdigit()}
    used|={int(k[4:]) for t in root.iter('chordTemplate') for k,v in t.attrib.items() if k.startswith('fret') and k[4:].isdigit() and v!='-1'}
    return 8 if 7 in used else 7 if 6 in used else None


def _from_rs7x_order(arr):
    """Seven- and eight-string Rocksmith 2014 XML follows the RS7X layout of the
    rs7string mod (docs/rs7x-export.md): strings 0-5 are the stock low E to high e,
    6 is the low B and 7 the low F#. The editor numbers strings from the lowest, so
    reorder notes, chord shapes and tuning in place."""
    count=arr['stringCount'];extra=count-6
    editor=lambda s:s+extra if s<6 else extra-1-(s-6)
    columns=lambda values:[(list(values)+[-1]*count)[6+extra-1-i] if i<extra else (list(values)+[-1]*count)[i-extra] for i in range(count)]
    for owner in [arr]+arr.get('difficulties',[]):
        for note in owner.get('notes',[]):
            note['string']=editor(note['string'])
        for chord in owner.get('chords',[]):
            for note in chord.get('notes',[]):
                if 'string' in note:note['string']=editor(note['string'])
    for template in arr.get('chord_templates',[]):
        for key in ('frets','fingers'):
            if key in template:template[key]=columns(template[key])
    arr['tuning']=columns(arr['tuning'])
    arr['basePitches']=_instrument_bases('guitar',count)


def load_xml(data,authoring_layout=None):
    data=_xml_input(data)
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ProjectError('XML declarations with entities are unsupported')
    root = ET.fromstring(data)
    if root.tag != 'song' or root.get('version') not in ('7','8'):
        raise ProjectError('Expected a Rocksmith 2014 song XML (version 7, or version 8 from Editor on Fire)')
    eof_strings=_xml_string_count(root)
    # FeedBack's Guitar Pro converter marks its XML with <tuning stringCount>, and
    # numbers strings from the lowest (FeedBack's own layout, not RS7X).
    feedback_count=(root.find('tuning').get('stringCount') if root.find('tuning') is not None else None)
    if feedback_count is not None and not authoring_layout:
        try:eof_strings=int(feedback_count)
        except ValueError:raise ProjectError('The XML tuning has an invalid stringCount') from None
        if not 4<=eof_strings<=8:raise ProjectError(f'This chart has {eof_strings} strings; the editor supports 4 to 8')
    elif eof_strings is None and not authoring_layout:
        eof_strings=_xml_extended_strings(root)
    _xml_capo_coordinates(root)
    # Keep the original source document in _xml; parsed editable coordinates
    # above are relative, and the writer replaces those known fields explicitly.
    properties=root.find('arrangementProperties')
    flags=properties.attrib if properties is not None else {}
    role='bass' if flags.get('pathBass')=='1' else 'rhythm' if flags.get('pathRhythm')=='1' else 'lead' if flags.get('pathLead')=='1' else 'bass' if root.findtext('arrangement','').lower()=='bass' else 'rhythm' if 'rhythm' in root.findtext('arrangement','').lower() else 'lead'
    kind = authoring_layout.get('type') if authoring_layout else 'bass' if role=='bass' else 'guitar'
    levels = root.findall('./levels/level')
    level = max(levels, key=lambda l: int(l.get('difficulty', 0))) if levels else ET.Element('level', difficulty='0')
    count = authoring_layout.get('stringCount',6) if authoring_layout else eof_strings or len(BASES[kind])
    tuning = root.find('tuning')
    arr = {'id': 'arr0', 'name': root.findtext('arrangement', 'Lead'), 'type': kind, 'stringCount': count, 'basePitches': BASES.get(kind,[])[:] if count==len(BASES.get(kind,[])) else _instrument_bases(kind,count), 'tuning': [int(tuning.get(f'string{i}',0)) if tuning is not None else 0 for i in range(count)], 'capo': int(root.findtext('capo','0')), 'notes': [_xml_note(n,i) for i,n in enumerate(level.findall('./notes/note'))], 'chords': [], 'chord_templates': [], 'anchors': [], 'handshapes': [], '_xml': data.decode('utf-8-sig'), '_difficulty': int(level.get('difficulty',0))}
    arr['centOffset']=float(root.findtext('centOffset','0'))
    for chord in level.findall('./chords/chord'):
        row = {k:_number(v) for k,v in chord.attrib.items()}
        row.update(time=row.pop('time',0), chord_id=row.pop('chordId',0), _xml=ET.tostring(chord,encoding='unicode'))
        row['notes'] = [_xml_note(n,i,row['time']) for i,n in enumerate(chord.findall('chordNote'))]
        arr['chords'].append(row)
    for template in root.findall('./chordTemplates/chordTemplate'):
        arr['chord_templates'].append({'name': template.get('chordName',''), 'displayName': template.get('displayName',''), 'frets': [int(template.get(f'fret{i}',-1)) for i in range(count)], 'fingers': [int(template.get(f'finger{i}',-1)) for i in range(count)], '_xml': ET.tostring(template,encoding='unicode')})
    for tag,field in [('anchors','anchors'),('handShapes','handshapes')]:
        arr[field] = [{k:_number(v) for k,v in el.attrib.items()} for el in level.findall(f'./{tag}/*')]
    for shape in arr['handshapes']:
        for old,new in [('chordId','chord_id'),('startTime','start_time'),('endTime','end_time')]:
            if old in shape:
                shape[new] = shape.pop(old)
    definitions = root.findall('./phrases/phrase')
    arr['phrases'] = []
    for i,iteration in enumerate(root.findall('./phraseIterations/phraseIteration')):
        phrase_id = int(iteration.get('phraseId',0))
        name = definitions[phrase_id].get('name','phrase') if 0 <= phrase_id < len(definitions) else 'phrase'
        arr['phrases'].append({'id':f'p{i}','name':name,'time':float(iteration.get('time',0))})
    arr['_phrasesOriginal'] = copy.deepcopy(arr['phrases'])
    if authoring_layout:
        arr.update({key:copy.deepcopy(value) for key,value in authoring_layout.items() if key in ('type','stringCount','basePitches','tuning')})
        if kind=='keys':
            for note in arr['notes']+[n for chord in arr['chords'] for n in chord.get('notes',[])]:
                note['pitch']=note['string']*24+note['fret']
    arr['role']=role
    arr['priority']='bonus' if flags.get('bonusArr')=='1' else 'alternative' if flags.get('represent')=='0' else 'main'
    if levels:
        arr['difficulties']=[_xml_level(l) for l in sorted(levels,key=lambda l:int(l.get('difficulty',0)))]
        for authored in arr['difficulties']:
            _materialize_chords({'chords':authored['chords'],'chord_templates':arr['chord_templates']},native=True)
        arr['activeDifficulty']=arr['difficulties'][-1]['difficulty']
        if kind=='keys':
            for authored in arr['difficulties']:
                for note in authored['notes']+[n for chord in authored['chords'] for n in chord.get('notes',[])]:
                    note['pitch']=note['string']*24+note['fret']
    _materialize_chords(arr,native=True)
    rs7x_order=not authoring_layout and feedback_count is None and kind=='guitar' and count>6
    if rs7x_order:
        _from_rs7x_order(arr)
    base = root.findtext('tonebase')
    if base or root.find('tones') is not None:
        arr['tones'] = {'base':base or 'Default','changes':[{'time':float(t.get('time',0)),'name':t.get('name','Default')} for t in root.findall('./tones/tone')], 'definitions':{}}
    project={'version':1, **({'year':year} if (year:=song_year(root.findtext('albumYear'))) else {}), 'title':root.findtext('title','Untitled'), 'artist':root.findtext('artistName',''), 'album':root.findtext('albumName',''), 'duration':float(root.findtext('songLength','0')), 'beats':[{k:_number(v) for k,v in n.attrib.items()} for n in root.findall('./ebeats/ebeat')], 'sections':[_section({k:_number(v) for k,v in n.attrib.items()}) for n in root.findall('./sections/section')], 'arrangements':[arr]}
    if rs7x_order:
        project.setdefault('import_warnings',[]).append(f'{count}-string guitar XML read in the RS7X string order (strings 0-5 are low E to high e, 6 is the low B{", 7 the low F#" if count==8 else ""}). If the extra string looks wrong, the source used another order; tell us which tool wrote it.')
    elif not authoring_layout and kind=='bass' and count>4:
        project.setdefault('import_warnings',[]).append(f'{count}-string bass XML read with string 0 as the lowest string. Check the low string; there is no published convention for extended bass in Rocksmith 2014 XML.')
    signatures={}
    for event in root.findall('./events/event'):
        # Established public EOF/RS XML convention, not a new XML field.
        match=re.fullmatch(r'TS:(\d+)/(\d+)',event.get('code',''))
        if match:
            numerator,denominator=map(int,match.groups())
            time=float(event.get('time','0'))
            if numerator<=0 or denominator<=0 or not math.isfinite(time) or time<0:
                raise ProjectError('Invalid XML TS:numerator/denominator event')
            if time in signatures and signatures[time]!=[numerator,denominator]:
                raise ProjectError('Conflicting XML time signature events at the same time')
            signatures[time]=[numerator,denominator]
    if signatures:
        project['time_signatures']=[{'time':time,'ts':ts} for time,ts in sorted(signatures.items())]
        _annotate_meter(project)
    if not signatures or min(signatures)>0:
        project.setdefault('import_warnings',[]).append('XML beat markers do not establish the meter denominator before the first TS:numerator/denominator event; unknown intervals assume quarter-note markers. Verify meter against the source.')
    if any('forceDestPitch' in element.attrib for element in root.iter()):
        project.setdefault('import_warnings',[]).append('Observed prerelease forceDestPitch attributes are retained as authoring metadata; Stock Rocksmith2014 has no established equivalent. Save JSON/Feedpak or return this setting to Auto for Stock XML/CDLC export.')
    return validate_project(project)


def _attr(value):
    return str(int(value)) if isinstance(value,bool) else str(value)


def _emit_note(note, tag='note'):
    el = ET.fromstring(note['_xml']) if note.get('_xml') else ET.Element(tag)
    el.tag = tag
    if 'force_destination_pitch' in note.get('techniques',{}):
        el.attrib.pop('forceDestPitch',None)
    el.attrib.update({k:_attr(note.get(k,0)) for k in ('time','string','fret','sustain')})
    if tag == 'chordNote':
        el.attrib.pop('time',None)
    tech = _short_techniques(note.get('techniques', {}))
    if tech.get('rh',-1)>127:
        raise ProjectError('Stock rightHand must fit a signed byte; save larger FeedBack teaching values as JSON/Feedpak')
    for key,xml_key in XML_TECH.items():
        if key in ('bnv','fhm'):
            continue
        el.attrib.pop(xml_key,None)
        if key in tech:
            if key=='pkd' and tech[key]==-1:
                continue
            value=(1 if tech[key] else -1) if key in ('plk','slp') else _vibrato_intensity(tech[key]) if key=='vb' else _tap_finger(tech[key]) if key=='tp' else tech[key]
            el.set(xml_key,_attr(value))
    el.attrib.pop('fretHandMute',None)
    if 'fhm' in tech or 'mt' in tech:
        el.set('mute',_attr(bool(tech.get('mt',False) or tech.get('fhm',False))))
    for old in el.findall('bendValues'):
        el.remove(old)
    # Keep a source JSON curve attribute (read by FeedBack) in step with edits.
    if 'bendValues' in el.attrib:
        if tech.get('bnv'):el.set('bendValues',json.dumps([{'t':p['t'],'v':p['v']} for p in tech['bnv']],separators=(',',':')))
        elif _json_bend_curve(el.get('bendValues')):el.attrib.pop('bendValues')
    if tech.get('bnv'):
        bend = ET.SubElement(el,'bendValues',count=str(len(tech['bnv'])))
        for point in tech['bnv']:
            ET.SubElement(bend,'bendValue',time=str(note.get('time',0)+point['t']),step=str(point['v']))
    return el


def _validate_stock_force_pitch(arr):
    for owner in [arr]+arr.get('difficulties',[]):
        notes=list(owner.get('notes',[]))
        for chord in owner.get('chords',[]):
            children=chord.get('notes',[])
            if children:
                parent=_force_destination_pitch(chord.get('techniques',{}).get('force_destination_pitch',chord.get('forceDestPitch',0)))
                for child in children:
                    if _force_destination_pitch(child.get('techniques',{}).get('force_destination_pitch',parent)):
                        raise ProjectError('Stock Rocksmith2014 does not support Force Destination Pitch On/Off; set it to Auto or save as project JSON/Feedpak authoring metadata')
            elif _force_destination_pitch(chord.get('techniques',{}).get('force_destination_pitch',chord.get('forceDestPitch',0))):
                raise ProjectError('Stock Rocksmith2014 does not support Force Destination Pitch On/Off; set it to Auto or save as project JSON/Feedpak authoring metadata')
        for note in notes:
            if _force_destination_pitch(note.get('techniques',{}).get('force_destination_pitch',0)):
                raise ProjectError('Stock Rocksmith2014 does not support Force Destination Pitch On/Off; set it to Auto or save as project JSON/Feedpak authoring metadata')


def _validate_stock_records(arr):
    templates=arr.get('chord_templates',[])
    for owner in [arr]+arr.get('difficulties',[]):
        notes=list(owner.get('notes',[]))
        for chord in owner.get('chords',[]):
            reference=_chord_reference(chord)
            if type(reference) is not int or not 0<=reference<len(templates):
                raise ProjectError('Stock Rocksmith2014 chords require a valid template; retain explicit untemplated voices as Feedpak or create a matching chord shape')
            frets=templates[reference].get('frets',[])
            children=[_chord_child(n,chord.get('time',chord.get('t',0))) for n in chord.get('notes',[])]
            if children:
                actual={n['string']:n['fret'] for n in children}
                expected={string:fret for string,fret in enumerate(frets) if fret>=0}
                if actual!=expected:
                    raise ProjectError('Stock chord voices must match their complete template frets; otherwise native packaging changes pitches. Relink a matching shape or save Feedpak.')
            notes.extend(children)
        for note in notes:
            if len(_short_techniques(note.get('techniques',{})).get('bnv',[]))>32:
                raise ProjectError('Stock Rocksmith2014 supports at most 32 bend points per note; simplify the curve explicitly or retain its complete data as Feedpak/JSON')


def save_xml(project, arrangement_id=None, *, rs7x=False):
    """rs7x: the arrangement has been put in the RS7X order by rs7x.stock_order
    (DLC Builder export of seven-string guitar only)."""
    validate_project(project)
    arr = next((a for a in project['arrangements'] if a['id'] == arrangement_id), project['arrangements'][0] if arrangement_id is None else None)
    if arr is None:
        raise ProjectError('Arrangement ID not found')
    if arr.get('hidden') is True:
        raise ProjectError('This arrangement is hidden; unhide it to export it')
    if arr.get('editorOnly') is True:
        raise ProjectError('Scratch tracks are editor-only; duplicate this track as a playable arrangement before exporting Rocksmith XML')
    arr=_snapshot_arrangement(arr)
    _validate_zone_styles(arr,xml=True)
    _validate_stock_force_pitch(arr)
    _validate_stock_records(arr)
    kind = arr.get('type')
    if kind not in BASES:
        raise ProjectError('Rocksmith 2014 XML supports guitar and bass only; save this instrument as Feedpak')
    count = int(arr.get('stringCount', len(arr.get('tuning',[]))))
    if rs7x and not (kind == 'guitar' and count == 7 and arr.get('_rs7xOrdered')):
        raise ProjectError('The RS7X layout is for seven-string guitar in the RS7X string order')
    if count != len(BASES[kind]) and not rs7x:
        raise ProjectError('Rocksmith 2014 XML requires six-string guitar or four-string bass; extended charts must be saved as Feedpak')
    columns = 7 if rs7x else 6
    root = ET.fromstring(arr['_xml']) if arr.get('_xml') else ET.Element('song',version='7')
    def text(tag,value):
        el = root.find(tag)
        if el is None:
            el = ET.SubElement(root,tag)
        el.text = str(value)
    for tag,key,default in [('title','title','Untitled'),('artistName','artist',''),('albumName','album',''),('songLength','duration',0)]:
        text(tag,project.get(key,default))
    # A song without a year is written without one, never with a made-up year.
    if song_year(project.get('year')):text('albumYear',song_year(project.get('year')))
    else:
        for el in root.findall('albumYear'):root.remove(el)
    role=arrangement_role(arr)
    text('arrangement',role.title())
    properties=root.find('arrangementProperties')
    if properties is None:
        properties=ET.SubElement(root,'arrangementProperties')
    priority=arr.get('priority') or 'main'
    properties.attrib.update(pathLead=str(int(role=='lead')),pathRhythm=str(int(role=='rhythm')),pathBass=str(int(role=='bass')),represent=str(int(priority=='main')),bonusArr=str(int(priority=='bonus')))
    text('capo',arr.get('capo',0))
    text('part',1)
    text('offset',0)
    text('centOffset',_cent_offset(arr))
    text('startBeat',project.get('beats',[{'time':0}])[0]['time'] if project.get('beats') else 0)
    beats = project.get('beats',[])
    text('averageTempo',60*_beat_quarters(project)[-1]/(beats[-1]['time']-beats[0]['time']) if len(beats)>1 and beats[-1]['time']>beats[0]['time'] else 120)
    tuning = root.find('tuning')
    if tuning is None:
        tuning = ET.SubElement(root,'tuning')
    offsets = arr['_rs7xOffsets'] if rs7x else _effective_tuning(arr)[0]
    for i in range(columns):
        tuning.set(f'string{i}',str(offsets[i] if i<len(offsets) else 0))
    if tuning.get('strings') is not None:
        tuning.set('strings',str(count))   # Editor on Fire's count, kept in step
    def container(parent,tag,items):
        old = parent.find(tag)
        if old is not None:
            parent.remove(old)
        el = ET.SubElement(parent,tag,count=str(len(items)))
        el.extend(items)
        return el
    container(root,'ebeats',[ET.Element('ebeat',{k:_attr(v) for k,v in b.items() if k in ('time','measure')}) for b in beats])
    container(root,'sections',[ET.Element('section',name=str(s.get('name','verse')),number=str(s.get('number',1)),startTime=str(s.get('start_time',s.get('time',0)))) for s in project.get('sections',[])])
    templates = []
    for template in arr.get('chord_templates',[]):
        el = ET.fromstring(template['_xml']) if template.get('_xml') else ET.Element('chordTemplate')
        el.set('chordName',template.get('name',''))
        display_name=template.get('displayName',template.get('name',''))
        if template.get('arp') and not display_name.endswith('-arp'):
            if display_name.endswith('-nop'):
                raise ProjectError('Template arpeggio and hidden-name nop flags are mutually exclusive')
            display_name+='-arp'
        el.set('displayName',display_name)
        for i in range(columns):
            for prefix,key in [('fret','frets'),('finger','fingers')]:
                vals = template.get(key,[])
                el.set(f'{prefix}{i}',str(vals[i] if i<len(vals) else -1))
        templates.append(el)
    container(root,'chordTemplates',templates)
    levels = root.find('levels')
    if levels is None:
        levels = ET.SubElement(root,'levels',count='1')
    difficulty = arr.get('_difficulty',0)
    level = next((l for l in levels if int(l.get('difficulty',0)) == difficulty),None)
    if level is None:
        level = ET.SubElement(levels,'level',difficulty=str(difficulty))
    levels.set('count',str(len(levels)))
    container(level,'notes',[_emit_note(n) for n in sorted(arr.get('notes',[]),key=lambda n:(n['time'],n.get('string',0)))])
    chords = []
    for chord in arr.get('chords',[]):
        el = ET.fromstring(chord['_xml']) if chord.get('_xml') else ET.Element('chord')
        el.attrib.pop('forceDestPitch',None)
        el.set('time',str(chord.get('t',chord.get('time',0))))
        el.set('chordId',str(chord.get('chord_id',chord.get('id',0))))
        el.set('highDensity',str(int(bool(chord.get('highDensity',chord.get('hd',False))))))
        for attribute in ('palmMute','mute','fretHandMute'):
            el.attrib.pop(attribute,None)
        for key,value in _chord_flags(chord).items():
            el.set(XML_TECH[key],_attr(value))
        for old in el.findall('chordNote'):
            el.remove(old)
        for n in chord.get('notes',[]):
            note = _chord_child(n,chord.get('time',chord.get('t',0)))
            el.append(_emit_note(note,'chordNote'))
        chords.append(el)
    container(level,'chords',chords)
    for tag,key,rowtag,mapping in [('anchors','anchors','anchor',{}),('handShapes','handshapes','handShape',{'chord_id':'chordId','start_time':'startTime','end_time':'endTime'})]:
        container(level,tag,[ET.Element(rowtag,{mapping.get(k,k):_attr(v) for k,v in row.items() if not k.startswith('_') and k not in ('kind','hideName','arp')}) for row in arr.get(key,[])])
    # A new static difficulty chart has a complete phrase spanning the song.
    if root.find('phrases') is None:
        container(root,'phrases',[ET.Element('phrase',name='main',maxDifficulty=str(difficulty),solo='0',disparity='0',ignore='0')])
        container(root,'phraseIterations',[ET.Element('phraseIteration',time='0',phraseId='0',variation='')])
        container(root,'newLinkedDiffs',[])
        container(root,'linkedDiffs',[])
        container(root,'phraseProperties',[])
        container(root,'events',[])
    signatures=_project_signatures(project)
    if signatures:
        events=[copy.deepcopy(event) for event in root.findall('./events/event') if not re.fullmatch(r'TS:\d+/\d+',event.get('code',''))]
        for signature in signatures:
            numerator,denominator=signature['ts']
            if not isinstance(numerator,int) or not isinstance(denominator,int) or numerator<=0 or denominator<=0:
                raise ProjectError('Time signatures require positive integer numerator/denominator')
            events.append(ET.Element('event',time=str(signature['time']),code=f'TS:{numerator}/{denominator}'))
        container(root,'events',sorted(events,key=lambda event:float(event.get('time','0'))))
    if arr.get('phrases',project.get('phrases')) and arr.get('phrases',project.get('phrases')) != arr.get('_phrasesOriginal'):
        phrase_rows = sorted(arr.get('phrases',project.get('phrases')),key=lambda p:p.get('time',0))
        container(root,'phrases',[ET.Element('phrase',name=str(p.get('name','phrase')),maxDifficulty=str(difficulty),solo='0',disparity='0',ignore='0') for p in phrase_rows])
        container(root,'phraseIterations',[ET.Element('phraseIteration',time=str(p.get('time',0)),phraseId=str(i),variation='') for i,p in enumerate(phrase_rows)])
    tones = arr.get('tones',project.get('tones'))
    if isinstance(tones,dict):
        base = str(tones.get('base') or 'Default')
        text('tonebase',base)
        names = list(dict.fromkeys([base]+[str(c.get('name','Default')) for c in tones.get('changes',[])]))
        if len(names) > 4:
            raise ProjectError('Rocksmith 2014 supports at most four named tones per arrangement')
        for letter,name in zip('abcd',names):
            text('tone'+letter,name)
        container(root,'tones',[ET.Element('tone',time=str(c.get('time',0)),name=str(c.get('name',base)),id=str(names.index(str(c.get('name',base))))) for c in tones.get('changes',[])])
    if arr.get('difficulties'):
        authored=[]
        for source in arr['difficulties']:
            level_arr=copy.deepcopy(arr)
            level_arr.pop('difficulties',None)
            level_arr.pop('activeDifficulty',None)
            level_arr['_difficulty']=source['difficulty']
            level_arr.update({field:copy.deepcopy(source.get(field,[])) for field in LEVEL_FIELDS})
            subproject={**project,'arrangements':[level_arr]}
            parsed=ET.fromstring(save_xml(subproject,level_arr['id'],rs7x=rs7x))
            authored.append(parsed.find(f'./levels/level[@difficulty="{source["difficulty"]}"]'))
        container(root,'levels',authored)
        highest=arr['difficulties'][-1]['difficulty']
        phrase_rows=arr.get('phrases',[])
        definitions=root.findall('./phrases/phrase')
        for i,definition in enumerate(definitions):
            value=phrase_rows[i].get('maxDifficulty',phrase_rows[i].get('max_difficulty',highest)) if i<len(phrase_rows) else highest
            definition.set('maxDifficulty',str(value))
    _xml_capo_coordinates(root,exporting=True,include_levels=not bool(arr.get('difficulties')))
    ET.indent(root)
    return ET.tostring(root,encoding='utf-8',xml_declaration=True)


def _mxl_asset(entries,reference,suffix,limit):
    if not isinstance(reference,dict):
        raise ProjectError('MusicXML source reference must be a mapping')
    digest=reference.get('sha256');size=reference.get('size');entry=reference.get('entry')
    if not isinstance(digest,str) or re.fullmatch('[0-9a-f]{64}',digest) is None or type(size) is not int or not 0<=size<=limit:
        raise ProjectError('MusicXML source reference has invalid hash or size')
    if entry!='editor/musicxml-sources/'+digest+suffix:
        raise ProjectError('MusicXML source reference has an invalid content-addressed path')
    content=entries.get(entry)
    if not isinstance(content,bytes) or len(content)!=size or hashlib.sha256(content).hexdigest()!=digest:
        raise ProjectError('MusicXML source member is missing, stale or has a different hash/size')
    return content


def _mxl_metadata(project,entries):
    source=project.get('_import',{})
    if not isinstance(source,dict):
        return None
    reference=source.get('sourceArchive')
    if reference is None and (source.get('format')!='musicxml' or 'source' not in source):
        return None
    try:
        score=base64.b64decode(source.get('source',''),validate=True)
    except (ValueError,TypeError) as exc:
        raise ProjectError('MusicXML original score source is invalid base64') from exc
    if not score or len(score)>MAX_BYTES or _xml_input(score)!=score:
        raise ProjectError('MusicXML source must contain bounded original normalized score XML')
    digest=hashlib.sha256(score).hexdigest()
    if reference is not None:
        if not isinstance(reference,dict) or reference.get('version')!=1 or type(reference.get('version')) is not int:
            raise ProjectError('Unsupported MusicXML sourceArchive reference version')
        filename=reference.get('filename')
        if not isinstance(filename,str) or not filename or len(filename)>256 or '/' in filename or '\\' in filename or any(ord(c)<32 for c in filename):
            raise ProjectError('MusicXML sourceArchive filename must be a bounded basename')
        if reference.get('mediaType')!='application/vnd.recordare.musicxml':
            raise ProjectError('MusicXML sourceArchive media type is invalid')
        archive=_mxl_asset(entries,reference,'.mxl',MAX_MXL_ATTACHMENT)
        try:
            archive_score=_xml_input(_unwrap_musicxml(archive))
        except (ValueError,RuntimeError,OSError,ET.ParseError,zipfile.BadZipFile,zlib.error) as exc:
            raise ProjectError('Retained MusicXML source archive is invalid or unsupported') from exc
        if reference.get('scoreSha256')!=digest or archive_score!=score:
            raise ProjectError('MusicXML archive and original score source do not match')
    score_ref={'entry':'editor/musicxml-sources/'+digest+'.musicxml','sha256':digest,'size':len(score)}
    # Plain imports keep the historical inline source in JSON. Stage its asset
    # only for native export; reopened packs retain their original opaque member.
    if reference is not None or score_ref['entry'] in entries:
        if _mxl_asset(entries,score_ref,'.musicxml',MAX_BYTES)!=score:
            raise ProjectError('MusicXML original score member differs from source')
    document={'format':MXL_SOURCE_FORMAT,'version':1 if reference is not None else 2,'sourceArchive':copy.deepcopy(reference),'score':score_ref}
    if len(_json(document))>MAX_MXL_METADATA:
        raise ProjectError('MusicXML source metadata exceeds the 64 KiB limit')
    return document


def _mxl_decoded_entries(project):
    entries={};total=0
    for name,value in project.get('_pack',{}).get('entries',{}).items():
        _path(name)
        content=base64.b64decode(value,validate=True);total+=len(content)
        if total>MAX_BYTES or len(entries)>=MAX_MEMBERS:
            raise ProjectError('MusicXML retained assets exceed the aggregate archive budget')
        entries[name]=content
    return entries


def _mxl_restore(project,entries):
    content=entries.get(MXL_SOURCE_PATH)
    if content is None:
        return
    try:
        if len(content)>MAX_MXL_METADATA:
            raise ProjectError('metadata exceeds 64 KiB')
        document=_decode_json(content)
        if not isinstance(document,dict) or document.get('format')!=MXL_SOURCE_FORMAT or type(document.get('version')) is not int or document['version'] not in (1,2):
            raise ProjectError('unrecognized source metadata format/version')
        score=_mxl_asset(entries,document.get('score'),'.musicxml',MAX_BYTES)
        candidate={'_import':{'format':'musicxml','source':base64.b64encode(score).decode('ascii')}}
        if document.get('sourceArchive') is not None:candidate['_import']['sourceArchive']=document['sourceArchive']
        expected=_mxl_metadata(candidate,entries)
        if expected!=document:
            raise ProjectError('source metadata contains inconsistent or unsupported fields')
        project['_import']=candidate['_import']
    except (ValueError,TypeError,KeyError,AttributeError,RuntimeError,OverflowError,OSError,ET.ParseError,zipfile.BadZipFile,zlib.error) as exc:
        project.setdefault('import_warnings',[]).append('Original MusicXML source reference was not restored: '+str(exc)[:256]+'. Opaque metadata/archive bytes remain preserved; edited charts are authoritative.')


def _mxl_store(project,entries):
    document=_mxl_metadata(project,entries)
    if document is None:
        return
    score=base64.b64decode(project['_import']['source'],validate=True)
    score_name=document['score']['entry']
    if score_name not in entries:entries[score_name]=score
    previous=entries.get(MXL_SOURCE_PATH)
    if previous is not None:
        probe={};_mxl_restore(probe,entries)
        if '_import' not in probe:
            raise ProjectError('Reserved MusicXML source metadata path contains unrelated, malformed or future-version data; preserve it under another member name before attaching score/archive provenance')
    entries[MXL_SOURCE_PATH]=_json(document)


def _mxl_attach(project,archive,filename):
    if len(archive)>MAX_MXL_ATTACHMENT:
        project.setdefault('import_warnings',[]).append('Original compressed MusicXML archive was not retained because it exceeds the 32 MiB source attachment limit; the original score XML is retained, but the compressed container and other archive members are not.')
        return project
    score=base64.b64decode(project['_import']['source'],validate=True)
    archive_hash=hashlib.sha256(archive).hexdigest();score_hash=hashlib.sha256(score).hexdigest()
    archive_path='editor/musicxml-sources/'+archive_hash+'.mxl';score_path='editor/musicxml-sources/'+score_hash+'.musicxml'
    basename=str(filename).replace('\\','/').rsplit('/',1)[-1][:256]
    basename=''.join(c for c in basename if ord(c)>=32) or 'source.mxl'
    project['_import']['sourceArchive']={'version':1,'filename':basename,'mediaType':'application/vnd.recordare.musicxml','size':len(archive),'sha256':archive_hash,'scoreSha256':score_hash,'entry':archive_path}
    entries=project.setdefault('_pack',{}).setdefault('entries',{})
    for name,content in ((archive_path,archive),(score_path,score)):
        encoded=base64.b64encode(content).decode('ascii')
        if name in entries and entries[name]!=encoded:
            raise ProjectError('Reserved MusicXML source asset path contains conflicting bytes')
        entries[name]=encoded
    _mxl_metadata(project,_mxl_decoded_entries(project))
    return project


def _rsw_reader():
    """R+ Workshop .rsw reader (rsw_reader.py beside this module, read-only)."""
    try:
        from . import rsw_reader
    except ImportError:
        try:
            import rsw_reader
        except ImportError:
            spec=importlib.util.spec_from_file_location('open_chart_editor_rsw_reader',Path(__file__).with_name('rsw_reader.py'))
            rsw_reader=importlib.util.module_from_spec(spec)
            previous=sys.modules.get('pack_io');sys.modules['pack_io']=sys.modules[__name__]
            try:spec.loader.exec_module(rsw_reader)
            finally:
                if previous is None:sys.modules.pop('pack_io',None)
                else:sys.modules['pack_io']=previous
    return rsw_reader


def load_project(data, filename='project.json'):
    if len(data) > MAX_BYTES:
        raise ProjectError('File exceeds the 256 MiB upload limit')
    try:
        if data.startswith(b'PSAR') or filename.lower().endswith('.psarc'):
            raise ProjectError('PSARC packages are not supported; open the song\'s arrangement XML, a FeedPak or a Guitar Pro file instead')
        if filename.lower().endswith('.rsw'):
            return _rsw_reader().load_rsw(data,filename)
        if filename.lower().endswith(('.gp','.gp3','.gp4','.gp5','.gp6','.gpx','.gp7','.gp8')):
            return load_guitarpro(data,filename)
        if data.startswith(b'MThd') or filename.lower().endswith(('.mid','.midi')):
            return load_midi(data,filename)
        if filename.lower().endswith('.mxl'):
            return _mxl_attach(load_musicxml(_unwrap_musicxml(data),filename),data,filename)
        if zipfile.is_zipfile(io.BytesIO(data)):
            return load_feedpak(data)
        if filename.lower().endswith('.xml') or data.lstrip().startswith(b'<'):
            data=_xml_input(data)
            if re.search(br'<vocals(?:\s|>)',data[:10000]):
                return load_vocal_xml(data,filename)
            if b'score-partwise' in data[:10000] or b'score-timewise' in data[:10000] or filename.lower().endswith('.musicxml'):
                return load_musicxml(data,filename)
            return load_xml(data)
        if filename.lower().endswith('.musicxml'):
            return load_musicxml(data,filename)
        return validate_project(_decode_json(data,filename))
    except ProjectError:
        raise
    except (ValueError, KeyError, TypeError, AttributeError, ZeroDivisionError, OverflowError, RuntimeError, struct.error, ET.ParseError, zipfile.BadZipFile, yaml.YAMLError) as exc:
        raise ProjectError(f'Cannot read project: {exc}') from exc


def save_project(project, format='feedpak', arrangement_id=None,*,vocal_only=False):
    validate_project(project)
    if vocal_only and format!='feedpak':raise ProjectError('Vocal-only preview is supported only for Feedpak output')
    name = re.sub(r'[^\w .-]','_',str(project.get('title') or 'Untitled'))[:100].strip('. ') or 'Untitled'
    if format == 'feedpak':
        return save_feedpak(project,vocal_only=vocal_only), name+'.feedpak', 'application/zip'
    if format == 'json':
        encoded=_json(project)
        if any(a.get('midiProgramIntent') for a in project.get('arrangements',[])) and len(encoded)>MAX_BYTES:
            raise ProjectError('Project JSON with MIDI provenance exceeds the 256 MiB reopen limit')
        if isinstance(project.get('_import'),dict) and (project['_import'].get('sourceArchive') or project['_import'].get('sourceRef') or project['_import'].get('format')=='musicxml' and 'source' in project['_import']) and len(encoded)>MAX_BYTES:
            raise ProjectError('Project JSON with retained original source exceeds the 256 MiB reopen limit; reduce embedded assets before saving')
        return encoded, name+'.oce.json', 'application/json'
    if format == 'xml':
        return save_xml(project,arrangement_id), name+'.xml', 'application/xml'
    if format == 'vocal_xml':
        return save_vocal_xml(project), name+'_vocals.xml', 'application/xml'
    raise ProjectError('Export format must be feedpak, json, xml, or vocal_xml')


def _validate_vocal_xml_text(text):
    # XML1.0 fifth edition Char production; native SNG additionally terminates
    # lyrics on NUL. JSON/Feedpak remain able to retain their original text.
    if any(not (ord(c) in (9,10,13) or 0x20<=ord(c)<=0xD7FF or 0xE000<=ord(c)<=0xFFFD or 0x10000<=ord(c)<=0x10FFFF) for c in text):
        raise ProjectError('Vocal text contains a character unsupported by XML1.0/native lyrics (including NUL or forbidden control characters); edit the syllable or keep editable JSON/Feedpak.')


def save_vocal_xml(project):
    validate_project(project)
    for vocal in project.get('vocals',[]):_validate_vocal_xml_text(vocal['text'])
    root=ET.fromstring(project['_vocalXml']) if project.get('_vocalXml') else ET.Element('vocals')
    for child in list(root):
        root.remove(child)
    vocals=sorted(project.get('vocals',[]),key=lambda v:v['time'])
    root.set('count',str(len(vocals)))
    for vocal in vocals:
        element=ET.fromstring(vocal['_xml']) if vocal.get('_xml') else ET.Element('vocal')
        element.attrib.update(time=str(vocal['time']),length=str(vocal['length']),lyric=vocal['text'],note=str(vocal.get('pitch') if vocal.get('pitch') is not None else 60))
        root.append(element)
    ET.indent(root)
    return ET.tostring(root,encoding='utf-8',xml_declaration=True)


def load_vocal_xml(data,filename='Vocals.xml'):
    data=_xml_input(data)
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ProjectError('Vocal XML entity/DTD declarations are unsupported')
    root=ET.fromstring(data)
    if root.tag!='vocals' or any(child.tag!='vocal' for child in root):
        raise ProjectError('Expected native Rocksmith vocal XML containing vocal events')
    if int(root.get('count',len(root)))!=len(root):
        raise ProjectError('Vocal XML count does not match its events')
    vocals=[]
    for i,element in enumerate(root):
        vocal={'id':f'v{i}','time':float(element.get('time','0')),'length':float(element.get('length','0')),'text':element.get('lyric',''),'_xml':ET.tostring(element,encoding='unicode')}
        if element.get('note') is not None:
            vocal['pitch']=int(element.get('note'))
        vocals.append(vocal)
    duration=max((v['time']+v['length'] for v in vocals),default=0)
    _,timeline=_timeline([],[],max(Fraction(str(duration))*2,Fraction(4)))
    return validate_project({'version':1,'title':filename.rsplit('.',1)[0],'artist':'','album':'','duration':duration,'sections':[],'vocals':vocals,'arrangements':[_import_arrangement('vocal-guide','Vocal guide')],**timeline,'_vocalXml':data.decode('utf-8-sig')})


def _timeline(tempo_events,meter_events,end_quarter):
    """Quarter-note positions -> seconds, preserving tempo/meter changes."""
    def unique(events,default):
        result = {Fraction(0):default}
        seen = {}
        for position,value in events:
            position = Fraction(position)
            if position<0:
                raise ProjectError('Tempo/meter events cannot precede the start of the song')
            if position in seen and seen[position] != value:
                raise ProjectError('Conflicting tempo or meter events at the same musical position')
            result[position] = value
            seen[position] = value
        return sorted(result.items())
    tempos = unique(tempo_events,120)
    meters = unique(meter_events,(4,4))
    if any(bpm <= 0 or not math.isfinite(float(bpm)) for _,bpm in tempos):
        raise ProjectError('Tempo must be finite and positive')
    def seconds(quarter):
        quarter = Fraction(quarter)
        total = 0.0
        for i,(position,bpm) in enumerate(tempos):
            if position >= quarter:
                break
            stop = min(quarter,tempos[i+1][0] if i+1<len(tempos) else quarter)
            total += float(stop-position)*60/float(bpm)
        return round(total,9)
    beats=[]
    measure=1
    for i,(start,(numerator,denominator)) in enumerate(meters):
        if numerator <= 0 or denominator <= 0:
            raise ProjectError('Invalid time signature')
        stop=meters[i+1][0] if i+1<len(meters) else max(Fraction(end_quarter),start+4)
        step=Fraction(4,denominator)
        position=start
        index=0
        while position < stop or (i==len(meters)-1 and position == stop):
            if len(beats)>200000:
                raise ProjectError('Tempo map exceeds 200,000 beats')
            beats.append({'time':seconds(position),'measure':measure if index%numerator==0 else -1,'numerator':numerator,'denominator':denominator,'meterStart':index==0})
            index+=1
            if index%numerator==0:
                measure+=1
            position+=step
        if index%numerator:
            measure+=1
    if len(beats)<2:
        beats.append({'time':seconds(Fraction(1)),'measure':-1})
    return seconds, {'beats':beats,'tempos':[{'time':seconds(q),'bpm':float(b)} for q,b in tempos],'time_signatures':[{'time':seconds(q),'ts':list(ts)} for q,ts in meters]}


def _project_signatures(project):
    authored=[]
    previous=None
    for beat in project.get('beats',[]):
        if 'numerator' in beat or 'denominator' in beat:
            signature=(beat.get('numerator',4),beat.get('denominator',4))
            if signature!=previous or beat.get('meterStart'):
                authored.append({'time':beat['time'],'ts':list(signature)})
                previous=signature
    return authored or copy.deepcopy(project.get('time_signatures',[]))


def _beat_quarters(project):
    signatures=sorted(project.get('time_signatures',[]),key=lambda row:row['time'])
    quarters=[0.0]
    for beat in project.get('beats',[])[:-1]:
        active=next((s for s in reversed(signatures) if s['time']<=beat['time']),None)
        denominator=beat.get('denominator',active['ts'][1] if active else 4)
        if not isinstance(denominator,(int,float)) or isinstance(denominator,bool) or not math.isfinite(denominator) or denominator<=0:
            raise ProjectError('Beat map requires valid meter denominators')
        quarters.append(quarters[-1]+4/denominator)
    return quarters


def _annotate_meter(project):
    signatures=sorted(project.get('time_signatures',[]),key=lambda row:row['time'])
    if not signatures:
        return
    index=0
    for beat in project.get('beats',[]):
        while index+1<len(signatures) and signatures[index+1]['time']<=beat['time']:
            index+=1
        signature=signatures[index]
        if signature['time']<=beat['time']:
            beat.update(numerator=signature['ts'][0],denominator=signature['ts'][1],meterStart=abs(beat['time']-signature['time'])<1e-7)


def _import_arrangement(identifier,name,kind='keys',count=6):
    return {'id':identifier,'name':name,'type':kind,'instrument':kind,'stringCount':count,'tuning':[0]*count,'basePitches':BASES.get(kind,[])[:],'capo':0,'notes':[],'chords':[],'chord_templates':[],'anchors':[],'handshapes':[]}


def _midi_stream(data):
    stream={}
    load_midi(data,_program_stream=stream,_apply_programs=False)
    return stream


def load_midi(data,filename='Untitled.mid',*,_program_stream=None,_apply_programs=True):
    """Strict Standard MIDI File 0/1 reader; no external libraries required."""
    if len(data)<14 or data[:4]!=b'MThd':
        raise ProjectError('Expected a Standard MIDI File header')
    size=struct.unpack('>I',data[4:8])[0]
    if size<6 or 8+size>len(data):
        raise ProjectError('Truncated MIDI header')
    format,track_count,division=struct.unpack('>HHH',data[8:14])
    if format not in (0,1):
        raise ProjectError('MIDI format 2 independent sequences are unsupported; export a format 0 or 1 file')
    if division & 0x8000 or not division:
        raise ProjectError('MIDI SMPTE timing is unsupported; export using ticks per quarter note')
    if not track_count or (format==0 and track_count!=1):
        raise ProjectError('Invalid MIDI track count')
    tempos=[]; meters=[]; events=[]; track_names={}; markers=[]; warnings=set(); end_tick=0
    offset=8+size
    program_events=[];program_attacks=[];program_sysex=[]
    event_count=0
    for track in range(track_count):
        if offset+8>len(data) or data[offset:offset+4]!=b'MTrk':
            raise ProjectError(f'Missing MIDI track {track+1}')
        length=struct.unpack('>I',data[offset+4:offset+8])[0]
        offset+=8
        body=data[offset:offset+length]; offset+=length
        if len(body)!=length:
            raise ProjectError('Truncated MIDI track')
        cursor=0; tick=0; running=None; ended=False; source_order=0
        def vlq():
            nonlocal cursor
            value=0
            for _ in range(4):
                if cursor>=len(body):
                    raise ProjectError('Truncated MIDI variable-length integer')
                byte=body[cursor];cursor+=1;value=(value<<7)|(byte&127)
                if not byte&128:
                    return value
            raise ProjectError('MIDI variable-length integer exceeds four bytes')
        while cursor<len(body):
            source_order+=1
            event_count+=1
            if event_count>1000000:
                raise ProjectError('MIDI file exceeds one million events')
            tick+=vlq();end_tick=max(end_tick,tick)
            if cursor>=len(body):
                raise ProjectError('Truncated MIDI event')
            status=body[cursor]
            if status&128:
                cursor+=1
                if status<0xf0:
                    running=status
            elif running is not None:
                status=running
            else:
                raise ProjectError('MIDI running status has no preceding channel event')
            if status==0xff:
                running=None
                if cursor>=len(body):
                    raise ProjectError('Truncated MIDI meta-event')
                kind=body[cursor];cursor+=1;n=vlq();payload=body[cursor:cursor+n];cursor+=n
                if len(payload)!=n:
                    raise ProjectError('Truncated MIDI meta-event payload')
                if kind==0x51:
                    if n!=3 or int.from_bytes(payload,'big')==0:
                        raise ProjectError('Invalid MIDI tempo event')
                    tempos.append((Fraction(tick,division),Fraction(60000000,int.from_bytes(payload,'big'))))
                elif kind==0x58:
                    if n!=4 or payload[1]>7:
                        raise ProjectError('Unsupported MIDI time signature')
                    meters.append((Fraction(tick,division),(payload[0],2**payload[1])))
                elif kind==3:
                    track_names[track]=payload.decode('utf-8',errors='replace')
                elif kind in (6,7):
                    markers.append((tick,payload.decode('utf-8',errors='replace')))
                elif kind==0x2f:
                    if n or cursor!=len(body):
                        raise ProjectError('Unexpected data after MIDI end-of-track')
                    ended=True;break
                elif kind not in (0,1,2,4,5,0x20,0x21,0x59):
                    warnings.add(f'MIDI metadata event 0x{kind:02x} is retained only in the original source')
            elif status in (0xf0,0xf7):
                running=None;n=vlq()
                if cursor+n>len(body):
                    raise ProjectError('Truncated MIDI system-exclusive event')
                payload=body[cursor:cursor+n]
                program_sysex.append({'tick':tick,'sourceTrack':track,'order':source_order,'status':status,'sha256':hashlib.sha256(payload).hexdigest(),'size':n})
                if len(program_events)+len(program_sysex)>_midi_programs.MAX_EVENTS:raise ProjectError('MIDI program/bank/SysEx event budget exceeded')
                cursor+=n;warnings.add('MIDI system-exclusive messages are retained only in the original source')
            elif 0x80<=status<0xf0:
                command=status>>4;channel=status&15;n=1 if command in (12,13) else 2
                payload=body[cursor:cursor+n];cursor+=n
                if len(payload)!=n or any(v>127 for v in payload):
                    raise ProjectError('Malformed MIDI channel event')
                address={'tick':tick,'sourceTrack':track,'channel':channel,'order':source_order}
                if command in (8,9):
                    events.append((tick,track,channel,payload[0],payload[1] if command==9 else 0))
                    if command==9 and payload[1]:program_attacks.append(address)
                elif command==12:
                    program_events.append({**address,'kind':'program','value':payload[0]})
                elif command==11 and payload[0] in (0,32):
                    program_events.append({**address,'kind':'bank_msb' if payload[0]==0 else 'bank_lsb','value':payload[1]})
                else:
                    warnings.add('MIDI controller, pressure and pitch-bend expression is retained in source but not applied to chart notes')
                if len(program_events)+len(program_sysex)>_midi_programs.MAX_EVENTS:
                    raise ProjectError('MIDI program/bank/SysEx event budget exceeded')
            else:
                raise ProjectError(f'Unsupported MIDI status 0x{status:02x}')
        if not ended:
            raise ProjectError('MIDI track has no end-of-track event')
    if offset!=len(data):
        raise ProjectError('Unexpected bytes after MIDI tracks')
    seconds,timeline=_timeline(tempos,meters,Fraction(end_tick,division))
    for event in program_events+program_sysex:event['time']=seconds(Fraction(event['tick'],division))
    stream={'format':format,'division':division,'trackCount':track_count,'noteTracks':sorted({(event['sourceTrack'],event['channel']) for event in program_attacks}),'events':program_events,'attacks':program_attacks,'sysex':program_sysex}
    if _program_stream is not None:_program_stream.update(stream)
    pending={}; completed=[]
    for tick,track,channel,pitch,velocity in sorted(events,key=lambda e:e[0]):
        key=(track,channel,pitch)
        if velocity:
            pending.setdefault(key,[]).append((tick,velocity))
        else:
            active=pending.get(key,[])
            if not active:
                raise ProjectError(f'MIDI note-off without note-on: track {track+1}, channel {channel+1}, pitch {pitch}')
            start,attack=active.pop(0)
            completed.append((track,channel,pitch,start,tick,attack))
    if any(pending.values()):
        raise ProjectError('MIDI has unfinished notes; add matching note-off events before importing')
    arrangements={}
    for track,channel,pitch,start,stop,velocity in completed:
        key=(track,channel)
        if key not in arrangements:
            name=track_names.get(track,f'Track {track+1}')
            arrangements[key]=_import_arrangement(f'midi-{track}-{channel}',f'{name} · channel {channel+1}','drums' if channel==9 else 'keys')
            arrangements[key].update(sourceTrack=track,sourceChannel=channel)
            if channel!=9:arrangements[key]['instrument']=pitched_instrument(name)
        arr=arrangements[key]
        note={'id':f'n{len(arr["notes"])}','time':seconds(Fraction(start,division)),'sustain':round(seconds(Fraction(stop,division))-seconds(Fraction(start,division)),9),'string':pitch//24,'fret':pitch%24,'pitch':pitch,'velocity':velocity,'channel':channel,'techniques':{}}
        if channel==9:
            if pitch not in MIDI_DRUMS:
                raise ProjectError(f'MIDI drum pitch {pitch} has no supported FeedBack piece mapping; remap that percussion note before importing')
            note.update(piece=MIDI_DRUMS[pitch],sustain=0)
        else:
            label=track_names.get(track,'').lower()
            hand='lh' if re.search(r'\b(left|lh)\b',label) else 'rh' if re.search(r'\b(right|rh)\b',label) else ('lh' if pitch<60 else 'rh')
            note['hand']=hand
            warnings.add('MIDI keyboard hand assignment is inferred from track names or the middle-C split; check it after import')
        arr['notes'].append(note)
    if not arrangements:
        arrangements[(0,0)]=_import_arrangement('midi-tempo','MIDI tempo map')
    project={'version':1,'title':filename.rsplit('.',1)[0].split('/')[-1].split('\\')[-1],'artist':'','album':'','duration':max(seconds(Fraction(end_tick,division)),timeline['beats'][-1]['time']),'sections':[{'name':name,'number':i+1,'start_time':seconds(Fraction(t,division))} for i,(t,name) in enumerate(markers)],'arrangements':list(arrangements.values()),**timeline,'import_warnings':sorted(warnings),'_import':{'format':'midi','source':base64.b64encode(data).decode('ascii')}}
    if _apply_programs:project=_midi_call(_midi_programs.decorate,project,data,stream)['project']
    return validate_project(project)


def _unwrap_musicxml(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos=archive.infolist()
        if len(infos)>MAX_MEMBERS or sum(i.file_size for i in infos)>MAX_BYTES:
            raise ProjectError('Compressed MusicXML exceeds the uncompressed size limit')
        names={_path(i.filename):i for i in infos if not i.is_dir()}
        if 'META-INF/container.xml' not in names:
            raise ProjectError('Compressed MusicXML has no META-INF/container.xml')
        container=ET.fromstring(_xml_input(archive.read('META-INF/container.xml')))
        roots=[n for n in container.iter() if n.tag.rsplit('}',1)[-1]=='rootfile']
        if not roots:
            raise ProjectError('Compressed MusicXML declares no rootfile')
        name=_path(roots[0].get('full-path',''))
        if name not in names:
            raise ProjectError('Compressed MusicXML rootfile is missing')
        return archive.read(name)


def load_musicxml(data,filename='Untitled.musicxml'):
    try:
        return _load_musicxml(data,filename)
    except _musicxml_dynamics.DynamicsError as exc:
        raise ProjectError(str(exc)) from exc


def _load_musicxml(data,filename='Untitled.musicxml'):
    """Multi-part score import with exact quarter positions and sounding pitch.

    Repeat navigation, grace timing and unspecified unpitched instruments are
    rejected explicitly. Layout/engraving stays in the retained source document.
    """
    data=_xml_input(data)
    if b'<!ENTITY' in data.upper() or re.search(br'<!DOCTYPE[^>]*\[',data,re.I):
        raise ProjectError('MusicXML internal DTD/entity declarations are unsupported')
    root=ET.fromstring(data)
    for node in root.iter():
        node.tag=node.tag.rsplit('}',1)[-1]
    if root.tag!='score-partwise':
        raise ProjectError('Only score-partwise MusicXML is supported; convert score-timewise before import')
    for tag in ('repeat','ending','segno','coda','grace','measure-repeat','octave-shift'):
        if root.find('.//'+tag) is not None:
            raise ProjectError(f'MusicXML <{tag}> playback is unsupported; expand or resolve it before import')
    for sound in root.findall('.//sound'):
        if any(name in sound.attrib for name in ('dacapo','dalsegno','tocoda','fine')):
            raise ProjectError('MusicXML navigation playback is unsupported; expand repeats/navigation before import')
    parts=root.findall('part')
    if not parts:
        raise ProjectError('MusicXML score contains no parts')
    names={p.get('id'):p.findtext('part-name',p.get('id','Part')) for p in root.findall('./part-list/score-part')}
    drum_map={};part_programs={}
    for part in root.findall('./part-list/score-part'):
        for instrument in part.findall('midi-instrument'):
            pitch=instrument.findtext('midi-unpitched')
            if pitch:
                drum_map[(part.get('id'),instrument.get('id'))]=int(pitch)-1
        # First <midi-instrument><midi-program> is the part's nominal GM voice; MusicXML
        # numbers it 1-128. A part can carry further per-note instrument assignments (used
        # above only for unpitched percussion mapping); this stays a single part-level intent,
        # matching the editor's "never a patch-bank emulator" guide-voice approximation.
        program=part.findtext('midi-instrument/midi-program')
        if program is not None and program.strip().lstrip('-').isdigit():
            value=int(program.strip())-1
            if 0<=value<=127:
                part_programs[part.get('id')]=value
    tempo_events=[]; meter_events=[]; arrangements=[]; raw_notes=[]; sections=[]; warnings=set(); dynamics_contexts=[]; dynamics_events=0; end_quarter=Fraction(0)
    for part_index,part in enumerate(parts):
        pid=part.get('id',f'part-{part_index}')
        name=names.get(pid,pid)
        tab=part.find('.//technical/string') is not None
        unpitched=part.find('.//unpitched') is not None
        kind='drums' if unpitched else ('bass' if 'bass' in name.lower() else 'guitar') if tab else 'keys'
        count=4 if kind=='bass' else 6
        lines=part.findtext('.//staff-details/staff-lines')
        if tab and lines:
            count=int(lines)
        arr=_import_arrangement(f'mxml-{part_index}',name,kind,count)
        arr['sourceInstrument']=name
        if kind!='drums' and pid in part_programs:
            arr['sourceProgram']=part_programs[pid]
        fifths=part.findtext('.//attributes/key/fifths')
        if fifths is not None and fifths.strip().lstrip('-').isdigit() and -7<=int(fifths)<=7:
            arr['keySignature']={'fifths':int(fifths),'minor':(part.findtext('.//attributes/key/mode') or '').strip().lower()=='minor'}
        if kind=='keys':
            arr['instrument']=pitched_instrument(name,part_programs.get(pid))
        arrangements.append(arr)
        dynamics=_musicxml_dynamics.NumericDynamics(pid,kind,event_limit=_musicxml_dynamics.MAX_EVENTS)
        dynamics_contexts.append(dynamics)
        divisions=Fraction(1); measure_start=Fraction(0); meter=(4,4); transpose=0; pending_ties={}; pending_slides={}
        for measure_index,measure in enumerate(part.findall('measure')):
            cursor=measure_start; maximum=measure_start; previous_start=None
            for child in measure:
                if child.tag=='attributes':
                    value=child.findtext('divisions')
                    if value:
                        divisions=Fraction(value)
                        if divisions<=0:
                            raise ProjectError('MusicXML divisions must be positive')
                    time=child.find('time')
                    if time is not None:
                        beats=time.findtext('beats','4'); beat_type=time.findtext('beat-type','4')
                        if '+' in beats or len(time.findall('beats'))>1:
                            raise ProjectError('Additive/composite MusicXML time signatures are unsupported; simplify the meter first')
                        meter=(int(beats),int(beat_type));meter_events.append((cursor,meter))
                    trans=child.find('transpose')
                    if trans is not None:
                        transpose=int(trans.findtext('chromatic','0'))+12*int(trans.findtext('octave-change','0'))
                elif child.tag in ('backup','forward'):
                    delta=Fraction(child.findtext('duration','0'))/divisions
                    cursor+=delta*(-1 if child.tag=='backup' else 1)
                    if cursor<measure_start:
                        raise ProjectError('MusicXML backup moves before the measure start')
                    maximum=max(maximum,cursor)
                elif child.tag=='direction':
                    for dynamic_sound in child.findall('sound'):
                        if dynamic_sound.get('dynamics') is not None:
                            dynamics_events+=1
                            if dynamics_events>_musicxml_dynamics.MAX_EVENTS:
                                raise ProjectError('MusicXML numeric dynamics exceed the aggregate project event limit')
                            dynamics.add_sound(dynamic_sound,cursor,divisions,direction=child)
                    position=cursor+Fraction(child.findtext('offset','0'))/divisions
                    sound=child.find('sound')
                    metronome=child.find('.//metronome')
                    bpm=sound.get('tempo') if sound is not None else None
                    if bpm:
                        # Explicit sound tempo follows playback offsets. Keep
                        # visual metronome/rehearsal placement separate below.
                        playback=_musicxml_dynamics.playback_position(sound,cursor,divisions,direction=child)
                        tempo_events.append((playback,Fraction(bpm)))
                    elif metronome is not None:
                        units={'whole':4,'half':2,'quarter':1,'eighth':Fraction(1,2),'16th':Fraction(1,4)}
                        unit=metronome.findtext('beat-unit','quarter')
                        if unit not in units or metronome.find('per-minute') is None:
                            raise ProjectError('Unsupported MusicXML metronome marking')
                        dots=len(metronome.findall('beat-unit-dot'))
                        multiplier=sum((Fraction(1,2**i) for i in range(dots+1)),Fraction(0))
                        tempo_events.append((position,Fraction(metronome.findtext('per-minute'))*units[unit]*multiplier))
                    rehearsal=child.findtext('.//rehearsal')
                    if rehearsal and part_index==0:
                        sections.append((position,rehearsal))
                    if child.find('.//pedal') is not None:
                        warnings.add('MusicXML pedal markings are retained in the source; chart sustain follows authored note durations')
                elif child.tag=='sound':
                    if child.get('dynamics') is not None:
                        dynamics_events+=1
                        if dynamics_events>_musicxml_dynamics.MAX_EVENTS:
                            raise ProjectError('MusicXML numeric dynamics exceed the aggregate project event limit')
                        dynamics.add_sound(child,cursor,divisions)
                    if child.get('tempo'):
                        playback=_musicxml_dynamics.playback_position(child,cursor,divisions)
                        tempo_events.append((playback,Fraction(child.get('tempo'))))
                elif child.tag=='note':
                    if child.find('duration') is None:
                        raise ProjectError('MusicXML note/rest has no duration')
                    duration=Fraction(child.findtext('duration'))/divisions
                    if duration<0:
                        raise ProjectError('MusicXML note duration must be nonnegative')
                    chord=child.find('chord') is not None
                    if chord and previous_start is None:
                        raise ProjectError('MusicXML chord note has no preceding note')
                    start=previous_start if chord else cursor
                    previous_start=start
                    if not chord:
                        cursor+=duration
                    maximum=max(maximum,start+duration,cursor)
                    if child.find('rest') is not None:
                        continue
                    staff=child.findtext('staff','1'); voice=child.findtext('voice','1')
                    technical=child.find('./notations/technical')
                    tech={}
                    for tag,canonical in [('hammer-on','hammer_on'),('pull-off','pull_off'),('harmonic','harmonic'),('tap','tap')]:
                        if technical is not None and technical.find(tag) is not None:
                            tech[canonical]=True
                    if child.find('./notations/articulations/accent') is not None:
                        tech['accent']=True
                    record={'id':f'n{len(raw_notes)}','techniques':tech,'hand':'lh' if staff=='2' else 'rh','staff':staff,'voice':voice}
                    if child.find('unpitched') is not None:
                        instrument=child.find('instrument')
                        iid=instrument.get('id') if instrument is not None else None
                        candidates=[pitch for (part_id,_),pitch in drum_map.items() if part_id==pid]
                        pitch=drum_map.get((pid,iid),candidates[0] if len(candidates)==1 else None)
                        if pitch not in MIDI_DRUMS:
                            raise ProjectError(f'MusicXML unpitched note in {name} lacks a supported midi-unpitched percussion mapping')
                        record.update(piece=MIDI_DRUMS[pitch],pitch=pitch,velocity=100,string=0,fret=0)
                    else:
                        pitch_node=child.find('pitch')
                        if pitch_node is None:
                            raise ProjectError('MusicXML note has neither a pitch nor an unpitched instrument')
                        steps={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
                        step=pitch_node.findtext('step');alter=Fraction(pitch_node.findtext('alter','0'))
                        if step not in steps or alter.denominator!=1:
                            raise ProjectError('Microtonal MusicXML pitches are unsupported')
                        pitch=12*(int(pitch_node.findtext('octave'))+1)+steps[step]+int(alter)+transpose
                        if not 0<=pitch<=127:
                            raise ProjectError('MusicXML sounding pitch is outside MIDI range')
                        if kind=='drums':
                            raise ProjectError('MusicXML mixes pitched and unpitched notes in one part; split that part before import')
                        if tab:
                            if technical is None or technical.find('string') is None or technical.find('fret') is None:
                                raise ProjectError(f'Tablature part {name} has a note without string/fret technical data')
                            record.update(string=count-int(technical.findtext('string')),fret=int(technical.findtext('fret')),pitch=pitch)
                        else:
                            record.update(string=pitch//24,fret=pitch%24,pitch=pitch)
                    # A <slide> or <glissando> from one tab note to the next on the same string is a
                    # pitched slide to that note's fret. Stops are read before starts: a note can do both.
                    if tab:
                        marks=child.findall('./notations/slide')+child.findall('./notations/glissando')
                        for mark in sorted(marks,key=lambda m:m.get('type')!='stop'):
                            slot=(staff,voice,mark.get('number','1'))
                            if mark.get('type')=='stop':
                                origin=pending_slides.pop(slot,None)
                                if origin is None:continue
                                if origin['string']==record['string'] and origin['fret']!=record['fret']:origin['techniques']['slide_to']=record['fret']
                                else:warnings.add(f'{name}: a slide that changes string (or keeps its fret) was left as plain notes')
                            elif mark.get('type')=='start':
                                pending_slides[slot]=record
                    ties={t.get('type') for t in child.findall('tie')+child.findall('./notations/tied')}
                    key=(staff,voice,record['pitch'])
                    if 'stop' in ties:
                        previous=pending_ties.get(key)
                        if previous is None or previous[2]!=start:
                            raise ProjectError('MusicXML tie stop has no contiguous matching tie start')
                        previous[2]=start+duration
                        if 'start' not in ties:
                            del pending_ties[key]
                    else:
                        entry=[record,start,start+duration,arr]
                        raw_notes.append(entry)
                        if 'start' in ties:
                            pending_ties[key]=entry
                elif child.tag not in ('print','barline','harmony'):
                    warnings.add(f'MusicXML <{child.tag}> is retained only in the original source')
            actual=maximum-measure_start
            nominal=Fraction(meter[0]*4,meter[1])
            measure_start=maximum if measure.get('implicit')=='yes' or actual<nominal and measure_index==0 else max(maximum,measure_start+nominal)
            end_quarter=max(end_quarter,measure_start)
        if pending_ties:
            raise ProjectError(f'MusicXML part {name} contains unfinished ties')
        if pending_slides:
            warnings.add(f'{name}: {len(pending_slides)} slide{"s" if len(pending_slides)>1 else ""} with no end note left as plain notes')
    _musicxml_dynamics.validate_collection(dynamics_contexts)
    # First attacks survive tie merging. Resolve after all events are known, so
    # backup/forward and chord serialization order never become playback order.
    by_arr={id(arr):[] for arr in arrangements}
    for index,entry in enumerate(raw_notes):
        by_arr[id(entry[3])].append(index)
    planned=[]
    for arr,dynamics in zip(arrangements,dynamics_contexts):
        indices=by_arr[id(arr)]
        if dynamics.events:
            result=dynamics.apply([raw_notes[i][0] for i in indices],[raw_notes[i][1] for i in indices])
            planned.extend((i,note) for i,note in zip(indices,result.notes))
    for index,note in planned:
        raw_notes[index][0]=note
    warnings.update(_musicxml_dynamics.aggregate_warnings(dynamics_contexts,extra=_musicxml_dynamics.expression_warnings(root)))
    seconds,timeline=_timeline(tempo_events,meter_events,end_quarter)
    for note,start,stop,arr in raw_notes:
        note.update(time=seconds(start),sustain=0 if arr['type']=='drums' else round(seconds(stop)-seconds(start),9))
        arr['notes'].append(note)
    warnings.add('MusicXML layout, notation symbols and engraving are retained in the source; import renders timed notes, hands, basic techniques and the tempo map')
    project={'version':1,'title':root.findtext('./work/work-title') or root.findtext('movement-title') or filename.rsplit('.',1)[0],'artist':root.findtext('./identification/creator',''),'album':'','duration':seconds(end_quarter),'sections':[{'name':name,'number':i+1,'start_time':seconds(q)} for i,(q,name) in enumerate(sections)],'arrangements':arrangements,**timeline,'import_warnings':sorted(warnings),'_import':{'format':'musicxml','source':base64.b64encode(data).decode('ascii')}}
    _mxl_apply_programs(project)
    return validate_project(project)


def _mxl_apply_programs(project):
    """Bind each part's nominal <midi-program> as an approximate GM source rig,
    mirroring midi_programs.decorate()'s explicit-fallback contract. MusicXML
    carries one static program per part rather than MIDI's mid-track program
    timeline, so (unlike MIDI) no raw per-event provenance needs to be retained
    for re-validation: once bound, tones.base_rig is ordinary authored chart
    data, already content-addressed and restored by _mxl_store/_mxl_restore via
    the single shared score reference. An existing authored tone/guide binding
    is always left alone.
    """
    programs=sorted({arr['sourceProgram'] for arr in project['arrangements'] if 'sourceProgram' in arr})
    if not programs:return
    rigs={'version':1,'rigs':[]};rig_by_program={}
    for program in programs:
        identifier='oce-mxml-gm-'+str(program);rig_by_program[program]=identifier
        rigs['rigs'].append({'id':identifier,'name':f'Approximate GM program {program}','blocks':[{'role':'source','intent':{'kind':'instrument','family':_midi_programs.FAMILIES[program//8],'gm':{'program':program}}}]})
    bound=[]
    for arr in project['arrangements']:
        program=arr.get('sourceProgram')
        if program is None or arr.get('tones') or 'guideVoice' in arr:continue
        arr['tones']={'base':f'Approximate GM program {program}','base_rig':rig_by_program[program],'changes':[]}
        arr['musicXmlProgramIntent']={'version':1,'program':program}
        bound.append(arr['id'])
    if not bound:return
    content=_json(rigs)
    pack=project.setdefault('_pack',{});entries=pack.setdefault('entries',{});manifest=pack.setdefault('manifest',{})
    name=_midi_programs._free(entries,'editor/oce-mxml-rigs','.json',content)
    manifest['rigs']=name;project['rigLibrary']=rigs
    project.setdefault('import_warnings',[]).append(_midi_programs.GM_WARNING.replace('Imported MIDI program numbers','Imported MusicXML <midi-program> values'))


def _gpif_capo_metadata(root,raw_tracks,tracks):
    """Original uniform-capo adapter; strict bounds are editor policy.

    Recognized track/staff property order follows the public alphaTab reader.
    Source tuning and relative frets remain unchanged; no converter code copied.
    """
    if len(raw_tracks)!=len(tracks):raise ProjectError('GPIF track metadata does not match the public converter track list')
    if root.find('./Tracks/Track//Property[@name="CapoFret"]') is None:
        # Legacy scores without this property retain their previous zero-capo
        # import behavior; do not impose new provenance requirements on them.
        return [{'trackId':raw.get('id',''),'present':False,'staffCapos':[0],'converterStaves':raw.get('num_staves',1),'stavePitches':raw.get('stave_pitches',[])} for raw in raw_tracks]
    originals=list(root.findall('./Tracks/Track'));seen=set();result=[]
    for index,(raw,info) in enumerate(zip(raw_tracks,tracks)):
        track=raw.get('_el');identifier=raw.get('id')
        if track not in originals or not isinstance(identifier,str) or not identifier or len(identifier)>1024 or identifier in seen or track.get('id')!=identifier or info.get('index')!=index or info.get('name')!=raw.get('name'):
            raise ProjectError('GPIF source track identity/order is ambiguous; capo metadata cannot be assigned safely')
        seen.add(identifier);capos=[0];recognized=set();present=False
        def ensure(count):
            if count>128:raise ProjectError('GPIF capo metadata exceeds the 128-staff limit')
            capos.extend([0]*max(0,count-len(capos)))
        def read(properties,indices):
            nonlocal present
            for prop in properties.findall('Property'):
                if prop.get('name')!='CapoFret':continue
                present=True;recognized.add(id(prop));nodes=prop.findall('Fret')
                text=(nodes[0].text or '').strip() if len(nodes)==1 else ''
                if re.fullmatch('[+]?[0-9]+',text) is None or len(text)>4 or not 0<=int(text)<=24:
                    raise ProjectError('GPIF CapoFret/Fret must be one integer between0 and24; original source is unchanged')
                for target in indices:capos[target]=int(text)
        for child in track:
            if child.tag=='Instrument' and (child.get('ref','').endswith('-gs') or child.get('ref','').endswith('GrandStaff')):ensure(2)
            elif child.tag=='Properties':read(child,range(len(capos)))
            elif child.tag=='Staves':
                for staff_index,staff in enumerate(child.findall('Staff')):
                    ensure(staff_index+1)
                    for properties in staff.findall('Properties'):read(properties,[staff_index])
        if any(id(prop) not in recognized for prop in track.findall('.//Property[@name="CapoFret"]')):
            raise ProjectError('GPIF CapoFret appears outside supported track/staff Properties; assign capo manually from the retained original')
        result.append({'trackId':identifier,'present':present,'staffCapos':capos,'converterStaves':raw.get('num_staves',1),'stavePitches':raw.get('stave_pitches',[])})
    return result


def _resolve_chord_string_clashes(root,open_pitches):
    """Make every converted chord playable: one note per string.

    A note sharing a string with an earlier chord member moves to a free string
    that sounds the same pitch; unisons and notes with no free string are left
    out. Frets stay capo-relative, as converted. Returns (moved, dropped).
    """
    moved=dropped=0
    for chord in root.iter('chord'):
        used=set()
        for note in list(chord.findall('chordNote')):
            string,fret=int(note.get('string',0)),int(note.get('fret',0))
            if string not in used:
                used.add(string);continue
            pitch=open_pitches[string]+fret if 0<=string<len(open_pitches) else None
            sounding={open_pitches[int(n.get('string'))]+int(n.get('fret')) for n in chord.findall('chordNote') if n is not note and int(n.get('string'))<len(open_pitches)}
            free=[s for s in range(len(open_pitches)) if s not in used and pitch is not None and 0<=pitch-open_pitches[s]<=24]
            if pitch is None or pitch in sounding or not free:
                chord.remove(note);dropped+=1;continue
            target=min(free,key=lambda s:abs(pitch-open_pitches[s]-fret))
            note.set('string',str(target));note.set('fret',str(pitch-open_pitches[target]));used.add(target);moved+=1
    return moved,dropped


def _gpif_note_repairs(gpx):
    """Worker-local repairs for GPIF note encodings the public converter misreads.

    Evidence-gated per file: Tone steps are chromatic (0..11) when any step
    exceeds 6, and Guitar Pro omits a zero Tone, so an Octave-only note is C.
    Pitch-only notes on string-tuned tracks get a playable string/fret, and
    drum notes with no kit mapping become numbered lanes to label later.
    Returns {raw track index: counts}; the converter itself is not modified.
    """
    report={};overrides={};roots=[]  # roots stay alive so element ids are never reused
    original_load,original_midi=gpx._load_gpif,gpx._note_midi
    def properties(note):return {p.get('name'):p for p in note.findall('.//Property')}
    def integer(prop,tag,default=0):
        try:return int(prop.findtext(tag) or default) if prop is not None else default
        except ValueError:return None
    def drum_key(p,pitches):
        # Lane for a drum note the converter can't map; (-1,-1) means the note names no piece at all.
        if 'String' in p and 'Fret' in p and not pitches:return (integer(p['String'],'String'),integer(p['Fret'],'Fret'))
        if not any(name in p for name in ('String','Fret','Tone','Octave','Element')):return (-1,-1)
        return None
    def load(path):
        root=original_load(path);roots.append(root)
        children=lambda tag:list(root.find(tag)) if root.find(tag) is not None else []
        # GP6 grand-staff instruments (ref *-gs) own two bar columns without a
        # <Staves> element; the converter counts one and shifts later tracks.
        grand=[t for t in children('Tracks') if t.find('Staves') is None and t.find('Instrument') is not None and t.find('Instrument').get('ref','').endswith(('-gs','GrandStaff'))]
        widths=[max(1,len(t.findall('Staves/Staff'))) for t in children('Tracks')]
        if grand and all(len((mb.findtext('Bars') or '').split())==sum(widths)+len(grand) for mb in children('MasterBars')):
            for track in grand:
                staves=ET.SubElement(track,'Staves');ET.SubElement(staves,'Staff');ET.SubElement(staves,'Staff')
            report['grandStaves']=[t.findtext('Name') for t in grand]
        tracks=gpx._gpif_tracks(root)
        bars={b.get('id'):b for b in children('Bars')};voices={v.get('id'):v for v in children('Voices')}
        beats={b.get('id'):b for b in children('Beats')};notes=gpx._notes_by_id(root)
        columns=[(mb.findtext('Bars') or '').split() for mb in children('MasterBars')]
        def track_beats(stave_columns):
            for row in columns:
                for column in stave_columns:
                    bar=bars.get(row[column]) if column<len(row) else None
                    for voice in (bar.findtext('Voices') or '').split() if bar is not None else []:
                        for beat in (voices[voice].findtext('Beats') or '').split() if voice in voices else []:
                            yield [notes[n] for n in (beats[beat].findtext('Notes') or '').split() if beat in beats and n in notes]
        chromatic=any((integer(p,'Step') or 0)>6 for note in notes.values() for p in [properties(note).get('Tone')] if p is not None)
        for index,track in enumerate(tracks):
            counts={'name':track['name'],'pitchFixed':0,'toneDefaulted':0,'tabFilled':0,'tabUnplaced':0,'drumLanes':{}}
            pitches=track['string_pitches'];hand=None;last={};seen=set()
            for group in track_beats(track['stave_columns']):
                used=set()
                for note in group:
                    p=properties(note)
                    if 'String' in p and 'Fret' in p:used.add(integer(p['String'],'String'))
                for note in group:
                    if id(note) in seen:continue
                    seen.add(id(note));p=properties(note)
                    if note.find('InstrumentArticulation') is not None or 'Element' in p:continue
                    if track['is_drums']:
                        key=drum_key(p,pitches)
                        if key and None not in key:counts['drumLanes'].setdefault(key,note)
                        continue
                    if 'String' in p and 'Fret' in p or 'Octave' not in p or not chromatic:continue
                    step=integer(p.get('Tone'),'Step');octave=integer(p['Octave'],'Number')
                    if step is None or octave is None:continue
                    counts['toneDefaulted']+='Tone' not in p;midi=octave*12+step
                    if not pitches:overrides[id(note)]=midi;counts['pitchFixed']+=1;continue
                    tied=note.find('Tie') is not None and note.find('Tie').get('destination')=='true'
                    options=[(s,midi-open) for s,open in enumerate(pitches) if s not in used and 0<=midi-open<=24]
                    if tied and last.get(midi) in options:choice=last[midi]
                    elif options:choice=min(options,key=lambda o:(o[1] if hand is None else abs(o[1]-hand) if o[1] else 2,o[1]))
                    else:counts['tabUnplaced']+=1;continue
                    holder=note.find('Properties')
                    if holder is None:holder=ET.SubElement(note,'Properties')
                    for name,value in (('String',choice[0]),('Fret',choice[1])):
                        ET.SubElement(ET.SubElement(holder,'Property',name=name),name).text=str(value)
                    used.add(choice[0]);last[midi]=choice;counts['tabFilled']+=1
                    if choice[1]:hand=choice[1] if hand is None else (hand+choice[1])/2
            # Lane codes follow sorted source string/fret so labels are stable.
            lanes=sorted(counts['drumLanes'])
            counts['drumLanes']={code:list(key) for code,key in enumerate(lanes,1)}
            codes={key:code for code,key in enumerate(lanes,1)}
            for group in track_beats(track['stave_columns']) if lanes else []:
                for note in group:
                    p=properties(note)
                    key=drum_key(p,track['string_pitches'])
                    if key in codes and note.find('InstrumentArticulation') is None and 'Element' not in p:overrides[id(note)]=codes[key]
            if any(counts[k] for k in ('pitchFixed','tabFilled','tabUnplaced','drumLanes')):report[index]=counts
        return root
    def note_midi(note_el,*args,**kwargs):
        return overrides[id(note_el)] if id(note_el) in overrides else original_midi(note_el,*args,**kwargs)
    gpx._load_gpif,gpx._note_midi=load,note_midi
    return report


def _gp_worker(request):
    """Isolated adapter over installed public converters; never runs in host process."""
    import logging
    import types
    core=Path(request['core']).resolve()
    sys.path.insert(0,str(core))
    # The host's optional defusedxml isn't installed in every Python runtime.
    # This process-local adapter uses our normalized declaration guard instead.
    safe=types.ModuleType('safe_xml')
    safe.ParseError=ET.ParseError
    safe.safe_fromstring=lambda text:ET.fromstring(_xml_input(text.encode('utf-8') if isinstance(text,str) else text))
    safe.safe_parse=lambda source:ET.ElementTree(safe.safe_fromstring(Path(source).read_bytes()))
    sys.modules['safe_xml']=safe
    warnings=[]
    class Capture(logging.Handler):
        def emit(self,record):
            if len(warnings)<500:warnings.append(record.getMessage())
    logging.getLogger().addHandler(Capture(level=logging.WARNING))
    import gp2rs
    import gp2rs_gpx
    repairs=_gpif_note_repairs(gp2rs_gpx)
    source=Path(request['source'])
    tracks=gp2rs.list_tracks(str(source))
    if not tracks or len(tracks)>128:
        raise ProjectError('Guitar Pro import requires between one and128 tracks')
    binary=None;gpif_capos=None
    if source.suffix not in ('.gp','.gpx'):
        import guitarpro
        binary=guitarpro.parse(str(source))
        source_pitches=[[int(s.value) for s in reversed(track.strings)] for track in binary.tracks]
    else:
        gpif=gp2rs_gpx._load_gpif(str(source))
        raw_tracks=gp2rs_gpx._gpif_tracks(gpif)
        gpif_capos=_gpif_capo_metadata(gpif,raw_tracks,tracks)
        source_pitches=[]
        for track in raw_tracks:
            pitches=[int(p) for p in track['string_pitches']]
            physical=list(reversed(pitches)) if len(pitches)>1 and pitches[0]>pitches[-1] else pitches
            if physical!=sorted(physical):raise ProjectError('Non-monotonic GPIF string tunings need manual mapping; the installed converter ranks open strings by pitch')
            source_pitches.append(physical)
    result=[];total=0
    for info in tracks:
        index=info['index'];program=info.get('instrument',-1)
        kind='vocals' if info.get('is_vocal') else 'drums' if info.get('is_drums') else 'bass' if info.get('is_bass') else 'keys' if info.get('is_piano') or program>=40 or not info.get('strings') else 'guitar'
        if kind in ('guitar','bass') and not source_pitches[index]:
            # e.g. synth bass (GM program 38): bass by program, but no strings to fret.
            warnings.append(f'{str(info["name"])[:256]}: no string tuning in the source, so it was imported as a pitched (piano roll) part')
            kind='keys'
        role='bass' if kind=='bass' else 'rhythm' if 'rhythm' in info['name'].lower() else 'lead'
        name={'keys':'Keys','drums':'Drums','vocals':'Vocals'}.get(kind,role.title())
        sidecars={}
        drumtab=None
        if binary is not None:
            if kind=='drums':
                unmapped={}
                drumtab=gp2rs.convert_drum_track_to_drumtab(binary,index,expand_repeats=True,out_unmapped=unmapped)
                if unmapped:raise ProjectError('Unsupported Guitar Pro percussion MIDI pitches: '+str(sorted(unmapped)))
                xml=gp2rs.convert_drum_track(binary,index,arrangement_name=name,expand_repeats=True)
            elif kind=='keys':xml=gp2rs.convert_piano_track(binary,index,arrangement_name=name,expand_repeats=True)
            else:xml=gp2rs.convert_track(binary,index,arrangement_name=name,expand_repeats=True)
        else:
            directory=Path(request['output'])/f'track_{index}'
            paths=gp2rs_gpx.convert_file(str(source),str(directory),track_indices=[index],arrangement_names={index:name},expand_repeats=True)
            if len(paths)!=1:raise ProjectError('Guitar Pro converter did not produce exactly one arrangement for selected track '+str(index))
            xml=Path(paths[0]).read_text(encoding='utf-8')
            for item in directory.iterdir():
                if item.suffix=='.json':sidecars[item.name]=item.read_text(encoding='utf-8')
        total+=len(xml.encode('utf-8'))+sum(len(value.encode('utf-8')) for value in sidecars.values())
        if total>64*1024*1024:raise ProjectError('Converted Guitar Pro charts exceed the64MiB result limit')
        # PyGuitarPro documents track.offset as capo fret. The public converter
        # emits capo0 with unchanged relative frets; restore authoring metadata.
        capo=int(binary.tracks[index].offset) if binary is not None and kind in ('guitar','bass') else 0
        if gpif_capos is not None:
            metadata=gpif_capos[index];info=dict(info)
            if metadata['trackId'] and len(metadata['trackId'])<=1024:info['gpif_track_id']=metadata['trackId']
            if kind in ('guitar','bass'):
                values=metadata['staffCapos']
                if len(set(values))!=1:raise ProjectError('GPIF track has conflicting staff capos; split it into uniform-capo tracks before import')
                if metadata['present'] and len(values)!=metadata['converterStaves']:raise ProjectError('GPIF explicit capo staff creation differs from the installed converter; split the source into single-staff tracks')
                if metadata['present'] and len(values)>1 and any(pitches!=metadata['stavePitches'][0] for pitches in metadata['stavePitches'][1:]):raise ProjectError('GPIF multi-staff fretted track has different tunings; split it before importing a single capo arrangement')
                capo=values[0]
                # Converter emits relative frets: restore capo exactly once. A track that
                # would need a fret above 24 is left out (named in a warning), not the file.
                converted_root=ET.fromstring(_xml_input(xml.encode('utf-8')))
                over=[int(value) for element in converted_root.iter() for key,value in element.attrib.items()
                      if (key=='fret' or re.fullmatch('fret[0-9]+',key) or key in ('slideTo','slideUnpitchTo')) and int(value)>0 and int(value)+capo>24]
                if over:
                    # Past the editor's 24 frets (often a synth written as tab): keep every
                    # note at its real pitch as a piano-roll part instead of losing the track.
                    xml=_fretted_xml_as_pitched(converted_root,source_pitches[index],capo)
                    warnings.append(f'{str(info["name"])[:256]}: {len(over)} note(s) reach fret {capo+max(over)} with capo {capo}, above the editor limit of 24, so the track was imported as a pitched (piano roll) part at the same pitches; the tab stays in the original Guitar Pro source kept with the project')
                    kind,capo,role='keys',0,'keys'
            elif metadata['present'] and any(metadata['staffCapos']):warnings.append(str(info['name'])[:256]+': GPIF capo metadata is retained in the original source but not applied to a non-fretted arrangement')
        if not 0<=capo<=24:raise ProjectError('Guitar Pro capo must be between0 and24')
        result.append({'info':info,'kind':kind,'role':role,'pitches':source_pitches[index],'capo':capo,'xml':xml,'drumtab':drumtab,'sidecars':sidecars,'repairs':repairs.get(index)})
    if not result:raise ProjectError('No track in this Guitar Pro file could be imported; '+(' '.join(warnings)[:600] or 'the original source is unchanged'))
    if repairs.get('grandStaves'):
        warnings.append('Two-stave keyboard parts were read as one grand staff each, keeping later tracks on their own bars: '+', '.join(repairs['grandStaves'])[:400])
    return {'tracks':result,'warnings':warnings}


def feedback_core():
    """FeedBack's lib folder with the Guitar Pro converters, or None. Checks
    OCE_FEEDBACK_LIB, then the plugin install (feedBack/plugins/<editor>),
    then a development checkout beside this one or its parent (freedBack/feedBack/lib)."""
    import os
    here=Path(__file__).resolve()
    for candidate in (os.environ.get('OCE_FEEDBACK_LIB'),here.parents[2]/'lib',here.parents[1]/'freedBack'/'feedBack'/'lib',here.parents[2]/'freedBack'/'feedBack'/'lib'):
        if candidate and (Path(candidate)/'gp2rs.py').is_file() and (Path(candidate)/'gp2rs_gpx.py').is_file():
            return Path(candidate).resolve()
    return None


_CHORD_SUFFIXES=None
CHORD_ROOTS=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']


def _chord_suffixes():
    """Rocksmith chord suffix table, read from src/chord-names.js (one table for both sides)."""
    global _CHORD_SUFFIXES
    if _CHORD_SUFFIXES is None:
        try:
            text=(Path(__file__).with_name('src')/'chord-names.js').read_text(encoding='utf-8')
            body=text[text.index('CHORD_SUFFIXES=Object.freeze(['):];body=body[:body.index(']);')]
            _CHORD_SUFFIXES=[(suffix,json.loads(required),json.loads(optional)) for suffix,required,optional in re.findall(r"\['([^']*)',(\[[\d,]*\]),(\[[\d,]*\]),\d+\]",body)]
        except (OSError,ValueError):
            _CHORD_SUFFIXES=[]
    return _CHORD_SUFFIXES


def chord_name(pitches):
    """First Rocksmith-style name for sounding pitches, as the editor suggests it for
    guitar/bass (plain name, no slash bass), or '' when no table entry fits."""
    pitches=[p for p in pitches if isinstance(p,int)]
    if len(pitches)<2:return ''
    pcs={p%12 for p in pitches};bass=min(pitches)%12;best=None
    for root in range(12):
        for rank,(suffix,required,optional) in enumerate(_chord_suffixes()):
            allowed={(root+i)%12 for i in required+optional}
            if not all((root+i)%12 in pcs for i in required) or not pcs<=allowed:continue
            key=(rank+(0 if root==bass else 8),len(required)+len(optional)-len(pcs),root)
            if best is None or key<best[0]:best=(key,CHORD_ROOTS[root]+suffix)
    return best[1] if best else ''


def name_chord_templates(arr):
    """Name unnamed chord shapes of a fretted part from their pitches; returns how many."""
    bases=arr.get('basePitches') or BASES.get(arr.get('type'),[]);tuning=arr.get('tuning') or [];named=0
    for template in arr.get('chord_templates',[]):
        if template.get('name') or template.get('displayName'):continue
        # By sound in the tuning, by shape over a capo (as official charts name them).
        pitches=[bases[i]+(tuning[i] if i<len(tuning) else 0)+fret for i,fret in enumerate(template.get('frets',[])) if fret>=0 and i<len(bases)]
        name=chord_name(pitches)
        if name:template['name']=template['displayName']=name;named+=1
    return named


def _fretted_xml_as_pitched(root,open_pitches,capo):
    """A converted fretted chart as a pitched-part chart: real pitch per note (open
    string + capo + fret) in the keys encoding, chord notes as plain notes."""
    def pitched(element,time=None):
        string,fret=int(element.get('string',0)),int(element.get('fret',0))
        pitch=open_pitches[string]+capo+fret if 0<=string<len(open_pitches) else None
        if pitch is None:return None
        note=ET.Element('note',{k:v for k,v in element.attrib.items() if k not in ('slideTo','slideUnpitchTo','string','fret')})
        note.set('string',str(pitch//24));note.set('fret',str(pitch%24))
        if time is not None:note.set('time',time)
        return note
    for level in root.iter('level'):
        notes=level.find('notes')
        if notes is None:notes=ET.SubElement(level,'notes')
        for note in list(notes):
            replacement=pitched(note);notes.remove(note)
            if replacement is not None:notes.append(replacement)
        chords=level.find('chords')
        if chords is not None:
            for chord in chords:
                for member in chord.findall('chordNote'):
                    replacement=pitched(member,chord.get('time'))
                    if replacement is not None:notes.append(replacement)
            level.remove(chords);ET.SubElement(level,'chords',count='0')
        shapes=level.find('handShapes')
        if shapes is not None:level.remove(shapes);ET.SubElement(level,'handShapes',count='0')
        notes[:]=sorted(notes,key=lambda n:float(n.get('time',0)))
        notes.set('count',str(len(notes)))
    templates=root.find('chordTemplates')
    if templates is not None:
        for child in list(templates):templates.remove(child)
        templates.set('count','0')
    return ET.tostring(root,encoding='unicode')


def load_guitarpro(data,filename='Untitled.gp5'):
    """Import GP3..8 through existing local converters, retaining the original."""
    if len(data)>64*1024*1024:
        raise ProjectError('Guitar Pro source exceeds64MiB; remove embedded audio before importing this score')
    core=feedback_core()
    if core is None:
        raise ProjectError('FeedBack\'s Guitar Pro converters were not found; install this editor as a FeedBack plugin or set OCE_FEEDBACK_LIB to FeedBack\'s lib folder')
    suffix=Path(filename).suffix.lower()
    suffix={'.gp6':'.gpx','.gp7':'.gp','.gp8':'.gp'}.get(suffix,suffix)
    if data.startswith(b'PK'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members=archive.infolist();names=[member.filename for member in members if not member.is_dir()]
            if len(members)>MAX_MEMBERS or sum(member.file_size for member in members)>MAX_BYTES:
                raise ProjectError('Guitar Pro ZIP exceeds the member/uncompressed size limit')
            if len(set(names))!=len(names):raise ProjectError('Guitar Pro ZIP contains ambiguous duplicate members')
            for name in names:_path(name)
    with tempfile.TemporaryDirectory(prefix='oce-gp-') as temporary:
        folder=Path(temporary);source=folder/('source'+suffix);source.write_bytes(data)
        request={'core':str(core),'source':str(source),'output':str(folder/'converted')}
        try:
            worker=subprocess.run([sys.executable,'-I','-X','utf8',str(Path(__file__).resolve()),'--gp-worker'],input=json.dumps(request),capture_output=True,text=True,encoding='utf-8',timeout=90,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        except subprocess.TimeoutExpired as exc:
            raise ProjectError('Guitar Pro conversion exceeded90seconds; simplify the score before importing') from exc
        try:
            response=json.loads(worker.stdout)
        except ValueError as exc:
            raise ProjectError('Guitar Pro converter returned no readable result') from exc
        if worker.returncode or not response.get('ok'):
            raise ProjectError('Guitar Pro import failed: '+str(response.get('error','unsupported or malformed score')))
        converted=response['result']
    project=None;arrangements=[];vocals=[];entries={};warnings=list(converted.get('warnings',[]));roles={}
    # Vocal XML has no ebeats, so its timeline is a default grid; any instrument
    # chart carries the score's real tempo map and must win over it.
    vocal_timeline=False
    source_name='sources/original'+suffix
    entries[source_name]=base64.b64encode(data).decode('ascii')
    for item in converted['tracks']:
        info=item['info'];kind=item['kind'];index=info['index'];xml=_xml_input(item['xml'].encode('utf-8'))
        root=ET.fromstring(xml)
        if root.tag=='vocals':
            vocal_project=load_vocal_xml(xml,info['name']+'.xml')
            for vocal in vocal_project['vocals']:
                vocal['id']=f'gp-{index}-{vocal["id"]}'
                vocals.append(vocal)
            for name,sidecar in item['sidecars'].items():
                if name=='vocal_pitch.json':
                    pitches=_decode_json(sidecar.encode('utf-8')).get('notes',[])
                    by_time={}
                    for pitch in pitches:by_time.setdefault((pitch['t'],pitch['d']),deque()).append(pitch['midi'])
                    for vocal in vocal_project['vocals']:
                        queue=by_time.get((vocal['time'],vocal['length']))
                        if queue:vocal['pitch']=queue.popleft()
            if project is None:project,vocal_timeline=vocal_project,True
            continue
        count=len(item['pitches']) if kind in ('guitar','bass') else 6
        bases=_instrument_bases(kind,count) if kind in ('guitar','bass') and count in range(4,9) else [] if kind not in ('guitar','bass') else None
        if bases is None:raise ProjectError(f'Unsupported authored Guitar Pro string layout: {kind} with{count} strings')
        offsets=[pitch-base for pitch,base in zip(item['pitches'],bases)] if kind in ('guitar','bass') else [0]*6
        tuning=root.find('tuning')
        converted_count=int(tuning.get('stringCount',count)) if tuning is not None else count
        shift=count-converted_count if kind=='bass' else 0
        if shift>0:
            warnings.append(f'{info["name"]}: restored{shift} authored unused low bass string(s) pruned by the public converter')
            for element in root.iter():
                if 'string' in element.attrib:element.set('string',str(int(element.get('string'))+shift))
                if element.tag=='chordTemplate':
                    for prefix in ('fret','finger'):
                        values=[element.get(f'{prefix}{i}','-1') for i in range(converted_count)]
                        for i in range(max(6,count)):element.set(f'{prefix}{i}',values[i-shift] if shift<=i<shift+len(values) else '-1')
        if kind in ('guitar','bass'):
            revoiced,dropped=_resolve_chord_string_clashes(root,item['pitches'])
            if revoiced:warnings.append(f'{info["name"]}: {revoiced} chord notes sharing a string with another note were moved to a free string playing the same pitch')
            if dropped:warnings.append(f'{info["name"]}: {dropped} chord notes sharing a string (unisons or with no free string) were left out; the original is retained')
        layout={'type':'keys' if kind=='drums' else kind,'stringCount':count,'basePitches':bases,'tuning':offsets}
        imported=load_xml(ET.tostring(root),layout)
        if project is None or vocal_timeline or len(imported.get('beats',[]))>len(project.get('beats',[])):project,vocal_timeline=imported,False
        arr=imported['arrangements'][0];arr.update(id=f'gp-{index}',name=info['name'],type=kind,sourceTrack=index)
        arr['capo']=item.get('capo',0)
        if kind in ('guitar','bass'):
            # Guitar Pro leaves shapes without a chord diagram unnamed.
            named=name_chord_templates(arr)
            if named:warnings.append(f'{info["name"]}: named {named} chord shapes from their notes (Rocksmith spelling); rename any that read differently in the song')
            arr['role']=item['role'];arr['priority']='main' if roles.get(item['role'],0)==0 else 'alternative';roles[item['role']]=roles.get(item['role'],0)+1
        else:arr['role']=kind
        if kind=='keys':arr['instrument']=pitched_instrument(info['name'],info.get('instrument'))
        if kind=='drums':
            if item.get('drumtab'):
                arr=_arrangement(item['drumtab'],{'id':f'gp-{index}','name':info['name'],'type':'drums','drum_tab':f'arrangements/gp_{index}_drums.json'},index,True)
            else:
                lanes={int(code):value for code,value in ((item.get('repairs') or {}).get('drumLanes') or {}).items()}
                for note in arr['notes']+[n for chord in arr.get('chords',[]) for n in chord.get('notes',[])]:
                    pitch=note['pitch']
                    if pitch in lanes:piece=f'gp-lane-{pitch}'
                    elif pitch in MIDI_DRUMS:piece=MIDI_DRUMS[pitch]
                    else:raise ProjectError(f'Guitar Pro drum MIDI pitch{pitch} needs an explicit FeedBack piece mapping')
                    note.update(piece=piece,velocity=100,sustain=0)
                if lanes:
                    kit=arr.setdefault('_wire',{}).setdefault('kit',[])
                    kit.extend({'id':f'gp-lane-{code}','name':f'Unlabelled {code} (no drum piece in source)' if s<0 else f'Unlabelled {code} (source string {s+1}, fret {f})'} for code,(s,f) in sorted(lanes.items()))
                arr.pop('difficulties',None);arr.pop('activeDifficulty',None)
        repairs=item.get('repairs') or {}
        if repairs.get('pitchFixed'):warnings.append(f'{info["name"]}: {repairs["pitchFixed"]} notes use chromatic Guitar Pro pitch steps and were read as such ({repairs["toneDefaulted"]} with an omitted C step)')
        if repairs.get('tabFilled'):warnings.append(f'{info["name"]}: {repairs["tabFilled"]} notation-only notes were given a string and fret from their pitch and the tuning; review the fingering')
        if repairs.get('tabUnplaced'):warnings.append(f'{info["name"]}: {repairs["tabUnplaced"]} notation-only notes have no playable string/fret in this tuning and were not imported; the original is retained')
        if repairs.get('drumLanes'):warnings.append(f'{info["name"]}: {len(repairs["drumLanes"])} drum lanes have no kit mapping in the source and were imported as unlabelled lanes; label or map them in Drum lanes')
        for name,sidecar in item['sidecars'].items():
            member=f'sources/track_{index}/'+_path(name)
            entries[member]=base64.b64encode(sidecar.encode('utf-8')).decode('ascii')
            if name.endswith('.notation.json'):
                arr.setdefault('_entry',{})['notation']=member
                if kind=='keys':
                    notation=_decode_json(sidecar.encode('utf-8'));hands={}
                    for measure in notation.get('measures',[]):
                        for hand,staff in measure.get('staves',{}).items():
                            if hand not in ('lh','rh'):continue
                            for voice in staff.get('voices',[]):
                                for beat in voice.get('beats',[]):
                                    for note in beat.get('notes',[]):
                                        if note.get('midi') is not None:hands.setdefault((round(beat['t'],3),note['midi']),deque()).append(hand)
                    for note in arr['notes']:
                        queue=hands.get((round(note['time'],3),note['pitch']))
                        if queue:note['hand']=queue.popleft()
                    assigned_hands={(n['id'],n['time'],n['pitch']):n['hand'] for n in arr['notes'] if n.get('hand')}
                    for level in arr.get('difficulties',[]):
                        for note in level.get('notes',[]):
                            hand=assigned_hands.get((note['id'],note['time'],note['pitch']))
                            if hand:note['hand']=hand
        source_voices=info.get('notes',0);imported_voices=len(arr['notes'])+sum(len(c.get('notes',[])) for c in arr.get('chords',[]))
        warnings.append(f'{info["name"]}: source note records{source_voices}; imported timed voices{imported_voices}; repeat expansion/ties/chord grouping can change this count')
        arrangements.append(arr)
    if project is None:raise ProjectError('Guitar Pro score produced no editable timeline')
    project=copy.deepcopy(project)
    project['arrangements']=arrangements or [_import_arrangement('gp-vocal-guide','Vocal guide')]
    if vocals:project['vocals']=vocals
    project['_pack']={'manifest':{},'entries':entries}
    project['_import']={'format':'guitarpro','filename':Path(filename).name,'source':base64.b64encode(data).decode('ascii'),'adapter':'installed public FeedBack converters','tracks':[item['info'] for item in converted['tracks']]}
    warnings.append('Guitar Pro import uses the installed public converter with playback repeats expanded. Original source is retained; verify expression, grace/ornament interpretation, note velocities and embedded-audio synchronization before export.')
    project['import_warnings']=warnings
    validate_project(project)
    return _notation_call(_notation_state.stamp_notation_baselines,project)


# --- Keys parts and notation (§7.6) ---------------------------------------------------

_CORE_NOTATION=None


def core_notation():
    """FeedBack core's notation module (lib/notation.py), or None. Its notation_to_notes
    is the rule FeedBack plays notation-only parts with (lesson-format §3.2.2)."""
    global _CORE_NOTATION
    if _CORE_NOTATION is None:
        _CORE_NOTATION=False
        core=feedback_core()
        candidate=(Path(core)/'notation.py') if core else None
        if candidate and candidate.is_file():
            try:
                spec=importlib.util.spec_from_file_location('feedback_core_notation',candidate)
                module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
                if callable(getattr(module,'notation_to_notes',None)):_CORE_NOTATION=module
            except Exception:
                _CORE_NOTATION=False
    return _CORE_NOTATION or None


KEYS_FAMILY_TYPES=('keys','piano','keyboard','organ','synth','electric piano')
# Instrument labels for pitched (non-fretted, non-drum) parts, so the stave can use the
# instrument's own clef and written transposition. Names win; a GM program is the fallback.
_INSTRUMENT_WORDS=(('piccolo','piccolo'),('pan flute','pan flute'),('flute','flute'),('recorder','recorder'),
    ('english horn','english horn'),('cor anglais','english horn'),('oboe','oboe'),('bass clarinet','bass clarinet'),('clarinet','clarinet'),
    ('bassoon','bassoon'),('soprano sax','soprano sax'),('alto sax','alto sax'),('tenor sax','tenor sax'),('baritone sax','baritone sax'),
    ('sax','saxophone'),('trumpet','trumpet'),('cornet','trumpet'),('trombone','trombone'),('tuba','tuba'),('french horn','french horn'),
    ('horn','french horn'),('violin','violin'),('fiddle','violin'),('viola','viola'),('violoncello','cello'),('cello','cello'),
    ('contrabass','contrabass'),('double bass','contrabass'),('harp','harp'),('celesta','celesta'),('glockenspiel','glockenspiel'),
    ('vibraphone','vibraphone'),('marimba','marimba'),('xylophone','xylophone'),('electric piano','electric piano'),('e.piano','electric piano'),
    ('piano','piano'),('organ','organ'),('synth','synth'),('voice','voice'),('vocal','voice'),('choir','voice'),('strings','strings'))
_GM_INSTRUMENTS={4:'electric piano',5:'electric piano',8:'celesta',9:'glockenspiel',11:'vibraphone',12:'marimba',13:'xylophone',
    40:'violin',41:'viola',42:'cello',43:'contrabass',46:'harp',52:'voice',53:'voice',54:'voice',56:'trumpet',57:'trombone',58:'tuba',
    59:'trumpet',60:'french horn',64:'soprano sax',65:'alto sax',66:'tenor sax',67:'baritone sax',68:'oboe',69:'english horn',
    70:'bassoon',71:'clarinet',72:'piccolo',73:'flute',74:'recorder',75:'pan flute'}


def pitched_instrument(name,program=None):
    """Instrument label for a pitched part from its track name, else its GM program (0-127)."""
    lowered=str(name or '').lower()
    for word,label in _INSTRUMENT_WORDS:
        if word in lowered:return label
    if isinstance(program,int) and not isinstance(program,bool):
        if program in _GM_INSTRUMENTS:return _GM_INSTRUMENTS[program]
        if 0<=program<=7:return 'piano'
        if 16<=program<=20:return 'organ'
        if 44<=program<=51:return 'strings'
        if 61<=program<=63:return 'brass'
        if 76<=program<=79:return 'flute'
        if 80<=program<=103:return 'synth'
    return 'keys'
MAJOR_FIFTHS={'Cb':-7,'Gb':-6,'Db':-5,'Ab':-4,'Eb':-3,'Bb':-2,'F':-1,'C':0,'G':1,'D':2,'A':3,'E':4,'B':5,'F#':6,'C#':7,'G#':8,'D#':9,'A#':10}
MAJOR_BY_FIFTHS={value:name for name,value in MAJOR_FIFTHS.items() if -7<=value<=7}
MINOR_BY_FIFTHS={-7:'Abm',-6:'Ebm',-5:'Bbm',-4:'Fm',-3:'Cm',-2:'Gm',-1:'Dm',0:'Am',1:'Em',2:'Bm',3:'F#m',4:'C#m',5:'G#m',6:'D#m',7:'A#m'}


def key_signature_from_name(name):
    """'F', 'Bbm', 'F#m' (R+ Key: events) to {'fifths', 'minor'}, or None."""
    if not isinstance(name,str):return None
    name=name.strip();minor=name.endswith('m')
    tonic=name[:-1] if minor else name
    if tonic not in MAJOR_FIFTHS:return None
    fifths=MAJOR_FIFTHS[tonic]-(3 if minor else 0)
    return {'fifths':fifths,'minor':minor} if -7<=fifths<=7 else None


def key_signature_name(signature):
    """{'fifths', 'minor'} to the R+ key name, or None."""
    if not isinstance(signature,dict) or type(signature.get('fifths')) is not int:return None
    return (MINOR_BY_FIFTHS if signature.get('minor') else MAJOR_BY_FIFTHS).get(signature['fifths'])


def _notation_key_signature(notation):
    for measure in (notation.get('measures') or []) if isinstance(notation,dict) else []:
        if isinstance(measure,dict) and type(measure.get('ks')) is int and -7<=measure['ks']<=7:
            return {'fifths':measure['ks'],'minor':False}
    return None


def _fill_hands_from_notation(arr,notation):
    """Fill missing keys `hand` values from the notation's rh/lh staves (spec §7.6). An
    authored hand is never overwritten. Returns how many notes were filled."""
    def staves_map():
        hands={}
        for measure in (notation.get('measures') or []) if isinstance(notation,dict) else []:
            staves=measure.get('staves') if isinstance(measure,dict) else None
            for hand,staff in (staves.items() if isinstance(staves,dict) else []):
                if hand not in ('lh','rh') or not isinstance(staff,dict):continue
                for voice in staff.get('voices') or []:
                    for beat in (voice.get('beats') or []) if isinstance(voice,dict) else []:
                        if not isinstance(beat,dict) or beat.get('rest') or not isinstance(beat.get('t'),(int,float)):continue
                        for note in beat.get('notes') or []:
                            if isinstance(note,dict) and type(note.get('midi')) is int:hands.setdefault((round(beat['t'],3),note['midi']),deque()).append(hand)
        return hands
    filled=0
    for owner in [arr]+list(arr.get('difficulties') or []):
        hands=staves_map()
        for note in list(owner.get('notes') or [])+[n for chord in owner.get('chords') or [] for n in chord.get('notes') or []]:
            if note.get('hand') in ('lh','rh'):continue
            time=note.get('time',note.get('t'))
            queue=hands.get((round(time,3),note.get('pitch'))) if isinstance(time,(int,float)) else None
            if queue:
                note['hand']=queue.popleft()
                if owner is arr:filled+=1
    return filled


def _notation_only_arrangement(entry,notation,index):
    """An editable keys arrangement built from a notation-only manifest entry with core's
    notation_to_notes, so its notes are the ones FeedBack plays. None when the part is
    not a keys part or core's rule is unavailable."""
    kind=str(entry.get('type','')).strip().lower()
    if kind not in KEYS_FAMILY_TYPES:return None
    core=core_notation()
    if core is None:return None
    rows=core.notation_to_notes(notation)
    notes=[]
    for i,row in enumerate(rows):
        midi=row.get('midi');time=row.get('t')
        if type(midi) is not int or not 0<=midi<=127 or not isinstance(time,(int,float)):continue
        wire={'t':float(time),'s':midi//24,'f':midi%24,'m':midi,'sus':max(0.0,float(row.get('sus') or 0))}
        if row.get('hand') in ('lh','rh'):wire['hand']=row['hand']
        notes.append(_note(wire,i,keys=True))
    arr=_import_arrangement(entry['id'],entry.get('name',entry['id']),'keys')
    arr.update(notes=notes,instrument=str(entry.get('type') or 'keys'),_entry=copy.deepcopy(entry),_fromNotation=True)
    signature=_notation_key_signature(notation)
    if signature:arr['keySignature']=signature
    return arr


def _audio_warp(audio_map):
    """Score time to audio time from a measured map ({chart_t, audio_t}); between
    points linear, outside them the nearest segment's tempo continues."""
    chart=(audio_map or {}).get('chart_t');audio=(audio_map or {}).get('audio_t')
    if not isinstance(chart,list) or not isinstance(audio,list) or len(chart)<2 or len(chart)!=len(audio):
        raise ProjectError('Audio alignment needs a measured map with at least two points')
    points=sorted((float(c),float(a)) for c,a in zip(chart,audio) if math.isfinite(float(c)) and math.isfinite(float(a)))
    chart=[];audio=[]
    for c,a in points:
        if chart and (c<=chart[-1] or a<=audio[-1]):continue  # keep the map strictly increasing
        chart.append(c);audio.append(a)
    if len(chart)<2:raise ProjectError('Audio alignment map does not move forward in time')
    def warp(time):
        index=max(0,min(len(chart)-2,bisect.bisect_right(chart,time)-1))
        slope=(audio[index+1]-audio[index])/(chart[index+1]-chart[index])
        return round(max(0,audio[index]+(time-chart[index])*slope),9)
    return warp


def song_year(value):
    """A four-digit year (1000-9999) from an int or text such as '1991' or '1991-09-17'; None
    for anything else, including placeholders like '19__'."""
    if isinstance(value,bool):return None
    if isinstance(value,int):return value if 1000<=value<=9999 else None
    match=re.match(r'\s*(\d{4})(?!\d)',str(value or ''))
    return int(match.group(1)) if match and 1000<=int(match.group(1))<=9999 else None


def audio_file_tags(path):
    """Song details from an audio file's own tags (ID3, Vorbis, MP4...) via ffprobe:
    {title, artist, album, year} with only the fields the file really has."""
    import shutil
    executable=shutil.which('ffprobe')
    if not executable:return {}
    try:
        run=subprocess.run([executable,'-v','quiet','-print_format','json','-show_format',str(path)],capture_output=True,text=True,timeout=20,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        tags={str(k).lower():str(v) for k,v in json.loads(run.stdout or '{}').get('format',{}).get('tags',{}).items()}
    except (OSError,subprocess.TimeoutExpired,ValueError,AttributeError):
        return {}
    found={'title':tags.get('title'),'artist':tags.get('artist') or tags.get('album_artist'),'album':tags.get('album'),'year':song_year(tags.get('date') or tags.get('year'))}
    return {key:value for key,value in found.items() if value}


def audio_bytes_tags(data,name):
    """audio_file_tags for audio held in memory (a folder or archive member)."""
    with tempfile.TemporaryDirectory() as folder:
        path=Path(folder)/('audio'+(Path(name).suffix.lower() or '.bin'))
        path.write_bytes(data)
        return audio_file_tags(path)


# Values a new editor project starts with; any other value was set by the user.
DEFAULT_SONG_DETAILS={'title':('','Untitled'),'artist':('','Local author'),'album':('',),'year':(None,2026)}


def fill_song_details(project,details):
    """Copy title/artist/album/year from an import or audio tags into fields
    still at their new-project defaults. Returns the names of filled fields."""
    filled=[]
    for field,defaults in DEFAULT_SONG_DETAILS.items():
        value=details.get(field)
        if field=='year':
            if isinstance(value,bool) or not isinstance(value,int) or not 1000<=value<=9999 or value in defaults:continue
        else:
            if not isinstance(value,str) or value.strip() in defaults:continue
            value=value.strip()[:256]
        if project.get(field) in defaults:
            project[field]=value;filled.append(field)
    return filled


def merge_projects(target,incoming,arrangement_ids=None,align='time',offset=0,include_vocals=False,audio_map=None):
    """Append authoring tracks while retaining the destination's global backing.

    Each import gets its own member namespace and a complete original project
    snapshot. Unknown opaque sidecars remain unchanged. Only editable chart data
    and understood notation time fields participate in optional beat alignment.
    """
    validate_project(target);validate_project(incoming)
    if align not in ('time','beats','score','audio'):
        raise ProjectError('Merge alignment must be time, beats, score or audio')
    if not isinstance(offset,(int,float)) or isinstance(offset,bool) or not math.isfinite(offset) or offset<0:
        raise ProjectError('Merge offset must be finite nonnegative seconds')
    selected=[a['id'] for a in incoming['arrangements']] if arrangement_ids is None else arrangement_ids
    if not isinstance(selected,list) or any(not isinstance(value,str) for value in selected) or len(set(selected))!=len(selected):
        raise ProjectError('Merge arrangement_ids must contain distinct source arrangement IDs')
    available={a['id']:a for a in incoming['arrangements']}
    if any(value not in available for value in selected):
        raise ProjectError('A selected merge arrangement does not exist')
    if any(available[value].get('readOnly') or available[value].get('_notationOnly') for value in selected):
        raise ProjectError('Retained notation-only scores cannot be merged as editable charts; open their complete project for preservation, or import an editable MusicXML, Guitar Pro or MIDI source')
    if not selected and not (include_vocals and incoming.get('vocals')):
        raise ProjectError('Select an arrangement or explicit incoming vocal events to merge')
    def grid(project):
        beats=project.get('beats',[])
        times=[b['time'] for b in beats]
        if len(times)<2 or any(times[i]<=times[i-1] for i in range(1,len(times))):
            raise ProjectError('Beat alignment requires strictly increasing source and target beat maps')
        return times,_beat_quarters(project)
    def interpolate(value,source,destination):
        index=max(0,min(len(source)-2,bisect.bisect_right(source,value)-1))
        return destination[index]+(value-source[index])/(source[index+1]-source[index])*(destination[index+1]-destination[index])
    if align=='beats':
        source_times,source_quarters=grid(incoming);target_times,target_quarters=grid(target)
        # Anchor source time zero at the chosen destination position BEFORE
        # following its tempo map. Adding seconds after the warp shifts later
        # tempo boundaries and puts notes off the existing destination beats.
        source_origin=interpolate(0,source_times,source_quarters)
        target_origin=interpolate(offset,target_times,target_quarters)
        def warp(time):
            quarter=interpolate(time,source_times,source_quarters)-source_origin+target_origin
            return round(interpolate(quarter,target_quarters,target_times),9)
    elif align=='audio':
        warp=_audio_warp(audio_map)
    else:
        # 'score' keeps score seconds too; the song then takes the score's own beat map.
        def warp(time):return round(time+offset,9)
    namespace='import-'+uuid.uuid4().hex[:12]
    prefix='imports/'+namespace+'/'
    merged=copy.deepcopy(target)
    pack=merged.setdefault('_pack',{})
    members=pack.setdefault('entries',{})
    source_pack=incoming.get('_pack',{})
    total=sum(len(base64.b64decode(value,validate=True)) for value in members.values())
    def add_member(name,content):
        nonlocal total
        name=_path(name)
        if name in members:raise ProjectError('Imported member namespace unexpectedly collides with an existing file')
        total+=len(content)
        if total>MAX_BYTES or len(members)>=MAX_MEMBERS:
            raise ProjectError('Merged opaque sources exceed the package size/member limit')
        members[name]=base64.b64encode(content).decode('ascii')
    native_sources=set()
    native_sources.update(arr.get('midiProgramIntent',{}).get('sourceRef',{}).get('entry') for arr in incoming['arrangements'])
    if isinstance(incoming.get('_import'),dict):native_sources.add(incoming['_import'].get('sourceRef',{}).get('entry'))
    asset_references={}
    for name,content in source_pack.get('entries',{}).items():
        existing=next((key for key,value in members.items() if name in native_sources and value==content),None)
        destination=existing or prefix+_path(name)
        if existing is None:add_member(destination,base64.b64decode(content,validate=True))
        asset_references[name]=destination
    snapshot=prefix+'source-'+uuid.uuid4().hex+'.oce.json'
    source_snapshot=incoming
    if any(native_sources) or any(arr.get('midiProgramIntent') for arr in incoming['arrangements']):
        source_snapshot=copy.deepcopy(incoming)
        source_snapshot['_pack']['entries']={}
        source_snapshot['_assetReferences']=asset_references
    add_member(snapshot,_json(source_snapshot))
    merged.setdefault('_imports',[]).append({'id':namespace,'snapshot':snapshot,'sourceManifest':copy.deepcopy(source_pack.get('manifest',{})),'alignment':align,'offset':offset})
    warnings=[]
    def note_time(note):
        original=note.get('time',0);sustain=note.get('sustain',0)
        note['time']=warp(original);note['sustain']=max(0,round(warp(original+sustain)-warp(original),9))
        for point in note.get('techniques',{}).get('bend_values',note.get('techniques',{}).get('bnv',[])):
            point['t']=round(warp(original+point['t'])-warp(original),9)
    def collections(owner):
        for index,note in enumerate(owner.get('notes',[])):
            note_time(note);note['id']=namespace+'-'+str(note.get('id',f'n{index}'))
        for index,chord in enumerate(owner.get('chords',[])):
            original=chord.get('time',chord.get('t',0));chord['time']=warp(original)
            if 't' in chord:chord['t']=chord['time']
            if isinstance(chord.get('id'),str):chord['id']=namespace+'-'+chord['id']
            for child_index,note in enumerate(chord.get('notes',[])):
                note.setdefault('time',original);note_time(note);note['id']=namespace+'-'+str(note.get('id',f'c{index}-n{child_index}'))
        for anchor in owner.get('anchors',[]):anchor['time']=warp(anchor['time'])
        for shape in owner.get('handshapes',[]):
            for field in ('start_time','end_time','startTime','endTime'):
                if field in shape:shape[field]=warp(shape[field])
    new_ids=[]
    for identifier in selected:
        arr=copy.deepcopy(available[identifier]);arr['id']=namespace+'-'+identifier;new_ids.append(arr['id'])
        if arr.get('scratchFor'):
            if arr['scratchFor'] in selected:
                arr['scratchFor']=namespace+'-'+arr['scratchFor']
            else:
                arr.pop('scratchFor',None)
                warnings.append('Imported scratch track was detached because its linked main arrangement was not selected')
        entry=arr.setdefault('_entry',{})
        for field in ('file','notation','drum_tab'):
            if entry.get(field):entry[field]=prefix+_path(entry[field])
        if arr.get('type')=='drums':entry.setdefault('drum_tab',prefix+'arrangements/'+arr['id']+'.json')
        else:entry.setdefault('file',prefix+'arrangements/'+arr['id']+'.json')
        collections(arr)
        for level in arr.get('difficulties',[]):collections(level)
        for phrase in arr.get('phrases',[]):
            for field in ('time','start_time','end_time'):
                if field in phrase:phrase[field]=warp(phrase[field])
        for phrase in arr.get('_wire',{}).get('phrases',[]):
            for field in ('start_time','end_time'):
                if field in phrase:phrase[field]=warp(phrase[field])
        for change in arr.get('tones',{}).get('changes',[]):
            change['time']=warp(change.get('time',change.get('t',0)))
            if 't' in change:change['t']=change['time']
        # A source-only portable rig library must not accidentally bind to a
        # destination rig sharing the same ID. Its exact original stays above.
        for tones in (arr.get('tones'),entry.get('tones'),arr.get('_wire',{}).get('tones')):
            if isinstance(tones,dict):
                if tones.pop('base_rig',None) is not None:warnings.append('Imported portable rig binding retained in source snapshot; choose a destination/native tone before playback')
                for change in tones.get('changes',[]):
                    if change.pop('rig',None) is not None:warnings.append('Imported portable rig change retained in source snapshot; choose a destination/native tone before playback')
        if entry.get('notation') and (align=='beats' or offset):
            source_notation=entry['notation']
            if source_notation in members:
                notation=_decode_json(base64.b64decode(members[source_notation]),source_notation)
                for measure in notation.get('measures',[]):
                    measure['t']=warp(measure['t'])
                    for staff in measure.get('staves',{}).values():
                        for voice in staff.get('voices',[]):
                            for beat in voice.get('beats',[]):beat['t']=warp(beat['t'])
                active=prefix+'aligned/'+arr['id']+'/'+Path(source_notation).name
                add_member(active,_json(notation));entry['notation']=active
        merged['arrangements'].append(arr)
    if include_vocals:
        for vocal in incoming.get('vocals',[]):
            event=copy.deepcopy(vocal);start=event['time'];event['id']=namespace+'-'+event['id'];event['time']=warp(start);event['length']=round(warp(start+event['length'])-warp(start),9)
            merged.setdefault('vocals',[]).append(event)
    if align in ('score','audio'):
        beats=incoming.get('beats',[])
        if len(beats)<2:raise ProjectError('This source has no tempo map to use; choose another Timing option')
        merged['beats']=[{**copy.deepcopy(b),'time':warp(b['time'])} for b in beats]
        merged['duration']=max(merged.get('duration',0),merged['beats'][-1]['time'])
        if any(a.get('notes') or a.get('chords') for a in target['arrangements']):
            warnings.append('The song now uses the imported score\'s tempo map; existing arrangements kept their times, so check them against the new beat grid')
    filled=fill_song_details(merged,incoming)
    if filled:warnings.append('Song details filled from the import: '+', '.join(filled))
    if source_pack.get('manifest'):
        warnings.append('Incoming song metadata, backing audio, timeline and global sidecars remain in the namespaced source snapshot; destination globals are unchanged')
    if align=='beats' or offset:
        warnings.append('Alignment updates editable chart timing and understood notation timestamps; opaque source-only timing stays unchanged in the retained snapshot')
    if any(n.get('time',0)+n.get('sustain',0)>target.get('duration',0) for a in merged['arrangements'] if a['id'] in new_ids for n in a.get('notes',[])):
        warnings.append('Imported notes extend beyond the destination duration; destination backing duration was retained')
    _midi_call(_midi_programs.merge,merged,incoming,dict(zip(selected,new_ids)),asset_references,warp,_midi_stream)
    validate_project(merged)
    return {'project':merged,'arrangement_ids':new_ids,'warnings':list(dict.fromkeys(warnings))}


if __name__=='__main__' and sys.argv[1:]==['--gp-worker']:
    try:
        result=_gp_worker(json.load(sys.stdin))
        print(json.dumps({'ok':True,'result':result},ensure_ascii=False,allow_nan=False))
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error)},ensure_ascii=False))
        raise SystemExit(1)
