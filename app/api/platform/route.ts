import { NextResponse } from 'next/server';
import { getPlatformVolume24h } from '@/lib/polymarket';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const volume24h = await getPlatformVolume24h();
  return NextResponse.json({ volume24h, fetchedAt: Date.now() }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
