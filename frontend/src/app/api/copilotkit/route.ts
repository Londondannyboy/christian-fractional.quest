import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest } from "next/server";

// Use empty adapter since our LangGraph agent handles the LLM
const serviceAdapter = new ExperimentalEmptyAdapter();

// Connect to the LangGraph agent served by the CLI
const runtime = new CopilotRuntime({
  agents: {
    careers_coach: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123",
      graphId: "careers_coach",
      langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
    }),
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
