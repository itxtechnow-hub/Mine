export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { dispatchUpstreamChat } from '@/lib/router-engine';
import { executeTeamPipeline } from '@/lib/team-orchestrator';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const model = String(body.model || 'auto');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUserMsg = messages.length > 0 ? String(messages[messages.length - 1].content || '') : '';

    // Route Team Pipeline requests directly through the Multi-Node Team Orchestrator
    if (model.toLowerCase().startsWith('mineroute/team/')) {
      const teamRun = await executeTeamPipeline(model, lastUserMsg);
      return NextResponse.json(
        {
          id: `chatcmpl-team-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          team_run: teamRun,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: teamRun.finalOutput
              },
              finish_reason: 'stop'
            }
          ],
          usage: { prompt_tokens: 120, completion_tokens: 300, total_tokens: 420 }
        },
        {
          headers: {
            'X-MineRoute-Provider': 'team-orchestrator',
            'X-MineRoute-Model': model,
            'X-MineRoute-Latency-Ms': String(teamRun.latencyMs)
          }
        }
      );
    }

    const compressionHeader = req.headers.get('x-mineroute-compression') || body.compressionProfile;
    const strategyHeader = req.headers.get('x-mineroute-strategy') || body.strategy;

    const result = await dispatchUpstreamChat({
      model,
      messages,
      temperature: body.temperature,
      enableTools: body.enableTools !== false,
      compressionProfile: compressionHeader || undefined,
      strategy: strategyHeader || undefined
    });

    return NextResponse.json(result, { headers: result.headers || {} });
  } catch (err: any) {
    return NextResponse.json(
      { error: { message: err?.message || 'Completion failed', type: 'mineroute_error' } },
      { status: 500 }
    );
  }
}
