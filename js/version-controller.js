// version-controller.js - Main orchestration for Rewind version control

(function() {
    'use strict';

    var fs = cep_node.require('fs');
    var path = cep_node.require('path');

    var VC_DIR_NAME = '.rewind';
    var OLD_VC_DIR_NAME = '.ppgit';
    var XML_FILENAME = 'project.xml';
    var SETTINGS_FILENAME = 'settings.json';
    var BRANCHES_FILENAME = 'branches.json';
    var LABELS_FILENAME = 'labels.json';
    var POLL_INTERVAL = 5000;       // 5s project-switch detection poll
    var FILE_RELEASE_POLL_MS = 200; // Poll interval when waiting for file release
    var FILE_RELEASE_TIMEOUT_MS = 5000; // Max wait for file release

    var state = {
        projectPath: null,          // Current .prproj path
        projectDir: null,           // Directory containing .prproj
        vcDir: null,                // .rewind directory path
        repoPath: null,             // Same as vcDir (git repo root)
        xmlPath: null,              // Path to project.xml inside repo
        initialized: false,
        pollTimer: null,            // Project-switch detection
        dirtyTimer: null,           // Dirty-check auto-save timer
        operationInProgress: false,
        currentBranch: 'master',    // Git branch name
        branches: {},               // gitBranch -> { displayName, createdAt }
        labels: {},                 // commitHash -> label string
        lastSavedAt: null,          // Timestamp of last snapshot
        settings: {
            autoSaveIntervalSeconds: 60,
            autoPush: false
        }
    };

    var listeners = [];

    /**
     * Wait for a file to be writable (not locked by another process).
     * Polls by attempting to open the file for writing.
     */
    function waitForFileRelease(filePath) {
        var start = Date.now();
        return new Promise(function(resolve, reject) {
            function check() {
                fs.open(filePath, 'r+', function(err, fd) {
                    if (!err && fd !== undefined) {
                        fs.close(fd, function() { resolve(); });
                    } else if (Date.now() - start > FILE_RELEASE_TIMEOUT_MS) {
                        console.warn('rewind: file release timeout, proceeding anyway');
                        resolve();
                    } else {
                        setTimeout(check, FILE_RELEASE_POLL_MS);
                    }
                });
            }
            // If file doesn't exist yet, no lock to wait for
            if (!fs.existsSync(filePath)) { resolve(); return; }
            check();
        });
    }

    function emit(event, data) {
        listeners.forEach(function(fn) { fn(event, data); });
    }

    function on(fn) {
        listeners.push(fn);
    }

    // --- Gitignore (keep metadata files out of version history) ---

    function ensureGitignore() {
        try {
            var giPath = path.join(state.vcDir, '.gitignore');
            var content = 'settings.json\nbranches.json\nlabels.json\n';
            if (!fs.existsSync(giPath)) {
                fs.writeFileSync(giPath, content);
                console.log('rewind: created .gitignore for metadata files');
            }
        } catch (e) {
            console.warn('rewind: failed to create .gitignore:', e.message);
        }
    }

    // --- Migration ---

    function migrateFromPpgit() {
        if (!state.projectDir) return;
        var oldDir = path.join(state.projectDir, OLD_VC_DIR_NAME);
        var newDir = path.join(state.projectDir, VC_DIR_NAME);
        try {
            if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
                fs.renameSync(oldDir, newDir);
                console.info('rewind: migrated .ppgit -> .rewind');
            }
        } catch (e) {
            console.warn('rewind: migration failed, will create new:', e.message);
        }
    }

    // --- Settings ---

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
                console.log('rewind: settings loaded', state.settings);
            }
        } catch (e) {
            console.warn('rewind: failed to load settings:', e.message);
        }
    }

    function saveSettings(newSettings) {
        Object.keys(newSettings).forEach(function(k) {
            if (state.settings.hasOwnProperty(k)) {
                state.settings[k] = newSettings[k];
            }
        });
        try {
            var settingsPath = path.join(state.vcDir, SETTINGS_FILENAME);
            fs.writeFileSync(settingsPath, JSON.stringify(state.settings, null, 2));
            console.log('rewind: settings saved', state.settings);
        } catch (e) {
            console.error('rewind: failed to save settings:', e.message);
        }
        setupDirtyPoll();
        emit('settings-changed', state.settings);
    }

    // --- Branches (Versions) ---

    function loadBranches() {
        try {
            var fp = path.join(state.vcDir, BRANCHES_FILENAME);
            if (fs.existsSync(fp)) {
                state.branches = JSON.parse(fs.readFileSync(fp, 'utf8'));
                console.log('rewind: loaded branches', Object.keys(state.branches));
            } else {
                state.branches = { master: { displayName: 'Main Edit', createdAt: new Date().toISOString() } };
                saveBranches();
            }
        } catch (e) {
            console.warn('rewind: failed to load branches:', e.message);
            state.branches = { master: { displayName: 'Main Edit', createdAt: new Date().toISOString() } };
        }
    }

    function saveBranches() {
        try {
            var fp = path.join(state.vcDir, BRANCHES_FILENAME);
            fs.writeFileSync(fp, JSON.stringify(state.branches, null, 2));
        } catch (e) {
            console.error('rewind: failed to save branches:', e.message);
        }
    }

    // --- Labels ---

    function loadLabels() {
        try {
            var fp = path.join(state.vcDir, LABELS_FILENAME);
            if (fs.existsSync(fp)) {
                state.labels = JSON.parse(fs.readFileSync(fp, 'utf8'));
                console.log('rewind: loaded', Object.keys(state.labels).length, 'labels');
            } else {
                state.labels = {};
            }
        } catch (e) {
            state.labels = {};
        }
    }

    function saveLabels() {
        try {
            var fp = path.join(state.vcDir, LABELS_FILENAME);
            fs.writeFileSync(fp, JSON.stringify(state.labels, null, 2));
        } catch (e) {
            console.error('rewind: failed to save labels:', e.message);
        }
    }

    function addLabel(commitHash, label) {
        if (!label || !label.trim()) {
            delete state.labels[commitHash];
            console.log('rewind: removed label for', commitHash.substring(0, 7));
        } else {
            state.labels[commitHash] = label.trim();
            console.log('rewind: label set for', commitHash.substring(0, 7), '=', label.trim());
        }
        saveLabels();
        emit('labels-changed', state.labels);
    }

    function getLabels() {
        return Object.assign({}, state.labels);
    }

    // --- Initialize ---

    function initialize() {
        console.log('rewind: initializing...');
        return Bridge.callHost('getProjectPath').then(function(projectPath) {
            if (!projectPath) {
                throw new Error('No project is currently open');
            }

            state.projectPath = path.normalize(projectPath);
            state.projectDir = path.dirname(state.projectPath);
            console.log('rewind: project path =', state.projectPath);

            // Migrate from .ppgit if needed
            migrateFromPpgit();

            state.vcDir = path.join(state.projectDir, VC_DIR_NAME);
            state.repoPath = state.vcDir;
            state.xmlPath = path.join(state.vcDir, XML_FILENAME);

            // Create .rewind directory
            if (!fs.existsSync(state.vcDir)) {
                fs.mkdirSync(state.vcDir, { recursive: true });
                console.log('rewind: created', state.vcDir);
            }

            // Ensure .gitignore exists so metadata files aren't tracked
            ensureGitignore();

            loadSettings();
            loadBranches();
            loadLabels();

            // Initialize git repo
            console.log('rewind: initializing git repo...');
            return GitManager.init(state.repoPath);
        }).then(function() {
            // Detect current branch
            return GitManager.getCurrentBranch(state.repoPath);
        }).then(function(branch) {
            state.currentBranch = branch;
            console.log('rewind: on branch', branch, '(' + getVersionDisplayName(branch) + ')');
            // Ensure branch has a display name
            if (!state.branches[branch]) {
                state.branches[branch] = {
                    displayName: branch === 'master' ? 'Main Edit' : branch,
                    createdAt: new Date().toISOString()
                };
                saveBranches();
            }
            return GitManager.commitCount(state.repoPath);
        }).then(function(count) {
            console.log('rewind: existing snapshots:', count);
            if (count > 0) {
                return null;
            }
            console.log('rewind: taking initial snapshot...');
            return doSnapshot('Initial snapshot');
        }).then(function() {
            state.initialized = true;
            setupDirtyPoll();
            startProjectPoll();
            console.log('rewind: initialized successfully');
            emit('initialized', {
                projectPath: state.projectPath,
                branch: state.currentBranch,
                version: getVersionDisplayName()
            });
            return state;
        });
    }

    // --- Snapshot ---

    function doSnapshot(message) {
        if (state.operationInProgress) {
            console.log('rewind: snapshot skipped (operation in progress)');
            return Promise.resolve(null);
        }
        state.operationInProgress = true;
        console.log('rewind: snapshot starting -', message || 'Snapshot');
        return PrprojHandler.decompress(state.projectPath).then(function(xml) {
            console.log('rewind: decompressed prproj (' + Math.round(xml.length / 1024) + 'KB XML)');
            return fs.promises.writeFile(state.xmlPath, xml, 'utf8');
        }).then(function() {
            return GitManager.hasChanges(state.repoPath);
        }).then(function(changed) {
            if (!changed) {
                state.operationInProgress = false;
                console.log('rewind: no changes detected, skipping commit');
                return null;
            }
            console.log('rewind: changes detected, committing...');
            return GitManager.commit(state.repoPath, message || 'Snapshot').then(function() {
                state.lastSavedAt = new Date();
                state.operationInProgress = false;
                console.log('rewind: committed -', message || 'Snapshot');
                emit('snapshot', { message: message });
                // Auto-push to GitHub if enabled
                if (state.settings.autoPush && window.GitHubManager && GitHubManager.isAuthenticated()) {
                    console.log('rewind: auto-pushing to GitHub...');
                    GitHubManager.push(state.repoPath).then(function() {
                        console.log('rewind: auto-push complete');
                    }).catch(function(err) {
                        console.warn('rewind: auto-push failed:', err.message);
                    });
                }
                return true;
            });
        }).catch(function(err) {
            state.operationInProgress = false;
            console.error('rewind: snapshot failed:', err.message);
            throw err;
        });
    }

    function snapshot(message) {
        if (state.operationInProgress) {
            console.log('rewind: manual snapshot skipped (operation in progress)');
            return Promise.resolve(null);
        }
        emit('busy', true);
        console.log('rewind: saving project before snapshot...');
        return Bridge.callHost('saveProject').then(function() {
            console.log('rewind: project saved, waiting 500ms...');
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

    // --- Restore ---
    //
    // Critical order: CLOSE project first, THEN write .prproj, THEN reopen.
    // Writing the .prproj while PPro has it open causes a "file changed
    // externally" dialog that deadlocks with ExtendScript and freezes PPro.
    // operationInProgress prevents the project poll from triggering cleanup
    // during the close->open gap.

    function restore(commitHash) {
        if (state.operationInProgress) {
            return Promise.resolve(null);
        }
        state.operationInProgress = true;
        emit('busy', true);
        console.log('rewind: restoring to', commitHash.substring(0, 7), '...');

        var restoredXml;
        var savedProjectPath = state.projectPath;

        // 1. Save + snapshot current state
        return Bridge.callHost('saveProject').then(function() {
            return new Promise(function(r) { setTimeout(r, 500); });
        }).then(function() {
            console.log('rewind: decompressing current state...');
            return PrprojHandler.decompress(state.projectPath);
        }).then(function(xml) {
            return fs.promises.writeFile(state.xmlPath, xml, 'utf8').then(function() {
                return GitManager.hasChanges(state.repoPath);
            });
        }).then(function(changed) {
            if (changed) {
                console.log('rewind: committing current state before restore...');
                return GitManager.commit(state.repoPath, 'Auto-save before restore');
            }
        // 2. Checkout ONLY project.xml from old commit (not metadata files)
        }).then(function() {
            console.log('rewind: checking out project.xml from', commitHash.substring(0, 7), '...');
            return GitManager.checkout(state.repoPath, commitHash, XML_FILENAME);
        // 3. Read restored XML
        }).then(function() {
            restoredXml = fs.readFileSync(state.xmlPath, 'utf8');
            console.log('rewind: read restored XML (' + Math.round(restoredXml.length / 1024) + 'KB)');
        // 4. Commit restored state so HEAD stays on branch
        }).then(function() {
            console.log('rewind: committing restored state...');
            return GitManager.commit(state.repoPath, 'Restored to ' + commitHash.substring(0, 7));
        // 5. CLOSE project FIRST (before writing .prproj to avoid freeze)
        }).then(function() {
            console.log('rewind: closing project...');
            return Bridge.callHost('closeProject');
        // 6. Wait for PPro to fully release the file
        }).then(function() {
            console.log('rewind: project closed, waiting for file release...');
            return waitForFileRelease(savedProjectPath);
        // 7. NOW write restored .prproj (project is closed, no file lock)
        }).then(function() {
            console.log('rewind: writing restored .prproj (' + Math.round(restoredXml.length / 1024) + 'KB XML -> gzip)...');
            return PrprojHandler.compress(restoredXml, state.projectPath);
        // 8. Verify the file was written
        }).then(function() {
            var stat = fs.statSync(state.projectPath);
            console.log('rewind: .prproj written (' + Math.round(stat.size / 1024) + 'KB on disk)');
        // 9. Reopen the project
        }).then(function() {
            console.log('rewind: reopening project:', savedProjectPath);
            return Bridge.callHost('openProject', { path: savedProjectPath });
        }).then(function() {
            console.log('rewind: project reopened, restarting tracking...');
            state.initialized = true;
            state.operationInProgress = false;
            state.lastSavedAt = new Date();
            setupDirtyPoll();
            console.log('rewind: restore complete!');
            emit('restored', { hash: commitHash });
            emit('busy', false);
        }).catch(function(err) {
            state.operationInProgress = false;
            emit('busy', false);
            console.error('rewind: RESTORE FAILED at step:', err.message);
            console.error('rewind: project path was:', savedProjectPath);
            throw err;
        });
    }

    // --- Branching (Versions) ---

    /**
     * Internal snapshot that doesn't check operationInProgress
     */
    function doSnapshotUnsafe(message) {
        return PrprojHandler.decompress(state.projectPath).then(function(xml) {
            return fs.promises.writeFile(state.xmlPath, xml, 'utf8');
        }).then(function() {
            return GitManager.hasChanges(state.repoPath);
        }).then(function(changed) {
            if (!changed) return null;
            return GitManager.commit(state.repoPath, message || 'Snapshot').then(function() {
                state.lastSavedAt = new Date();
                return true;
            });
        });
    }

    /**
     * Create a new version (branch) from current state
     */
    function createVersion(displayName) {
        if (state.operationInProgress) {
            return Promise.reject(new Error('Operation in progress'));
        }
        state.operationInProgress = true;
        emit('busy', true);
        console.log('rewind: creating version "' + displayName + '"...');

        // Sanitize branch name for git
        var gitBranch = displayName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 50);
        if (!gitBranch) gitBranch = 'version-' + Date.now();

        // Ensure unique
        var baseName = gitBranch;
        var counter = 2;
        while (state.branches[gitBranch]) {
            gitBranch = baseName + '-' + counter;
            counter++;
        }

        // Save current state first
        return Bridge.callHost('saveProject').then(function() {
            return new Promise(function(r) { setTimeout(r, 500); });
        }).then(function() {
            return doSnapshotUnsafe('Snapshot before creating "' + displayName + '"');
        }).then(function() {
            console.log('rewind: creating git branch', gitBranch);
            return GitManager.createBranch(state.repoPath, gitBranch);
        }).then(function() {
            state.currentBranch = gitBranch;
            state.branches[gitBranch] = {
                displayName: displayName,
                createdAt: new Date().toISOString()
            };
            saveBranches();
            state.operationInProgress = false;
            console.log('rewind: version "' + displayName + '" created (branch: ' + gitBranch + ')');
            emit('version-created', { branch: gitBranch, displayName: displayName });
            emit('busy', false);
            return { branch: gitBranch, displayName: displayName };
        }).catch(function(err) {
            state.operationInProgress = false;
            emit('busy', false);
            console.error('rewind: create version failed:', err.message);
            throw err;
        });
    }

    /**
     * Switch to a different version (branch)
     */
    function switchVersion(gitBranch) {
        if (state.operationInProgress) {
            return Promise.reject(new Error('Operation in progress'));
        }
        if (gitBranch === state.currentBranch) {
            return Promise.resolve(null);
        }
        state.operationInProgress = true;
        emit('busy', true);

        var targetName = state.branches[gitBranch] ? state.branches[gitBranch].displayName : gitBranch;
        console.log('rewind: switching to version "' + targetName + '" (branch: ' + gitBranch + ')...');

        var savedProjectPath = state.projectPath;
        var switchXml;

        // 1. Save current state
        return Bridge.callHost('saveProject').then(function() {
            return new Promise(function(r) { setTimeout(r, 500); });
        }).then(function() {
            console.log('rewind: saving current state...');
            return doSnapshotUnsafe('Auto-save before switching to "' + targetName + '"');
        // 2. Stage project.xml before switching branch so git doesn't complain
        }).then(function() {
            console.log('rewind: switching git branch to', gitBranch, '...');
            return GitManager.switchBranch(state.repoPath, gitBranch).catch(function(err) {
                // If switch fails due to uncommitted changes, force it
                console.warn('rewind: branch switch issue:', err.message);
                return GitManager.switchBranch(state.repoPath, gitBranch);
            });
        // 3. Read restored XML
        }).then(function() {
            console.log('rewind: reading XML from new branch...');
            return fs.promises.readFile(state.xmlPath, 'utf8');
        // 4. Close project FIRST (before writing .prproj to avoid freeze)
        }).then(function(xml) {
            switchXml = xml;
            console.log('rewind: closing project...');
            return Bridge.callHost('closeProject');
        // 5. Wait for PPro to release the file
        }).then(function() {
            return waitForFileRelease(savedProjectPath);
        // 6. Write .prproj (project is now closed, no file lock)
        }).then(function() {
            console.log('rewind: compressing to .prproj...');
            return PrprojHandler.compress(switchXml, state.projectPath);
        // 7. Reopen the project
        }).then(function() {
            console.log('rewind: reopening project...');
            return Bridge.callHost('openProject', { path: savedProjectPath });
        }).then(function() {
            state.currentBranch = gitBranch;
            state.initialized = true;
            state.operationInProgress = false;
            state.lastSavedAt = new Date();
            setupDirtyPoll();
            console.log('rewind: switched to version "' + targetName + '"');
            emit('version-switched', {
                branch: gitBranch,
                displayName: getVersionDisplayName()
            });
            emit('busy', false);
        }).catch(function(err) {
            state.operationInProgress = false;
            emit('busy', false);
            console.error('rewind: switch version failed:', err.message);
            throw err;
        });
    }

    function listVersions() {
        return GitManager.listBranches(state.repoPath).then(function(gitBranches) {
            return gitBranches.map(function(b) {
                var info = state.branches[b.name] || { displayName: b.name, createdAt: null };
                return {
                    branch: b.name,
                    displayName: info.displayName,
                    createdAt: info.createdAt,
                    current: b.current
                };
            });
        });
    }

    function deleteVersion(gitBranch) {
        if (gitBranch === state.currentBranch) {
            return Promise.reject(new Error('Cannot delete the current version'));
        }
        if (gitBranch === 'master') {
            return Promise.reject(new Error('Cannot delete the main version'));
        }
        console.log('rewind: deleting version (branch: ' + gitBranch + ')...');
        return GitManager.deleteBranch(state.repoPath, gitBranch).then(function() {
            delete state.branches[gitBranch];
            saveBranches();
            console.log('rewind: version deleted');
            emit('version-deleted', { branch: gitBranch });
        });
    }

    function getVersionDisplayName(branch) {
        var b = branch || state.currentBranch;
        if (state.branches[b]) return state.branches[b].displayName;
        return b === 'master' ? 'Main Edit' : b;
    }

    function getCurrentVersion() {
        return {
            branch: state.currentBranch,
            displayName: getVersionDisplayName()
        };
    }

    // --- Diffs ---

    function getDiff(hashA, hashB) {
        if (!window.DiffEngine) {
            console.warn('rewind: DiffEngine not available');
            return Promise.resolve({ totalChanges: 0, summary: 'Diff engine not available' });
        }
        console.log('rewind: comparing', hashA.substring(0, 7), 'vs', hashB.substring(0, 7), '...');
        var xmlA, xmlB;
        return GitManager.showFile(state.repoPath, hashA, XML_FILENAME).then(function(xml) {
            xmlA = xml;
            console.log('rewind: got XML for', hashA.substring(0, 7), xml ? '(' + Math.round(xml.length / 1024) + 'KB)' : '(null)');
            return GitManager.showFile(state.repoPath, hashB, XML_FILENAME);
        }).then(function(xml) {
            xmlB = xml;
            console.log('rewind: got XML for', hashB.substring(0, 7), xml ? '(' + Math.round(xml.length / 1024) + 'KB)' : '(null)');
            if (!xmlA || !xmlB) {
                return { totalChanges: 0, summary: 'Cannot compare versions' };
            }
            var result = DiffEngine.compare(xmlA, xmlB);
            console.log('rewind: diff result -', result.totalChanges, 'changes,', result.sequences.length, 'sequences affected');
            return result;
        }).catch(function(err) {
            console.error('rewind: diff failed:', err.message);
            return { totalChanges: 0, summary: 'Diff failed: ' + err.message };
        });
    }

    // --- History ---

    function getHistory(count) {
        if (!state.initialized || !state.repoPath) {
            return Promise.resolve([]);
        }
        return GitManager.log(state.repoPath, count || 50);
    }

    // --- Auto-save ---

    function setupDirtyPoll() {
        if (state.dirtyTimer) {
            clearInterval(state.dirtyTimer);
            state.dirtyTimer = null;
        }
        var seconds = state.settings.autoSaveIntervalSeconds;
        if (!seconds || seconds <= 0 || !state.projectPath) {
            console.log('rewind: auto-save disabled');
            return;
        }

        console.log('rewind: auto-save every', seconds, 'seconds');
        state.dirtyTimer = setInterval(function() {
            if (!state.initialized || state.operationInProgress) return;

            Bridge.callHost('saveProject').then(function() {
                return new Promise(function(r) { setTimeout(r, 500); });
            }).then(function() {
                return doSnapshot('Auto-snapshot');
            }).then(function(committed) {
                if (committed) {
                    console.log('rewind: auto-snapshot committed');
                    emit('auto-snapshot', {});
                }
            }).catch(function(err) {
                console.error('rewind: auto-save failed:', err.message);
            });
        }, seconds * 1000);
    }

    // --- Project Poll ---

    function startProjectPoll() {
        if (state.pollTimer) clearInterval(state.pollTimer);
        console.log('rewind: project poll started (every', POLL_INTERVAL / 1000 + 's)');

        state.pollTimer = setInterval(function() {
            if (state.operationInProgress) return;

            Bridge.callHost('getProjectPath').then(function(currentPath) {
                if (!currentPath) {
                    if (state.initialized) {
                        console.log('rewind: project closed');
                        cleanup();
                        emit('project-closed', {});
                    }
                    return;
                }
                currentPath = path.normalize(currentPath);
                if (state.projectPath && currentPath !== state.projectPath) {
                    console.log('rewind: project switched to', currentPath);
                    cleanup();
                    emit('project-switched', { newPath: currentPath });
                    initialize().catch(function(err) {
                        console.error('rewind: re-init for new project failed:', err.message);
                    });
                }
            }).catch(function() {
                // ExtendScript call failed — PPro might be busy
            });
        }, POLL_INTERVAL);
    }

    // --- Cleanup ---

    function cleanup() {
        if (state.dirtyTimer) { clearInterval(state.dirtyTimer); state.dirtyTimer = null; }
        if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
        state.initialized = false;
        console.log('rewind: cleaned up timers');
    }

    function destroy() {
        cleanup();
        listeners.length = 0;
    }

    function isTracked() {
        if (!state.projectPath) return false;
        var dir = path.dirname(state.projectPath);
        return fs.existsSync(path.join(dir, VC_DIR_NAME)) || fs.existsSync(path.join(dir, OLD_VC_DIR_NAME));
    }

    // --- Public API ---

    window.VersionController = {
        initialize: initialize,
        snapshot: snapshot,
        restore: restore,
        getHistory: getHistory,
        saveSettings: saveSettings,
        getSettings: function() { return Object.assign({}, state.settings); },
        getState: function() {
            return {
                initialized: state.initialized,
                projectPath: state.projectPath,
                currentBranch: state.currentBranch,
                currentVersion: getVersionDisplayName(),
                lastSavedAt: state.lastSavedAt
            };
        },
        getRepoPath: function() { return state.repoPath; },
        isTracked: isTracked,
        on: on,
        destroy: destroy,
        // Branching (Versions)
        createVersion: createVersion,
        switchVersion: switchVersion,
        listVersions: listVersions,
        deleteVersion: deleteVersion,
        getCurrentVersion: getCurrentVersion,
        // Labels
        addLabel: addLabel,
        getLabels: getLabels,
        // Diffs
        getDiff: getDiff
    };
})();
