import * as readline from 'node:readline';

/**
 * A small, dependency-free implementation of the parts of the Model Context
 * Protocol that CodeSprint needs: lifecycle, tools and prompts over stdio
 * (newline-delimited JSON-RPC 2.0). Keeping it dependency-free means the
 * extension installs instantly from npm and has no supply-chain surface.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  handler(args: Record<string, unknown>): Promise<string> | string;
}

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  handler(): Promise<string> | string;
}

export interface ServerInfo {
  name: string;
  title: string;
  version: string;
  instructions?: string;
}

type Id = string | number | null;
interface Request {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

const ERR = { parse: -32700, invalidRequest: -32600, notFound: -32601, invalidParams: -32602, internal: -32603 } as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class McpServer {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly prompts = new Map<string, PromptDefinition>();

  constructor(
    private readonly info: ServerInfo,
    private readonly write: (line: string) => void = (line) => process.stdout.write(line + '\n')
  ) {}

  addTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  addPrompt(prompt: PromptDefinition): void {
    this.prompts.set(prompt.name, prompt);
  }

  /** Reads stdin until it closes. Diagnostics go to stderr; stdout is reserved for the protocol. */
  listen(input: NodeJS.ReadableStream = process.stdin): Promise<void> {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (line.trim()) {
        void this.handleLine(line);
      }
    });
    return new Promise((resolve) => rl.on('close', resolve));
  }

  async handleLine(line: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.error(null, ERR.parse, 'Parse error');
      return;
    }
    if (Array.isArray(message)) {
      for (const item of message) {
        await this.handleMessage(item);
      }
      return;
    }
    await this.handleMessage(message);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      // Responses to requests we never send, or garbage: ignore responses, reject the rest.
      if (!isObject(message) || !('result' in message || 'error' in message)) {
        this.error(isObject(message) && 'id' in message ? (message.id as Id) : null, ERR.invalidRequest, 'Invalid request');
      }
      return;
    }
    const request = message as unknown as Request;
    const isNotification = !('id' in request) || request.id === undefined;
    try {
      const result = await this.dispatch(request);
      if (!isNotification) {
        this.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
      }
    } catch (e) {
      if (isNotification) {
        return;
      }
      if (e instanceof RpcError) {
        this.error(request.id ?? null, e.code, e.message);
      } else {
        process.stderr.write(`[codesprint] ${(e as Error).stack ?? String(e)}\n`);
        this.error(request.id ?? null, ERR.internal, 'Internal error');
      }
    }
  }

  private async dispatch(req: Request): Promise<unknown> {
    const params = req.params ?? {};
    switch (req.method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const version = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
        return {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: this.info.name, title: this.info.title, version: this.info.version },
          ...(this.info.instructions ? { instructions: this.info.instructions } : {}),
        };
      }
      case 'ping':
        return {};
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;
      case 'tools/list':
        return {
          tools: [...this.tools.values()].map(({ name, title, description, inputSchema, annotations }) => ({
            name, title, description, inputSchema, annotations,
          })),
        };
      case 'tools/call':
        return this.callTool(params);
      case 'prompts/list':
        return { prompts: [...this.prompts.values()].map(({ name, title, description }) => ({ name, title, description })) };
      case 'prompts/get':
        return this.getPrompt(params);
      default:
        throw new RpcError(ERR.notFound, `Method not found: ${req.method}`);
    }
  }

  private async callTool(params: Record<string, unknown>): Promise<unknown> {
    const tool = typeof params.name === 'string' ? this.tools.get(params.name) : undefined;
    if (!tool) {
      throw new RpcError(ERR.invalidParams, `Unknown tool: ${String(params.name)}`);
    }
    const args = isObject(params.arguments) ? params.arguments : {};
    try {
      const text = await tool.handler(args);
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      // Tool failures are reported in-band so the model can read and react to them.
      return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
    }
  }

  private async getPrompt(params: Record<string, unknown>): Promise<unknown> {
    const prompt = typeof params.name === 'string' ? this.prompts.get(params.name) : undefined;
    if (!prompt) {
      throw new RpcError(ERR.invalidParams, `Unknown prompt: ${String(params.name)}`);
    }
    const text = await prompt.handler();
    return { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text } }] };
  }

  private error(id: Id, code: number, message: string): void {
    this.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
  }
}

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}
