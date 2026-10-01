import React from 'react';
import { usePullToRefresh } from './pull-to-refresh';

/** Keep high-frequency gesture state outside the weather dashboard. */
export function PullRefreshIndicator({ enabled, refreshing, refresh }: { enabled: boolean; refreshing: boolean; refresh: () => void }) {
  const pull = usePullToRefresh(enabled && !refreshing, refresh);
  return <div className="pull-refresh-indicator" data-pulling={pull.distance > 0 ? 'true' : undefined} style={{ '--pull-distance': `${pull.distance}px` } as React.CSSProperties} role="status" aria-live="polite">
    {refreshing ? 'Refreshing weather…' : pull.ready ? 'Release to refresh' : 'Pull to refresh'}
  </div>;
}
