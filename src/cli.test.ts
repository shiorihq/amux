import { expect, test } from "bun:test";
import { formatCliError, formatCliHelp, parseCliArgs } from "./cli.ts";

test("parseCliArgs defaults to launching the TUI", () => {
  expect(parseCliArgs([])).toEqual({ action: "run", doctorFormat: "text", errors: [] });
});

test("parseCliArgs supports help, version, doctor, and JSON doctor output", () => {
  expect(parseCliArgs(["--help"]).action).toBe("help");
  expect(parseCliArgs(["-v"]).action).toBe("version");
  expect(parseCliArgs(["--doctor"])).toEqual({ action: "doctor", doctorFormat: "text", errors: [] });
  expect(parseCliArgs(["--doctor", "--json"])).toEqual({ action: "doctor", doctorFormat: "json", errors: [] });
  expect(parseCliArgs(["--doctor=json"])).toEqual({ action: "doctor", doctorFormat: "json", errors: [] });
});

test("parseCliArgs supports explicit project cwd", () => {
  expect(parseCliArgs(["--cwd", "/repo/app"])).toEqual({ action: "run", doctorFormat: "text", cwd: "/repo/app", errors: [] });
  expect(parseCliArgs(["--doctor", "--cwd=/repo/app"])).toEqual({ action: "doctor", doctorFormat: "text", cwd: "/repo/app", errors: [] });
});

test("parseCliArgs rejects unknown options and JSON without doctor", () => {
  expect(parseCliArgs(["--wat"]).errors).toEqual(["Unknown option: --wat"]);
  expect(parseCliArgs(["--json"]).errors).toContain("--json can only be used with --doctor");
  expect(parseCliArgs(["--cwd"]).errors).toContain("--cwd requires a path");
});

test("CLI formatting points users back to help", () => {
  expect(formatCliHelp()).toContain("amux [options]");
  expect(formatCliHelp()).toContain("current-project root histories and starters");
  expect(formatCliHelp()).toContain("move while the filter is empty");
  expect(formatCliHelp()).toContain("next visible provider group");
  expect(formatCliHelp()).toContain("open action palette");
  expect(formatCliHelp()).toContain("--json");
  expect(formatCliHelp()).toContain("--cwd <path>");
  expect(formatCliError(["Unknown option: --wat"])).toContain("Run `amux --help`");
});
