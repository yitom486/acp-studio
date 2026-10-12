/**
 * WSL distro 名解析（零依赖，前后端共用语义）。
 * 服务端全解析见 `server/universal/wsl.ts::parseWslCwd`，`http/workspace.ts`
 * 的 `parseWslDistros` 管 `wsl -l -q` 输出；这里只给“当前路径属哪个 distro”
 * 的展示用（终端徽标、状态栏远程角标），改正则记得三处一起改。
 */

/** `\\wsl$\Ubuntu\...` / `\\wsl.localhost\...` → distro 名，否则 null（纯函数，可测）。 */
export function parseWslDistro(cwd: string): string | null {
  const m = /^(?:\\\\|\/\/)(wsl\$|wsl\.localhost)[\\\/]([^\\\/]+)([\\\/].*)?$/i.exec(
    String(cwd || "").trim()
  );
  return m ? m[2] : null;
}
