# UserPromptSubmit hook (Windows): pass the text selected in the Markdown Live
# Preview Editor to Claude as context. Same behaviour as live-preview-selection.py:
# a selection is sent in full once per session, then only a one-line reminder
# while it stays the same; a long one is sent as head + tail + line range; and
# a one-line notice (systemMessage) tells the user what was sent.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$claude = Join-Path $env:USERPROFILE '.claude'
$selPath = Join-Path $claude 'live-preview-selection.json'
$sentPath = Join-Path $claude 'live-preview-selection.sent.json'
$fullLimit = 4000; $headLen = 2500; $tailLen = 800

$hook = $null
try { $hook = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch {}
$session = if ($hook -and $hook.session_id) { "$($hook.session_id)" } else { '' }

if (-not (Test-Path $selPath)) { exit 0 }
try { $d = Get-Content -Raw -Encoding UTF8 $selPath | ConvertFrom-Json } catch { exit 0 }
$text = "$($d.text)".Trim("`n")
if (-not $text.Trim()) { exit 0 }
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if ($now - [int64]$d.time -gt 30 * 60 * 1000) { exit 0 }

$path = "$($d.file)"
$name = Split-Path -Leaf $path
$a = $d.startLine; $b = $d.endLine
if ($a) {
  if ($a -eq $b) { $lines = "line $a"; $short = "${name}:$a" } else { $lines = "lines $a-$b"; $short = "${name}:$a-$b" }
} else { $lines = ''; $short = $name }
$nLines = ($text -split "`n").Count
$sha = [System.Security.Cryptography.SHA1]::Create()
$sig = [BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$path|$($d.from)|$($d.to)|$text"))).Replace('-', '').ToLower()

$sent = @{}
if (Test-Path $sentPath) {
  try {
    $obj = Get-Content -Raw -Encoding UTF8 $sentPath | ConvertFrom-Json
    foreach ($p in $obj.PSObject.Properties) { $sent[$p.Name] = @{ sig = $p.Value.sig; time = [int64]$p.Value.time } }
  } catch {}
}

if ($session -and $sent.ContainsKey($session) -and $sent[$session].sig -eq $sig) {
  $context = "The user still has the same text selected in the Markdown Live Preview: $path, $lines. Its text was given earlier in this conversation; read those lines from the file if it is no longer in view."
  $notice = "Live Preview selection unchanged ($short); Claude was reminded, not resent the text."
} else {
  $where = if ($lines) { "$path, $lines" } else { $path }
  $source = if ($a) { 'exact Markdown source' } else { 'rendered text; markup may be missing' }
  $saved = if ($d.dirty) { '; WARNING: unsaved, the file on disk may differ' } else { '' }
  $body = $text
  if ($text.Length -gt $fullLimit) {
    $body = $text.Substring(0, $headLen) + "`n[... $($text.Length - $headLen - $tailLen) characters omitted; read $where for the full selection ...]`n" + $text.Substring($text.Length - $tailLen)
  }
  $context = "The user has this text selected in the Markdown Live Preview of $where ($source$saved):`n<live_preview_selection>`n$body`n</live_preview_selection>`nIt may or may not be relevant to their message. If you act on it, name the file and lines you took it to be."
  $plural = if ($nLines -ne 1) { 's' } else { '' }
  $notice = "Live Preview selection sent to Claude: $short ($nLines line$plural"
  $notice += if ($text.Length -gt $fullLimit) { ', head and tail only)' } else { ')' }
  if ($session) {
    $sent[$session] = @{ sig = $sig; time = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
    $keep = [ordered]@{}
    foreach ($e in ($sent.GetEnumerator() | Sort-Object { $_.Value.time } | Select-Object -Last 50)) { $keep[$e.Key] = $e.Value }
    try { [System.IO.File]::WriteAllText($sentPath, ($keep | ConvertTo-Json -Depth 4 -Compress), (New-Object System.Text.UTF8Encoding($false))) } catch {}
  }
}

$out = [ordered]@{
  systemMessage = $notice
  hookSpecificOutput = [ordered]@{ hookEventName = 'UserPromptSubmit'; additionalContext = $context }
}
Write-Output ($out | ConvertTo-Json -Depth 4 -Compress)
