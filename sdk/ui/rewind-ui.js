// sdk/ui/rewind-ui.js - Self-contained, mountable Rewind UI widget
// Mount with: RewindUI.mount(containerElement, sdkInstance, modules)

var RewindUI = (function() {
    'use strict';

    var sdk = null;
    var mods = null;
    var rootEl = null;
    var els = {};
    var historyItems = [];
    var historyOffset = 0;
    var PAGE_SIZE = 20;
    var toastTimer = null;
    var savedTimer = null;
    var versionDropdownOpen = false;
    var pendingDeleteBranch = null;

    // --- HTML Template ---
    var TEMPLATE = '' +
        '<div class="rewind-root">' +
        '  <div class="rw-header">' +
        '    <div class="rw-header-left">' +
        '      <div class="rw-status-dot"></div>' +
        '      <span class="rw-header-title">Rewind</span>' +
        '    </div>' +
        '    <div class="rw-header-actions">' +
        '      <button class="rw-icon-btn rw-github-btn" title="GitHub">&#9729;</button>' +
        '      <button class="rw-icon-btn rw-settings-btn" title="Settings">&#9881;</button>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rw-github-panel" style="display:none;">' +
        '    <div class="rw-github-setup">' +
        '      <div class="rw-icon">&#128279;</div>' +
        '      <p class="rw-github-heading">Connect to GitHub</p>' +
        '      <p class="rw-github-desc">Back up your project versions to a private GitHub repository.</p>' +
        '      <div class="rw-github-token-row">' +
        '        <input class="rw-github-token-input" type="password" placeholder="Paste your GitHub token">' +
        '        <button class="rw-snapshot-btn rw-github-connect-btn">Connect</button>' +
        '      </div>' +
        '      <p class="rw-github-help">Need a token? Go to GitHub &gt; Settings &gt; Developer settings &gt; Personal access tokens &gt; Generate new token. Select <strong>repo</strong> scope.</p>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rw-github-info" style="display:none;">' +
        '    <div class="rw-github-user-row">' +
        '      <img class="rw-github-avatar" src="" alt="">' +
        '      <span class="rw-github-username"></span>' +
        '      <button class="rw-sync-btn rw-github-sync-btn" title="Sync to GitHub">&#8635; Sync</button>' +
        '      <button class="rw-icon-btn rw-github-logout-btn" title="Disconnect">&#10005;</button>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rw-init-panel">' +
        '    <div class="rw-icon">&#128193;</div>' +
        '    <p>Stop naming your projects _FINAL_FINAL2.prproj</p>' +
        '    <p class="rw-init-subtitle">Full version history for every Premiere Pro project.</p>' +
        '    <button class="rw-init-btn">Start Tracking</button>' +
        '  </div>' +
        '  <div class="rw-main-panel" style="display:none;">' +
        '    <div class="rw-version-bar">' +
        '      <div class="rw-version-selector-wrap">' +
        '        <button class="rw-version-dropdown-btn">' +
        '          <span class="rw-current-version-name">Main Edit</span>' +
        '          <span class="rw-dropdown-arrow">&#9662;</span>' +
        '        </button>' +
        '        <div class="rw-version-dropdown" style="display:none;">' +
        '          <div class="rw-version-list"></div>' +
        '          <div class="rw-version-dropdown-divider"></div>' +
        '          <button class="rw-new-version-option">+ New Version</button>' +
        '        </div>' +
        '      </div>' +
        '      <div class="rw-version-bar-right">' +
        '        <span class="rw-project-info"></span>' +
        '        <span class="rw-status-saved"></span>' +
        '      </div>' +
        '    </div>' +
        '    <div class="rw-timeline-container">' +
        '      <div class="rw-timeline"></div>' +
        '      <div class="rw-empty-state" style="display:none;">No snapshots yet</div>' +
        '      <div class="rw-load-more" style="display:none;">' +
        '        <button class="rw-load-more-btn">Load more</button>' +
        '      </div>' +
        '    </div>' +
        '    <div class="rw-bottom-bar">' +
        '      <div class="rw-snapshot-row">' +
        '        <input class="rw-snapshot-input" type="text" placeholder="Snapshot label (optional)" maxlength="200">' +
        '        <button class="rw-snapshot-btn">Snapshot</button>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rw-modal-overlay rw-settings-modal">' +
        '    <div class="rw-modal">' +
        '      <div class="rw-modal-title">Settings</div>' +
        '      <div class="rw-modal-row"><span class="rw-modal-label">Auto-save interval</span>' +
        '        <select class="rw-modal-select rw-interval-select">' +
        '          <option value="0">Off</option><option value="30">30 sec</option>' +
        '          <option value="60" selected>1 min</option><option value="120">2 min</option>' +
        '          <option value="300">5 min</option>' +
        '        </select>' +
        '      </div>' +
        '      <div class="rw-modal-row"><span class="rw-modal-label">Auto-sync to GitHub</span>' +
        '        <label class="rw-toggle"><input type="checkbox" class="rw-auto-push-toggle"><span class="rw-toggle-slider"></span></label>' +
        '      </div>' +
        '      <div class="rw-modal-actions">' +
        '        <button class="rw-modal-btn rw-secondary rw-settings-cancel">Cancel</button>' +
        '        <button class="rw-modal-btn rw-primary rw-settings-save">Save</button>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rw-modal-overlay rw-confirm-modal">' +
        '    <div class="rw-modal">' +
        '      <div class="rw-modal-title">Confirm Restore</div>' +
        '      <div class="rw-confirm-text"></div>' +
        '      <div class="rw-modal-actions">' +
        '        <button class="rw-modal-btn rw-secondary rw-confirm-no">Cancel</button>' +
        '        <button class="rw-modal-btn rw-primary rw-confirm-yes">Restore</button>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rw-modal-overlay rw-version-modal">' +
        '    <div class="rw-modal">' +
        '      <div class="rw-modal-title">New Version</div>' +
        '      <p class="rw-modal-desc">Create a copy of the current version to experiment with.</p>' +
        '      <input class="rw-modal-input rw-version-name-input" type="text" placeholder="e.g. Short Intro Alt" maxlength="60">' +
        '      <div class="rw-modal-actions">' +
        '        <button class="rw-modal-btn rw-secondary rw-version-cancel">Cancel</button>' +
        '        <button class="rw-modal-btn rw-primary rw-version-create">Create</button>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rw-modal-overlay rw-delete-version-modal">' +
        '    <div class="rw-modal">' +
        '      <div class="rw-modal-title">Delete Version</div>' +
        '      <div class="rw-confirm-text rw-delete-version-text"></div>' +
        '      <div class="rw-modal-actions">' +
        '        <button class="rw-modal-btn rw-secondary rw-delete-version-no">Cancel</button>' +
        '        <button class="rw-modal-btn rw-primary rw-danger rw-delete-version-yes">Delete</button>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rw-modal-overlay rw-diff-modal">' +
        '    <div class="rw-modal rw-modal-wide">' +
        '      <div class="rw-modal-title rw-diff-modal-title">Changes</div>' +
        '      <div class="rw-diff-content">Loading...</div>' +
        '      <div class="rw-modal-actions">' +
        '        <button class="rw-modal-btn rw-secondary rw-diff-close">Close</button>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rw-toast"></div>' +
        '</div>';

    // --- Helpers ---
    function q(selector) {
        return rootEl.querySelector(selector);
    }

    function showModal(el) { el.classList.add('rw-visible'); }
    function hideModal(el) { el.classList.remove('rw-visible'); }

    function showToast(msg, type) {
        clearTimeout(toastTimer);
        els.toast.textContent = msg;
        els.toast.className = 'rw-toast' + (type ? ' rw-' + type : '');
        void els.toast.offsetWidth;
        els.toast.classList.add('rw-show');
        toastTimer = setTimeout(function() { els.toast.classList.remove('rw-show'); }, 2500);
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // --- Cache Elements ---
    function cacheElements() {
        els.statusDot = q('.rw-status-dot');
        els.initPanel = q('.rw-init-panel');
        els.mainPanel = q('.rw-main-panel');
        els.timeline = q('.rw-timeline');
        els.loadMore = q('.rw-load-more');
        els.loadMoreBtn = q('.rw-load-more-btn');
        els.emptyState = q('.rw-empty-state');
        els.snapshotInput = q('.rw-snapshot-input');
        els.snapshotBtn = q('.rw-snapshot-row .rw-snapshot-btn');
        els.initBtn = q('.rw-init-btn');
        els.projectInfo = q('.rw-project-info');
        els.settingsModal = q('.rw-settings-modal');
        els.confirmModal = q('.rw-confirm-modal');
        els.confirmText = q('.rw-confirm-text');
        els.confirmYes = q('.rw-confirm-yes');
        els.confirmNo = q('.rw-confirm-no');
        els.intervalSelect = q('.rw-interval-select');
        els.autoPushToggle = q('.rw-auto-push-toggle');
        els.settingsSave = q('.rw-settings-save');
        els.settingsCancel = q('.rw-settings-cancel');
        els.toast = q('.rw-toast');
        els.githubBtn = q('.rw-github-btn');
        els.githubPanel = q('.rw-github-panel');
        els.githubToken = q('.rw-github-token-input');
        els.githubConnectBtn = q('.rw-github-connect-btn');
        els.githubInfo = q('.rw-github-info');
        els.githubAvatar = q('.rw-github-avatar');
        els.githubUsername = q('.rw-github-username');
        els.githubSyncBtn = q('.rw-github-sync-btn');
        els.githubLogoutBtn = q('.rw-github-logout-btn');
        els.versionDropdownBtn = q('.rw-version-dropdown-btn');
        els.currentVersionName = q('.rw-current-version-name');
        els.versionDropdown = q('.rw-version-dropdown');
        els.versionList = q('.rw-version-list');
        els.newVersionBtn = q('.rw-new-version-option');
        els.statusSaved = q('.rw-status-saved');
        els.versionModal = q('.rw-version-modal');
        els.versionNameInput = q('.rw-version-name-input');
        els.versionCreate = q('.rw-version-create');
        els.versionCancel = q('.rw-version-cancel');
        els.deleteVersionModal = q('.rw-delete-version-modal');
        els.deleteVersionText = q('.rw-delete-version-text');
        els.deleteVersionYes = q('.rw-delete-version-yes');
        els.deleteVersionNo = q('.rw-delete-version-no');
        els.diffModal = q('.rw-diff-modal');
        els.diffModalTitle = q('.rw-diff-modal-title');
        els.diffContent = q('.rw-diff-content');
        els.diffClose = q('.rw-diff-close');
    }

    // --- Bind Events ---
    function bindEvents() {
        els.initBtn.addEventListener('click', handleInit);
        els.snapshotBtn.addEventListener('click', handleSnapshot);
        els.snapshotInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleSnapshot(); });
        q('.rw-settings-btn').addEventListener('click', openSettings);
        els.settingsSave.addEventListener('click', handleSaveSettings);
        els.settingsCancel.addEventListener('click', function() { hideModal(els.settingsModal); });
        els.confirmNo.addEventListener('click', function() { hideModal(els.confirmModal); });
        els.loadMoreBtn.addEventListener('click', loadMoreHistory);

        els.githubBtn.addEventListener('click', toggleGitHubPanel);
        els.githubConnectBtn.addEventListener('click', handleGitHubConnect);
        els.githubToken.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleGitHubConnect(); });
        els.githubSyncBtn.addEventListener('click', handleGitHubSync);
        els.githubLogoutBtn.addEventListener('click', handleGitHubLogout);

        els.versionDropdownBtn.addEventListener('click', toggleVersionDropdown);
        els.newVersionBtn.addEventListener('click', openNewVersionModal);
        els.versionCreate.addEventListener('click', handleCreateVersion);
        els.versionCancel.addEventListener('click', function() { hideModal(els.versionModal); });
        els.versionNameInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleCreateVersion(); });

        els.deleteVersionNo.addEventListener('click', function() { hideModal(els.deleteVersionModal); });
        els.deleteVersionYes.addEventListener('click', handleDeleteVersion);
        els.diffClose.addEventListener('click', function() { hideModal(els.diffModal); });

        var modals = [els.settingsModal, els.confirmModal, els.versionModal, els.deleteVersionModal, els.diffModal];
        modals.forEach(function(modal) {
            modal.addEventListener('click', function(e) { if (e.target === modal) hideModal(modal); });
        });

        document.addEventListener('click', function(e) {
            if (versionDropdownOpen && !els.versionDropdownBtn.contains(e.target) && !els.versionDropdown.contains(e.target)) {
                closeVersionDropdown();
            }
        });
    }

    // --- Listen to SDK events ---
    var sdkListener = null;

    function listenToSDK() {
        sdkListener = function(event, data) {
            switch (event) {
                case 'initialized':
                    showMainPanel();
                    setStatus('active');
                    showProjectPath(data.projectPath);
                    updateVersionName(data.version || 'Main Edit');
                    refreshHistory();
                    showToast('Tracking initialized', 'success');
                    if (sdk.github.isAuthenticated()) setupGitHubRemote();
                    break;
                case 'snapshot':
                case 'auto-snapshot':
                    refreshHistory();
                    updateSavedTime();
                    if (event === 'auto-snapshot') showToast('Auto-snapshot saved');
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
                    var st = sdk.getState();
                    if (!st.initialized) { showInitPanel(); setStatus('inactive'); els.projectInfo.textContent = ''; }
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
            }
        };
        sdk.on(sdkListener);
    }

    // --- Core Actions ---
    function handleInit() {
        els.initBtn.disabled = true;
        els.initBtn.textContent = 'Initializing...';
        setStatus('busy');
        sdk.start().catch(function(err) {
            showToast('Init failed: ' + err.message, 'error');
            setStatus('inactive');
            els.initBtn.disabled = false;
            els.initBtn.textContent = 'Start Tracking';
        });
    }

    function handleSnapshot() {
        var msg = els.snapshotInput.value.trim();
        var label = msg;
        els.snapshotBtn.disabled = true;
        sdk.snapshot(msg || undefined).then(function(committed) {
            els.snapshotInput.value = '';
            if (committed) {
                if (label) {
                    sdk.getHistory(1).then(function(commits) {
                        if (commits.length > 0) sdk.addLabel(commits[0].hash, label);
                    });
                }
                showToast('Snapshot saved', 'success');
            } else {
                showToast('No changes detected');
            }
        }).catch(function(err) {
            showToast('Snapshot failed: ' + err.message, 'error');
        }).then(function(result) {
            els.snapshotBtn.disabled = false;
            return result;
        }, function(err) {
            els.snapshotBtn.disabled = false;
            throw err;
        });
    }

    function handleRestore(commitHash) {
        els.confirmText.textContent = 'Current state will be saved first. Restore to this snapshot?';
        showModal(els.confirmModal);
        var confirmHandler, cancelHandler;
        function cleanup() {
            els.confirmYes.removeEventListener('click', confirmHandler);
            els.confirmNo.removeEventListener('click', cancelHandler);
        }
        confirmHandler = function() {
            cleanup(); hideModal(els.confirmModal);
            sdk.restore(commitHash).catch(function(err) {
                showToast('Restore failed: ' + err.message, 'error');
            });
        };
        cancelHandler = function() { cleanup(); hideModal(els.confirmModal); };
        els.confirmYes.addEventListener('click', confirmHandler);
        els.confirmNo.addEventListener('click', cancelHandler);
    }

    // --- Version Management ---
    function toggleVersionDropdown() {
        versionDropdownOpen ? closeVersionDropdown() : openVersionDropdown();
    }

    function openVersionDropdown() {
        sdk.listVersions().then(function(versions) {
            els.versionList.innerHTML = '';
            versions.forEach(function(v) {
                var opt = document.createElement('div');
                opt.className = 'rw-version-option' + (v.current ? ' rw-active' : '');
                var nameSpan = document.createElement('span');
                nameSpan.className = 'rw-version-option-name';
                nameSpan.textContent = v.displayName;
                opt.appendChild(nameSpan);
                if (!v.current && v.branch !== 'master') {
                    var delBtn = document.createElement('button');
                    delBtn.className = 'rw-version-delete-btn';
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
                        sdk.switchVersion(v.branch).catch(function(err) {
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
        if (!name) { showToast('Please enter a version name', 'error'); return; }
        hideModal(els.versionModal);
        sdk.createVersion(name).catch(function(err) {
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
        sdk.deleteVersion(branch).catch(function(err) {
            showToast('Delete failed: ' + err.message, 'error');
        });
    }

    function updateVersionName(name) {
        els.currentVersionName.textContent = name || 'Main Edit';
    }

    // --- History ---
    function refreshHistory() {
        historyOffset = 0;
        sdk.getHistory(PAGE_SIZE + 1).then(function(commits) {
            historyItems = commits;
            renderTimeline(commits.slice(0, PAGE_SIZE));
            els.loadMore.style.display = commits.length > PAGE_SIZE ? 'block' : 'none';
        }).catch(function() {});
    }

    function loadMoreHistory() {
        historyOffset += PAGE_SIZE;
        sdk.getHistory(historyOffset + PAGE_SIZE + 1).then(function(commits) {
            historyItems = commits;
            renderTimeline(commits.slice(0, historyOffset + PAGE_SIZE));
            els.loadMore.style.display = commits.length > historyOffset + PAGE_SIZE ? 'block' : 'none';
        }).catch(function() {});
    }

    function renderTimeline(commits) {
        var labels = sdk.getLabels();
        els.timeline.innerHTML = '';
        if (commits.length === 0) { els.emptyState.style.display = 'block'; return; }
        els.emptyState.style.display = 'none';

        commits.forEach(function(commit, i) {
            var item = document.createElement('div');
            item.className = 'rw-commit-item';

            var dotCol = document.createElement('div');
            dotCol.className = 'rw-commit-dot-col';
            var dot = document.createElement('div');
            dot.className = 'rw-commit-dot';
            dotCol.appendChild(dot);
            if (i < commits.length - 1) {
                var line = document.createElement('div');
                line.className = 'rw-commit-line';
                dotCol.appendChild(line);
            }

            var info = document.createElement('div');
            info.className = 'rw-commit-info';

            var msg = document.createElement('div');
            msg.className = 'rw-commit-message';
            msg.textContent = commit.message;
            msg.title = commit.message;
            info.appendChild(msg);

            var label = labels[commit.hash];
            var labelEl = document.createElement('span');
            labelEl.className = 'rw-commit-label' + (label ? '' : ' rw-empty');
            labelEl.textContent = label || '+ label';
            labelEl.title = label ? 'Click to edit label' : 'Click to add label';
            labelEl.addEventListener('click', (function(hash, currentLabel) {
                return function() {
                    var newLabel = prompt('Snapshot label:', currentLabel || '');
                    if (newLabel !== null) sdk.addLabel(hash, newLabel);
                };
            })(commit.hash, label));
            info.appendChild(labelEl);

            var meta = document.createElement('div');
            meta.className = 'rw-commit-meta';
            var hashSpan = document.createElement('span');
            hashSpan.className = 'rw-commit-hash';
            hashSpan.textContent = commit.hash.substring(0, 7);
            meta.appendChild(hashSpan);
            meta.appendChild(document.createTextNode(' \u00B7 ' + commit.dateRelative));

            if (i < commits.length - 1) {
                var diffLink = document.createElement('span');
                diffLink.className = 'rw-commit-diff-link';
                diffLink.textContent = 'diff';
                diffLink.addEventListener('click', (function(hashNew, hashOld) {
                    return function() { showDiff(hashNew, hashOld); };
                })(commit.hash, commits[i + 1].hash));
                meta.appendChild(document.createTextNode(' \u00B7 '));
                meta.appendChild(diffLink);
            }
            info.appendChild(meta);

            var actions = document.createElement('div');
            actions.className = 'rw-commit-actions';
            if (i > 0) {
                var btn = document.createElement('button');
                btn.className = 'rw-restore-btn';
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
        sdk.getDiff(hashOld, hashNew).then(function(result) {
            if (!result || result.totalChanges === 0) {
                els.diffContent.innerHTML = '<div class="rw-diff-summary-text">No meaningful changes detected</div>';
                return;
            }
            var html = '';
            if (result.sequences && result.sequences.length > 0) {
                result.sequences.forEach(function(s) {
                    var cssClass = s.status === 'added' ? 'rw-added' : s.status === 'removed' ? 'rw-removed' : 'rw-modified';
                    var desc = s.status === 'added' ? 'Added' : s.status === 'removed' ? 'Removed' : s.changes + ' changes';
                    html += '<div class="rw-diff-item ' + cssClass + '"><strong>' + escapeHtml(s.name) + '</strong>: ' + desc + '</div>';
                });
            }
            if (result.projectSettings && result.projectSettings.changed) {
                html += '<div class="rw-diff-item rw-modified">' + result.projectSettings.count + ' project setting changes</div>';
            }
            if (!html) html = '<div class="rw-diff-summary-text">' + escapeHtml(result.summary) + '</div>';
            els.diffContent.innerHTML = html;
        }).catch(function(err) {
            els.diffContent.textContent = 'Diff failed: ' + err.message;
        });
    }

    // --- GitHub ---
    function checkGitHub() {
        if (sdk.github.isAuthenticated()) showGitHubConnected();
    }

    function toggleGitHubPanel() {
        if (sdk.github.isAuthenticated()) {
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
        if (!token) { showToast('Please paste a GitHub token', 'error'); return; }
        els.githubConnectBtn.disabled = true;
        els.githubConnectBtn.textContent = 'Connecting...';
        sdk.github.authenticate(token).then(function(user) {
            showToast('Connected as ' + user.login, 'success');
            showGitHubConnected();
            els.githubPanel.style.display = 'none';
            els.githubToken.value = '';
            var st = sdk.getState();
            if (st.initialized) setupGitHubRemote();
        }).catch(function(err) {
            showToast('GitHub auth failed: ' + err.message, 'error');
        }).then(function(result) {
            els.githubConnectBtn.disabled = false;
            els.githubConnectBtn.textContent = 'Connect';
            return result;
        }, function(err) {
            els.githubConnectBtn.disabled = false;
            els.githubConnectBtn.textContent = 'Connect';
            throw err;
        });
    }

    function showGitHubConnected() {
        var user = sdk.github.getUser();
        if (!user) return;
        els.githubAvatar.src = user.avatar || '';
        els.githubAvatar.style.display = user.avatar ? 'block' : 'none';
        els.githubUsername.textContent = user.login || user.name;
        els.githubInfo.style.display = 'block';
        els.githubPanel.style.display = 'none';
    }

    function setupGitHubRemote() {
        var st = sdk.getState();
        if (!st.projectPath) return Promise.resolve();
        var projectName = st.projectPath.replace(/\\/g, '/').split('/').pop();
        return sdk.github.setupRemote(projectName).catch(function() {});
    }

    function handleGitHubSync() {
        els.githubSyncBtn.disabled = true;
        els.githubSyncBtn.textContent = 'Syncing...';
        if (!sdk.getRepoPath()) {
            showToast('No project being tracked', 'error');
            els.githubSyncBtn.disabled = false;
            els.githubSyncBtn.textContent = '\u21BB Sync';
            return;
        }
        setupGitHubRemote().then(function() {
            return sdk.github.sync();
        }).then(function() {
            showToast('Synced to GitHub', 'success');
        }).catch(function(err) {
            showToast('Sync failed: ' + err.message, 'error');
        }).then(function(result) {
            els.githubSyncBtn.disabled = false;
            els.githubSyncBtn.textContent = '\u21BB Sync';
            return result;
        }, function(err) {
            els.githubSyncBtn.disabled = false;
            els.githubSyncBtn.textContent = '\u21BB Sync';
            throw err;
        });
    }

    function handleGitHubLogout() {
        sdk.github.logout();
        els.githubInfo.style.display = 'none';
        els.githubAvatar.src = '';
        els.githubUsername.textContent = '';
        showToast('Disconnected from GitHub');
    }

    // --- Settings ---
    function openSettings() {
        var s = sdk.getSettings();
        els.intervalSelect.value = String(s.autoSaveIntervalSeconds);
        els.autoPushToggle.checked = !!s.autoPush;
        showModal(els.settingsModal);
    }

    function handleSaveSettings() {
        sdk.saveSettings({
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
        els.statusDot.className = 'rw-status-dot' + (status !== 'inactive' ? ' rw-' + status : '');
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

    function checkProject() {
        mods.Bridge.callHost('getProjectPath').then(function(projectPath) {
            if (projectPath) {
                var nodePath = cep_node.require('path');
                var nodeFs = cep_node.require('fs');
                var dir = nodePath.dirname(nodePath.normalize(projectPath));
                if (nodeFs.existsSync(nodePath.join(dir, '.rewind')) || nodeFs.existsSync(nodePath.join(dir, '.ppgit'))) {
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

    // --- Public API ---
    function mount(container, sdkInstance, modules) {
        sdk = sdkInstance;
        mods = modules;
        container.innerHTML = TEMPLATE;
        rootEl = container.querySelector('.rewind-root');
        cacheElements();
        bindEvents();
        listenToSDK();
        checkGitHub();
        checkProject();
    }

    function unmount() {
        if (savedTimer) clearInterval(savedTimer);
        if (toastTimer) clearTimeout(toastTimer);
        if (sdkListener && sdk) {
            sdk.off(sdkListener);
            sdkListener = null;
        }
        if (rootEl && rootEl.parentNode) {
            rootEl.parentNode.removeChild(rootEl);
        }
        rootEl = null;
        els = {};
        sdk = null;
        mods = null;
    }

    return {
        mount: mount,
        unmount: unmount
    };
})();
