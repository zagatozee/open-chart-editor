"""Working-folder browser (issue #31): user-configured root folders, a cheap
directory tree, and per-song-folder instrument tags computed WITHOUT a full
import. Reuses folder_io's path-safety discipline for every filesystem walk;
never returns raw chart bytes (only tags) - opening a song still goes through
the existing folder_io.snapshot_directory -> export_targets.load_folder_archive
pipeline untouched.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import stat
import yaml
import zipfile
from xml.etree import ElementTree as ET

from fastapi import HTTPException
from fastapi.responses import Response

try:
    from . import folder_io, eof_io, rplus_io
except ImportError:
    import folder_io, eof_io, rplus_io

ROOTS_FILENAME = '.oce-folder-roots.json'
MAX_ROOTS = 32
MAX_ENTRIES_PER_LISTING = 20000
# Same set routes.py guards uploaded audio with; duplicated here (not imported)
# to avoid a routes.py <-> folder_browser.py import cycle.
AUDIO_EXTENSIONS = {'.wav', '.ogg', '.mp3', '.flac', '.opus', '.m4a', '.aac', '.wem'}
# Single-file packaged song archives (library_source.py's own EXTENSIONS) -
# these sit as individual files in a folder, not folders themselves, so they
# need their own leaf detection separate from the loose-folder formats above.
FEEDPAK_ARCHIVE_EXTENSIONS = {'.feedpak', '.sloppak'}

CATEGORIES = ('lead', 'rhythm', 'bass', 'vocals', 'piano', 'drums', 'other')


class FolderBrowserError(ValueError):
    pass


def _empty_tags():
    return {category: False for category in CATEGORIES} | {'humstrum': False, 'audio': False}


# --- Configured roots -------------------------------------------------------

def _roots_path(plugin_dir):
    return Path(plugin_dir) / ROOTS_FILENAME


def read_roots(plugin_dir):
    path = _roots_path(plugin_dir)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except ValueError:
        return []
    roots = data.get('roots') if isinstance(data, dict) else None
    return [root for root in roots if isinstance(root, str)] if isinstance(roots, list) else []


def _validate_root(value):
    if not isinstance(value, str) or not value.strip():
        raise FolderBrowserError('Each working-folder root must be a non-empty path')
    path = Path(value)
    if path.is_symlink():
        raise FolderBrowserError(f'Working-folder root may not itself be a symlink/junction: {value}')
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise FolderBrowserError(f'Working-folder root is unavailable: {value}') from exc
    if not resolved.is_dir():
        raise FolderBrowserError(f'Working-folder root is not a directory: {value}')
    return str(resolved)


def write_roots(plugin_dir, roots):
    if not isinstance(roots, list) or len(roots) > MAX_ROOTS:
        raise FolderBrowserError(f'Choose at most {MAX_ROOTS} working-folder roots')
    resolved = [_validate_root(root) for root in roots]
    if len(set(resolved)) != len(resolved):
        raise FolderBrowserError('Duplicate working-folder roots')
    _roots_path(plugin_dir).write_text(json.dumps({'roots': resolved}, indent=2), encoding='utf-8')
    return resolved


# --- Format detection (song-folder shape, by filename only) -----------------

def _names(directory):
    out = []
    for entry in directory.iterdir():
        info = entry.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            continue  # never follow links/junctions while walking a configured root
        out.append((entry.name, stat.S_ISDIR(info.st_mode)))
    return out


def detect_format(directory, names):
    lowered = {name.lower() for name, is_dir in names if not is_dir}
    if 'manifest.json' in lowered or 'source-manifest.json' in lowered or 'manifest.yaml' in lowered or 'manifest.yml' in lowered:
        return 'feedpak'
    if any(rplus_io.CHART_NAME.fullmatch(name) for name, is_dir in names if not is_dir) or \
            any(name.lower().startswith('lyrics_') and name.lower().endswith('.xml') for name in lowered):
        return 'rplus'
    if 'notes.eof' in lowered:
        return 'eof'
    if any(name.endswith('.rscp') for name in lowered):
        return 'charter'
    for name, is_dir in names:
        if is_dir or not name.lower().endswith('.xml'):
            continue
        try:
            head = (directory / name).read_bytes()[:512]
        except OSError:
            continue
        if b'<track' in head:
            return 'gpa'
    return None


# --- Per-format tag sniffers (cheap: no full note/chord materialization) ----

_RPLUS_CATEGORY = {'lead': 'lead', 'simple': 'lead', 'altlead': 'lead',
                    'rhythm': 'rhythm', 'bass': 'bass', 'altbass': 'bass', 'keyboard': 'piano'}
_RPLUS_HUMSTRUM = {'humstrum', 'altrhythm'}


def _sniff_rplus(directory, names):
    tags = _empty_tags()
    for name, is_dir in names:
        if is_dir:
            continue
        match = rplus_io.CHART_NAME.fullmatch(name)
        if match:
            kind = match.group(2).lower()
            if kind in _RPLUS_HUMSTRUM:
                tags['humstrum'] = True
            elif kind in _RPLUS_CATEGORY:
                tags[_RPLUS_CATEGORY[kind]] = True
            else:
                tags['other'] = True
        elif name.lower().startswith('lyrics_') and name.lower().endswith('.xml'):
            tags['vocals'] = True
        elif Path(name).suffix.lower() in AUDIO_EXTENSIONS:
            tags['audio'] = True
    return tags


def _sniff_eof(directory, names):
    tags = _empty_tags()
    data = (directory / 'notes.eof').read_bytes()
    parsed = eof_io.parse_eof(data)
    for track in parsed['tracks']:
        fmt = track['format']
        label = f"{track.get('name', '')} {track.get('altname', '')}".lower()
        if fmt == eof_io.TRACK_FORMAT_PRO_GUITAR:
            if not track['notes']:
                continue
            if track['numstrings'] == 4:
                tags['bass'] = True
            elif 'rhythm' in label:
                tags['rhythm'] = True
            else:
                tags['lead'] = True
        elif fmt == eof_io.TRACK_FORMAT_VOCAL:
            if track.get('lyric_count', 0):
                tags['vocals'] = True
        elif fmt == eof_io.TRACK_FORMAT_PRO_KEYS:
            if track.get('chord_count', 0):
                tags['piano'] = True
        elif fmt in (eof_io.TRACK_FORMAT_LEGACY, eof_io.TRACK_FORMAT_VARIABLE_LEGACY):
            if track.get('note_count', 0):
                tags['drums' if 'drum' in label else 'other'] = True
    for name, is_dir in names:
        if not is_dir and Path(name).suffix.lower() in AUDIO_EXTENSIONS:
            tags['audio'] = True
    return tags


def _feedpak_manifest_tags(manifest):
    tags = _empty_tags()
    for entry in manifest.get('arrangements') or []:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get('type') or '').lower()
        name = str(entry.get('name') or '').lower()
        if kind == 'bass':
            tags['bass'] = True
        elif kind == 'keys':
            tags['piano'] = True
        elif kind == 'drums':
            tags['drums'] = True
        elif kind == 'guitar':
            tags['rhythm' if 'rhythm' in name else 'lead'] = True
        elif kind:
            tags['other'] = True
    if manifest.get('lyrics') or manifest.get('lyric_tracks'):
        tags['vocals'] = True
    return tags


def _sniff_feedpak(directory, names):
    lowered = {name for name, is_dir in names if not is_dir}
    for candidate in ('manifest.yaml', 'manifest.yml'):
        if candidate in lowered:
            manifest = yaml.safe_load((directory / candidate).read_text(encoding='utf-8-sig'))
            tags = _feedpak_manifest_tags(manifest if isinstance(manifest, dict) else {})
            break
    else:
        candidate = 'manifest.json' if 'manifest.json' in lowered else 'source-manifest.json'
        manifest = json.loads((directory / candidate).read_text(encoding='utf-8-sig'))
        tags = _feedpak_manifest_tags(manifest if isinstance(manifest, dict) else {})
    for name, is_dir in names:
        if not is_dir and Path(name).suffix.lower() in AUDIO_EXTENSIONS:
            tags['audio'] = True
    return tags


def _sniff_feedpak_archive(path):
    """A single packaged .feedpak/.sloppak file: same manifest-only reading
    as _sniff_feedpak, just from inside the zip instead of loose files on
    disk - these are OCE's own native save format, so this is the most
    common leaf shape a real library actually has, not an edge case."""
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        for candidate in ('manifest.yaml', 'manifest.yml'):
            if candidate in names:
                manifest = yaml.safe_load(archive.read(candidate).decode('utf-8-sig'))
                break
        else:
            candidate = 'manifest.json' if 'manifest.json' in names else 'source-manifest.json'
            if candidate not in names:
                raise FolderBrowserError(f'{path.name} has no recognizable manifest')
            manifest = json.loads(archive.read(candidate).decode('utf-8-sig'))
        tags = _feedpak_manifest_tags(manifest if isinstance(manifest, dict) else {})
        if any(Path(name).suffix.lower() in AUDIO_EXTENSIONS for name in names):
            tags['audio'] = True
    return tags


_CHARTER_KIND = {'Bass': 'bass', 'Lead': 'lead', 'Rhythm': 'rhythm', 'Combo': 'lead'}


def _sniff_charter(directory, names):
    tags = _empty_tags()
    rscp = next(name for name, is_dir in names if not is_dir and name.lower().endswith('.rscp'))
    root = ET.fromstring((directory / rscp).read_bytes())
    for element in root.findall('./arrangements/arrangement'):
        level = element.find('./levels/level')
        authored = level is not None and (level.find('./sounds/sound') is not None)
        if not authored:
            continue
        category = _CHARTER_KIND.get(element.get('type', 'Lead'), 'other')
        tags[category] = True
    for name, is_dir in names:
        if not is_dir and Path(name).suffix.lower() in AUDIO_EXTENSIONS:
            tags['audio'] = True
    return tags


def sniff_tags(folder_format, directory, names):
    if folder_format == 'rplus':
        return _sniff_rplus(directory, names)
    if folder_format == 'eof':
        return _sniff_eof(directory, names)
    if folder_format == 'feedpak':
        return _sniff_feedpak(directory, names)
    if folder_format == 'charter':
        return _sniff_charter(directory, names)
    return None  # 'gpa' (and anything unrecognized): format badge only, no per-instrument dots


# --- Tree listing -------------------------------------------------------

def list_tree(root, *, budget=None):
    """One level of a configured root (or a directory beneath it): song-folder
    leaves carry `tags`/`format`; plain directories carry `children` (lazily
    listed again by the caller, one `list_tree` call per expansion - this
    function itself only recurses to find format detection cheaply, never to
    build the whole tree at once)."""
    directory = Path(root)
    budget = {'left': MAX_ENTRIES_PER_LISTING} if budget is None else budget
    return _list_one(directory, budget)


def _list_one(directory, budget):
    if budget['left'] <= 0:
        raise FolderBrowserError('Working-folder root has too many entries to list at once')
    budget['left'] -= 1
    try:
        names = _names(directory)
    except OSError as exc:
        raise FolderBrowserError(f'Could not read folder: {directory}') from exc
    folder_format = detect_format(directory, names)
    if folder_format:
        tags = sniff_tags(folder_format, directory, names)
        return {'name': directory.name, 'kind': 'song', 'format': folder_format, 'tags': tags}
    children = []
    for name, is_dir in sorted(names):
        if not is_dir:
            if Path(name).suffix.lower() in FEEDPAK_ARCHIVE_EXTENSIONS:
                try:
                    tags = _sniff_feedpak_archive(directory / name)
                except (FolderBrowserError, zipfile.BadZipFile, OSError, ValueError, KeyError):
                    continue  # an unreadable archive just doesn't show up, same as an unreadable subfolder
                children.append({'name': Path(name).stem, 'kind': 'song', 'format': 'feedpak', 'tags': tags, 'file': name})
            continue
        child_path = directory / name
        try:
            children.append(_list_one(child_path, budget))
        except FolderBrowserError:
            continue  # an unreadable subfolder just doesn't show up, rather than failing the whole tree
    return {'name': directory.name, 'kind': 'group', 'children': children}


def resolve_song_folder(root, segments):
    """Walk plain path segments (as handed back by list_tree's own node names)
    down from a configured root, refusing symlinks/escapes at every step -
    the same discipline folder_io._plain already applies to uploaded folders.
    The final segment may name a directory (a loose song folder) or a single
    packaged file (a .feedpak/.sloppak archive leaf) - every segment before
    it must still be a directory."""
    directory = Path(root).resolve(strict=True)
    current = directory
    for index, segment in enumerate(segments):
        if not isinstance(segment, str) or not segment or segment in ('.', '..') or '/' in segment or '\\' in segment:
            raise FolderBrowserError('Invalid working-folder path segment')
        current = current / segment
        folder_io._plain(current, directory)
        last = index == len(segments) - 1
        if not current.is_dir() and not (last and current.is_file()):
            raise FolderBrowserError('That working folder no longer exists')
    return current


# --- FastAPI endpoints -------------------------------------------------------

def install_folder_browser(app, context=None, *, max_bytes):
    context = context or {}
    plugin_dir = context.get('plugin_dir') or str(Path(__file__).resolve().parent)

    @app.get('/api/plugins/open_chart_editor/folder-roots')
    async def get_roots():
        return {'roots': read_roots(plugin_dir)}

    @app.post('/api/plugins/open_chart_editor/folder-roots')
    async def set_roots(payload: dict):
        try:
            roots = write_roots(plugin_dir, payload.get('roots') if isinstance(payload, dict) else None)
        except FolderBrowserError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {'roots': roots}

    @app.get('/api/plugins/open_chart_editor/folder-tree')
    async def get_tree(root: int):
        roots = read_roots(plugin_dir)
        if not 0 <= root < len(roots):
            raise HTTPException(400, 'Unknown working-folder root index')
        try:
            return await asyncio.to_thread(list_tree, roots[root])
        except FolderBrowserError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post('/api/plugins/open_chart_editor/folder-open')
    async def open_song_folder(payload: dict):
        roots = read_roots(plugin_dir)
        index = payload.get('root') if isinstance(payload, dict) else None
        segments = payload.get('path') if isinstance(payload, dict) else None
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(roots) or not isinstance(segments, list):
            raise HTTPException(400, 'Invalid folder-open request')
        try:
            resolved = await asyncio.to_thread(resolve_song_folder, roots[index], segments)
            if resolved.is_file():
                if resolved.suffix.lower() not in FEEDPAK_ARCHIVE_EXTENSIONS:
                    raise FolderBrowserError('Only packaged song archives can be opened directly')
                if resolved.stat().st_size > max_bytes:
                    raise FolderBrowserError('This archive exceeds the OCE import limit')
                data = await asyncio.to_thread(resolved.read_bytes)
            else:
                data = await asyncio.to_thread(folder_io.snapshot_directory, resolved, max_bytes)
        except (FolderBrowserError, folder_io.FolderError, OSError) as exc:
            raise HTTPException(400, str(exc)) from exc
        return Response(data, media_type='application/octet-stream', headers={'Cache-Control': 'no-store'})

    return get_roots, set_roots, get_tree, open_song_folder
