(function() {
    'use strict';

    var CSInterface = function() {};

    CSInterface.prototype.getExtensionId = function() {
        return window.__adobe_cep__.getExtensionId();
    };

    CSInterface.prototype.getHostEnvironment = function() {
        return JSON.parse(window.__adobe_cep__.getHostEnvironment());
    };

    CSInterface.prototype.evalScript = function(script, callback) {
        if (window.__adobe_cep__ && window.__adobe_cep__.evalScript) {
            window.__adobe_cep__.evalScript(script, callback);
        } else {
            console.error('CSInterface: evalScript not available');
            if (callback) callback('');
        }
    };

    CSInterface.prototype.getExtensionPath = function() {
        try {
            if (window.__adobe_cep__ && typeof window.__adobe_cep__.getExtensionPath === 'function') {
                return window.__adobe_cep__.getExtensionPath();
            }
            if (window.__adobe_cep__ && typeof window.__adobe_cep__.getSystemPath === 'function') {
                var extPath = window.__adobe_cep__.getSystemPath(SystemPath.EXTENSION);
                if (extPath) return decodeURIComponent(extPath);
            }
        } catch (e) {}
        try {
            var href = window.location && window.location.href ? window.location.href : '';
            if (href.indexOf('file://') === 0) href = href.substring(7);
            if (href) {
                href = decodeURIComponent(href);
                var q = href.indexOf('?');
                if (q !== -1) href = href.substring(0, q);
                var h = href.indexOf('#');
                if (h !== -1) href = href.substring(0, h);
                var lastSlash = href.lastIndexOf('/');
                if (lastSlash !== -1) href = href.substring(0, lastSlash);
                if (href.length > 2 && href.charAt(0) === '/' && href.charAt(2) === ':') {
                    href = href.substring(1);
                }
                return href;
            }
        } catch (e2) {}
        return '';
    };

    CSInterface.prototype.getSystemPath = function(pathType) {
        var result = window.__adobe_cep__.getSystemPath(pathType);
        return decodeURIComponent(result);
    };

    CSInterface.prototype.addEventListener = function(type, listener) {
        if (window.__adobe_cep__ && window.__adobe_cep__.addEventListener) {
            window.__adobe_cep__.addEventListener(type, listener);
        }
    };

    CSInterface.prototype.removeEventListener = function(type, listener) {
        if (window.__adobe_cep__ && window.__adobe_cep__.removeEventListener) {
            window.__adobe_cep__.removeEventListener(type, listener);
        }
    };

    CSInterface.prototype.closeExtension = function() {
        if (window.__adobe_cep__ && window.__adobe_cep__.closeExtension) {
            window.__adobe_cep__.closeExtension();
        }
    };

    var SystemPath = {
        USER_DATA: 'userData',
        COMMON_FILES: 'commonFiles',
        MY_DOCUMENTS: 'myDocuments',
        APPLICATION: 'application',
        EXTENSION: 'extension',
        HOST_APPLICATION: 'hostApplication'
    };

    window.CSInterface = CSInterface;
    window.SystemPath = SystemPath;
})();
