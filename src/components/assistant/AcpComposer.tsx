import React, { useEffect, useRef, useState } from "react";
import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { Brain, Command, Cpu, ImagePlus, LayoutGrid, Paperclip, Send, Settings2, ShieldCheck, Square, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedShinyText } from "@/components/magicui/animated-shiny-text";
import { configCurrentValue, findConfigOption, extractModelThinking, type Attachment, type ConfigOptionLike, type ModelCatalogEntry } from "@/lib/universal-api";

export interface AcpComposerProps {
  onSendAttachmentOnly: () => void;
  onClear: () => void;
  isStreaming: boolean;
  commands: Array<{ name: string; description?: string }>;
  supportImage: boolean;
  attachments: Attachment[];
  setAttachments: (a: Attachment[]) => void;
  agentTitle: string;
  configOptions?: ConfigOptionLike[] | null;
  onSetConfig?: (configId: string, value: unknown) => void;
  onBrowseModels?: () => void;
  hasModelCatalog?: boolean;
  connected?: boolean;
  fallbackModels?: ModelCatalogEntry[] | null;
  fallbackCurrentModel?: string;
  onFallbackModel?: (modelId: string) => void;
  onEnsureSession?: () => void;
  /** session/new 在途：模型区显示加载态而非“点击加载”。 */
  sessionLoading?: boolean;
}

const TEXTISH = /^(text\/|application\/(json|javascript|typescript|xml|x-www-form-urlencoded)|.*\+(json|xml)$)/;

function readFile(file: File, supportImage: boolean): Promise<{ text?: string; dataUrl?: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("读取文件失败"));
    if (file.type.startsWith("image/") && supportImage) {
      r.onload = () => resolve({ dataUrl: String(r.result || "") });
      r.readAsDataURL(file);
    } else if (TEXTISH.test(file.type) || file.type === "") {
      r.onload = () => resolve({ text: String(r.result || "") });
      r.readAsText(file);
    } else if (file.size < 512 * 1024) {
      r.onload = () => resolve({ text: String(r.result || "") });
      r.readAsText(file);
    } else {
      r.onload = () => resolve({ dataUrl: String(r.result || "") });
      r.readAsDataURL(file);
    }
  });
}

function curVal(opt: ConfigOptionLike): string {
  return configCurrentValue(opt);
}

function pickRole(options: ConfigOptionLike[] | null | undefined, role: "model" | "thinking" | "permission"): ConfigOptionLike | undefined {
  return findConfigOption(options, role);
}

/**
 * 大图发送前客户端压缩：最长边 >1600px 时等比缩放 (canvas)，jpeg/webp
 * 质量 0.85。失败时抛给调用方 fallback 原图 (best-effort，不阻断发送)。
 */
async function downscaleImage(dataUrl: string, mimeType: string): Promise<string> {
  const MAX_DIM = 1600;
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  if (bitmap.width <= MAX_DIM && bitmap.height <= MAX_DIM) {
    bitmap.close();
    return dataUrl;
  }
  const scale = MAX_DIM / Math.max(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return dataUrl;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const quality = mimeType === "image/jpeg" || mimeType === "image/webp" ? 0.85 : undefined;
  return canvas.toDataURL(mimeType, quality);
}

export const AcpComposer: React.FC<AcpComposerProps> = (p) => {
  const aui = useAui();
  const composerText = useAuiState((s) => s.composer.text);
  const canCancel = useAuiState((s) => s.composer.canCancel);
  const fileRef = useRef<HTMLInputElement>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const token = (() => {
    const m = composerText.match(/(^|\s)(\/[A-Za-z0-9_-]*)$/);
    return m ? m[2] : null;
  })();
  const filtered = token ? p.commands.filter((c) => (`/${c.name}`.startsWith(token) || c.name.startsWith(token.slice(1)))) : [];
  const showSlash = !!token && filtered.length > 0 && !p.isStreaming;

  useEffect(() => {
    setSlashIdx(0);
    setSlashOpen(showSlash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, p.commands.length]);

  const applyCommand = (name: string) => {
    const full = name.startsWith("/") ? name : `/${name}`;
    aui.composer.setText(composerText.replace(/(^|\s)(\/[A-Za-z0-9_-]*)$/, `$1${full} `));
    setSlashOpen(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Tab" && token && token.length > 1) {
        e.preventDefault();
        applyCommand(filtered[slashIdx].name);
        return;
      }
      if (e.key === "Escape") {
        setSlashOpen(false);
        return;
      }
    }
  };

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const next = [...p.attachments];
    for (const file of Array.from(files)) {
      try {
        const { text, dataUrl } = await readFile(file, p.supportImage);
        const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (file.type.startsWith("image/") && p.supportImage && dataUrl) {
          let payload = dataUrl.split(",")[1] || "";
          let size = file.size;
          let preview: string | undefined = URL.createObjectURL(file);
          try {
            const small = await downscaleImage(dataUrl, file.type);
            payload = small.split(",")[1] || payload;
            size = Math.round((payload.length * 3) / 4);
          } catch (err) {
            console.debug("[AcpComposer] 图片压缩失败，已回退原图 (已忽略):", err);
          }
          next.push({ id, name: file.name, mimeType: file.type, size, preview, block: { type: "image", data: payload, mimeType: file.type } });
        } else if (text !== undefined && (TEXTISH.test(file.type) || file.type === "" || file.size < 512 * 1024)) {
          next.push({ id, name: file.name, mimeType: file.type || "text/plain", size: file.size, block: { type: "resource", resource: { uri: `file:///${file.name}`, mimeType: file.type || "text/plain", text } } });
        } else {
          next.push({ id, name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, block: { type: "resource_link", name: file.name, uri: `file:///${file.name}`, mimeType: file.type || undefined, size: file.size } });
        }
      } catch (err: any) {
        alert(`附件 ${file.name} 读取失败: ${err.message}`);
      }
    }
    p.setAttachments(next);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  };

  const removeAttachment = (id: string) => {
    const target = p.attachments.find((a) => a.id === id);
    if (target?.preview) URL.revokeObjectURL(target.preview);
    p.setAttachments(p.attachments.filter((x) => x.id !== id));
  };

  const modelOpt = pickRole(p.configOptions, "model");
  const thinkOpt = pickRole(p.configOptions, "thinking");
  const permOpt = pickRole(p.configOptions, "permission");
  const otherOpts = (p.configOptions || []).filter((o) => o !== modelOpt && o !== thinkOpt && o !== permOpt);
  const currentModelValue = modelOpt ? curVal(modelOpt) : (p.fallbackCurrentModel || "");
  const modelThinking = extractModelThinking(currentModelValue);

  const muted = (text: string, title?: string) => (
    <span className="text-[11px] text-muted-foreground font-mono" title={title}>{text}</span>
  );

  const renderFallbackModel = () => {
    const list = p.fallbackModels || [];
    if (list.length === 0) {
      if (p.sessionLoading) {
        return (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="正在创建会话以加载可用模型">
            <Cpu className="w-3.5 h-3.5 text-primary animate-pulse shrink-0" />
            <AnimatedShinyText className="text-[11px]">模型加载中…</AnimatedShinyText>
          </span>
        );
      }
      return (
        <button type="button" onClick={() => p.onEnsureSession?.()} title="点击创建会话以加载可用模型" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors cursor-pointer">
          <Cpu className="w-3.5 h-3.5" />点击加载模型
        </button>
      );
    }
    return (
      <label className="flex items-center gap-1 text-xs text-muted-foreground" title="该 Agent 未提供模型配置项，使用会话模型目录切换">
        <Cpu className="w-3.5 h-3.5 text-primary shrink-0" />
        <select value={p.fallbackCurrentModel || ""} disabled={p.isStreaming} onChange={(e) => e.target.value && p.onFallbackModel?.(e.target.value)} className="bg-transparent border-0 rounded-lg px-1 py-1 text-xs font-medium text-foreground outline-none cursor-pointer max-w-[170px] disabled:opacity-50 hover:bg-muted/80">
          {list.map((m) => (
            <option key={m.modelId} value={m.modelId} className="bg-card" title={m.description}>{m.name || m.modelId}</option>
          ))}
        </select>
      </label>
    );
  };

  const renderOptionItem = (o: any) => {
    if (o && Array.isArray(o.options)) {
      return (
        <optgroup key={o.group || o.name} label={o.name || o.group} className="bg-card font-semibold text-muted-foreground">
          {o.options.map((sub: any) => (
            <option key={String(sub.value)} value={String(sub.value)} className="bg-card font-normal text-foreground" title={sub.description}>{sub.name || sub.value}</option>
          ))}
        </optgroup>
      );
    }
    return (
      <option key={String(o.value)} value={String(o.value)} className="bg-card font-normal text-foreground" title={o.description}>{o.name || o.value}</option>
    );
  };

  const renderSelect = (opt: ConfigOptionLike, icon: React.ReactNode) => (
    <label key={opt.id} className="flex items-center gap-1 text-xs text-muted-foreground" title={opt.description || opt.name}>
      {icon}
      <select value={curVal(opt)} disabled={p.isStreaming} onChange={(e) => p.onSetConfig?.(opt.id, e.target.value)} className="bg-transparent border-0 rounded-lg px-1 py-1 text-xs font-medium text-foreground outline-none cursor-pointer max-w-[170px] disabled:opacity-50 hover:bg-muted/80">
        {(opt.options || []).map(renderOptionItem)}
      </select>
    </label>
  );

  const canSendText = composerText.trim().length > 0;
  const canSendAny = canSendText || p.attachments.length > 0;

  const handleSendClick = () => {
    if (canSendText) aui.composer.send();
    else if (p.attachments.length > 0) p.onSendAttachmentOnly();
  };

  return (
    <div className="p-4 md:p-5 bg-background/90 border-t border-border/80 shrink-0">
      <div className="max-w-4xl mx-auto space-y-2">
        {p.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {p.attachments.map((a) => (
              <span key={a.id} className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg bg-muted/80 border border-border text-[11px] font-mono text-muted-foreground">
                {a.preview ? (
                  <img src={a.preview} alt={a.name} className="w-8 h-8 rounded object-cover" />
                ) : String((a.block as any).type) === "image" ? (
                  <ImagePlus className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <Paperclip className="w-3.5 h-3.5 text-primary" />
                )}
                <span className="max-w-[160px] truncate" title={`${a.name} (${a.mimeType}, ${(a.size / 1024).toFixed(1)}KB)`}>{a.name}</span>
                <button onClick={() => removeAttachment(a.id)} className="text-muted-foreground hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <ComposerPrimitive.Root>
          <div
            className={`relative flex flex-col rounded-2xl border bg-card/90 shadow-2xl focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-ring/20 transition-all ${dragOver ? "border-primary border-dashed" : canCancel ? "border-primary/50 shadow-primary/10" : "border-border/80"}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer?.files); }}
          >
            {dragOver && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-muted/70 text-sm text-primary pointer-events-none">
                松开以添加文件 / 图片附件
              </div>
            )}
            {slashOpen && (
              <div className="absolute bottom-full mb-1.5 left-2 right-2 rounded-xl border border-border bg-background/95 shadow-xl overflow-hidden z-20">
                {filtered.slice(0, 8).map((c, i) => (
                  <div key={c.name} onClick={() => applyCommand(c.name)} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs ${i === slashIdx ? "bg-muted/70 text-primary" : "text-muted-foreground"}`}>
                    <Command className="w-3 h-3 text-muted-foreground" />
                    <span className="font-mono font-semibold">/{c.name}</span>
                    <span className="truncate text-muted-foreground">{c.description || ""}</span>
                  </div>
                ))}
              </div>
            )}
            <ComposerPrimitive.Input
              rows={1}
              onKeyDown={handleInputKeyDown}
              onPaste={handlePaste}
              placeholder={p.isStreaming ? `${p.agentTitle} 正在响应中…可继续编辑，结束后发送` : `随便问点什么，/ 可查看命令，拖拽/粘贴可添加图片文件…`}
              className="w-full resize-none bg-transparent px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none max-h-48 min-h-[48px]"
            />
            <div className="flex items-center gap-1.5 px-3.5 pb-2.5 pt-1 text-xs">
              <div className="flex items-center gap-1">
                <input ref={fileRef} type="file" multiple accept={p.supportImage ? undefined : ".txt,.md,.json,.js,.ts,.tsx,.py,.log,.csv"} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <button type="button" onClick={() => fileRef.current?.click()} title={p.supportImage ? "附加文件或图片（可拖拽 / 粘贴）" : "附加文本文件（该 Agent 不支持图片输入）"} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted/80 transition-colors text-lg leading-none">+</button>
                <button type="button" onClick={() => aui.composer.setText("/" + composerText.trimStart())} title="唤出 Slash 快捷命令菜单" className="px-1.5 py-1 rounded-md text-xs font-mono font-bold text-muted-foreground hover:text-primary hover:bg-muted/80 transition-colors leading-none">/</button>
              </div>
              {p.connected && (
                <>
                  {modelOpt ? renderSelect(modelOpt, <Cpu className="w-3.5 h-3.5 text-primary shrink-0" />) : renderFallbackModel()}
                  {thinkOpt ? (
                    renderSelect(thinkOpt, <Brain className="w-3.5 h-3.5 text-primary shrink-0" />)
                  ) : modelThinking ? (
                    <span className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground" title={`当前模型内置思考参数: ${modelThinking} (跟随模型切换)`}>
                      <Brain className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                      思考: {modelThinking}
                    </span>
                  ) : (
                    muted("思考：—", "该 Agent 未提供独立思考等级配置")
                  )}
                  {permOpt ? renderSelect(permOpt, <ShieldCheck className="w-3.5 h-3.5 text-warning shrink-0" />) : muted("权限：—", "该 Agent 未提供权限配置")}
                  {otherOpts.map((opt) =>
                    opt.type === "boolean" ? (
                      <label key={opt.id} className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none" title={opt.description || opt.name}>
                        <input type="checkbox" checked={Boolean(opt.currentValue)} disabled={p.isStreaming} onChange={(e) => p.onSetConfig?.(opt.id, e.target.checked)} className="rounded border-border text-primary focus:ring-primary/20" />
                        <span className="text-[11px] font-medium">{opt.name || opt.id}</span>
                      </label>
                    ) : (
                      renderSelect(opt, <Settings2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />)
                    )
                  )}
                </>
              )}
              {p.onBrowseModels && (
                <button type="button" onClick={p.onBrowseModels} title={p.hasModelCatalog ? "浏览 / 重新发现模型库" : "发现可用模型"} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted/80 transition-colors">
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
              )}
              {!p.connected && (
                <span className="font-mono text-[11px] text-muted-foreground hidden sm:inline">Enter 发送 · Shift+Enter 换行 · / 命令联想</span>
              )}
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <button type="button" onClick={p.onClear} disabled={p.isStreaming} title="清空聊天记录" className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted/80 transition-colors disabled:opacity-40">
                  <Trash2 className="w-4 h-4" />
                </button>
                {canCancel ? (
                  <ComposerPrimitive.Cancel asChild>
                    <Button size="sm" variant="destructive" className="h-8 gap-1.5 rounded-lg text-xs">
                      <Square className="w-3.5 h-3.5 fill-current" /> 停止
                    </Button>
                  </ComposerPrimitive.Cancel>
                ) : (
                  <Button size="sm" variant="default" onClick={handleSendClick} disabled={!canSendAny || p.isStreaming} className="h-8 gap-1.5 rounded-lg text-xs font-semibold">
                    <Send className="w-3.5 h-3.5" /> 发送
                  </Button>
                )}
              </div>
            </div>
          </div>
        </ComposerPrimitive.Root>
      </div>
    </div>
  );
};
