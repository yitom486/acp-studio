/** KaTeX 按需加载：第一次遇到公式时才下载 remark-math + rehype-katex + 样式。 */
import type { PluggableList } from "unified";

export interface MathPlugins {
  remark: PluggableList;
  rehype: PluggableList;
  preprocess: (t: string) => string;
}

let loaded: MathPlugins | null = null;
let pending: Promise<MathPlugins> | null = null;
const listeners = new Set<() => void>();

export function getMathPlugins(): MathPlugins | null {
  return loaded;
}

export function loadMathPlugins(): Promise<MathPlugins> {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    pending = Promise.all([
      import("remark-math"),
      import("rehype-katex"),
      import("katex/dist/katex.min.css"),
      import("@assistant-ui/react-markdown"),
    ]).then(([rm, rk, , md]) => {
      loaded = {
        remark: [rm.default],
        rehype: [[rk.default, { throwOnError: false, strict: "ignore", output: "htmlAndMathml" }]],
        preprocess: md.normalizeMathDelimiters,
      };
      listeners.forEach((l) => l());
      return loaded;
    });
  }
  return pending;
}

export function subscribeMath(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
