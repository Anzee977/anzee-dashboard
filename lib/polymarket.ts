/**
 * Polymarket data layer.
 * All endpoints are public — no signing required.
 */

import { createPublicClient, http, formatUnits } from 'viem';
import { polygon } from 'viem/chains';

const DATA_API   = 'https://data-api.polymarket.com';
const GAMMA_API  = 'https://gamma-api.polymarket.com';

const FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; anzee-dashboard/0.1; +https://anzee.xyz)',
};

const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as const;
const ERC20_ABI = [{
  inputs: [{ name: 'account', type: 'address' }],
  name: 'balanceOf',
  outputs: [{ name: '', type: 'uint256' }],
  stateMutability: 'view',
  type: 'function',
}] as const;

const polygonClient = createPublicClient({
  chain: polygon,
  transport: http(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'),
});

export interface AccountSnapshot {
  address: string;
  positionsValue: number;
  usdcBalance: number;
  totalBalance: number;
  volumeUsdcTotal: number;
  volumeUsdc24h: number;
  volumeUsdc1h: number;         // NEW: last 1h
  volumeSharesTotal: number;
  volumeShares24h: number;
  volumeShares1h: number;       // NEW: last 1h
  rewardsTotal: number;
  rewards24h: number;
  positionCount: number;
  fetchedAt: number;
  error?: string;
}

/** Platform-wide 24h volume, fetched once and shared across all account calls */
export interface PlatformStats {
  volume24h: number;
  fetchedAt: number;
}

interface ActivityEntry {
  type: 'TRADE' | 'SPLIT' | 'MERGE' | 'REDEEM' | 'REWARD' | 'CONVERSION';
  timestamp: number;
  usdcSize: number;
  size: number;
}

interface PositionEntry {
  currentValue: number;
}

// ─── Platform volume ──────────────────────────────────────────────────────────

/**
 * Sum volume24hr across ALL active markets on the Gamma API.
 * Paginated at 500 markets/page; stops when page comes back empty.
 * Cached for 5 min server-side (Vercel edge cache).
 */
export async function getPlatformVolume24h(): Promise<number> {
  const LIMIT = 500;
  let total = 0;
  let offset = 0;
  const MAX_PAGES = 20; // 10k markets ceiling — well above reality

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${GAMMA_API}/markets?active=true&closed=false&limit=${LIMIT}&offset=${offset}`;
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      next: { revalidate: 300 }, // cache 5 min — platform volume doesn't need to be real-time
    });
    if (!res.ok) break;
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const m of batch) {
      total += Number(m.volume24hr) || 0;
    }
    if (batch.length < LIMIT) break;
    offset += LIMIT;
  }

  return total;
}

// ─── Per-account data ─────────────────────────────────────────────────────────

async function fetchUsdcBalance(address: string): Promise<number> {
  try {
    const balance = await polygonClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    return Number(formatUnits(balance, 6));
  } catch {
    return 0;
  }
}

async function fetchPositions(address: string): Promise<PositionEntry[]> {
  const url = `${DATA_API}/positions?user=${address}&limit=500&sizeThreshold=0.01`;
  const res = await fetch(url, { headers: FETCH_HEADERS, next: { revalidate: 30 } });
  if (!res.ok) throw new Error(`positions ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchActivityPaged(address: string): Promise<ActivityEntry[]> {
  const all: ActivityEntry[] = [];
  const LIMIT = 500;
  const MAX_PAGES = 40;
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${DATA_API}/activity?user=${address}&limit=${LIMIT}&offset=${offset}`;
    const res = await fetch(url, { headers: FETCH_HEADERS, next: { revalidate: 30 } });
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
    positionsValue: 0, usdcBalance: 0, totalBalance: 0,
    volumeUsdcTotal: 0, volumeUsdc24h: 0, volumeUsdc1h: 0,
    volumeSharesTotal: 0, volumeShares24h: 0, volumeShares1h: 0,
    rewardsTotal: 0, rewards24h: 0,
    positionCount: 0, fetchedAt: Date.now(),
  };

  try {
    const [usdcBalance, positions, activity] = await Promise.all([
      fetchUsdcBalance(addr),
      fetchPositions(addr),
      fetchActivityPaged(addr),
    ]);

    const positionsValue = positions.reduce((acc, p) => acc + (Number(p.currentValue) || 0), 0);

    const now = Math.floor(Date.now() / 1000);
    const cutoff24h = now - 24 * 60 * 60;
    const cutoff1h  = now - 60 * 60;

    let volumeUsdcTotal = 0, volumeUsdc24h = 0, volumeUsdc1h = 0;
    let volumeSharesTotal = 0, volumeShares24h = 0, volumeShares1h = 0;
    let rewardsTotal = 0, rewards24h = 0;

    for (const ev of activity) {
      const usdc   = Number(ev.usdcSize) || 0;
      const shares = Number(ev.size)     || 0;

      if (ev.type === 'TRADE') {
        volumeUsdcTotal   += usdc;
        volumeSharesTotal += shares;
        if (ev.timestamp >= cutoff24h) { volumeUsdc24h   += usdc;   volumeShares24h += shares; }
        if (ev.timestamp >= cutoff1h)  { volumeUsdc1h    += usdc;   volumeShares1h  += shares; }
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
      volumeUsdcTotal,   volumeUsdc24h,   volumeUsdc1h,
      volumeSharesTotal, volumeShares24h, volumeShares1h,
      rewardsTotal,      rewards24h,
      positionCount: positions.length,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'unknown error' };
  }
}
