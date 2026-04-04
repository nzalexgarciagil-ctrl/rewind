#!/usr/bin/env node

// build.js - Concatenate Rewind SDK into single distributable files
// Run: node sdk/build.js
// Outputs:
//   sdk/dist/rewind.js          - Core SDK (no UI)
//   sdk/dist/rewind-with-ui.js  - Core SDK + UI widget
//   sdk/dist/rewind-ui.css      - Scoped UI styles
//   sdk/dist/rewind-host.jsx    - ExtendScript host (copied)

var fs = require('fs');
var path = require('path');

var SDK_DIR = __dirname;
var DIST_DIR = path.join(SDK_DIR, 'dist');

// Ensure dist directory exists
if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
}

// Core modules in dependency order
var CORE_FILES = [
    'core/bridge.js',
    'core/prproj-handler.js',
    'core/git-manager.js',
    'core/github-manager.js',
    'core/diff-engine.js',
    'core/version-controller.js'
];

var ENTRY_FILE = 'rewind.js';
var UI_FILE = 'ui/rewind-ui.js';
var CSS_FILE = 'ui/rewind-ui.css';
var HOST_FILE = 'host/rewind-host.jsx';

function readFile(relativePath) {
    return fs.readFileSync(path.join(SDK_DIR, relativePath), 'utf8');
}

function buildCore() {
    var parts = [];
    parts.push('// Rewind SDK v1.0.0 - Built ' + new Date().toISOString().split('T')[0]);
    parts.push('// https://github.com/nzalexgarciagil-ctrl/premiere-git');
    parts.push('');

    // Inline all core modules
    CORE_FILES.forEach(function(file) {
        parts.push('// --- ' + file + ' ---');
        parts.push(readFile(file));
        parts.push('');
    });

    // Read the entry file and strip the loadModule calls (modules are already inlined)
    var entry = readFile(ENTRY_FILE);

    // Replace the loadModule section with a comment
    entry = entry.replace(
        /\/\/ Load core modules in dependency order[\s\S]*?loadModule\('core\/version-controller\.js'\);/,
        '// Core modules loaded inline above'
    );

    // Remove the loadModule function and sdkRoot/fs/path declarations since they're not needed
    entry = entry.replace(
        /\/\/ Resolve SDK root path[\s\S]*?function loadModule\(relativePath\) \{[\s\S]*?\}/,
        '// Modules are bundled inline - no dynamic loading needed\n' +
        '    var fs = cep_node.require(\'fs\');\n' +
        '    var nodePath = cep_node.require(\'path\');'
    );

    parts.push('// --- SDK Entry Point ---');
    parts.push(entry);

    return parts.join('\n');
}

function buildWithUI() {
    var core = buildCore();
    var ui = readFile(UI_FILE);

    var parts = [];
    parts.push(core);
    parts.push('');
    parts.push('// --- UI Widget ---');
    parts.push(ui);

    return parts.join('\n');
}

// Build!
console.log('Building Rewind SDK...');

// Core only
var coreOutput = buildCore();
fs.writeFileSync(path.join(DIST_DIR, 'rewind.js'), coreOutput);
console.log('  dist/rewind.js (' + Math.round(coreOutput.length / 1024) + 'KB)');

// Core + UI
var fullOutput = buildWithUI();
fs.writeFileSync(path.join(DIST_DIR, 'rewind-with-ui.js'), fullOutput);
console.log('  dist/rewind-with-ui.js (' + Math.round(fullOutput.length / 1024) + 'KB)');

// CSS
var css = readFile(CSS_FILE);
fs.writeFileSync(path.join(DIST_DIR, 'rewind-ui.css'), css);
console.log('  dist/rewind-ui.css (' + Math.round(css.length / 1024) + 'KB)');

// Host
var host = readFile(HOST_FILE);
fs.writeFileSync(path.join(DIST_DIR, 'rewind-host.jsx'), host);
console.log('  dist/rewind-host.jsx (' + Math.round(host.length / 1024) + 'KB)');

console.log('Done!');
