# CLAUDE.md — gm-toolkit bootstrap

You are setting up a Foundry VTT module repository from scratch and publishing it to GitHub. Follow every instruction exactly. Ask nothing. Infer nothing. Use scripts for all multi-file work.

---

## Identity

- Module ID: `gm-toolkit`
- Display name: GM Toolkit
- Author: Tiny Dragon
- Foundry compatibility: v13
- System: any
- License: MIT

---

## Step 1 — Scaffold with a script

Create `scripts/scaffold.sh` first, then run it. Do not create files one by one.

```bash
#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT"/{scripts,src,languages,.github/workflows}

cat > "$ROOT/module.json" <<'EOF'
{
  "id": "gm-toolkit",
  "title": "GM Toolkit",
  "description": "GM-only toolkit for Foundry VTT v13. Tabs: Claude AI assistant with world context, debug dump generator, folder structure scanner and reorganizer, GM console error log, and hotkey conflict analyzer.",
  "version": "{{version}}",
  "compatibility": {
    "minimum": "13",
    "verified": "13"
  },
  "authors": [{ "name": "Tiny Dragon" }],
  "license": "MIT",
  "url": "https://github.com/TinyDragon/gm-toolkit",
  "manifest": "https://github.com/TinyDragon/gm-toolkit/releases/latest/download/module.json",
  "download": "https://github.com/TinyDragon/gm-toolkit/releases/download/{{version}}/gm-toolkit.zip",
  "scripts": ["src/gm-toolkit.js"],
  "languages": [],
  "flags": {}
}
EOF

cat > "$ROOT/LICENSE" <<'EOF'
MIT License

Copyright (c) 2026 Tiny Dragon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF

cat > "$ROOT/.gitignore" <<'EOF'
node_modules/
*.zip
dist/
.DS_Store
Thumbs.db
EOF

cat > "$ROOT/README.md" <<'EOF'
# GM Toolkit

Foundry VTT v13 GM-only module. Five-tab toolkit for world management and debugging.

## Install

Paste into Foundry's module installer:

```
https://github.com/TinyDragon/gm-toolkit/releases/latest/download/module.json
```

## Tabs

| Tab | What it does |
|---|---|
| Claude AI | Chat with Claude using selectable world context (modules, selected doc, errors, hotkeys, folder tree) |
| Debug Dump | Generate a copyable JSON snapshot of your world state for sharing or pasting into Claude |
| Folder Structure | Scan folder tree, copy it, import a reorganization JSON from Claude, preview diff, apply |
| GM Console | Live error/warn log intercepted since world load, color coded by level |
| Hotkeys | Detect conflicts, list unbound actions, suggest free keys, send to Claude for a layout suggestion |

## Setup

1. Enable the module.
2. Go to **Settings > Module Settings > GM Toolkit** and paste your Anthropic API key (`sk-ant-...`).
3. Open via **Settings > GM Toolkit**.

## License

MIT
EOF

echo "Scaffold complete."
```

```bash
chmod +x scripts/scaffold.sh && bash scripts/scaffold.sh
```

---

## Step 2 — Place the module source

Copy the full JS source into `src/gm-toolkit.js` verbatim. Do not modify it.

```
[PASTE FULL CONTENTS OF gm-toolkit.js HERE]
```

> The source file is provided separately. Do not generate or rewrite it.

---

## Step 3 — Release script

Create `scripts/release.sh`:

```bash
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
```

```bash
chmod +x scripts/release.sh
```

---

## Step 4 — GitHub Actions workflow

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - '[0-9]+.[0-9]+.[0-9]+'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - name: Stamp version into module.json
        run: sed -i "s/{{version}}/${GITHUB_REF_NAME}/g" module.json

      - name: Build zip
        run: |
          zip -r gm-toolkit.zip \
            module.json \
            src/ \
            languages/ \
            LICENSE \
            README.md

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: ${{ github.ref_name }}
          body: |
            Install via Foundry module manager using the manifest URL, or download the zip below.

            **Manifest:** `https://github.com/${{ github.repository }}/releases/download/${{ github.ref_name }}/module.json`
          files: |
            gm-toolkit.zip
            module.json
```

---

## Step 5 — Create GitHub repo and push

If `gh` is not authenticated run `gh auth login` first, then continue.

```bash
cd /path/to/gm-toolkit   # adjust to actual path

git init
git add -A
git commit -m "Initial commit"
git branch -M main

gh repo create gm-toolkit \
  --public \
  --description "Foundry VTT v13 GM toolkit — Claude AI assistant, debug dump, folder reorganizer, error console, hotkey analyzer" \
  --source . \
  --remote origin \
  --push
```

---

## Step 6 — First release

```bash
bash scripts/release.sh 1.0.0
git add -A && git commit -m "Release 1.0.0" && git tag 1.0.0 && git push origin main --tags
```

---

## Future releases

```bash
bash scripts/release.sh <version>
git add -A && git commit -m "Release <version>" && git tag <version> && git push origin main --tags
```

---

## File tree when done

```
gm-toolkit/
├── .github/
│   └── workflows/
│       └── release.yml
├── scripts/
│   ├── scaffold.sh
│   └── release.sh
├── src/
│   └── gm-toolkit.js
├── languages/
├── .gitignore
├── LICENSE
├── module.json
└── README.md
```

---

## Rules

- Use scripts for any operation touching more than one file.
- Do not re-read files you just wrote.
- Do not summarize between steps unless a step fails.
- If a command fails, print the error and the fix. Do not retry blindly.
- When done, print only: `Done. Tag a release with: bash scripts/release.sh <version>`
