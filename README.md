# Rewind

### Stop naming your projects _FINAL_FINAL2.prproj

Full version history for every Premiere Pro project. Browse, restore, and manage every change you've ever made — without cluttering your desktop with duplicate files.

---

## The problem

You know the drill:

- Client asks for an alternate cut. You duplicate the sequence. Then duplicate it again. Your project is a graveyard of `Sequence_v2_OLD_USE_THIS_ONE`.
- You save over something, close Premiere, and your undo history is gone forever.
- Your desktop looks like `MyProject_FINAL.prproj`, `MyProject_FINAL2.prproj`, `MyProject_FINAL_forreal.prproj`.
- A week later, you can't remember what changed between any of them.

Rewind fixes all of this.

## What Rewind does

**Rewind is version control for creative projects.** It gives you a complete, browsable history of every change you make in Premiere Pro, with the ability to restore any previous state in one click.

### Automatic version history

Rewind silently saves your project every minute in the background. Every save becomes a snapshot you can browse and restore. You don't have to remember to save, duplicate, or rename anything.

### Named versions

Create named versions like **Rough Cut**, **Client Alt**, and **Director's Cut**. Switch between them instantly. Each version has its own complete history, so you can experiment freely without losing anything.

### One-click restore

Browse your timeline of snapshots, click **Restore**, and your project reopens at that exact state. No digging through folders, no guessing which file is which.

### Change summaries

See what actually changed between any two snapshots — which sequences were modified, which clips were added or removed. No more opening two files side-by-side and squinting.

### GitHub backup

Connect your GitHub account and every snapshot is automatically backed up to a private repo. Your version history lives in the cloud, safe from drive failures.

### Per-project isolation

Each project has its own history. Nothing is shared, nothing leaks between projects.

---

## Installation

### Prerequisites

- **Adobe Premiere Pro** 2022 (v22.0) or later
- **Git** installed on your system ([download](https://git-scm.com/downloads))

### Install the extension

#### Windows

1. Download or clone this repository
2. Copy the folder to:
   ```
   C:\Users\<YourUsername>\AppData\Roaming\Adobe\CEP\extensions\rewind
   ```
3. Enable unsigned extensions (required for development builds):
   - Open Registry Editor (`regedit`)
   - Navigate to `HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11`
   - Create a new String value: `PlayerDebugMode` = `1`
   - If the `CSXS.11` key doesn't exist, create it
4. Restart Premiere Pro
5. Go to **Window > Extensions > Rewind**

#### macOS

1. Download or clone this repository
2. Copy the folder to:
   ```
   ~/Library/Application Support/Adobe/CEP/extensions/rewind
   ```
3. Enable unsigned extensions:
   ```bash
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1
   ```
4. Restart Premiere Pro
5. Go to **Window > Extensions > Rewind**

---

## Usage

### Getting started

1. Open a Premiere Pro project
2. Open the Rewind panel: **Window > Extensions > Rewind**
3. Click **Start Tracking**
4. Make your edits — Rewind auto-saves every minute in the background

### Creating named versions

1. Click **New Version** in the Rewind panel
2. Give it a name (e.g., "Rough Cut", "Client Feedback v1")
3. Keep editing — this version now has its own history

### Switching versions

Click the version name in the dropdown to switch. Your project reopens in the selected version, exactly where you left off.

### Restoring a snapshot

1. Browse the timeline in the Rewind panel
2. Hover over any snapshot
3. Click **Restore**
4. Your project closes and reopens at that exact state

### Connecting GitHub backup

1. Click the cloud icon in the Rewind header
2. Paste your GitHub Personal Access Token ([create one here](https://github.com/settings/tokens/new?scopes=repo&description=rewind))
3. Click **Connect**
4. Every snapshot is now automatically backed up to a private repo

---

## Settings

| Setting | Options | Default |
|---------|---------|---------|
| Auto-save interval | 30s / 1 min / 2 min / 5 min / Off | 1 min |
| Auto-sync to GitHub | On / Off | Off |

---

## FAQ

**Does this slow down Premiere Pro?**
No. Rewind runs in a separate panel process. Your editing performance is not affected.

**How much disk space does it use?**
Very little. Rewind only stores the differences between snapshots, not full copies. Hundreds of snapshots typically take up around 50MB.

**Can I use this with After Effects?**
Premiere Pro only for now.

**What if I already use git?**
Rewind uses its own hidden `.rewind` directory and does not interfere with any existing repos.

**Can multiple people work on the same project?**
Single-user for now. Collaboration is planned for v2.

---

## How it works

Under the hood, Rewind is powered by git — but you never have to touch it.

Premiere Pro `.prproj` files are compressed XML. Rewind decompresses them and tracks the XML in a hidden git repository (the `.rewind` folder inside your project directory). Because only the actual changes are stored — not full copies of the file — storage stays small even after hundreds of snapshots.

Each named version is a git branch under the hood. Switching versions is just a branch checkout. Restoring a snapshot is just a checkout of a specific commit. The complexity is hidden behind a simple UI.

```
YourProject/
  MyEdit.prproj          <- Your Premiere Pro project
  .rewind/               <- Rewind's version data (hidden folder)
    .git/                <- Git repository
    project.xml          <- Decompressed project XML
    settings.json        <- Your Rewind settings for this project
```

---

## Privacy & security

- Your GitHub token is encrypted and stored locally
- All GitHub repos created by Rewind are **private** by default
- Rewind never sends data anywhere except your own GitHub account
- The `.rewind` folder is local to your machine

---

## For Developers

Want to add version control to your own Premiere Pro extension? Check out the [Rewind SDK](https://github.com/nzalexgarciagil-ctrl/rewind-sdk) — add snapshots, named versions, restore, and GitHub backup to any CEP extension with a single script tag.

---

## Contributing

Contributions welcome! This is an open source project.

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## License

[MIT](LICENSE)
