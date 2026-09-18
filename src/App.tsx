import React, { useState, useEffect, useRef } from "react";
import { Header } from "./components/Header";
import { ChatArea, Message } from "./components/ChatArea";
import { ChatInput } from "./components/ChatInput";
import { AuthModal } from "./components/AuthModal";

export default function App() {
  const [status, setStatus] = useState<any>(null);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3.8-flash-high");
  const [selectedMode, setSelectedMode] = useState<string>("default");
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (data.ok) {
        setStatus(data);
        if (data.models && data.models.length > 0) {
          setModels(data.models);
          if (!data.models.find((m: any) => m.id === selectedModel)) {
            setSelectedModel(data.currentModelId || data.models[0].id);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch status:", err);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleNewSession = async () => {
    if (isStreaming) return;
    try {
      const res = await fetch("/api/session/new", { method: "POST" });
      const data = await res.json();
      if (data.sessionId) {
        setSessionId(data.sessionId);
      }
    } catch {
      setSessionId(null);
    }
    setMessages([]);
  };

  const handleSendPrompt = async (textToSend?: string) => {
    const prompt = (textToSend || input).trim();
    if (!prompt || isStreaming) return;

    setInput("");

    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsgId = "user-" + Date.now();
    const assistantMsgId = "asst-" + Date.now();

    const userMessage: Message = {
      id: userMsgId,
      role: "user",
      content: prompt,
      timestamp: now,
    };

    const assistantMessage: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      model: selectedModel,
      mode: selectedMode,
      timestamp: now,
      toolCalls: [],
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsStreaming(true);

    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model: selectedModel,
          mode: selectedMode,
          sessionId: sessionId || undefined,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const errText = errJson?.error || `Server returned ${res.status}: ${res.statusText}`;
        if (errText.includes("Authentication required")) {
          setAuthModalOpen(true);
        }
        throw new Error(errText);
      }

      if (!res.body) throw new Error("No response stream body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const payload = JSON.parse(trimmed.slice(6));

            if (payload.type === "start" && payload.sessionId) {
              setSessionId(payload.sessionId);
            }

            if (payload.type === "update" && payload.update) {
              const u = payload.update;
              // Handle text chunk
              if (
                u.sessionUpdate === "agent_message_chunk" &&
                u.content?.type === "text" &&
                typeof u.content.text === "string"
              ) {
                const chunk = u.content.text;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? { ...msg, content: msg.content + chunk }
                      : msg
                  )
                );
              }

              // Handle tool calls
              if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_use") {
                const toolTitle = u.toolCall?.title || u.title || u.name || "Tool Operation";
                const toolId = u.toolCallId || "tool-" + Date.now();
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMsgId
                      ? {
                          ...msg,
                          toolCalls: [
                            ...(msg.toolCalls || []),
                            { id: toolId, title: toolTitle, status: "completed" },
                          ],
                        }
                      : msg
                  )
                );
              }
            }

            if (payload.type === "done") {
              setIsStreaming(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId ? { ...msg, isStreaming: false } : msg
                )
              );
            }

            if (payload.type === "error") {
              if (payload.message?.includes("Authentication required")) {
                setAuthModalOpen(true);
              }
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        content:
                          msg.content +
                          `\n\n> ⚠️ [Google 官方 ACP 提示] 尚未授权 Google 账号。请在弹出的窗口中登录 Google。`,
                        isStreaming: false,
                      }
                    : msg
                )
              );
              setIsStreaming(false);
            }
          } catch {
            // ignore non-json SSE lines
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content:
                    msg.content +
                    `\n\n> ❌ [连接异常] ${err.message || "未能与 Antigravity ACP 通信"}`,
                  isStreaming: false,
                }
              : msg
          )
        );
      }
    } finally {
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId ? { ...msg, isStreaming: false } : msg
        )
      );
    }
  };

  const handleStopPrompt = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (sessionId) {
      try {
        await fetch("/api/chat/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
      } catch (e) {
        console.error("Failed to stop prompt on server:", e);
      }
    }
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((msg) => (msg.isStreaming ? { ...msg, isStreaming: false } : msg))
    );
  };

  const handleClearMessages = () => {
    if (!isStreaming) {
      setMessages([]);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#070A12] text-slate-100 overflow-hidden select-text">
      {/* Top Header */}
      <Header
        status={status}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        selectedMode={selectedMode}
        onSelectMode={setSelectedMode}
        onOpenAuth={() => setAuthModalOpen(true)}
        onNewSession={handleNewSession}
        isStreaming={isStreaming}
      />

      {/* Main Chat Center */}
      <ChatArea
        messages={messages}
        isStreaming={isStreaming}
        selectedModel={selectedModel}
        selectedMode={selectedMode}
        onSelectSuggestion={(prompt) => handleSendPrompt(prompt)}
      />

      {/* Floating Bottom Input Bar */}
      <ChatInput
        input={input}
        setInput={setInput}
        onSend={() => handleSendPrompt()}
        onStop={handleStopPrompt}
        onClear={handleClearMessages}
        isStreaming={isStreaming}
        selectedModel={selectedModel}
        selectedMode={selectedMode}
      />

      {/* Auth & Diagnostics Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        status={status}
        onRefreshStatus={fetchStatus}
      />
    </div>
  );
}
