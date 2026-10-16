export type RuntimeMode = "development" | "production";

function port(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return Number(value);
}

/** Shared by the launcher, gateways and Vite so HTTP and terminal traffic agree. */
export function resolveRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
  args: string[] = process.argv,
  mode?: RuntimeMode,
) {
  const development = (mode ?? (env.ACP_RUNTIME_MODE === "development" || env.ELECTRON_DEV === "1" || args.includes("--development")
    ? "development" : "production")) === "development";
  const argument = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
    return args[index + 1];
  };
  return {
    mode: development ? "development" as const : "production" as const,
    gatewayPort: port(env.PORT ?? argument("--port"), development ? 13015 : 13005, "PORT"),
    mcpPort: port(env.MCP_PORT, development ? 13930 : 13920, "MCP_PORT"),
    vitePort: port(env.ACP_DEV_VITE_PORT, 5188, "ACP_DEV_VITE_PORT"),
    host: env.HOST || argument("--host") || "127.0.0.1",
  };
}
