export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { executeBuiltinTool } from '@/lib/tools-engine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = body.name || body.skill;
    const args = body.input || body.arguments || {};
    const result = await executeBuiltinTool(name, args);
    return NextResponse.json({ ok: true, skill: name, result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Skill execution error' }, { status: 500 });
  }
}
