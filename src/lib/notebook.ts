/** .ipynb 解析（纯函数，可单测）：nbformat v4 → 视图模型。 */
import type { INotebookContent, ICell, IOutput, MultilineString } from "@jupyterlab/nbformat";

export const joinText = (s: MultilineString | undefined | null): string => (Array.isArray(s) ? s.join("") : s ?? "");
// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

export type OutputView =
  | { kind: "text"; text: string; stream?: "stdout" | "stderr" }
  | { kind: "image"; mime: string; src: string }
  | { kind: "html"; html: string }
  | { kind: "markdown"; text: string }
  | { kind: "error"; ename: string; evalue: string; traceback: string }
  | { kind: "unsupported"; mimes: string[] };

export interface CellView {
  index: number;
  type: "code" | "markdown" | "raw";
  source: string;
  executionCount: number | null;
  outputs: OutputView[];
}

export interface NotebookView {
  language: string;
  nbformat: number;
  cells: CellView[];
}

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

/** 按 Jupyter 的优先级挑一种 MIME 渲染。 */
export function pickOutput(data: Record<string, unknown>): OutputView {
  for (const mime of IMAGE_MIMES) {
    const v = data[mime];
    if (v == null) continue;
    const raw = joinText(v as MultilineString).trim();
    if (mime === "image/svg+xml") return { kind: "image", mime, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}` };
    return { kind: "image", mime, src: `data:${mime};base64,${raw.replace(/\s+/g, "")}` };
  }
  if (data["text/html"] != null) return { kind: "html", html: joinText(data["text/html"] as MultilineString) };
  if (data["text/markdown"] != null) return { kind: "markdown", text: joinText(data["text/markdown"] as MultilineString) };
  if (data["text/plain"] != null) return { kind: "text", text: stripAnsi(joinText(data["text/plain"] as MultilineString)) };
  if (data["application/json"] != null) return { kind: "text", text: JSON.stringify(data["application/json"], null, 2) };
  return { kind: "unsupported", mimes: Object.keys(data) };
}

export function outputView(o: IOutput): OutputView {
  switch (o.output_type) {
    case "stream":
      return { kind: "text", text: stripAnsi(joinText((o as any).text)), stream: (o as any).name === "stderr" ? "stderr" : "stdout" };
    case "error":
      return { kind: "error", ename: String((o as any).ename ?? ""), evalue: String((o as any).evalue ?? ""), traceback: stripAnsi(((o as any).traceback ?? []).join("\n")) };
    case "execute_result":
    case "display_data":
      return pickOutput(((o as any).data ?? {}) as Record<string, unknown>);
    default:
      return { kind: "unsupported", mimes: [String(o.output_type)] };
  }
}

export function parseNotebook(text: string): NotebookView {
  let nb: INotebookContent;
  try {
    nb = JSON.parse(text);
  } catch (e) {
    throw new Error(`不是有效的 .ipynb（JSON 解析失败：${(e as Error).message}）`);
  }
  if (!nb || !Array.isArray(nb.cells)) throw new Error("不是有效的 .ipynb：缺少 cells");
  if (typeof nb.nbformat === "number" && nb.nbformat < 4) throw new Error(`暂不支持 nbformat ${nb.nbformat}（只支持 v4）`);
  const meta = (nb.metadata ?? {}) as any;
  const language = String(meta.language_info?.name || meta.kernelspec?.language || "python").toLowerCase();
  const cells: CellView[] = (nb.cells as ICell[]).map((c, index) => ({
    index,
    type: c.cell_type === "code" ? "code" : c.cell_type === "markdown" ? "markdown" : "raw",
    source: joinText(c.source as MultilineString),
    executionCount: c.cell_type === "code" ? ((c as any).execution_count ?? null) : null,
    outputs: c.cell_type === "code" ? (((c as any).outputs ?? []) as IOutput[]).map(outputView) : [],
  }));
  return { language, nbformat: Number(nb.nbformat ?? 4), cells };
}
