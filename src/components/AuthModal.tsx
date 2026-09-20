import React, { useState, useEffect } from "react";
import { X, ShieldCheck, CheckCircle2, AlertCircle, Key, RefreshCw, ExternalLink, Copy, Check, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: any;
  onRefreshStatus: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  status,
  onRefreshStatus,
}) => {
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(status?.auth?.latestOAuthUrl || null);
  const [apiKey, setApiKey] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [authTab, setAuthTab] = useState<"oauth" | "apikey">("oauth");
  const isLoading = status === null;
  const isAuth = Boolean(status?.auth?.authenticated);

  useEffect(() => {
    if (status?.auth?.latestOAuthUrl) {
      setOauthUrl(status.auth.latestOAuthUrl);
    }
  }, [status]);

  // Live polling while modal is open to auto-detect auth updates
  useEffect(() => {
    if (!isOpen) return;

    const timer = setInterval(() => {
      onRefreshStatus();
    }, 2500);

    return () => clearInterval(timer);
  }, [isOpen]);

  // Auto-close on successful authorization if user was waiting for an active OAuth flow
  useEffect(() => {
    if (isAuth && isOpen && oauthUrl) {
      setVerifyMessage("🎉 Google 账号已授权成功！正在进入...");
      const t = setTimeout(() => {
        setOauthUrl(null);
        onClose();
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [isAuth, isOpen, oauthUrl]);

  if (!isOpen) return null;

  const handleCopyUrl = () => {
    if (oauthUrl) {
      navigator.clipboard.writeText(oauthUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleTriggerAuth = async (methodId: string = "oauth-personal") => {
    setIsVerifying(true);
    setVerifyMessage(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ methodId }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.oauthUrl) {
          setOauthUrl(data.oauthUrl);
          setVerifyMessage("官方 ACP Server 已生成授权链接，请在浏览器中完成登录。");
        } else {
          setVerifyMessage(data.message || "官方 ACP Server 已完成授权。");
          onRefreshStatus();
        }
      } else {
        setVerifyMessage("认证请求失败: " + data.error);
      }
    } catch (e: any) {
      setVerifyMessage("请求异常: " + e.message);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) return;
    setIsVerifying(true);
    setVerifyMessage(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ methodId: "gemini-api-key", apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setVerifyMessage("Gemini API Key 已配置。");
        onRefreshStatus();
      } else {
        setVerifyMessage("API Key 验证失败: " + data.error);
      }
    } catch (e: any) {
      setVerifyMessage("请求异常: " + e.message);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700/80 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-xl text-slate-100 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Google 官方 Antigravity ACP 认证</h2>
              <p className="text-xs text-slate-400">Agent Client Protocol &bull; 官方服务管理</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status details */}
        <div className="space-y-3.5">
          {/* Account Card */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">认证状态</span>
              {isLoading ? (
                <Badge variant="outline" className="gap-1.5 border-slate-700 bg-slate-800/80 text-indigo-300">
                  <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                  连接检测中...
                </Badge>
              ) : isAuth ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  已就绪 (已授权)
                </Badge>
              ) : (
                <Badge variant="warning" className="gap-1">
                  <AlertCircle className="w-3 h-3" />
                  需要登录授权
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Key className="w-4 h-4 text-indigo-400" />
              <span>官方支持认证：oauth-personal / gemini-api-key</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Google Antigravity 官方 CLI 引擎（<code className="text-slate-300 font-mono">agy.exe</code>）配合 <code className="text-indigo-400 font-mono">agy-acp-map</code> 桥接器直接负责鉴权与会话生命周期管理，凭据安全保存于本地原生环境（~/.gemini/）。
            </p>
          </div>

          {/* Tab Selector */}
          <div className="flex rounded-xl bg-slate-950/80 p-1 border border-slate-800 text-xs">
            <button
              onClick={() => setAuthTab("oauth")}
              className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
                authTab === "oauth"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Google 账号授权 (推荐)
            </button>
            <button
              onClick={() => setAuthTab("apikey")}
              className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
                authTab === "apikey"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Gemini API Key
            </button>
          </div>

          {/* Mode 1: OAuth */}
          {authTab === "oauth" && (
            <div className="space-y-2.5">
              {isLoading ? (
                <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/80 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-indigo-400 font-medium">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>正在连接官方 ACP 服务并读取凭据...</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    官方 ACP Server 正在进行握手检测与安全凭据加载，请稍候。
                  </p>
                </div>
              ) : oauthUrl ? (
                <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-500/40 text-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-indigo-300">Google 网页授权会话已就绪</span>
                    <Badge variant="default" className="text-[10px]">待用户授权</Badge>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    官方 ACP Server 已生成授权链接，请在浏览器中打开并登录您的 Google 账号：
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="glow"
                      size="sm"
                      onClick={() => window.open(oauthUrl, "_blank")}
                      className="flex-1 gap-2 text-xs h-9"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      在浏览器中打开登录页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyUrl}
                      className="h-9 px-3 border-slate-700 hover:border-slate-500"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
              ) : isAuth ? (
                <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      本地 Google 账号登录态已就绪
                    </span>
                    <Badge variant="success" className="text-[10px]">已复用本地配置</Badge>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    已自动检测并接入 Google Antigravity CLI 本地登录态（原生安全凭据目录：<code className="text-slate-200 font-mono">~/.gemini/</code>）。官方 ACP 桥接服务已就绪，可直接发起 AI 问答与代码编辑。
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTriggerAuth("oauth-personal")}
                    disabled={isVerifying}
                    className="w-full gap-2 text-xs h-8 border-slate-700 hover:bg-slate-800 text-slate-300"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                    {isVerifying ? "正在请求官方服务..." : "重新发起 Google 账号授权 (可选)"}
                  </Button>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/80 text-xs space-y-2">
                  <p className="text-slate-400 text-[11px]">
                    点击下方按钮可向官方 ACP Server 发起 OAuth 授权请求。
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleTriggerAuth("oauth-personal")}
                    disabled={isVerifying}
                    className="w-full gap-2 text-xs h-9"
                  >
                    <Key className="w-3.5 h-3.5 text-indigo-400" />
                    {isVerifying ? "正在请求官方服务..." : "发起 Google 账号登录"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Mode 2: Gemini API Key */}
          {authTab === "apikey" && (
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs space-y-2.5">
              <div className="flex items-center gap-1.5 text-indigo-300 font-semibold">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span>配置 Gemini Developer API Key</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                官方 ACP Server 同时支持通过 <code className="text-slate-300 font-mono">GEMINI_API_KEY</code> 进行认证。
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSaveApiKey}
                  disabled={!apiKey.trim() || isVerifying}
                  className="text-xs h-8"
                >
                  保存
                </Button>
              </div>
            </div>
          )}

          {/* Engine & ACP Specs */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span>官方 Agent 名称</span>
              <span className="font-mono text-indigo-300 font-medium">
                {status?.agentInfo?.title || "agy ACP (stream-json)"} (v{status?.packageVersion || "0.1.3"})
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>官方原生引擎</span>
              <span className="font-mono text-emerald-400 text-[11px] truncate max-w-[240px]" title={status?.binary?.executablePath}>
                {status?.binary?.executablePath ? status.binary.executablePath.split("\\").pop() : "agy.exe"}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>ACP 适配桥接器</span>
              <span className="font-mono text-slate-200 text-[11px]">
                @yitom/agy-acp-map@{status?.packageVersion || "0.1.3"} ({status?.mode === "process" ? "外部应用模式" : "外部包模式"})
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>通信协议</span>
              <span className="font-mono text-purple-300 font-medium">{status?.protocol || "Agent Client Protocol v2"}</span>
            </div>
          </div>

          {/* Verification Feedback */}
          {verifyMessage && (
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>{verifyMessage}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleTriggerAuth("oauth-personal")}
            disabled={isVerifying}
            className="text-xs gap-1.5 border-slate-700"
          >
            <Key className="w-3.5 h-3.5 text-indigo-400" />
            {isVerifying ? "处理中..." : isAuth ? "重新授权 (可选)" : "发起登录"}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                onRefreshStatus();
                setVerifyMessage("状态已刷新");
              }}
              className="text-xs gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              刷新状态
            </Button>
            <Button variant="secondary" size="sm" onClick={onClose} className="text-xs">
              完成
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
