#!/usr/bin/env node
/**
 * Runner entry point. The only place that touches `process.exit`.
 *
 * Keeping the exit here rather than inside `main()` is what makes the action's safety
 * rails testable: a test can assert that publishing is refused without the assertion
 * killing the test process.
 */
import { main } from "./main.ts";

main().catch((error: unknown) => {
  process.stdout.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
