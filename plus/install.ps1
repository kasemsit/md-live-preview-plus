# md-live-preview-plus installer for Windows. Run from the unzipped release folder:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
# 1. installs the .vsix (the CSS theme ships inside it and switches on by itself)
# 2. copies the Claude Code hook to %USERPROFILE%\.claude\hooks\
# 3. registers the hook in %USERPROFILE%\.claude\settings.json (other settings kept)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. extension
$vsix = Get-ChildItem -Path $here -Filter 'markdown-live-preview-editor-claude-*.vsix' | Select-Object -First 1
if (-not $vsix) { throw "No .vsix next to install.ps1" }
$code = Get-Command code -ErrorAction SilentlyContinue
if (-not $code) { $code = Get-Command code.cmd -ErrorAction SilentlyContinue }
if ($code) {
  & $code.Source --uninstall-extension t-shoot.markdown-live-preview-editor 2>$null | Out-Null
  & $code.Source --install-extension $vsix.FullName --force
} else {
  Write-Warning "VS Code 'code' command not found. Install $($vsix.Name) by hand: Extensions > ... > Install from VSIX."
}

# 2. hook script
$claude = Join-Path $env:USERPROFILE '.claude'
$hooks = Join-Path $claude 'hooks'
New-Item -ItemType Directory -Force -Path $hooks | Out-Null
$hookFile = Join-Path $hooks 'live-preview-selection.ps1'
Copy-Item -Force (Join-Path $here 'hooks\live-preview-selection.ps1') $hookFile

# 3. register in settings.json (UTF-8 without BOM; idempotent)
$settingsPath = Join-Path $claude 'settings.json'
$settings = if (Test-Path $settingsPath) { Get-Content -Raw -Encoding UTF8 $settingsPath | ConvertFrom-Json } else { [pscustomobject]@{} }
if (-not $settings.PSObject.Properties['hooks']) { $settings | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) }
if (-not $settings.hooks.PSObject.Properties['UserPromptSubmit']) { $settings.hooks | Add-Member -NotePropertyName UserPromptSubmit -NotePropertyValue @() }
$cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$hookFile`""
$existing = @($settings.hooks.UserPromptSubmit)
$already = $existing | Where-Object { $_.hooks | Where-Object { $_.command -like '*live-preview-selection*' } }
if ($already) {
  Write-Host "Hook already registered in $settingsPath"
} else {
  $entry = [pscustomobject]@{ hooks = @([pscustomobject]@{ type = 'command'; shell = 'powershell'; command = $cmd; timeout = 5 }) }
  $settings.hooks.UserPromptSubmit = @($existing + $entry)
  $json = $settings | ConvertTo-Json -Depth 32
  [System.IO.File]::WriteAllText($settingsPath, $json, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Hook registered in $settingsPath"
}

Write-Host ""
Write-Host "Done. Reload VS Code (Ctrl+Shift+P > Developer: Reload Window) and start a new Claude Code session."
Write-Host "Check: select text in a Live Preview, then this file should update:"
Write-Host "  $claude\live-preview-selection.json"
