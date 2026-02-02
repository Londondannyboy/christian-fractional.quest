"use client";

import { CopilotSidebar } from "@copilotkit/react-ui";
import { authClient } from "@/lib/auth/client";
import { redirect } from "next/navigation";

export default function DashboardPage() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!session) {
    redirect("/auth/sign-in");
  }

  return (
    <div className="min-h-screen flex">
      {/* Main Content */}
      <div className="flex-1 p-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">
            Welcome back, {session.user?.name || session.user?.email}!
          </h2>

          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
            <h3 className="text-xl font-semibold mb-2">Your Career Coach is Ready</h3>
            <p className="text-gray-600">
              Start a conversation using the chat panel on the right. Ask about job opportunities,
              get resume tips, or discuss your career goals.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-2">Your Profile</h3>
              <p className="text-gray-600 mb-4">
                Update your skills, experience, and job preferences.
              </p>
              <a href="/profile" className="text-blue-600 hover:underline">
                Edit Profile →
              </a>
            </div>

            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-2">Job Matches</h3>
              <p className="text-gray-600 mb-4">
                View jobs that match your profile and preferences.
              </p>
              <a href="/jobs" className="text-blue-600 hover:underline">
                View Jobs →
              </a>
            </div>

            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-2">Conversations</h3>
              <p className="text-gray-600 mb-4">
                Review your past coaching sessions and advice.
              </p>
              <a href="/conversations" className="text-blue-600 hover:underline">
                View History →
              </a>
            </div>

            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold mb-2">Voice Coach</h3>
              <p className="text-gray-600 mb-4">
                Talk to your career coach using voice.
              </p>
              <a
                href="http://localhost:3001"
                target="_blank"
                className="text-blue-600 hover:underline"
              >
                Start Voice Session →
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* CopilotKit Sidebar */}
      <CopilotSidebar
        defaultOpen={true}
        instructions="You are a helpful career coach assistant. Help users with job searching, career advice, resume tips, and interview preparation. Be encouraging and professional."
        labels={{
          title: "Career Coach",
          initial: "Hi! I'm your AI career coach. How can I help you today?",
        }}
      />
    </div>
  );
}
