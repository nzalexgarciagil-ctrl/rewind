// prproj-handler.js - Decompress/recompress .prproj files (gzipped XML)

(function() {
    'use strict';

    var zlib = cep_node.require('zlib');
    var fs = cep_node.require('fs');
    var path = cep_node.require('path');

    /**
     * Decompress a .prproj file to XML string
     * @param {string} prprojPath - Path to the .prproj file
     * @returns {Promise<string>} XML content
     */
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
                    // File might not be gzipped (older/plain XML prproj)
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

    /**
     * Compress XML string back to a .prproj file (gzip)
     * @param {string} xmlString - XML content
     * @param {string} outputPath - Where to write the .prproj
     * @returns {Promise<void>}
     */
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

    window.PrprojHandler = {
        decompress: decompress,
        compress: compress
    };
})();
