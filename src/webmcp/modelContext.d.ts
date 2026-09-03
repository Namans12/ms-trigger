// Minimal ambient types for the WebMCP `document.modelContext` API
// (https://github.com/webmachinelearning/webmcp). Only the surface this app
// actually calls — registerTool — is declared; the spec has more (getTools,
// executeTool, the toolchange event) that we don't use yet.

interface ModelContextToolResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<ModelContextToolResult | unknown> | ModelContextToolResult | unknown;
}

interface ModelContext {
  registerTool: (tool: ModelContextTool, options?: { signal?: AbortSignal }) => Promise<void>;
}

interface Document {
  modelContext?: ModelContext;
}
