#!/usr/bin/env bash
# md-live-preview-plus installer for Linux and macOS. Run from the unzipped release folder:
#   ./install.sh
# 1. installs the .vsix (the CSS theme ships inside it and switches on by itself)
# 2. copies the Claude Code hook to ~/.claude/hooks/
# 3. registers the hook in ~/.claude/settings.json (other settings kept)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VSIX="$(ls "$HERE"/markdown-live-preview-editor-claude-*.vsix 2>/dev/null | head -1)"
[ -n "$VSIX" ] || { echo "No .vsix next to install.sh" >&2; exit 1; }

if command -v code >/dev/null; then
  code --uninstall-extension t-shoot.markdown-live-preview-editor >/dev/null 2>&1 || true
  code --install-extension "$VSIX" --force
else
  echo "VS Code 'code' command not found: install $(basename "$VSIX") by hand (Extensions > ... > Install from VSIX)." >&2
fi

mkdir -p "$HOME/.claude/hooks"
cp "$HERE/hooks/live-preview-selection.py" "$HOME/.claude/hooks/"

python3 - <<'EOF'
import json, os
p = os.path.expanduser("~/.claude/settings.json")
d = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
ups = d.setdefault("hooks", {}).setdefault("UserPromptSubmit", [])
if any("live-preview-selection" in h.get("command", "") for e in ups for h in e.get("hooks", [])):
    print("Hook already registered in", p)
else:
    ups.append({"hooks": [{"type": "command", "command": "python3 ~/.claude/hooks/live-preview-selection.py", "timeout": 5}]})
    json.dump(d, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print("Hook registered in", p)
EOF

echo
echo "Done. Reload VS Code and start a new Claude Code session."
echo "Check: select text in a Live Preview, then ~/.claude/live-preview-selection.json should update."
