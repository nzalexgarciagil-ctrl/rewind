// sdk/core/bridge.js - JS <-> ExtendScript communication bridge (SDK version)
// Factory: accepts CSInterface instance, returns Bridge API

var RewindBridge = (function() {
    'use strict';

    function create(csInterface, options) {
        var cs = csInterface;
        var hostFnName = (options && options.hostFunctionName) || 'RewindHost_handleMessage';

        var ALLOWED_COMMANDS = {
            getProjectPath: true,
            saveProject: true,
            closeProject: true,
            openProject: true,
            closeAndReopenProject: true
        };

        function callHost(type, data) {
            return new Promise(function(resolve, reject) {
                if (!ALLOWED_COMMANDS[type]) {
                    reject(new Error('Unknown command: ' + type));
                    return;
                }

                var dataStr = data ? JSON.stringify(data) : '{}';
                dataStr = dataStr
                    .replace(/\\/g, '\\\\')
                    .replace(/'/g, "\\'")
                    .replace(/"/g, '\\"')
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r')
                    .replace(/\t/g, '\\t');

                var script = hostFnName + "('" + type + "', \"" + dataStr + "\")";

                cs.evalScript(script, function(response) {
                    if (!response || response === 'undefined' || response === 'null' || response === 'EvalScript error.') {
                        var hint = '';
                        if (response === 'EvalScript error.') {
                            hint = ' Check that rewind-host.jsx is configured as your ScriptPath in manifest.xml.';
                        }
                        reject(new Error('ExtendScript call failed for "' + type + '".' + hint));
                        return;
                    }
                    try {
                        var parsed = JSON.parse(response);
                        if (parsed.error) {
                            reject(new Error(parsed.error));
                        } else {
                            resolve(parsed.result);
                        }
                    } catch (e) {
                        resolve(response);
                    }
                });
            });
        }

        return {
            callHost: callHost,
            cs: cs
        };
    }

    return { create: create };
})();
