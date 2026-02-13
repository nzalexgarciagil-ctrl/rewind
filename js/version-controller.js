// version-controller.js - Main orchestration for version control

(function() {
    'use strict';

    var fs = cep_node.require('fs');
    var path = cep_node.require('path');

    var VC_DIR_NAME = '.ace-vc';
    var XML_FILENAME = 'project.xml';
    var SETTINGS_FILENAME = 'settings.json';
    var POLL_INTERVAL = 5000;       // 5s project switch poll
    var DEBOUNCE_MS = 3000;         // 3s file watcher debounce

    var state = {
        projectPath: null,          // Current .prproj path
        projectDir: null,           // Directory containing .prproj
        vcDir: null,                // .ace-vc directory path
        repoPath: null,             // Same as vcDir (git repo root)
        xmlPath: null,              // Path to project.xml inside repo
        initialized: false,
        watching: false,
        watcher: null,
        debounceTimer: null,
        debouncing: false,
        pollTimer: null,
        autoTimer: null,
        settings: {
            autoSnapshotOnSave: true,
            autoIntervalMinutes: 0,  // 0 = disabled
            maxSnapshots: 0          // 0 = unlimited
        }
    };

    var listeners = [];

    function emit(event, data) {
        listeners.forEach(function(fn) { fn(event, data); });
    }

    function on(fn) {
        listeners.push(fn);
    }

    /**
     * Load settings from .ace-vc/settings.json
     */
    function loadSettings() {
        try {
            var settingsPath = path.join(state.vcDir, SETTINGS_FILENAME);
            if (fs.existsSync(settingsPath)) {
                var raw = fs.readFileSync(settingsPath, 'utf8');
                var loaded = JSON.parse(raw);
                Object.keys(loaded).forEach(function(k) {
                    if (state.settings.hasOwnProperty(k)) {
                        state.settings[k] = loaded[k];
                    }
                });
            }
        } catch (e) {
            console.warn('Failed to load settings:', e.message);
        }
    }

    /**
     * Save settings to .ace-vc/settings.json
     */
    function saveSettings(newSettings) {
        Object.keys(newSettings).forEach(function(k) {
            if (state.settings.hasOwnProperty(k)) {
                state.settings[k] = newSettings[k];
            }
        });
        try {
            var settingsPath = path.join(state.vcDir, SETTINGS_FILENAME);
            fs.writeFileSync(settingsPath, JSON.stringify(state.settings, null, 2));
        } catch (e) {
            console.error('Failed to save settings:', e.message);
        }
        // Restart watchers with new settings
        setupAutoInterval();
        setupFileWatcher();
        emit('settings-changed', state.settings);
    }

    /**
     * Initialize version control for the current project
     */
    function initialize() {
        return Bridge.callHost('getProjectPath').then(function(projectPath) {
            if (!projectPath) {
                throw new Error('No project is currently open');
            }

            state.projectPath = projectPath.replace(/\//g, '\\');
            state.projectDir = path.dirname(state.projectPath);
            state.vcDir = path.join(state.projectDir, VC_DIR_NAME);
            state.repoPath = state.vcDir;
            state.xmlPath = path.join(state.vcDir, XML_FILENAME);

            // Create .ace-vc directory
            if (!fs.existsSync(state.vcDir)) {
                fs.mkdirSync(state.vcDir, { recursive: true });
            }

            // Add .ace-vc to project's .gitignore if there is one (don't interfere with user's git)
            // No — we keep our own isolated git repo inside .ace-vc

            loadSettings();

            // Initialize git repo
            return GitManager.init(state.repoPath);
        }).then(function() {
            // Take initial snapshot
            return doSnapshot('Initial snapshot');
        }).then(function() {
            state.initialized = true;
            setupFileWatcher();
            setupAutoInterval();
            startProjectPoll();
            emit('initialized', { projectPath: state.projectPath });
            return state;
        });
    }

    /**
     * Core snapshot logic (no save trigger — caller decides)
     */
    function doSnapshot(message) {
        return PrprojHandler.decompress(state.projectPath).then(function(xml) {
            fs.writeFileSync(state.xmlPath, xml, 'utf8');
            return GitManager.hasChanges(state.repoPath);
        }).then(function(changed) {
            if (!changed) {
                return null; // Nothing to commit
            }
            return GitManager.commit(state.repoPath, message || 'Snapshot').then(function() {
                return pruneIfNeeded();
            }).then(function() {
                emit('snapshot', { message: message });
                return true;
            });
        });
    }

    /**
     * Take a snapshot (silently saves project first to capture current state)
     */
    function snapshot(message) {
        emit('busy', true);
        return Bridge.callHost('saveProject').then(function() {
            // Small delay to let PPro finish writing the file
            return new Promise(function(r) { setTimeout(r, 500); });
        }).then(function() {
            return doSnapshot(message || 'Manual snapshot');
        }).then(function(committed) {
            emit('busy', false);
            return committed;
        }).catch(function(err) {
            emit('busy', false);
            throw err;
        });
    }

    /**
     * Restore a previous snapshot
     */
    function restore(commitHash) {
        emit('busy', true);
        // Safety snapshot first — silent save then commit
        return Bridge.callHost('saveProject').then(function() {
            return new Promise(function(r) { setTimeout(r, 500); });
        }).then(function() {
            return doSnapshot('Auto-save before restore');
        }).then(function() {
            // Checkout the old commit's files
            return GitManager.checkout(state.repoPath, commitHash);
        }).then(function() {
            // Read the restored XML
            var xml = fs.readFileSync(state.xmlPath, 'utf8');
            // Recompress to .prproj
            return PrprojHandler.compress(xml, state.projectPath);
        }).then(function() {
            // Tell PPro to close and reopen the project
            return Bridge.callHost('closeAndReopenProject', { path: state.projectPath });
        }).then(function() {
            emit('restored', { hash: commitHash });
            emit('busy', false);
            // After restore, go back to latest branch tip so new snapshots continue normally
            return GitManager.getHead(state.repoPath);
        }).catch(function(err) {
            emit('busy', false);
            throw err;
        });
    }

    /**
     * Get commit history
     */
    function getHistory(count) {
        if (!state.initialized || !state.repoPath) {
            return Promise.resolve([]);
        }
        return GitManager.log(state.repoPath, count || 50);
    }

    /**
     * Prune old snapshots if maxSnapshots is set
     */
    function pruneIfNeeded() {
        if (!state.settings.maxSnapshots || state.settings.maxSnapshots <= 0) {
            return Promise.resolve();
        }
        return GitManager.commitCount(state.repoPath).then(function(count) {
            if (count <= state.settings.maxSnapshots) return;
            // Squash oldest commits — for simplicity, we don't prune in v1
            // (git rebase in a non-interactive way is complex)
            // Future: implement shallow clone or orphan branch strategy
            console.log('Snapshot count (' + count + ') exceeds max (' + state.settings.maxSnapshots + '). Pruning not implemented in v1.');
        });
    }

    /**
     * File watcher with debounce for auto-snapshot on save
     */
    function setupFileWatcher() {
        if (state.watcher) {
            state.watcher.close();
            state.watcher = null;
        }
        if (!state.settings.autoSnapshotOnSave || !state.projectPath) return;

        state.watching = true;
        try {
            state.watcher = fs.watch(state.projectPath, function() {
                if (state.debouncing) return;
                state.debouncing = true;
                clearTimeout(state.debounceTimer);
                state.debounceTimer = setTimeout(function() {
                    state.debouncing = false;
                    doSnapshot('Auto-snapshot (file change)').then(function(committed) {
                        if (committed) emit('auto-snapshot', {});
                    }).catch(function(err) {
                        console.error('Auto-snapshot failed:', err.message);
                    });
                }, DEBOUNCE_MS);
            });
        } catch (e) {
            console.error('File watcher setup failed:', e.message);
            state.watching = false;
        }
    }

    /**
     * Interval-based auto-snapshot
     */
    function setupAutoInterval() {
        if (state.autoTimer) {
            clearInterval(state.autoTimer);
            state.autoTimer = null;
        }
        var minutes = state.settings.autoIntervalMinutes;
        if (!minutes || minutes <= 0) return;

        state.autoTimer = setInterval(function() {
            if (!state.initialized) return;
            GitManager.hasChanges(state.repoPath).then(function(changed) {
                if (!changed) {
                    // Decompress and check if prproj changed since last snapshot
                    return PrprojHandler.decompress(state.projectPath).then(function(xml) {
                        var current = '';
                        try { current = fs.readFileSync(state.xmlPath, 'utf8'); } catch(e) {}
                        if (xml !== current) {
                            fs.writeFileSync(state.xmlPath, xml, 'utf8');
                            return GitManager.hasChanges(state.repoPath);
                        }
                        return false;
                    });
                }
                return changed;
            }).then(function(shouldCommit) {
                if (shouldCommit) {
                    return doSnapshot('Auto-snapshot (interval)').then(function() {
                        emit('auto-snapshot', {});
                    });
                }
            }).catch(function(err) {
                console.error('Interval snapshot failed:', err.message);
            });
        }, minutes * 60 * 1000);
    }

    /**
     * Poll for project switches
     */
    function startProjectPoll() {
        if (state.pollTimer) clearInterval(state.pollTimer);

        state.pollTimer = setInterval(function() {
            Bridge.callHost('getProjectPath').then(function(currentPath) {
                if (!currentPath) {
                    if (state.initialized) {
                        cleanup();
                        emit('project-closed', {});
                    }
                    return;
                }
                currentPath = currentPath.replace(/\//g, '\\');
                if (state.projectPath && currentPath !== state.projectPath) {
                    // Project switched
                    cleanup();
                    emit('project-switched', { newPath: currentPath });
                    // Auto-initialize for the new project
                    initialize().catch(function(err) {
                        console.error('Re-init for new project failed:', err.message);
                    });
                }
            }).catch(function() {
                // ExtendScript call failed — PPro might be busy
            });
        }, POLL_INTERVAL);
    }

    /**
     * Clean up watchers and timers
     */
    function cleanup() {
        if (state.watcher) { state.watcher.close(); state.watcher = null; }
        if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; }
        if (state.debounceTimer) { clearTimeout(state.debounceTimer); }
        state.initialized = false;
        state.watching = false;
        state.debouncing = false;
    }

    /**
     * Destroy everything (panel closing)
     */
    function destroy() {
        cleanup();
        if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
        listeners.length = 0;
    }

    /**
     * Check if a project has an existing .ace-vc directory
     */
    function isTracked() {
        if (!state.projectPath) return false;
        var dir = path.dirname(state.projectPath);
        return fs.existsSync(path.join(dir, VC_DIR_NAME));
    }

    window.VersionController = {
        initialize: initialize,
        snapshot: snapshot,
        restore: restore,
        getHistory: getHistory,
        saveSettings: saveSettings,
        getSettings: function() { return Object.assign({}, state.settings); },
        getState: function() { return { initialized: state.initialized, projectPath: state.projectPath, watching: state.watching }; },
        isTracked: isTracked,
        on: on,
        destroy: destroy
    };
})();
