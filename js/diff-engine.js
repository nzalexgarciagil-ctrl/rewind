// diff-engine.js - Human-readable diff summaries for .prproj XML

(function() {
    'use strict';

    /**
     * Normalize .prproj XML by stripping volatile fields that create noise.
     * @param {string} xml - Raw decompressed XML
     * @returns {string} Normalized XML
     */
    function normalize(xml) {
        // Strip modification timestamps (various formats used by PPro)
        var normalized = xml
            // Remove ModifiedTime, CreateTime elements and their values
            .replace(/<ModifiedTime>[^<]*<\/ModifiedTime>/g, '')
            .replace(/<CreateTime>[^<]*<\/CreateTime>/g, '')
            // Remove MZ.Sequence.EditInProgress values
            .replace(/<MZ\.Sequence\.EditInProgress>[^<]*<\/MZ\.Sequence\.EditInProgress>/g, '')
            // Remove cache and render file paths
            .replace(/<CacheFilePath>[^<]*<\/CacheFilePath>/g, '')
            .replace(/<PeakFilePath>[^<]*<\/PeakFilePath>/g, '')
            .replace(/<RenderFilePath>[^<]*<\/RenderFilePath>/g, '')
            .replace(/<PreviewRenderFilePath>[^<]*<\/PreviewRenderFilePath>/g, '')
            // Remove frame render hash/cache entries
            .replace(/<FrameBlendHash>[^<]*<\/FrameBlendHash>/g, '')
            // Remove SaveVersion, ModifiedInVersion attributes
            .replace(/\s+SaveVersion="[^"]*"/g, '')
            .replace(/\s+ModifiedInVersion="[^"]*"/g, '')
            // Normalize whitespace (collapse multiple blank lines)
            .replace(/\n\s*\n\s*\n/g, '\n\n');

        return normalized;
    }

    /**
     * Extract sequence information from .prproj XML
     * @param {string} xml - Normalized XML
     * @returns {Array<{name: string, content: string, hash: number}>}
     */
    function extractSequences(xml) {
        var sequences = [];
        // Premiere Pro stores sequences as nodes with a Sequence element
        var seqRegex = /<Sequence[^>]*>([\s\S]*?)<\/Sequence>/g;
        var match;

        while ((match = seqRegex.exec(xml)) !== null) {
            var seqContent = match[1];
            var nameMatch = seqContent.match(/<Name>([^<]+)<\/Name>/);
            var name = nameMatch ? nameMatch[1] : 'Unnamed Sequence';
            sequences.push({
                name: name,
                content: seqContent,
                hash: simpleHash(seqContent)
            });
        }

        // If no <Sequence> tags found, try alternative patterns
        // PPro might use different element names depending on version
        if (sequences.length === 0) {
            // Fallback: look for VideoTrack patterns as proxy for sequences
            var trackRegex = /<VideoTrack[^>]*>([\s\S]*?)<\/VideoTrack>/g;
            var trackCount = 0;
            while ((match = trackRegex.exec(xml)) !== null) {
                trackCount++;
            }
            if (trackCount > 0) {
                sequences.push({
                    name: 'Timeline',
                    content: xml,
                    hash: simpleHash(xml)
                });
            }
        }

        return sequences;
    }

    /**
     * Simple string hash for quick comparison
     * @param {string} str
     * @returns {number}
     */
    function simpleHash(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            var char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    }

    /**
     * Simple line-based diff count between two strings.
     * Counts lines present in one version but not the other.
     * @param {string} textA
     * @param {string} textB
     * @returns {number}
     */
    function lineDiffCount(textA, textB) {
        var linesA = textA.split('\n');
        var linesB = textB.split('\n');
        var setA = {};
        var setB = {};
        var i;

        for (i = 0; i < linesA.length; i++) {
            var lineA = linesA[i].trim();
            if (lineA) setA[lineA] = (setA[lineA] || 0) + 1;
        }
        for (i = 0; i < linesB.length; i++) {
            var lineB = linesB[i].trim();
            if (lineB) setB[lineB] = (setB[lineB] || 0) + 1;
        }

        var changes = 0;
        var allKeys = {};
        Object.keys(setA).forEach(function(k) { allKeys[k] = true; });
        Object.keys(setB).forEach(function(k) { allKeys[k] = true; });

        Object.keys(allKeys).forEach(function(k) {
            var countA = setA[k] || 0;
            var countB = setB[k] || 0;
            changes += Math.abs(countA - countB);
        });

        return changes;
    }

    /**
     * Compare two .prproj XML strings and produce a human-readable diff summary.
     * @param {string} xmlOld - Older version (normalized or raw)
     * @param {string} xmlNew - Newer version (normalized or raw)
     * @returns {{totalChanges: number, sequences: Array, projectSettings: object, summary: string}}
     */
    function compare(xmlOld, xmlNew) {
        // Normalize both
        var normOld = normalize(xmlOld);
        var normNew = normalize(xmlNew);

        // Quick check: identical after normalization?
        if (normOld === normNew) {
            return {
                totalChanges: 0,
                sequences: [],
                projectSettings: { changed: false, count: 0 },
                summary: 'No meaningful changes detected'
            };
        }

        // Extract sequences from both versions
        var seqsOld = extractSequences(normOld);
        var seqsNew = extractSequences(normNew);

        // Build lookup maps by name
        var oldByName = {};
        seqsOld.forEach(function(s) { oldByName[s.name] = s; });
        var newByName = {};
        seqsNew.forEach(function(s) { newByName[s.name] = s; });

        var sequenceResults = [];
        var totalChanges = 0;

        // Check for modified and removed sequences
        seqsOld.forEach(function(oldSeq) {
            var newSeq = newByName[oldSeq.name];
            if (!newSeq) {
                sequenceResults.push({
                    name: oldSeq.name,
                    status: 'removed',
                    changes: 0
                });
                totalChanges++;
            } else if (oldSeq.hash !== newSeq.hash) {
                var changeCount = lineDiffCount(oldSeq.content, newSeq.content);
                sequenceResults.push({
                    name: oldSeq.name,
                    status: 'modified',
                    changes: changeCount
                });
                totalChanges += changeCount;
            }
        });

        // Check for added sequences
        seqsNew.forEach(function(newSeq) {
            if (!oldByName[newSeq.name]) {
                sequenceResults.push({
                    name: newSeq.name,
                    status: 'added',
                    changes: 0
                });
                totalChanges++;
            }
        });

        // Check project-level changes (everything outside sequences)
        var projOld = normOld;
        var projNew = normNew;
        seqsOld.forEach(function(s) { projOld = projOld.replace(s.content, ''); });
        seqsNew.forEach(function(s) { projNew = projNew.replace(s.content, ''); });
        var projChanges = lineDiffCount(projOld, projNew);
        totalChanges += projChanges;

        // Build summary string
        var summaryParts = [];
        sequenceResults.forEach(function(s) {
            if (s.status === 'modified') {
                summaryParts.push(s.changes + ' changes in "' + s.name + '"');
            } else if (s.status === 'added') {
                summaryParts.push('"' + s.name + '" added');
            } else if (s.status === 'removed') {
                summaryParts.push('"' + s.name + '" removed');
            }
        });
        if (projChanges > 0) {
            summaryParts.push(projChanges + ' project setting changes');
        }
        if (summaryParts.length === 0 && totalChanges === 0) {
            summaryParts.push('No meaningful changes detected');
        } else if (summaryParts.length === 0) {
            summaryParts.push(totalChanges + ' changes detected');
        }

        return {
            totalChanges: totalChanges,
            sequences: sequenceResults,
            projectSettings: { changed: projChanges > 0, count: projChanges },
            summary: summaryParts.join(', ')
        };
    }

    window.DiffEngine = {
        normalize: normalize,
        compare: compare,
        extractSequences: extractSequences
    };
})();
