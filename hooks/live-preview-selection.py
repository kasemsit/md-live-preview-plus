#!/usr/bin/env python3
"""UserPromptSubmit hook: pass the text selected in the Markdown Live Preview
Editor (a webview, so VS Code reports no selection) to Claude as context.

The patched extension writes ~/.claude/live-preview-selection.json
({file, text, time}) on every selection change. Injected only when the
selection is non-empty and less than 30 minutes old.
"""
import json, os, sys, time

P = os.path.expanduser("~/.claude/live-preview-selection.json")
try:
    d = json.load(open(P, encoding="utf-8"))
except Exception:
    sys.exit(0)
text = (d.get("text") or "").strip()
if not text or time.time() * 1000 - d.get("time", 0) > 30 * 60 * 1000:
    sys.exit(0)
if len(text) > 20000:
    text = text[:20000] + "\n[... truncated]"
where = d.get("file")
if d.get("startLine"):
    a, b = d["startLine"], d["endLine"]
    where += f", line {a}" if a == b else f", lines {a}-{b}"
    where += f" (source offsets {d.get('from')}-{d.get('to')}; exact markdown source"
    where += "; WARNING: file still unsaved, disk may differ)" if d.get("dirty") else "; file saved, disk matches)"
else:
    where += " (rendered text; markup may be missing)"
print(f"The user has this text selected in the Markdown Live Preview of {where}:\n"
      f"<live_preview_selection>\n{text}\n</live_preview_selection>\n"
      "It may or may not be relevant to their message.")
