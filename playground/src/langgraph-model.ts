import {
  type BaseMessage,
  isBaseMessageChunk,
} from '@langchain/core/messages'
import {
  type ChatResult,
  type LLMCallbackManager,
  SimpleChatModel,
} from '@langchain/core/language_models/chat_models'
import { getEnvironmentVariable } from '@langchain/core/utils/env'

const LANGGRAPH_API_URL =
  getEnvironmentVariable('LANGGRAPH_DEPLOYMENT_URL') || 'http://localhost:8123'

/**
 * A custom LangChain model that routes calls to a LangGraph agent endpoint.
 */
export class LangGraphModel extends SimpleChatModel {
  private threadId?: string

  constructor(threadId?: string) {
    super()
    this.threadId = threadId
  }

  _llmType() {
    return 'langgraph'
  }

  /**
   * Generates a random thread ID. In a real app, this should be
   * managed based on user sessions.
   */
  private createThreadId(): string {
    return `thread_${Math.random().toString(36).substring(2, 15)}`
  }

  /**
   * The main call to the LangGraph agent.
   */
  async _call(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _callbacks?: LLMCallbackManager | undefined
  ): Promise<string> {
    const userMessage = messages[messages.length - 1].content

    if (typeof userMessage !== 'string') {
      throw new Error('LangGraphModel expects the last message to be a string.')
    }

    const threadId = this.threadId || this.createThreadId()
    console.log(`[LangGraphModel] Calling agent for thread: ${threadId}`)

    const response = await fetch(`${LANGGRAPH_API_URL}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistant_id: 'careers_coach',
        thread_id: threadId,
        input: { messages: [{ role: 'human', content: userMessage }] },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(
        `[LangGraphModel] Error from LangGraph API: ${response.status} ${errorText}`
      )
      throw new Error(`LangGraph API request failed: ${errorText}`)
    }

    // LangGraph can stream responses. We need to find the final assistant message.
    const responseStream = response.body
    if (!responseStream) {
      return 'Sorry, I received an empty response from the agent.'
    }

    // This is a simplified way to handle LangGraph streams.
    // It just concatenates message chunks. A more robust solution
    // would parse the event stream properly.
    const reader = responseStream.getReader()
    const decoder = new TextDecoder()
    let fullResponse = ''
    let lastMessage = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      fullResponse += chunk

      // Poor man's stream parsing: find the last "content" value
      try {
        const lines = fullResponse.split('\n')
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const json = JSON.parse(line.substring(5))
            if (
              json.event === 'on_chat_model_stream' &&
              isBaseMessageChunk(json.data.chunk) &&
              typeof json.data.chunk.content === 'string'
            ) {
              // This will overwrite until we get the final chunk with content
              lastMessage += json.data.chunk.content
            }
          }
        }
      } catch {
        // Ignore parsing errors, just wait for more data
      }
    }

    console.log(`[LangGraphModel] Received response: "${lastMessage}"`)
    return lastMessage || "I'm sorry, I couldn't generate a response."
  }

  // Not implemented, but required by the abstract class.
  _streamResponseChunks(
    _messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _callbacks?: LLMCallbackManager | undefined
  ): AsyncGenerator<ChatResult> {
    throw new Error('Method not implemented.')
  }
}
