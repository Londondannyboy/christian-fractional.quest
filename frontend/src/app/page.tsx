"use client";

import { CopilotSidebar } from "@copilotkit/react-ui";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { authClient } from "@/lib/auth/client";
import { useMemo, useState, useEffect, useCallback } from "react";
import { useZepMemory } from "@/hooks/useZepMemory";

// Try to import useAgent from v2 API for HITL support
let useAgent: (() => { agent: any }) | null = null;
try {
  // Dynamic import check - this will work if the v2 API is available
  const v2Module = require("@copilotkit/react-core/v2");
  useAgent = v2Module.useAgent;
} catch {
  // v2 API not available, HITL will use fallback
}

/**
 * HITL (Human-in-the-Loop) Confirmation Handler
 * Displays pill buttons when the LangGraph agent requests confirmation
 */
function HITLConfirmation({
  message,
  onConfirm,
  onCancel,
  type = "soft",
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  type?: "soft" | "hard";
}) {
  const isHard = type === "hard";

  return (
    <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
      <div
        className={`
        p-4 rounded-xl shadow-2xl border-2 max-w-md
        ${isHard ? "bg-amber-50 border-amber-300" : "bg-white border-gray-200"}
      `}
      >
        {isHard && (
          <div className="flex items-center gap-2 mb-2 text-amber-700">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-semibold text-sm">Action Required</span>
          </div>
        )}
        <p className="text-gray-700 mb-4 whitespace-pre-line">{message}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={onConfirm}
            className={`
              px-5 py-2 rounded-full font-medium transition-all
              ${
                isHard
                  ? "bg-amber-500 hover:bg-amber-600 text-white"
                  : "bg-green-500 hover:bg-green-600 text-white"
              }
            `}
          >
            {isHard ? "Yes, Proceed" : "Confirm"}
          </button>
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-full font-medium bg-gray-200 hover:bg-gray-300 text-gray-700 transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to handle HITL interrupts from LangGraph agent
 */
function useHITLHandler() {
  const [interrupt, setInterrupt] = useState<{
    message: string;
    type: "soft" | "hard";
  } | null>(null);

  // Try to use the v2 agent API if available
  const agentHook = useAgent ? useAgent() : null;
  const agent = agentHook?.agent;

  useEffect(() => {
    if (!agent) return;

    const subscriber = {
      onCustomEvent: ({ event }: { event: { name: string; value: string } }) => {
        if (event.name === "on_interrupt") {
          // Determine if this is a hard or soft confirmation
          const isHard =
            event.value.toLowerCase().includes("important") ||
            event.value.toLowerCase().includes("submit") ||
            event.value.toLowerCase().includes("apply");
          setInterrupt({
            message: event.value,
            type: isHard ? "hard" : "soft",
          });
        }
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    return () => unsubscribe();
  }, [agent]);

  const handleResponse = useCallback(
    (response: string) => {
      if (agent) {
        agent.runAgent({
          forwardedProps: {
            command: { resume: response },
          },
        });
      }
      setInterrupt(null);
    },
    [agent]
  );

  return { interrupt, handleResponse };
}

export default function Home() {
  const { data: session } = authClient.useSession();

  // HITL handler for LangGraph interrupts
  const { interrupt, handleResponse } = useHITLHandler();

  // Extract user info
  const user = session?.user;
  const firstName = user?.name?.split(' ')[0] || null;

  // Initialize Zep memory
  const zepConfig = useMemo(() => {
    if (!user?.id) return null;
    return {
      userId: user.id,
      userName: user.name || undefined,
      userEmail: user.email || undefined,
    };
  }, [user?.id, user?.name, user?.email]);

  const {
    addToGraph,
    getMemoryPrompt,
  } = useZepMemory(zepConfig);

  // Provide user context as readable data to CopilotKit
  useCopilotReadable({
    description: "Current user information",
    value: user ? {
      name: user.name,
      firstName: firstName,
      email: user.email,
      id: user.id,
      isAuthenticated: true,
    } : {
      isAuthenticated: false,
    },
  });

  // CopilotKit action to save career information to memory
  useCopilotAction({
    name: "saveCareerInfo",
    description: "Save important career information about the user to long-term memory. Use this when the user shares significant career details like their skills, experience, job preferences, or career goals.",
    parameters: [
      {
        name: "category",
        type: "string",
        description: "Category of information: skills, experience, preferences, goals, education, or other",
        required: true,
      },
      {
        name: "information",
        type: "string",
        description: "The career information to save",
        required: true,
      },
    ],
    handler: async ({ category, information }) => {
      if (!user?.id) return "User not authenticated";

      const careerData = JSON.stringify({
        userId: user.id,
        category,
        information,
        timestamp: new Date().toISOString(),
      });

      await addToGraph(careerData, "json");
      return `Saved ${category} information to memory: ${information}`;
    },
  });

  // Get memory context from Zep
  const memoryPrompt = getMemoryPrompt();

  // Build instructions with user context and memory
  const instructions = useMemo(() => {
    if (!user) {
      return `You are a helpful career coach assistant. Help users with job searching, career advice, resume tips, and interview preparation. Be encouraging and professional.

The user is not signed in yet. Encourage them to sign in to save their career profile and get personalized recommendations.`;
    }

    let baseInstructions = `You are a warm, encouraging career coach assistant.

CRITICAL: You have access to user information via the "Current user information" readable data. The user's name is "${user.name}" and their first name is "${firstName}".

ALWAYS:
- Address the user as "${firstName}" in your responses
- Be warm, encouraging, and professional
- Help with job searching, career advice, resume tips, and interview preparation
- Remember their context throughout the conversation

CAPABILITIES:
- Career path advice and planning
- Job search strategies
- Resume and cover letter tips
- Interview preparation and practice
- Salary negotiation guidance
- Skills development recommendations

When users share career information (skills, experience, goals, preferences), use the saveCareerInfo action to save it to their long-term memory.`;

    // Add memory context if available
    if (memoryPrompt) {
      baseInstructions += memoryPrompt;
    }

    return baseInstructions;
  }, [user, firstName, memoryPrompt]);

  // Build initial message
  const initialMessage = useMemo(() => {
    if (firstName) {
      return `Hi ${firstName}! I'm your AI career coach. How can I help you with your career today?`;
    }
    return "Hi! I'm your AI career coach. How can I help you today?";
  }, [firstName]);

  return (
    <div className="min-h-screen flex">
      {/* HITL Confirmation Modal */}
      {interrupt && (
        <HITLConfirmation
          message={interrupt.message}
          type={interrupt.type}
          onConfirm={() => handleResponse("yes")}
          onCancel={() => handleResponse("no")}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 p-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">
            Welcome{firstName ? `, ${firstName}` : ''}!
          </h2>

          {!session ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
              <h3 className="text-xl font-semibold mb-2">Get Started</h3>
              <p className="text-gray-600 mb-4">
                Sign in to save your career profile and get personalized job recommendations.
              </p>
              <a
                href="/auth/sign-in"
                className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
              >
                Sign In
              </a>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
              <h3 className="text-xl font-semibold mb-2">Your Career Coach is Ready</h3>
              <p className="text-gray-600">
                Start a conversation using the chat panel on the right. Ask about job opportunities,
                get resume tips, or discuss your career goals.
              </p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-2">Career Coaching</h3>
              <p className="text-gray-600">
                Get personalized advice on your career path, skills development, and professional growth.
              </p>
            </div>

            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-2">Job Search</h3>
              <p className="text-gray-600">
                Find job opportunities that match your skills, experience, and preferences.
              </p>
            </div>

            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-2">Resume Review</h3>
              <p className="text-gray-600">
                Get feedback on your resume and tips to make it stand out to employers.
              </p>
            </div>

            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-2">Interview Prep</h3>
              <p className="text-gray-600">
                Practice common interview questions and get coaching on your responses.
              </p>
            </div>
          </div>

          {/* Voice Agent Link */}
          {session && (
            <div className="mt-8 p-6 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
              <h3 className="text-xl font-semibold mb-2">Voice Career Coach</h3>
              <p className="text-gray-600 mb-4">
                Prefer talking? Try our voice-enabled career coach with emotionally expressive AI.
              </p>
              <a
                href={`http://localhost:3001?name=${encodeURIComponent(firstName || user?.name || '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700"
              >
                Start Voice Session
              </a>
            </div>
          )}
        </div>
      </div>

      {/* CopilotKit Sidebar */}
      <CopilotSidebar
        defaultOpen={true}
        instructions={instructions}
        labels={{
          title: "Career Coach",
          initial: initialMessage,
        }}
      />
    </div>
  );
}
