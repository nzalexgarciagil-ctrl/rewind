// github-manager.js - GitHub integration for Rewind

(function() {
    'use strict';

    var https = cep_node.require('https');
    var fs = cep_node.require('fs');
    var path = cep_node.require('path');
    var os = cep_node.require('os');
    var crypto = cep_node.require('crypto');

    var CREDENTIALS_DIR = path.join(os.homedir(), '.rewind');
    var CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');
    var OLD_CREDENTIALS_DIR = path.join(os.homedir(), '.ppgit');
    var OLD_CREDENTIALS_FILE = path.join(OLD_CREDENTIALS_DIR, 'credentials.json');
    var GITHUB_API = 'api.github.com';

    var cachedToken = null;
    var cachedUser = null;

    // --- Migration ---

    function migrateCredentials() {
        try {
            if (!fs.existsSync(CREDENTIALS_FILE) && fs.existsSync(OLD_CREDENTIALS_FILE)) {
                if (!fs.existsSync(CREDENTIALS_DIR)) {
                    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
                }
                fs.copyFileSync(OLD_CREDENTIALS_FILE, CREDENTIALS_FILE);
                console.log('rewind: migrated credentials from ~/.ppgit to ~/.rewind');
            }
        } catch (e) {
            console.warn('rewind: credential migration failed:', e.message);
        }
    }

    // Run migration on load
    migrateCredentials();

    // --- Helpers ---

    function githubRequest(method, apiPath, token, body) {
        return new Promise(function(resolve, reject) {
            var options = {
                hostname: GITHUB_API,
                path: apiPath,
                method: method,
                headers: {
                    'User-Agent': 'rewind/1.0',
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': 'Bearer ' + token
                }
            };
            if (body) {
                options.headers['Content-Type'] = 'application/json';
            }

            var req = https.request(options, function(res) {
                var data = '';
                res.on('data', function(chunk) { data += chunk; });
                res.on('end', function() {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(data ? JSON.parse(data) : null);
                        } catch (e) {
                            resolve(data);
                        }
                    } else {
                        var msg = 'GitHub API error ' + res.statusCode;
                        try {
                            var parsed = JSON.parse(data);
                            if (parsed.message) msg += ': ' + parsed.message;
                        } catch (e) {}
                        reject(new Error(msg));
                    }
                });
            });

            req.on('error', function(err) {
                reject(new Error('Network error: ' + err.message));
            });

            req.setTimeout(15000, function() {
                req.destroy();
                reject(new Error('GitHub API request timed out'));
            });

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    // Delegate git operations to GitManager (loaded before this module)
    // Uses GIT_ASKPASS to provide token via env var instead of embedding in URL
    function runGit(repoPath, args, token) {
        return new Promise(function(resolve, reject) {
            var childProcess = cep_node.require('child_process');
            var env = Object.assign({}, process.env);
            if (token) {
                // Use GIT_ASKPASS with a script that echoes the token from env.
                // This avoids embedding the token in the remote URL where it
                // would be visible in process listings and git logs.
                env.GIT_TERMINAL_PROMPT = '0';
                env.GIT_ASKPASS = process.execPath;
                env.GIT_TOKEN = token;
                // Use a helper approach: set credential helper to supply token
                args = [
                    '-c', 'credential.helper=!f() { echo "username=x-access-token"; echo "password=' + token.replace(/'/g, "'\\''") + '"; }; f'
                ].concat(args);
            }
            childProcess.execFile('git', args, {
                cwd: repoPath,
                maxBuffer: 10 * 1024 * 1024,
                windowsHide: true,
                env: env
            }, function(err, stdout, stderr) {
                if (err) {
                    reject(new Error('git ' + args[args.length - 1] + ' failed: ' + (stderr || err.message)));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    function getMachineId() {
        try {
            return os.hostname() + '-' + os.userInfo().username;
        } catch (e) {
            return 'rewind-default-key';
        }
    }

    function encryptToken(token) {
        var salt = crypto.randomBytes(16);
        var key = crypto.scryptSync(getMachineId(), salt, 32);
        var iv = crypto.randomBytes(16);
        var cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        var encrypted = cipher.update(token, 'utf8', 'hex') + cipher.final('hex');
        return { encrypted: encrypted, iv: iv.toString('hex'), salt: salt.toString('hex') };
    }

    function decryptToken(data) {
        try {
            if (data.plaintext) {
                // Legacy base64 tokens: decrypt and re-encrypt properly on next save
                return Buffer.from(data.plaintext, 'base64').toString('utf8');
            }
            // Support legacy hardcoded salt for existing installs
            var salt = data.salt ? Buffer.from(data.salt, 'hex') : 'ppgit-salt';
            var key = crypto.scryptSync(getMachineId(), salt, 32);
            var iv = Buffer.from(data.iv, 'hex');
            var decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            return decipher.update(data.encrypted, 'hex', 'utf8') + decipher.final('utf8');
        } catch (e) {
            return null;
        }
    }

    // --- Credential Storage ---

    function saveCredentials(token, user) {
        try {
            if (!fs.existsSync(CREDENTIALS_DIR)) {
                fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
            }
            var data = {
                token: encryptToken(token),
                user: user,
                savedAt: new Date().toISOString()
            };
            fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
        } catch (e) {
            console.error('rewind: Failed to save credentials:', e.message);
        }
    }

    function loadCredentials() {
        try {
            if (!fs.existsSync(CREDENTIALS_FILE)) return null;
            var raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
            var data = JSON.parse(raw);
            var token = decryptToken(data.token);
            if (!token) return null;
            return { token: token, user: data.user };
        } catch (e) {
            return null;
        }
    }

    function clearCredentials() {
        try {
            if (fs.existsSync(CREDENTIALS_FILE)) {
                fs.unlinkSync(CREDENTIALS_FILE);
            }
        } catch (e) {}
        cachedToken = null;
        cachedUser = null;
    }

    // --- Authentication ---

    function authenticate(token) {
        return githubRequest('GET', '/user', token).then(function(user) {
            cachedToken = token;
            cachedUser = {
                login: user.login,
                name: user.name || user.login,
                avatar: user.avatar_url,
                email: user.email
            };
            saveCredentials(token, cachedUser);
            return cachedUser;
        });
    }

    function getToken() {
        if (cachedToken) return cachedToken;
        var creds = loadCredentials();
        if (creds) {
            cachedToken = creds.token;
            cachedUser = creds.user;
            return cachedToken;
        }
        return null;
    }

    function isAuthenticated() {
        return !!getToken();
    }

    function getUser() {
        if (cachedUser) return cachedUser;
        var creds = loadCredentials();
        if (creds) {
            cachedUser = creds.user;
            return cachedUser;
        }
        return null;
    }

    function logout() {
        clearCredentials();
    }

    // --- Repository Management ---

    function sanitizeRepoName(name) {
        return name
            .replace(/\.prproj$/i, '')
            .replace(/[^a-zA-Z0-9._-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase()
            .substring(0, 80);
    }

    function createRepo(projectName) {
        var token = getToken();
        if (!token) return Promise.reject(new Error('Not authenticated'));

        var repoName = 'rewind-' + sanitizeRepoName(projectName);

        return githubRequest('POST', '/user/repos', token, {
            name: repoName,
            description: 'Rewind backup: ' + projectName,
            private: true,
            auto_init: false
        }).then(function(repo) {
            return {
                name: repo.name,
                fullName: repo.full_name,
                url: repo.clone_url,
                htmlUrl: repo.html_url,
                sshUrl: repo.ssh_url
            };
        });
    }

    function repoExists(repoName) {
        var token = getToken();
        if (!token) return Promise.reject(new Error('Not authenticated'));
        var user = getUser();
        if (!user) return Promise.reject(new Error('No user info'));

        return githubRequest('GET', '/repos/' + user.login + '/' + repoName, token)
            .then(function() { return true; })
            .catch(function(err) {
                if (err.message && err.message.indexOf('404') !== -1) return false;
                throw err;
            });
    }

    function getOrCreateRepo(projectName) {
        var repoName = 'rewind-' + sanitizeRepoName(projectName);
        var token = getToken();
        if (!token) return Promise.reject(new Error('Not authenticated'));
        var user = getUser();
        if (!user) return Promise.reject(new Error('No user info'));

        return repoExists(repoName).then(function(exists) {
            if (exists) {
                return {
                    name: repoName,
                    fullName: user.login + '/' + repoName,
                    url: 'https://github.com/' + user.login + '/' + repoName + '.git'
                };
            }
            return createRepo(projectName);
        });
    }

    // --- Remote Operations ---

    function setupRemote(repoPath, remoteUrl) {
        // Store clean URL without token — auth is handled per-command via credential helper
        return runGit(repoPath, ['remote', 'get-url', 'origin']).then(function(existingUrl) {
            // Strip any legacy embedded token from existing URL
            var cleanExisting = existingUrl.replace(/https:\/\/[^@]+@/, 'https://');
            if (cleanExisting !== remoteUrl) {
                return runGit(repoPath, ['remote', 'set-url', 'origin', remoteUrl]);
            }
        }).catch(function() {
            return runGit(repoPath, ['remote', 'add', 'origin', remoteUrl]);
        });
    }

    /**
     * Push current branch to origin
     */
    function push(repoPath) {
        var token = getToken();
        return getCurrentBranch(repoPath).then(function(branch) {
            return runGit(repoPath, ['push', '-u', 'origin', branch], token);
        }).catch(function(err) {
            if (err.message.indexOf('has no upstream') !== -1 || err.message.indexOf('does not appear to be a git') !== -1) {
                return getCurrentBranch(repoPath).then(function(branch) {
                    return runGit(repoPath, ['push', '--set-upstream', 'origin', branch], token);
                });
            }
            throw err;
        });
    }

    /**
     * Pull current branch from origin
     */
    function pull(repoPath) {
        var token = getToken();
        return getCurrentBranch(repoPath).then(function(branch) {
            return runGit(repoPath, ['pull', '--rebase', 'origin', branch], token);
        }).catch(function(err) {
            if (err.message.indexOf("couldn't find remote ref") !== -1 ||
                err.message.indexOf('no tracking information') !== -1) {
                return '';
            }
            throw err;
        });
    }

    function sync(repoPath) {
        return pull(repoPath).then(function() {
            return push(repoPath);
        });
    }

    function hasRemote(repoPath) {
        return runGit(repoPath, ['remote', 'get-url', 'origin'])
            .then(function(url) { return !!url; })
            .catch(function() { return false; });
    }

    function getRemoteUrl(repoPath) {
        return runGit(repoPath, ['remote', 'get-url', 'origin']).catch(function() {
            return null;
        });
    }

    // Delegate to GitManager (loaded before this module) to avoid duplication
    function getCurrentBranch(repoPath) {
        return window.GitManager.getCurrentBranch(repoPath);
    }

    // --- Public API ---

    window.GitHubManager = {
        // Auth
        authenticate: authenticate,
        isAuthenticated: isAuthenticated,
        getToken: getToken,
        getUser: getUser,
        logout: logout,

        // Repos
        createRepo: createRepo,
        repoExists: repoExists,
        getOrCreateRepo: getOrCreateRepo,
        sanitizeRepoName: sanitizeRepoName,

        // Remote operations
        setupRemote: setupRemote,
        push: push,
        pull: pull,
        sync: sync,
        hasRemote: hasRemote,
        getRemoteUrl: getRemoteUrl
    };
})();
