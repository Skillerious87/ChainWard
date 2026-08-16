import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const nextBinary = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(process.execPath, [nextBinary, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    CHAINWARD_LOCAL_TEST_MODE: "true",
    CHAINWARD_OFFLINE_TEST_MODE: "true",
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
