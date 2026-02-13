// debug-console.js - In-panel debug console with log interception

(function() {
    'use strict';

    var consoleContainer = null;
    var logContainer = null;
    var toggleBtn = null;
    var isVisible = false;
    var MAX_ENTRIES = 500;

    function initialize() {
        startLogListener();
        createConsoleUI();
        addLogEntry('info', ['Debug Console initialized']);
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
            addLogEntry('log', Array.from(arguments));
        };
        console.error = function() {
            window._originalConsole.error.apply(console, arguments);
            addLogEntry('error', Array.from(arguments));
        };
        console.warn = function() {
            window._originalConsole.warn.apply(console, arguments);
            addLogEntry('warn', Array.from(arguments));
        };
        console.info = function() {
            window._originalConsole.info.apply(console, arguments);
            addLogEntry('info', Array.from(arguments));
        };
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

        var clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', clear);

        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', hide);

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

        var entry = document.createElement('div');
        entry.className = 'debug-log-entry debug-log-' + level;

        var timestamp = document.createElement('span');
        timestamp.className = 'debug-log-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString();

        var content = document.createElement('span');
        content.className = 'debug-log-content';

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
    }

    window.DebugConsole = {
        initialize: initialize,
        toggle: toggle,
        show: show,
        hide: hide,
        clear: clear
    };
})();
