# Creates (or refreshes) the desktop shortcut "GameSystems testlab" -> "Start GameSystems testlab.cmd" (WScript.Shell).
# No autostart: this only places a shortcut on the current user's desktop.
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'Start GameSystems testlab.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'GameSystems testlab.lnk'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = $launcher
$s.WorkingDirectory = $PSScriptRoot
$s.Description = 'GameSystems testlab: Quest 3 headset-tests over HTTPS på LAN'
$s.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
$s.WindowStyle = 1
$s.Save()
Write-Host "Genvej: $link -> $launcher"
