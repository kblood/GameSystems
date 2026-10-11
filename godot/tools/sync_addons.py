"""Copy GameSystems Godot addons (godot/addons/gs_*) into a Godot game as generated copies.

The copies are committed in the game so it builds on its own; they must not be edited there (game-specific code
belongs in the game's own adapters). Each copy gets SOURCE.json in the format the games already use for
addons/game_systems: {repository, commit, files: [{source, target, sha256}], local_adaptations}, plus
`dirty` (source files differed from that commit when synced) and `sha256_text` (how text files are hashed).

  python godot/tools/sync_addons.py ../NightfallContractsGodot              # sync every gs_* addon
  python godot/tools/sync_addons.py ../NightfallContractsGodot gs_host      # only these addons
  python godot/tools/sync_addons.py ../NightfallContractsGodot --check      # exit 1 on any drift, writes nothing

--check fails when a copy was edited (hash != SOURCE.json), is missing/extra files, or is behind GameSystems (source
hash != SOURCE.json), and when a golden file is stale (node godot/tools/gen_golden.mjs --check). Text files are hashed
with CRLF -> LF so core.autocrlf checkouts on Windows do not count as edits; files are written with LF. Godot's own
*.uid / *.import files next to the copies belong to the game and are ignored. Files are only written when they change
and SOURCE.json only when the file list or a hash changes (its commit is the one the copies were last synced from).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

GAMESYSTEMS = Path(__file__).resolve().parents[2]
ADDONS = GAMESYSTEMS / 'godot/addons'
# Extra files copied into every addon: source (relative to GameSystems) -> path inside the addon.
EXTRAS = {'LICENSE': 'LICENSE'}
TEXT = {'.gd', '.json', '.md', '.txt', '.cfg', '.gdshader', '.gdshaderinc', '.tscn', '.tres', '.csv', ''}
IGNORED = {'.uid', '.import'}
REPOSITORY = 'https://github.com/kblood/GameSystems'


def is_text(path: Path) -> bool:
    return path.suffix.lower() in TEXT


def content(path: Path) -> bytes:
    data = path.read_bytes()
    return data.replace(b'\r\n', b'\n') if is_text(path) else data


def sha256(path: Path) -> str:
    return hashlib.sha256(content(path)).hexdigest()


def ignored(path: Path) -> bool:
    return path.suffix in IGNORED or '__pycache__' in path.parts or path.name == 'SOURCE.json'


def git(*args: str) -> str:
    try:
        return subprocess.run(['git', '-C', str(GAMESYSTEMS), *args], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ''


def plan(name: str) -> list[tuple[Path, str, str]]:
    """[(source path, source relative to GameSystems, target relative to the game)] for one addon."""
    root = ADDONS / name
    files = [(p, p.relative_to(GAMESYSTEMS).as_posix(), f'addons/{name}/{p.relative_to(root).as_posix()}')
             for p in sorted(root.rglob('*')) if p.is_file() and not ignored(p.relative_to(root))]
    files += [(GAMESYSTEMS / src, src, f'addons/{name}/{dst}') for src, dst in EXTRAS.items()]
    return files


def manifest(name: str, files: list[tuple[Path, str, str]], old: dict | None) -> dict:
    entries = [{'source': src, 'target': dst, 'sha256': sha256(path)} for path, src, dst in files]
    if old and old.get('files') == entries:
        return old
    sources = [src for _, src, _ in files]
    return {'repository': (git('remote', 'get-url', 'origin').removesuffix('.git') or REPOSITORY),
            'commit': git('rev-parse', 'HEAD'),
            'dirty': bool(git('status', '--porcelain', '--', *sources)),
            'generator': 'godot/tools/sync_addons.py',
            'sha256_text': 'text files (.gd .json .md .cfg .tscn .tres .gdshader, LICENSE) hashed after CRLF -> LF',
            'files': entries,
            'local_adaptations': []}


def read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def existing(game: Path, name: str) -> set[str]:
    root = game / 'addons' / name
    return {p.relative_to(game).as_posix() for p in root.rglob('*') if p.is_file() and not ignored(p.relative_to(root))} if root.is_dir() else set()


def sync(game: Path, name: str) -> int:
    files = plan(name)
    changed = 0
    for path, _, dst in files:
        target = game / dst
        data = content(path)
        if target.is_file() and content(target) == data:  # a CRLF checkout of the same text is not a change
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        changed += 1
        print(f'  wrote   {dst}')
    for stale in sorted(existing(game, name) - {dst for _, _, dst in files}):
        (game / stale).unlink()
        changed += 1
        print(f'  removed {stale}')
    source_json = game / 'addons' / name / 'SOURCE.json'
    old = read_json(source_json)
    new = manifest(name, files, old)
    if new is not old:
        source_json.write_text(json.dumps(new, indent=2) + '\n', encoding='utf-8', newline='\n')
        changed += 1
        print(f'  wrote   addons/{name}/SOURCE.json (commit {new["commit"][:7]}{", dirty source" if new["dirty"] else ""})')
    return changed


def check(game: Path, name: str) -> list[str]:
    problems = []
    recorded = read_json(game / 'addons' / name / 'SOURCE.json')
    if not recorded:
        return [f'{name}: addons/{name}/SOURCE.json missing or unreadable (not synced)']
    by_target = {item['target']: item for item in recorded.get('files', [])}
    for item in by_target.values():
        target = game / item['target']
        if not target.is_file():
            problems.append(f'{name}: missing {item["target"]}')
        elif sha256(target) != item['sha256']:
            problems.append(f'{name}: edited in the game: {item["target"]} (change GameSystems and re-sync)')
    for extra in sorted(existing(game, name) - set(by_target)):
        problems.append(f'{name}: not from GameSystems: {extra}')
    files = plan(name)
    for path, src, dst in files:
        item = by_target.get(dst)
        if item is None:
            problems.append(f'{name}: new in GameSystems, not synced: {src}')
        elif item.get('source') != src or sha256(path) != item['sha256']:
            problems.append(f'{name}: behind GameSystems: {src}')
    for dst in sorted(set(by_target) - {dst for _, _, dst in files}):
        problems.append(f'{name}: removed in GameSystems, still synced: {dst}')
    return problems


def golden_check() -> list[str]:
    node = shutil.which('node')
    if not node:
        return ['node not found: golden files not checked']
    proc = subprocess.run([node, str(GAMESYSTEMS / 'godot/tools/gen_golden.mjs'), '--check'], capture_output=True, text=True)
    return [] if proc.returncode == 0 else [line for line in (proc.stdout + proc.stderr).splitlines() if 'STALE' in line or 'run' in line] or ['golden check failed']


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('game', type=Path, help='Godot game directory (contains project.godot)')
    parser.add_argument('addons', nargs='*', help='addon names (default: every gs_* in godot/addons)')
    parser.add_argument('--check', action='store_true', help='report drift and exit 1; write nothing')
    options = parser.parse_args()
    game = options.game.resolve()
    if not (game / 'project.godot').is_file():
        parser.error(f'{game} is not a Godot project')
    names = options.addons or sorted(p.name for p in ADDONS.glob('gs_*') if p.is_dir())
    unknown = [n for n in names if not (ADDONS / n).is_dir()]
    if unknown:
        parser.error(f'unknown addon(s): {", ".join(unknown)}')
    if options.check:
        problems = [p for name in names for p in check(game, name)] + golden_check()
        for problem in problems:
            print('DRIFT ', problem)
        print(f'{"FAIL" if problems else "OK"}: {", ".join(names)} in {game}')
        return 1 if problems else 0
    total = 0
    for name in names:
        print(f'{name} -> {game / "addons" / name}')
        total += sync(game, name)
    print(f'{total} file(s) changed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
