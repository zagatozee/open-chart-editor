"""Missing Worker/Worklet or Python adapters must fail before local copying."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('oce_closed_installer',ROOT/'tools/install-local.py')
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class InstallClosureTests(unittest.TestCase):
    def test_worker_urls_require_explicit_files_alongside_static_imports(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'screen.js').write_text("import './engine.js';",encoding='utf-8')
            (root/'engine.js').write_text("new Worker(new URL('./worker.js',import.meta.url));",encoding='utf-8')
            (root/'worker.js').write_text('// Own worker',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'engine.js -> worker.js'):
                installer.validate_module_closure(root,('screen.js','engine.js'))
            installer.validate_module_closure(root,('screen.js','engine.js','worker.js'))

    def test_relative_and_standalone_python_loader_dependencies_are_both_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'routes.py').write_text('from . import pack_io',encoding='utf-8')
            (root/'pack_io.py').write_text("Path(__file__).with_name('musicxml_dynamics.py')",encoding='utf-8')
            (root/'musicxml_dynamics.py').write_text('# Own adapter',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'routes.py -> pack_io.py'):
                installer.validate_module_closure(root,('routes.py',))
            with self.assertRaisesRegex(ValueError,'pack_io.py -> musicxml_dynamics.py'):
                installer.validate_module_closure(root,('routes.py','pack_io.py'))
            installer.validate_module_closure(root,('routes.py','pack_io.py','musicxml_dynamics.py'))

    def test_current_original_runtime_closes_without_candidate_or_research_files(self):
        installer.validate_module_closure(ROOT,installer.RUNTIME_FILES+installer.OPTIONAL_FILES)
        self.assertFalse(any('candidate' in path or path.startswith('research/') for path in installer.RUNTIME_FILES))

    def test_every_bundled_feedpak_schema_is_in_the_runtime_allowlist(self):
        schema_dir=ROOT/'assets'/'feedpak-schemas'
        on_disk={f'assets/feedpak-schemas/{path.name}' for path in schema_dir.glob('*.schema.json')}
        missing=on_disk-set(installer.RUNTIME_FILES)
        self.assertFalse(missing,f'Schema files missing from RUNTIME_FILES (a real install silently loses feedpak_contract validation without these): {missing}')

if __name__=='__main__':
    unittest.main()
