import { ZepClient } from "@getzep/zep-cloud";

// Initialize Zep client
const zepClient = new ZepClient({
  apiKey: process.env.ZEP_API_KEY!,
});

export { zepClient };

// Graph name for this application
export const GRAPH_NAME = process.env.ZEP_GRAPH_NAME || "fractional-jobs-graph";

/**
 * Get or create a user in Zep
 */
export async function getOrCreateZepUser(userId: string, userData?: {
  email?: string;
  firstName?: string;
  lastName?: string;
}) {
  try {
    // Try to get existing user
    const user = await zepClient.user.get(userId);
    return user;
  } catch {
    // User doesn't exist, create them
    const newUser = await zepClient.user.add({
      userId,
      email: userData?.email,
      firstName: userData?.firstName,
      lastName: userData?.lastName,
    });
    return newUser;
  }
}

/**
 * Get or create a thread for a user session
 */
export async function getOrCreateThread(userId: string, threadId: string) {
  try {
    const thread = await zepClient.thread.get(threadId);
    return thread;
  } catch {
    // Thread doesn't exist, create it
    const newThread = await zepClient.thread.create({
      threadId,
      userId,
    });
    return newThread;
  }
}

/**
 * Add a message to a thread (for memory)
 */
export async function addMessageToThread(
  threadId: string,
  role: "user" | "assistant",
  content: string,
  name?: string
) {
  await zepClient.thread.addMessages(threadId, {
    messages: [
      {
        role,
        content,
        name,
        createdAt: new Date().toISOString(),
      },
    ],
  });
}

/**
 * Get context for a user from their thread (facts, summary, relevant memories)
 */
export async function getUserContext(threadId: string) {
  try {
    // Get user's context block (summary + relevant facts)
    const context = await zepClient.thread.getUserContext(threadId, {});
    return context;
  } catch (error) {
    console.error("Error getting Zep context:", error);
    return null;
  }
}

/**
 * Search user's memory graph for relevant information
 */
export async function searchUserMemory(userId: string, query: string, limit = 5) {
  try {
    const results = await zepClient.graph.search({
      userId,
      query,
      limit,
    });
    return results;
  } catch (error) {
    console.error("Error searching Zep memory:", error);
    return null;
  }
}

/**
 * Add business data to user's graph (career preferences, job history, etc.)
 */
export async function addToUserGraph(userId: string, data: string, dataType = "json") {
  try {
    const result = await zepClient.graph.add({
      userId,
      data,
      type: dataType as "json" | "text" | "message",
    });
    return result;
  } catch (error) {
    console.error("Error adding to Zep graph:", error);
    return null;
  }
}
