export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { BUILTIN_MCP_TOOLS, executeBuiltinTool } from '@/lib/tools-engine';

export async function POST(req: NextRequest) {
  try {
    const rpc = await req.json();
    const id = rpc.id ?? 1;
    if (rpc.method === 'tools/list') {
      return NextResponse.json({ jsonrpc: '2.0', id, result: { tools: BUILTIN_MCP_TOOLS } });
    }
    if (rpc.method === 'tools/call') {
      const name = rpc.params?.name;
      const args = rpc.params?.arguments || {};
      const out = await executeBuiltinTool(name, args);
      return NextResponse.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
      });
    }
    return NextResponse.json({
      jsonrpc: '2.0',
      id,
      result: { server: 'MineRoute MCP Server', protocolVersion: '2024-11-05' }
    });
  } catch (err: any) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err?.message } }, { status: 500 });
  }
}
