"""Exercise guarded gs_grasp-only sync in disposable source/target trees.

Run: python godot/tools/test_sync_native_grasp.py
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = [
    'grasp_sdf.golden.json', 'grasp_closure.golden.json', 'grasp_place_wrist.golden.json',
    'grasp_segment_gaps.golden.json', 'grasp_profile_geometry.golden.json', 'grasp_place_palm.golden.json',
    'grasp_close_finger.golden.json', 'grasp_close_all.golden.json', 'grasp_close_to_contact.golden.json',
]


class NativeGraspSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gs-native-grasp-sync-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        for relative in ['LICENSE', 'godot/tools', 'godot/addons/gs_grasp', 'godot/addons/gs_grasp_data',
                         'extensions/host', 'extensions/humanoid', 'extensions/grasp']:
            source, target = ROOT / relative, self.root / relative
            if source.is_dir():
                shutil.copytree(source, target, ignore=shutil.ignore_patterns('__pycache__', '.godot'))
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        self.script = self.root / 'godot/tools/sync_addons.py'
        self.game = Path(self.temp.name) / 'game'
        self.game.mkdir()
        (self.game / 'project.godot').write_text('; isolated test project\n', encoding='utf-8')

    def run_sync(self, *args):
        return subprocess.run(['python', str(self.script), str(self.game), *args], cwd=self.root,
                              text=True, capture_output=True, timeout=45)

    def target_snapshot(self):
        root = self.game / 'addons/gs_grasp'
        if not root.exists():
            return {}
        return {p.relative_to(self.game).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in root.rglob('*') if p.is_file()}

    def test_native_scope_requires_exact_explicit_addon(self):
        for args in [('--golden-scope', 'native-grasp'),
                     ('--golden-scope', 'native-grasp', 'gs_grasp_data'),
                     ('--golden-scope', 'native-grasp', 'gs_grasp', 'gs_grasp_data')]:
            with self.subTest(args=args):
                result = self.run_sync(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('requires exactly one explicit addon: gs_grasp', result.stderr)
        self.assertEqual(self.target_snapshot(), {})

    def test_semantic_staleness_blocks_before_any_target_write_then_scoped_copy_checks(self):
        marker = self.game / 'addons/gs_grasp/keep.bin'
        marker.parent.mkdir(parents=True)
        marker.write_bytes(b'target-state-before-rejected-sync')
        before = self.target_snapshot()
        fixture = self.root / 'godot/addons/gs_grasp/tests/grasp_closure.golden.json'
        original = fixture.read_bytes()
        data = json.loads(original)
        data['cases'][0]['name'] += '-semantic-mutation'
        fixture.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
        rejected = self.run_sync('gs_grasp', '--golden-scope', 'native-grasp')
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('STALE', rejected.stdout)
        self.assertEqual(self.target_snapshot(), before)

        fixture.write_bytes(original)
        copied = self.run_sync('gs_grasp', '--golden-scope', 'native-grasp')
        self.assertEqual(copied.returncode, 0, copied.stdout + copied.stderr)
        self.assertIn('Scoped native-grasp gate passed', copied.stdout)
        checked = self.run_sync('gs_grasp', '--golden-scope', 'native-grasp', '--check')
        self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)
        self.assertIn('OK: gs_grasp', checked.stdout)
        after = self.target_snapshot()
        self.assertIn('addons/gs_grasp/SOURCE.json', after)
        self.assertGreater(len(after), 1)

    def test_explicit_all_scope_keeps_broad_gate(self):
        result = self.run_sync('gs_grasp', '--golden-scope', 'all', '--check')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue('STALE' in result.stdout or 'golden check failed' in result.stdout,
                        result.stdout + result.stderr)
        self.assertEqual(self.target_snapshot(), {})


if __name__ == '__main__':
    unittest.main(verbosity=2)
