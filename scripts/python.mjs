// Runs a Python service with the virtual environment (.venv) in its own folder,
// the same way on Windows, macOS and Linux. Each service's package.json calls it,
// so Turborepo can set up and start the Python services like the Node ones.
//
//   node scripts/python.mjs setup              create .venv with Python 3.11 and install requirements.txt
//   node scripts/python.mjs <file.py> [args]   run a file with the .venv's Python

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const isWindows = process.platform === "win32";
const venvPython = join(cwd, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");
const [command, ...args] = process.argv.slice(2);

const succeeds = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { stdio: "inherit" }).status === 0;

// The services and their Docker images use Python 3.11.
const findPython = () => {
    const candidates = isWindows
        ? [["py", ["-3.11"]], ["python", []]]
        : [["python3.11", []], ["python3", []], ["python", []]];
    for (const [cmd, prefix] of candidates) {
        const r = spawnSync(cmd, [...prefix, "--version"], { encoding: "utf8" });
        if (r.status === 0) return { cmd, prefix, version: `${r.stdout}${r.stderr}`.trim() };
    }
    return null;
};

if (!command) {
    console.error("Usage: node scripts/python.mjs setup | <file.py> [args]");
    process.exit(1);
}

if (command === "setup") {
    if (!existsSync(venvPython)) {
        const python = findPython();
        if (!python) {
            console.error("Python 3.11 was not found. Install it, then run this again.");
            process.exit(1);
        }
        if (!python.version.includes("3.11")) {
            console.warn(`Using ${python.version}. The services are built and tested with Python 3.11.`);
        }
        console.log(`Creating .venv with ${python.version}`);
        if (!succeeds(python.cmd, [...python.prefix, "-m", "venv", ".venv"])) process.exit(1);
    }
    const installed = succeeds(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.txt"]);
    process.exit(installed ? 0 : 1);
}

if (!existsSync(venvPython)) {
    console.error(`There is no .venv in ${cwd}. Run "npm run setup:python" in the repository root first.`);
    process.exit(1);
}

// Unbuffered, so the output shows up as it happens in Turborepo's view.
const child = spawn(venvPython, [command, ...args], {
    stdio: "inherit",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
