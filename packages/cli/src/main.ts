#!/usr/bin/env node

export {};

if (process.argv[2] === "release") {
  const [{ runReleaseProgram }, { releaseRunner }] = await Promise.all([
    import("./release-program.js"),
    import("./runner.js"),
  ]);
  const result = await runReleaseProgram(
    process.argv.slice(2),
    process.cwd(),
    releaseRunner,
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
} else {
  await import("./main-runtime.js");
}
