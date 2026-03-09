// host.jsx - ppgit ExtendScript backend for Premiere Pro (ES3)
// Commands: getProjectPath, saveProject, closeAndReopenProject

// JSON polyfill (Crockford with 4th replace fix)
if (typeof JSON !== "object") {
    JSON = {};
}
(function () {
    var cx = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
    var escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
    var gap, indent, meta, rep;

    meta = {
        "\b": "\\b",
        "\t": "\\t",
        "\n": "\\n",
        "\f": "\\f",
        "\r": "\\r",
        '"': '\\"',
        "\\": "\\\\"
    };

    function quote(string) {
        escapable.lastIndex = 0;
        return escapable.test(string)
            ? '"' + string.replace(escapable, function (a) {
                var c = meta[a];
                return typeof c === "string" ? c
                    : "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
            }) + '"'
            : '"' + string + '"';
    }

    function str(key, holder) {
        var i, k, v, length, partial;
        var mind = gap;
        var value = holder[key];

        if (value && typeof value === "object" && typeof value.toJSON === "function") {
            value = value.toJSON(key);
        }
        if (typeof rep === "function") {
            value = rep.call(holder, key, value);
        }

        switch (typeof value) {
            case "string":
                return quote(value);
            case "number":
                return isFinite(value) ? String(value) : "null";
            case "boolean":
            case "null":
                return String(value);
            case "object":
                if (!value) return "null";
                gap += indent;
                partial = [];
                if (Object.prototype.toString.apply(value) === "[object Array]") {
                    length = value.length;
                    for (i = 0; i < length; i += 1) {
                        partial[i] = str(i, value) || "null";
                    }
                    v = partial.length === 0
                        ? "[]"
                        : gap
                            ? "[\n" + gap + partial.join(",\n" + gap) + "\n" + mind + "]"
                            : "[" + partial.join(",") + "]";
                    gap = mind;
                    return v;
                }
                if (rep && typeof rep === "object") {
                    length = rep.length;
                    for (i = 0; i < length; i += 1) {
                        if (typeof rep[i] === "string") {
                            k = rep[i];
                            v = str(k, value);
                            if (v) {
                                partial.push(quote(k) + (gap ? ": " : ":") + v);
                            }
                        }
                    }
                } else {
                    for (k in value) {
                        if (Object.prototype.hasOwnProperty.call(value, k)) {
                            v = str(k, value);
                            if (v) {
                                partial.push(quote(k) + (gap ? ": " : ":") + v);
                            }
                        }
                    }
                }
                v = partial.length === 0
                    ? "{}"
                    : gap
                        ? "{\n" + gap + partial.join(",\n" + gap) + "\n" + mind + "}"
                        : "{" + partial.join(",") + "}";
                gap = mind;
                return v;
        }
    }

    if (typeof JSON.stringify !== "function") {
        JSON.stringify = function (value, replacer, space) {
            var i;
            gap = "";
            indent = "";
            if (typeof space === "number") {
                for (i = 0; i < space; i += 1) {
                    indent += " ";
                }
            } else if (typeof space === "string") {
                indent = space;
            }
            rep = replacer;
            if (replacer && typeof replacer !== "function" &&
                (typeof replacer !== "object" || typeof replacer.length !== "number")) {
                throw new Error("JSON.stringify");
            }
            return str("", { "": value });
        };
    }

    if (typeof JSON.parse !== "function") {
        JSON.parse = function (text, reviver) {
            var j;
            function walk(holder, key) {
                var k, v, val = holder[key];
                if (val && typeof val === "object") {
                    for (k in val) {
                        if (Object.prototype.hasOwnProperty.call(val, k)) {
                            v = walk(val, k);
                            if (v !== undefined) {
                                val[k] = v;
                            } else {
                                delete val[k];
                            }
                        }
                    }
                }
                return reviver.call(holder, key, val);
            }

            text = String(text);
            cx.lastIndex = 0;
            if (cx.test(text)) {
                text = text.replace(cx, function (a) {
                    return "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
                });
            }

            // Crockford's 4 security replaces (including the critical 4th one)
            if (
                /^[\],:{}\s]*$/.test(
                    text
                        .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
                        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
                        .replace(/(?:^|:|,)(?:\s*\[)+/g, "")
                        .replace(/\w*\s*\:/g, ":")
                )
            ) {
                j = eval("(" + text + ")");
                return typeof reviver === "function" ? walk({ "": j }, "") : j;
            }
            throw new SyntaxError("JSON.parse");
        };
    }
}());


function handleMessage(type, dataStr) {
    var result;
    try {
        var data = {};
        if (dataStr && dataStr !== "" && dataStr !== "undefined" && dataStr !== "{}") {
            data = JSON.parse(dataStr);
        }

        switch (type) {
            case "getProjectPath":
                result = getProjectPath();
                break;
            case "isProjectDirty":
                result = isProjectDirty();
                break;
            case "saveProject":
                result = saveProject();
                break;
            case "closeAndReopenProject":
                result = closeAndReopenProject(data);
                break;
            default:
                return JSON.stringify({ error: "Unknown command: " + type });
        }

        return JSON.stringify({ success: true, result: result });
    } catch (e) {
        return JSON.stringify({ error: "ES_ERR: " + e.message });
    }
}


function getProjectPath() {
    if (!app.project || !app.project.path) {
        return "";
    }
    return app.project.path;
}


function isProjectDirty() {
    if (!app.project) {
        return false;
    }
    return app.project.dirty;
}


function saveProject() {
    if (!app.project) {
        throw new Error("No project open");
    }
    app.project.save();
    return "saved";
}


function closeAndReopenProject(data) {
    var projectPath = data.path;
    if (!projectPath) {
        throw new Error("No path provided");
    }

    // Close current project WITHOUT saving — the restored file is already on disk
    app.project.closeDocument();

    // Open the project from the given path
    app.openDocument(projectPath);

    return "reopened";
}
