/* eslint-disable @typescript-eslint/no-explicit-any */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

import { handleAskTeacher } from './tools/askTeacher';
import { handleGetStatus } from './tools/getStatus';
import { handleCreateCheckout } from './tools/createCheckout';

// セッションごとに Transport を保持する Map
const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * 新しい MCP セッション用の McpServer インスタンスを作成する
 * セッションごとに独立したサーバーインスタンスを持つ
 */
function createMcpServer(): McpServer {
  // McpServer の型推論が深すぎる場合への対処として any を使用
  const server = new McpServer({
    name: 'EnglishTeacher',
    version: '1.0.0',
  });

  // ツール1: 英語の質問に回答する
  // Zod スキーマを MCP SDK に渡す際の型推論深さ問題を回避するため any キャスト
  (server.tool as any)(
    'ask_english_teacher',
    '英語に関する質問（文法・語彙・作文校正・発音など）に AI 英語教師が回答します。未払いユーザーは無料制限があります。',
    {
      user_id: { type: 'string', minLength: 1, description: 'ChatGPT ユーザーの識別子' },
      question: { type: 'string', minLength: 1, maxLength: 2000, description: '英語に関する質問' },
    },
    async (args: { user_id: string; question: string }) => {
      const result = await handleAskTeacher(args);
      return {
        content: [{ type: 'text', text: result.answer ?? result.message ?? '' }],
        structuredContent: result,
      };
    },
  );

  // ツール2: サブスクリプション状態を確認する
  (server.tool as any)(
    'get_subscription_status',
    'ユーザーの現在のサブスクリプション状態（無料/有料）と残り無料回数を確認します。',
    {
      user_id: { type: 'string', minLength: 1, description: 'ChatGPT ユーザーの識別子' },
    },
    async (args: { user_id: string }) => {
      const result = await handleGetStatus(args);
      return {
        content: [{ type: 'text', text: result.message }],
        structuredContent: result,
      };
    },
  );

  // ツール3: 支払いページの URL を取得する
  (server.tool as any)(
    'create_checkout_url',
    '支払いページの URL を生成します。ユーザーがこの URL で支払いを完了すると有料プランが有効になります。',
    {
      user_id: { type: 'string', minLength: 1, description: 'ChatGPT ユーザーの識別子' },
    },
    async (args: { user_id: string }) => {
      const result = await handleCreateCheckout(args);
      return {
        content: [{ type: 'text', text: result.message }],
        structuredContent: result,
      };
    },
  );

  return server;
}

/**
 * MCP HTTP エンドポイントのハンドラー（POST /mcp）
 * ChatGPT からのツール呼び出しを処理する
 */
export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport!);
      },
    });

    transport.onclose = () => {
      if (transport?.sessionId) {
        transports.delete(transport.sessionId);
      }
    };

    const server = createMcpServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
}

/**
 * MCP HTTP エンドポイントのハンドラー（GET /mcp）
 * SSE ストリーミング接続に対応する
 */
export async function handleMcpGet(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    res.status(404).json({ error: 'セッションが見つかりません' });
    return;
  }

  await transport.handleRequest(req, res);
}

/**
 * MCP HTTP エンドポイントのハンドラー（DELETE /mcp）
 * セッションを終了する
 */
export async function handleMcpDelete(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    res.status(404).json({ error: 'セッションが見つかりません' });
    return;
  }

  await transport.handleRequest(req, res);
}
