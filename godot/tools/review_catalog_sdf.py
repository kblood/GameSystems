"""Review-stage catalog/SDF gate. Never promotes source catalogs or game addons.

Requires a freshly generated fixture and an explicit Godot executable. Source
verification precedes temporary staging; the optional report is created only
once all existing native regressions pass and inputs remain unchanged.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ADDONS = ('gs_grasp_data', 'gs_grasp')
GENERATOR = ROOT / 'godot/tools/write_fresh_grasp_sdf_fixture.mjs'
KINDS = ['barrel', 'bottle_beer', 'bottle_wine', 'can', 'carton', 'ladder', 'mug', 'pole']
CANDIDATE_PATHS = (
    'addons/gs_grasp_data/data/catalog.data.json',
    'addons/gs_grasp_data/data/catalog.golden.json',
    'addons/gs_grasp/tests/grasp_sdf.golden.json',
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs() -> dict[str, str]:
    paths = [ROOT / 'LICENSE', ROOT / 'godot/project.godot', GENERATOR,
             Path(__file__).resolve(), ROOT / 'godot/tools/grasp_sdf_golden.mjs',
             ROOT / 'extensions/grasp/catalog.js',
             ROOT / 'extensions/grasp/data/catalog.data.json']
    for addon in ADDONS:
        paths.extend(p for p in (ROOT / 'godot/addons' / addon).rglob('*')
                     if p.is_file() and p.suffix not in ('.uid', '.import')
                     and '__pycache__' not in p.parts and p.name != 'SOURCE.json')
    return {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted(set(paths))}


def run(command: list[str], *, timeout: int = 300) -> str:
    proc = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    output = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', proc.stdout + proc.stderr)
    if proc.returncode or re.search(r'(?im)^\s*(?:ERROR:|SCRIPT ERROR:|Parse Error:)', output):
        raise RuntimeError(f'Preflight failed ({proc.returncode}): {command}\n{output}')
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--godot', type=Path, required=True)
    parser.add_argument('--report', type=Path, help='new JSON file under godot/.godot only; never overwritten')
    args = parser.parse_args()
    fixture_path, godot = args.fixture.resolve(), args.godot.resolve()
    node = shutil.which('node')
    if node is None or not godot.is_file() or not fixture_path.is_file():
        parser.error('node, a Godot executable and an existing fresh fixture are required')
    report_path = args.report.resolve() if args.report else None
    report_root = (ROOT / 'godot/.godot').resolve()
    if report_path and (not report_path.is_relative_to(report_root) or report_path.exists()):
        parser.error('--report must be a new file under godot/.godot')
    before = inputs()
    fixture_hash = digest(fixture_path)
    engine_hash = digest(godot)
    # No directory/report writes before the source AND semantic preflight passes.
    run([node, str(GENERATOR), '--verify', str(fixture_path)])
    fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
    contract = fixture['catalog_contract']
    if (sorted(contract['CATALOG']) != KINDS or len(fixture['cases']) != 115
            or len(fixture['axis_cases']) != 22):
        raise RuntimeError('reviewed catalog/SDF scope mismatch')
    if inputs() != before or digest(fixture_path) != fixture_hash:
        raise RuntimeError('source or fixture changed during semantic preflight')
    source_hashes = fixture['source_sha256']
    js_hashes = {'extensions/grasp/catalog.js': source_hashes['catalog'],
                 'extensions/grasp/data/catalog.data.json': source_hashes['catalog_data']}
    candidates = {
        CANDIDATE_PATHS[0]: contract,
        CANDIDATE_PATHS[1]: {
            'schema': 'gamesystems.golden.grasp-catalog-data.v1',
            'generator': 'godot/tools/gen_golden.mjs',
            'source': 'extensions/grasp/data/catalog.data.json',
            'source_sha256': source_hashes['catalog_data'],
            'sources_sha256': js_hashes, 'contract': contract},
        CANDIDATE_PATHS[2]: {
            'schema': 'gamesystems.golden.grasp-sdf.v1',
            'generator': 'godot/tools/gen_golden.mjs',
            'probe': 'godot/tools/grasp_sdf_golden.mjs',
            'probe_sha256': source_hashes['case_generator'],
            'sources_sha256': js_hashes,
            'cases': [{k: v for k, v in row.items() if k != 'shape' or 'kind' not in row}
                      for row in fixture['cases']]},
    }
    candidate_bytes = {name: (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
                       for name, value in candidates.items()}
    results = []
    # All mutations are isolated disposable review data, never source or game files.
    with tempfile.TemporaryDirectory(prefix='gs-catalog-sdf-review-') as temporary:
        stage = Path(temporary)
        shutil.copy2(ROOT / 'godot/project.godot', stage / 'project.godot')
        for addon in ADDONS:
            shutil.copytree(ROOT / 'godot/addons' / addon, stage / 'addons' / addon,
                            ignore=shutil.ignore_patterns('*.uid', '*.import', '__pycache__', 'SOURCE.json'))
        for name, data in candidate_bytes.items():
            (stage / name).write_bytes(data)
        (stage / 'fresh-sdf.json').write_bytes(fixture_path.read_bytes())
        # Register script classes in this temporary project only.
        run([str(godot), '--headless', '--editor', '--path', str(stage), '--import'])
        suites = [
            ('addons/gs_grasp_data/tests/gs_grasp_catalog_data_tests.gd', 'GS_GRASP_CATALOG_DATA', []),
            ('addons/gs_grasp/tests/gs_grasp_sdf_tests.gd', 'GS_GRASP_SDF_TESTS',
             ['--', '--fresh-sdf-fixture=res://fresh-sdf.json']),
            ('addons/gs_grasp/tests/gs_grasp_closure_tests.gd', 'GS_GRASP_CLOSURE_TESTS', []),
        ]
        for script, marker, extra in suites:
            output = run([str(godot), '--headless', '--path', str(stage), '--script', 'res://' + script, *extra])
            match = re.search(re.escape(marker) + r' passed=(\d+) failed=(\d+)', output)
            if not match or int(match[1]) <= 0 or int(match[2]) != 0:
                raise RuntimeError(f'missing or failed native suite result: {script}\n{output}')
            results.append({'script': script, 'passed': int(match[1]), 'failed': int(match[2])})
    if inputs() != before or digest(fixture_path) != fixture_hash or digest(godot) != engine_hash:
        raise RuntimeError('source, fixture or engine changed during native preflight')
    report = {
        'schema': 'gamesystems.catalog-sdf-review.v1', 'status': 'review-qualified-not-promoted',
        'fixture_sha256': fixture_hash, 'godot_sha256': engine_hash,
        'source_sha256': before, 'catalog_kinds': KINDS, 'sdf_cases': 115, 'axis_cases': 22,
        'native_results': results,
        'candidate_artifacts': {name: {'sha256': hashlib.sha256(data).hexdigest(), 'payload': candidates[name]}
                                for name, data in candidate_bytes.items()},
        'coordinated_addons': list(ADDONS),
        'promotion_policy': 'Independent review required. No source catalog or addon copy was written. '
                            'Existing gs_grasp-only native-grasp sync scope is not authorization for this pair. '
                            'Other addon fixtures and variants are not qualified by this gate. '
                            'Candidate artifact hashes identify Python serialized review bytes, not gen_golden formatting.',
        'limits': 'Shape/data parity only. No pose.axis recording/capture/opposition, ladder runtime fit, '
                  'collision hull, inertia, headset or broad-golden qualification.',
    }
    text = json.dumps(report, indent=2, ensure_ascii=False) + '\n'
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        with report_path.open('x', encoding='utf-8', newline='\n') as output:
            output.write(text)
        print(f'Review qualified; report: {report_path}. No promotion performed.')
    else:
        print(text)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f'REJECTED: {error}')
