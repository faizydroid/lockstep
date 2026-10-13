#!/usr/bin/env node
/**
 * Runner entry point. The only place that touches `process.exit`.
 *
 * Keeping the exit here rather than inside `main()` is what makes the action's safety
 * rails testable: a test can assert that publishing is refused without the assertion
 * killing the test process.
 */
import { main } from "./main.ts";
import { workflowErrorCommand } from "./shared.ts";

main().catch((error: unknown) => {
  // Redacted and escaped: see `workflowErrorCommand`. The raw message used to go straight into the command.
  process.stdout.write(`${workflowErrorCommand(error)}\n`);
  process.exit(1);
});
