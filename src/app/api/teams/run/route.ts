export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { executeTeamPipeline } from '@/lib/team-orchestrator';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const teamSlug = body.team || body.slug || 'Mine';
    const prompt = body.prompt || body.task || 'Audit gateway architecture and verify all tool endpoints';
    const result = await executeTeamPipeline(teamSlug, prompt);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Team execution error' }, { status: 500 });
  }
}
