# UserPromptSubmit hook (Windows): pass the text selected in the Markdown Live
# Preview Editor to Claude as context. Same behaviour as live-preview-selection.py.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$p = Join-Path $env:USERPROFILE '.claude\live-preview-selection.json'
if (-not (Test-Path $p)) { exit 0 }
try { $d = Get-Content -Raw -Encoding UTF8 $p | ConvertFrom-Json } catch { exit 0 }
$text = "$($d.text)".Trim()
if (-not $text) { exit 0 }
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if ($now - [int64]$d.time -gt 30 * 60 * 1000) { exit 0 }
if ($text.Length -gt 20000) { $text = $text.Substring(0, 20000) + "`n[... truncated]" }
$where = "$($d.file)"
if ($d.startLine) {
  if ($d.startLine -eq $d.endLine) { $where += ", line $($d.startLine)" } else { $where += ", lines $($d.startLine)-$($d.endLine)" }
  $where += " (source offsets $($d.from)-$($d.to); exact markdown source"
  if ($d.dirty) { $where += "; WARNING: file still unsaved, disk may differ)" } else { $where += "; file saved, disk matches)" }
} else { $where += " (rendered text; markup may be missing)" }
Write-Output "The user has this text selected in the Markdown Live Preview of ${where}:"
Write-Output "<live_preview_selection>"
Write-Output $text
Write-Output "</live_preview_selection>"
Write-Output "It may or may not be relevant to their message."
