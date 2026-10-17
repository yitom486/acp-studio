"use client";

import { createContext } from "react";

export type MessageSide = "start" | "end";
export type MessageFrom = "user" | "assistant" | "system";

export const MessageSideContext = createContext<MessageSide | undefined>(undefined);

export interface MessageContextValue {
  from: MessageFrom;
}

export const MessageContext = createContext<MessageContextValue>({
  from: "assistant",
});

