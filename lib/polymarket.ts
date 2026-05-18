/**
 * Polymarket data layer.
 *
 * All endpoints used here are public — no signing required.
 * The funder address is the Polymarket proxy wallet shown in the user's
 * profile at polymarket.com/settings.
 */

import { createPublicClient, http, getContract, formatUnits } from 'viem';
import { polygon } from 'viem/chains';

const DATA_API = 'https://data-api.polymarket.com';

// Polymarket's Data API rejects requests without a real-looking User-Agent.
const FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (compatible; anzee-dashboard/0.1; +https://anzee.xyz)',
};

// USDC.e (bridged) is what Polymarket uses on Polygon
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as const;

const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const polygonClient = createPublicClient({
  chain: polygon,
  transport: http(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'),
});

export interface AccountSnapshot {
  address: string;
  positionsValue: number;       // sum of currentValue across all open positions
  usdcBalance: number;          // free USDC on the proxy wallet
  totalBalance: number;         // positionsValue + usdcBalance
  volumeUsdcTotal: number;      // sum of all TRADE usdcSize ($), ever
  volumeUsdc24h: number;        // sum of TRADE usdcSize ($) in last 24h
  volumeSharesTotal: number;    // sum of all TRADE size (shares), ever
  volumeShares24h: number;      // sum of TRADE size (shares) in last 24h
  rewardsTotal: number;         // sum of all REWARD usdcSize, ever
  rewards24h: number;           // sum of REWARD usdcSize in last 24h
  positionCount: number;
  fetchedAt: number;
  error?: string;
}

interface ActivityEntry {
  type: 'TRADE' | 'SPLIT' | 'MERGE' | 'REDEEM' | 'REWARD' | 'CONVERSION';
  timestamp: number;
  usdcSize: number;
  size: number;                 // volume in shares/tokens
}

interface PositionEntry {
  currentValue: number;
}

async function fetchUsdcBalance(address: string): Promise<number> {
  try {
    const balance = await polygonClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    return Number(formatUnits(balance, 6));
  } catch (err) {
    console.error(`USDC balance fetch failed for ${address}:`, err);
    return 0;
  }
}

async function fetchPositions(address: string): Promise<PositionEntry[]> {
  const url = `${DATA_API}/positions?user=${address}&limit=500&sizeThreshold=0.01`;
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`positions ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * The /activity endpoint is paginated. We page until we either:
 *   - get an empty page (= done)
 *   - hit a hard cap (safety against pathological accounts)
 *
 * For volume_total we need full history. For volume_24h we could stop early
 * once timestamps fall below cutoff, which is a nice optimisation since
 * results come back desc-by-timestamp.
 */
async function fetchActivityPaged(address: string): Promise<ActivityEntry[]> {
  const all: ActivityEntry[] = [];
  const LIMIT = 500;
  const MAX_PAGES = 40; // 20k events ceiling — generous for personal use
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${DATA_API}/activity?user=${address}&limit=${LIMIT}&offset=${offset}`;
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      next: { revalidate: 30 },
    });
    if (!res.ok) throw new Error(`activity ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < LIMIT) break;
    offset += LIMIT;
  }

  return all;
}

export async function getAccountSnapshot(address: string): Promise<AccountSnapshot> {
  const addr = address.toLowerCase();
  const empty: AccountSnapshot = {
    address: addr,
    positionsValue: 0,
    usdcBalance: 0,
    totalBalance: 0,
    volumeUsdcTotal: 0,
    volumeUsdc24h: 0,
    volumeSharesTotal: 0,
    volumeShares24h: 0,
    rewardsTotal: 0,
    rewards24h: 0,
    positionCount: 0,
    fetchedAt: Date.now(),
  };

  try {
    const [usdcBalance, positions, activity] = await Promise.all([
      fetchUsdcBalance(addr),
      fetchPositions(addr),
      fetchActivityPaged(addr),
    ]);

    const positionsValue = positions.reduce(
      (acc, p) => acc + (Number(p.currentValue) || 0),
      0
    );

    const cutoff24h = Math.floor(Date.now() / 1000) - 24 * 60 * 60;

    let volumeUsdcTotal = 0;
    let volumeUsdc24h = 0;
    let volumeSharesTotal = 0;
    let volumeShares24h = 0;
    let rewardsTotal = 0;
    let rewards24h = 0;

    for (const ev of activity) {
      const usdc = Number(ev.usdcSize) || 0;
      const shares = Number(ev.size) || 0;
      if (ev.type === 'TRADE') {
        volumeUsdcTotal += usdc;
        volumeSharesTotal += shares;
        if (ev.timestamp >= cutoff24h) {
          volumeUsdc24h += usdc;
          volumeShares24h += shares;
        }
      } else if (ev.type === 'REWARD') {
        rewardsTotal += usdc;
        if (ev.timestamp >= cutoff24h) rewards24h += usdc;
      }
    }

    return {
      address: addr,
      positionsValue,
      usdcBalance,
      totalBalance: positionsValue + usdcBalance,
      volumeUsdcTotal,
      volumeUsdc24h,
      volumeSharesTotal,
      volumeShares24h,
      rewardsTotal,
      rewards24h,
      positionCount: positions.length,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : 'unknown error',
    };
  }
}
