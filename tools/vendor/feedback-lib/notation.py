"""Notation format vocabulary and wire helpers.

The canonical notation payload for a feedpak arrangement is a per-arrangement
``notation_<id>.json`` file referenced from the arrangement entry in
``manifest.yaml`` via the ``notation:`` sub-key (see
``docs/feedpak-spec.md`` §5).

This module is the source of truth for:

- the closed vocabulary of valid clef identifiers and note durations,
- a permissive validator used by both the feedpak loader and importers,
- wire helpers that normalise measure data for WS streaming.

The schema is intentionally extensible: unknown fields round-trip through
the loader so a newer feedpak can still render on an older client that just
doesn't have visuals for the new field. Validation is strict only on the
required top-level shape (``version``, ``staves``, ``measures`` types).

Analogous to ``lib/drums.py`` for the drum tab format.
"""

from __future__ import annotations

import logging
import math
from decimal import ROUND_HALF_UP, Context, Decimal

log = logging.getLogger("feedBack.lib.notation")


# ── Vocabulary ────────────────────────────────────────────────────────────────

# Current ``version`` written by importers. Readers MUST accept any version
# they recognise; an unknown version is logged at DEBUG and passed through
# (forward-compat per feedpak-spec Principle IV).
SCHEMA_VERSION: int = 1

# Closed set of alphaTab clef identifiers.
# G2      — treble clef (standard guitar, violin, flute, …)
# F4      — bass clef (piano left hand, bass, cello, …)
# C3      — alto clef (viola)
# C4      — tenor clef (cello upper register, trombone)
# neutral — unpitched / percussion staff
CLEFS: set[str] = {"G2", "F4", "C3", "C4", "neutral"}

# Valid note duration denominators (integer powers of 2, up to 32nd note).
# 1=whole, 2=half, 4=quarter, 8=eighth, 16=sixteenth, 32=thirty-second.
DURATIONS: set[int] = {1, 2, 4, 8, 16, 32}

# Typed grace-note vocabulary (beat field ``grace``).
# "a" — acciaccatura: slashed grace, steals time from the PREVIOUS note
#       (MusicXML <grace slash="yes">).
# "p" — appoggiatura: unslashed grace, steals time from the FOLLOWING note
#       (MusicXML <grace>).
GRACE_TYPES: set[str] = {"a", "p"}

# Forced stem directions (note field ``stem``). Omit to let the renderer
# decide (MusicXML <stem>).
STEM_DIRECTIONS: set[str] = {"up", "down"}

# Dynamics vocabulary (beat field ``dyn``).
DYNAMICS: set[str] = {"ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"}


# ── Schema validation ─────────────────────────────────────────────────────────

def validate_notation(data: object) -> tuple[bool, str]:
    """Light schema check for a parsed ``notation_<id>.json`` payload.

    Returns ``(ok, reason)``.  Permissive: unknown top-level fields pass
    through unchanged.  Strict only on the required top-level shape:

    - ``data`` must be a JSON object (dict).
    - ``data["version"]`` must be an int when present.  A missing ``version``
      key is accepted as ``SCHEMA_VERSION``.  An unknown version value is
      logged at DEBUG level and still accepted — forward-compat.
    - ``data["staves"]`` must be a list.
    - ``data["measures"]`` must be a list.
    """
    if not isinstance(data, dict):
        return False, "notation payload must be a JSON object"

    # version — optional, must be int when present (bool subclasses int, reject)
    ver = data.get("version", SCHEMA_VERSION)
    if isinstance(ver, bool) or not isinstance(ver, int):
        return False, "notation.version must be an integer"
    if ver != SCHEMA_VERSION:
        log.debug("notation: unknown schema version %r — passing through", ver)

    # staves — required list
    if "staves" not in data:
        return False, "notation.staves is required"
    if not isinstance(data["staves"], list):
        return False, "notation.staves must be a list"

    # measures — required list
    if "measures" not in data:
        return False, "notation.measures is required"
    if not isinstance(data["measures"], list):
        return False, "notation.measures must be a list"

    return True, ""


# ── Key label ─────────────────────────────────────────────────────────────────

# A key signature's accidental count (measure ``ks``: -7 = seven flats … +7 = seven sharps)
# names a major key and its relative minor; the mode isn't recorded, so both are shown.
_KS_LABELS = (
    "Cb / Abm", "Gb / Ebm", "Db / Bbm", "Ab / Fm", "Eb / Cm", "Bb / Gm", "F / Dm", "C / Am",
    "G / Em", "D / Bm", "A / F#m", "E / C#m", "B / G#m", "F# / D#m", "C# / A#m",
)


def key_label(keys_events: object, notation: object) -> str:
    """The key a keys part shows: the song's earliest ``keys.json`` key ("Em", clipped to
    24 chars; the order ``load_song`` uses, so the library and the HUD agree), else the
    notation's first-measure key signature ("C / Am"), else ''."""
    keys = []
    for ev in keys_events if isinstance(keys_events, list) else ():
        t = ev.get("t") if isinstance(ev, dict) else None
        key = ev.get("key") if isinstance(ev, dict) else None
        if (isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t)
                and isinstance(key, str) and key.strip()):
            keys.append((t, key.strip()[:24]))
    if keys:
        return min(keys, key=lambda k: k[0])[1]
    measures = notation.get("measures") if isinstance(notation, dict) else None
    first = measures[0] if isinstance(measures, list) and measures else None
    ks = first.get("ks") if isinstance(first, dict) else None
    if isinstance(ks, int) and not isinstance(ks, bool) and -7 <= ks <= 7:
        return _KS_LABELS[ks + 7]
    return ""


# ── Wire helpers ──────────────────────────────────────────────────────────────

def _finite_float_wire(v: object, fallback: float = 0.0) -> float:
    """Return ``float(v)`` if finite, else ``fallback``.

    Prevents NaN/Infinity from reaching the WS JSON encoder where they would
    produce non-standard tokens that break browser ``JSON.parse`` calls.
    """
    try:
        f = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback
    return f if math.isfinite(f) else fallback


def measure_to_wire(measure: object) -> dict:
    """Normalise one measure dict for WS streaming.

    - Returns a shallow copy of the measure; the input is not mutated.
    - The measure-level ``t`` (start time) and ``tempo`` fields are guarded
      against NaN/Infinity — non-finite values fall back to 0.0 so the
      highway WS frame always carries valid JSON.
    - Beat times (``beats[].t`` inside each voice of each staff) are rounded
      to 3 decimal places and carry the same finite guard, matching the
      precision used by ``drums.hit_to_wire``.
    - Fields equal to their default value are NOT stripped here — that is the
      file author's responsibility.  The wire helper is pass-through with time
      normalisation only.
    - Malformed input (non-dict) returns an empty dict so callers can skip it.
    """
    if not isinstance(measure, dict):
        return {}

    # Shallow-copy the top level so callers can't mutate our data.
    out = dict(measure)

    # Guard measure-level numeric fields against NaN/Infinity.
    # ``t`` — measure start time in seconds; ``tempo`` — BPM at this measure.
    for _field in ("t", "tempo"):
        if _field in out and isinstance(out[_field], (int, float)) and not isinstance(out[_field], bool):
            out[_field] = _finite_float_wire(out[_field])

    # Deep-round beat times inside staves → voices → beats → t.
    # We copy each level we touch to avoid mutating the source.
    staves_raw = out.get("staves")
    if isinstance(staves_raw, dict):
        staves_out: dict = {}
        for staff_id, staff_data in staves_raw.items():
            if not isinstance(staff_data, dict):
                staves_out[staff_id] = staff_data
                continue
            staff_out = dict(staff_data)
            voices_raw = staff_out.get("voices")
            if isinstance(voices_raw, list):
                voices_out = []
                for voice in voices_raw:
                    if not isinstance(voice, dict):
                        voices_out.append(voice)
                        continue
                    voice_out = dict(voice)
                    beats_raw = voice_out.get("beats")
                    if isinstance(beats_raw, list):
                        beats_out = []
                        for beat in beats_raw:
                            if not isinstance(beat, dict):
                                beats_out.append(beat)
                                continue
                            beat_out = dict(beat)
                            t = beat_out.get("t")
                            if isinstance(t, (int, float)) and not isinstance(t, bool):
                                # Guard against NaN/Infinity: json.loads accepts
                                # them but they serialize to invalid JSON tokens
                                # over the highway WS, breaking clients.
                                beat_out["t"] = round(_finite_float_wire(t), 3)
                            beats_out.append(beat_out)
                        voice_out["beats"] = beats_out
                    voices_out.append(voice_out)
                staff_out["voices"] = voices_out
            staves_out[staff_id] = staff_out
        out["staves"] = staves_out

    return out


def measures_to_wire(measures: list[dict]) -> list[dict]:
    """Vectorised ``measure_to_wire``.

    Drops entries that round-trip as empty dicts (i.e. malformed non-dict
    entries).  Preserves source order — does NOT sort by time.
    """
    out: list[dict] = []
    for m in measures:
        w = measure_to_wire(m)
        if w:
            out.append(w)
    return out


# ── Notation → flat notes (for editors / falling-note renderers) ──────────────
#
# The same rules as static/js/notation.js notes() (lesson-format §3.2.2), for the
# Python side: tests/fixtures/notation_notes_cases.json runs through both
# (tests/test_notation_to_notes.py, tests/js/notation_notes_cases.test.js).
# Change both together.

# A note never sounds shorter than this (a 32nd at a fast tempo stays visible).
MIN_DUR_S = 0.05
# Sounding length of a voice's last note when no tempo has been seen.
LAST_NOTE_S = 2.0


def _number(v: object) -> float:
    """JS ``Number(v)``: None → 0, a bool is 0/1, a numeric string counts, anything
    else that is not a number is NaN."""
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, (int, float)):
        try:
            return float(v)
        except OverflowError:   # a JSON integer too large for a float: JS reads it as Infinity
            return math.inf if v > 0 else -math.inf
    if isinstance(v, str):
        if not v.strip():
            return 0.0
        try:
            return float(v)
        except ValueError:
            return math.nan
    return math.nan


def _truthy(v: object) -> bool:
    """JS truthiness (an empty list or dict is true there)."""
    if isinstance(v, (list, dict)):
        return True
    return bool(v) and not (isinstance(v, float) and math.isnan(v))


def _time_of(v: object) -> float | None:
    """A finite time in seconds (a numeric string counts), else None."""
    if isinstance(v, str) and not v.strip():
        return None
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        return None
    n = _number(v)
    return n if math.isfinite(n) else None


def _pitch_of(v: object) -> int | None:
    """An integer pitch 0–127 (a numeric string counts), else None."""
    n = _time_of(v)
    if n is None or n != int(n):
        return None
    return int(n) if 0 <= n <= 127 else None


def _beat_seconds(beat: dict, tempo: float | None) -> float | None:
    """Written length of a beat in seconds at ``tempo`` BPM: (60/tempo) × (4/dur),
    dots multiply by 2 − 2^(−dot), a tuplet [num, den] by den/num. None when dur or
    tempo is unusable, or the product is not a finite positive number."""
    dur = _number(beat.get("dur"))
    if not math.isfinite(dur) or dur <= 0 or tempo is None or not math.isfinite(tempo) or tempo <= 0:
        return None
    dot = _number(beat.get("dot"))
    if math.isnan(dot):
        dot = 0.0
    tu = beat.get("tu")
    tu_mult = 1.0
    if isinstance(tu, list) and len(tu) == 2 and _number(tu[0]) > 0 and _number(tu[1]) > 0:
        tu_mult = _number(tu[1]) / _number(tu[0])
    try:
        s = (60.0 / tempo) * (4.0 / dur) * (2.0 - math.pow(2.0, -dot)) * tu_mult
    except (OverflowError, ValueError):
        return None
    return s if math.isfinite(s) and s > 0 else None


def _ms_key(t: float) -> str:
    """``t`` to the millisecond as the text JS ``toFixed(3)`` gives (ties round up)."""
    return str(Decimal(t + 0.0).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP, context=Context(prec=400)))


def notation_to_notes(notation: object) -> list[dict]:
    """Flatten a notation payload to ``[{"t", "midi", "sus", "hand", "staff"}, ...]``
    sorted by ``(t, midi)`` — absolute onset seconds, absolute MIDI pitch, how long
    it sounds, and the staff it is on (``hand`` is ``"rh"`` / ``"lh"`` for those
    staves, else None). The rules are those of ``static/js/notation.js`` ``notes()``,
    lesson-format §3.2.2; ``sus`` is its ``durS``.

    - ``t`` is the beat's ``t``; a beat without a finite one is skipped; a rest is no
      note; a grace note is a note at its own ``t``.
    - ``sus`` is the written length at the running tempo (tempo carries across
      measures that omit it), plus tied continuations. Until a tempo is seen, the
      gap to the next onset in the voice (``LAST_NOTE_S`` for the last). Never past
      the next onset of that pitch on the same staff (a grace note does not cut the
      note before it, which may be tied through it); at least ``MIN_DUR_S``.
    - A note with ``tied`` continues the last note of that pitch in the same staff
      and voice (a grace note is never that note); with none before it, it is a
      note of its own.
    - The same pitch at the same ``t`` (to the ms) on one staff is one note: the
      longer ``sus`` wins.

    Malformed measures, beats and notes are skipped; anything but a dict with a
    list of ``measures`` gives ``[]``; it never raises. Known limits, shapes the
    spec does not allow: a numeral string is read by ``float()``, not JS ``Number()``
    ("1_0", "0x10" and ``[8]`` differ), a voice id ``1.0`` is not ``1``, staff keys
    keep file order, and a list for ``staves`` is ignored.
    """
    measures = notation.get("measures") if isinstance(notation, dict) else None
    measures = [m for m in measures if isinstance(m, dict)] if isinstance(measures, list) else []

    def voices_of(measure: dict) -> list[tuple]:
        out = []
        staves = measure.get("staves")
        if not isinstance(staves, dict):
            return out
        for staff_id, staff in staves.items():
            voices = staff.get("voices") if isinstance(staff, dict) else None
            if not isinstance(voices, list):
                continue
            for voice in voices:
                if isinstance(voice, dict) and isinstance(voice.get("beats"), list):
                    v = voice.get("v")
                    out.append((staff_id, f"{staff_id}|{1 if v is None else v}", voice["beats"]))
        return out

    # Each voice's beats across measures, by time: the next-onset fallback looks ahead in it.
    by_voice: dict[str, list[dict]] = {}
    for measure in measures:
        for _, vid, beats in voices_of(measure):
            tl = by_voice.setdefault(vid, [])
            tl.extend(b for b in beats if isinstance(b, dict) and _time_of(b.get("t")) is not None)
    position: dict[int, int] = {}
    for tl in by_voice.values():
        tl.sort(key=lambda b: _time_of(b.get("t")))
        for i, b in enumerate(tl):
            position.setdefault(id(b), i)

    # In measure order, so the running tempo is the one in force.
    out: list[dict] = []
    last: dict[str, int] = {}    # "staff|voice|midi" → out index (tie origins)
    graces: set[int] = set()     # id() of the out entries that are grace notes
    tempo: float | None = None
    for measure in measures:
        m_tempo = _number(measure.get("tempo"))
        if math.isfinite(m_tempo) and m_tempo > 0:
            tempo = m_tempo
        for staff_id, vid, beats in voices_of(measure):
            for beat in beats:
                if not isinstance(beat, dict) or _truthy(beat.get("rest")):
                    continue
                t = _time_of(beat.get("t"))
                if t is None:
                    continue
                dur_s = _beat_seconds(beat, tempo)
                if dur_s is None:
                    tl = by_voice.get(vid, [])
                    i = position.get(id(beat), -1)
                    nxt = next((b for b in tl[i + 1:] if not _truthy(b.get("rest"))), None) if i >= 0 else None
                    dur_s = max(MIN_DUR_S, _time_of(nxt.get("t")) - t) if nxt else LAST_NOTE_S
                grace = _truthy(beat.get("grace"))
                for note in beat.get("notes") if isinstance(beat.get("notes"), list) else []:
                    if not isinstance(note, dict):
                        continue
                    midi = _pitch_of(note.get("midi"))
                    if midi is None:
                        continue
                    key = f"{vid}|{midi}"
                    if _truthy(note.get("tied")) and key in last:
                        prev = out[last[key]]
                        prev["sus"] = max(prev["sus"], (t - prev["t"]) + dur_s)
                        continue
                    n = {"t": t, "midi": midi, "sus": max(MIN_DUR_S, dur_s),
                         "hand": staff_id if staff_id in ("rh", "lh") else None, "staff": staff_id}
                    out.append(n)
                    if grace:
                        graces.add(id(n))
                    else:
                        last[key] = len(out) - 1
    out.sort(key=lambda n: (n["t"], n["midi"]))

    # One note per staff, time (to the ms) and pitch; then no note rings past the next onset
    # of its pitch on its staff.
    merged: list[dict] = []
    seen: dict[str, dict] = {}
    for n in out:
        k = f"{n['staff']}|{_ms_key(n['t'])}|{n['midi']}"
        kept = seen.get(k)
        if kept is None:
            seen[k] = n
            merged.append(n)
            continue
        if id(n) not in graces:
            graces.discard(id(kept))   # a grace folded into its principal is a principal
        kept["sus"] = max(kept["sus"], n["sus"])
    # A grace never ends the principal before it (that note may be tied through it), but the
    # next onset of its pitch ends the grace.
    prev_of: dict[tuple, dict] = {}
    grace_of: dict[tuple, dict] = {}
    for n in merged:
        k = (n["staff"], n["midi"])
        grace = grace_of.get(k)
        if grace and grace["t"] + grace["sus"] > n["t"]:
            grace["sus"] = max(MIN_DUR_S, n["t"] - grace["t"])
        if id(n) in graces:
            grace_of[k] = n
            continue
        prev = prev_of.get(k)
        if prev and prev["t"] + prev["sus"] > n["t"]:
            prev["sus"] = max(MIN_DUR_S, n["t"] - prev["t"])
        prev_of[k] = n
    for n in merged:
        n["t"] = round(n["t"], 4)
        n["sus"] = round(n["sus"], 4)
    return merged
