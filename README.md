# GM Toolkit

Foundry VTT v13 GM-only module. Six-tab toolkit for world management, debugging, and maintenance.

## Install

Paste into Foundry's module installer:

```
https://github.com/TinyDragonEgg/gm-toolkit/releases/latest/download/module.json
```

## Tabs

| Tab | What it does |
|---|---|
| Claude AI | Chat with Claude using selectable world context (modules, selected doc, errors, hotkeys, folder tree) |
| Debug Dump | Generate a copyable JSON snapshot of your world state for sharing or pasting into Claude |
| Folder Structure | Scan folder tree, copy it, import a reorganization JSON from Claude, preview diff, apply |
| GM Console | Live error/warn log intercepted since world load, color coded by level |
| Hotkeys | Detect conflicts, list unbound actions, suggest free keys, send to Claude for a layout suggestion |
| Image Paths | Scan all world and compendium documents for broken image/audio paths, auto-resolve by filename, preview before applying |

## Setup

1. Enable the module.
2. Go to **Settings > Module Settings > GM Toolkit** and paste your Anthropic API key (`sk-ant-...`).
3. Open via **Settings > GM Toolkit**.

## Image Path Auditor

The Image Paths tab scans every Actor, Item, Scene, Tile, Token, JournalEntryPage, Macro, RollTable, Card, and TableResult for broken paths. For each broken path it searches your configurable root directories by filename and proposes a fix. Use the eye button to preview any proposed change before applying.

## License

MIT
