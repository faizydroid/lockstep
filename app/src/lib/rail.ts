/**
 * The rail's width, applied before first paint.
 *
 * ## Why a blocking script and not an effect
 *
 * The same reason `THEME_SCRIPT` exists. The reader's choice lives in `localStorage`, which React cannot
 * read until it runs, and React runs after the browser has already painted. An effect therefore renders
 * the default rail, paints it, and then snaps it to the stored width -- a 168px lurch on every single
 * navigation for anyone who collapsed it. That is worse than not offering the control.
 *
 * ## Why it reads the settings blob rather than its own key
 *
 * There is one storage key for this app and adding a second for one boolean would mean two things to keep
 * in step, two things to clear on reset, and a way for them to disagree. The cost is that this script has
 * to `JSON.parse`, which is why the whole body is inside a `try`: a corrupt entry must leave the page
 * looking normal, not throw before the stylesheet has been applied.
 *
 * The default is expanded, so a first-time reader and a reader with unreadable settings get the same
 * thing, and neither gets a rail whose labels they have to discover.
 */

import { STORAGE_KEY } from "./settings";

/** The attribute value that means "labels hidden". Absent or anything else means expanded. */
export const RAIL_SHUT = "shut";

/**
 * Inlined into `<head>` by the root layout.
 *
 * Written as a string rather than a real function because it has to run before the bundle loads, and
 * anything imported from a module by definition cannot. `STORAGE_KEY` is interpolated so this file and
 * `settings.ts` cannot drift; everything else is deliberately ES5 and dependency-free.
 */
export const RAIL_SCRIPT = `(function(){try{
var raw=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
if(!raw)return;
var v=JSON.parse(raw);
if(v&&v.navExpanded===false)document.documentElement.dataset.rail=${JSON.stringify(RAIL_SHUT)};
}catch(e){}})();`;

/**
 * Keeps the attribute in step with a change made after load.
 *
 * The script above runs once. When the reader clicks the toggle, the settings write and this call happen
 * together -- the write so the choice survives a reload, this so the width changes now. Splitting them
 * would mean the rail only moved on the next navigation.
 */
export function applyRail(expanded: boolean): void {
  if (typeof document === "undefined") return;
  if (expanded) delete document.documentElement.dataset.rail;
  else document.documentElement.dataset.rail = RAIL_SHUT;
}
