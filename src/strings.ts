// All UI strings live here, so wording/translation changes touch only this file.

export const T = {
	viewName: "Expanded Bookmarks",
	ribbonTooltip: "Open Expanded Bookmarks",

	// Toolbar (most action labels come from `actionNames` below)
	moreButton: "More options",
	showHiddenOn: "Show hidden bookmarks",
	showHiddenOff: "Stop showing hidden bookmarks",

	// Bookmark filter toggle in the core Search pane
	searchFilterButton: "Show only bookmarked files",
	searchExcludeButton: "Hide bookmarked files",

	// Sort criteria names
	sort: {
		custom: "Custom (drag & drop)",
		name: "Name",
		added: "Date bookmarked",
		mtime: "File modified time",
		ctime: "File created time",
		ext: "File type",
	} as Record<string, string>,
	// Short sort labels for the toolbar/group badges (space is tight)
	sortShort: {
		custom: "Custom",
		name: "Name",
		added: "Bookmarked",
		mtime: "Modified",
		ctime: "Created",
		ext: "Type",
	} as Record<string, string>,
	sortAsc: "Ascending",
	sortDesc: "Descending",
	sortGroupOverride: "Sort this group by",
	sortGroupDefault: "Use default sort",

	// Item context menu
	menuOpen: "Open",
	menuOpenNewTab: "Open in new tab",
	menuEditBookmark: "Edit bookmark…",
	menuRename: "Rename group",
	menuHighlight: "Highlight",
	menuHide: "Hide bookmark",
	menuUnhide: "Unhide bookmark",
	menuRemove: "Remove bookmark",
	menuRemoveGroup: "Remove group",
	menuAddBookmark: "Add to Expanded Bookmarks",
	menuReveal: "Reveal in Expanded Bookmarks",
	headerTooltip: "Edit in Expanded Bookmarks",

	// Add/edit bookmark modal — one encompassing title for both cases
	modalTitle: "Edit Expanded Bookmark",
	fieldOriginalName: "File",
	fieldBookmarkName: "Bookmark name",
	fieldGroup: "Group",
	fieldGroupNone: "(No group)",
	btnSave: "Save",
	btnDelete: "Delete bookmark",

	// Batch action bar
	batchSelected: (n: number) => `${n} selected`,
	batchMoveToGroup: "Move to bookmark group...",
	batchMoveFiles: "Move actual files to folder...",
	batchRemove: "Remove",
	batchCancel: "Done",

	// Group picker modal
	pickGroupPlaceholder: "Choose a destination bookmark group...",
	rootGroupName: "(Top level)",
	pickFolderPlaceholder: "Choose a destination folder...",
	pickJsonPlaceholder: "Choose a .json file to import...",

	// Name/group input modals
	newGroupPrompt: "Group name",
	renamePrompt: "New name",
	confirmButton: "OK",
	cancelButton: "Cancel",

	// File batch-move confirmation
	confirmFileMoveTitle: "Move files?",
	confirmFileMoveBody: (n: number, folder: string) =>
		`Move ${n} file(s) to "${folder}"? This moves real files in your vault. The bookmarks are unchanged — they follow the files.`,

	// Removal confirmations
	confirmRemoveGroupTitle: "Remove group?",
	confirmRemoveGroupBody: (name: string, n: number) =>
		n > 0
			? `"${name}" contains ${n} item(s), which will be removed with it. The files themselves are not deleted.`
			: `Remove the empty group "${name}"?`,
	confirmBatchRemoveTitle: "Remove bookmarks?",
	confirmBatchRemoveBody: (n: number) =>
		`Remove ${n} selected bookmark(s)? Groups take their contents with them. The files themselves are not deleted.`,

	// Import/export confirmations
	confirmImportTitle: "Import bookmarks?",
	confirmImportBody: (source: string) => `Import from ${source}? Imported items are added on top.`,
	importSourceCore: "the core Bookmarks plugin",
	confirmExportTitle: "Export bookmarks?",
	confirmExportBody: (where: string) =>
		`Save a JSON file to ${where}? Plugin-only details (color, hidden, per-group sort) are not included.`,
	exportRootLabel: "the vault root",

	// Notices
	noticeImported: (n: number, skipped: number) =>
		`Imported ${n} bookmark(s) from core Bookmarks` + (skipped ? ` (${skipped} unsupported item(s) skipped)` : ""),
	noticeImportFailed: "Core Bookmarks plugin not found or has no data",
	noticeImportBadFile: "That file is not a recognized bookmarks JSON",
	noticeExported: (path: string) => `Exported to "${path}"`,
	noticeExportFailed: "Could not create the export file",
	noticeCleaned: (n: number) => `Removed ${n} broken bookmark(s)`,
	noticeNoBroken: "No broken bookmarks found",
	noticeDupsRemoved: (n: number) => `Removed ${n} duplicate bookmark(s)`,
	noticeNoDups: "No duplicate bookmarks found",
	noticeMovedBm: (n: number) => `Moved ${n} bookmark(s)`,
	noticeMovedFiles: (n: number, failed: number) =>
		`Moved ${n} file(s)` + (failed ? `, ${failed} failed` : ""),
	noticeRemoved: (n: number) => `Removed ${n} bookmark(s)`,
	noticeAdded: (name: string) => `Bookmarked "${name}"`,
	noticeAlreadyBookmarked: "Already bookmarked",
	noticeReorderNeedsCustom: "Switch the sort order to Custom to rearrange by hand",
	noticeNotBookmarked: "This file is not bookmarked here",
	noticeBrokenTarget: "Bookmark target no longer exists",

	// Commands
	cmdOpen: "Open bookmarks panel",
	cmdImport: "Import from core Bookmarks",
	cmdImportFile: "Import from a file",
	cmdExport: "Export bookmarks to a file",
	cmdClean: "Remove broken bookmarks",
	cmdDedupe: "Remove duplicate bookmarks",
	cmdStats: "Open bookmark statistics",
	cmdBookmarkCurrent: "Bookmark current file",

	// Statistics modal
	statsTitle: "Bookmark statistics",
	statsTotal: "Total bookmarks",
	statsGroups: "Groups",
	statsByType: "By type",
	statsTypeNames: { file: "Files", folder: "Folders", search: "Searches", url: "URLs", graph: "Graphs", group: "Groups" } as Record<string, string>,
	statsPerGroup: "Bookmarks per group",
	statsNoData: "Nothing here yet",
	cmdReveal: "Reveal active file in bookmarks",

	// Settings
	// Notes about features that reach outside the bookmark panel; shown on their own line
	noteCoreExplorer: "※ Works in the core file explorer",
	noteCoreSearch: "※ Works in the core Search pane",
	noteMovesFiles: "※ Moves real files in your vault",
	settingsHighlightName: "Mark bookmarked files in the file explorer",
	settingsHighlightDesc: "Show a small bookmark icon next to bookmarked files and folders. Hidden bookmarks are not marked.",
	settingsToolbarHeading: "Panel toolbar",
	settingsToolbarDesc: "Choose where each action appears: as a toolbar button, inside the ⋮ menu, or nowhere.",
	placementToolbar: "Toolbar",
	placementMenu: "⋮ menu",
	placementHidden: "Hidden",
	actionNames: {
		sort: "Sort order",
		newGroup: "New group",
		collapseAll: "Collapse all",
		scrollTop: "Scroll to top",
		scrollBottom: "Scroll to bottom",
		resetSort: "Reset all sort orders",
		batch: "Select",
		stats: "Statistics",
		showHidden: "Show hidden bookmarks",
		import: "Import from core Bookmarks",
		importFile: "Import from a file",
		export: "Export bookmarks to a file",
		dedupe: "Remove duplicate bookmarks",
		clean: "Remove broken bookmarks",
	} as Record<string, string>,
	// Short notes for actions that reach outside the bookmark panel
	actionNotes: {
		import: "※ Reads the core Bookmarks plugin",
		importFile: "※ Reads a file in your vault",
	} as Record<string, string>,
	settingsSearchFilterName: "Bookmark filters in Search",
	settingsSearchFilterDesc: "Add \"Show only bookmarked files\" and \"Hide bookmarked files\" toggles to the filter options.",
	settingsExportFolderName: "Export folder",
	settingsExportFolderDesc: "Folder where exported bookmark files are saved. Leave blank to use the vault root; a missing folder is created.",
	settingsExportFolderPlaceholder: "(vault root)",

	untitledGraph: "Graph",
	brokenBadge: "missing",
	hiddenBadge: "hidden",
};
