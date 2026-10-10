# Opens Chrome on THIS PC with SteamVR as OpenXR runtime for this process only (system ActiveRuntime = Virtual Desktop is untouched).
# Prereq: Steam + SteamVR running on the PC with the Steam Frame streaming to it (Steam Link / PC VR mode in the headset).
# Usage: pwsh -File chrome_steamvr.ps1 [url ...]   (default: studio + demo)
param([string[]]$Urls = @('http://localhost:5180/', 'http://localhost:5192/'))
$env:XR_RUNTIME_JSON = 'C:\Program Files (x86)\Steam\steamapps\common\SteamVR\steamxr_win64.json'
$profile = Join-Path $env:LOCALAPPDATA 'chrome-steamvr-profile'
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --user-data-dir="$profile" --no-first-run --force-webxr-runtime=openxr @Urls
