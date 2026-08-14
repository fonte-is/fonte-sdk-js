import { spawn } from "node:child_process";

export function openBrowser(url: URL): Promise<boolean> {
  const target = browserCommand(url.toString());
  return new Promise((resolve) => {
    const child = spawn(target.command, target.arguments, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

function browserCommand(url: string): {
  command: string;
  arguments: readonly string[];
} {
  if (process.platform === "darwin")
    return { command: "open", arguments: [url] };
  if (process.platform === "win32") {
    return {
      command: "rundll32.exe",
      arguments: ["url.dll,FileProtocolHandler", url],
    };
  }
  return { command: "xdg-open", arguments: [url] };
}
