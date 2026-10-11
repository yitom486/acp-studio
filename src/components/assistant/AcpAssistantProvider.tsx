import React, { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import { useStudioStore } from "@/stores/useStudioStore";
import { convertAcpMessages, extractAppendText } from "@/lib/acp-assistant";

export interface AcpAssistantProviderProps {
  children: React.ReactNode;
  onSend: (text?: string) => void;
  onStop: () => void;
}

/** Thread-view page size: only the latest N messages enter the runtime. */
export const ACP_THREAD_PAGE_SIZE = 30;

/**
 * Binds the existing zustand ACP store to assistant-ui via
 * ExternalStoreRuntime (docs: /docs/runtimes/custom/external-store).
 *
 * State ownership stays in zustand + ACP gateway (consumeUniversalChat in
 * App.tsx). assistant-ui only renders + drives interactions:
 * - messages: converted live from useStudioStore (streaming-safe, immutable)
 * - onNew: user sent via assistant-ui composer -> existing handleSend
 * - onCancel: existing handleStop (abort + session/cancel RPC)
 * - onReload: re-send last user text through the same ACP path
 * - onEdit: truncate the ACP transcript at the edited message, then resend
 */
export const AcpAssistantProvider: React.FC<AcpAssistantProviderProps> = ({
  children,
  onSend,
  onStop,
}) => {
  const messages = useStudioStore((s) => s.messages);
  const isStreaming = useStudioStore((s) => s.isStreaming);

  // Pagination: long ACP histories (session replay can be hundreds of
  // messages) only expose the latest page to the runtime. Older pages load
  // on demand via hasEarlier/onLoadEarlier ("加载更早的消息").
  const [visibleCount, setVisibleCount] = useState(ACP_THREAD_PAGE_SIZE);
  const headId = messages.length > 0 ? messages[0].id : null;
  useEffect(() => {
    setVisibleCount(ACP_THREAD_PAGE_SIZE);
  }, [headId]);
  const visibleMessages =
    messages.length > visibleCount
      ? messages.slice(messages.length - visibleCount)
      : messages;

  const converted = useMemo(() => convertAcpMessages(visibleMessages), [visibleMessages]);

  const runtime = useExternalStoreRuntime({
    messages: converted,
    convertMessage: (m) => m,
    isRunning: isStreaming,
    hasEarlier: messages.length > visibleMessages.length,
    onLoadEarlier: async () => {
      setVisibleCount((c) => c + ACP_THREAD_PAGE_SIZE);
    },
    onNew: async (message: AppendMessage) => {
      onSend(extractAppendText(message));
    },
    onCancel: async () => {
      onStop();
    },
    // Regenerate last turn: re-send last user text through the same ACP path.
    onReload: async () => {
      const st = useStudioStore.getState();
      const lastUser = [...st.messages].reverse().find((m) => m.role === "user");
      if (lastUser) onSend(lastUser.content);
    },
    onEdit: async (message: AppendMessage) => {
      const text = extractAppendText(message);
      const st = useStudioStore.getState();
      // Docs pattern: parentId points at the message before the edited one,
      // so slice(0, index) drops the edited turn and everything after it.
      const parentIdx = st.messages.findIndex((m) => m.id === message.parentId);
      const truncated =
        parentIdx >= 0 ? st.messages.slice(0, parentIdx + 1) : st.messages;
      // Drop a trailing streaming assistant placeholder if present.
      const clean =
        truncated.length > 0 && truncated[truncated.length - 1].isStreaming
          ? truncated.slice(0, -1)
          : truncated;
      st.setMessages(clean);
      onSend(text);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
};
