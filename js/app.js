// app.js - UI controller

(function() {
    'use strict';

    // DOM references
    var els = {};
    var historyItems = [];
    var historyOffset = 0;
    var PAGE_SIZE = 20;
    var toastTimer = null;

    function init() {
        // Initialize debug console first so all subsequent logs are captured
        if (window.DebugConsole) {
            DebugConsole.initialize();
        }
        console.log('Ace Version Control: panel loaded');
        cacheElements();
        bindEvents();
        listenToVC();
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
        els.autoSaveToggle = document.getElementById('auto-save-toggle');
        els.intervalSelect = document.getElementById('interval-select');
        els.maxSnapshotsSelect = document.getElementById('max-snapshots-select');
        els.settingsSave = document.getElementById('settings-save');
        els.settingsCancel = document.getElementById('settings-cancel');
        els.toast = document.getElementById('toast');
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

        // Close modals on overlay click
        [els.settingsModal, els.confirmModal].forEach(function(modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === modal) hideModal(modal);
            });
        });
    }

    function listenToVC() {
        VersionController.on(function(event, data) {
            switch (event) {
                case 'initialized':
                    showMainPanel();
                    setStatus('active');
                    showProjectPath(data.projectPath);
                    refreshHistory();
                    showToast('Tracking initialized', 'success');
                    break;
                case 'snapshot':
                case 'auto-snapshot':
                    refreshHistory();
                    if (event === 'auto-snapshot') {
                        showToast('Auto-snapshot saved');
                    }
                    break;
                case 'restored':
                    refreshHistory();
                    showToast('Restored to ' + data.hash.substring(0, 7), 'success');
                    break;
                case 'busy':
                    setStatus(data ? 'busy' : 'active');
                    els.snapshotBtn.disabled = !!data;
                    break;
                case 'project-closed':
                    showInitPanel();
                    setStatus('inactive');
                    els.projectInfo.textContent = '';
                    break;
                case 'project-switched':
                    showToast('Project switched, re-initializing...');
                    break;
                case 'settings-changed':
                    break;
            }
        });
    }

    function checkProject() {
        Bridge.callHost('getProjectPath').then(function(projectPath) {
            if (projectPath) {
                // Check if already tracked
                var path = cep_node.require('path');
                var fs = cep_node.require('fs');
                var dir = path.dirname(projectPath.replace(/\//g, '\\'));
                if (fs.existsSync(path.join(dir, '.ace-vc'))) {
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

    function handleInit() {
        els.initBtn.disabled = true;
        els.initBtn.textContent = 'Initializing...';
        setStatus('busy');
        VersionController.initialize().catch(function(err) {
            showToast('Init failed: ' + err.message, 'error');
            setStatus('inactive');
            els.initBtn.disabled = false;
            els.initBtn.textContent = 'Start Tracking';
        });
    }

    function handleSnapshot() {
        var msg = els.snapshotInput.value.trim();
        els.snapshotBtn.disabled = true;
        VersionController.snapshot(msg || undefined).then(function(committed) {
            els.snapshotInput.value = '';
            if (committed) {
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
        els.confirmText.textContent = 'Current state will be saved first. Restore to this snapshot?';
        showModal(els.confirmModal);

        // One-time handler
        var handler = function() {
            els.confirmYes.removeEventListener('click', handler);
            hideModal(els.confirmModal);
            VersionController.restore(commitHash).catch(function(err) {
                showToast('Restore failed: ' + err.message, 'error');
            });
        };
        els.confirmYes.addEventListener('click', handler);
    }

    function refreshHistory() {
        historyOffset = 0;
        VersionController.getHistory(PAGE_SIZE + 1).then(function(commits) {
            historyItems = commits;
            renderTimeline(commits.slice(0, PAGE_SIZE));
            els.loadMore.style.display = commits.length > PAGE_SIZE ? 'block' : 'none';
        });
    }

    function loadMoreHistory() {
        historyOffset += PAGE_SIZE;
        VersionController.getHistory(historyOffset + PAGE_SIZE + 1).then(function(commits) {
            historyItems = commits;
            renderTimeline(commits.slice(0, historyOffset + PAGE_SIZE));
            els.loadMore.style.display = commits.length > historyOffset + PAGE_SIZE ? 'block' : 'none';
        });
    }

    function renderTimeline(commits) {
        els.timeline.innerHTML = '';
        if (commits.length === 0) {
            els.emptyState.style.display = 'block';
            return;
        }
        els.emptyState.style.display = 'none';

        commits.forEach(function(commit, i) {
            var item = document.createElement('div');
            item.className = 'commit-item';

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

            var info = document.createElement('div');
            info.className = 'commit-info';
            var msg = document.createElement('div');
            msg.className = 'commit-message';
            msg.textContent = commit.message;
            msg.title = commit.message;
            var meta = document.createElement('div');
            meta.className = 'commit-meta';
            meta.innerHTML = '<span class="commit-hash">' + escapeHtml(commit.hash.substring(0, 7)) + '</span> &middot; ' + escapeHtml(commit.dateRelative);
            info.appendChild(msg);
            info.appendChild(meta);

            var actions = document.createElement('div');
            actions.className = 'commit-actions';
            if (i > 0) { // Don't show restore for the latest commit
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

    // Settings
    function openSettings() {
        var s = VersionController.getSettings();
        els.autoSaveToggle.checked = s.autoSnapshotOnSave;
        els.intervalSelect.value = String(s.autoIntervalMinutes);
        els.maxSnapshotsSelect.value = String(s.maxSnapshots);
        showModal(els.settingsModal);
    }

    function handleSaveSettings() {
        VersionController.saveSettings({
            autoSnapshotOnSave: els.autoSaveToggle.checked,
            autoIntervalMinutes: parseInt(els.intervalSelect.value, 10),
            maxSnapshots: parseInt(els.maxSnapshotsSelect.value, 10)
        });
        hideModal(els.settingsModal);
        showToast('Settings saved', 'success');
    }

    // UI helpers
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
        // Force reflow
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
