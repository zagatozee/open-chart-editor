Vendored from FeedBack (AGPL-3.0-only, same license as this project):
  https://git.barlind.se/freedBack/feedBack

Files: gp2rs.py, gp2rs_gpx.py, safepath.py, safe_xml.py, notation.py (lib/ in
that repo). gp2rs.py/gp2rs_gpx.py are FeedBack's Guitar Pro (.gp3-.gp8)
converters, safepath.py/safe_xml.py are their two direct dependencies, and
notation.py supplies notation_to_notes for editing notation-only keys parts.
Nothing else in FeedBack's lib/ is pulled in - confirmed by checking imports.

Pinned to commit f3c24f98b9a299815d83db9faa6cc14a9ae2d1ce (2026-10-21).

This exists so the standalone build (see tools/standalone.spec) can import
Guitar Pro files without a separate FeedBack install. OCE_FEEDBACK_LIB, and a
real local FeedBack checkout, still take priority when set/found - see
feedback_core() in pack_io.py - so running as a FeedBack plugin or from
source against a dev FeedBack checkout is unaffected.

To update: copy the same four files again from a newer FeedBack commit,
update the pinned commit hash above, and rerun the test suite (several
pack_io.py tests exercise the Guitar Pro worker against PyGuitarPro-backed
fixtures and will catch an incompatible converter interface change).
