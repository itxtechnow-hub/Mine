export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { sourceFormat, targetFormat, payload } = await req.json();
  const promptText =
    payload?.messages?.[0]?.content ||
    payload?.input ||
    payload?.contents?.[0]?.parts?.[0]?.text ||
    'Execute task via MineRoute';
  const model = payload?.model || 'auto';

  let translated: any = {};
  if (targetFormat === 'anthropic') {
    translated = {
      endpoint: 'POST /v1/messages',
      headers: { 'anthropic-version': '2023-06-01', 'x-mineroute-bridge': 'openai->anthropic' },
      body: { model, max_tokens: 1024, messages: [{ role: 'user', content: [{ type: 'text', text: promptText }] }] }
    };
  } else if (targetFormat === 'gemini') {
    translated = {
      endpoint: `POST /v1beta/models/${model}:generateContent`,
      body: { contents: [{ role: 'user', parts: [{ text: promptText }] }] }
    };
  } else if (targetFormat === 'responses') {
    translated = {
      endpoint: 'POST /v1/responses',
      body: { model, input: [{ role: 'user', content: promptText }], store: true }
    };
  } else if (targetFormat === 'mcp') {
    translated = {
      jsonrpc: '2.0',
      id: `mr-${Date.now()}`,
      method: 'tools/call',
      params: { name: 'run_team_task', arguments: { model, prompt: promptText } }
    };
  } else {
    translated = {
      endpoint: 'POST /v1/chat/completions',
      body: { model, messages: [{ role: 'user', content: promptText }] }
    };
  }

  return NextResponse.json({ ok: true, sourceFormat, targetFormat, translated });
}
