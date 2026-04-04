// sdk/core/prproj-handler.js - Decompress/recompress .prproj files (SDK version)
// Stateless module, no dependencies beyond cep_node

var RewindPrprojHandler = (function() {
    'use strict';

    var zlib = cep_node.require('zlib');
    var fs = cep_node.require('fs');

    function decompress(prprojPath) {
        return new Promise(function(resolve, reject) {
            fs.readFile(prprojPath, function(err, buffer) {
                if (err) {
                    reject(new Error('Cannot read prproj: ' + err.message));
                    return;
                }
                try {
                    var xml = zlib.gunzipSync(buffer);
                    resolve(xml.toString('utf8'));
                } catch (e) {
                    var text = buffer.toString('utf8');
                    if (text.indexOf('<?xml') === 0 || text.indexOf('<PremiereData') !== -1) {
                        resolve(text);
                    } else {
                        reject(new Error('Cannot decompress prproj: ' + e.message));
                    }
                }
            });
        });
    }

    function compress(xmlString, outputPath) {
        return new Promise(function(resolve, reject) {
            try {
                var compressed = zlib.gzipSync(Buffer.from(xmlString, 'utf8'));
                fs.writeFile(outputPath, compressed, function(err) {
                    if (err) {
                        reject(new Error('Cannot write prproj: ' + err.message));
                    } else {
                        resolve();
                    }
                });
            } catch (e) {
                reject(new Error('Cannot compress prproj: ' + e.message));
            }
        });
    }

    return {
        decompress: decompress,
        compress: compress
    };
})();
