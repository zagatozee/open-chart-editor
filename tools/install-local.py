"""Reviewable, closed-file local plugin installation; no Git or network calls."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
from pathlib import Path
import posixpath
import re
import shutil
import uuid

SOURCE = Path(__file__).resolve().parents[1]
DEFAULT_HOST = Path(r'I:\Dev\freedBack\feedBack')
PLUGIN_ID = 'open_chart_editor'
# Runtime files only. Additions require a reviewed code change here. No globbed
# directories, research, test songs, private decompilation, .git or dependencies.
RUNTIME_FILES = (
    'plugin.json', 'screen.html', 'screen.js', 'routes.py', 'library_source.py', 'folder_io.py', 'at5_vst3.py', 'export_targets.py', 'rplus_io.py', 'eof_io.py', 'charter_io.py', 'rsw_reader.py', 'rs7x.py', 'feedpak_contract.py', 'requirements-standalone.txt', 'requirements.txt', 'requirements-vst3.txt', 'tools/assist/gp_assist.py', 'pack_io.py', 'notation_state.py', 'musicxml_dynamics.py', 'midi_programs.py',
    'assets/editor.css', 'assets/tone-rack-data.json', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'assets/feedpak-schemas/LICENSE-CODE.txt', 'assets/feedpak-schemas/PROVENANCE.json',
    'assets/feedpak-schemas/arrangement.schema.json', 'assets/feedpak-schemas/drum-tab.schema.json',
    'assets/feedpak-schemas/harmony.schema.json', 'assets/feedpak-schemas/keys.schema.json',
    'assets/feedpak-schemas/lyrics.schema.json', 'assets/feedpak-schemas/manifest.schema.json',
    'assets/feedpak-schemas/notation.schema.json', 'assets/feedpak-schemas/rigs.schema.json',
    'assets/feedpak-schemas/song-timeline.schema.json', 'assets/feedpak-schemas/vocal-pitch-contour.schema.json',
    'assets/feedpak-schemas/vocal-pitch.schema.json',
    'src/main.js', 'src/library-open.js', 'src/folder-files.js', 'src/model.js', 'src/audio.js', 'src/tempo.js', 'src/selection-range.js', 'src/string-move.js', 'src/context-menu.js', 'src/menubar.js', 'src/technique-tags.js', 'src/arrangements.js', 'src/piano-hands.js',
    'src/draft.js', 'src/recent-projects.js', 'src/open-dialog.js', 'src/ordered-saves.js', 'src/preferences.js', 'src/roll-geometry.js', 'src/gpa-sync.js', 'src/stave-view.js', 'src/keymaps.js', 'src/live-view.js', 'src/lyric-sync.js', 'src/combine.js', 'src/validation.js', 'src/oce-checks.js', 'src/difficulty.js', 'src/history.js', 'src/midi-note-appender.js',
    'src/spectral-fft.js', 'src/spectral-core.js', 'src/spectral-source.js', 'src/spectral-preview.js', 'src/spectral-worker.js', 'src/spectral-worklet.js', 'src/grain-align.js', 'src/quantizer.js', 'src/render-guide.js', 'src/render-controller.js', 'src/render-worker.js', 'src/region.js', 'src/select-like.js', 'src/tone-rack.js', 'src/tone-effects.js', 'src/tone-static-extra.js', 'src/tone-swole-eden.js', 'src/tone-filters.js', 'src/tone-envelope.js', 'src/tone-crusher.js', 'src/tone-modulation.js', 'src/tone-adaptive-worklet.js', 'src/tone-adaptive-rack.js', 'src/tone-retirement.js', 'src/tone-adaptive-plan.js', 'src/midi.js', 'src/midi-audition.js', 'src/playtest.js', 'src/chord-tools.js', 'src/chord-diagram.js', 'src/anchor-fit.js', 'src/sustain-policy.js', 'src/chord-names.js', 'src/bend-tools.js', 'src/fingerprint-zones.js', 'src/count-in.js', 'src/live-input.js', 'src/signal-meters.js', 'src/fret-display.js', 'src/transpose.js', 'src/viewport.js', 'src/issue-finder.js', 'src/guide-synthesis.js', 'src/guide-voice.js', 'src/drum-guide.js', 'src/drum-layout.js', 'src/vocal-tools.js', 'src/vocal-timeline.js', 'src/zone-fit.js', 'src/vocal-validation.js',
    'src/lrclib.js', 'src/piano-colors.js', 'src/spectrum-analysis.js', 'src/spectrum-worker.js', 'src/spectrum-stems.js', 'src/vst3-live-effect.js', 'src/vst3-live-worklet.js',
)
OPTIONAL_FILES = ('feature-coverage.json',)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def within(path, root):
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def ensure_plain(path, root):
    if not within(path, root):
        raise ValueError(f'Path escapes selected root: {path}')
    current = path
    while current != root.parent:
        if current.is_symlink():
            raise ValueError(f'Symbolic-link path refused: {current}')
        if current == root:
            break
        current = current.parent


def validate_module_closure(source, selected):
    """Fail before copying if an original runtime module was not allowlisted."""
    allowed=set(selected)
    for name in selected:
        if not name.endswith(('.js','.py')):
            continue
        content=(source/name).read_text(encoding='utf-8-sig')
        references=[]
        if name.endswith('.js'):
            imports=re.findall(r'''(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]''',content)
            imports+=re.findall(r'''\bnew\s+URL\s*\(\s*['"](\.[^'"]+)['"]''',content)
            references.extend(posixpath.normpath(posixpath.join(posixpath.dirname(name),reference)) for reference in imports)
        else:
            for node in ast.walk(ast.parse(content,filename=name)):
                if isinstance(node,ast.ImportFrom) and node.level:
                    base=posixpath.dirname(name)
                    for _ in range(node.level-1):
                        base=posixpath.dirname(base)
                    modules=[node.module] if node.module else [alias.name for alias in node.names]
                    for module in modules:
                        references.append(posixpath.normpath(posixpath.join(base,module.replace('.','/')+'.py')))
                elif isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='with_name' and len(node.args)==1 and isinstance(node.args[0],ast.Constant) and isinstance(node.args[0].value,str) and node.args[0].value.endswith('.py'):
                    references.append(posixpath.normpath(posixpath.join(posixpath.dirname(name),node.args[0].value)))
        for relative in references:
            if relative not in allowed:
                raise ValueError(f'Runtime import is absent from the explicit allowlist: {name} -> {relative}')


def make_plan(destination, source=SOURCE):
    source, destination = Path(source).resolve(), Path(destination).absolute()
    if destination.name != PLUGIN_ID:
        raise ValueError('Destination directory must be named open_chart_editor')
    if within(destination, source) and not within(destination, SOURCE / 'tools' / '.host-runs'):
        raise ValueError('Destination may not overwrite source project files')
    ensure_plain(destination, destination.parent)
    manifest = json.loads((source / 'plugin.json').read_text(encoding='utf-8-sig'))
    if manifest.get('id') != PLUGIN_ID:
        raise ValueError('Source manifest has an unexpected plugin id')
    existing_manifest = destination / 'plugin.json'
    if existing_manifest.exists() and json.loads(existing_manifest.read_text(encoding='utf-8-sig')).get('id') != PLUGIN_ID:
        raise ValueError('Existing destination belongs to another plugin')
    files = []
    selected = RUNTIME_FILES + tuple(name for name in OPTIONAL_FILES if (source/name).is_file())
    validate_module_closure(source, selected)
    for name in selected:
        src, dst = source/name, destination/name
        ensure_plain(src, source)
        ensure_plain(dst, destination)
        if not src.is_file():
            raise ValueError(f'Required runtime file missing: {name}')
        content = src.read_bytes()
        if dst.exists() and not dst.is_file():
            raise ValueError(f'Existing destination is not a regular file: {dst}')
        old_digest = digest(dst.read_bytes()) if dst.is_file() else None
        new_digest = digest(content)
        files.append({'path':name,'bytes':len(content),'sha256':new_digest,
                      'existingSha256':old_digest,'action':'unchanged' if old_digest==new_digest else 'replace-with-backup' if old_digest else 'create'})
    source_digest = digest(json.dumps([(item['path'],item['sha256'])for item in files],separators=(',',':')).encode())
    return {'operation':'local-runtime-file-copy-only','source':str(source),'destination':str(destination),
            'pluginId':PLUGIN_ID,'version':manifest.get('version'),'sourceDigest':source_digest,
            'files':files,'deletes':[],'network':False,'gitOperations':False,
            'excluded':'All unlisted files, including .git, research, tests, node_modules, bytecode caches, fixture audio/PSARCs and builds',
            'existingEditorTouched':False}


def apply_plan(plan, *, expected_digest, backup_root=None):
    if not expected_digest or expected_digest != plan['sourceDigest']:
        raise ValueError('Apply requires the reviewed sourceDigest via --expect-source-digest')
    current = make_plan(plan['destination'], plan['source'])
    if current != plan:
        raise ValueError('Source or destination changed after planning; review a fresh plan')
    source, destination = Path(plan['source']), Path(plan['destination'])
    backup = Path(backup_root or SOURCE/'tools'/'.host-backups') / uuid.uuid4().hex
    writes = []
    for item in plan['files']:
        if item['action']=='unchanged':
            continue
        name = item['path']; src, dst = source/name, destination/name
        ensure_plain(dst,destination)
        content = src.read_bytes()
        if digest(content)!=item['sha256']:
            raise ValueError(f'Source changed during installation: {name}')
        before = digest(dst.read_bytes()) if dst.is_file() else None
        if before!=item['existingSha256']:
            raise ValueError(f'Destination changed during installation: {name}')
        if before is not None:
            saved = backup/name
            saved.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(dst,saved)
        dst.parent.mkdir(parents=True,exist_ok=True)
        # A source file is read once and checked; only this explicit file is
        # written. No recursive delete/move or directory-wide replacement.
        dst.write_bytes(content)
        if digest(dst.read_bytes())!=item['sha256']:
            raise ValueError(f'Installed content verification failed: {name}')
        writes.append(name)
    result = {**plan,'applied':True,'writtenFiles':writes,'backup':str(backup) if backup.exists() else None}
    if backup.exists():
        (backup/'install-record.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination',type=Path,default=DEFAULT_HOST/'plugins'/PLUGIN_ID)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--expect-source-digest')
    args=parser.parse_args(argv)
    try:
        plan=make_plan(args.destination)
        result=apply_plan(plan,expected_digest=args.expect_source_digest)if args.apply else plan
        print(json.dumps(result,indent=2))
        return 0
    except (OSError,ValueError)as error:
        print(json.dumps({'ok':False,'error':str(error)}))
        return 1


if __name__=='__main__':
    raise SystemExit(main())
