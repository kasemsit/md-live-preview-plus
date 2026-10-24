#!/usr/bin/env bash
# Build, test, tag and publish a GitHub release of md-live-preview-plus.
#
#   plus/release.sh            # releases the version in package.json
#   plus/release.sh --dry-run  # builds and tests only; no tag, no push, no release
#
# Before running: bump "version" in package.json and add a "## <version>"
# section to plus/CHANGES.md (it becomes the release notes), commit both.
# The GitHub token comes from `git credential fill` and is never printed.
# Never publishes to the VS Code Marketplace: that listing is upstream's.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=kasemsit/md-live-preview-plus
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

VER=$(node -p "require('./package.json').version")
TAG="v$VER"
NOTES=$(awk -v v="## $VER" '$0==v{f=1;next} /^## /{f=0} f' plus/CHANGES.md)
[ -n "$NOTES" ] || { echo "plus/CHANGES.md has no '## $VER' section" >&2; exit 1; }
if [ $DRY = 0 ]; then
  [ -z "$(git status --porcelain)" ] || { echo "working tree not clean" >&2; exit 1; }
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "not on main" >&2; exit 1; }
  ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "$TAG already exists" >&2; exit 1; }
fi

npm run compile
npm test
npx playwright test

OUT=build/release
rm -rf "$OUT"; mkdir -p "$OUT/md-live-preview-plus/hooks"
npx vsce package -o "$OUT/"
VSIX="$OUT/markdown-live-preview-editor-claude-$VER.vsix"
cp "$VSIX" plus/install.sh plus/install.ps1 "$OUT/md-live-preview-plus/"
cp plus/hooks/* "$OUT/md-live-preview-plus/hooks/"
(cd "$OUT" && zip -qr md-live-preview-plus.zip md-live-preview-plus)
echo "built $VSIX and $OUT/md-live-preview-plus.zip"
[ $DRY = 1 ] && { echo "dry run: stopping before tag/push/release"; exit 0; }

git tag -a "$TAG" -m "md-live-preview-plus $VER"
git push origin main "$TAG"

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
[ -n "$TOKEN" ] || { echo "no GitHub credential; tag pushed, create the release by hand" >&2; exit 1; }
api() { curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$@"; }

BODY=$(TAG="$TAG" NOTES="$NOTES" node -e 'process.stdout.write(JSON.stringify({tag_name:process.env.TAG,name:"md-live-preview-plus "+process.env.TAG,body:process.env.NOTES}))')
ID=$(api -X POST "https://api.github.com/repos/$REPO/releases" -d "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(!j.id){console.error(j.message||s);process.exit(1)}console.log(j.id)})')
for f in "$VSIX" "$OUT/md-live-preview-plus.zip"; do
  api -X POST -H "Content-Type: application/octet-stream" --data-binary @"$f" \
    "https://uploads.github.com/repos/$REPO/releases/$ID/assets?name=$(basename "$f")" >/dev/null
  echo "uploaded $(basename "$f")"
done
echo "released https://github.com/$REPO/releases/tag/$TAG"
