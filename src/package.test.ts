import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";

const root = resolve(import.meta.dir, "..");

test("package bin entry points at the executable CLI file", async () => {
  const manifest = await Bun.file(resolve(root, "package.json")).json();
  const binPath = resolve(root, manifest.bin.amux);
  const source = readFileSync(binPath, "utf8");

  expect(manifest.bin.amux).toBe("./index.tsx");
  expect(source.startsWith("#!/usr/bin/env bun\n")).toBe(true);

  if (process.platform !== "win32") {
    expect(statSync(binPath).mode & 0o111).not.toBe(0);
  }
});

test("package manifest includes release metadata for public publishing", async () => {
  const manifest = await Bun.file(resolve(root, "package.json")).json();

  expect(manifest.license).toBe("MIT");
  expect(manifest.packageManager).toMatch(/^bun@\d+\.\d+\.\d+/);
  expect(manifest.engines).toMatchObject({ bun: ">=1.3.0", node: ">=18" });
  expect(manifest.scripts["smoke:help"]).toBe("bun ./index.tsx --help");
  expect(manifest.scripts["smoke:doctor"]).toBe("bun ./index.tsx --doctor --cwd .");
  expect(manifest.scripts["smoke:doctor:json"]).toBe("bun ./index.tsx --doctor --json --cwd .");
  expect(manifest.scripts["smoke:version"]).toBe("bun ./index.tsx --version");
  expect(manifest.scripts["release:check"]).toContain("bun run smoke:help");
  expect(manifest.scripts["release:check"]).toContain("bun run smoke:doctor");
  expect(manifest.scripts["release:check"]).toContain("bun run smoke:doctor:json");
  expect(manifest.scripts["release:check"]).toContain("bun run smoke:version");
  expect(manifest.publishConfig).toEqual({ access: "public" });
  expect(manifest.files).toContain("docs");
  expect(manifest.files).toContain("README.md");
  expect(manifest.files).toContain("LICENSE");
});

test("release docs include issue-reporting guidance", () => {
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  const issueReports = readFileSync(resolve(root, "docs/ISSUE_REPORTS.md"), "utf8");

  expect(readme).toContain("docs/ISSUE_REPORTS.md");
  expect(issueReports).toContain("amux --doctor --json");
  expect(issueReports).toContain("terminal app and size");
});
