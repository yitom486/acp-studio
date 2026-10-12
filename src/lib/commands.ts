/**
 * 命令注册表：原生菜单（app:command）、标题栏菜单、命令面板、快捷键都调用这里，
 * 同一个功能只实现一次。
 */
export interface Command {
  id: string;
  title: string;
  /** 分组（命令面板里显示） */
  group?: string;
  /** 展示用快捷键，如 "Ctrl+Shift+P"（mac 自动换成 ⌘） */
  keybinding?: string;
  when?: () => boolean;
  /** 不在命令面板 / 菜单中显示（只供原生菜单带参数调用） */
  hidden?: boolean;
  run: (payload?: unknown) => void | Promise<void>;
}

const registry = new Map<string, Command>();
const listeners = new Set<() => void>();

export function registerCommands(cmds: Command[]): () => void {
  for (const c of cmds) registry.set(c.id, c);
  listeners.forEach((l) => l());
  return () => {
    for (const c of cmds) if (registry.get(c.id) === c) registry.delete(c.id);
    listeners.forEach((l) => l());
  };
}

export function listCommands(): Command[] {
  return [...registry.values()].filter((c) => !c.hidden && (!c.when || c.when()));
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

export async function runCommand(id: string, payload?: unknown): Promise<boolean> {
  const c = registry.get(id);
  if (!c || (c.when && !c.when())) return false;
  await c.run(payload);
  return true;
}

export function subscribeCommands(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
export function formatKey(k?: string): string {
  if (!k) return "";
  return isMac ? k.replace(/Ctrl\+/g, "⌘").replace(/Shift\+/g, "⇧").replace(/Alt\+/g, "⌥") : k;
}

/** 键盘事件是否匹配 "Ctrl+Shift+P" 这种描述（mac 上 Ctrl 视为 ⌘）。 */
export function matchesKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">, k: string, mac = isMac): boolean {
  const parts = k.split("+");
  const key = parts.pop()!.toLowerCase();
  const want = { ctrl: parts.includes("Ctrl"), shift: parts.includes("Shift"), alt: parts.includes("Alt") };
  const primary = mac ? e.metaKey : e.ctrlKey;
  const ek = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  return primary === want.ctrl && e.shiftKey === want.shift && e.altKey === want.alt && (ek === key || (key === "`" && ek === "`"));
}
