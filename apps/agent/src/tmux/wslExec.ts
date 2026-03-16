import { spawn } from "node:child_process";

export type ExecSpec = {
  file: string;
  args: string[];
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

function shellEscape(arg: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'"'"'`)}'`;
}

export function buildWslExecSpec(args: string[]): ExecSpec {
  return {
    file: "wsl.exe",
    args: ["bash", "-lc", args.map(shellEscape).join(" ")]
  };
}

export async function runExec(spec: ExecSpec): Promise<ExecResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(spec.file, spec.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}
