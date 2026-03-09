// git-manager.js - Git operations via child_process.execFile (no shell injection)

(function() {
    'use strict';

    var childProcess = cep_node.require('child_process');
    var path = cep_node.require('path');
    var fs = cep_node.require('fs');

    var GIT_EXE = 'git';

    /**
     * Run a git command with execFile (safe, no shell)
     */
    function runGit(repoPath, args) {
        return new Promise(function(resolve, reject) {
            childProcess.execFile(GIT_EXE, args, {
                cwd: repoPath,
                maxBuffer: 10 * 1024 * 1024,
                windowsHide: true
            }, function(err, stdout, stderr) {
                if (err) {
                    reject(new Error('git ' + args[0] + ' failed: ' + (stderr || err.message)));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    /**
     * Initialize a git repository
     */
    function init(repoPath) {
        return fs.promises.mkdir(repoPath, { recursive: true }).then(function() {
            return runGit(repoPath, ['init']);
        }).then(function() {
            return runGit(repoPath, ['config', 'user.email', 'rewind@local']);
        }).then(function() {
            return runGit(repoPath, ['config', 'user.name', 'rewind']);
        });
    }

    /**
     * Stage all changes and commit
     */
    function commit(repoPath, message) {
        return runGit(repoPath, ['add', '-A']).then(function() {
            return runGit(repoPath, ['commit', '-m', message || 'Snapshot']);
        });
    }

    /**
     * Get commit log
     * @returns {Promise<Array<{hash, message, date, dateRelative}>>}
     */
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

    /**
     * Checkout a specific commit's files (without detaching HEAD)
     */
    function checkout(repoPath, commitHash) {
        return runGit(repoPath, ['checkout', commitHash, '--', '.']);
    }

    /**
     * Get diff stat between a commit and current HEAD
     */
    function diffStat(repoPath, commitHash) {
        return runGit(repoPath, ['diff', '--stat', commitHash]).catch(function() {
            return '';
        });
    }

    /**
     * Check if working tree has uncommitted changes
     */
    function hasChanges(repoPath) {
        return runGit(repoPath, ['status', '--porcelain']).then(function(output) {
            return output.length > 0;
        }).catch(function() {
            return false;
        });
    }

    /**
     * Get current HEAD hash
     */
    function getHead(repoPath) {
        return runGit(repoPath, ['rev-parse', 'HEAD']).catch(function() {
            return null;
        });
    }

    /**
     * Get total commit count
     */
    function commitCount(repoPath) {
        return runGit(repoPath, ['rev-list', '--count', 'HEAD']).then(function(out) {
            return parseInt(out, 10) || 0;
        }).catch(function() {
            return 0;
        });
    }

    // --- Branching ---

    /**
     * Create and checkout a new branch
     */
    function createBranch(repoPath, branchName) {
        return runGit(repoPath, ['checkout', '-b', branchName]);
    }

    /**
     * Switch to an existing branch
     */
    function switchBranch(repoPath, branchName) {
        return runGit(repoPath, ['checkout', branchName]);
    }

    /**
     * List all local branches
     * @returns {Promise<Array<{name: string, current: boolean}>>}
     */
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

    /**
     * Get the current branch name
     */
    function getCurrentBranch(repoPath) {
        return runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(function() {
            return 'master';
        });
    }

    /**
     * Delete a branch (force)
     */
    function deleteBranch(repoPath, branchName) {
        return runGit(repoPath, ['branch', '-D', branchName]);
    }

    /**
     * Get file content at a specific commit
     */
    function showFile(repoPath, commitHash, filePath) {
        return runGit(repoPath, ['show', commitHash + ':' + filePath]).catch(function() {
            return null;
        });
    }

    window.GitManager = {
        init: init,
        commit: commit,
        log: log,
        checkout: checkout,
        diffStat: diffStat,
        hasChanges: hasChanges,
        getHead: getHead,
        commitCount: commitCount,
        // Branching
        createBranch: createBranch,
        switchBranch: switchBranch,
        listBranches: listBranches,
        getCurrentBranch: getCurrentBranch,
        deleteBranch: deleteBranch,
        showFile: showFile
    };
})();
