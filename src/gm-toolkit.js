/**
 * GM Toolkit — Foundry VTT v13
 * Tabs: Claude AI | Debug Dump | Folder Structure | GM Console | Hotkeys | Image Paths
 */

const MODULE_ID = "gm-toolkit";
const SETTINGS  = {
  API_KEY: "claude-api-key",
};

const IPA_SETTINGS = {
  SEARCH_ROOTS:     "ipa-search-roots",
  SEARCH_DEPTH:     "ipa-search-depth",
  SCAN_COMPENDIUMS: "ipa-scan-compendiums",
};

// ---------------------------------------------------------------------------
// Error interceptor — runs immediately so we catch everything since load
// ---------------------------------------------------------------------------

const _errorLog = [];
const _origError = console.error.bind(console);
const _origWarn  = console.warn.bind(console);

console.error = (...a) => { _errorLog.push({ level: "error", ts: Date.now(), msg: a.map(String).join(" ") }); _origError(...a); };
console.warn  = (...a) => { _errorLog.push({ level: "warn",  ts: Date.now(), msg: a.map(String).join(" ") }); _origWarn(...a);  };

function getRecentErrors(n = 50) { return _errorLog.slice(-n); }

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const IPA_DEFAULT_ROOTS = [
  `modules/${MODULE_ID}/assets`,
  "modules",
  "systems",
  "worlds",
];

function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "launcher", {
    name: "Open GM Toolkit",
    label: "Open",
    hint: "Launch Tiny's GM Toolkit panel.",
    icon: "fas fa-toolbox",
    type: class extends Application {
      render() { injectStyles(); new GMToolkit().render({ force: true }); }
    },
    restricted: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.API_KEY, {
    name: "Claude API Key", hint: "Your Anthropic API key (sk-ant-...)",
    scope: "world", config: true, type: String, default: "",
    onChange: () => {},
  });
  game.settings.register(MODULE_ID, IPA_SETTINGS.SEARCH_ROOTS, {
    scope: "world", config: false, type: String,
    default: IPA_DEFAULT_ROOTS.join("\n"),
  });
  game.settings.register(MODULE_ID, IPA_SETTINGS.SEARCH_DEPTH, {
    scope: "world", config: false, type: Number, default: 2,
  });
  game.settings.register(MODULE_ID, IPA_SETTINGS.SCAN_COMPENDIUMS, {
    scope: "world", config: false, type: Boolean, default: false,
  });
}

function getApiKey()         { return game.settings.get(MODULE_ID, SETTINGS.API_KEY); }
function ipaGetRoots()       { return game.settings.get(MODULE_ID, IPA_SETTINGS.SEARCH_ROOTS).split("\n").map(s => s.trim()).filter(Boolean); }
function ipaGetDepth()       { return game.settings.get(MODULE_ID, IPA_SETTINGS.SEARCH_DEPTH); }
function ipaGetCompendiums() { return game.settings.get(MODULE_ID, IPA_SETTINGS.SCAN_COMPENDIUMS); }

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

function buildModuleContext() {
  return [...game.modules.values()]
    .filter(m => m.active)
    .map(m => ({ id: m.id, title: m.title, version: m.version }));
}

function buildSelectedDocContext() {
  const t = canvas.tokens?.controlled?.[0];
  if (t?.actor) return { type: "Actor", name: t.actor.name, id: t.actor.id, system: t.actor.system };
  const item = ui.activeWindow?.document;
  if (item) return { type: item.documentName, name: item.name, id: item.id };
  return null;
}

function buildErrorContext() { return getRecentErrors(20); }

function buildSystemContext() {
  return {
    foundryVersion: game.version,
    systemId: game.system.id,
    systemVersion: game.system.version,
    worldId: game.world.id,
  };
}

// ---------------------------------------------------------------------------
// Folder tree builder
// ---------------------------------------------------------------------------

function buildFolderTree() {
  const collections = [
    { label: "Actors",  folders: game.folders.filter(f => f.type === "Actor"),  docs: game.actors },
    { label: "Items",   folders: game.folders.filter(f => f.type === "Item"),   docs: game.items },
    { label: "Scenes",  folders: game.folders.filter(f => f.type === "Scene"),  docs: game.scenes },
    { label: "Journal", folders: game.folders.filter(f => f.type === "JournalEntry"), docs: game.journal },
    { label: "Tables",  folders: game.folders.filter(f => f.type === "RollTable"),    docs: game.tables },
    { label: "Macros",  folders: game.folders.filter(f => f.type === "Macro"),  docs: game.macros },
  ];

  function folderNode(folder, allFolders, allDocs) {
    return {
      id: folder.id,
      name: folder.name,
      children: allFolders.filter(f => f.folder?.id === folder.id).map(f => folderNode(f, allFolders, allDocs)),
      documents: allDocs.filter(d => d.folder?.id === folder.id).map(d => ({ id: d.id, name: d.name })),
    };
  }

  return collections.map(({ label, folders, docs }) => ({
    type: label,
    roots: folders.filter(f => !f.folder).map(f => folderNode(f, folders, docs)),
    unorganized: docs.filter(d => !d.folder).map(d => ({ id: d.id, name: d.name })),
  }));
}

function treeToText(tree, indent = 0) {
  const pad = (n) => "  ".repeat(n);
  let out = "";
  for (const col of tree) {
    out += `${pad(indent)}[${col.type}]\n`;
    const printNode = (node, depth) => {
      out += `${pad(depth)}📁 ${node.name}\n`;
      for (const doc of node.documents) out += `${pad(depth + 1)}• ${doc.name}\n`;
      for (const child of node.children) printNode(child, depth + 1);
    };
    for (const root of col.roots) printNode(root, indent + 1);
    if (col.unorganized.length) {
      out += `${pad(indent + 1)}[Unorganized]\n`;
      for (const d of col.unorganized) out += `${pad(indent + 2)}• ${d.name}\n`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reorganize importer
// ---------------------------------------------------------------------------

async function resolveOrCreateFolder(type, pathStr) {
  const parts = pathStr.split("/").map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  let parent = null;
  for (const part of parts) {
    let folder = game.folders.find(f => f.type === type && f.name === part && f.folder?.id === (parent?.id ?? null));
    if (!folder) folder = await Folder.create({ name: part, type, folder: parent?.id ?? null });
    parent = folder;
  }
  return parent;
}

async function applyReorganize(plan) {
  const results = { moved: 0, skipped: 0, errors: [] };
  for (const entry of plan) {
    try {
      const col = {
        Actor: game.actors, Item: game.items, Scene: game.scenes,
        JournalEntry: game.journal, RollTable: game.tables, Macro: game.macros,
      }[entry.type];
      if (!col) { results.errors.push(`Unknown type: ${entry.type}`); continue; }

      const doc = col.get(entry.documentId) ?? col.getName(entry.documentName);
      if (!doc) { results.skipped++; results.errors.push(`Not found: ${entry.documentName}`); continue; }

      const folder = entry.folder ? await resolveOrCreateFolder(entry.type, entry.folder) : null;
      await doc.update({ folder: folder?.id ?? null });
      results.moved++;
    } catch (e) {
      results.errors.push(`${entry.documentName}: ${e.message}`);
    }
  }
  return results;
}

function buildDiff(plan) {
  const rows = plan.map(entry => {
    const col = {
      Actor: game.actors, Item: game.items, Scene: game.scenes,
      JournalEntry: game.journal, RollTable: game.tables, Macro: game.macros,
    }[entry.type];
    const doc = col?.get(entry.documentId) ?? col?.getName(entry.documentName);
    const currentFolder = doc?.folder ? getFullFolderPath(doc.folder) : "(root)";
    const targetFolder  = entry.folder || "(root)";
    const changed = currentFolder !== targetFolder;
    return { name: entry.documentName, type: entry.type, from: currentFolder, to: targetFolder, changed, doc: !!doc };
  });
  return rows;
}

function getFullFolderPath(folder) {
  const parts = [];
  let f = folder;
  while (f) { parts.unshift(f.name); f = f.folder; }
  return parts.join("/");
}

// ---------------------------------------------------------------------------
// Hotkey analyzer
// ---------------------------------------------------------------------------

function analyzeHotkeys() {
  const bindings = game.keybindings.bindings;
  const byKey    = {};

  for (const [actionId, action] of bindings) {
    for (const binding of (action ?? [])) {
      const key = [
        binding.modifiers?.includes("Control") ? "Ctrl" : "",
        binding.modifiers?.includes("Shift")   ? "Shift" : "",
        binding.modifiers?.includes("Alt")      ? "Alt" : "",
        binding.key,
      ].filter(Boolean).join("+");

      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(actionId);
    }
  }

  const conflicts = Object.entries(byKey)
    .filter(([, actions]) => actions.length > 1)
    .map(([key, actions]) => ({ key, actions }));

  const allActions = [...game.keybindings.actions.entries()].map(([id, action]) => {
    const bound = bindings.get(id);
    return { id, name: action.name, namespace: action.namespace, unbound: !bound || bound.length === 0 };
  });

  const unbound = allActions.filter(a => a.unbound);

  const usedKeys = new Set(Object.keys(byKey));
  const pool     = ["Q","E","R","T","Y","F","G","H","Z","X","C","V","B","N","M",
                    "Ctrl+Q","Ctrl+E","Ctrl+R","Ctrl+T","Alt+Q","Alt+E","Alt+R",
                    "Shift+Q","Shift+E","Shift+R","Shift+T","Shift+F","Shift+G"];
  const free     = pool.filter(k => !usedKeys.has(k));

  return { conflicts, unbound, free, byKey };
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

async function callClaude(userMessage, context) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key set. Go to Settings > Module Settings > GM Toolkit.");

  const systemPrompt = `You are a Foundry VTT expert assistant helping a GM debug and organize their world.
Be concise. When suggesting reorganization, output a JSON array in this format:
[{"type":"Actor","documentName":"Name","documentId":"id_if_known","folder":"Parent/Child"}]
When fixing hotkey conflicts, list the action ID and the suggested new key.
Current world context is provided in the user message.`;

  const contextParts = [];
  if (context.system)  contextParts.push("## System\n```json\n" + JSON.stringify(context.system, null, 2)  + "\n```");
  if (context.modules) contextParts.push("## Active Modules\n```json\n" + JSON.stringify(context.modules, null, 2) + "\n```");
  if (context.doc)     contextParts.push("## Selected Document\n```json\n" + JSON.stringify(context.doc, null, 2)   + "\n```");
  if (context.errors?.length) contextParts.push("## Recent Errors\n```json\n" + JSON.stringify(context.errors, null, 2) + "\n```");
  if (context.hotkeys) contextParts.push("## Hotkey Conflicts\n```json\n" + JSON.stringify(context.hotkeys, null, 2) + "\n```");
  if (context.tree)    contextParts.push("## Folder Structure\n```\n" + context.tree + "\n```");

  const fullMessage = contextParts.length
    ? contextParts.join("\n\n") + "\n\n---\n\n" + userMessage
    : userMessage;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: fullMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `API error ${res.status}`);
  }

  const data = await res.json();
  return data.content.find(b => b.type === "text")?.text ?? "(no response)";
}

// ---------------------------------------------------------------------------
// Image Path Auditor — helpers
// ---------------------------------------------------------------------------

const IPA_IMAGE_FIELDS = [
  { type: "Actor",            field: "img" },
  { type: "Actor",            field: "prototypeToken.texture.src" },
  { type: "Item",             field: "img" },
  { type: "Scene",            field: "background.src" },
  { type: "Scene",            field: "foreground" },
  { type: "Scene",            field: "thumb" },
  { type: "Tile",             field: "texture.src" },
  { type: "Token",            field: "texture.src" },
  { type: "JournalEntryPage", field: "src" },
  { type: "Macro",            field: "img" },
  { type: "RollTable",        field: "img" },
  { type: "TableResult",      field: "img" },
  { type: "Cards",            field: "img" },
  { type: "Card",             field: "faces.img" },
];

function ipaIsSkippable(path) {
  if (!path || typeof path !== "string") return true;
  if (path.startsWith("data:"))   return true;
  if (path.startsWith("http://") || path.startsWith("https://")) return true;
  if (path === "icons/svg/mystery-man.svg") return true;
  if (path === "") return true;
  return false;
}

async function ipaPathExists(filePath) {
  try {
    const clean = filePath.replace(/^\//, "");
    const dir   = clean.substring(0, clean.lastIndexOf("/")) || ".";
    const name  = clean.substring(clean.lastIndexOf("/") + 1);
    const result = await FilePicker.browse("data", dir, { wildcard: false });
    return result.files.some(f => f.endsWith("/" + name) || f === name);
  } catch { return false; }
}

async function ipaSearchDir(dir, basename, maxDepth, depth = 0) {
  if (depth > maxDepth) return null;
  try {
    const result = await FilePicker.browse("data", dir, { wildcard: false });
    const match  = result.files.find(f => f.endsWith("/" + basename) || f === basename);
    if (match) return match.startsWith("/") ? match.slice(1) : match;
    for (const sub of (result.dirs ?? [])) {
      const found = await ipaSearchDir(sub, basename, maxDepth, depth + 1);
      if (found) return found;
    }
  } catch { /* skip */ }
  return null;
}

async function ipaFindByName(basename) {
  const roots = ipaGetRoots();
  const depth = ipaGetDepth();
  for (const root of roots) {
    const found = await ipaSearchDir(root, basename, depth - 1);
    if (found) return found;
  }
  return null;
}

function ipaGetNested(obj, path) {
  return path.split(".").reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

function ipaPushDocEntries(doc, entries, fromCompendium = false, packLabel = null) {
  const typeName = doc.documentName;
  for (const { type, field } of IPA_IMAGE_FIELDS) {
    if (type !== typeName) continue;
    const val = ipaGetNested(doc, field);
    if (!ipaIsSkippable(val)) entries.push({ doc, embeddedDoc: null, field, currentPath: val, fromCompendium, packLabel });
  }
  if (doc.tiles)   for (const t of doc.tiles)   ipaPushEmbedded(t, "Tile",        doc, entries, fromCompendium, packLabel);
  if (doc.tokens)  for (const t of doc.tokens)  ipaPushEmbedded(t, "Token",       doc, entries, fromCompendium, packLabel);
  if (doc.results) for (const r of doc.results) ipaPushEmbedded(r, "TableResult", doc, entries, fromCompendium, packLabel);
  if (doc.cards)   for (const c of doc.cards)   ipaPushEmbedded(c, "Card",        doc, entries, fromCompendium, packLabel);
  if (doc.pages) {
    for (const page of doc.pages) {
      const val = ipaGetNested(page, "src");
      if (!ipaIsSkippable(val)) entries.push({ doc, embeddedDoc: page, field: "src", currentPath: val, fromCompendium, packLabel });
    }
  }
}

function ipaPushEmbedded(embedded, typeName, parent, entries, fromCompendium, packLabel) {
  for (const { type, field } of IPA_IMAGE_FIELDS) {
    if (type !== typeName) continue;
    const val = ipaGetNested(embedded, field);
    if (!ipaIsSkippable(val)) entries.push({ doc: parent, embeddedDoc: embedded, field, currentPath: val, fromCompendium, packLabel });
  }
}

async function ipaCollect(includeCompendiums) {
  const entries = [];
  const worldCols = [game.actors, game.items, game.scenes, game.journal, game.macros, game.tables, game.cards].filter(Boolean);
  for (const col of worldCols) {
    for (const doc of col) ipaPushDocEntries(doc, entries, false);
  }
  if (includeCompendiums) {
    for (const pack of game.packs) {
      try {
        const docs = await pack.getDocuments();
        for (const doc of docs) ipaPushDocEntries(doc, entries, true, pack.metadata.label);
      } catch { /* skip locked/unavailable packs */ }
    }
  }
  return entries;
}

async function ipaRunAudit(onProgress, includeCompendiums) {
  const entries = await ipaCollect(includeCompendiums);
  const results = [];
  const counts  = { ok: 0, fixed: 0, unfixable: 0 };
  let i = 0;

  for (const entry of entries) {
    i++;
    onProgress?.({ phase: "Checking paths", cur: i, total: entries.length, path: entry.currentPath, stage: "exists", counts });

    const exists = await ipaPathExists(entry.currentPath);
    if (exists) {
      counts.ok++;
      results.push({ ...entry, exists: true, fixedPath: null, status: "ok" });
      onProgress?.({ phase: "Checking paths", cur: i, total: entries.length, path: entry.currentPath, stage: "done", counts });
      continue;
    }

    const basename = entry.currentPath.split("/").pop();
    onProgress?.({ phase: "Searching for file", cur: i, total: entries.length, path: basename, stage: "searching", counts });

    const fixedPath = await ipaFindByName(basename);
    if (fixedPath) {
      counts.fixed++;
      results.push({ ...entry, exists: false, fixedPath, status: "fixed" });
    } else {
      counts.unfixable++;
      results.push({ ...entry, exists: false, fixedPath: null, status: "unfixable" });
    }
    onProgress?.({ phase: "Checking paths", cur: i, total: entries.length, path: entry.currentPath, stage: "done", counts });
  }

  return results;
}

async function ipaApplyFixes(results, clearUnfixable, dryRun) {
  const toUpdate = results.filter(r =>
    (r.status === "fixed" && r._selected !== false) ||
    (clearUnfixable && r.status === "unfixable" && r._selected !== false)
  );
  if (dryRun) return toUpdate.length;
  for (const r of toUpdate) {
    const newVal = r.status === "fixed" ? r.fixedPath : "";
    try {
      if (r.embeddedDoc) await r.embeddedDoc.update({ [r.field]: newVal });
      else await r.doc.update({ [r.field]: newVal });
    } catch (err) {
      console.error(`[GM Toolkit / Image Paths] Failed to update ${r.doc?.name} / ${r.field}:`, err);
    }
  }
  return toUpdate.length;
}

function ipaShowPreview(result) {
  const oldSrc = result.currentPath;
  const newSrc = result.fixedPath;
  const label  = result.embeddedDoc
    ? `${result.doc?.name} / ${result.embeddedDoc?.name ?? result.embeddedDoc?.id}`
    : result.doc?.name;

  new Dialog({
    title: "Path Fix Preview",
    content: `
      <div class="ipa-preview-dialog">
        <p class="ipa-preview-doc"><strong>${label}</strong> &mdash; <code>${result.field}</code></p>
        <div class="ipa-preview-cols">
          <div class="ipa-preview-col">
            <div class="ipa-preview-label ipa-preview-label-old">Was</div>
            <div class="ipa-preview-img-wrap">
              <img src="${oldSrc}" onerror="this.src='icons/svg/cancel.svg'" class="ipa-preview-img">
            </div>
            <code class="ipa-preview-path">${oldSrc}</code>
          </div>
          <div class="ipa-preview-arrow">&#8594;</div>
          <div class="ipa-preview-col">
            <div class="ipa-preview-label ipa-preview-label-new">Will be</div>
            <div class="ipa-preview-img-wrap">
              <img src="${newSrc}" onerror="this.src='icons/svg/cancel.svg'" class="ipa-preview-img">
            </div>
            <code class="ipa-preview-path">${newSrc}</code>
          </div>
        </div>
      </div>`,
    buttons: { close: { label: "Close" } },
    default: "close",
  }, { width: 560 }).render(true);
}

// ---------------------------------------------------------------------------
// ApplicationV2 UI
// ---------------------------------------------------------------------------

const { ApplicationV2 } = foundry.applications.api;

class GMToolkit extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "gm-toolkit",
    classes: ["gm-toolkit"],
    window: { title: "Tiny's GM Toolkit", resizable: true },
    position: { width: 860, height: 680 },
  };

  constructor() {
    super({});
    this._tab        = "claude";
    this._aiHistory  = [];
    this._aiLoading  = false;
    this._dumpData   = null;
    this._tree       = null;
    this._diffPlan   = null;
    this._diffRows   = null;
    this._hotkeys    = null;
    this._ctx = { modules: true, doc: false, errors: false, hotkeys: false, tree: false };

    this._ipaResults  = null;
    this._ipaScanning = false;
    this._ipaDryRun   = true;
    this._ipaFilter   = "all";
  }

  async _renderHTML(context, options) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("gmt-wrapper");
    wrapper.innerHTML = this._buildHTML();
    return { main: wrapper };
  }

  _replaceHTML(result, content, options) {
    this.element.querySelector(".window-content").replaceChildren(result.main);
    this._activateListeners();
  }

  // ---- Top-level builder ---------------------------------------------------

  _buildHTML() {
    const tabs = [
      { id: "claude",     label: "Claude AI" },
      { id: "dump",       label: "Debug Dump" },
      { id: "structure",  label: "Folder Structure" },
      { id: "console",    label: "GM Console" },
      { id: "hotkeys",    label: "Hotkeys" },
      { id: "imagepaths", label: "Image Paths" },
    ];
    const tabBar = tabs.map(t =>
      `<button class="gmt-tab ${this._tab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
    ).join("");

    return `
      <div class="gmt-tabs">${tabBar}</div>
      <div class="gmt-content">${this._buildTab()}</div>`;
  }

  _buildTab() {
    switch (this._tab) {
      case "claude":     return this._buildClaude();
      case "dump":       return this._buildDump();
      case "structure":  return this._buildStructure();
      case "console":    return this._buildConsole();
      case "hotkeys":    return this._buildHotkeys();
      case "imagepaths": return this._buildImagePaths();
    }
  }

  // ---- Claude tab ----------------------------------------------------------

  _buildClaude() {
    const msgs = this._aiHistory.map(m => `
      <div class="gmt-msg gmt-msg-${m.role}">
        <span class="gmt-msg-role">${m.role === "user" ? "You" : "Claude"}</span>
        <div class="gmt-msg-body">${this._md(m.content)}</div>
      </div>`).join("");

    const ctxChecks = [
      { key: "modules", label: "Modules" },
      { key: "doc",     label: "Selected doc" },
      { key: "errors",  label: "Recent errors" },
      { key: "hotkeys", label: "Hotkey conflicts" },
      { key: "tree",    label: "Folder tree" },
    ].map(c => `
      <label class="gmt-ctx-check">
        <input type="checkbox" data-ctx="${c.key}" ${this._ctx[c.key] ? "checked" : ""}> ${c.label}
      </label>`).join("");

    return `
      <div class="gmt-claude">
        <div class="gmt-chat" id="gmt-chat">${msgs}${this._aiLoading ? '<div class="gmt-msg gmt-msg-assistant"><span class="gmt-msg-role">Claude</span><div class="gmt-msg-body gmt-thinking">Thinking...</div></div>' : ""}</div>
        <div class="gmt-ctx-bar">${ctxChecks}</div>
        <div class="gmt-input-row">
          <textarea id="gmt-input" placeholder="Ask Claude about your world, modules, errors..." rows="3"></textarea>
          <div class="gmt-input-btns">
            <button id="gmt-send-btn" class="gmt-btn" ${this._aiLoading ? "disabled" : ""}>Send</button>
            <button id="gmt-clear-btn" class="gmt-btn gmt-btn-secondary">Clear</button>
          </div>
        </div>
      </div>`;
  }

  // ---- Debug dump tab ------------------------------------------------------

  _buildDump() {
    const options = [
      { val: "modules",  label: "Active Modules" },
      { val: "system",   label: "System & World Info" },
      { val: "actor",    label: "Selected Actor" },
      { val: "errors",   label: "Recent Console Errors" },
      { val: "hooks",    label: "Registered Hooks (by module)" },
      { val: "settings", label: "All Module Settings" },
    ].map(o => `<label class="gmt-ctx-check"><input type="checkbox" class="gmt-dump-opt" value="${o.val}" checked> ${o.label}</label>`).join("");

    const dumpText = this._dumpData ? JSON.stringify(this._dumpData, null, 2) : "";

    return `
      <div class="gmt-dump">
        <div class="gmt-dump-opts">${options}</div>
        <button id="gmt-dump-btn" class="gmt-btn">Generate Dump</button>
        ${dumpText ? `
          <div class="gmt-dump-actions">
            <button id="gmt-copy-dump" class="gmt-btn gmt-btn-secondary">Copy to Clipboard</button>
            <span class="gmt-hint">Paste this into your Claude conversation for full context.</span>
          </div>
          <textarea class="gmt-dump-output" readonly>${dumpText}</textarea>` : ""}
      </div>`;
  }

  // ---- Folder structure tab ------------------------------------------------

  _buildStructure() {
    const treeText = this._tree ? treeToText(this._tree) : "";
    const diff = this._diffRows;

    const diffTable = diff ? `
      <div class="gmt-diff">
        <h3>Reorganization Preview</h3>
        <table class="gmt-table">
          <thead><tr><th>Type</th><th>Document</th><th>From</th><th>To</th><th></th></tr></thead>
          <tbody>
            ${diff.map(r => `
              <tr class="${r.changed ? "gmt-row-changed" : "gmt-row-same"} ${!r.doc ? "gmt-row-missing" : ""}">
                <td>${r.type}</td>
                <td>${r.name}${!r.doc ? " <span class='gmt-badge-warn'>not found</span>" : ""}</td>
                <td class="gmt-path">${r.from}</td>
                <td class="gmt-path">${r.changed ? r.to : ""}</td>
                <td>${r.changed ? "&#8594;" : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>
        <div class="gmt-diff-actions">
          <button id="gmt-apply-reorg" class="gmt-btn">Apply Reorganization</button>
          <button id="gmt-cancel-reorg" class="gmt-btn gmt-btn-secondary">Cancel</button>
          <span class="gmt-hint">${diff.filter(r => r.changed).length} changes, ${diff.filter(r => !r.doc).length} not found</span>
        </div>
      </div>` : "";

    return `
      <div class="gmt-structure">
        <div class="gmt-structure-actions">
          <button id="gmt-scan-tree" class="gmt-btn">Scan Folder Tree</button>
          <label class="gmt-btn gmt-btn-secondary gmt-file-label">
            Import Reorganization JSON
            <input type="file" id="gmt-import-file" accept=".json" style="display:none">
          </label>
        </div>
        ${treeText ? `
          <div class="gmt-tree-actions">
            <button id="gmt-copy-tree" class="gmt-btn gmt-btn-secondary">Copy Tree</button>
            <span class="gmt-hint">Paste into Claude and ask for a reorganization JSON.</span>
          </div>
          <pre class="gmt-tree">${treeText}</pre>` : ""}
        ${diffTable}
      </div>`;
  }

  // ---- GM Console tab ------------------------------------------------------

  _buildConsole() {
    const errors = getRecentErrors(100);
    const rows   = errors.slice().reverse().map(e => {
      const time = new Date(e.ts).toLocaleTimeString();
      return `<tr class="gmt-log-${e.level}">
        <td class="gmt-log-time">${time}</td>
        <td class="gmt-log-level">${e.level}</td>
        <td class="gmt-log-msg">${e.msg}</td>
      </tr>`;
    }).join("");

    return `
      <div class="gmt-console">
        <div class="gmt-console-header">
          <strong>Console Errors & Warnings</strong>
          <span class="gmt-hint">${errors.length} entries since load</span>
          <button id="gmt-clear-log" class="gmt-btn gmt-btn-secondary">Clear Log</button>
        </div>
        <div class="gmt-table-wrap">
          <table class="gmt-table gmt-log-table">
            <thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead>
            <tbody>${rows || "<tr><td colspan='3' style='text-align:center;color:#888'>No errors logged.</td></tr>"}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ---- Hotkeys tab ---------------------------------------------------------

  _buildHotkeys() {
    if (!this._hotkeys) {
      return `<div class="gmt-hotkeys"><button id="gmt-scan-hotkeys" class="gmt-btn">Scan Keybindings</button></div>`;
    }

    const { conflicts, unbound, free } = this._hotkeys;

    const conflictRows = conflicts.map(c => `
      <tr class="gmt-row-conflict">
        <td><kbd>${c.key}</kbd></td>
        <td>${c.actions.join("<br>")}</td>
        <td>${free.slice(0, 3).map(k => `<kbd class="gmt-free-key">${k}</kbd>`).join(" ")}</td>
      </tr>`).join("");

    const unboundRows = unbound.slice(0, 30).map(a => `
      <tr>
        <td>${a.namespace}</td>
        <td>${a.name ?? a.id}</td>
        <td>${free.slice(0, 1).map(k => `<kbd class="gmt-free-key">${k}</kbd>`).join("")}</td>
      </tr>`).join("");

    return `
      <div class="gmt-hotkeys">
        <button id="gmt-scan-hotkeys" class="gmt-btn gmt-btn-secondary">Re-scan</button>
        <button id="gmt-send-hotkeys" class="gmt-btn">Ask Claude for Suggestions</button>

        <h3>Conflicts (${conflicts.length})</h3>
        ${conflicts.length ? `
          <div class="gmt-table-wrap">
            <table class="gmt-table">
              <thead><tr><th>Key</th><th>Claimed by</th><th>Suggested free keys</th></tr></thead>
              <tbody>${conflictRows}</tbody>
            </table>
          </div>` : "<p style='color:#7ddb7d'>No conflicts found.</p>"}

        <h3>Unbound Actions (${unbound.length})</h3>
        ${unbound.length ? `
          <div class="gmt-table-wrap">
            <table class="gmt-table">
              <thead><tr><th>Namespace</th><th>Action</th><th>Suggested key</th></tr></thead>
              <tbody>${unboundRows}</tbody>
            </table>
          </div>` : "<p style='color:#7ddb7d'>All actions are bound.</p>"}

        <h3>Free Keys from common pool</h3>
        <div class="gmt-free-pool">${free.map(k => `<kbd class="gmt-free-key">${k}</kbd>`).join(" ")}</div>
      </div>`;
  }

  // ---- Image Paths tab -----------------------------------------------------

  _buildImagePaths() {
    if (this._ipaScanning) return this._buildIpaScanning();
    if (!this._ipaResults) return this._buildIpaIdle();
    return this._buildIpaResults();
  }

  _buildIpaIdle() {
    return `
      <div class="ipa-status">
        <p>Click <strong>Scan</strong> to audit all image and audio paths in this world.</p>
        ${this._buildIpaSettings()}
        <div class="ipa-idle-actions">
          <label class="ipa-label">
            <input type="checkbox" id="ipa-dryrun-check" ${this._ipaDryRun ? "checked" : ""}>
            Dry run (preview only, no changes applied)
          </label>
          <button id="ipa-scan-btn" class="gmt-btn">Scan World</button>
        </div>
      </div>`;
  }

  _buildIpaScanning() {
    return `
      <div class="ipa-status">
        <div class="ipa-progress-header">
          <span id="ipa-progress-phase">Collecting documents...</span>
          <span id="ipa-progress-count"></span>
        </div>
        <progress id="ipa-progress-bar" value="0" max="100"></progress>
        <div class="ipa-progress-sub">
          <span id="ipa-progress-stage"></span>
          <span id="ipa-progress-file"></span>
        </div>
        <div class="ipa-progress-stats">
          <span class="ipa-tag ok">OK: <b id="ipa-live-ok">0</b></span>
          <span class="ipa-tag fixed">Fixable: <b id="ipa-live-fixed">0</b></span>
          <span class="ipa-tag unfixable">Unfixable: <b id="ipa-live-unfixable">0</b></span>
        </div>
      </div>`;
  }

  _buildIpaResults() {
    const ok        = this._ipaResults.filter(r => r.status === "ok");
    const fixed     = this._ipaResults.filter(r => r.status === "fixed");
    const unfixable = this._ipaResults.filter(r => r.status === "unfixable");

    const visible = this._ipaFilter === "fixed"     ? fixed
                  : this._ipaFilter === "unfixable" ? unfixable
                  : [...fixed, ...unfixable, ...ok];

    const rows = visible.map(r => {
      const docLabel = r.embeddedDoc
        ? `${r.doc?.name ?? "?"} <small>/ ${r.embeddedDoc?.name ?? r.embeddedDoc?.id ?? "?"}</small>`
        : (r.doc?.name ?? "?");
      const packBadge  = r.fromCompendium ? `<span class="ipa-pack-badge" title="${r.packLabel}">[C]</span>` : "";
      const previewBtn = r.status === "fixed"
        ? `<button class="ipa-preview-btn" data-idx="${this._ipaResults.indexOf(r)}" title="Preview fix">&#128065;</button>`
        : "";
      const resolution = r.status === "ok"
        ? `<span class="ipa-ok-text">OK</span>`
        : r.status === "fixed"
          ? `<span class="ipa-fixed-text" title="${r.fixedPath}">${r.fixedPath.split("/").pop()}</span>`
          : `<span class="ipa-unfixable-text">Not found</span>`;
      return `<tr class="row-${r.status}">
        <td>${packBadge}${docLabel}<br><small class="ipa-field-name">${r.field}</small></td>
        <td class="ipa-path" title="${r.currentPath}">${r.currentPath}</td>
        <td>${resolution}${previewBtn}</td>
      </tr>`;
    }).join("");

    const dryBadge = this._ipaDryRun ? `<span class="ipa-dry-badge">DRY RUN</span>` : "";

    return `
      <div class="ipa-results-wrap">
        <div class="ipa-summary">
          ${dryBadge}
          <span class="ipa-tag ok">OK: ${ok.length}</span>
          <span class="ipa-tag fixed">Fixable: ${fixed.length}</span>
          <span class="ipa-tag unfixable">Unfixable: ${unfixable.length}</span>
          <div class="ipa-filter-wrap">
            Show:
            <button class="ipa-filter-btn ${this._ipaFilter === "all"       ? "active" : ""}" data-filter="all">All</button>
            <button class="ipa-filter-btn ${this._ipaFilter === "fixed"     ? "active" : ""}" data-filter="fixed">Fixable</button>
            <button class="ipa-filter-btn ${this._ipaFilter === "unfixable" ? "active" : ""}" data-filter="unfixable">Unfixable</button>
          </div>
        </div>

        <div class="ipa-table-wrap">
          <table class="gmt-table ipa-table">
            <thead><tr><th>Document</th><th>Current Path</th><th>Resolution</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        ${this._buildIpaSettings()}

        <div class="ipa-actions">
          <label class="ipa-label">
            <input type="checkbox" id="ipa-dryrun-check" ${this._ipaDryRun ? "checked" : ""}>
            Dry run
          </label>
          <label class="ipa-label">
            <input type="checkbox" id="ipa-clear-check">
            Clear unfixable paths
          </label>
          <button id="ipa-apply-btn" class="gmt-btn" ${fixed.length === 0 ? "disabled" : ""}>
            ${this._ipaDryRun ? "Preview Apply" : "Apply Fixes"} (${fixed.length})
          </button>
          <button id="ipa-scan-btn" class="gmt-btn gmt-btn-secondary">Re-scan</button>
        </div>
      </div>`;
  }

  _buildIpaSettings() {
    return `
      <details class="ipa-settings">
        <summary>Search Settings</summary>
        <div class="ipa-settings-body">
          <label class="ipa-settings-label">Search Roots (one per line)
            <textarea id="ipa-roots-input" rows="5">${ipaGetRoots().join("\n")}</textarea>
          </label>
          <label class="ipa-settings-label">Search Depth: <span id="ipa-depth-val">${ipaGetDepth()}</span>
            <input type="range" id="ipa-depth-input" min="1" max="5" value="${ipaGetDepth()}">
            <small>Higher = slower but finds more deeply nested files.</small>
          </label>
          <label class="ipa-settings-label ipa-settings-inline">
            <input type="checkbox" id="ipa-comps-check" ${ipaGetCompendiums() ? "checked" : ""}>
            Also scan compendium packs (slower)
          </label>
          <button id="ipa-save-settings-btn" class="gmt-btn gmt-btn-secondary">Save Settings</button>
        </div>
      </details>`;
  }

  // ---- Listeners -----------------------------------------------------------

  _activateListeners() {
    this.element.querySelectorAll(".gmt-tab").forEach(btn =>
      btn.addEventListener("click", () => { this._tab = btn.dataset.tab; this.render(); })
    );

    // Claude tab
    this.element.querySelectorAll("[data-ctx]").forEach(cb =>
      cb.addEventListener("change", () => { this._ctx[cb.dataset.ctx] = cb.checked; })
    );
    this.element.querySelector("#gmt-send-btn")?.addEventListener("click", () => this._sendMessage());
    this.element.querySelector("#gmt-clear-btn")?.addEventListener("click", () => { this._aiHistory = []; this.render(); });
    this.element.querySelector("#gmt-input")?.addEventListener("keydown", e => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) this._sendMessage();
    });

    // Dump tab
    this.element.querySelector("#gmt-dump-btn")?.addEventListener("click", () => this._generateDump());
    this.element.querySelector("#gmt-copy-dump")?.addEventListener("click", () => {
      navigator.clipboard.writeText(JSON.stringify(this._dumpData, null, 2));
      ui.notifications.info("Dump copied to clipboard.");
    });

    // Structure tab
    this.element.querySelector("#gmt-scan-tree")?.addEventListener("click",  () => this._scanTree());
    this.element.querySelector("#gmt-copy-tree")?.addEventListener("click",  () => {
      navigator.clipboard.writeText(treeToText(this._tree));
      ui.notifications.info("Folder tree copied to clipboard.");
    });
    this.element.querySelector("#gmt-import-file")?.addEventListener("change", e => this._handleImport(e));
    this.element.querySelector("#gmt-apply-reorg")?.addEventListener("click",  () => this._applyReorg());
    this.element.querySelector("#gmt-cancel-reorg")?.addEventListener("click", () => { this._diffPlan = null; this._diffRows = null; this.render(); });

    // Console tab
    this.element.querySelector("#gmt-clear-log")?.addEventListener("click", () => { _errorLog.length = 0; this.render(); });

    // Hotkeys tab
    this.element.querySelector("#gmt-scan-hotkeys")?.addEventListener("click", () => { this._hotkeys = analyzeHotkeys(); this.render(); });
    this.element.querySelector("#gmt-send-hotkeys")?.addEventListener("click", () => this._sendHotkeysToAI());

    // Image Paths tab
    this.element.querySelector("#ipa-scan-btn")?.addEventListener("click",  () => this._ipaStartScan());
    this.element.querySelector("#ipa-apply-btn")?.addEventListener("click", () => this._ipaApplyFixes());

    this.element.querySelector("#ipa-dryrun-check")?.addEventListener("change", e => {
      this._ipaDryRun = e.target.checked;
      const btn = this.element.querySelector("#ipa-apply-btn");
      if (btn) btn.textContent = `${this._ipaDryRun ? "Preview Apply" : "Apply Fixes"} (${this._ipaResults?.filter(r => r.status === "fixed").length ?? 0})`;
    });

    const depthInput = this.element.querySelector("#ipa-depth-input");
    const depthVal   = this.element.querySelector("#ipa-depth-val");
    depthInput?.addEventListener("input", () => { if (depthVal) depthVal.textContent = depthInput.value; });

    this.element.querySelector("#ipa-save-settings-btn")?.addEventListener("click", async () => {
      const roots = this.element.querySelector("#ipa-roots-input")?.value ?? IPA_DEFAULT_ROOTS.join("\n");
      const depth = parseInt(this.element.querySelector("#ipa-depth-input")?.value ?? "2");
      const comps = !!this.element.querySelector("#ipa-comps-check")?.checked;
      await game.settings.set(MODULE_ID, IPA_SETTINGS.SEARCH_ROOTS, roots);
      await game.settings.set(MODULE_ID, IPA_SETTINGS.SEARCH_DEPTH, depth);
      await game.settings.set(MODULE_ID, IPA_SETTINGS.SCAN_COMPENDIUMS, comps);
      ui.notifications.info("Image path search settings saved.");
    });

    this.element.querySelectorAll(".ipa-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => { this._ipaFilter = btn.dataset.filter; this.render(); });
    });

    this.element.querySelectorAll(".ipa-preview-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx);
        if (this._ipaResults?.[idx]) ipaShowPreview(this._ipaResults[idx]);
      });
    });
  }

  // ---- Actions -------------------------------------------------------------

  async _sendMessage() {
    const input = this.element.querySelector("#gmt-input");
    const text  = input?.value?.trim();
    if (!text) return;

    const context = {};
    if (this._ctx.modules)  context.system  = { ...buildSystemContext(), modules: buildModuleContext() };
    if (this._ctx.doc)      context.doc     = buildSelectedDocContext();
    if (this._ctx.errors)   context.errors  = buildErrorContext();
    if (this._ctx.hotkeys)  context.hotkeys = analyzeHotkeys();
    if (this._ctx.tree)     context.tree    = treeToText(buildFolderTree());

    this._aiHistory.push({ role: "user", content: text });
    if (input) input.value = "";
    this._aiLoading = true;
    await this.render();
    this._scrollChat();

    try {
      const reply = await callClaude(text, context);
      this._aiHistory.push({ role: "assistant", content: reply });

      const jsonMatch = reply.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
      if (jsonMatch) {
        try {
          const plan = JSON.parse(jsonMatch[1]);
          if (Array.isArray(plan) && plan[0]?.type && plan[0]?.documentName) {
            this._diffPlan = plan;
            this._diffRows = buildDiff(plan);
            this._tab = "structure";
          }
        } catch { /* not a valid reorg plan */ }
      }
    } catch (e) {
      this._aiHistory.push({ role: "assistant", content: `Error: ${e.message}` });
    }

    this._aiLoading = false;
    await this.render();
    this._scrollChat();
  }

  _scrollChat() {
    const chat = this.element.querySelector("#gmt-chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  _generateDump() {
    const opts = [...this.element.querySelectorAll(".gmt-dump-opt:checked")].map(c => c.value);
    const dump = {};
    if (opts.includes("system"))   dump.system   = buildSystemContext();
    if (opts.includes("modules"))  dump.modules  = buildModuleContext();
    if (opts.includes("actor"))    dump.actor    = buildSelectedDocContext();
    if (opts.includes("errors"))   dump.errors   = buildErrorContext();
    if (opts.includes("hooks"))    dump.hookCount = Object.fromEntries([...Hooks._hooks].map(([k, v]) => [k, v.length]));
    if (opts.includes("settings")) {
      dump.settings = {};
      for (const [key] of game.settings.settings) {
        try { dump.settings[key] = game.settings.get(...key.split(".")); } catch { /* skip */ }
      }
    }
    this._dumpData = dump;
    this.render();
  }

  _scanTree() {
    this._tree = buildFolderTree();
    this.render();
  }

  async _handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const plan = JSON.parse(text);
      if (!Array.isArray(plan)) throw new Error("Expected a JSON array.");
      this._diffPlan = plan;
      this._diffRows = buildDiff(plan);
      this.render();
    } catch (err) {
      ui.notifications.error(`Invalid reorganization file: ${err.message}`);
    }
  }

  async _applyReorg() {
    if (!this._diffPlan) return;
    const changed = this._diffRows.filter(r => r.changed && r.doc).length;
    const confirmed = await Dialog.confirm({
      title: "Apply Reorganization",
      content: `<p>Move <strong>${changed}</strong> document(s) to new folders?</p>`,
    });
    if (!confirmed) return;
    const results = await applyReorganize(this._diffPlan);
    ui.notifications.info(`Moved ${results.moved} document(s). ${results.errors.length} error(s).`);
    if (results.errors.length) console.error("[GM Toolkit] Reorg errors:", results.errors);
    this._diffPlan = null;
    this._diffRows = null;
    this._tree     = buildFolderTree();
    this.render();
  }

  async _sendHotkeysToAI() {
    if (!this._hotkeys) this._hotkeys = analyzeHotkeys();
    this._tab = "claude";
    this._ctx.hotkeys = true;
    this._aiHistory.push({ role: "user", content: "Here are my current hotkey conflicts and unbound actions. Please suggest a clean keybinding layout to resolve conflicts and fill in useful unbound actions." });
    this._aiLoading = true;
    await this.render();

    try {
      const reply = await callClaude("Suggest a clean keybinding layout.", { hotkeys: this._hotkeys, system: buildSystemContext() });
      this._aiHistory.push({ role: "assistant", content: reply });
    } catch (e) {
      this._aiHistory.push({ role: "assistant", content: `Error: ${e.message}` });
    }

    this._aiLoading = false;
    this.render();
  }

  async _ipaStartScan() {
    if (!game.user.isGM) return;
    this._ipaDryRun   = !!this.element.querySelector("#ipa-dryrun-check")?.checked ?? this._ipaDryRun;
    this._ipaScanning = true;
    this._ipaResults  = null;
    this._ipaFilter   = "fixed";
    await this.render();

    this._ipaResults = await ipaRunAudit(({ phase, cur, total, path, stage, counts }) => {
      const bar     = this.element.querySelector("#ipa-progress-bar");
      const ph      = this.element.querySelector("#ipa-progress-phase");
      const cnt     = this.element.querySelector("#ipa-progress-count");
      const stg     = this.element.querySelector("#ipa-progress-stage");
      const fil     = this.element.querySelector("#ipa-progress-file");
      const elOk    = this.element.querySelector("#ipa-live-ok");
      const elFixed = this.element.querySelector("#ipa-live-fixed");
      const elUnfix = this.element.querySelector("#ipa-live-unfixable");
      if (bar)    bar.value         = Math.round((cur / total) * 100);
      if (ph)     ph.textContent    = phase;
      if (cnt)    cnt.textContent   = `${cur} / ${total}`;
      if (stg)    stg.textContent   = stage === "searching" ? "Searching directories..." : stage === "exists" ? "Verifying..." : "";
      if (fil)    fil.textContent   = path.split("/").pop();
      if (elOk)   elOk.textContent   = counts.ok;
      if (elFixed) elFixed.textContent = counts.fixed;
      if (elUnfix) elUnfix.textContent = counts.unfixable;
    }, ipaGetCompendiums());

    this._ipaScanning = false;
    await this.render();
  }

  async _ipaApplyFixes() {
    if (!game.user.isGM) return;
    const clearUnfixable = !!this.element.querySelector("#ipa-clear-check")?.checked;
    const fixed     = this._ipaResults?.filter(r => r.status === "fixed") ?? [];
    const unfixable = clearUnfixable ? (this._ipaResults?.filter(r => r.status === "unfixable") ?? []) : [];
    const total     = fixed.length + unfixable.length;
    if (total === 0) return;

    if (this._ipaDryRun) {
      ui.notifications.info(`[Image Paths] Dry run: would update ${total} path(s). Uncheck "Dry run" to apply.`);
      return;
    }

    const confirmed = await Dialog.confirm({
      title: "Apply Path Fixes",
      content: `<p>Update <strong>${fixed.length}</strong> fixable path(s)${clearUnfixable ? ` and clear <strong>${unfixable.length}</strong> unfixable path(s)` : ""}?</p>`,
    });
    if (!confirmed) return;

    await ipaApplyFixes(this._ipaResults, clearUnfixable, false);
    ui.notifications.info(`[Image Paths] Applied ${total} update(s).`);
    await this._ipaStartScan();
  }

  // ---- Minimal markdown renderer -------------------------------------------

  _md(text) {
    return text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/```json([\s\S]*?)```/g, "<pre class='gmt-code'>$1</pre>")
      .replace(/```([\s\S]*?)```/g,     "<pre class='gmt-code'>$1</pre>")
      .replace(/`([^`]+)`/g,            "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g,        "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g,            "<em>$1</em>")
      .replace(/^### (.+)$/gm,          "<h4>$1</h4>")
      .replace(/^## (.+)$/gm,           "<h3>$1</h3>")
      .replace(/^# (.+)$/gm,            "<h2>$1</h2>")
      .replace(/^- (.+)$/gm,            "<li>$1</li>")
      .replace(/\n/g,                   "<br>");
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById("gmt-styles")) return;
  const s = document.createElement("style");
  s.id = "gmt-styles";
  s.textContent = `
    /* Layout */
    .gmt-wrapper       { display:flex; flex-direction:column; height:100%; overflow:hidden; }
    .gmt-tabs          { display:flex; gap:2px; padding:6px 8px 0; border-bottom:1px solid #444; flex-shrink:0; }
    .gmt-tab           { padding:5px 14px; border-radius:4px 4px 0 0; background:#2a2a2a; border:1px solid #444; border-bottom:none; cursor:pointer; color:#aaa; font-size:0.85em; }
    .gmt-tab:hover     { background:#333; color:#fff; }
    .gmt-tab.active    { background:#1a1a2e; color:#fff; border-color:#5a2d82; }
    .gmt-content       { flex:1; overflow-y:auto; padding:10px; }

    /* Claude tab */
    .gmt-claude        { display:flex; flex-direction:column; height:100%; gap:8px; }
    .gmt-chat          { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; min-height:0; border:1px solid #333; border-radius:4px; padding:8px; background:#111; }
    .gmt-msg           { display:flex; flex-direction:column; gap:3px; max-width:90%; }
    .gmt-msg-user      { align-self:flex-end; }
    .gmt-msg-assistant { align-self:flex-start; }
    .gmt-msg-role      { font-size:0.72em; color:#888; text-transform:uppercase; letter-spacing:0.05em; }
    .gmt-msg-body      { background:#1e1e2e; border-radius:6px; padding:8px 10px; font-size:0.85em; line-height:1.5; }
    .gmt-msg-user .gmt-msg-body  { background:#2a1a3e; }
    .gmt-thinking      { color:#888; font-style:italic; }
    .gmt-ctx-bar       { display:flex; gap:10px; flex-wrap:wrap; font-size:0.82em; border:1px solid #333; border-radius:4px; padding:5px 8px; background:#111; }
    .gmt-ctx-check     { display:flex; align-items:center; gap:4px; cursor:pointer; }
    .gmt-input-row     { display:flex; gap:6px; }
    .gmt-input-row textarea { flex:1; background:#1a1a1a; color:#ccc; border:1px solid #555; border-radius:4px; padding:6px; font-size:0.85em; resize:none; }
    .gmt-input-btns    { display:flex; flex-direction:column; gap:4px; }
    .gmt-code          { background:#0d1117; border:1px solid #333; border-radius:4px; padding:6px; font-size:0.78em; overflow-x:auto; white-space:pre; }

    /* Dump tab */
    .gmt-dump          { display:flex; flex-direction:column; gap:8px; }
    .gmt-dump-opts     { display:flex; gap:10px; flex-wrap:wrap; font-size:0.85em; border:1px solid #333; border-radius:4px; padding:8px; }
    .gmt-dump-actions  { display:flex; align-items:center; gap:10px; }
    .gmt-dump-output   { width:100%; height:320px; font-family:monospace; font-size:0.75em; background:#0d1117; color:#ccc; border:1px solid #444; border-radius:4px; padding:8px; resize:vertical; }

    /* Structure tab */
    .gmt-structure     { display:flex; flex-direction:column; gap:8px; }
    .gmt-structure-actions { display:flex; gap:8px; }
    .gmt-tree-actions  { display:flex; align-items:center; gap:10px; }
    .gmt-tree          { background:#0d1117; border:1px solid #444; border-radius:4px; padding:10px; font-size:0.78em; line-height:1.6; overflow:auto; max-height:280px; white-space:pre; color:#ccc; }
    .gmt-file-label    { cursor:pointer; }
    .gmt-diff          { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
    .gmt-diff h3       { margin:0; font-size:0.9em; color:#aaa; }
    .gmt-diff-actions  { display:flex; align-items:center; gap:10px; }
    .gmt-row-changed td { background:#0d1f2d; }
    .gmt-row-same td   { opacity:0.5; }
    .gmt-row-missing td { background:#2d0d0d; }
    .gmt-badge-warn    { background:#3a1a00; color:#dd9900; font-size:0.75em; padding:1px 5px; border-radius:3px; }

    /* Console tab */
    .gmt-console       { display:flex; flex-direction:column; gap:8px; height:100%; }
    .gmt-console-header { display:flex; align-items:center; gap:10px; }
    .gmt-log-table td:last-child { font-family:monospace; font-size:0.78em; word-break:break-all; }
    .gmt-log-error td  { background:#2d0d0d; }
    .gmt-log-warn td   { background:#2d2000; }
    .gmt-log-time      { white-space:nowrap; color:#888; font-size:0.8em; }
    .gmt-log-level     { font-weight:bold; text-transform:uppercase; font-size:0.75em; width:50px; }
    .gmt-log-error .gmt-log-level { color:#db7d7d; }
    .gmt-log-warn  .gmt-log-level { color:#ddb97d; }

    /* Hotkeys tab */
    .gmt-hotkeys       { display:flex; flex-direction:column; gap:10px; }
    .gmt-hotkeys h3    { margin:8px 0 4px; font-size:0.9em; color:#aaa; border-bottom:1px solid #333; padding-bottom:4px; }
    .gmt-free-pool     { display:flex; flex-wrap:wrap; gap:4px; }
    .gmt-row-conflict td { background:#2d0d0d; }
    kbd                { background:#222; border:1px solid #555; border-radius:3px; padding:1px 6px; font-size:0.82em; font-family:monospace; }
    .gmt-free-key      { background:#1a2e1a; border-color:#3a5a3a; color:#7ddb7d; cursor:default; }

    /* Shared table/button */
    .gmt-table-wrap    { overflow:auto; max-height:300px; border:1px solid #444; border-radius:4px; }
    .gmt-table         { width:100%; border-collapse:collapse; font-size:0.82em; }
    .gmt-table th      { background:#222; padding:5px 8px; text-align:left; position:sticky; top:0; }
    .gmt-table td      { padding:4px 8px; border-bottom:1px solid #2a2a2a; vertical-align:top; }
    .gmt-path          { font-family:monospace; font-size:0.8em; color:#aaa; }
    .gmt-hint          { font-size:0.78em; color:#888; }
    .gmt-btn           { padding:5px 14px; border-radius:4px; background:#5a2d82; color:#fff; border:none; cursor:pointer; white-space:nowrap; }
    .gmt-btn:hover     { background:#7a4da2; }
    .gmt-btn:disabled  { opacity:0.4; cursor:not-allowed; }
    .gmt-btn-secondary { background:#333; }
    .gmt-btn-secondary:hover { background:#555; }

    /* Image Paths tab */
    .ipa-results-wrap    { display:flex; flex-direction:column; gap:8px; height:100%; }
    .ipa-status          { padding:8px; display:flex; flex-direction:column; gap:10px; }
    .ipa-progress-header { display:flex; justify-content:space-between; align-items:baseline; font-weight:bold; }
    .ipa-progress-header #ipa-progress-count { font-size:0.85em; color:#aaa; }
    #ipa-progress-bar    { width:100%; height:14px; border-radius:6px; }
    .ipa-progress-sub    { display:flex; justify-content:space-between; font-size:0.8em; color:#999; min-height:1.2em; }
    .ipa-progress-stats  { display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; }
    .ipa-summary         { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .ipa-tag             { padding:3px 10px; border-radius:4px; font-weight:bold; font-size:0.85em; }
    .ipa-tag.ok          { background:#1a3a1a; color:#7ddb7d; }
    .ipa-tag.fixed       { background:#1a2e3a; color:#7db8db; }
    .ipa-tag.unfixable   { background:#3a1a1a; color:#db7d7d; }
    .ipa-dry-badge       { padding:3px 10px; border-radius:4px; background:#3a3a00; color:#dddd00; font-size:0.82em; font-weight:bold; letter-spacing:0.05em; }
    .ipa-filter-wrap     { display:flex; align-items:center; gap:4px; margin-left:auto; font-size:0.82em; }
    .ipa-filter-btn      { padding:2px 8px; border-radius:3px; background:#333; border:1px solid #555; color:#ccc; cursor:pointer; font-size:0.85em; }
    .ipa-filter-btn:hover { background:#444; }
    .ipa-filter-btn.active { background:#5a2d82; border-color:#7a4da2; color:#fff; }
    .ipa-table-wrap      { overflow-y:auto; flex:1; border:1px solid #444; border-radius:4px; }
    .ipa-table td        { padding:4px 8px; border-bottom:1px solid #333; vertical-align:top; }
    .ipa-path            { font-family:monospace; word-break:break-all; max-width:240px; font-size:0.78em; color:#aaa; }
    .ipa-field-name      { color:#888; font-size:0.9em; }
    .ipa-pack-badge      { background:#2a2a4a; color:#9999dd; border-radius:3px; padding:1px 4px; font-size:0.78em; margin-right:4px; cursor:help; }
    .row-ok td           { opacity:0.45; }
    .row-fixed td        { background:#0d1f2d; }
    .row-unfixable td    { background:#2d0d0d; }
    .ipa-ok-text         { color:#7ddb7d; }
    .ipa-fixed-text      { color:#7db8db; font-family:monospace; font-size:0.85em; word-break:break-all; }
    .ipa-unfixable-text  { color:#db7d7d; }
    .ipa-preview-btn     { background:none; border:none; cursor:pointer; font-size:1em; padding:0 4px; opacity:0.7; vertical-align:middle; }
    .ipa-preview-btn:hover { opacity:1; }
    .ipa-settings        { border:1px solid #444; border-radius:4px; padding:4px 8px; }
    .ipa-settings summary { cursor:pointer; font-weight:bold; font-size:0.85em; padding:4px 0; }
    .ipa-settings-body   { display:flex; flex-direction:column; gap:8px; padding:8px 0; }
    .ipa-settings-label  { display:flex; flex-direction:column; gap:4px; font-size:0.83em; }
    .ipa-settings-inline { flex-direction:row; align-items:center; gap:6px; }
    .ipa-settings-label textarea { font-family:monospace; font-size:0.9em; resize:vertical; background:#1a1a1a; color:#ccc; border:1px solid #555; border-radius:3px; padding:4px; }
    .ipa-settings-label input[type=range] { width:100%; }
    .ipa-settings-label small { color:#888; }
    .ipa-actions         { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding-top:4px; }
    .ipa-idle-actions    { display:flex; align-items:center; gap:10px; }
    .ipa-label           { display:flex; align-items:center; gap:6px; font-size:0.85em; }
    .ipa-preview-dialog  { padding:8px; }
    .ipa-preview-doc     { margin-bottom:10px; font-size:0.9em; }
    .ipa-preview-cols    { display:flex; align-items:flex-start; gap:12px; }
    .ipa-preview-col     { flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; }
    .ipa-preview-arrow   { font-size:2em; align-self:center; color:#aaa; }
    .ipa-preview-label   { font-size:0.8em; font-weight:bold; letter-spacing:0.05em; padding:2px 8px; border-radius:3px; }
    .ipa-preview-label-old { background:#3a1a1a; color:#db7d7d; }
    .ipa-preview-label-new { background:#1a3a1a; color:#7ddb7d; }
    .ipa-preview-img-wrap { width:180px; height:180px; display:flex; align-items:center; justify-content:center; background:#111; border:1px solid #444; border-radius:4px; }
    .ipa-preview-img     { max-width:176px; max-height:176px; object-fit:contain; }
    .ipa-preview-path    { font-size:0.72em; word-break:break-all; color:#aaa; text-align:center; max-width:180px; }
  `;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

Hooks.once("init", () => {
  registerSettings();

  // Sidebar Settings tab — inject button every time the tab renders
  Hooks.on("renderSettings", (app, html) => {
    if (!game.user?.isGM) return;
    // v13 may pass jQuery; normalise to a raw HTMLElement
    const el = (html instanceof HTMLElement) ? html : (html[0] ?? html);
    if (!el?.querySelector) return;
    const section = el.querySelector("#settings-game")
      ?? el.querySelector(".settings-list")
      ?? el.querySelector("section")
      ?? el;
    if (section.querySelector(".gmt-sidebar-btn")) return; // already injected
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gmt-sidebar-btn";
    btn.textContent = "Tiny's GM Toolkit";
    btn.style.cssText = "margin-top:6px;width:100%;";
    btn.addEventListener("click", () => { injectStyles(); new GMToolkit().render({ force: true }); });
    section.appendChild(btn);
  });
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  injectStyles();

  game.modules.get(MODULE_ID).api ??= {};
  game.modules.get(MODULE_ID).api.open = () => { injectStyles(); new GMToolkit().render({ force: true }); };
});
