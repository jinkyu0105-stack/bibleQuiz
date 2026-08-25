import { existsSync } from "node:fs";

const forbiddenLockfiles = ["package-lock.json", "yarn.lock"];
const found = forbiddenLockfiles.filter((path) => existsSync(path));

if (found.length > 0) {
  console.error(`금지된 lockfile이 있습니다: ${found.join(", ")}`);
  process.exitCode = 1;
}
