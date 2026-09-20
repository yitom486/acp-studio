import React, { useState, useEffect, useRef } from "react";
import { Header } from "./components/Header";
import { ChatArea, Message } from "./components/ChatArea";
import { ChatInput } from "./components/ChatInput";
import { AuthModal } from "./components/AuthModal";
import { consumeChatSseStream } from "./lib/sse-client";

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

      await consumeChatSseStream(res.body, {
        onSessionId: (newSid) => setSessionId(newSid),
        onTextChunk: (chunk) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + chunk }
                : msg
            )
          );
        },
        onToolCall: ({ id, title, status }) => {
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantMsgId) return msg;
              const existingCalls = msg.toolCalls || [];
              const foundIndex = existingCalls.findIndex((c) => c.id === id);
              if (foundIndex >= 0) {
                const updated = [...existingCalls];
                updated[foundIndex] = { ...updated[foundIndex], title, status };
                return { ...msg, toolCalls: updated };
              }
              return {
                ...msg,
                toolCalls: [...existingCalls, { id, title, status }],
              };
            })
          );
        },
        onDone: () => {
          setIsStreaming(false);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId ? { ...msg, isStreaming: false } : msg
            )
          );
        },
        onAuthRequired: () => {
          setAuthModalOpen(true);
        },
        onError: (err) => {
          if (err.message.includes("Authentication required")) {
            setAuthModalOpen(true);
          }
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
        },
      });
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
