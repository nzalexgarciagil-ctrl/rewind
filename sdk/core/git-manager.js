// sdk/core/git-manager.js - Git operations via child_process.execFile (SDK version)
// Factory: accepts optional config, returns GitManager API

var RewindGitManager = (function() {
    'use strict';

    var childProcess = cep_node.require('child_process');
    var fs = cep_node.require('fs');

    function create(options) {
        var GIT_EXE = (options && options.gitPath) || 'git';

        function runGit(repoPath, args) {
            return new Promise(function(resolve, reject) {
                childProcess.execFile(GIT_EXE, args, {
                    cwd: repoPath,
                    maxBuffer: 50 * 1024 * 1024,
                    windowsHide: true
                }, function(err, stdout, stderr) {
                    if (err) {
                        var msg = 'git ' + args[0] + ' failed: ' + (stderr || err.message);
                        if (err.code === 'ENOENT') {
                            msg = 'Git not found at "' + GIT_EXE + '". Install Git and ensure it is in your PATH.';
                        }
                        console.error('rewind: ' + msg);
                        reject(new Error(msg));
                    } else {
                        resolve(stdout.trim());
                    }
                });
            });
        }

        function mkdirp(dirPath) {
            return new Promise(function(resolve, reject) {
                fs.mkdir(dirPath, { recursive: true }, function(err) {
                    // Ignore EEXIST for Node < 10.12 where recursive option doesn't exist
                    if (err && err.code !== 'EEXIST') reject(err);
                    else resolve();
                });
            });
        }

        function init(repoPath) {
            console.log('rewind: git init in ' + repoPath);
            return mkdirp(repoPath).then(function() {
                return runGit(repoPath, ['init']);
            }).then(function() {
                return runGit(repoPath, ['config', 'user.email', 'rewind@local']);
            }).then(function() {
                return runGit(repoPath, ['config', 'user.name', 'rewind']);
            });
        }

        function commit(repoPath, message) {
            return runGit(repoPath, ['add', '-A']).then(function() {
                return runGit(repoPath, ['commit', '-m', message || 'Snapshot']);
            }).then(function(output) {
                console.log('rewind: git commit ok — ' + (message || 'Snapshot'));
                return output;
            });
        }

        function log(repoPath, maxCount) {
            var count = maxCount || 50;
            var format = '%H%n%s%n%ai%n%ar';
            return runGit(repoPath, ['log', '--format=' + format, '-n', String(count)]).then(function(output) {
                if (!output) return [];
                var lines = output.split('\n');
                var commits = [];
                for (var i = 0; i + 3 < lines.length; i += 4) {
                    commits.push({
                        hash: lines[i],
                        message: lines[i + 1],
                        date: lines[i + 2],
                        dateRelative: lines[i + 3]
                    });
                }
                return commits;
            }).catch(function() {
                return [];
            });
        }

        function checkout(repoPath, commitHash, filePath) {
            return runGit(repoPath, ['checkout', commitHash, '--', filePath || '.']);
        }

        function diffStat(repoPath, commitHash) {
            return runGit(repoPath, ['diff', '--stat', commitHash]).catch(function() {
                return '';
            });
        }

        function hasChanges(repoPath) {
            return runGit(repoPath, ['status', '--porcelain']).then(function(output) {
                return output.length > 0;
            }).catch(function() {
                return false;
            });
        }

        function getHead(repoPath) {
            return runGit(repoPath, ['rev-parse', 'HEAD']).catch(function() {
                return null;
            });
        }

        function commitCount(repoPath) {
            return runGit(repoPath, ['rev-list', '--count', 'HEAD']).then(function(out) {
                return parseInt(out, 10) || 0;
            }).catch(function() {
                return 0;
            });
        }

        function createBranch(repoPath, branchName) {
            return runGit(repoPath, ['checkout', '-b', branchName]);
        }

        function switchBranch(repoPath, branchName) {
            return runGit(repoPath, ['checkout', branchName]);
        }

        function listBranches(repoPath) {
            return runGit(repoPath, ['branch', '--list']).then(function(output) {
                if (!output) return [];
                return output.split('\n').map(function(line) {
                    var current = line.charAt(0) === '*';
                    var name = line.replace(/^\*?\s+/, '').trim();
                    return { name: name, current: current };
                }).filter(function(b) { return b.name; });
            }).catch(function() {
                return [];
            });
        }

        function getCurrentBranch(repoPath) {
            return runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(function() {
                return 'master';
            });
        }

        function deleteBranch(repoPath, branchName) {
            return runGit(repoPath, ['branch', '-D', branchName]);
        }

        function showFile(repoPath, commitHash, filePath) {
            return runGit(repoPath, ['show', commitHash + ':' + filePath]).catch(function() {
                return null;
            });
        }

        return {
            runGit: runGit,
            init: init,
            commit: commit,
            log: log,
            checkout: checkout,
            diffStat: diffStat,
            hasChanges: hasChanges,
            getHead: getHead,
            commitCount: commitCount,
            createBranch: createBranch,
            switchBranch: switchBranch,
            listBranches: listBranches,
            getCurrentBranch: getCurrentBranch,
            deleteBranch: deleteBranch,
            showFile: showFile
        };
    }

    return { create: create };
})();
