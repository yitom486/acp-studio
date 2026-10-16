// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { resolveRuntimeConfig } from "../../shared/runtime-config";
import { assertPortAvailable } from "../../server/port-availability";

describe("development and release isolation", () => {
  it("uses different gateway and MCP ports in every development entry point", () => {
    const release = resolveRuntimeConfig({}, []);
    expect(release.gatewayPort).toBe(13005);
    expect(release.mcpPort).toBe(13920);
    for (const development of [
      resolveRuntimeConfig({ ACP_RUNTIME_MODE: "development" }, []),
      resolveRuntimeConfig({ ELECTRON_DEV: "1" }, []),
      resolveRuntimeConfig({}, ["--development"]),
      resolveRuntimeConfig({}, [], "development"),
    ]) {
      expect(development.gatewayPort).toBe(13015);
      expect(development.mcpPort).toBe(13930);
      expect(development.vitePort).toBe(5188);
    }
    // A packaged app cannot accidentally become a dev app through inherited mode flags.
    expect(resolveRuntimeConfig({ ELECTRON_DEV: "1" }, [], "production")).toEqual(release);
  });

  it("keeps explicit ports consistent and rejects invalid configuration", () => {
    expect(resolveRuntimeConfig({ PORT: "23105", MCP_PORT: "23930", ACP_DEV_VITE_PORT: "25188" }, [], "development"))
      .toMatchObject({ gatewayPort: 23105, mcpPort: 23930, vitePort: 25188 });
    expect(resolveRuntimeConfig({}, ["--port", "23106", "--host", "0.0.0.0"]).gatewayPort).toBe(23106);
    for (const PORT of ["", "0", "65536", "13015extra", "1.5", "-1"]) {
      expect(() => resolveRuntimeConfig({ PORT }, [])).toThrow("PORT must be an integer");
    }
    expect(() => resolveRuntimeConfig({}, ["--port"])).toThrow("requires a value");
  });

  it("reports a busy port and leaves the existing listener working", async () => {
    const owner = createServer((_request, response) => response.end("still running"));
    await new Promise<void>(resolve => owner.listen(0, "127.0.0.1", resolve));
    const { port } = owner.address() as { port: number };
    try {
      await expect(assertPortAvailable(port)).rejects.toThrow("不会自动结束已有进程");
      expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe("still running");
    } finally {
      await new Promise<void>((resolve, reject) => owner.close(error => error ? reject(error) : resolve()));
    }
    await expect(assertPortAvailable(port)).resolves.toBeUndefined();
  });
});
