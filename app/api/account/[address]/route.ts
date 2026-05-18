import { NextRequest, NextResponse } from 'next/server';
import { getAccountSnapshot } from '@/lib/polymarket';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;

  if (!ADDRESS_REGEX.test(address)) {
    return NextResponse.json(
      { error: 'invalid address format' },
      { status: 400 }
    );
  }

  const snapshot = await getAccountSnapshot(address);
  return NextResponse.json(snapshot, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  });
}
