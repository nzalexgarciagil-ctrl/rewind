// sdk/core/version-controller.js - Main orchestration (SDK version)
// Factory: accepts deps object { Bridge, GitManager, GitHubManager, PrprojHandler, DiffEngine }

var RewindVersionController = (function() {
    'use strict';

    var fs = cep_node.require('fs');
    var path = cep_node.require('path');

    function create(deps) {
        var Bridge = deps.Bridge;
        var GitManager = deps.GitManager;
        var GitHubManager = deps.GitHubManager || null;
        var PrprojHandler = deps.PrprojHandler;
        var DiffEngine = deps.DiffEngine || null;

        var VC_DIR_NAME = deps.vcDirName || '.rewind';
        var OLD_VC_DIR_NAME = '.ppgit';
        var XML_FILENAME = 'project.xml';
        var SETTINGS_FILENAME = 'settings.json';
        var BRANCHES_FILENAME = 'branches.json';
        var LABELS_FILENAME = 'labels.json';
        var POLL_INTERVAL = 5000;

        var state = {
            projectPath: null,
            projectDir: null,
            vcDir: null,
            repoPath: null,
            xmlPath: null,
            initialized: false,
            pollTimer: null,
            dirtyTimer: null,
            operationInProgress: false,
            currentBranch: 'master',
            branches: {},
            labels: {},
            lastSavedAt: null,
            settings: {
                autoSaveIntervalSeconds: 60,
                autoPush: false
            }
        };

        var listeners = [];

        function emit(event, data) {
            listeners.forEach(function(fn) { fn(event, data); });
        }

        function on(fn) {
            listeners.push(fn);
        }

        function ensureGitignore() {
            try {
                var giPath = path.join(state.vcDir, '.gitignore');
                var content = 'settings.json\nbranches.json\nlabels.json\n';
                if (!fs.existsSync(giPath)) {
                    fs.writeFileSync(giPath, content);
                }
            } catch (e) {}
        }

        function migrateFromPpgit() {
            if (!state.projectDir) return;
            var oldDir = path.join(state.projectDir, OLD_VC_DIR_NAME);
            var newDir = path.join(state.projectDir, VC_DIR_NAME);
            try {
                if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
                    fs.renameSync(oldDir, newDir);
                }
            } catch (e) {}
        }

        // --- Settings ---
        function loadSettings() {
            try {
                var settingsPath = path.join(state.vcDir, SETTINGS_FILENAME);
                if (fs.existsSync(settingsPath)) {
                    var raw = fs.readFileSync(settingsPath, 'utf8');
                    var loaded = JSON.parse(raw);
                    Object.keys(loaded).forEach(function(k) {
                        if (state.settings.hasOwnProperty(k)) state.settings[k] = loaded[k];
                    });
                }
            } catch (e) {}
        }

        function saveSettings(newSettings) {
            Object.keys(newSettings).forEach(function(k) {
                if (state.settings.hasOwnProperty(k)) state.settings[k] = newSettings[k];
            });
            try {
                var settingsPath = path.join(state.vcDir, SETTINGS_FILENAME);
                fs.writeFileSync(settingsPath, JSON.stringify(state.settings, null, 2));
            } catch (e) {}
            setupDirtyPoll();
            emit('settings-changed', state.settings);
        }

        // --- Branches ---
        function loadBranches() {
            try {
                var fp = path.join(state.vcDir, BRANCHES_FILENAME);
                if (fs.existsSync(fp)) {
                    state.branches = JSON.parse(fs.readFileSync(fp, 'utf8'));
                } else {
                    state.branches = { master: { displayName: 'Main Edit', createdAt: new Date().toISOString() } };
                    saveBranches();
                }
            } catch (e) {
                state.branches = { master: { displayName: 'Main Edit', createdAt: new Date().toISOString() } };
            }
        }

        function saveBranches() {
            try {
                var fp = path.join(state.vcDir, BRANCHES_FILENAME);
                fs.writeFileSync(fp, JSON.stringify(state.branches, null, 2));
            } catch (e) {}
        }

        // --- Labels ---
        function loadLabels() {
            try {
                var fp = path.join(state.vcDir, LABELS_FILENAME);
                if (fs.existsSync(fp)) {
                    state.labels = JSON.parse(fs.readFileSync(fp, 'utf8'));
                } else {
                    state.labels = {};
                }
            } catch (e) { state.labels = {}; }
        }

        function saveLabels() {
            try {
                var fp = path.join(state.vcDir, LABELS_FILENAME);
                fs.writeFileSync(fp, JSON.stringify(state.labels, null, 2));
            } catch (e) {}
        }

        function addLabel(commitHash, label) {
            if (!label || !label.trim()) {
                delete state.labels[commitHash];
            } else {
                state.labels[commitHash] = label.trim();
            }
            saveLabels();
            emit('labels-changed', state.labels);
        }

        function getLabels() {
            return Object.assign({}, state.labels);
        }

        // --- Initialize ---
        function initialize() {
            return Bridge.callHost('getProjectPath').then(function(projectPath) {
                if (!projectPath) throw new Error('No project is currently open');

                state.projectPath = path.normalize(projectPath);
                state.projectDir = path.dirname(state.projectPath);

                migrateFromPpgit();

                state.vcDir = path.join(state.projectDir, VC_DIR_NAME);
                state.repoPath = state.vcDir;
                state.xmlPath = path.join(state.vcDir, XML_FILENAME);

                if (!fs.existsSync(state.vcDir)) {
                    fs.mkdirSync(state.vcDir, { recursive: true });
                }

                ensureGitignore();
                loadSettings();
                loadBranches();
                loadLabels();

                return GitManager.init(state.repoPath);
            }).then(function() {
                return GitManager.getCurrentBranch(state.repoPath);
            }).then(function(branch) {
                state.currentBranch = branch;
                if (!state.branches[branch]) {
                    state.branches[branch] = {
                        displayName: branch === 'master' ? 'Main Edit' : branch,
                        createdAt: new Date().toISOString()
                    };
                    saveBranches();
                }
                return GitManager.commitCount(state.repoPath);
            }).then(function(count) {
                if (count > 0) return null;
                return doSnapshot('Initial snapshot');
            }).then(function() {
                state.initialized = true;
                setupDirtyPoll();
                startProjectPoll();
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
            if (state.operationInProgress) return Promise.resolve(null);
            state.operationInProgress = true;
            return PrprojHandler.decompress(state.projectPath).then(function(xml) {
                return fs.promises.writeFile(state.xmlPath, xml, 'utf8');
            }).then(function() {
                return GitManager.hasChanges(state.repoPath);
            }).then(function(changed) {
                if (!changed) {
                    state.operationInProgress = false;
                    return null;
                }
                return GitManager.commit(state.repoPath, message || 'Snapshot').then(function() {
                    state.lastSavedAt = new Date();
                    state.operationInProgress = false;
                    emit('snapshot', { message: message });
                    if (state.settings.autoPush && GitHubManager && GitHubManager.isAuthenticated()) {
                        GitHubManager.push(state.repoPath).catch(function() {});
                    }
                    return true;
                });
            }).catch(function(err) {
                state.operationInProgress = false;
                throw err;
            });
        }

        function snapshot(message) {
            if (state.operationInProgress) return Promise.resolve(null);
            emit('busy', true);
            return Bridge.callHost('saveProject').then(function() {
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
        function restore(commitHash) {
            if (state.operationInProgress) return Promise.resolve(null);
            state.operationInProgress = true;
            emit('busy', true);

            var restoredXml;
            var savedProjectPath = state.projectPath;

            return Bridge.callHost('saveProject').then(function() {
                return new Promise(function(r) { setTimeout(r, 500); });
            }).then(function() {
                return PrprojHandler.decompress(state.projectPath);
            }).then(function(xml) {
                return fs.promises.writeFile(state.xmlPath, xml, 'utf8').then(function() {
                    return GitManager.hasChanges(state.repoPath);
                });
            }).then(function(changed) {
                if (changed) return GitManager.commit(state.repoPath, 'Auto-save before restore');
            }).then(function() {
                return GitManager.checkout(state.repoPath, commitHash, XML_FILENAME);
            }).then(function() {
                restoredXml = fs.readFileSync(state.xmlPath, 'utf8');
            }).then(function() {
                return GitManager.commit(state.repoPath, 'Restored to ' + commitHash.substring(0, 7));
            }).then(function() {
                return Bridge.callHost('closeProject');
            }).then(function() {
                return new Promise(function(r) { setTimeout(r, 1500); });
            }).then(function() {
                return PrprojHandler.compress(restoredXml, state.projectPath);
            }).then(function() {
                return Bridge.callHost('openProject', { path: savedProjectPath });
            }).then(function() {
                state.initialized = true;
                state.operationInProgress = false;
                state.lastSavedAt = new Date();
                setupDirtyPoll();
                emit('restored', { hash: commitHash });
                emit('busy', false);
            }).catch(function(err) {
                state.operationInProgress = false;
                emit('busy', false);
                throw err;
            });
        }

        // --- Branching ---
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

        function createVersion(displayName) {
            if (state.operationInProgress) return Promise.reject(new Error('Operation in progress'));
            state.operationInProgress = true;
            emit('busy', true);

            var gitBranch = displayName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .substring(0, 50);
            if (!gitBranch) gitBranch = 'version-' + Date.now();

            var baseName = gitBranch;
            var counter = 2;
            while (state.branches[gitBranch]) {
                gitBranch = baseName + '-' + counter;
                counter++;
            }

            return Bridge.callHost('saveProject').then(function() {
                return new Promise(function(r) { setTimeout(r, 500); });
            }).then(function() {
                return doSnapshotUnsafe('Snapshot before creating "' + displayName + '"');
            }).then(function() {
                return GitManager.createBranch(state.repoPath, gitBranch);
            }).then(function() {
                state.currentBranch = gitBranch;
                state.branches[gitBranch] = { displayName: displayName, createdAt: new Date().toISOString() };
                saveBranches();
                state.operationInProgress = false;
                emit('version-created', { branch: gitBranch, displayName: displayName });
                emit('busy', false);
                return { branch: gitBranch, displayName: displayName };
            }).catch(function(err) {
                state.operationInProgress = false;
                emit('busy', false);
                throw err;
            });
        }

        function switchVersion(gitBranch) {
            if (state.operationInProgress) return Promise.reject(new Error('Operation in progress'));
            if (gitBranch === state.currentBranch) return Promise.resolve(null);
            state.operationInProgress = true;
            emit('busy', true);

            var targetName = state.branches[gitBranch] ? state.branches[gitBranch].displayName : gitBranch;
            var savedProjectPath = state.projectPath;
            var switchXml;

            return Bridge.callHost('saveProject').then(function() {
                return new Promise(function(r) { setTimeout(r, 500); });
            }).then(function() {
                return doSnapshotUnsafe('Auto-save before switching to "' + targetName + '"');
            }).then(function() {
                return GitManager.switchBranch(state.repoPath, gitBranch).catch(function() {
                    return GitManager.switchBranch(state.repoPath, gitBranch);
                });
            }).then(function() {
                return fs.promises.readFile(state.xmlPath, 'utf8');
            }).then(function(xml) {
                switchXml = xml;
                return Bridge.callHost('closeProject');
            }).then(function() {
                return new Promise(function(r) { setTimeout(r, 1000); });
            }).then(function() {
                return PrprojHandler.compress(switchXml, state.projectPath);
            }).then(function() {
                return Bridge.callHost('openProject', { path: savedProjectPath });
            }).then(function() {
                state.currentBranch = gitBranch;
                state.initialized = true;
                state.operationInProgress = false;
                state.lastSavedAt = new Date();
                setupDirtyPoll();
                emit('version-switched', { branch: gitBranch, displayName: getVersionDisplayName() });
                emit('busy', false);
            }).catch(function(err) {
                state.operationInProgress = false;
                emit('busy', false);
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
            if (gitBranch === state.currentBranch) return Promise.reject(new Error('Cannot delete the current version'));
            if (gitBranch === 'master') return Promise.reject(new Error('Cannot delete the main version'));
            return GitManager.deleteBranch(state.repoPath, gitBranch).then(function() {
                delete state.branches[gitBranch];
                saveBranches();
                emit('version-deleted', { branch: gitBranch });
            });
        }

        function getVersionDisplayName(branch) {
            var b = branch || state.currentBranch;
            if (state.branches[b]) return state.branches[b].displayName;
            return b === 'master' ? 'Main Edit' : b;
        }

        function getCurrentVersion() {
            return { branch: state.currentBranch, displayName: getVersionDisplayName() };
        }

        // --- Diffs ---
        function getDiff(hashA, hashB) {
            if (!DiffEngine) {
                return Promise.resolve({ totalChanges: 0, summary: 'Diff engine not available' });
            }
            var xmlA, xmlB;
            return GitManager.showFile(state.repoPath, hashA, XML_FILENAME).then(function(xml) {
                xmlA = xml;
                return GitManager.showFile(state.repoPath, hashB, XML_FILENAME);
            }).then(function(xml) {
                xmlB = xml;
                if (!xmlA || !xmlB) return { totalChanges: 0, summary: 'Cannot compare versions' };
                return DiffEngine.compare(xmlA, xmlB);
            }).catch(function(err) {
                return { totalChanges: 0, summary: 'Diff failed: ' + err.message };
            });
        }

        // --- History ---
        function getHistory(count) {
            if (!state.initialized || !state.repoPath) return Promise.resolve([]);
            return GitManager.log(state.repoPath, count || 50);
        }

        // --- Auto-save ---
        function setupDirtyPoll() {
            if (state.dirtyTimer) { clearInterval(state.dirtyTimer); state.dirtyTimer = null; }
            var seconds = state.settings.autoSaveIntervalSeconds;
            if (!seconds || seconds <= 0 || !state.projectPath) return;

            state.dirtyTimer = setInterval(function() {
                if (!state.initialized || state.operationInProgress) return;
                Bridge.callHost('saveProject').then(function() {
                    return new Promise(function(r) { setTimeout(r, 500); });
                }).then(function() {
                    return doSnapshot('Auto-snapshot');
                }).then(function(committed) {
                    if (committed) emit('auto-snapshot', {});
                }).catch(function() {});
            }, seconds * 1000);
        }

        // --- Project Poll ---
        function startProjectPoll() {
            if (state.pollTimer) clearInterval(state.pollTimer);
            state.pollTimer = setInterval(function() {
                if (state.operationInProgress) return;
                Bridge.callHost('getProjectPath').then(function(currentPath) {
                    if (!currentPath) {
                        if (state.initialized) { cleanup(); emit('project-closed', {}); }
                        return;
                    }
                    currentPath = path.normalize(currentPath);
                    if (state.projectPath && currentPath !== state.projectPath) {
                        cleanup();
                        emit('project-switched', { newPath: currentPath });
                        initialize().catch(function() {});
                    }
                }).catch(function() {});
            }, POLL_INTERVAL);
        }

        // --- Cleanup ---
        function cleanup() {
            if (state.dirtyTimer) { clearInterval(state.dirtyTimer); state.dirtyTimer = null; }
            if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
            state.initialized = false;
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

        return {
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
            createVersion: createVersion,
            switchVersion: switchVersion,
            listVersions: listVersions,
            deleteVersion: deleteVersion,
            getCurrentVersion: getCurrentVersion,
            addLabel: addLabel,
            getLabels: getLabels,
            getDiff: getDiff
        };
    }

    return { create: create };
})();
