// github-manager.js - GitHub integration for ppgit

(function() {
    'use strict';

    var https = cep_node.require('https');
    var fs = cep_node.require('fs');
    var path = cep_node.require('path');
    var os = cep_node.require('os');
    var crypto = cep_node.require('crypto');
    var childProcess = cep_node.require('child_process');

    var CREDENTIALS_DIR = path.join(os.homedir(), '.ppgit');
    var CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');
    var GIT_EXE = 'git';
    var GITHUB_API = 'api.github.com';

    var cachedToken = null;
    var cachedUser = null;

    // --- Helpers ---

    function githubRequest(method, apiPath, token, body) {
        return new Promise(function(resolve, reject) {
            var options = {
                hostname: GITHUB_API,
                path: apiPath,
                method: method,
                headers: {
                    'User-Agent': 'ppgit/1.0',
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

    function getMachineId() {
        try {
            return os.hostname() + '-' + os.userInfo().username;
        } catch (e) {
            return 'ppgit-default-key';
        }
    }

    function encryptToken(token) {
        try {
            var key = crypto.scryptSync(getMachineId(), 'ppgit-salt', 32);
            var iv = crypto.randomBytes(16);
            var cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            var encrypted = cipher.update(token, 'utf8', 'hex') + cipher.final('hex');
            return { encrypted: encrypted, iv: iv.toString('hex') };
        } catch (e) {
            // Fallback: base64 encode (not secure, but functional)
            return { plaintext: Buffer.from(token).toString('base64') };
        }
    }

    function decryptToken(data) {
        try {
            if (data.plaintext) {
                return Buffer.from(data.plaintext, 'base64').toString('utf8');
            }
            var key = crypto.scryptSync(getMachineId(), 'ppgit-salt', 32);
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
                fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
            }
            var data = {
                token: encryptToken(token),
                user: user,
                savedAt: new Date().toISOString()
            };
            fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('ppgit: Failed to save credentials:', e.message);
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

        var repoName = 'ppgit-' + sanitizeRepoName(projectName);

        return githubRequest('POST', '/user/repos', token, {
            name: repoName,
            description: 'ppgit backup: ' + projectName,
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
        var repoName = 'ppgit-' + sanitizeRepoName(projectName);
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

    function setupRemote(repoPath, remoteUrl, token) {
        var authUrl = remoteUrl.replace('https://', 'https://' + token + '@');
        return runGit(repoPath, ['remote', 'get-url', 'origin']).then(function() {
            return runGit(repoPath, ['remote', 'set-url', 'origin', authUrl]);
        }).catch(function() {
            return runGit(repoPath, ['remote', 'add', 'origin', authUrl]);
        });
    }

    function push(repoPath) {
        return runGit(repoPath, ['push', '-u', 'origin', 'master']).catch(function(err) {
            // If remote has no master yet, try --set-upstream
            if (err.message.indexOf('has no upstream') !== -1 || err.message.indexOf('does not appear to be a git') !== -1) {
                return runGit(repoPath, ['push', '--set-upstream', 'origin', 'master']);
            }
            throw err;
        });
    }

    function pull(repoPath) {
        return runGit(repoPath, ['pull', '--rebase', 'origin', 'master']).catch(function(err) {
            // Ignore if remote is empty or no tracking
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
