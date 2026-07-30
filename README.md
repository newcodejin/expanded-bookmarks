# Expanded Bookmarks

An expanded version of the Bookmarks. — moving, sorting, search filtering, and more.

## Main features

- **Sort order** — sort the whole panel, or one group on its own
- **Select** — tick several bookmarks to move or remove at once
- **Move actual files to folder** — move the bookmarked files themselves into a vault folder
  ※ Changes real files in your vault
- **Bookmark filters in Search** — adds "show only bookmarked files" and "hide bookmarked files" toggles.
  ※ Works in the core Search pane

## And more

- **Statistics** — totals, and counts per group and per type
- **New group** — add a bookmark group
- **Mark bookmarked files in the file explorer** — a small bookmark icon next to bookmarked files and folders.
  ※ Works in the core file explorer
- **Export folder** — where exported bookmark files are saved; blank means the vault root.
- **Panel toolbar** — choose where each action appears: a toolbar button, the ⋮ menu, or hidden.
- **Collapse all** — collapse or expand every group
- **Scroll to top** — jump to the start of the list
- **Scroll to bottom** — jump to the end of the list
- **Show hidden bookmarks** — reveal the ones you hid
- **Import from core Bookmarks** —  reads the core Bookmarks plugin
- **Import from a file** —  reads a JSON file in your vault
- **Export bookmarks to a file** —  creates a file in your vault
- **Remove duplicate bookmarks** — drop repeats of the same target
- **Remove broken bookmarks** — drop bookmarks whose file is gone

## First time? Import from core Bookmarks

Run **Import from core Bookmarks** from the command palette (or the panel's ⋮ menu) to bring your existing bookmarks over.
It takes the bookmarks the core plugin holds — the same ones it stores in `.obsidian/bookmarks.json`. If you would rather do it manually, use **Import from a file** to read a JSON file instead (an export of this plugin, or a copy of a core bookmarks file).

※ Core bookmarks can still point at files that were deleted, so running **Remove broken bookmarks** afterwards is recommended.

## Where the data lives

- **This plugin:** `.obsidian/plugins/expanded-bookmarks/data.json`
- **Core Bookmarks:** `.obsidian/bookmarks.json`

## Notes

- The **Bookmark filter in Search** and the **file explorer marker** attach to Obsidian's UI internals. 
- It does not conflict with the core Bookmarks plugin — they keep their data separately — but many features overlap, so disabling core Bookmarks is recommended to avoid duplication.
- It does not automatically sync with your existing bookmarks. Use the import/export feature to sync them.
- Tested on Obsidian **1.12–1.13**.

## Installation

Manually: download `main.js`, `manifest.json` and `styles.css` from the release

## Usage

1. Open the panel with the bookmark icon in the left ribbon, or the **Open bookmarks panel** command.
2. Add a bookmark by right-clicking a file or folder (long-press on mobile) and choosing **Add to Expanded Bookmarks**, or run **Bookmark current file**. Give it a name and a group, or just save.
3. In the panel: click an item to open it, drag to reorder or to drop it into a group, and right-click (long-press on mobile) an item for its menu — edit, highlight, hide, remove.
4. Use the toolbar and its ⋮ menu for everything else: sorting, new groups, selecting several bookmarks, import/export.

## License

The UI follow Obsidian's core Bookmarks plugin.

MIT.
