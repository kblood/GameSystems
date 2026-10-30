"""Alternating, uninstrumented before/after closure replay on frozen capture inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import subprocess


RUNNER = '''extends SceneTree
const Before = preload("res://.godot/grasp-prevalidation-compare/before_closure.gd")
const After = preload("res://addons/gs_grasp/gs_grasp_closure.gd")
func _initialize() -> void:
	var fixture: Variant = JSON.parse_string(FileAccess.get_file_as_string(FIXTURE))
	if not fixture is Dictionary or not fixture.get("cases") is Array or fixture.cases.size() != 4:
		push_error("expected four captured thumb replay cases"); quit(1); return
	var report := {"schema":"gamesystems.grasp-prevalidation-compare.v1","engine":Engine.get_version_info(),"processor":OS.get_processor_name(),
		"cases":[],"alternation":"old,new then new,old by sample index; uninstrumented functions"}
	for input: Dictionary in fixture.cases:
		var before := var_to_bytes(input)
		var expected_old: Dictionary = Before.close_to_contact(input.pose,input.hand,input.shape,input.options)
		var expected_new: Dictionary = After.close_to_contact(input.pose,input.hand,input.shape,input.options)
		if expected_old != expected_new or before != var_to_bytes(input):
			push_error("baseline parity or input immutability failed for " + String(input.name)); quit(1); return
		var samples := []
		for sample_index in range(SAMPLES):
			var old_usec := 0
			var new_usec := 0
			var old_result: Dictionary
			var new_result: Dictionary
			var start: int
			if sample_index % 2 == 0:
				start=Time.get_ticks_usec(); old_result=Before.close_to_contact(input.pose,input.hand,input.shape,input.options); old_usec=Time.get_ticks_usec()-start
				start=Time.get_ticks_usec(); new_result=After.close_to_contact(input.pose,input.hand,input.shape,input.options); new_usec=Time.get_ticks_usec()-start
			else:
				start=Time.get_ticks_usec(); new_result=After.close_to_contact(input.pose,input.hand,input.shape,input.options); new_usec=Time.get_ticks_usec()-start
				start=Time.get_ticks_usec(); old_result=Before.close_to_contact(input.pose,input.hand,input.shape,input.options); old_usec=Time.get_ticks_usec()-start
			if old_result != expected_old or new_result != expected_old or before != var_to_bytes(input):
				push_error("sample output/input mismatch for " + String(input.name)); quit(1); return
			samples.append({"old_usec":old_usec,"new_usec":new_usec,"output_equal":old_result==new_result,"input_unchanged":before==var_to_bytes(input),"order":"old-new" if sample_index%2==0 else "new-old"})
		report.cases.append({"name":input.name,"tried":expected_new.tried,"output_equal":true,"input_unchanged":true,"samples":samples})
	var file := FileAccess.open(OUTPUT,FileAccess.WRITE)
	if not file:
		push_error("cannot write comparison output"); quit(1); return
	file.store_string(JSON.stringify(report,"\\t")); file.close()
	print("GRASP_PREVALIDATION_COMPARE cases=",report.cases.size()," samples=",SAMPLES," parity=true")
	quit(0)
'''


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def git_source(repo: Path, commit: str, path: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(repo), "show", f"{commit}:{path}"])


def summary(values: list[int]) -> dict:
    values = sorted(values)
    return {"median": statistics.median(values), "p95": values[(len(values) * 95 + 99) // 100 - 1], "max": values[-1]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--godot", required=True)
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--baseline-ref", default="HEAD")
    args = parser.parse_args()
    if args.samples < 2:
        parser.error("--samples must be at least 2 to alternate order")
    project = Path(__file__).resolve().parents[1]
    repo = project.parent
    baseline_commit = git(repo, "rev-parse", args.baseline_ref)
    rels = ["godot/addons/gs_grasp/gs_grasp_closure.gd", "godot/addons/gs_grasp/gs_grasp_shape_sdf.gd"]
    frozen_bytes = {("closure" if "closure.gd" in rel else "sdf"): git_source(repo, baseline_commit, rel) for rel in rels}
    frozen = {key: value.decode("utf-8") for key, value in frozen_bytes.items()}
    # Remove global class names and keep the prechange closure paired with its own prechange SDF.
    closure = frozen["closure"].replace("class_name GSGraspClosure\n", "")
    closure = closure.replace('res://addons/gs_grasp/gs_grasp_shape_sdf.gd', 'res://.godot/grasp-prevalidation-compare/before_sdf.gd')
    scratch = project / ".godot" / "grasp-prevalidation-compare"
    scratch.mkdir(parents=True, exist_ok=True)
    (scratch / "before_closure.gd").write_text(closure, encoding="utf-8")
    (scratch / "before_sdf.gd").write_text(frozen["sdf"].replace("class_name GSGraspShapeSdf\n", ""), encoding="utf-8")
    fixture = args.fixture.resolve()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    raw = scratch / "raw.json"
    raw.unlink(missing_ok=True)
    runner = RUNNER.replace("FIXTURE", json.dumps(fixture.as_posix())).replace("OUTPUT", json.dumps(raw.as_posix())).replace("SAMPLES", str(args.samples))
    (scratch / "run.gd").write_text(runner, encoding="utf-8")
    subprocess.run([args.godot, "--headless", "--xr-mode", "off", "--path", str(project), "--script", "res://.godot/grasp-prevalidation-compare/run.gd"], check=True, timeout=240)
    report = json.loads(raw.read_text(encoding="utf-8"))
    for case in report["cases"]:
        case["summary_usec"] = {key: summary([sample[key] for sample in case["samples"]]) for key in ["old_usec", "new_usec"]}
    current = {
        "closure": (project / "addons/gs_grasp/gs_grasp_closure.gd").read_bytes(),
        "sdf": (project / "addons/gs_grasp/gs_grasp_shape_sdf.gd").read_bytes(),
    }
    report["baseline"] = {"requested_ref": args.baseline_ref, "resolved_commit": baseline_commit,
        "source_sha256": {key: hashlib.sha256(value).hexdigest() for key, value in frozen_bytes.items()}}
    report["current_source_sha256"] = {key: hashlib.sha256(value).hexdigest() for key, value in current.items()}
    report["fixture_sha256"] = hashlib.sha256(fixture.read_bytes()).hexdigest()
    report["measurement_scope"] = "Offline uninstrumented paired closure calls; alternating old/new order; headless Windows editor run. Timing variance is not a frame-budget claim."
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
