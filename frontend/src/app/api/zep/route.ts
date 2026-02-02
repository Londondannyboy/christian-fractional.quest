import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateZepUser,
  getOrCreateThread,
  addMessageToThread,
  getUserContext,
  searchUserMemory,
  addToUserGraph,
} from "@/lib/zep/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userId, threadId, ...params } = body;

    switch (action) {
      case "getOrCreateUser": {
        const user = await getOrCreateZepUser(userId, params.userData);
        return NextResponse.json({ success: true, user });
      }

      case "getOrCreateThread": {
        const thread = await getOrCreateThread(userId, threadId);
        return NextResponse.json({ success: true, thread });
      }

      case "addMessage": {
        await addMessageToThread(
          threadId,
          params.role,
          params.content,
          params.name
        );
        return NextResponse.json({ success: true });
      }

      case "getContext": {
        const context = await getUserContext(threadId);
        return NextResponse.json({ success: true, context });
      }

      case "searchMemory": {
        const results = await searchUserMemory(
          userId,
          params.query,
          params.limit
        );
        return NextResponse.json({ success: true, results });
      }

      case "addToGraph": {
        const result = await addToUserGraph(
          userId,
          params.data,
          params.dataType
        );
        return NextResponse.json({ success: true, result });
      }

      default:
        return NextResponse.json(
          { success: false, error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Zep API error:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch user context
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const threadId = searchParams.get("threadId");

  if (!threadId) {
    return NextResponse.json(
      { success: false, error: "threadId required" },
      { status: 400 }
    );
  }

  try {
    const context = await getUserContext(threadId);
    return NextResponse.json({ success: true, context });
  } catch (error) {
    console.error("Zep GET error:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
