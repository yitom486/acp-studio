import React, { useEffect, useRef, useState } from "react";
import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import {
  Brain,
  Command,
  Cpu,
  ImagePlus,
  LayoutGrid,
  Paperclip,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  X,
  ChevronDown,
  ArrowRight,
  Laptop,
  Mic,
  FolderOpen,
  FileDiff,
  Terminal,
  ExternalLink,
  Folder,
  Clock,
  Check,
  FileText,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedShinyText } from "@/components/magicui/animated-shiny-text";
import { configCurrentValue, findConfigOption, extractModelThinking, searchWorkspaceFiles, readWorkspaceFile, type Attachment, type ConfigOptionLike, type ModelCatalogEntry, type WorkspaceFileEntry } from "@/lib/universal-api";
import { matchMentionToken, applyMentionInsert, buildMentionAttachment, formatFileSize } from "@/lib/mention";

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
  /** 中断当前生成（插队发送用；需等待其落定再发送）。 */
  onStop?: () => Promise<void>;
  currentWorkspace?: string | null;
  recentWorkspaces?: Array<{ path: string; name: string; lastOpened: number }>;
  onSelectWorkspace?: (path: string, name?: string) => void;
  onOpenChanges?: () => void;
  onToggleTerminal?: () => void;
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
  // @-mention workspace files (gateway search, debounced)
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionItems, setMentionItems] = useState<WorkspaceFileEntry[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionTruncated, setMentionTruncated] = useState(false);
  const mentionReqRef = useRef(0);
  const [localMenuOpen, setLocalMenuOpen] = useState(false);
  const localMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (localMenuRef.current && !localMenuRef.current.contains(e.target as Node)) {
        setLocalMenuOpen(false);
      }
    };
    if (localMenuOpen) document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [localMenuOpen]);

  const handleOpenFolder = async () => {
    setLocalMenuOpen(false);
    if (window.acpStudio?.openDirectory) {
      try {
        const chosen = await window.acpStudio.openDirectory();
        if (chosen) p.onSelectWorkspace?.(chosen);
      } catch (err: any) {
        alert("打开文件夹失败: " + err.message);
      }
      return;
    }
    const input = prompt("请输入工作区绝对路径:", p.currentWorkspace || "");
    if (input?.trim()) p.onSelectWorkspace?.(input.trim());
  };

  const handleRevealInExplorer = async () => {
    setLocalMenuOpen(false);
    if (p.currentWorkspace && window.acpStudio?.openPath) {
      await window.acpStudio.openPath(p.currentWorkspace);
    }
  };

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

  const mentionToken = matchMentionToken(composerText);
  const mentionQuery = mentionToken ? mentionToken.slice(1) : null;

  // Debounced gateway file search for the trailing @-token.
  useEffect(() => {
    setMentionIdx(0);
    if (!mentionToken || p.isStreaming) {
      setMentionOpen(false);
      setMentionItems([]);
      return;
    }
    setMentionOpen(true);
    const cwd = p.currentWorkspace;
    if (!cwd) {
      setMentionItems([]);
      return;
    }
    setMentionLoading(true);
    const myReq = ++mentionReqRef.current;
    const t = setTimeout(() => {
      searchWorkspaceFiles(cwd, mentionQuery || "", 8)
        .then((res) => {
          if (mentionReqRef.current !== myReq) return;
          setMentionItems(res.files);
          setMentionTruncated(res.truncated);
        })
        .catch((err) => {
          if (mentionReqRef.current !== myReq) return;
          console.debug("[AcpComposer] @ 文件搜索失败 (已忽略):", err);
          setMentionItems([]);
        })
        .finally(() => {
          if (mentionReqRef.current === myReq) setMentionLoading(false);
        });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionToken, p.currentWorkspace, p.isStreaming]);

  const applyMention = async (filePath: string) => {
    const cwd = p.currentWorkspace;
    if (!cwd) return;
    setMentionOpen(false);
    try {
      const f = await readWorkspaceFile(cwd, filePath);
      p.setAttachments([...p.attachments, buildMentionAttachment(f)]);
      aui.composer.setText(applyMentionInsert(composerText, filePath));
    } catch (err: any) {
      alert(`引用 ${filePath} 失败: ${err.message}`);
    }
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
    if (mentionOpen && mentionItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => (i + 1) % mentionItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => (i - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      // Tab 选中文件 (Enter 始终发送，与 primitive 发送不冲突)。
      if (e.key === "Tab") {
        e.preventDefault();
        void applyMention(mentionItems[mentionIdx].path);
        return;
      }
      if (e.key === "Escape") {
        setMentionOpen(false);
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

  // 插队发送：中断当前生成，清空跑道后立即发送（排队中的旧消息随后继续）。
  const handleSteer = async () => {
    if (!canSendText) return;
    await p.onStop?.();
    aui.composer.send();
  };

  return (
    <div className="p-4 md:p-6 bg-background shrink-0 select-none">
      <div className="max-w-3xl mx-auto space-y-2">
        {p.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {p.attachments.map((a) => (
              <span key={a.id} className="flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-md bg-muted/70 border border-border text-[11px] font-mono text-muted-foreground">
                {a.preview ? (
                  <img src={a.preview} alt={a.name} className="w-6 h-6 rounded object-cover" />
                ) : String((a.block as any).type) === "image" ? (
                  <ImagePlus className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <Paperclip className="w-3.5 h-3.5 text-primary" />
                )}
                <span className="max-w-[160px] truncate" title={`${a.name} (${a.mimeType}, ${(a.size / 1024).toFixed(1)}KB)`}>{a.name}</span>
                <button onClick={() => removeAttachment(a.id)} className="text-muted-foreground hover:text-destructive ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <ComposerPrimitive.Root>
          <div
            className={`relative flex flex-col rounded-2xl border bg-card shadow-xs transition-all ${
              dragOver
                ? "border-primary border-dashed ring-1 ring-primary/20"
                : canCancel
                ? "border-primary/50"
                : "border-border hover:border-border/80 focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-ring/20"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer?.files); }}
          >
            {dragOver && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-muted/80 text-xs text-primary pointer-events-none">
                松开以添加文件 / 图片附件
              </div>
            )}
            {slashOpen && (
              <div className="absolute bottom-full mb-1.5 left-2 right-2 rounded-xl border border-border bg-popover shadow-lg overflow-hidden z-20">
                {filtered.slice(0, 8).map((c, i) => (
                  <div key={c.name} onClick={() => applyCommand(c.name)} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs ${i === slashIdx ? "bg-muted text-foreground font-medium" : "text-muted-foreground"}`}>
                    <Command className="w-3 h-3 text-muted-foreground" />
                    <span className="font-mono font-semibold">/{c.name}</span>
                    <span className="truncate text-muted-foreground">{c.description || ""}</span>
                  </div>
                ))}
              </div>
            )}
            {mentionOpen && (
              <div className="absolute bottom-full mb-1.5 left-2 right-2 rounded-xl border border-border bg-popover shadow-lg overflow-hidden z-20">
                {!p.currentWorkspace ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">先选择工作区，才能引用其中的文件</div>
                ) : mentionLoading && mentionItems.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground animate-pulse">正在搜索文件…</div>
                ) : mentionItems.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">无匹配文件（Tab 无效，继续输入过滤）</div>
                ) : (
                  <>
                    {mentionItems.slice(0, 8).map((f, i) => (
                      <div key={f.path} onClick={() => applyMention(f.path)} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs ${i === mentionIdx ? "bg-muted text-foreground font-medium" : "text-muted-foreground"}`}>
                        <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="font-mono truncate flex-1" title={f.path}>{f.path}</span>
                        <span className="font-mono text-[10px] text-muted-foreground/70 shrink-0 tabular-nums">{formatFileSize(f.size)}</span>
                      </div>
                    ))}
                    {mentionTruncated && (
                      <div className="px-3 py-1 text-[10px] font-mono text-muted-foreground/70 border-t border-border/60">仅显示前 8 个，继续输入过滤</div>
                    )}
                  </>
                )}
              </div>
            )}
            <ComposerPrimitive.Input
              rows={1}
              onKeyDown={handleInputKeyDown}
              onPaste={handlePaste}
              placeholder={p.isStreaming ? `${p.agentTitle} 正在响应中…可继续编辑，发送将排队；或点插队立即打断` : `Ask anything, @ to mention, / for actions (随便问点什么)`}
              className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none max-h-48 min-h-[46px]"
            />
            <div className="flex items-center justify-between px-3 pb-2 pt-1 text-xs gap-2">
              {/* Left actions: + Attachment, Models, Thinking, Settings */}
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <input ref={fileRef} type="file" multiple accept={p.supportImage ? undefined : ".txt,.md,.json,.js,.ts,.tsx,.py,.log,.csv"} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  title={p.supportImage ? "附加文件或图片（可拖拽 / 粘贴）" : "附加文本文件"}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors text-base"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => aui.composer.setText("/" + composerText.trimStart())}
                  title="唤出 Slash 快捷命令菜单"
                  className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-mono font-bold text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                >
                  /
                </button>

                {p.connected && (
                  <>
                    <div className="flex items-center gap-1 bg-muted/40 hover:bg-muted/70 px-2 py-0.5 rounded-md border border-border/60 transition-colors">
                      {modelOpt ? renderSelect(modelOpt, <Cpu className="w-3 h-3 text-muted-foreground shrink-0" />) : renderFallbackModel()}
                    </div>
                    {thinkOpt ? (
                      <div className="flex items-center gap-1 bg-muted/40 hover:bg-muted/70 px-2 py-0.5 rounded-md border border-border/60 transition-colors">
                        {renderSelect(thinkOpt, <Brain className="w-3 h-3 text-muted-foreground shrink-0" />)}
                      </div>
                    ) : modelThinking ? (
                      <span className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground px-1.5 py-0.5" title={`思考: ${modelThinking}`}>
                        <Brain className="w-3 h-3 text-muted-foreground shrink-0" />
                        思考: {modelThinking}
                      </span>
                    ) : (
                      muted("思考：—", "该 Agent 未提供独立思考等级配置")
                    )}
                    {permOpt ? (
                      <div className="flex items-center gap-1 bg-muted/40 hover:bg-muted/70 px-2 py-0.5 rounded-md border border-border/60 transition-colors">
                        {renderSelect(permOpt, <ShieldCheck className="w-3 h-3 text-warning shrink-0" />)}
                      </div>
                    ) : muted("权限：—", "该 Agent 未提供权限配置")}
                    {otherOpts.map((opt) =>
                      opt.type === "boolean" ? (
                        <label key={opt.id} className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none" title={opt.description || opt.name}>
                          <input type="checkbox" checked={Boolean(opt.currentValue)} disabled={p.isStreaming} onChange={(e) => p.onSetConfig?.(opt.id, e.target.checked)} className="rounded border-border text-primary focus:ring-primary/20" />
                          <span className="text-[11px] font-medium">{opt.name || opt.id}</span>
                        </label>
                      ) : (
                        renderSelect(opt, <Settings2 className="w-3 h-3 text-muted-foreground shrink-0" />)
                      )
                    )}
                  </>
                )}

                {p.onBrowseModels && (
                  <button type="button" onClick={p.onBrowseModels} title={p.hasModelCatalog ? "浏览 / 发现模型库" : "发现可用模型"} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors">
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Right actions: Mic, Clear, and Send Arrow */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  title="语音输入 / 辅助"
                  className="p-1 rounded-md text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
                >
                  <Mic className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={p.onClear}
                  disabled={p.isStreaming}
                  title="清空聊天记录"
                  className="p-1 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-muted/50 transition-colors disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                {canCancel ? (
                  <>
                    {canSendText && (
                      <button
                        type="button"
                        onClick={handleSteer}
                        title="插队发送：中断当前生成并立即发送（排队中的消息随后继续）"
                        className="h-7 px-2.5 rounded-full border border-warning/50 text-warning hover:bg-warning/10 flex items-center gap-1 text-xs font-medium cursor-pointer transition-colors"
                      >
                        <Zap className="w-3 h-3" />
                        <span>插队</span>
                      </button>
                    )}
                    <ComposerPrimitive.Cancel asChild>
                      <button
                        type="button"
                        title="停止生成"
                        className="h-7 px-2.5 rounded-full bg-destructive text-destructive-foreground hover:opacity-90 flex items-center gap-1 text-xs font-medium cursor-pointer"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        <span>停止</span>
                      </button>
                    </ComposerPrimitive.Cancel>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendClick}
                    disabled={!canSendAny || (p.isStreaming && !canSendText)}
                    title={p.isStreaming ? "发送（将在当前生成结束后排队执行）" : "发送消息"}
                    className={`h-7 w-7 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                      canSendText || (!p.isStreaming && canSendAny)
                        ? "bg-foreground text-background hover:opacity-90 shadow-xs"
                        : "bg-muted text-muted-foreground/50 opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    <span className="sr-only">发送</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </ComposerPrimitive.Root>

        {/* Antigravity Local Target Tag & Workspace Menu */}
        <div className="flex items-center justify-between pt-0.5 px-1 text-xs text-muted-foreground select-none relative">
          <div className="relative" ref={localMenuRef}>
            <button
              type="button"
              onClick={() => setLocalMenuOpen(!localMenuOpen)}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/40 hover:bg-muted border border-border/50 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            >
              <Laptop className="w-3 h-3 text-muted-foreground/80" />
              <span>Local</span>
              <ChevronDown className="w-2.5 h-2.5 opacity-60" />
            </button>

            {localMenuOpen && (
              <div className="absolute left-0 bottom-full mb-1.5 w-72 p-1.5 rounded-xl border border-border bg-popover shadow-xl text-xs z-50 animate-in fade-in-50 zoom-in-95 duration-100 space-y-1">
                {/* Current Workspace Header */}
                <div className="px-2 py-1.5 border-b border-border/50">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <Folder className="w-3.5 h-3.5 text-primary" />
                      {p.currentWorkspace
                        ? p.currentWorkspace.split(/[/\\]/).filter(Boolean).pop()
                        : "未绑定工作区"}
                    </span>
                    {p.currentWorkspace && (
                      <button
                        type="button"
                        onClick={handleRevealInExplorer}
                        title="在资源管理器中定位"
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {p.currentWorkspace && (
                    <div className="text-[10px] font-mono text-muted-foreground/70 truncate mt-0.5" title={p.currentWorkspace}>
                      {p.currentWorkspace}
                    </div>
                  )}
                </div>

                {/* Workspace Actions */}
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={handleOpenFolder}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-foreground hover:bg-muted/80 text-left transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-3.5 h-3.5 text-primary" />
                      <span>打开本地项目 / 文件夹…</span>
                    </div>
                    <kbd className="text-[9px] font-mono bg-muted px-1 py-0.5 rounded text-muted-foreground border border-border/50">
                      Ctrl+O
                    </kbd>
                  </button>

                  {p.onOpenChanges && (
                    <button
                      type="button"
                      onClick={() => {
                        setLocalMenuOpen(false);
                        p.onOpenChanges?.();
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 text-left transition-colors"
                    >
                      <FileDiff className="w-3.5 h-3.5" />
                      <span>查看 Git 代码变更 (Diff)</span>
                    </button>
                  )}

                  {p.onToggleTerminal && (
                    <button
                      type="button"
                      onClick={() => {
                        setLocalMenuOpen(false);
                        p.onToggleTerminal?.();
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 text-left transition-colors"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>打开集成终端</span>
                    </button>
                  )}
                </div>

                {/* Recent Projects (if any) */}
                {p.recentWorkspaces && p.recentWorkspaces.length > 0 && (
                  <div className="pt-1 border-t border-border/50">
                    <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>最近项目</span>
                    </div>
                    <div className="max-h-28 overflow-y-auto space-y-0.5">
                      {p.recentWorkspaces.slice(0, 4).map((rw) => (
                        <button
                          key={rw.path}
                          type="button"
                          onClick={() => {
                            setLocalMenuOpen(false);
                            p.onSelectWorkspace?.(rw.path, rw.name);
                          }}
                          className={`w-full flex items-center justify-between px-2 py-1 rounded text-left text-[11px] transition-colors ${
                            p.currentWorkspace === rw.path
                              ? "bg-muted text-foreground font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                          }`}
                        >
                          <span className="truncate">{rw.name || rw.path.split(/[/\\]/).pop()}</span>
                          {p.currentWorkspace === rw.path && <Check className="w-3 h-3 text-primary shrink-0" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Environment Status info */}
                <div className="px-2 py-1.5 pt-1 border-t border-border/50 text-[10px] text-muted-foreground/80 flex items-center justify-between">
                  <span>运行目标: 本地主机 (Local)</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                </div>
              </div>
            )}
          </div>

          <div className="text-[10px] font-mono text-muted-foreground/50 hidden sm:inline">
            {p.isStreaming ? "Enter 排队 · 插队立即打断 · Shift+Enter 换行" : "Enter 发送 · Shift+Enter 换行 · / 命令"}
          </div>
        </div>
      </div>
    </div>
  );
};
