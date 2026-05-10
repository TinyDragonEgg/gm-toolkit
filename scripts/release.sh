#!/usr/bin/env bash
set -e
VERSION="${1:?Usage: release.sh <version>  e.g. 1.0.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

sed -i "s/\"{{version}}\"/\"$VERSION\"/g" "$ROOT/module.json"
sed -i "s/{{version}}/$VERSION/g"         "$ROOT/module.json"

cd "$ROOT"
zip -r "gm-toolkit.zip" \
  module.json \
  src/ \
  languages/ \
  LICENSE \
  README.md

echo ""
echo "Release $VERSION ready. Run:"
echo "  git add -A"
echo "  git commit -m \"Release $VERSION\""
echo "  git tag $VERSION"
echo "  git push origin main --tags"
