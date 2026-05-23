import { AgentContext } from './context';

// ANSI colors visible on dark and light terminals (avoid red — that's for errors).
const AGENT_COLORS = ['\x1b[36m', '\x1b[33m', '\x1b[35m', '\x1b[32m', '\x1b[34m', '\x1b[96m', '\x1b[93m'];
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const agentColorMap = new Map<string, string>();

function colorFor(agentName: string): string {
  if (!agentColorMap.has(agentName)) {
    agentColorMap.set(agentName, AGENT_COLORS[agentColorMap.size % AGENT_COLORS.length]);
  }
  return agentColorMap.get(agentName)!;
}

export interface MiddlewareContext {
  operation: 'model_call' | 'tool_call' | 'memory_access';
  agentName: string;
  agentContext: AgentContext;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export abstract class BaseMiddleware {
  async processRequest(context: MiddlewareContext): Promise<MiddlewareContext> {
    return context;
  }

  async processResponse(context: MiddlewareContext, result: unknown): Promise<unknown> {
    return result;
  }

  async processError(_context: MiddlewareContext, error: Error): Promise<void> {
    throw error;
  }
}

export class LoggingMiddleware extends BaseMiddleware {
  async processRequest(context: MiddlewareContext): Promise<MiddlewareContext> {
    const color = colorFor(context.agentName);
    const prefix = `${color}[${context.agentName}]${RESET}`;
    if (context.operation === 'tool_call') {
      const toolName = context.data['toolName'] ?? '?';
      const params = context.data['parameters'] as Record<string, unknown> ?? {};
      const paramStr = Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
      console.log(`${prefix}${DIM}  → tool: ${toolName}(${paramStr})${RESET}`);
    } else {
      console.log(`${prefix} ${context.operation}`);
    }
    context.metadata['startTime'] = Date.now();
    return context;
  }

  async processResponse(context: MiddlewareContext, result: unknown): Promise<unknown> {
    const elapsed = ((Date.now() - (context.metadata['startTime'] as number ?? Date.now())) / 1000).toFixed(2);
    if (context.operation === 'tool_call') {
      const color = colorFor(context.agentName);
      console.log(`${color}[${context.agentName}]${RESET}${DIM}     done (${elapsed}s)${RESET}`);
    }
    return result;
  }
}

export class MiddlewareChain {
  private middlewares: BaseMiddleware[];

  constructor(middlewares: BaseMiddleware[] = []) {
    this.middlewares = middlewares;
  }

  async execute(context: MiddlewareContext): Promise<MiddlewareContext> {
    for (const middleware of this.middlewares) {
      context = await middleware.processRequest(context);
    }
    return context;
  }

  async executeResponse(context: MiddlewareContext, result: unknown): Promise<unknown> {
    for (const middleware of this.middlewares) {
      result = await middleware.processResponse(context, result);
    }
    return result;
  }
}
