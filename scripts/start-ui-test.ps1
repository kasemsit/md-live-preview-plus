param([switch]$PrepareOnly, [string]$CodeExe)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath "$repoRoot/dist/extension.js")) {
    throw 'Run npm.cmd run compile first.'
}
if (-not $CodeExe) {
    $codeCommand = Get-Command code.cmd -ErrorAction Stop
    $CodeExe = [IO.Path]::GetFullPath((Join-Path (Split-Path $codeCommand.Source -Parent) '../Code.exe'))
}
if (-not (Test-Path -LiteralPath $CodeExe)) { throw "VS Code not found: $CodeExe" }
# Each run gets fresh copies. Existing test edits and the original sample are preserved.
$runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$runRoot = Join-Path $repoRoot "test-results/manual-ui/$runId"
$testWorkspace = Join-Path $runRoot 'workspace'
New-Item -ItemType Directory -Path $testWorkspace -Force | Out-Null
Copy-Item -LiteralPath "$repoRoot/sample" -Destination $testWorkspace -Recurse
$settingsDir = Join-Path $testWorkspace '.vscode'
New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
'{"mdLivePreview.defaultEditor":"livePreview","files.autoSave":"off","window.title":"MDLP UI Test - ${activeEditorShort}"}' | Set-Content -LiteralPath "$settingsDir/settings.json" -Encoding utf8
$codeArgs = @(
    '--new-window', '--disable-extensions',
    "--extensionDevelopmentPath=$repoRoot",
    "--user-data-dir=$repoRoot/.vscode-test/manual-user",
    "--extensions-dir=$repoRoot/.vscode-test/manual-extensions",
    $testWorkspace, (Join-Path $testWorkspace 'sample/sample.md')
)
@{ executable = $CodeExe; arguments = $codeArgs; workspace = $testWorkspace } |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath "$runRoot/launch.json" -Encoding utf8
Write-Output "Test workspace: $testWorkspace"
if (-not $PrepareOnly) {
    # Visible because the requested task is interactive extension testing.
    $quotedArgs = $codeArgs | ForEach-Object { '"' + $_ + '"' }
    $previousNodeMode = $env:ELECTRON_RUN_AS_NODE
    try {
        # Coding-agent shells may inherit Electron's Node-only mode.
        $env:ELECTRON_RUN_AS_NODE = $null
        Start-Process -FilePath $CodeExe -ArgumentList $quotedArgs -WorkingDirectory $repoRoot | Out-Null
    } finally {
        $env:ELECTRON_RUN_AS_NODE = $previousNodeMode
    }
}
