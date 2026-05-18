'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import AccountRow from '@/components/AccountRow';
import type { AccountSnapshot } from '@/lib/polymarket';
import { formatUsd, formatShares } from '@/lib/format';
import styles from './page.module.css';

interface AccountConfig {
  address: string;
  label: string;
  addedAt: number;
}

const STORAGE_KEY = 'anzee:accounts:v1';
const REFRESH_KEY = 'anzee:refresh:v1';
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const REFRESH_OPTIONS = [
  { value: 0, label: 'manual' },
  { value: 30_000, label: '30s' },
  { value: 60_000, label: '1m' },
  { value: 300_000, label: '5m' },
];

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<AccountSnapshot>);

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<AccountConfig[]>([]);
  const [refreshMs, setRefreshMs] = useState<number>(60_000);
  const [draft, setDraft] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setAccounts(JSON.parse(raw));
      const ref = localStorage.getItem(REFRESH_KEY);
      if (ref) setRefreshMs(Number(ref));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // Persist
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  }, [accounts, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(REFRESH_KEY, String(refreshMs));
  }, [refreshMs, hydrated]);

  const addAccount = () => {
    const addr = draft.trim().toLowerCase();
    if (!ADDRESS_REGEX.test(addr)) {
      alert('Invalid address. Must be a 0x-prefixed 40-char hex string.');
      return;
    }
    if (accounts.some((a) => a.address === addr)) {
      alert('Address already tracked.');
      return;
    }
    setAccounts((prev) => [
      ...prev,
      {
        address: addr,
        label: draftLabel.trim() || `account ${prev.length + 1}`,
        addedAt: Date.now(),
      },
    ]);
    setDraft('');
    setDraftLabel('');
  };

  const removeAccount = (address: string) =>
    setAccounts((prev) => prev.filter((a) => a.address !== address));

  const renameAccount = (address: string, label: string) =>
    setAccounts((prev) =>
      prev.map((a) => (a.address === address ? { ...a, label } : a))
    );

  // Aggregate totals across all accounts
  const { totals, isLoading } = useTotals(
    accounts.map((a) => a.address),
    refreshMs
  );

  if (!hydrated) {
    return <div className={styles.shell}><div className={styles.boot}>booting…</div></div>;
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.title}>
            <span className="serif">anzee</span>
            <span className={styles.titleSlash}>/</span>
            <span className={styles.titleSub}>polymarket</span>
          </h1>
          <div className={styles.tagline}>multi-account farming dashboard</div>
        </div>

        <div className={styles.controls}>
          <div className={styles.refreshGroup}>
            <span className={styles.refreshLabel}>refresh</span>
            <div className={styles.refreshButtons}>
              {REFRESH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={styles.refreshBtn}
                  data-active={refreshMs === opt.value ? '' : undefined}
                  onClick={() => setRefreshMs(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <section className={styles.totalsBar}>
        <Total label="total balance" value={totals.totalBalance} loading={isLoading} />
        <Total label="vol $ · all-time" value={totals.volumeUsdcTotal} loading={isLoading} compact />
        <Total label="vol $ · 24h" value={totals.volumeUsdc24h} loading={isLoading} highlight />
        <TotalShares label="vol shares · all-time" value={totals.volumeSharesTotal} loading={isLoading} />
        <TotalShares label="vol shares · 24h" value={totals.volumeShares24h} loading={isLoading} highlight />
        <Total label="lp rewards · all-time" value={totals.rewardsTotal} loading={isLoading} accent />
        <Total label="lp rewards · 24h" value={totals.rewards24h} loading={isLoading} accent highlight />
      </section>

      <section className={styles.table}>
        <div className={styles.tableHeader}>
          <div>account</div>
          <div className={styles.rightAlign}>total bal.</div>
          <div className={styles.rightAlign}>vol $ · all</div>
          <div className={styles.rightAlign}>vol $ · 24h</div>
          <div className={styles.rightAlign}>vol sh · all</div>
          <div className={styles.rightAlign}>vol sh · 24h</div>
          <div className={styles.rightAlign}>rewards · all</div>
          <div className={styles.rightAlign}>rewards · 24h</div>
          <div className={styles.rightAlign}>updated</div>
        </div>

        {accounts.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>no accounts yet</div>
            <div className={styles.emptyHint}>
              add a funder address below to start tracking
            </div>
          </div>
        ) : (
          accounts.map((acc) => (
            <AccountRow
              key={acc.address}
              address={acc.address}
              label={acc.label}
              refreshInterval={refreshMs || 999_999_999}
              onRemove={() => removeAccount(acc.address)}
              onRename={(label) => renameAccount(acc.address, label)}
            />
          ))
        )}
      </section>

      <section className={styles.addPanel}>
        <div className={styles.addPanelTitle}>+ add funder address</div>
        <div className={styles.addRow}>
          <input
            className={styles.addInputAddr}
            placeholder="0x… funder address"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAccount()}
            spellCheck={false}
            autoComplete="off"
          />
          <input
            className={styles.addInputLabel}
            placeholder="label (optional)"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAccount()}
            spellCheck={false}
            autoComplete="off"
          />
          <button className={styles.addBtn} onClick={addAccount}>
            track →
          </button>
        </div>
        <div className={styles.addHint}>
          your funder address is the proxy wallet shown at{' '}
          <a
            href="https://polymarket.com/settings"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            polymarket.com/settings
          </a>
          . addresses are stored only in your browser — never sent anywhere except
          to query public polymarket data.
        </div>
      </section>

      <footer className={styles.footer}>
        <span className="mono">anzee.xyz</span> ·{' '}
        <span>{accounts.length} account{accounts.length === 1 ? '' : 's'} tracked</span> ·{' '}
        <span>data via data-api.polymarket.com + polygon rpc</span>
      </footer>
    </div>
  );
}

function Total({
  label,
  value,
  loading,
  dim,
  accent,
  highlight,
  compact,
}: {
  label: string;
  value: number;
  loading: boolean;
  dim?: boolean;
  accent?: boolean;
  highlight?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={styles.total}>
      <div className={styles.totalLabel}>{label}</div>
      <div
        className={`${styles.totalValue} num`}
        data-dim={dim ? '' : undefined}
        data-accent={accent ? '' : undefined}
        data-highlight={highlight && value > 0 ? '' : undefined}
      >
        {loading && value === 0 ? '—' : formatUsd(value, { compact })}
      </div>
    </div>
  );
}

function TotalShares({
  label,
  value,
  loading,
  highlight,
}: {
  label: string;
  value: number;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={styles.total}>
      <div className={styles.totalLabel}>{label}</div>
      <div
        className={`${styles.totalValue} ${styles.totalShares} num`}
        data-highlight={highlight && value > 0 ? '' : undefined}
      >
        {loading && value === 0 ? '—' : formatShares(value)}
        {!loading && value > 0 && <span className={styles.totalSharesUnit}>sh</span>}
      </div>
    </div>
  );
}

/**
 * Aggregate totals by fetching every account in parallel.
 * Each SWR key gets its own cache entry — so the per-row component
 * shares the cache with this hook (no duplicate fetches).
 */
function useTotals(addresses: string[], refreshMs: number) {
  // Stable concatenated key so the hook re-runs only when the list actually changes.
  const key = useMemo(() => addresses.join(','), [addresses]);

  const { data, isLoading } = useSWR<AccountSnapshot[]>(
    addresses.length ? ['totals', key] : null,
    async () => {
      const results = await Promise.all(
        addresses.map((a) =>
          fetcher(`/api/account/${a}`).catch(() => null as unknown as AccountSnapshot)
        )
      );
      return results.filter(Boolean) as AccountSnapshot[];
    },
    {
      refreshInterval: refreshMs,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );

  const totals = (data ?? []).reduce(
    (acc, s) => ({
      totalBalance: acc.totalBalance + s.totalBalance,
      usdcBalance: acc.usdcBalance + s.usdcBalance,
      volumeUsdcTotal: acc.volumeUsdcTotal + s.volumeUsdcTotal,
      volumeUsdc24h: acc.volumeUsdc24h + s.volumeUsdc24h,
      volumeSharesTotal: acc.volumeSharesTotal + s.volumeSharesTotal,
      volumeShares24h: acc.volumeShares24h + s.volumeShares24h,
      rewardsTotal: acc.rewardsTotal + s.rewardsTotal,
      rewards24h: acc.rewards24h + s.rewards24h,
    }),
    {
      totalBalance: 0,
      usdcBalance: 0,
      volumeUsdcTotal: 0,
      volumeUsdc24h: 0,
      volumeSharesTotal: 0,
      volumeShares24h: 0,
      rewardsTotal: 0,
      rewards24h: 0,
    }
  );

  return { totals, isLoading };
}
