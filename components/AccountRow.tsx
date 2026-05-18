'use client';

import useSWR from 'swr';
import { useState } from 'react';
import type { AccountSnapshot } from '@/lib/polymarket';
import { formatUsd, formatShares, shortAddress, timeAgo } from '@/lib/format';
import styles from './AccountRow.module.css';

interface Props {
  address: string;
  label: string;
  onRemove: () => void;
  onRename: (newLabel: string) => void;
  refreshInterval: number;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error('fetch failed');
    return r.json() as Promise<AccountSnapshot>;
  });

export default function AccountRow({ address, label, onRemove, onRename, refreshInterval }: Props) {
  const { data, error, isLoading, mutate } = useSWR<AccountSnapshot>(
    `/api/account/${address}`,
    fetcher,
    { refreshInterval, revalidateOnFocus: true, keepPreviousData: true }
  );

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  const submitRename = () => {
    onRename(draft.trim() || label);
    setEditing(false);
  };

  const stale = data ? Date.now() - data.fetchedAt > refreshInterval * 1.5 : false;
  const state = error ? 'error' : isLoading && !data ? 'loading' : stale ? 'stale' : 'live';

  return (
    <div className={styles.row}>
      {/* Identity */}
      <div className={styles.identity}>
        <div className={styles.statusDot} data-state={state} />
        <div className={styles.labelGroup}>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') { setDraft(label); setEditing(false); }
              }}
              className={styles.labelInput}
            />
          ) : (
            <button className={styles.label} onClick={() => setEditing(true)} title="Click to rename">
              {label}
            </button>
          )}
          <a
            href={`https://polymarket.com/profile/${address}`}
            target="_blank" rel="noopener noreferrer"
            className={`${styles.address} num`} title={address}
          >
            {shortAddress(address)} ↗
          </a>
        </div>
      </div>

      {/* Total balance */}
      <UsdCell label="total balance" value={data?.totalBalance} loading={isLoading && !data} />

      {/* Volume $ */}
      <UsdCell label="vol $ · all-time" value={data?.volumeUsdcTotal} loading={isLoading && !data} compact />
      <UsdCell label="vol $ · 24h" value={data?.volumeUsdc24h} loading={isLoading && !data} highlight={data && data.volumeUsdc24h > 0} />

      {/* Volume shares */}
      <SharesCell label="vol sh · all-time" value={data?.volumeSharesTotal} loading={isLoading && !data} />
      <SharesCell label="vol sh · 24h" value={data?.volumeShares24h} loading={isLoading && !data} highlight={data && data.volumeShares24h > 0} />

      {/* Rewards */}
      <UsdCell label="rewards · all-time" value={data?.rewardsTotal} loading={isLoading && !data} accent />
      <UsdCell label="rewards · 24h" value={data?.rewards24h} loading={isLoading && !data} accent highlight={data && data.rewards24h > 0} />

      {/* Actions */}
      <div className={styles.actions}>
        <span className={styles.meta}>{error ? 'error' : data ? timeAgo(data.fetchedAt) : '—'}</span>
        <button className={styles.iconBtn} onClick={() => mutate()} title="Refresh now">↻</button>
        <button className={styles.iconBtn} onClick={onRemove} title="Remove">×</button>
      </div>
    </div>
  );
}

function UsdCell({ label, value, loading, compact, dim, accent, highlight }: {
  label: string; value: number | undefined; loading: boolean;
  compact?: boolean; dim?: boolean; accent?: boolean; highlight?: boolean;
}) {
  if (loading) return (
    <div className={styles.cell} data-label={label}>
      <span className={styles.skeleton}>—</span>
    </div>
  );
  return (
    <div
      className={`${styles.cell} num`}
      data-label={label}
      data-dim={dim ? '' : undefined}
      data-accent={accent ? '' : undefined}
      data-highlight={highlight ? '' : undefined}
      data-zero={value === 0 ? '' : undefined}
    >
      {value === undefined ? '—' : formatUsd(value, { compact })}
    </div>
  );
}

function SharesCell({ label, value, loading, highlight }: {
  label: string; value: number | undefined; loading: boolean; highlight?: boolean;
}) {
  if (loading) return (
    <div className={styles.cell} data-label={label}>
      <span className={styles.skeleton}>—</span>
    </div>
  );
  return (
    <div
      className={`${styles.cell} ${styles.sharesCell} num`}
      data-label={label}
      data-highlight={highlight ? '' : undefined}
      data-zero={value === 0 ? '' : undefined}
    >
      {value === undefined ? '—' : formatShares(value)}
      {value !== undefined && value > 0 && <span className={styles.sharesUnit}>sh</span>}
    </div>
  );
}
