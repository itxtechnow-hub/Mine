export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { BUILTIN_MCP_TOOLS } from '@/lib/tools-engine';

export async function GET() {
  return NextResponse.json({ protocol: 'MCP 2024-11-05', tools: BUILTIN_MCP_TOOLS });
}
