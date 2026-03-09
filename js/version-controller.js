// version-controller.js - Main orchestration for version control

(function() {
    'use strict';

    var fs = cep_node.require('fs');
    var path = cep_node.require('path');

    var VC_DIR_NAME = '.ppgit';
    var XML_FILENAME = 'project.xml';
    var SETTINGS_FILENAME = 'settings.json';
    var POLL_INTERVAL = 5000;       // 5s project-switch detection poll

    var state = {
        projectPath: null,          // Current .prproj path
        projectDir: null,           // Directory containing .prproj
        vcDir: null,                // .ppgit directory path
        repoPath: null,             // Same as vcDir (git repo root)
        xmlPath: null,              // Path to project.xml inside repo
        initialized: false,
        pollTimer: null,            // Project-switch detection
        dirtyTimer: null,           // Dirty-check auto-save timer
        operationInProgress: false,
        settings: {
            autoSaveIntervalSeconds: 60, // How often to check dirty + save (0 = off)
            autoPush: false              // Auto-push to GitHub after each snapshot
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
     * Load settings from .ppgit/settings.json
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
     * Save settings to .ppgit/settings.json
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
        // Restart dirty-poll with new settings
        setupDirtyPoll();
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

            state.projectPath = path.normalize(projectPath);
            state.projectDir = path.dirname(state.projectPath);
            state.vcDir = path.join(state.projectDir, VC_DIR_NAME);
            state.repoPath = state.vcDir;
            state.xmlPath = path.join(state.vcDir, XML_FILENAME);

            // Create .ppgit directory
            if (!fs.existsSync(state.vcDir)) {
                fs.mkdirSync(state.vcDir, { recursive: true });
            }

            loadSettings();

            // Initialize git repo
            return GitManager.init(state.repoPath);
        }).then(function() {
            return GitManager.commitCount(state.repoPath);
        }).then(function(count) {
            if (count > 0) {
                return null; // Already initialized, skip initial snapshot
            }
            return doSnapshot('Initial snapshot');
        }).then(function() {
            state.initialized = true;
            setupDirtyPoll();
            startProjectPoll();
            emit('initialized', { projectPath: state.projectPath });
            return state;
        });
    }

    /**
     * Core snapshot logic (no save trigger — caller decides)
     */
    function doSnapshot(message) {
        if (state.operationInProgress) {
            return Promise.resolve(null);
        }
        state.operationInProgress = true;
        return PrprojHandler.decompress(state.projectPath).then(function(xml) {
            return fs.promises.writeFile(state.xmlPath, xml, 'utf8');
        }).then(function() {
            return GitManager.hasChanges(state.repoPath);
        }).then(function(changed) {
            if (!changed) {
                state.operationInProgress = false;
                return null; // Nothing to commit
            }
            return GitManager.commit(state.repoPath, message || 'Snapshot').then(function() {
                return pruneIfNeeded();
            }).then(function() {
                state.operationInProgress = false;
                emit('snapshot', { message: message });
                // Auto-push to GitHub if enabled
                if (state.settings.autoPush && window.GitHubManager && GitHubManager.isAuthenticated()) {
                    GitHubManager.push(state.repoPath).catch(function(err) {
                        console.warn('ppgit: auto-push failed:', err.message);
                    });
                }
                return true;
            });
        }).catch(function(err) {
            state.operationInProgress = false;
            throw err;
        });
    }

    /**
     * Take a snapshot (silently saves project first to capture current state)
     */
    function snapshot(message) {
        if (state.operationInProgress) {
            return Promise.resolve(null);
        }
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
     * Restore a previous snapshot.
     *
     * Order of operations:
     *  1. Lock operationInProgress for the entire restore (blocks dirty poll)
     *  2. Save + snapshot current state (manually, bypassing the lock)
     *  3. git checkout old version → project.xml is now the old XML
     *  4. Close the project in PPro (no file-changed dialog yet)
     *  5. Write old XML → .prproj while project is closed (safe, no dialog)
     *  6. Commit "Restored to..." so git stays on the branch
     *  7. Open the project from disk (gets the restored version)
     */
    function restore(commitHash) {
        if (state.operationInProgress) {
            return Promise.resolve(null);
        }
        state.operationInProgress = true;
        emit('busy', true);

        var restoredXml;

        // Step 1-2: Save + manually snapshot current state
        return Bridge.callHost('saveProject').then(function() {
            return new Promise(function(r) { setTimeout(r, 500); });
        }).then(function() {
            return PrprojHandler.decompress(state.projectPath);
        }).then(function(xml) {
            return fs.promises.writeFile(state.xmlPath, xml, 'utf8').then(function() {
                return GitManager.hasChanges(state.repoPath);
            });
        }).then(function(changed) {
            if (changed) {
                return GitManager.commit(state.repoPath, 'Auto-save before restore');
            }
        // Step 3: Restore old files from git
        }).then(function() {
            return GitManager.checkout(state.repoPath, commitHash);
        // Step 4: Read the restored XML
        }).then(function() {
            restoredXml = fs.readFileSync(state.xmlPath, 'utf8');
        // Step 5: Close the project BEFORE writing to disk (prevents "file changed" dialog)
        }).then(function() {
            return Bridge.callHost('closeProject');
        // Step 6: Write restored .prproj to disk while project is closed
        }).then(function() {
            return PrprojHandler.compress(restoredXml, state.projectPath);
        // Step 7: Commit restored state so HEAD stays on branch
        }).then(function() {
            return GitManager.commit(state.repoPath, 'Restored to ' + commitHash.substring(0, 7));
        // Step 8: Open the project — now reads the restored file from disk
        }).then(function() {
            return Bridge.callHost('openProject', { path: state.projectPath });
        }).then(function() {
            state.operationInProgress = false;
            emit('restored', { hash: commitHash });
            emit('busy', false);
        }).catch(function(err) {
            state.operationInProgress = false;
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
     * Dirty-check poll: every N seconds ask PPro if the project has unsaved
     * changes. If yes, we save it ourselves and take a snapshot.
     * This is the core auto-save mechanism — no file watcher needed.
     */
    function setupDirtyPoll() {
        if (state.dirtyTimer) {
            clearInterval(state.dirtyTimer);
            state.dirtyTimer = null;
        }
        var seconds = state.settings.autoSaveIntervalSeconds;
        if (!seconds || seconds <= 0 || !state.projectPath) return;

        state.dirtyTimer = setInterval(function() {
            if (!state.initialized || state.operationInProgress) return;

            // Save unconditionally — PPro's dirty flag is unreliable.
            // doSnapshot() checks the actual XML diff before committing,
            // so no git commit is made if nothing really changed.
            Bridge.callHost('saveProject').then(function() {
                return new Promise(function(r) { setTimeout(r, 500); });
            }).then(function() {
                return doSnapshot('Auto-snapshot');
            }).then(function(committed) {
                if (committed) emit('auto-snapshot', {});
            }).catch(function(err) {
                console.error('ppgit: auto-save failed:', err.message);
            });
        }, seconds * 1000);
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
                currentPath = path.normalize(currentPath);
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
     * Clean up timers
     */
    function cleanup() {
        if (state.dirtyTimer) { clearInterval(state.dirtyTimer); state.dirtyTimer = null; }
        if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
        state.initialized = false;
    }

    /**
     * Destroy everything (panel closing)
     */
    function destroy() {
        cleanup();
        listeners.length = 0;
    }

    /**
     * Check if a project has an existing .ppgit directory
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
        getState: function() { return { initialized: state.initialized, projectPath: state.projectPath }; },
        getRepoPath: function() { return state.repoPath; },
        isTracked: isTracked,
        on: on,
        destroy: destroy
    };
})();
