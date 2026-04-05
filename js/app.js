// app.js - UI controller for Rewind

(function() {
    'use strict';

    var els = {};
    var historyItems = [];
    var historyOffset = 0;
    var PAGE_SIZE = 20;
    var toastTimer = null;
    var savedTimer = null;
    var versionDropdownOpen = false;
    var pendingDeleteBranch = null;

    function init() {
        if (window.DebugConsole) {
            DebugConsole.initialize();
        }
        console.log('rewind: panel loaded');
        cacheElements();
        bindEvents();
        listenToVC();
        checkGitHub();
        checkProject();
    }

    function cacheElements() {
        els.statusDot = document.getElementById('status-dot');
        els.settingsBtn = document.getElementById('settings-btn');
        els.initPanel = document.getElementById('init-panel');
        els.mainPanel = document.getElementById('main-panel');
        els.timelineContainer = document.getElementById('timeline-container');
        els.timeline = document.getElementById('timeline');
        els.loadMore = document.getElementById('load-more');
        els.loadMoreBtn = document.getElementById('load-more-btn');
        els.emptyState = document.getElementById('empty-state');
        els.snapshotInput = document.getElementById('snapshot-input');
        els.snapshotBtn = document.getElementById('snapshot-btn');
        els.initBtn = document.getElementById('init-btn');
        els.projectInfo = document.getElementById('project-info');
        els.settingsModal = document.getElementById('settings-modal');
        els.confirmModal = document.getElementById('confirm-modal');
        els.confirmText = document.getElementById('confirm-text');
        els.confirmYes = document.getElementById('confirm-yes');
        els.confirmNo = document.getElementById('confirm-no');
        els.intervalSelect = document.getElementById('interval-select');
        els.autoPushToggle = document.getElementById('auto-push-toggle');
        els.settingsSave = document.getElementById('settings-save');
        els.settingsCancel = document.getElementById('settings-cancel');
        els.toast = document.getElementById('toast');

        // GitHub
        els.githubBtn = document.getElementById('github-btn');
        els.githubPanel = document.getElementById('github-panel');
        els.githubToken = document.getElementById('github-token');
        els.githubConnectBtn = document.getElementById('github-connect-btn');
        els.githubInfo = document.getElementById('github-info');
        els.githubAvatar = document.getElementById('github-avatar');
        els.githubUsername = document.getElementById('github-username');
        els.githubSyncBtn = document.getElementById('github-sync-btn');
        els.githubLogoutBtn = document.getElementById('github-logout-btn');

        // Version selector
        els.versionDropdownBtn = document.getElementById('version-dropdown-btn');
        els.currentVersionName = document.getElementById('current-version-name');
        els.versionDropdown = document.getElementById('version-dropdown');
        els.versionList = document.getElementById('version-list');
        els.newVersionBtn = document.getElementById('new-version-btn');
        els.statusSaved = document.getElementById('status-saved');

        // Version modal
        els.versionModal = document.getElementById('version-modal');
        els.versionNameInput = document.getElementById('version-name-input');
        els.versionCreate = document.getElementById('version-create');
        els.versionCancel = document.getElementById('version-cancel');

        // Delete version modal
        els.deleteVersionModal = document.getElementById('delete-version-modal');
        els.deleteVersionText = document.getElementById('delete-version-text');
        els.deleteVersionYes = document.getElementById('delete-version-yes');
        els.deleteVersionNo = document.getElementById('delete-version-no');

        // Diff modal
        els.diffModal = document.getElementById('diff-modal');
        els.diffModalTitle = document.getElementById('diff-modal-title');
        els.diffContent = document.getElementById('diff-content');
        els.diffClose = document.getElementById('diff-close');
    }

    function bindEvents() {
        els.initBtn.addEventListener('click', handleInit);
        els.snapshotBtn.addEventListener('click', handleSnapshot);
        els.snapshotInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') handleSnapshot();
        });
        els.settingsBtn.addEventListener('click', openSettings);
        els.settingsSave.addEventListener('click', handleSaveSettings);
        els.settingsCancel.addEventListener('click', function() { hideModal(els.settingsModal); });
        els.confirmNo.addEventListener('click', function() { hideModal(els.confirmModal); });
        els.loadMoreBtn.addEventListener('click', loadMoreHistory);

        // GitHub
        els.githubBtn.addEventListener('click', toggleGitHubPanel);
        els.githubConnectBtn.addEventListener('click', handleGitHubConnect);
        els.githubToken.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') handleGitHubConnect();
        });
        els.githubSyncBtn.addEventListener('click', handleGitHubSync);
        els.githubLogoutBtn.addEventListener('click', handleGitHubLogout);

        // Version selector
        els.versionDropdownBtn.addEventListener('click', toggleVersionDropdown);
        els.newVersionBtn.addEventListener('click', openNewVersionModal);
        els.versionCreate.addEventListener('click', handleCreateVersion);
        els.versionCancel.addEventListener('click', function() { hideModal(els.versionModal); });
        els.versionNameInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') handleCreateVersion();
        });

        // Delete version
        els.deleteVersionNo.addEventListener('click', function() { hideModal(els.deleteVersionModal); });
        els.deleteVersionYes.addEventListener('click', handleDeleteVersion);

        // Diff
        els.diffClose.addEventListener('click', function() { hideModal(els.diffModal); });

        // Close modals on overlay click
        var modals = [els.settingsModal, els.confirmModal, els.versionModal, els.deleteVersionModal, els.diffModal];
        modals.forEach(function(modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === modal) hideModal(modal);
            });
        });

        // Close version dropdown on outside click
        document.addEventListener('click', function(e) {
            if (versionDropdownOpen && !els.versionDropdownBtn.contains(e.target) && !els.versionDropdown.contains(e.target)) {
                closeVersionDropdown();
            }
        });
    }

    function listenToVC() {
        VersionController.on(function(event, data) {
            switch (event) {
                case 'initialized':
                    showMainPanel();
                    setStatus('active');
                    showProjectPath(data.projectPath);
                    updateVersionName(data.version || 'Main Edit');
                    refreshHistory();
                    showToast('Tracking initialized', 'success');
                    if (window.GitHubManager && GitHubManager.isAuthenticated()) {
                        setupGitHubRemote();
                    }
                    break;
                case 'snapshot':
                case 'auto-snapshot':
                    refreshHistory();
                    updateSavedTime();
                    if (event === 'auto-snapshot') {
                        showToast('Auto-snapshot saved');
                    }
                    break;
                case 'restored':
                    refreshHistory();
                    updateSavedTime();
                    showToast('Restored to ' + data.hash.substring(0, 7), 'success');
                    break;
                case 'busy':
                    setStatus(data ? 'busy' : 'active');
                    els.snapshotBtn.disabled = !!data;
                    break;
                case 'project-closed':
                    // Don't switch to init panel if we're mid-restore/switch
                    var vcState = VersionController.getState();
                    if (!vcState.initialized) {
                        showInitPanel();
                        setStatus('inactive');
                        els.projectInfo.textContent = '';
                    }
                    break;
                case 'project-switched':
                    showToast('Project switched, re-initializing...');
                    break;
                case 'version-created':
                    updateVersionName(data.displayName);
                    refreshHistory();
                    showToast('Version "' + data.displayName + '" created', 'success');
                    break;
                case 'version-switched':
                    updateVersionName(data.displayName);
                    refreshHistory();
                    updateSavedTime();
                    showToast('Switched to "' + data.displayName + '"', 'success');
                    break;
                case 'version-deleted':
                    showToast('Version deleted');
                    break;
                case 'labels-changed':
                    refreshHistory();
                    break;
                case 'settings-changed':
                    break;
            }
        });
    }

    function checkProject() {
        Bridge.callHost('getProjectPath').then(function(projectPath) {
            if (projectPath) {
                var path = cep_node.require('path');
                var fs = cep_node.require('fs');
                var dir = path.dirname(path.normalize(projectPath));
                if (fs.existsSync(path.join(dir, '.rewind')) || fs.existsSync(path.join(dir, '.ppgit'))) {
                    handleInit();
                    return;
                }
                showInitPanel();
                showProjectPath(projectPath);
            } else {
                showInitPanel();
            }
        }).catch(function() {
            showInitPanel();
        });
    }

    // --- Core actions ---

    function handleInit() {
        els.initBtn.disabled = true;
        els.initBtn.textContent = 'Initializing...';
        setStatus('busy');
        VersionController.initialize().catch(function(err) {
            showToast('Init failed: ' + err.message, 'error');
            setStatus('inactive');
        }).finally(function() {
            els.initBtn.disabled = false;
            els.initBtn.textContent = 'Start Tracking';
        });
    }

    function handleSnapshot() {
        var msg = els.snapshotInput.value.trim();
        var label = msg; // Use the same message as the label if provided
        els.snapshotBtn.disabled = true;
        VersionController.snapshot(msg || undefined).then(function(committed) {
            els.snapshotInput.value = '';
            if (committed) {
                // If user typed a message, also save it as a label
                if (label) {
                    VersionController.getHistory(1).then(function(commits) {
                        if (commits.length > 0) {
                            VersionController.addLabel(commits[0].hash, label);
                        }
                    });
                }
                showToast('Snapshot saved', 'success');
            } else {
                showToast('No changes detected');
            }
        }).catch(function(err) {
            showToast('Snapshot failed: ' + err.message, 'error');
        }).finally(function() {
            els.snapshotBtn.disabled = false;
        });
    }

    function handleRestore(commitHash) {
        console.log('rewind: restore requested for', commitHash.substring(0, 7));
        els.confirmText.textContent = 'Current state will be saved first. Restore to this snapshot?';
        showModal(els.confirmModal);

        var confirmHandler, cancelHandler;

        function cleanup() {
            els.confirmYes.removeEventListener('click', confirmHandler);
            els.confirmNo.removeEventListener('click', cancelHandler);
        }

        confirmHandler = function() {
            cleanup();
            hideModal(els.confirmModal);
            console.log('rewind: user confirmed restore to', commitHash.substring(0, 7));
            VersionController.restore(commitHash).catch(function(err) {
                console.error('rewind: restore error caught in UI:', err.message);
                showToast('Restore failed: ' + err.message, 'error');
            });
        };

        cancelHandler = function() {
            cleanup();
            hideModal(els.confirmModal);
        };

        els.confirmYes.addEventListener('click', confirmHandler);
        els.confirmNo.addEventListener('click', cancelHandler);
    }

    // --- Version (Branch) Management ---

    function toggleVersionDropdown() {
        if (versionDropdownOpen) {
            closeVersionDropdown();
        } else {
            openVersionDropdown();
        }
    }

    function openVersionDropdown() {
        VersionController.listVersions().then(function(versions) {
            els.versionList.innerHTML = '';
            versions.forEach(function(v) {
                var opt = document.createElement('div');
                opt.className = 'version-option' + (v.current ? ' active' : '');

                var nameSpan = document.createElement('span');
                nameSpan.className = 'version-option-name';
                nameSpan.textContent = v.displayName;
                opt.appendChild(nameSpan);

                // Delete button (not on current or master)
                if (!v.current && v.branch !== 'master') {
                    var delBtn = document.createElement('button');
                    delBtn.className = 'version-delete-btn';
                    delBtn.innerHTML = '&#10005;';
                    delBtn.title = 'Delete version';
                    delBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        closeVersionDropdown();
                        confirmDeleteVersion(v.branch, v.displayName);
                    });
                    opt.appendChild(delBtn);
                }

                if (!v.current) {
                    opt.addEventListener('click', function() {
                        closeVersionDropdown();
                        VersionController.switchVersion(v.branch).catch(function(err) {
                            showToast('Switch failed: ' + err.message, 'error');
                        });
                    });
                }

                els.versionList.appendChild(opt);
            });
            els.versionDropdown.style.display = 'block';
            versionDropdownOpen = true;
        });
    }

    function closeVersionDropdown() {
        els.versionDropdown.style.display = 'none';
        versionDropdownOpen = false;
    }

    function openNewVersionModal() {
        closeVersionDropdown();
        els.versionNameInput.value = '';
        showModal(els.versionModal);
        setTimeout(function() { els.versionNameInput.focus(); }, 100);
    }

    function handleCreateVersion() {
        var name = els.versionNameInput.value.trim();
        if (!name) {
            showToast('Please enter a version name', 'error');
            return;
        }
        hideModal(els.versionModal);
        VersionController.createVersion(name).catch(function(err) {
            showToast('Create failed: ' + err.message, 'error');
        });
    }

    function confirmDeleteVersion(branch, displayName) {
        pendingDeleteBranch = branch;
        els.deleteVersionText.textContent = 'Delete "' + displayName + '"? This will permanently remove this version and all its snapshots.';
        showModal(els.deleteVersionModal);
    }

    function handleDeleteVersion() {
        hideModal(els.deleteVersionModal);
        if (!pendingDeleteBranch) return;
        var branch = pendingDeleteBranch;
        pendingDeleteBranch = null;
        VersionController.deleteVersion(branch).catch(function(err) {
            showToast('Delete failed: ' + err.message, 'error');
        });
    }

    function updateVersionName(name) {
        els.currentVersionName.textContent = name || 'Main Edit';
    }

    // --- History ---

    function refreshHistory() {
        historyOffset = 0;
        VersionController.getHistory(PAGE_SIZE + 1).then(function(commits) {
            historyItems = commits;
            renderTimeline(commits.slice(0, PAGE_SIZE));
            els.loadMore.style.display = commits.length > PAGE_SIZE ? 'block' : 'none';
        }).catch(function(err) {
            console.error('Failed to load history:', err.message);
        });
    }

    function loadMoreHistory() {
        historyOffset += PAGE_SIZE;
        VersionController.getHistory(historyOffset + PAGE_SIZE + 1).then(function(commits) {
            historyItems = commits;
            renderTimeline(commits.slice(0, historyOffset + PAGE_SIZE));
            els.loadMore.style.display = commits.length > historyOffset + PAGE_SIZE ? 'block' : 'none';
        }).catch(function(err) {
            console.error('Failed to load more history:', err.message);
        });
    }

    function renderTimeline(commits) {
        var labels = VersionController.getLabels();
        els.timeline.innerHTML = '';
        if (commits.length === 0) {
            els.emptyState.style.display = 'block';
            return;
        }
        els.emptyState.style.display = 'none';

        commits.forEach(function(commit, i) {
            var item = document.createElement('div');
            item.className = 'commit-item';

            // Dot column
            var dotCol = document.createElement('div');
            dotCol.className = 'commit-dot-col';
            var dot = document.createElement('div');
            dot.className = 'commit-dot';
            dotCol.appendChild(dot);
            if (i < commits.length - 1) {
                var line = document.createElement('div');
                line.className = 'commit-line';
                dotCol.appendChild(line);
            }

            // Info column
            var info = document.createElement('div');
            info.className = 'commit-info';

            var msg = document.createElement('div');
            msg.className = 'commit-message';
            msg.textContent = commit.message;
            msg.title = commit.message;
            info.appendChild(msg);

            // Label
            var label = labels[commit.hash];
            var labelEl = document.createElement('span');
            labelEl.className = 'commit-label' + (label ? '' : ' empty');
            labelEl.textContent = label || '+ label';
            labelEl.title = label ? 'Click to edit label' : 'Click to add label';
            labelEl.addEventListener('click', (function(hash, currentLabel) {
                return function() {
                    var newLabel = prompt('Snapshot label:', currentLabel || '');
                    if (newLabel !== null) {
                        VersionController.addLabel(hash, newLabel);
                    }
                };
            })(commit.hash, label));
            info.appendChild(labelEl);

            // Meta row
            var meta = document.createElement('div');
            meta.className = 'commit-meta';
            var hashSpan = document.createElement('span');
            hashSpan.className = 'commit-hash';
            hashSpan.textContent = commit.hash.substring(0, 7);
            meta.appendChild(hashSpan);
            meta.appendChild(document.createTextNode(' \u00B7 ' + commit.dateRelative));

            // Diff link (compare with previous commit)
            if (i < commits.length - 1) {
                var diffLink = document.createElement('span');
                diffLink.className = 'commit-diff-link';
                diffLink.textContent = 'diff';
                diffLink.addEventListener('click', (function(hashNew, hashOld) {
                    return function() { showDiff(hashNew, hashOld); };
                })(commit.hash, commits[i + 1].hash));
                meta.appendChild(document.createTextNode(' \u00B7 '));
                meta.appendChild(diffLink);
            }

            info.appendChild(meta);

            // Actions
            var actions = document.createElement('div');
            actions.className = 'commit-actions';
            if (i > 0) {
                var btn = document.createElement('button');
                btn.className = 'restore-btn';
                btn.textContent = 'Restore';
                btn.addEventListener('click', (function(hash) {
                    return function() { handleRestore(hash); };
                })(commit.hash));
                actions.appendChild(btn);
            }

            item.appendChild(dotCol);
            item.appendChild(info);
            item.appendChild(actions);
            els.timeline.appendChild(item);
        });
    }

    // --- Diffs ---

    function showDiff(hashNew, hashOld) {
        els.diffContent.textContent = 'Comparing...';
        els.diffModalTitle.textContent = 'Changes';
        showModal(els.diffModal);

        VersionController.getDiff(hashOld, hashNew).then(function(result) {
            if (!result || result.totalChanges === 0) {
                els.diffContent.innerHTML = '<div class="diff-summary-text">No meaningful changes detected</div>';
                return;
            }

            var html = '';
            if (result.sequences && result.sequences.length > 0) {
                result.sequences.forEach(function(s) {
                    var cssClass = s.status === 'added' ? 'added' : s.status === 'removed' ? 'removed' : 'modified';
                    var desc = '';
                    if (s.status === 'added') desc = 'Added';
                    else if (s.status === 'removed') desc = 'Removed';
                    else desc = escapeHtml(String(s.changes)) + ' changes';
                    html += '<div class="diff-item ' + cssClass + '">';
                    html += '<strong>' + escapeHtml(s.name) + '</strong>: ' + desc;
                    html += '</div>';
                });
            }
            if (result.projectSettings && result.projectSettings.changed) {
                html += '<div class="diff-item modified">';
                html += escapeHtml(String(result.projectSettings.count)) + ' project setting changes';
                html += '</div>';
            }
            if (!html) {
                html = '<div class="diff-summary-text">' + escapeHtml(result.summary) + '</div>';
            }
            els.diffContent.innerHTML = html;
        }).catch(function(err) {
            els.diffContent.textContent = 'Diff failed: ' + err.message;
        });
    }

    // --- GitHub ---

    function checkGitHub() {
        if (window.GitHubManager && GitHubManager.isAuthenticated()) {
            showGitHubConnected();
        }
    }

    function toggleGitHubPanel() {
        if (GitHubManager.isAuthenticated()) {
            var vis = els.githubInfo.style.display;
            els.githubInfo.style.display = vis === 'none' ? 'block' : 'none';
            els.githubPanel.style.display = 'none';
        } else {
            var vis2 = els.githubPanel.style.display;
            els.githubPanel.style.display = vis2 === 'none' ? 'block' : 'none';
        }
    }

    function handleGitHubConnect() {
        var token = els.githubToken.value.trim();
        if (!token) {
            showToast('Please paste a GitHub token', 'error');
            return;
        }
        els.githubConnectBtn.disabled = true;
        els.githubConnectBtn.textContent = 'Connecting...';
        GitHubManager.authenticate(token).then(function(user) {
            showToast('Connected as ' + user.login, 'success');
            showGitHubConnected();
            els.githubPanel.style.display = 'none';
            els.githubToken.value = '';
            var vcState = VersionController.getState();
            if (vcState.initialized) {
                setupGitHubRemote();
            }
        }).catch(function(err) {
            showToast('GitHub auth failed: ' + err.message, 'error');
        }).finally(function() {
            els.githubConnectBtn.disabled = false;
            els.githubConnectBtn.textContent = 'Connect';
        });
    }

    function showGitHubConnected() {
        var user = GitHubManager.getUser();
        if (!user) return;
        els.githubAvatar.src = user.avatar || '';
        els.githubAvatar.style.display = user.avatar ? 'block' : 'none';
        els.githubUsername.textContent = user.login || user.name;
        els.githubInfo.style.display = 'block';
        els.githubPanel.style.display = 'none';
    }

    function setupGitHubRemote() {
        var vcState = VersionController.getState();
        if (!vcState.projectPath) return Promise.resolve();
        var projectName = vcState.projectPath.replace(/\\/g, '/').split('/').pop();
        return GitHubManager.getOrCreateRepo(projectName).then(function(repo) {
            return GitHubManager.setupRemote(
                VersionController.getRepoPath(),
                repo.url
            );
        }).catch(function(err) {
            console.error('rewind: GitHub remote setup failed:', err.message);
        });
    }

    function handleGitHubSync() {
        els.githubSyncBtn.disabled = true;
        els.githubSyncBtn.textContent = 'Syncing...';
        var repoPath = VersionController.getRepoPath();
        if (!repoPath) {
            showToast('No project being tracked', 'error');
            els.githubSyncBtn.disabled = false;
            els.githubSyncBtn.textContent = '\u21BB Sync';
            return;
        }

        setupGitHubRemote().then(function() {
            return GitHubManager.sync(repoPath);
        }).then(function() {
            showToast('Synced to GitHub', 'success');
        }).catch(function(err) {
            showToast('Sync failed: ' + err.message, 'error');
        }).finally(function() {
            els.githubSyncBtn.disabled = false;
            els.githubSyncBtn.textContent = '\u21BB Sync';
        });
    }

    function handleGitHubLogout() {
        GitHubManager.logout();
        els.githubInfo.style.display = 'none';
        els.githubAvatar.src = '';
        els.githubUsername.textContent = '';
        showToast('Disconnected from GitHub');
    }

    // --- Settings ---

    function openSettings() {
        var s = VersionController.getSettings();
        els.intervalSelect.value = String(s.autoSaveIntervalSeconds);
        els.autoPushToggle.checked = !!s.autoPush;
        showModal(els.settingsModal);
    }

    function handleSaveSettings() {
        VersionController.saveSettings({
            autoSaveIntervalSeconds: parseInt(els.intervalSelect.value, 10),
            autoPush: els.autoPushToggle.checked
        });
        hideModal(els.settingsModal);
        showToast('Settings saved', 'success');
    }

    // --- UI Helpers ---

    function showMainPanel() {
        els.initPanel.style.display = 'none';
        els.mainPanel.style.display = 'flex';
    }

    function showInitPanel() {
        els.initPanel.style.display = 'flex';
        els.mainPanel.style.display = 'none';
        els.initBtn.disabled = false;
        els.initBtn.textContent = 'Start Tracking';
    }

    function setStatus(status) {
        els.statusDot.className = 'status-dot' + (status !== 'inactive' ? ' ' + status : '');
    }

    function showProjectPath(p) {
        if (!p) return;
        var name = p.replace(/\\/g, '/').split('/').pop();
        els.projectInfo.textContent = name;
        els.projectInfo.title = p;
    }

    function updateSavedTime() {
        if (savedTimer) clearInterval(savedTimer);
        var savedAt = new Date();

        function update() {
            var diff = Math.floor((Date.now() - savedAt.getTime()) / 1000);
            if (diff < 5) els.statusSaved.textContent = 'saved just now';
            else if (diff < 60) els.statusSaved.textContent = 'saved ' + diff + 's ago';
            else if (diff < 3600) els.statusSaved.textContent = 'saved ' + Math.floor(diff / 60) + 'm ago';
            else els.statusSaved.textContent = 'saved ' + Math.floor(diff / 3600) + 'h ago';
        }

        update();
        savedTimer = setInterval(update, 10000);
    }

    function showModal(el) {
        el.classList.add('visible');
    }

    function hideModal(el) {
        el.classList.remove('visible');
    }

    function showToast(msg, type) {
        clearTimeout(toastTimer);
        els.toast.textContent = msg;
        els.toast.className = 'toast' + (type ? ' ' + type : '');
        void els.toast.offsetWidth;
        els.toast.classList.add('show');
        toastTimer = setTimeout(function() {
            els.toast.classList.remove('show');
        }, 2500);
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
