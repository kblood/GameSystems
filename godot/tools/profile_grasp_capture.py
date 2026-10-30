"""Profile immutable captured closure inputs without changing shipped addons.

Creates instrumented copies in .godot/grasp-capture-profile, checks their output
against the original solver, and reports inclusive microsecond timings/counts.
Instrumentation overhead means these timings are diagnostic, not a frame budget.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import subprocess


def instrument(source: str, names: list[str], loops: bool = False) -> str:
    source = re.sub(r"^class_name .*\n", "", source, count=1)
    wrappers = []
    for name in names:
        pattern = rf"static func {re.escape(name)}\((.*?)\) -> ([\w\[\]]+):"
        match = re.search(pattern, source, re.S)
        if not match:
            raise ValueError(f"instrumentation signature missing: {name}")
        parameters, result_type = match.groups()
        arguments = ", ".join(p.strip().split(":", 1)[0] for p in parameters.split(","))
        source = source[:match.start()] + source[match.start():].replace(
            f"static func {name}(", f"static func _profile_original_{name}(", 1)
        per_digit = '''
\tvar _profile_digit_key := "close_finger." + name
\tvar _profile_digit_row: Dictionary = profile_stats.get(_profile_digit_key, {"calls":0,"inclusive_usec":0})
\t_profile_digit_row.calls += 1
\t_profile_digit_row.inclusive_usec += elapsed
\tprofile_stats[_profile_digit_key] = _profile_digit_row
''' if name == "close_finger" else ""
        wrappers.append(f'''
static func {name}({parameters}) -> {result_type}:
\tvar started := Time.get_ticks_usec()
\tvar result: {result_type} = _profile_original_{name}({arguments})
\tvar elapsed := Time.get_ticks_usec() - started
\tvar _profile_stat_row: Dictionary = profile_stats.get("{name}", {{"calls":0,"inclusive_usec":0}})
\t_profile_stat_row.calls += 1
\t_profile_stat_row.inclusive_usec += elapsed
\tprofile_stats["{name}"] = _profile_stat_row
{per_digit}
\treturn result
''')
    if loops:
        start = source.index("static func _profile_original_close_finger(")
        end = source.index("static func ", start + len("static func "))
        body = source[start:end]
        # Count actual executions of loop bodies in close_finger only. Nested
        # helper evaluations are counted/timed independently by _close_reach.
        body, count = re.subn(
            r"(?m)^(\t+)(for |while )([^\n]+):\n",
            lambda m: m.group(0) + m.group(1) + '\tprofile_loop_iterations += 1\n', body)
        if count == 0:
            raise ValueError("close_finger loop instrumentation found no loops")
        source = source[:start] + body + source[end:]
    return source + "\nstatic var profile_stats: Dictionary = {}\nstatic var profile_loop_iterations := 0\n" + "".join(wrappers)


RUNNER = '''extends SceneTree
const Baseline = preload("res://addons/gs_grasp/gs_grasp_closure.gd")
const Profile = preload("res://.godot/grasp-capture-profile/closure.gd")
const Sdf = preload("res://.godot/grasp-capture-profile/sdf.gd")
const Catalog = preload("res://.godot/grasp-capture-profile/catalog.gd")
func _initialize() -> void:
\tvar fixture: Variant = JSON.parse_string(FileAccess.get_file_as_string(FIXTURE))
\tif not fixture is Dictionary or not fixture.get("cases") is Array or fixture.cases.is_empty():
\t\tpush_error("missing captured closure cases"); quit(1); return
\tvar report := {"schema":"gamesystems.grasp-capture-profile.v1","engine":Engine.get_version_info(),"processor":OS.get_processor_name(),
\t\t"scope":"Instrumented source copies; inclusive timings overlap and include instrumentation overhead. Baseline timings measure the same source revision without instrumentation. No headset claim.","cases":[]}
\tfor row: Dictionary in fixture.cases:
\t\tif not Catalog.validate_shape(row.get("shape")):
\t\t\tpush_error("invalid captured shape"); quit(1); return
\t\tvar before := var_to_bytes(row)
\t\tvar expected: Dictionary = Baseline.close_to_contact(row.pose,row.hand,row.shape,row.options)
\t\tvar warm: Dictionary = Profile.close_to_contact(row.pose,row.hand,row.shape,row.options)
\t\tif warm != expected or before != var_to_bytes(row):
\t\t\tpush_error("instrumentation changed output/input"); quit(1); return
\t\tvar samples := []
\t\tfor sample_index in range(SAMPLES):
\t\t\tProfile.profile_stats.clear(); Sdf.profile_stats.clear(); Catalog.profile_stats.clear(); Profile.profile_loop_iterations=0
\t\t\tvar start := Time.get_ticks_usec()
\t\t\tvar result: Dictionary = Profile.close_to_contact(row.pose,row.hand,row.shape,row.options)
\t\t\tvar profiled_usec := Time.get_ticks_usec()-start
\t\t\tvar stats := {"closure":Profile.profile_stats.duplicate(true),"sdf":Sdf.profile_stats.duplicate(true),"validation":Catalog.profile_stats.duplicate(true)}
\t\t\tvar iterations := Profile.profile_loop_iterations
\t\t\tstart=Time.get_ticks_usec()
\t\t\tvar plain: Dictionary=Baseline.close_to_contact(row.pose,row.hand,row.shape,row.options)
\t\t\tvar baseline_usec := Time.get_ticks_usec()-start
\t\t\tif result!=expected or plain!=expected or before!=var_to_bytes(row):
\t\t\t\tpush_error("profile sample changed output/input"); quit(1); return
\t\t\tsamples.append({"profiled_usec":profiled_usec,"baseline_usec":baseline_usec,"close_finger_loop_body_executions":iterations,"functions":stats})
\t\treport.cases.append({"name":row.name,"tried":expected.tried,"samples":samples,"output_equal":true,"input_unchanged":true})
\tvar file := FileAccess.open(OUTPUT,FileAccess.WRITE)
\tif not file:
\t\tpush_error("cannot write profile output"); quit(1); return
\tfile.store_string(JSON.stringify(report,"\\t")); file.close()
\tprint("GRASP_CAPTURE_PROFILE cases=",report.cases.size()," samples=",SAMPLES," parity=true")
\tquit(0)
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--godot", required=True)
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--samples", type=int, default=12)
    args = parser.parse_args()
    if args.samples < 1 or args.samples > 100:
        parser.error("--samples must be between 1 and 100")
    project = Path(__file__).resolve().parents[1]
    scratch = project / ".godot" / "grasp-capture-profile"
    scratch.mkdir(parents=True, exist_ok=True)
    sources = {
        "catalog": project / "addons/gs_grasp_data/gs_grasp_catalog_data.gd",
        "sdf": project / "addons/gs_grasp/gs_grasp_shape_sdf.gd",
        "closure": project / "addons/gs_grasp/gs_grasp_closure.gd",
    }
    texts = {key: path.read_text(encoding="utf-8") for key, path in sources.items()}
    catalog = instrument(texts["catalog"], ["validate_shape"])
    sdf_names = ["signed_distance", "_shape_distance"]
    if "static func _signed_distance_validated(" in texts["sdf"]:
        sdf_names.append("_signed_distance_validated")
    sdf = instrument(texts["sdf"], sdf_names)
    sdf = sdf.replace('res://addons/gs_grasp_data/gs_grasp_catalog_data.gd', 'res://.godot/grasp-capture-profile/catalog.gd')
    closure = instrument(texts["closure"], ["finger_chain", "_close_reach", "close_finger", "segment_gaps", "grade_grasp", "close_to_contact"], loops=True)
    closure = closure.replace('res://addons/gs_grasp/gs_grasp_shape_sdf.gd', 'res://.godot/grasp-capture-profile/sdf.gd')
    for name, text in [("catalog", catalog), ("sdf", sdf), ("closure", closure)]:
        (scratch / f"{name}.gd").write_text(text, encoding="utf-8")
    fixture = args.fixture.resolve()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    raw_output = scratch / "raw-profile.json"
    raw_output.unlink(missing_ok=True)
    runner = RUNNER.replace("FIXTURE", json.dumps(fixture.as_posix())).replace("OUTPUT", json.dumps(raw_output.as_posix())).replace("SAMPLES", str(args.samples))
    (scratch / "run.gd").write_text(runner, encoding="utf-8")
    completed = subprocess.run([args.godot, "--headless", "--xr-mode", "off", "--path", str(project), "--script", "res://.godot/grasp-capture-profile/run.gd"], timeout=180)
    if completed.returncode:
        raise SystemExit(completed.returncode)
    report = json.loads(raw_output.read_text(encoding="utf-8"))
    def summary(values: list[int]) -> dict:
        values = sorted(values)
        return {"median": statistics.median(values), "p95": values[math.ceil(len(values) * .95) - 1], "max": values[-1]}
    for case in report["cases"]:
        samples = case["samples"]
        case["summary"] = {key: summary([sample[key] for sample in samples]) for key in ["baseline_usec", "profiled_usec", "close_finger_loop_body_executions"]}
        case["function_summary"] = {}
        for group, functions in samples[0]["functions"].items():
            case["function_summary"][group] = {}
            for function in functions:
                case["function_summary"][group][function] = {
                    "calls": summary([sample["functions"][group][function]["calls"] for sample in samples]),
                    "inclusive_usec": summary([sample["functions"][group][function]["inclusive_usec"] for sample in samples]),
                }
    report["source_sha256"] = {key: hashlib.sha256(text.encode()).hexdigest() for key, text in texts.items()}
    report["fixture_sha256"] = hashlib.sha256(fixture.read_bytes()).hexdigest()
    report["instrumentation"] = "Generated wrappers around original function bodies; loops count actual close_finger loop-body executions. Inclusive nested times must not be summed."
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
