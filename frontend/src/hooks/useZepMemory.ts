"use client";

import { useState, useEffect, useCallback } from "react";

interface ZepMemoryConfig {
  userId: string;
  userName?: string;
  userEmail?: string;
}

interface ZepContext {
  facts?: string;
  summary?: string;
  context?: string;
}

export function useZepMemory(config: ZepMemoryConfig | null) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [memoryContext, setMemoryContext] = useState<ZepContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize Zep user and thread
  useEffect(() => {
    if (!config?.userId) return;

    const initializeZep = async () => {
      try {
        // Create or get user
        await fetch("/api/zep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getOrCreateUser",
            userId: config.userId,
            userData: {
              email: config.userEmail,
              firstName: config.userName?.split(" ")[0],
              lastName: config.userName?.split(" ").slice(1).join(" "),
            },
          }),
        });

        // Create a new thread for this session
        const newThreadId = `${config.userId}-${Date.now()}`;
        await fetch("/api/zep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getOrCreateThread",
            userId: config.userId,
            threadId: newThreadId,
          }),
        });

        setThreadId(newThreadId);
        setIsInitialized(true);

        // Try to get existing context for this user
        await refreshContext(newThreadId);
      } catch (err) {
        console.error("Failed to initialize Zep:", err);
        setError(String(err));
      }
    };

    initializeZep();
  }, [config?.userId, config?.userEmail, config?.userName]);

  // Refresh context from Zep
  const refreshContext = useCallback(async (tid?: string) => {
    const currentThreadId = tid || threadId;
    if (!currentThreadId) return;

    try {
      const response = await fetch(`/api/zep?threadId=${currentThreadId}`);
      const data = await response.json();
      if (data.success && data.context) {
        setMemoryContext(data.context);
      }
    } catch (err) {
      console.error("Failed to refresh Zep context:", err);
    }
  }, [threadId]);

  // Add a message to Zep memory
  const addMessage = useCallback(
    async (role: "user" | "assistant", content: string) => {
      if (!threadId) return;

      try {
        await fetch("/api/zep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "addMessage",
            threadId,
            role,
            content,
            name: role === "user" ? config?.userName : "Career Coach",
          }),
        });

        // Refresh context after adding message
        setTimeout(() => refreshContext(), 1000);
      } catch (err) {
        console.error("Failed to add message to Zep:", err);
      }
    },
    [threadId, config?.userName, refreshContext]
  );

  // Search user's memory
  const searchMemory = useCallback(
    async (query: string) => {
      if (!config?.userId) return null;

      try {
        const response = await fetch("/api/zep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "searchMemory",
            userId: config.userId,
            query,
            limit: 5,
          }),
        });
        const data = await response.json();
        return data.results;
      } catch (err) {
        console.error("Failed to search Zep memory:", err);
        return null;
      }
    },
    [config?.userId]
  );

  // Add data to user's knowledge graph
  const addToGraph = useCallback(
    async (data: string, dataType: "json" | "text" = "json") => {
      if (!config?.userId) return;

      try {
        await fetch("/api/zep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "addToGraph",
            userId: config.userId,
            data,
            dataType,
          }),
        });
      } catch (err) {
        console.error("Failed to add to Zep graph:", err);
      }
    },
    [config?.userId]
  );

  // Format memory context for inclusion in prompts
  const getMemoryPrompt = useCallback(() => {
    if (!memoryContext) return "";

    let prompt = "\n\n--- MEMORY CONTEXT ---\n";

    if (memoryContext.summary) {
      prompt += `USER SUMMARY:\n${memoryContext.summary}\n\n`;
    }

    if (memoryContext.facts) {
      prompt += `RELEVANT FACTS:\n${memoryContext.facts}\n\n`;
    }

    if (memoryContext.context) {
      prompt += `CONTEXT:\n${memoryContext.context}\n`;
    }

    return prompt + "--- END MEMORY ---\n";
  }, [memoryContext]);

  return {
    threadId,
    isInitialized,
    memoryContext,
    error,
    addMessage,
    searchMemory,
    addToGraph,
    refreshContext,
    getMemoryPrompt,
  };
}
