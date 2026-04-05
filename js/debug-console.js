// debug-console.js - In-panel debug console with log interception + file logging

(function() {
    'use strict';

    var fs = cep_node.require('fs');
    var path = cep_node.require('path');
    var os = cep_node.require('os');

    var consoleContainer = null;
    var logContainer = null;
    var toggleBtn = null;
    var isVisible = false;
    var MAX_ENTRIES = 500;
    var logBuffer = []; // Keep text copies for copy-to-clipboard

    // Persistent log file in ~/.rewind/debug.log
    var LOG_DIR = path.join(os.homedir(), '.rewind');
    var LOG_FILE = path.join(LOG_DIR, 'debug.log');
    var MAX_LOG_SIZE = 512 * 1024; // 512KB max, then rotate

    function initLogFile() {
        try {
            if (!fs.existsSync(LOG_DIR)) {
                fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
            }
            // Rotate if too big
            if (fs.existsSync(LOG_FILE)) {
                var stat = fs.statSync(LOG_FILE);
                if (stat.size > MAX_LOG_SIZE) {
                    var oldFile = LOG_FILE + '.old';
                    try { fs.unlinkSync(oldFile); } catch (e) {}
                    fs.renameSync(LOG_FILE, oldFile);
                }
            }
            // Write session header with restricted permissions
            var header = '\n=== Rewind session ' + new Date().toISOString() + ' ===\n';
            fs.appendFileSync(LOG_FILE, header, { mode: 0o600 });
        } catch (e) {
            // Silently fail — file logging is best-effort
        }
    }

    function writeToFile(line) {
        try {
            fs.appendFileSync(LOG_FILE, line + '\n');
        } catch (e) {}
    }

    function initialize() {
        initLogFile();
        startLogListener();
        createConsoleUI();
        addLogEntry('info', ['Rewind debug console ready']);
    }

    /**
     * Intercept all console methods BEFORE anything else logs
     */
    function startLogListener() {
        if (!window._originalConsole) {
            window._originalConsole = {
                log: console.log,
                error: console.error,
                warn: console.warn,
                info: console.info
            };
        }

        console.log = function() {
            window._originalConsole.log.apply(console, arguments);
            addLogEntry('log', toArray(arguments));
        };
        console.error = function() {
            window._originalConsole.error.apply(console, arguments);
            addLogEntry('error', toArray(arguments));
        };
        console.warn = function() {
            window._originalConsole.warn.apply(console, arguments);
            addLogEntry('warn', toArray(arguments));
        };
        console.info = function() {
            window._originalConsole.info.apply(console, arguments);
            addLogEntry('info', toArray(arguments));
        };
    }

    // Array.from fallback for older CEP Chromium
    function toArray(args) {
        var arr = [];
        for (var i = 0; i < args.length; i++) arr.push(args[i]);
        return arr;
    }

    /**
     * Build the debug console DOM
     */
    function createConsoleUI() {
        // Toggle button in header
        toggleBtn = document.createElement('button');
        toggleBtn.id = 'debug-toggle';
        toggleBtn.className = 'icon-btn debug-console-toggle';
        toggleBtn.title = 'Debug Console (Ctrl+Shift+D)';
        toggleBtn.innerHTML = '&#128270;'; // magnifying glass
        toggleBtn.addEventListener('click', toggle);

        var headerActions = document.querySelector('.header-actions');
        if (headerActions) {
            headerActions.insertBefore(toggleBtn, headerActions.firstChild);
        }

        // Console container
        consoleContainer = document.createElement('div');
        consoleContainer.id = 'debug-console';
        consoleContainer.className = 'debug-console hidden';

        // Header bar
        var header = document.createElement('div');
        header.className = 'debug-console-header';

        var title = document.createElement('span');
        title.textContent = 'Debug Console';

        var btns = document.createElement('div');
        btns.className = 'debug-console-btns';

        var copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy All';
        copyBtn.addEventListener('click', copyAll);

        var clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', clear);

        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', hide);

        btns.appendChild(copyBtn);
        btns.appendChild(clearBtn);
        btns.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(btns);

        // Log container
        logContainer = document.createElement('div');
        logContainer.className = 'debug-console-logs';

        consoleContainer.appendChild(header);
        consoleContainer.appendChild(logContainer);
        document.body.appendChild(consoleContainer);

        // Keyboard shortcut: Ctrl+Shift+D
        document.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                toggle();
            }
        });
    }

    /**
     * Add a log entry to the console
     */
    function addLogEntry(level, args) {
        if (!logContainer) return;

        var now = new Date();
        var timeStr = now.toLocaleTimeString();

        var text = args.map(function(arg) {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        // Store in buffer for copy + write to file
        var logLine = '[' + timeStr + '] [' + level.toUpperCase() + '] ' + text;
        logBuffer.push(logLine);
        if (logBuffer.length > MAX_ENTRIES) logBuffer.shift();
        writeToFile(logLine);

        var entry = document.createElement('div');
        entry.className = 'debug-log-entry debug-log-' + level;

        var timestamp = document.createElement('span');
        timestamp.className = 'debug-log-timestamp';
        timestamp.textContent = timeStr;

        var content = document.createElement('span');
        content.className = 'debug-log-content';
        content.textContent = text;

        entry.appendChild(timestamp);
        entry.appendChild(content);
        logContainer.appendChild(entry);

        // Auto-scroll
        logContainer.scrollTop = logContainer.scrollHeight;

        // Cap entries
        var entries = logContainer.querySelectorAll('.debug-log-entry');
        if (entries.length > MAX_ENTRIES) {
            entries[0].remove();
        }
    }

    function copyAll() {
        var text = logBuffer.join('\n');
        if (!text) {
            text = '(no logs)';
        }
        // Try clipboard API, fall back to textarea hack
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                flashCopyFeedback();
            }).catch(function() {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            flashCopyFeedback();
        } catch (e) {
            window._originalConsole.error('Copy failed:', e);
        }
        document.body.removeChild(ta);
    }

    function flashCopyFeedback() {
        var btns = consoleContainer.querySelectorAll('.debug-console-btns button');
        if (btns[0]) {
            var original = btns[0].textContent;
            btns[0].textContent = 'Copied!';
            setTimeout(function() { btns[0].textContent = original; }, 1500);
        }
    }

    function toggle() {
        isVisible ? hide() : show();
    }

    function show() {
        isVisible = true;
        if (consoleContainer) consoleContainer.classList.remove('hidden');
    }

    function hide() {
        isVisible = false;
        if (consoleContainer) consoleContainer.classList.add('hidden');
    }

    function clear() {
        if (logContainer) logContainer.innerHTML = '';
        logBuffer.length = 0;
    }

    window.DebugConsole = {
        initialize: initialize,
        toggle: toggle,
        show: show,
        hide: hide,
        clear: clear
    };
})();
