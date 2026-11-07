"""Stem splitting (source separation) client for Open Chart Editor.

OCE does not ship, install, or manage any separation engine itself. It is an
HTTP client of a separation server's API - most commonly a
feedBack-demucs-server instance (whether run standalone, via Docker, or
managed by FeedBack's own Stem Splitter plugin), reachable at a URL the user
supplies. The request/response shape implemented here (POST a file to
``{server_url}/separate``, optionally poll a ``job_id`` at ``/jobs/{id}``,
download named stem URLs) is a published HTTP API being interoperated with,
not vendored source - the same basis OCE already uses for the Rocksmith+ and
.rsw formats (see docs/provenance-audit.md).

OCE downloads nothing and installs nothing for this feature; it only ever
sends the current project's full-mix audio to a server address the user
configured, and reads stems back.
"""
from __future__ import annotations

import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Optional

ProgressCB = Optional[Callable[[float, str], None]]

DEFAULT_MODEL = 'bs_roformer_sw'
_JOB_POLL_INTERVAL = 5
_JOB_TIMEOUT = 35 * 60

# Canonical stem ids OCE's spectrum/stem UI understands (src/spectrum-stems.js).
# A separation server's stem labels vary ("no_vocals", "instrumental", ...);
# map them onto a canonical id instead of trusting the raw label verbatim.
_STEM_ALIASES = {
    'vocals': 'vocals', 'vocal': 'vocals', 'voice': 'vocals',
    'drums': 'drums', 'drum': 'drums',
    'bass': 'bass',
    'guitar': 'guitar', 'guitars': 'guitar',
    'piano': 'piano', 'keys': 'piano', 'keyboard': 'piano',
    'other': 'other',
    'instrumental': 'other', 'instruments': 'other', 'instrument': 'other',
    'music': 'other', 'accompaniment': 'other',
    'no_vocals': 'other', 'novocals': 'other',
}


def _sanitize(name: str) -> str:
    s = re.sub(r'[^A-Za-z0-9._-]+', '_', name).strip('_').lower()
    return s or 'stem'


def normalize_stem_id(raw_name: str) -> str | None:
    s = re.sub(r'[^a-z0-9]+', '_', raw_name.lower()).strip('_')
    for alias in sorted(_STEM_ALIASES, key=len, reverse=True):
        if re.search(rf'(^|_){re.escape(alias)}(_|$)', s):
            return _STEM_ALIASES[alias]
    return None


def _origin(url: str) -> tuple[str, str, int | None] | None:
    try:
        s = urllib.parse.urlsplit(url)
        port = s.port
    except ValueError:
        return None
    scheme = (s.scheme or '').lower()
    if port is None:
        port = {'http': 80, 'https': 443}.get(scheme)
    return (scheme, (s.hostname or '').lower(), port)


def _same_origin(url: str, server_url: str) -> bool:
    """Never let an API key ride along to a host the server merely redirected to."""
    return _origin(url) == _origin(server_url)


def _request(method: str, url: str, *, headers: dict | None = None, data: bytes | None = None,
             timeout: float = 60.0):
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        return exc  # has .status/.read() like a normal response, for uniform error handling


def _get_authed(url: str, server_url: str, headers: dict | None, timeout: float):
    """GET url, following redirects by hand so headers (an API key) are only sent
    while still talking to the configured server's own origin."""
    for _ in range(6):
        hop_headers = headers if _same_origin(url, server_url) else None
        response = _request('GET', url, headers=hop_headers, timeout=timeout)
        status = getattr(response, 'status', None) or getattr(response, 'code', None)
        if status in (301, 302, 303, 307, 308):
            location = response.headers.get('Location')
            if not location:
                return response, url
            url = urllib.parse.urljoin(url, location)
            continue
        return response, url
    raise RuntimeError('split server sent too many redirects')


def _multipart_body(field: str, filename: str, content_type: str, data: bytes) -> tuple[bytes, str]:
    boundary = '----oceStemSplit' + str(int(time.time() * 1000))
    parts = [
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        f'Content-Type: {content_type}\r\n\r\n'.encode('utf-8'),
        data,
        f'\r\n--{boundary}--\r\n'.encode('utf-8'),
    ]
    return b''.join(parts), f'multipart/form-data; boundary={boundary}'


def split_full_mix(audio_bytes: bytes, filename: str, *, server_url: str, model: str | None = None,
                   api_key: str | None = None,
                   progress_cb: ProgressCB = None, cancel_cb: Callable[[], None] | None = None) -> dict:
    """POST one full-mix audio blob to a separation server and return its stems.

    Returns ``{"stems": [{"id", "codec", "bytes"}, ...], "stem_separation":
    {"engine", "model", "version"}}``. Raises ``RuntimeError`` on any server
    or protocol failure. Never writes into a project - that merge happens on
    the frontend (``src/stem-split.js``).
    """
    if not server_url:
        raise RuntimeError('No split server URL is configured')
    server_url = server_url.rstrip('/')
    model = model or DEFAULT_MODEL
    suffix = Path(filename or 'mix.wav').suffix.lower() or '.wav'
    content_type = 'audio/wav' if suffix == '.wav' else 'audio/ogg'
    body, content_header = _multipart_body('file', 'mix' + suffix, content_type, audio_bytes)
    headers = {'Content-Type': content_header}
    if api_key:
        headers['X-API-Key'] = api_key

    if progress_cb:
        progress_cb(0.1, f'Uploading to split server ({server_url})')
    url = f'{server_url}/separate?{urllib.parse.urlencode({"model": model})}'
    response = _request('POST', url, headers=headers, data=body, timeout=600)
    status = getattr(response, 'status', None) or getattr(response, 'code', None)
    payload = response.read()
    if status != 200:
        raise RuntimeError(f'split server error ({status}): {payload[:2000].decode("utf-8", "replace")}')

    import json
    data = json.loads(payload)
    stem_urls = data.get('stems') or {}
    if not stem_urls and data.get('job_id'):
        job_id = data['job_id']
        deadline = time.time() + _JOB_TIMEOUT
        while time.time() < deadline:
            if cancel_cb:
                cancel_cb()
            time.sleep(_JOB_POLL_INTERVAL)
            job_response, _ = _get_authed(f'{server_url}/jobs/{job_id}', server_url, headers, timeout=30)
            job_status = getattr(job_response, 'status', None) or getattr(job_response, 'code', None)
            if job_status != 200:
                raise RuntimeError(f'split server job poll failed ({job_status})')
            job_data = json.loads(job_response.read())
            state = job_data.get('status')
            if state == 'complete':
                stem_urls = job_data.get('stems') or {}
                break
            if state == 'failed':
                raise RuntimeError(f'split server job failed: {job_data.get("error")}')
            if progress_cb:
                pct = job_data.get('progress')
                detail = f'{pct}%' if isinstance(pct, (int, float)) else (state or 'working')
                progress_cb(0.4, f'Separating on server ({detail})')
        else:
            raise RuntimeError(f'split server job timed out after {_JOB_TIMEOUT // 60} min')
    if not stem_urls:
        raise RuntimeError('split server returned no stems')

    if progress_cb:
        progress_cb(0.8, 'Downloading stems')
    stems: list[dict] = []
    seen_ids: set[str] = set()
    for name, stem_url in stem_urls.items():
        if isinstance(stem_url, str) and stem_url.startswith('/'):
            stem_url = f'{server_url}{stem_url}'
        stem_response, final_url = _get_authed(stem_url, server_url, headers, timeout=180)
        stem_status = getattr(stem_response, 'status', None) or getattr(stem_response, 'code', None)
        if stem_status != 200:
            raise RuntimeError(f"stem download failed for '{name}': HTTP {stem_status}")
        stem_id = normalize_stem_id(name) or _sanitize(name)
        if stem_id in seen_ids:
            continue
        seen_ids.add(stem_id)
        ext = Path(str(final_url).split('?', 1)[0]).suffix.lower()
        codec = {'ogg': 'vorbis', 'flac': 'flac', 'mp3': 'mp3', 'm4a': 'aac'}.get(ext.lstrip('.'), 'pcm')
        stems.append({'id': stem_id, 'codec': codec, 'bytes': stem_response.read()})

    if progress_cb:
        progress_cb(1.0, 'Done')
    return {
        'stems': stems,
        'stem_separation': {'engine': 'bs-roformer', 'model': model, 'version': '1.0.0'},
    }
