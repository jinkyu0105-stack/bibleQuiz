import { mkdtempSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { localRecoveryD1 } from "../local-recovery-d1.mjs";
// Only synthetic integration files; never points to the user's trial session.
export const directory = mkdtempSync(path.join(homedir(), ".biblequiz-synthetic-recovery-"));
export const databasePath = path.join(directory, "fixture.sqlite");
export const handle = localRecoveryD1(databasePath, false);
export const env = { DB: handle.db };
