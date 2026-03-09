# ppgit - Git Version Control for Premiere Pro

**Never lose your Premiere Pro project again.** ppgit automatically saves every change you make as a git snapshot, with one-click restore and GitHub backup.

## What it does

- **Auto-saves on every edit** - Cut a clip, adjust a title, move anything - ppgit detects the change and snapshots it within seconds
- **One-click restore** - Browse your version timeline and restore any previous state instantly
- **GitHub backup** - Connect your GitHub account and every snapshot is automatically backed up to a private repository
- **Per-project tracking** - Each Premiere Pro project gets its own isolated version history
- **Zero config** - Click "Start Tracking" and you're done

## How it works

Premiere Pro project files (`.prproj`) are compressed XML. ppgit decompresses them and tracks the XML in a local git repository, giving you meaningful version diffs and efficient storage. Only the actual changes are stored, not full copies.

```
Your edit in Premiere Pro
    -> ppgit detects the .prproj file change
    -> Decompresses to readable XML
    -> Commits the diff to a local git repo
    -> (Optional) Pushes to your private GitHub repo
```

## Installation

### Prerequisites

- **Adobe Premiere Pro** 2022 (v22.0) or later
- **Git** installed on your system ([download](https://git-scm.com/downloads))

### Install the extension

#### Windows

1. Download or clone this repository
2. Copy the `ppgit` folder to:
   ```
   C:\Users\<YourUsername>\AppData\Roaming\Adobe\CEP\extensions\ppgit
   ```
3. Enable unsigned extensions (required for development builds):
   - Open Registry Editor (`regedit`)
   - Navigate to `HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11`
   - Create a new String value: `PlayerDebugMode` = `1`
   - If the `CSXS.11` key doesn't exist, create it
4. Restart Premiere Pro
5. Go to **Window > Extensions > ppgit**

#### macOS

1. Download or clone this repository
2. Copy the `ppgit` folder to:
   ```
   ~/Library/Application Support/Adobe/CEP/extensions/ppgit
   ```
3. Enable unsigned extensions:
   ```bash
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1
   ```
4. Restart Premiere Pro
5. Go to **Window > Extensions > ppgit**

## Usage

### Getting started

1. Open a Premiere Pro project
2. Open the ppgit panel (**Window > Extensions > ppgit**)
3. Click **Start Tracking**
4. That's it - ppgit is now watching your project

### Taking snapshots

- **Automatic**: Every time you save your project (Ctrl+S), ppgit captures a snapshot
- **Manual**: Type an optional message and click **Snapshot**
- **Interval**: Set auto-snapshots every 5-60 minutes in Settings

### Restoring a version

1. Browse the timeline in the ppgit panel
2. Hover over any snapshot and click **Restore**
3. Confirm the restore - your current state is saved first as a safety net
4. Premiere Pro closes and reopens with the restored version

### GitHub backup

1. Click the cloud icon in the ppgit header
2. Paste your GitHub Personal Access Token ([create one here](https://github.com/settings/tokens/new?scopes=repo&description=ppgit))
3. Click **Connect**
4. ppgit automatically creates a private repo and syncs your snapshots

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Auto-snapshot on save | Capture a snapshot when the .prproj file changes | On |
| Auto-snapshot interval | Take snapshots at regular intervals | Off |
| Auto-sync to GitHub | Push to GitHub after each snapshot | Off |

## How data is stored

```
YourProject/
  MyEdit.prproj          <- Your Premiere Pro project
  .ppgit/                <- ppgit's version data (hidden folder)
    .git/                <- Git repository
    project.xml          <- Decompressed project XML
    settings.json        <- Your ppgit settings for this project
```

Each project has its own `.ppgit` folder. Nothing is shared between projects.

## Privacy & Security

- Your GitHub token is encrypted and stored locally at `~/.ppgit/credentials.json`
- All GitHub repos created by ppgit are **private** by default
- ppgit never sends data anywhere except your own GitHub account
- The `.ppgit` folder is local to your machine

## Contributing

Contributions welcome! This is an open source project under the MIT license.

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## FAQ

**Q: Does ppgit slow down Premiere Pro?**
A: No. ppgit runs in a separate panel process and uses lightweight file watching. Snapshots happen in the background.

**Q: How much disk space does it use?**
A: Git is very efficient with text diffs. A project with hundreds of snapshots typically uses less than 50MB.

**Q: Can I use this with After Effects / Audition / other Adobe apps?**
A: Currently Premiere Pro only. Other Adobe apps may be supported in the future.

**Q: What if I already use git for my project?**
A: ppgit uses its own isolated `.ppgit` directory and does not interfere with any existing git repos.

**Q: Can multiple people use ppgit on the same project?**
A: Currently designed for single-user workflows. Collaboration features are planned.

## License

[MIT](LICENSE)
