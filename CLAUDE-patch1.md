# CLAUDE.md — gm-toolkit Patch 1: Playlists & Cards

You are patching a single existing file. Read DEV_NOTES first. Make only the changes described. Touch nothing else.

---

## DEV_NOTES

- File to edit: `src/gm-toolkit.js`
- Two functions need changes: `buildFolderTree` and `applyReorganize`
- `game.playlists` uses Foundry's standard folder system — same as actors/items
- `game.cards` uses Foundry's standard folder system — same as actors/items
- Playlist tracks are embedded documents inside playlists. Do not walk them — only the Playlist document itself gets a folder
- Do not modify any other function
- All logging goes through `console.error` prefixed `[GM Toolkit]` — existing pattern in the file
- Append to CHANGELOG.md after changes

---

## Change 1 — buildFolderTree

Find this block inside `buildFolderTree`:

```js
  const collections = [
    { label: "Actors",  folders: game.folders.filter(f => f.type === "Actor"),  docs: game.actors },
    { label: "Items",   folders: game.folders.filter(f => f.type === "Item"),   docs: game.items },
    { label: "Scenes",  folders: game.folders.filter(f => f.type === "Scene"),  docs: game.scenes },
    { label: "Journal", folders: game.folders.filter(f => f.type === "JournalEntry"), docs: game.journal },
    { label: "Tables",  folders: game.folders.filter(f => f.type === "RollTable"),    docs: game.tables },
    { label: "Macros",  folders: game.folders.filter(f => f.type === "Macro"),  docs: game.macros },
  ];
```

Replace with:

```js
  const collections = [
    { label: "Actors",    folders: game.folders.filter(f => f.type === "Actor"),       docs: game.actors },
    { label: "Items",     folders: game.folders.filter(f => f.type === "Item"),        docs: game.items },
    { label: "Scenes",    folders: game.folders.filter(f => f.type === "Scene"),       docs: game.scenes },
    { label: "Journal",   folders: game.folders.filter(f => f.type === "JournalEntry"),docs: game.journal },
    { label: "Tables",    folders: game.folders.filter(f => f.type === "RollTable"),   docs: game.tables },
    { label: "Macros",    folders: game.folders.filter(f => f.type === "Macro"),       docs: game.macros },
    { label: "Playlists", folders: game.folders.filter(f => f.type === "Playlist"),    docs: game.playlists },
    { label: "Cards",     folders: game.folders.filter(f => f.type === "Cards"),       docs: game.cards },
  ];
```

---

## Change 2 — applyReorganize

Find this block inside `applyReorganize`:

```js
      const col = {
        Actor: game.actors, Item: game.items, Scene: game.scenes,
        JournalEntry: game.journal, RollTable: game.tables, Macro: game.macros,
      }[entry.type];
```

Replace with:

```js
      const col = {
        Actor: game.actors, Item: game.items, Scene: game.scenes,
        JournalEntry: game.journal, RollTable: game.tables, Macro: game.macros,
        Playlist: game.playlists, Cards: game.cards,
      }[entry.type];
```

---

## Change 3 — CHANGELOG.md

```bash
cat >> CHANGELOG.md <<'EOF'

## Patch 1
### Added
- Folder Structure tab now includes Playlists and Cards collections
- Reorganization importer now supports Playlist and Cards document types
EOF
```

---

## Release

```bash
bash scripts/release.sh 1.1.0
git add -A && git commit -m "Patch 1 — Playlists and Cards in folder structure" && git tag 1.1.0 && git push origin main --tags
```

---

## Rules

- Edit `src/gm-toolkit.js` only.
- Make exactly the two code changes described. No other modifications.
- Do not re-read the file after writing.
- Do not summarize.
- When done, print only: `Done. Tag a release with: bash scripts/release.sh 1.1.0`
