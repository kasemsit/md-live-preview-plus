#!/usr/bin/env python3
"""UserPromptSubmit hook: pass the text selected in the Markdown Live Preview
Editor (a webview, so VS Code reports no selection) to Claude as context.

The extension writes ~/.claude/live-preview-selection.json on every selection
change. This hook:
- sends a selection in full only the first time a session sees it; while it
  stays the same, later prompts get a one-line reminder of where it is, so the
  conversation does not grow with every prompt;
- sends a long selection as its head and tail plus its line range, which
  Claude can read from the file;
- shows the user a one-line notice (systemMessage) saying what was sent,
  because injected context is otherwise invisible;
- ignores an empty selection, or one older than 30 minutes.
"""
import hashlib, json, os, sys, time

HOME = os.path.expanduser("~/.claude")
SEL = os.path.join(HOME, "live-preview-selection.json")
SENT = os.path.join(HOME, "live-preview-selection.sent.json")
MAX_AGE_MS = 30 * 60 * 1000
FULL_LIMIT = 4000          # characters sent in full
HEAD, TAIL = 2500, 800     # what a longer selection keeps

try:
    hook = json.load(sys.stdin)
except Exception:
    hook = {}
session = str(hook.get("session_id") or "")
try:
    d = json.load(open(SEL, encoding="utf-8"))
except Exception:
    sys.exit(0)
text = (d.get("text") or "").strip("\n")
if not text.strip() or time.time() * 1000 - d.get("time", 0) > MAX_AGE_MS:
    sys.exit(0)

path = d.get("file") or "?"
name = os.path.basename(path)
a, b = d.get("startLine"), d.get("endLine")
lines = f"line {a}" if a and a == b else f"lines {a}-{b}" if a else ""
short = f"{name}:{a}" if a and a == b else f"{name}:{a}-{b}" if a else name
n_lines = text.count("\n") + 1
sig = hashlib.sha1(f"{path}|{d.get('from')}|{d.get('to')}|{text}".encode("utf-8")).hexdigest()

try:
    sent = json.load(open(SENT, encoding="utf-8"))
    if not isinstance(sent, dict):
        sent = {}
except Exception:
    sent = {}

if session and sent.get(session, {}).get("sig") == sig:
    context = (f"The user still has the same text selected in the Markdown Live Preview: {path}, {lines}. "
               "Its text was given earlier in this conversation; read those lines from the file if it is no longer in view.")
    notice = f"Live Preview selection unchanged ({short}); Claude was reminded, not resent the text."
else:
    where = f"{path}, {lines}" if lines else path
    source = "exact Markdown source" if a else "rendered text; markup may be missing"
    saved = "; WARNING: unsaved, the file on disk may differ" if d.get("dirty") else ""
    body = text
    if len(text) > FULL_LIMIT:
        body = (text[:HEAD] + f"\n[... {len(text) - HEAD - TAIL} characters omitted; read {where} for the full selection ...]\n"
                + text[-TAIL:])
    context = (f"The user has this text selected in the Markdown Live Preview of {where} ({source}{saved}):\n"
               f"<live_preview_selection>\n{body}\n</live_preview_selection>\n"
               "It may or may not be relevant to their message. If you act on it, name the file and lines you took it to be.")
    notice = f"Live Preview selection sent to Claude: {short} ({n_lines} line{'s' if n_lines != 1 else ''}"
    notice += ", head and tail only)" if len(text) > FULL_LIMIT else ")"
    if session:
        sent[session] = {"sig": sig, "time": int(time.time())}
        # Keep the 50 most recent sessions.
        sent = dict(sorted(sent.items(), key=lambda kv: kv[1].get("time", 0))[-50:])
        try:
            with open(SENT, "w", encoding="utf-8") as f:
                json.dump(sent, f)
        except Exception:
            pass

print(json.dumps({
    "systemMessage": notice,
    "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": context},
}, ensure_ascii=False))
