import { createServer } from "node:net";

/** Check availability without terminating any process, including another Studio. */
export function assertPortAvailable(port: number, host = "127.0.0.1", service = "Gateway"): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      reject(new Error(error.code === "EADDRINUSE"
        ? `${service} 端口 ${host}:${port} 已被占用。请关闭占用该端口的实例，或设置其他端口后重试；不会自动结束已有进程。`
        : `${service} 无法监听 ${host}:${port}: ${error.message}`, { cause: error }));
    });
    probe.listen({ port, host, exclusive: true }, () => probe.close(error => error ? reject(error) : resolve()));
  });
}
