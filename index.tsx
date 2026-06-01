#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { formatCliError, formatCliHelp, parseCliArgs } from "./src/cli.ts";
import { collectDoctorReport, formatDoctorReport } from "./src/doctor.ts";
import { App } from "./src/ui.tsx";

const options = parseCliArgs(Bun.argv.slice(2));

if (options.errors.length > 0) {
  console.error(formatCliError(options.errors));
  process.exit(1);
}

if (options.action === "help") {
  console.log(formatCliHelp());
  process.exit(0);
}

if (options.action === "version") {
  const manifest = await Bun.file(new URL("./package.json", import.meta.url)).json();
  console.log(manifest.version);
  process.exit(0);
}

if (options.cwd && (options.action === "run" || options.action === "doctor")) {
  try {
    process.chdir(options.cwd);
  } catch (error) {
    console.error(formatCliError([`Cannot use cwd ${options.cwd}: ${error instanceof Error ? error.message : String(error)}`]));
    process.exit(1);
  }
}

if (options.action === "doctor") {
  const manifest = await Bun.file(new URL("./package.json", import.meta.url)).json();
  const report = await collectDoctorReport(process.cwd(), manifest.version);
  console.log(options.doctorFormat === "json" ? JSON.stringify(report, null, 2) : formatDoctorReport(report));
  process.exit(0);
}

const renderer = await createCliRenderer({
  screenMode: "alternate-screen",
  exitOnCtrlC: false,
  targetFps: 30,
  maxFps: 60,
  useMouse: true,
  useKittyKeyboard: {
    disambiguate: true,
    alternateKeys: true,
  },
});

const root = createRoot(renderer);

root.render(
  <App
    onExit={() => {
      root.unmount();
      renderer.destroy();
    }}
  />,
);
