#!/usr/bin/env node
// One runner for every GameSystems Godot test script (F16 in docs/improvement_proposals.md). Dependency-free Node.
//   node godot/tests/run_all.mjs [--godot <exe>] [--only <substring|glob>]... [--jobs N] [--timeout seconds]
//                                [--workdir <dir>] [--json <file>] [--ignore-leaks] [--list]
//
// - Discovers every `*_tests.gd` under godot/addons/*/tests, godot/tests and godot/demos (a new test file is picked up
//   without editing a list; `--list` prints what it found).
// - Never writes to the project: it copies godot/ to a scratch folder (default <tmp>/gs_godot_tests/project, recreated on
//   every run, including .godot so no re-import is needed) and runs each script headless there with
//   `godot --headless --xr-mode off --path <copy> --script res://...`. The generated .uid files stay in the copy.
// - Every run has a timeout (default 180 s). On timeout only that child's own PID is killed (taskkill /PID <pid> /T on
//   Windows); processes are never killed by name.
// - Verdict per script: exit code 0, no timeout, no SCRIPT ERROR / parse error / leaked-resource line, and no failure
//   count > 0 in its summary. Checks/failures are read from the summary shapes the suites print ("passed=N failed=M",
//   "checks=N failures=M", "N checks / M failures", "passed=N"); "-" when a script prints none. Godot's "leaked at exit /
//   resources still in use" lines count as errors (as in Nightfall's runner) unless --ignore-leaks is given.
// - Writes a table to stdout and a JSON report (default <workdir>/report.json) with per-script exit code, duration,
//   checks, failures, errors and the last output lines. Exit code is 1 when any script failed.
// Godot is found via --godot, $GODOT, `godot` on PATH, or the Nightfall project's .tools copy (sibling folder).
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const godotDir = resolve(here, '..');
const argv = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const many = name => argv.flatMap((a, i) => a === name ? [argv[i + 1]] : []);
const has = name => argv.includes(name);

function discover() {
  const found = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(p); } else if (e.name.endsWith('_tests.gd')) found.push(p);
    }
  };
  for (const d of readdirSync(join(godotDir, 'addons'), { withFileTypes: true })) {
    const t = join(godotDir, 'addons', d.name, 'tests');
    if (d.isDirectory() && existsSync(t)) walk(t);
  }
  if (existsSync(join(godotDir, 'tests'))) walk(join(godotDir, 'tests'));
  if (existsSync(join(godotDir, 'demos'))) walk(join(godotDir, 'demos'));
  return found.map(p => relative(godotDir, p).split(sep).join('/')).sort();
}

let scripts = discover();
if (has('--list')) { console.log(scripts.join('\n')); console.log(`\n${scripts.length} test scripts`); process.exit(0); }
const only = many('--only');
if (only.length) scripts = scripts.filter(s => only.some(o => s.includes(o)));
if (!scripts.length) { console.error('no test scripts selected'); process.exit(2); }

function findGodot() {
  const candidates = [opt('--godot'), process.env.GODOT,
    join(godotDir, '../../NightfallContractsGodot/.tools/godot/editor/Godot_v4.7.2-stable_win64_console.exe')].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return resolve(c);
  const probe = spawnSync('godot', ['--version'], { encoding: 'utf8' });
  if (!probe.error && probe.status === 0) return 'godot';
  console.error('Godot not found: pass --godot <exe> or set GODOT.');
  process.exit(2);
}
const godot = findGodot();
const timeoutMs = Number(opt('--timeout', 180)) * 1000;
const jobs = Math.max(1, Number(opt('--jobs', Math.min(4, Math.max(1, cpus().length >> 2)))));
const workdir = resolve(opt('--workdir', join(tmpdir(), 'gs_godot_tests')));
const project = join(workdir, 'project');
const jsonPath = resolve(opt('--json', join(workdir, 'report.json')));

// Scratch copy (never the project folder). Refuse a workdir inside the repository.
if (resolve(project).startsWith(godotDir + sep) || resolve(workdir) === godotDir) { console.error('--workdir must be outside godot/'); process.exit(2); }
rmSync(project, { recursive: true, force: true });
mkdirSync(workdir, { recursive: true });
cpSync(godotDir, project, { recursive: true });

// [regex, (match) => [checks, failures]]; the last matching line of the output wins.
const SUMMARY = [
  [/passed=(\d+)\s+failed=(\d+)/i, m => [+m[1] + +m[2], +m[2]]],
  [/\bchecks=(\d+)\s+failures=(\d+)/i, m => [+m[1], +m[2]]],
  [/(\d+)\s+checks?\s*[\/,]\s*(\d+)\s+fail/i, m => [+m[1], +m[2]]],
  [/^GS_\w+.*\bpassed=(\d+)\s*$/i, m => [+m[1], 0]],
];
const LEAK = 'ObjectDB[^\n]*leaked|RID allocations[^\n]*leaked|resources still in use';
const ERROR_LINE = new RegExp(has('--ignore-leaks') ? 'SCRIPT ERROR|Parse Error' : `SCRIPT ERROR|Parse Error|${LEAK}`);

function summarize(text) {
  let checks = null, failures = null;
  for (const line of text.split(/\r?\n/)) {
    for (const [re, pick] of SUMMARY) {
      const m = re.exec(line);
      if (m) [checks, failures] = pick(m);
    }
  }
  return { checks, failures };
}

function run(script) {
  return new Promise(done => {
    const started = Date.now();
    const args = ['--headless', '--xr-mode', 'off', '--path', project, '--script', `res://${script}`];
    const child = spawn(godot, args, { cwd: project, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', timedOut = false;
    const take = d => { out += d.toString('utf8'); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    const timer = setTimeout(() => {
      timedOut = true;
      // Own PID only, never by name. taskkill /T also ends its children.
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      const { checks, failures } = summarize(out);
      const errors = [...new Set(out.split(/\r?\n/).filter(l => ERROR_LINE.test(l)).map(l => l.trim()))].slice(0, 10);
      const passed = !timedOut && code === 0 && errors.length === 0 && !(failures > 0);
      done({ script, passed, exit_code: timedOut ? null : code, timed_out: timedOut, seconds: +((Date.now() - started) / 1000).toFixed(1),
        checks, failures, errors, tail: out.split(/\r?\n/).filter(Boolean).slice(-8) });
    });
    child.on('error', err => { clearTimeout(timer); done({ script, passed: false, exit_code: null, timed_out: false, seconds: 0, checks: null, failures: null, errors: [String(err)], tail: [] }); });
  });
}

console.log(`GameSystems Godot tests: ${scripts.length} scripts, ${jobs} job(s), timeout ${timeoutMs / 1000}s each\nGodot: ${godot}\nCopy:  ${project}\n`);
const results = new Array(scripts.length);
let next = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(jobs, scripts.length) }, async () => {
  while (next < scripts.length) {
    const i = next++;
    results[i] = await run(scripts[i]);
    const r = results[i];
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.script}  (${r.seconds}s)`);
  }
}));

const pad = (s, n) => String(s ?? '-').padEnd(n);
const w = Math.max(6, ...results.map(r => r.script.length));
console.log(`\n${pad('script', w)}  ${pad('result', 6)}  ${pad('checks', 6)}  ${pad('fail', 4)}  ${pad('exit', 4)}  seconds`);
for (const r of results) console.log(`${pad(r.script, w)}  ${pad(r.timed_out ? 'TIMEOUT' : r.passed ? 'PASS' : 'FAIL', 7).slice(0, 7)} ${pad(r.checks, 6)}  ${pad(r.failures, 4)}  ${pad(r.exit_code, 4)}  ${r.seconds}`);
const failed = results.filter(r => !r.passed);
for (const r of failed) { console.log(`\n--- ${r.script}`); for (const l of [...r.errors, ...r.tail].slice(0, 12)) console.log(`  ${l}`); }
const total = results.reduce((n, r) => n + (r.checks ?? 0), 0);
console.log(`\n${results.length - failed.length}/${results.length} scripts passed, ${total} checks counted, ${((Date.now() - t0) / 1000).toFixed(0)}s wall`);
writeFileSync(jsonPath, JSON.stringify({ generated: new Date().toISOString(), godot, project, jobs, timeout_seconds: timeoutMs / 1000,
  summary: { scripts: results.length, passed: results.length - failed.length, failed: failed.length, checks: total }, results }, null, 2) + '\n');
console.log(`report: ${jsonPath}`);
process.exit(failed.length ? 1 : 0);
