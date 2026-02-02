import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";

const serviceAdapter = new ExperimentalEmptyAdapter();

const runtime = new CopilotRuntime({
  agents: {
    careers_coach: new LangGraphAgent({
      deploymentUrl:
        process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
      graphId: "careers_coach",
      langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
    }),
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { user } = await auth.validateRequest(req);
    const requestBody = await req.json();

    if (user) {
      // Inject userId into the LangGraph agent's state
      requestBody.state = requestBody.state || {};
      requestBody.state.userProfile = requestBody.state.userProfile || {};
      requestBody.state.userProfile.userId = user.id;
    }

    return await runtime.response(requestBody, serviceAdapter);
  } catch (error) {
    if (error instanceof Error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 500 });
  }
};
