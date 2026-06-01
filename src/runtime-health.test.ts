import { expect, test } from "bun:test";
import { checkRuntimeHealth } from "./runtime-health.ts";

test("checkRuntimeHealth reports Node availability", async () => {
  const health = await checkRuntimeHealth({
    executablePath: async () => "/usr/bin/node",
    commandVersion: async () => "v25.0.0",
  });

  expect(health.node).toEqual({
    installed: true,
    path: "/usr/bin/node",
    version: "v25.0.0",
  });
});

test("checkRuntimeHealth reports missing Node", async () => {
  const health = await checkRuntimeHealth({
    executablePath: async () => undefined,
    commandVersion: async () => {
      throw new Error("should not check version");
    },
  });

  expect(health.node).toEqual({
    installed: false,
    error: "node was not found on PATH",
  });
});
