/**
 * LangGraph Agent Server
 *
 * Exposes the careers coach agent for both CopilotKit and voice interfaces.
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { graph, CareerAgentStateType } from "./graph.js";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { v4 as uuidv4 } from "uuid";

const app = new Hono();
app.use("/*", cors());

// Store active threads
const threads = new Map<string, { threadId: string; config: object }>();

/**
 * Health check
 */
app.get("/health", (c) => c.json({ status: "ok", agent: "careers-coach" }));

/**
 * Create a new thread
 */
app.post("/threads", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const threadId = body.threadId || uuidv4();

  const config = {
    configurable: {
      thread_id: threadId,
    },
  };

  threads.set(threadId, { threadId, config });

  return c.json({ threadId, status: "created" });
});

/**
 * Invoke the agent with a message
 */
app.post("/invoke", async (c) => {
  const body = await c.req.json();
  const { threadId, message, userProfile, command } = body;

  if (!threadId) {
    return c.json({ error: "threadId required" }, 400);
  }

  let threadData = threads.get(threadId);
  if (!threadData) {
    // Auto-create thread if it doesn't exist
    threadData = {
      threadId,
      config: { configurable: { thread_id: threadId } },
    };
    threads.set(threadId, threadData);
  }

  try {
    let input: Partial<CareerAgentStateType> | Command;

    // If resuming from interrupt
    if (command?.resume) {
      input = new Command({ resume: command.resume });
    } else {
      // Normal message
      input = {
        messages: message ? [new HumanMessage(message)] : [],
        userProfile: userProfile || {},
      };
    }

    const result = await graph.invoke(input, threadData.config);

    // Extract the last AI message
    const lastMessage = result.messages[result.messages.length - 1];
    const isInterrupted = result.__interrupt__?.length > 0;

    return c.json({
      threadId,
      response: lastMessage?.content || "",
      isInterrupted,
      interruptValue: isInterrupted ? result.__interrupt__[0]?.value : null,
      currentNode: result.currentNode,
      userProfile: result.userProfile,
      toolCalls: lastMessage?.tool_calls || [],
    });
  } catch (error) {
    console.error("Agent error:", error);
    return c.json({ error: String(error) }, 500);
  }
});

/**
 * Stream the agent response (for real-time updates)
 */
app.post("/stream", async (c) => {
  const body = await c.req.json();
  const { threadId, message, userProfile, command } = body;

  if (!threadId) {
    return c.json({ error: "threadId required" }, 400);
  }

  let threadData = threads.get(threadId);
  if (!threadData) {
    threadData = {
      threadId,
      config: { configurable: { thread_id: threadId } },
    };
    threads.set(threadId, threadData);
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let input: Partial<CareerAgentStateType> | Command;

        if (command?.resume) {
          input = new Command({ resume: command.resume });
        } else {
          input = {
            messages: message ? [new HumanMessage(message)] : [],
            userProfile: userProfile || {},
          };
        }

        const eventStream = await graph.streamEvents(input, {
          ...threadData!.config,
          version: "v2",
        });

        for await (const event of eventStream) {
          if (event.event === "on_chat_model_stream") {
            const chunk = event.data?.chunk;
            if (chunk?.content) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ type: "token", content: chunk.content })}\n\n`
                )
              );
            }
          }

          if (event.event === "on_tool_start") {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: "tool_start", name: event.name })}\n\n`
              )
            );
          }

          if (event.event === "on_tool_end") {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: "tool_end", name: event.name, output: event.data?.output })}\n\n`
              )
            );
          }
        }

        // Get final state
        const state = await graph.getState(threadData!.config);
        const isInterrupted = state.tasks?.some((t: { interrupts: string | any[] }) => t.interrupts?.length > 0);

        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({
              type: "done",
              isInterrupted,
              interruptValue: isInterrupted ? state.tasks[0]?.interrupts[0]?.value : null,
              currentNode: state.values?.currentNode,
              userProfile: state.values?.userProfile,
            })}\n\n`
          )
        );

        controller.close();
      } catch (error) {
        console.error("Stream error:", error);
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ type: "error", error: String(error) })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

/**
 * Get thread state
 */
app.get("/threads/:threadId", async (c) => {
  const threadId = c.req.param("threadId");
  const threadData = threads.get(threadId);

  if (!threadData) {
    return c.json({ error: "Thread not found" }, 404);
  }

  try {
    const state = await graph.getState(threadData.config);
    return c.json({
      threadId,
      ...state.values,
      isInterrupted: state.tasks?.some((t: { interrupts: string | any[] }) => t.interrupts?.length > 0),
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Start server
const port = parseInt(process.env.AGENT_PORT || "8123");
console.log(`🎯 Careers Coach Agent running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
