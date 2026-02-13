// bridge.js - JS <-> ExtendScript communication bridge

(function() {
    'use strict';

    var cs = new CSInterface();

    /**
     * Call an ExtendScript function via the bridge.
     * @param {string} type - Command name
     * @param {object} [data] - Data to pass
     * @returns {Promise<*>} Resolved with the result
     */
    function callHost(type, data) {
        return new Promise(function(resolve, reject) {
            var dataStr = data ? JSON.stringify(data) : '{}';
            // Escape for ExtendScript string literal
            dataStr = dataStr.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');

            var script = "handleMessage('" + type + "', \"" + dataStr + "\")";

            cs.evalScript(script, function(response) {
                if (!response || response === 'undefined' || response === 'null' || response === 'EvalScript error.') {
                    reject(new Error('ExtendScript returned no result for: ' + type));
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
                    // Non-JSON response, return raw
                    resolve(response);
                }
            });
        });
    }

    window.Bridge = {
        callHost: callHost,
        cs: cs
    };
})();
