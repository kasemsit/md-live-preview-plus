#!/usr/bin/env bash
# Build the patched .vsix from the pristine upstream package.
#   ./build.sh [upstream.vsix]      (default: upstream/t-shoot.markdown-live-preview-editor-0.4.0.vsix)
# Download a newer upstream with:
#   curl -L -o upstream/t-shoot.markdown-live-preview-editor-X.Y.Z.vsix \
#     https://marketplace.visualstudio.com/_apis/public/gallery/publishers/t-shoot/vsextensions/markdown-live-preview-editor/X.Y.Z/vspackage
set -euo pipefail
cd "$(dirname "$0")"
UP="${1:-upstream/t-shoot.markdown-live-preview-editor-0.4.0.vsix}"
rm -rf build/unpacked && mkdir -p build/unpacked
unzip -q "$UP" -d build/unpacked
SRC=build/unpacked/extension
python3 styles/build_style.py
node patch.js "$SRC" --rename
node --check "$SRC/dist/extension.js"
node --check "$SRC/dist/webview-editor.js"
VER=$(node -p "require('./$SRC/package.json').version")
OUT="markdown-live-preview-editor-claude-$VER.vsix"
(cd "$SRC" && npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository -o "../../../$OUT" >/dev/null)
echo "built $OUT"
