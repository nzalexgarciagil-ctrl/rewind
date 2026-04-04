// sdk/core/diff-engine.js - Human-readable diff summaries for .prproj XML (SDK version)
// Stateless module, no external dependencies

var RewindDiffEngine = (function() {
    'use strict';

    function normalize(xml) {
        return xml
            .replace(/<ModifiedTime>[^<]*<\/ModifiedTime>/g, '')
            .replace(/<CreateTime>[^<]*<\/CreateTime>/g, '')
            .replace(/<MZ\.Sequence\.EditInProgress>[^<]*<\/MZ\.Sequence\.EditInProgress>/g, '')
            .replace(/<CacheFilePath>[^<]*<\/CacheFilePath>/g, '')
            .replace(/<PeakFilePath>[^<]*<\/PeakFilePath>/g, '')
            .replace(/<RenderFilePath>[^<]*<\/RenderFilePath>/g, '')
            .replace(/<PreviewRenderFilePath>[^<]*<\/PreviewRenderFilePath>/g, '')
            .replace(/<FrameBlendHash>[^<]*<\/FrameBlendHash>/g, '')
            .replace(/\s+SaveVersion="[^"]*"/g, '')
            .replace(/\s+ModifiedInVersion="[^"]*"/g, '')
            .replace(/\n\s*\n\s*\n/g, '\n\n');
    }

    function extractSequences(xml) {
        var sequences = [];
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

        if (sequences.length === 0) {
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

    function simpleHash(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            var char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash;
    }

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

    function compare(xmlOld, xmlNew) {
        var normOld = normalize(xmlOld);
        var normNew = normalize(xmlNew);

        if (normOld === normNew) {
            return {
                totalChanges: 0,
                sequences: [],
                projectSettings: { changed: false, count: 0 },
                summary: 'No meaningful changes detected'
            };
        }

        var seqsOld = extractSequences(normOld);
        var seqsNew = extractSequences(normNew);

        var oldByName = {};
        seqsOld.forEach(function(s) { oldByName[s.name] = s; });
        var newByName = {};
        seqsNew.forEach(function(s) { newByName[s.name] = s; });

        var sequenceResults = [];
        var totalChanges = 0;

        seqsOld.forEach(function(oldSeq) {
            var newSeq = newByName[oldSeq.name];
            if (!newSeq) {
                sequenceResults.push({ name: oldSeq.name, status: 'removed', changes: 0 });
                totalChanges++;
            } else if (oldSeq.hash !== newSeq.hash) {
                var changeCount = lineDiffCount(oldSeq.content, newSeq.content);
                sequenceResults.push({ name: oldSeq.name, status: 'modified', changes: changeCount });
                totalChanges += changeCount;
            }
        });

        seqsNew.forEach(function(newSeq) {
            if (!oldByName[newSeq.name]) {
                sequenceResults.push({ name: newSeq.name, status: 'added', changes: 0 });
                totalChanges++;
            }
        });

        var projOld = normOld;
        var projNew = normNew;
        seqsOld.forEach(function(s) { projOld = projOld.replace(s.content, ''); });
        seqsNew.forEach(function(s) { projNew = projNew.replace(s.content, ''); });
        var projChanges = lineDiffCount(projOld, projNew);
        totalChanges += projChanges;

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

    return {
        normalize: normalize,
        compare: compare,
        extractSequences: extractSequences
    };
})();
