/**
 * Paths as the live-dispatch harness shows them, not as it uses them.
 *
 * Every path the harness prints is under the OS temp directory, and on Windows that directory is
 * inside the user's profile. So the `state:` line, the gateway's lockstep lines and the model's own
 * transcript all showed the account name, in the terminal that gets filmed for the demo.
 * `pathDisplay` rewrites those prefixes to `%TEMP%` and `%USERPROFILE%` (`$TMPDIR` and `~`
 * elsewhere) and keeps the rest of the path, because the directory name is the part worth reading.
 *
 * Display only. Nothing the harness reads or writes passes through this.
 */

/** Escapes a string for literal use inside a RegExp. */
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds the rewrite for one environment.
 *
 * @param {{ tmp: string, home: string, windows: boolean }} environment
 * @returns {(text: string) => string}
 */
export function pathDisplay({ tmp, home, windows }) {
  // Temp first: on Windows it sits inside the home directory, so the order decides which label wins.
  const rules = [
    [tmp, windows ? "%TEMP%" : "$TMPDIR"],
    [home, windows ? "%USERPROFILE%" : "~"],
  ]
    .map(([path, label]) => [path.replace(/[\\/]+$/, ""), label])
    // A root-like value ("/", "C:") would rewrite part of every path on the screen.
    .filter(([path]) => path.length > 3)
    .map(([path, label]) => {
      // One directory can appear three ways in the output: as written, with forward slashes
      // (file URLs, some loggers), or JSON-escaped (anything a tool serialised). Windows paths are
      // case-insensitive, so the match is too.
      const spellings = windows
        ? [path.replace(/\\/g, "\\\\"), path, path.replace(/\\/g, "/")]
        : [path];
      return [new RegExp(spellings.map(literal).join("|"), windows ? "gi" : "g"), label];
    });

  // A replacer function, so a label is never read as a `$` replacement pattern.
  return (text) => rules.reduce((shown, [pattern, label]) => shown.replace(pattern, () => label), text);
}
