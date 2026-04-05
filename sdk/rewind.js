// rewind.js - Rewind SDK entry point
// Include this single file to add version control to any Premiere Pro CEP extension.
//
// Usage:
//   <script src="rewind-sdk/rewind.js"></script>
//   <script>
//     var rewind = RewindSDK.init({ autoSaveInterval: 60 });
//     // Or mount the full UI:
//     RewindSDK.mountUI('#my-panel');
//   </script>

(function() {
    'use strict';

    if (typeof cep_node === 'undefined') {
        throw new Error(
            'Rewind SDK requires Adobe CEP with Node.js enabled. ' +
            'Add --enable-nodejs and --mixed-context to your manifest.xml CEFCommandLine.'
        );
    }
    if (typeof CSInterface === 'undefined') {
        throw new Error(
            'Rewind SDK requires CSInterface.js to be loaded first. ' +
            'Add <script src="path/to/CSInterface.js"></script> before rewind.js.'
        );
    }

    // BUILD_STRIP_START
    // Resolve SDK root path (directory containing this script)
    var sdkRoot = (function() {
        var scripts = document.getElementsByTagName('script');
        for (var i = scripts.length - 1; i >= 0; i--) {
            var src = scripts[i].src || '';
            if (src.indexOf('rewind.js') !== -1) {
                // Handle both file:// and relative paths
                var path = src.replace(/\/rewind\.js(\?.*)?$/, '');
                // Convert file:// URL to filesystem path for cep_node
                if (path.indexOf('file:///') === 0) {
                    path = path.replace('file:///', '');
                    // On Windows: file:///C:/... -> C:/...
                    // On Mac: file:///Users/... -> /Users/...
                    if (path.charAt(0) !== '/' && path.charAt(1) !== ':') {
                        path = '/' + path;
                    }
                }
                return path;
            }
        }
        return '.';
    })();
    // BUILD_STRIP_END

    // Load SDK sub-modules synchronously via cep_node
    var fs = cep_node.require('fs');
    var nodePath = cep_node.require('path');

    // BUILD_STRIP_START
    function loadModule(relativePath) {
        var fullPath = nodePath.join(sdkRoot, relativePath);
        var code = fs.readFileSync(fullPath, 'utf8');
        // Execute in global scope so the module var is accessible
        var script = document.createElement('script');
        script.textContent = code;
        document.head.appendChild(script);
        document.head.removeChild(script);
    }

    // Load core modules in dependency order
    loadModule('core/bridge.js');
    loadModule('core/prproj-handler.js');
    loadModule('core/git-manager.js');
    loadModule('core/github-manager.js');
    loadModule('core/diff-engine.js');
    loadModule('core/version-controller.js');
    // BUILD_STRIP_END

    // --- SDK Facade ---

    var instance = null;
    var modules = null;

    /**
     * Initialize the Rewind SDK.
     *
     * @param {object} config
     * @param {number} [config.autoSaveInterval=60] - Auto-save interval in seconds (0 to disable)
     * @param {boolean} [config.autoPush=false] - Auto-push to GitHub after snapshots
     * @param {string} [config.gitPath='git'] - Custom git executable path
     * @param {string} [config.vcDirName='.rewind'] - Custom version control directory name
     * @param {string} [config.hostFunctionName='handleMessage'] - ExtendScript host function name
     * @param {CSInterface} [config.csInterface] - CSInterface instance (auto-created if omitted)
     * @param {function} [config.onEvent] - Event callback: function(eventName, data)
     * @returns {object} Rewind SDK instance
     */
    function init(config) {
        config = config || {};

        if (instance) {
            console.warn('rewind: RewindSDK.init() called again. Destroying previous instance.');
            instance.destroy();
        }

        // Create CSInterface (user can pass their own)
        var cs = config.csInterface || new CSInterface();

        // Wire up modules via dependency injection
        var bridge = RewindBridge.create(cs, {
            hostFunctionName: config.hostFunctionName
        });

        var gitManager = RewindGitManager.create({
            gitPath: config.gitPath
        });

        var githubManager = RewindGitHubManager.create(gitManager);

        var versionController = RewindVersionController.create({
            Bridge: bridge,
            GitManager: gitManager,
            GitHubManager: githubManager,
            PrprojHandler: RewindPrprojHandler,
            DiffEngine: RewindDiffEngine,
            vcDirName: config.vcDirName
        });

        // Apply config overrides
        if (config.autoSaveInterval !== undefined || config.autoPush !== undefined) {
            var settingsOverride = {};
            if (config.autoSaveInterval !== undefined) {
                settingsOverride.autoSaveIntervalSeconds = config.autoSaveInterval;
            }
            if (config.autoPush !== undefined) {
                settingsOverride.autoPush = config.autoPush;
            }
            // These will be applied after initialize() loads existing settings
            versionController.on(function(event) {
                if (event === 'initialized') {
                    versionController.saveSettings(settingsOverride);
                }
            });
        }

        // Wire up user's event callback
        if (typeof config.onEvent === 'function') {
            versionController.on(config.onEvent);
        }

        modules = {
            Bridge: bridge,
            GitManager: gitManager,
            GitHubManager: githubManager,
            PrprojHandler: RewindPrprojHandler,
            DiffEngine: RewindDiffEngine,
            VersionController: versionController
        };

        // Build the public instance
        instance = {
            // --- Lifecycle ---
            /** Start tracking the current project */
            start: function() {
                return versionController.initialize();
            },
            /** Stop tracking and clean up timers */
            destroy: function() {
                versionController.destroy();
                instance._destroyed = true;
                instance = null;
                modules = null;
            },

            // --- Snapshots ---
            /** Create a manual snapshot with optional label */
            snapshot: function(message) {
                return versionController.snapshot(message);
            },
            /** Restore project to a previous snapshot */
            restore: function(commitHash) {
                return versionController.restore(commitHash);
            },
            /** Get snapshot history */
            getHistory: function(count) {
                return versionController.getHistory(count);
            },

            // --- Versions (Branches) ---
            /** Create a new named version from current state */
            createVersion: function(name) {
                return versionController.createVersion(name);
            },
            /** Switch to a different version */
            switchVersion: function(branch) {
                return versionController.switchVersion(branch);
            },
            /** List all versions */
            listVersions: function() {
                return versionController.listVersions();
            },
            /** Delete a version */
            deleteVersion: function(branch) {
                return versionController.deleteVersion(branch);
            },
            /** Get the current version info */
            getCurrentVersion: function() {
                return versionController.getCurrentVersion();
            },

            // --- Labels ---
            /** Add or update a label on a snapshot */
            addLabel: function(hash, label) {
                return versionController.addLabel(hash, label);
            },
            /** Get all labels */
            getLabels: function() {
                return versionController.getLabels();
            },

            // --- Diffs ---
            /** Compare two snapshots */
            getDiff: function(hashA, hashB) {
                return versionController.getDiff(hashA, hashB);
            },

            // --- Settings ---
            /** Get current settings */
            getSettings: function() {
                return versionController.getSettings();
            },
            /** Update settings */
            saveSettings: function(settings) {
                return versionController.saveSettings(settings);
            },

            // --- State ---
            /** Get current tracking state */
            getState: function() {
                return versionController.getState();
            },
            /** Check if current project has tracking initialized */
            isTracked: function() {
                return versionController.isTracked();
            },
            /** Get the .rewind repo path */
            getRepoPath: function() {
                return versionController.getRepoPath();
            },

            // --- Events ---
            /**
             * Listen for events.
             * Events: initialized, snapshot, auto-snapshot, restored, busy,
             *         project-closed, project-switched, version-created,
             *         version-switched, version-deleted, labels-changed,
             *         settings-changed
             */
            on: function(callback) {
                return versionController.on(callback);
            },
            off: function(callback) {
                return versionController.off(callback);
            },

            // --- GitHub ---
            github: {
                /** Authenticate with a GitHub personal access token */
                authenticate: function(token) {
                    return githubManager.authenticate(token);
                },
                /** Check if authenticated */
                isAuthenticated: function() {
                    return githubManager.isAuthenticated();
                },
                /** Get authenticated user info */
                getUser: function() {
                    return githubManager.getUser();
                },
                /** Disconnect from GitHub */
                logout: function() {
                    return githubManager.logout();
                },
                /** Push to GitHub */
                push: function() {
                    var repoPath = versionController.getRepoPath();
                    if (!repoPath) return Promise.reject(new Error('No project tracked'));
                    return githubManager.push(repoPath);
                },
                /** Pull from GitHub */
                pull: function() {
                    var repoPath = versionController.getRepoPath();
                    if (!repoPath) return Promise.reject(new Error('No project tracked'));
                    return githubManager.pull(repoPath);
                },
                /** Sync (pull then push) */
                sync: function() {
                    var repoPath = versionController.getRepoPath();
                    if (!repoPath) return Promise.reject(new Error('No project tracked'));
                    return githubManager.sync(repoPath);
                },
                /** Set up GitHub remote for current project */
                setupRemote: function(projectName) {
                    var repoPath = versionController.getRepoPath();
                    if (!repoPath) return Promise.reject(new Error('No project tracked'));
                    return githubManager.getOrCreateRepo(projectName).then(function(repo) {
                        var token = githubManager.getToken();
                        return githubManager.setupRemote(repoPath, repo.url, token);
                    });
                }
            },

            // --- Advanced: direct module access ---
            modules: modules
        };

        return instance;
    }

    /**
     * Mount the built-in Rewind UI into a container element.
     * Requires rewind-ui.js and rewind-ui.css to be loaded.
     *
     * @param {string} selector - CSS selector for the container element
     * @param {object} [config] - SDK config (passed to init() if not already initialized)
     * @returns {object} Rewind SDK instance
     */
    function mountUI(selector, config) {
        if (!instance) {
            init(config);
        }

        // Load UI module if not already loaded
        if (typeof RewindUI === 'undefined') {
            // Try to load from the SDK directory
            if (typeof sdkRoot !== 'undefined') {
                loadModule('ui/rewind-ui.js');
            } else {
                throw new Error(
                    'RewindUI not loaded. When using the core-only bundle, ' +
                    'include rewind-with-ui.js instead, or load rewind-ui.js separately.'
                );
            }
        }

        // Load UI styles
        var styleId = 'rewind-sdk-styles';
        if (!document.getElementById(styleId)) {
            var cssLoaded = false;
            if (typeof sdkRoot !== 'undefined') {
                var cssPath = nodePath.join(sdkRoot, 'ui', 'rewind-ui.css');
                if (fs.existsSync(cssPath)) {
                    var css = fs.readFileSync(cssPath, 'utf8');
                    var style = document.createElement('style');
                    style.id = styleId;
                    style.textContent = css;
                    document.head.appendChild(style);
                    cssLoaded = true;
                }
            }
            if (!cssLoaded) {
                console.warn('rewind: UI styles not auto-loaded. Include rewind-ui.css manually.');
            }
        }

        var container = document.querySelector(selector);
        if (!container) {
            throw new Error('RewindSDK.mountUI: container not found: ' + selector);
        }

        RewindUI.mount(container, instance, modules);
        return instance;
    }

    /**
     * Unmount the Rewind UI.
     */
    function unmountUI() {
        if (typeof RewindUI !== 'undefined') {
            RewindUI.unmount();
        }
    }

    // --- Expose global API ---
    window.RewindSDK = {
        init: init,
        mountUI: mountUI,
        unmountUI: unmountUI,
        /** Get the current SDK instance (null if not initialized) */
        getInstance: function() { return instance; },
        /** SDK version */
        version: '1.0.0'
    };
})();
