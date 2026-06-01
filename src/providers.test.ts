import { describe, expect, test } from "bun:test";
import { checkProviderHealth, cleanVersionLine } from "./providers.ts";

describe("checkProviderHealth", () => {
  test("reports configured provider availability", async () => {
    const health = await checkProviderHealth({
      executablePath: async (command) => (command === "pi" ? undefined : `/bin/${command}`),
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    expect(health).toHaveLength(3);
    expect(health.map((item) => item.provider).sort()).toEqual(["claude", "codex", "pi"]);
    expect(health).toContainEqual({
      provider: "codex",
      installed: true,
      path: "/bin/codex",
      version: "codex 1.0.0",
    });
    expect(health).toContainEqual({
      provider: "pi",
      installed: false,
      error: "pi was not found on PATH",
    });
  });

  test("does not ask missing providers for versions", async () => {
    const versioned: string[] = [];
    await checkProviderHealth({
      executablePath: async () => undefined,
      commandVersion: async (command) => {
        versioned.push(command);
        return "unused";
      },
    });

    expect(versioned).toEqual([]);
  });

  test("cleans crash output from provider version probes", async () => {
    expect(cleanVersionLine("codex 1.0.0\nextra")).toBe("codex 1.0.0");
    expect(cleanVersionLine("Error: spawn codex ENOENT")).toBeUndefined();
    expect(cleanVersionLine("/opt/homebrew/bin/codex")).toBeUndefined();
    expect(cleanVersionLine("")).toBeUndefined();

    const health = await checkProviderHealth({
      executablePath: async (command) => `/bin/${command}`,
      commandVersion: async (command) => (command === "codex" ? "Error: spawn codex ENOENT" : `${command} 1.0.0`),
    });

    expect(health.find((item) => item.provider === "codex")?.version).toBeUndefined();
  });
});
