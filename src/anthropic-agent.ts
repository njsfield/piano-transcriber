import Anthropic from '@anthropic-ai/sdk';
import type { Messages } from '@anthropic-ai/sdk/resources/messages/messages';
import { Agent } from './agent';
import { BaseChatClient } from './client';
import { BaseTool } from './tool';
import { LoggingMiddleware } from './middleware';
import type {
  Message,
  AssistantMessage,
  ToolMessage,
  ChatCompletionResult,
  ToolCallRequest,
  ToolSchema,
  Usage,
} from './types';

export class AnthropicChatClient extends BaseChatClient {
  readonly model: string;
  private client: Anthropic;

  constructor(model: string, apiKey?: string) {
    super();
    this.model = model;
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  async create(messages: Message[], tools?: ToolSchema[]): Promise<ChatCompletionResult> {
    // Extract system message (must be first message with role 'system')
    let systemPrompt: string | undefined;
    const nonSystemMessages = messages.filter(m => {
      if (m.role === 'system') { systemPrompt = m.content; return false; }
      return true;
    });

    const apiMessages = this.convertMessages(nonSystemMessages);
    const apiTools: Messages.Tool[] | undefined = tools && tools.length > 0 ? tools.map(t => ({
      name: t.function.name,
      description: t.function.description ?? '',
      input_schema: {
        type: 'object' as const,
        properties: t.function.parameters.properties ?? {},
        required: t.function.parameters.required ?? [],
      },
    })) : undefined;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: apiMessages,
      tools: apiTools,
    });

    let content = '';
    let toolCalls: ToolCallRequest[] | undefined;

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        if (!toolCalls) toolCalls = [];
        toolCalls.push({
          toolName: block.name,
          parameters: block.input as Record<string, unknown>,
          callId: block.id,
        });
      }
    }

    const assistantMessage: AssistantMessage = {
      role: 'assistant',
      content,
      source: 'assistant',
      timestamp: new Date(),
      toolCalls,
    };

    const usage: Usage = {
      tokens: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
    };

    return {
      message: assistantMessage,
      usage,
      model: response.model,
      finishReason: response.stop_reason ?? undefined,
    };
  }

  private convertMessages(messages: Message[]): Messages.MessageParam[] {
    const result: Messages.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        result.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const m = msg as AssistantMessage;
        if (m.toolCalls && m.toolCalls.length > 0) {
          const contentBlocks: Messages.ContentBlockParam[] = [];
          if (m.content) contentBlocks.push({ type: 'text', text: m.content });
          for (const tc of m.toolCalls) {
            const block: Messages.ToolUseBlockParam = {
              type: 'tool_use',
              id: tc.callId,
              name: tc.toolName,
              input: tc.parameters,
            };
            contentBlocks.push(block);
          }
          result.push({ role: 'assistant', content: contentBlocks });
        } else {
          result.push({ role: 'assistant', content: m.content });
        }
      } else if (msg.role === 'tool') {
        const m = msg as ToolMessage;
        const toolResult: Messages.ToolResultBlockParam = {
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content: m.content,
        };
        result.push({
          role: 'user',
          content: [toolResult],
        });
      }
    }

    return result;
  }
}

export interface AnthropicAgentOptions {
  model?: string;
  apiKey?: string;
  tools?: BaseTool[];
}

export class AnthropicAgent extends Agent {
  constructor(name: string, instructions: string, options: AnthropicAgentOptions = {}) {
    const {
      model = 'claude-sonnet-4-6',
      apiKey,
      tools,
    } = options;

    const client = new AnthropicChatClient(model, apiKey);
    super(name, instructions, client, tools, undefined, undefined, [new LoggingMiddleware()]);
  }
}
