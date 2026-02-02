/**
 * Careers Coach LangGraph Agent
 *
 * A multi-node agent for career coaching with HITL (Human-in-the-Loop) capabilities.
 * This agent handles onboarding, profile management, and job search.
 *
 * Integrated with CopilotKit for frontend tools and actions.
 */

import { z } from "zod";
import { query } from "./db.js";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, SystemMessage, HumanMessage } from "@langchain/core/messages";
import { MemorySaver, START, END, StateGraph, interrupt, Command } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation } from "@langchain/langgraph";
import {
  CopilotKitStateAnnotation,
  convertActionsToDynamicStructuredTools,
} from "@copilotkit/sdk-js/langgraph";

// =============================================================================
// State Definition (includes CopilotKit state for frontend actions)
// =============================================================================

const CareerAgentState = Annotation.Root({
  // CopilotKit state annotation includes messages and frontend tools/actions
  ...CopilotKitStateAnnotation.spec,

  // User profile information
  userProfile: Annotation<{
    userId?: string;
    name?: string;
    email?: string;
    skills?: string[];
    experienceYears?: number;
    desiredRole?: string;
    salaryRange?: { min?: number; max?: number };
    locationPreference?: string;
    remotePreference?: 'remote' | 'hybrid' | 'onsite';
    isOnboarded?: boolean;
  }>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),

  // Current node tracking
  currentNode: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "onboarding",
  }),

  // Pending confirmation data
  pendingConfirmation: Annotation<{
    type?: 'soft' | 'hard';
    action?: string;
    data?: Record<string, unknown>;
  } | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
});

export type CareerAgentStateType = typeof CareerAgentState.State;

// =============================================================================
// Tools with HITL
// =============================================================================

/**
 * Save user profile - requires soft confirmation
 */
import { query } from "./db.js";

// ... (rest of the file is the same until saveProfile)

const saveProfile = tool(
  async ({ userId, skills, experienceYears, desiredRole, salaryMin, salaryMax, locationPreference, remotePreference }) => {
    // This tool now requires a userId to save the profile against.
    // The calling agent MUST provide the userId from the user's session.
    if (!userId) {
      return JSON.stringify({
        success: false,
        message: "Could not save profile because user is not authenticated. Please sign in.",
      });
    }

    const profileData = {
      skills,
      experienceYears,
      desiredRole,
      salaryRange: { min: salaryMin, max: salaryMax },
      locationPreference,
      remotePreference,
    };

    // Soft HITL - ask user to confirm before saving
    const confirmationMessage = `I'd like to save your profile with:
- Skills: ${skills?.join(', ') || 'Not specified'}
- Experience: ${experienceYears || 'Not specified'} years
- Desired Role: ${desiredRole || 'Not specified'}
- Salary Range: ${salaryMin ? `$${salaryMin}` : '?'} - ${salaryMax ? `$${salaryMax}` : '?'}
- Location: ${locationPreference || 'Not specified'}
- Work Style: ${remotePreference || 'Not specified'}

Is this correct?`;

    const userResponse = interrupt(confirmationMessage);

    if (userResponse?.toLowerCase().includes('yes') || userResponse?.toLowerCase().includes('correct')) {
      try {
        const sql = `
          INSERT INTO user_profiles (user_id, profile_data)
          VALUES ($1, $2)
          ON CONFLICT (user_id)
          DO UPDATE SET profile_data = EXCLUDED.profile_data, updated_at = CURRENT_TIMESTAMP;
        `;
        await query(sql, [userId, JSON.stringify(profileData)]);
        
        return JSON.stringify({
          success: true,
          message: "Profile saved successfully!",
          profile: profileData,
        });
      } catch (error) {
        console.error("Failed to save profile to database:", error);
        return JSON.stringify({
          success: false,
          message: "Sorry, I encountered an error while saving your profile. Please try again.",
        });
      }
    }

    return JSON.stringify({
      success: false,
      message: "Profile save cancelled. What would you like to change?"
    });
  },
  {
    name: "save_profile",
    description: "Save the user's career profile to the database. Use this when you have gathered enough information about their skills, experience, and job preferences.",
    schema: z.object({
      userId: z.string().describe("The ID of the user to save the profile for. This is required."),
      skills: z.array(z.string()).optional().describe("List of professional skills"),
      experienceYears: z.number().optional().describe("Years of professional experience"),
      desiredRole: z.string().optional().describe("The type of role they're looking for"),
      salaryMin: z.number().optional().describe("Minimum desired salary"),
      salaryMax: z.number().optional().describe("Maximum desired salary"),
      locationPreference: z.string().optional().describe("Preferred work location"),
      remotePreference: z.enum(['remote', 'hybrid', 'onsite']).optional().describe("Remote work preference"),
    }),
  }
);

/**
 * Update individual skill - soft confirmation
 */
const updateSkills = tool(
  async ({ action, skill }) => {
    const confirmMessage = action === 'add'
      ? `I'll add "${skill}" to your skills. Sound good?`
      : `I'll remove "${skill}" from your skills. Is that right?`;

    const userResponse = interrupt(confirmMessage);

    if (userResponse?.toLowerCase().includes('yes') || userResponse?.toLowerCase().includes('good')) {
      return `${action === 'add' ? 'Added' : 'Removed'} "${skill}" ${action === 'add' ? 'to' : 'from'} your profile.`;
    }

    return "No changes made. What would you like to do instead?";
  },
  {
    name: "update_skills",
    description: "Add or remove a skill from the user's profile.",
    schema: z.object({
      action: z.enum(['add', 'remove']).describe("Whether to add or remove the skill"),
      skill: z.string().describe("The skill to add or remove"),
    }),
  }
);

/**
 * Search for jobs - no confirmation needed
 */
const searchJobs = tool(
  async ({ query, location, remote, salaryMin }) => {
    // In production, this would call a job search API
    const mockJobs = [
      { title: "Senior Software Engineer", company: "TechCorp", location: "San Francisco, CA", salary: "$150k-$200k", remote: true },
      { title: "Full Stack Developer", company: "StartupXYZ", location: "New York, NY", salary: "$130k-$170k", remote: true },
      { title: "Backend Engineer", company: "BigCo Inc", location: "Austin, TX", salary: "$140k-$180k", remote: false },
    ];

    return JSON.stringify({
      jobs: mockJobs,
      totalResults: 3,
      query,
    });
  },
  {
    name: "search_jobs",
    description: "Search for job opportunities based on criteria. Use after the user is onboarded.",
    schema: z.object({
      query: z.string().describe("Job search query (title, keywords)"),
      location: z.string().optional().describe("Location preference"),
      remote: z.boolean().optional().describe("Filter for remote jobs"),
      salaryMin: z.number().optional().describe("Minimum salary filter"),
    }),
  }
);

/**
 * Apply to a job - requires HARD confirmation
 */
const applyToJob = tool(
  async ({ jobId, jobTitle, company, coverLetterPoints }) => {
    // HARD HITL - this is an important action
    const confirmMessage = `
IMPORTANT: I'm about to submit your application to:

Position: ${jobTitle}
Company: ${company}

Cover letter will highlight:
${coverLetterPoints?.map(p => `- ${p}`).join('\n') || '- Your relevant experience'}

This will send your profile to the employer. Do you want me to proceed? Please confirm with "yes, apply" or "no, cancel".`;

    const userResponse = interrupt(confirmMessage);

    if (userResponse?.toLowerCase().includes('yes') && userResponse?.toLowerCase().includes('apply')) {
      return JSON.stringify({
        success: true,
        message: `Application submitted to ${company} for ${jobTitle}! They'll contact you at your email on file.`,
        applicationId: `APP-${Date.now()}`,
      });
    }

    return JSON.stringify({
      success: false,
      message: "Application cancelled. Let me know when you're ready to apply.",
    });
  },
  {
    name: "apply_to_job",
    description: "Submit a job application. Requires explicit user confirmation as this sends their information to an employer.",
    schema: z.object({
      jobId: z.string().describe("The job ID to apply to"),
      jobTitle: z.string().describe("The job title"),
      company: z.string().describe("The company name"),
      coverLetterPoints: z.array(z.string()).optional().describe("Key points to highlight in cover letter"),
    }),
  }
);

/**
 * End conversation
 */
const endConversation = tool(
  async ({ reason }) => {
    return `Conversation ended: ${reason}. It was great chatting with you!`;
  },
  {
    name: "end_conversation",
    description: "End the conversation when the user says goodbye or is done.",
    schema: z.object({
      reason: z.string().describe("Reason for ending the conversation"),
    }),
  }
);

const tools = [saveProfile, updateSkills, searchJobs, applyToJob, endConversation];

// =============================================================================
// Nodes
// =============================================================================

const SYSTEM_PROMPT = `You are a warm, encouraging career coach assistant. Your goal is to help job seekers with their career journey.

CONVERSATION FLOW:
1. If the user is not onboarded (profile incomplete), focus on getting to know them
2. Ask about their skills, experience, and what they're looking for
3. Use save_profile when you have enough information
4. Once onboarded, help them search for jobs and prepare applications

IMPORTANT RULES:
- Be conversational and friendly
- Ask one question at a time
- Use the tools to save information and search jobs
- For job applications, always explain what will happen before using apply_to_job

USER PROFILE:
{profile}

CURRENT STATUS:
{status}`;

async function chatNode(state: CareerAgentStateType, config: RunnableConfig) {
  const model = new ChatOpenAI({
    temperature: 0.7,
    model: "gpt-4o",
  });

  // Convert CopilotKit frontend actions to tools and combine with our backend tools
  const frontendTools = convertActionsToDynamicStructuredTools(
    state.copilotkit?.actions ?? []
  );
  const allTools = [...tools, ...frontendTools];
  const modelWithTools = model.bindTools(allTools);

  const profile = state.userProfile;
  const isOnboarded = profile.isOnboarded || (profile.skills?.length && profile.desiredRole);

  const systemMessage = new SystemMessage({
    content: SYSTEM_PROMPT
      .replace('{profile}', JSON.stringify(profile, null, 2))
      .replace('{status}', isOnboarded ? 'User is onboarded - ready for job search' : 'User needs onboarding - gather their profile information'),
  });

  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages],
    config as any, // Type cast to handle version mismatch
  );

  return {
    messages: [response],
    currentNode: isOnboarded ? "job_search" : "onboarding",
  };
}

function shouldContinue(state: CareerAgentStateType) {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

  if (lastMessage.tool_calls?.length) {
    // Get frontend actions from CopilotKit
    const actions = state.copilotkit?.actions ?? [];
    const toolCallName = lastMessage.tool_calls[0].name;

    // Only route to tool node for backend tools (not frontend actions)
    const isFrontendAction = actions.some(
      (action: { name: string }) => action.name === toolCallName
    );
    if (!isFrontendAction) {
      return "tools";
    }
  }

  return END;
}

// =============================================================================
// Graph
// =============================================================================

const workflow = new StateGraph(CareerAgentState)
  .addNode("chat", chatNode)
  .addNode("tools", new ToolNode(tools))
  .addEdge(START, "chat")
  .addEdge("tools", "chat")
  .addConditionalEdges("chat", shouldContinue);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});

export { CareerAgentState };
