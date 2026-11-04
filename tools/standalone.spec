# PyInstaller recipe for the standalone build: pyinstaller tools/standalone.spec
# Output: dist/open-chart-editor/. See "Standalone builds" in README.txt.
import os
from pathlib import Path
import sys
from PyInstaller.utils.hooks import copy_metadata

ROOT = Path(SPECPATH).parent
MODULES = sorted(path for path in ROOT.glob('*.py') if path.name != 'standalone.py')
# Licence texts of what the program bundles, as THIRD-PARTY-NOTICES.txt describes.
BUNDLED = [item for name in ('fastapi', 'uvicorn', 'python-multipart', 'PyYAML', 'jsonschema', 'PyGuitarPro')
           for item in copy_metadata(name, recursive=True)]
PYTHON_LICENSE = [(str(path), 'licenses/python') for folder in (Path(os.__file__).parent, Path(sys.base_prefix))
                  for path in folder.glob('LICENSE*')]
assert PYTHON_LICENSE, 'Python licence text not found'

a = Analysis(
    [str(ROOT / 'standalone.py')],
    pathex=[str(ROOT)],
    # The modules load each other by file path, so they ship as plain files too;
    # listing them here is what lets PyInstaller see their dependencies.
    # The others are what FeedBack's converters import (OCE_FEEDBACK_LIB).
    hiddenimports=[path.stem for path in MODULES] + ['guitarpro', 'secrets', 'xml.dom.minidom'],
    datas=[(str(path), '.') for path in MODULES] + [
        (str(ROOT / name), '.') for name in
        ('screen.html', 'screen.js', 'plugin.json', 'feature-coverage.json', 'README.txt', 'LICENSE', 'THIRD-PARTY-NOTICES.txt')
    ] + [(str(ROOT / 'src'), 'src'), (str(ROOT / 'assets'), 'assets'), (str(ROOT / 'tools/assist/gp_assist.py'), 'tools/assist'),
         (str(ROOT / 'tools/vendor/feedback-lib'), 'tools/vendor/feedback-lib')] + BUNDLED + PYTHON_LICENSE,
    # numpy, pedalboard and websockets are only for the optional AmpliTube host. Nothing
    # here uses readline, which is GPL where the Python build links it, or the packaging tools.
    excludes=['numpy', 'pedalboard', 'websockets', 'readline', 'setuptools', 'pkg_resources', '_distutils_hack', 'packaging'],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [('X utf8', None, 'OPTION')], exclude_binaries=True, name='open-chart-editor', console=True)
coll = COLLECT(exe, a.binaries, a.datas, name='open-chart-editor')
