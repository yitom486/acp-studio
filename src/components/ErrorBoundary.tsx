import React from "react";
import { AlertTriangle, Copy, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/error-bus";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string;
  copied: boolean;
}

/**
 * Last-resort crash screen: catches render errors anywhere below it so a
 * single broken component never leaves a blank page, and forwards the
 * crash into the central error bus.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: "", copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info: info.componentStack || "" });
    reportError("ErrorBoundary", error, info.componentStack || undefined);
  }

  private retry = () => {
    this.setState({ error: null, info: "", copied: false });
  };

  private copy = () => {
    const text = `${this.state.error?.message || ""}\n${this.state.info}`;
    // 可预期失败 (剪贴板权限) 允许忽略，但留 debug 痕。
    navigator.clipboard.writeText(text).catch((err) => console.debug("[ErrorBoundary] 复制失败 (已忽略):", err));
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 1500);
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground p-6">
        <div className="w-full max-w-lg rounded-2xl border border-destructive/40 bg-card p-6 space-y-4 text-sm">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-destructive/10 text-destructive border border-destructive/30">
              <AlertTriangle className="w-5 h-5" />
            </span>
            <div>
              <h2 className="font-bold">界面渲染出错了</h2>
              <p className="text-xs text-muted-foreground">错误已记入集中错误面板，可复制详情反馈</p>
            </div>
          </div>
          <pre className="max-h-40 overflow-y-auto rounded-lg bg-background/80 border border-border p-3 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={this.copy} className="gap-1.5 text-xs">
              {this.state.copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              {this.state.copied ? "已复制" : "复制详情"}
            </Button>
            <Button size="sm" variant="default" onClick={this.retry} className="gap-1.5 text-xs">
              <RotateCcw className="w-3.5 h-3.5" /> 重试
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
