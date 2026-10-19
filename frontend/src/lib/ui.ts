import type { Status } from '../types';

export type EnvKind = 'PRD' | 'UAT' | 'DEV' | 'OTHER';

/** Infer environment from the storage account name. */
export function detectEnv(name = ''): EnvKind {
  const n = name.toLowerCase();
  if (n.includes('uat')) return 'UAT';
  if (n.includes('prd') || n.includes('prod')) return 'PRD';
  if (n.includes('tst') || n.includes('dev')) return 'DEV';
  return 'OTHER';
}

/** Status → label + the CSS scope class that sets --c / --c-fg. */
export const STATUS_META: Record<Status, { label: string; scope: string }> = {
  healthy: { label: 'Healthy', scope: 'st-ok' },
  missing_today: { label: 'Missing Today', scope: 'st-warn' },
  error: { label: 'Error', scope: 'st-err' },
  no_data: { label: 'No Data', scope: 'st-idle' },
};
