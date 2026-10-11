extends Logger
## Crash detection for GDScript extensions. GDScript has no exceptions: a runtime error aborts the current function
## (logged as SCRIPT ERROR) and the caller continues. This logger counts script errors raised on the main thread, so
## GSHost/GSEventBus can tell that an extension call crashed (count changed across the call) and isolate it.
## One shared logger for all hosts, installed while at least one host exists. Debug builds report script errors;
## release exports may not, so the host also checks return values (see gs_host.gd).

static var _instance # this script (untyped: its own members are read below)
static var _users := 0

var script_errors := 0
var _main_thread := 0

static func acquire() -> void:
	_users += 1
	if _instance == null:
		_instance = new()
		_instance._main_thread = OS.get_main_thread_id()
		OS.add_logger(_instance)

static func release() -> void:
	_users = maxi(0, _users - 1)
	if _users == 0 and _instance != null:
		OS.remove_logger(_instance)
		_instance = null

## Monotonic count of main-thread script errors while active; -1 when no trap is installed.
static func count() -> int:
	return _instance.script_errors if _instance != null else -1

func _log_error(_function: String, _file: String, _line: int, _code: String, _rationale: String, _editor_notify: bool,
		error_type: int, _script_backtraces: Array[ScriptBacktrace]) -> void:
	if error_type == ERROR_TYPE_SCRIPT and OS.get_thread_caller_id() == _main_thread:
		script_errors += 1
