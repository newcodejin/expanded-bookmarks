// Helpers for accessing Obsidian's private APIs, kept in one place.
// If core internals change, this is the only file to fix

import { App } from "obsidian";

// Defensively get an internal (core) plugin's instance; undefined when unavailable
export function internalPluginInstance(app: App, id: string): any {
	return (app as any).internalPlugins?.getPluginById?.(id)?.instance;
}
