// Bookmark data model

export type ItemType = "file" | "folder" | "search" | "url" | "graph" | "group";

// Sort criteria. "custom" means manual (drag & drop) order
export type SortKey = "custom" | "name" | "added" | "mtime" | "ctime" | "ext";

export interface SortSpec {
	key: SortKey;
	asc: boolean;
}

export interface BmItem {
	id: string;
	type: ItemType;
	// User-given display name (falls back to file name / query)
	title?: string;
	// file/folder: vault path
	path?: string;
	// file only: heading/block link (#heading etc.)
	subpath?: string;
	// search only: search query
	query?: string;
	// url only: external link
	url?: string;
	// graph only: the core graph view's options, kept opaque and passed through as-is
	options?: unknown;
	// When the bookmark was added (epoch ms)
	added: number;
	// Color tag (CSS color value); default look when absent
	color?: string;
	// Hidden bookmark (only shown when the show-hidden toggle is on)
	hidden?: boolean;
	// group-only fields
	collapsed?: boolean;
	sort?: SortSpec; // per-group sort override (global default when absent)
	items?: BmItem[];
}

// Panel toolbar actions. Each can be placed on the toolbar, in the ⋮ menu, or hidden
export type ToolbarAction =
	| "sort" | "newGroup" | "collapseAll" | "batch"
	| "scrollTop" | "scrollBottom"
	| "stats" | "showHidden" | "import" | "importFile" | "export" | "dedupe" | "clean";
export type ActionPlacement = "toolbar" | "menu" | "hidden";

export interface SBSettings {
	// Global default sort
	defaultSort: SortSpec;
	// Show the current sort order in the toolbar and on groups
	// Mark bookmarked files/folders in the file explorer
	highlightInExplorer: boolean;
	// Ask for confirmation before batch-moving actual files
	// Add a "bookmarked files only" toggle to the core Search pane
	searchBookmarkFilter: boolean;
	// Placement of each toolbar action
	toolbarLayout: Record<ToolbarAction, ActionPlacement>;
	// Vault folder to save exports into (blank = vault root)
	exportFolder: string;
}

export interface SBData {
	settings: SBSettings;
	root: BmItem[];
}

export const DEFAULT_SETTINGS: SBSettings = {
	defaultSort: { key: "custom", asc: true },
	highlightInExplorer: true,
	searchBookmarkFilter: true,
	// Sort comes first, then the navigation actions; everything else lives in the ⋮ menu
	toolbarLayout: {
		sort: "toolbar",
		newGroup: "menu",
		collapseAll: "toolbar",
		scrollTop: "toolbar",
		scrollBottom: "toolbar",
		batch: "menu",
		stats: "menu",
		showHidden: "menu",
		import: "menu",
		importFile: "menu",
		export: "menu",
		dedupe: "menu",
		clean: "menu",
	},
	exportFolder: "",
};

// Single highlight color: Obsidian's own accent
export const HIGHLIGHT_COLOR = "var(--interactive-accent)";

export function newId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
