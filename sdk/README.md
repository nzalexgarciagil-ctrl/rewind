# Rewind SDK

Add git-based version control to any Adobe Premiere Pro CEP extension. Snapshots, named versions, restore, GitHub backup — all from a single `<script>` tag.

## Quick Start

**With UI (recommended):**
```html
<script src="rewind-sdk/rewind.js"></script>
<script>
    RewindSDK.init({ autoSaveInterval: 60 });
    RewindSDK.mountUI('#my-panel');
    // The UI has a "Start Tracking" button
</script>
```

**Headless (no UI):**
```js
var rewind = RewindSDK.init({ autoSaveInterval: 60 });
rewind.start().then(function() {
    console.log('Tracking:', rewind.getState().projectPath);
}).catch(function(err) {
    console.error(err.message);
});
```

## Installation

1. Copy the `sdk/` folder into your extension directory (rename it to `rewind-sdk/` if you like)
2. Point your manifest's `<ScriptPath>` to `rewind-sdk/host/rewind-host.jsx`
3. Include `rewind-sdk/rewind.js` via a `<script>` tag in your `index.html`
4. Make sure `CSInterface.js` is loaded before `rewind.js`

### Directory Structure

```
your-extension/
├── CSXS/manifest.xml          # Point ScriptPath to rewind-host.jsx
├── index.html                 # Include rewind.js here
├── rewind-sdk/                # Copy this folder in
│   ├── rewind.js              # Main entry point (include this)
│   ├── core/                  # Core modules (loaded automatically)
│   ├── ui/                    # Optional UI widget
│   ├── host/                  # ExtendScript backend
│   │   └── rewind-host.jsx    # Point ScriptPath here
│   └── dist/                  # Pre-built single-file bundles
│       ├── rewind.js          # Core only (single file)
│       ├── rewind-with-ui.js  # Core + UI (single file)
│       ├── rewind-ui.css      # UI styles
│       └── rewind-host.jsx    # ExtendScript (copy)
```

**Using pre-built bundles:** If you prefer a single file instead of the `core/` folder, use `dist/rewind.js` or `dist/rewind-with-ui.js` instead.

## API Reference

### Initialization

```js
// Initialize with options
var rewind = RewindSDK.init({
    autoSaveInterval: 60,           // seconds (0 to disable, default: 60)
    autoPush: false,                // auto-push to GitHub after snapshots
    gitPath: 'git',                 // custom git executable path
    vcDirName: '.rewind',           // version control directory name
    hostFunctionName: 'handleMessage', // ExtendScript function name
    csInterface: myCSInterface,     // pass your own CSInterface instance
    onEvent: function(event, data) { }  // event callback
});
```

### Lifecycle

```js
rewind.start()     // Start tracking the current project (returns Promise)
rewind.destroy()   // Stop tracking, clean up timers
```

### Snapshots

```js
rewind.snapshot('Before color grade')   // Manual snapshot (returns Promise<boolean>)
rewind.restore('abc1234')               // Restore to commit hash (returns Promise)
rewind.getHistory(20)                   // Get last N snapshots (returns Promise<Array>)
```

### Versions (Branches)

```js
rewind.createVersion('Director Cut')    // Create new version (returns Promise)
rewind.switchVersion('director-cut')    // Switch to version by branch name
rewind.listVersions()                   // List all versions (returns Promise<Array>)
rewind.deleteVersion('director-cut')    // Delete a version
rewind.getCurrentVersion()              // Get current version info
```

### Labels

```js
rewind.addLabel('abc1234', 'Final mix')  // Label a snapshot
rewind.getLabels()                       // Get all labels ({hash: label})
```

### Diffs

```js
rewind.getDiff('abc1234', 'def5678')    // Compare two snapshots
// Returns: { totalChanges, sequences, projectSettings, summary }
```

### Settings

```js
rewind.getSettings()                    // Get current settings
rewind.saveSettings({                   // Update settings
    autoSaveIntervalSeconds: 120,
    autoPush: true
})
```

### State

```js
rewind.getState()      // { initialized, projectPath, currentBranch, currentVersion, lastSavedAt }
rewind.isTracked()     // Is the current project being tracked?
rewind.getRepoPath()   // Path to the .rewind git repo
```

### Events

```js
rewind.on(function(event, data) {
    switch(event) {
        case 'initialized':      // Tracking started
        case 'snapshot':          // Manual snapshot created
        case 'auto-snapshot':     // Auto-save snapshot created
        case 'restored':          // Project restored to previous state
        case 'busy':              // Operation in progress (data = true/false)
        case 'project-closed':    // Premiere Pro project was closed
        case 'project-switched':  // Different project opened
        case 'version-created':   // New version created
        case 'version-switched':  // Switched to different version
        case 'version-deleted':   // Version was deleted
        case 'labels-changed':    // Labels were modified
        case 'settings-changed':  // Settings were updated
    }
});
```

### GitHub Integration

```js
rewind.github.authenticate('ghp_...')   // Connect with personal access token
rewind.github.isAuthenticated()         // Check connection status
rewind.github.getUser()                 // Get user info
rewind.github.logout()                  // Disconnect
rewind.github.push()                    // Push to GitHub
rewind.github.pull()                    // Pull from GitHub
rewind.github.sync()                    // Pull then push
rewind.github.setupRemote('MyProject')  // Create/connect GitHub repo
```

### UI Widget

```js
// Mount the built-in UI into a container
RewindSDK.mountUI('#my-panel');

// Or mount with config (initializes SDK automatically)
RewindSDK.mountUI('#my-panel', { autoSaveInterval: 120 });

// Unmount
RewindSDK.unmountUI();
```

### Advanced: Direct Module Access

```js
var rewind = RewindSDK.init();
var git = rewind.modules.GitManager;
var github = rewind.modules.GitHubManager;
var diff = rewind.modules.DiffEngine;
var prproj = rewind.modules.PrprojHandler;
var bridge = rewind.modules.Bridge;
var vc = rewind.modules.VersionController;
```

## Host Script Integration

### Option 1: Standalone (no existing host.jsx)

In your `manifest.xml`:
```xml
<ScriptPath>./rewind-sdk/host/rewind-host.jsx</ScriptPath>
```

### Option 2: Alongside existing host.jsx

In your `host.jsx`:
```jsx
// Note: #include paths are relative to the INCLUDING file, not the project root
#include "rewind-sdk/host/rewind-host.jsx"

// Your own ExtendScript code below...
```

### Option 3: Existing `handleMessage` (no conflict)

If your extension already defines a global `handleMessage` function, just `#include` the
Rewind host script. The SDK bridge defaults to the namespaced `RewindHost_handleMessage`,
so there is no collision and no routing code needed:

```jsx
#include "rewind-sdk/host/rewind-host.jsx"

// Your own handleMessage is untouched — Rewind uses RewindHost_handleMessage
function handleMessage(type, dataStr) {
    // Your own commands...
}
```

## Examples

See the `examples/` directory:

- **`minimal/`** — Drop-in UI with just 3 lines of code
- **`headless/`** — Programmatic API with custom UI

## Building from Source

To create single-file bundles:

```bash
node sdk/build.js
```

This generates:
- `sdk/dist/rewind.js` — Core SDK only
- `sdk/dist/rewind-with-ui.js` — Core + UI widget
- `sdk/dist/rewind-ui.css` — Scoped UI styles
- `sdk/dist/rewind-host.jsx` — ExtendScript backend

## Requirements

Before integrating, ensure your extension meets these requirements:

### Manifest Requirements

Your `manifest.xml` must include these CEFCommandLine parameters:

```xml
<CEFCommandLine>
    <Parameter>--enable-nodejs</Parameter>
    <Parameter>--mixed-context</Parameter>
</CEFCommandLine>
```

Without these, the SDK will not load. You will see: "Rewind SDK requires Adobe CEP with Node.js enabled."

### Prerequisites

- **Git** installed and available in PATH ([download](https://git-scm.com/))
- **Adobe Premiere Pro 2022** or later
- **CSInterface.js** loaded before `rewind.js` (include it via a `<script>` tag)
- **CEP debug mode** enabled (`PlayerDebugMode` set to `1`)

### Content Security Policy

If your extension sets a Content-Security-Policy, add these for GitHub integration:

```
default-src 'self' 'unsafe-inline' https://api.github.com;
img-src 'self' data: https://*.githubusercontent.com;
```

## Error Handling

All async methods return Promises. Always add `.catch()`:

```js
rewind.start().catch(function(err) {
    console.error('Failed to start:', err.message);
    // Common causes:
    // - "Git not found" → install Git
    // - "No project is currently open" → open a project first  
    // - "ExtendScript call failed" → check ScriptPath in manifest.xml
});

rewind.snapshot('My save').catch(function(err) {
    console.error('Snapshot failed:', err.message);
});
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "cep_node is not defined" or silent crash | Missing Node.js flags | Add `--enable-nodejs` and `--mixed-context` to manifest |
| "CSInterface is not defined" | Script load order | Load CSInterface.js before rewind.js |
| "ExtendScript call failed" | Missing host script | Set ScriptPath to rewind-host.jsx in manifest |
| "Git not found" | Git not installed | Install Git, ensure it is in PATH |
| UI mounts but no styles | CSS not loaded | Include rewind-ui.css via `<link>` tag |

## License

MIT
