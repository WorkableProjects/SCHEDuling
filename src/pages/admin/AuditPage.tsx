import { get } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { DataTable, ErrorState, ListSkeleton, PageHeader } from '../../ui/kit';

type E = { id: string; at: string; action: string; entity: string; entityId: string | null; diff: unknown; actor: string | null };
export function AuditPage() {
  const q = useQuery(() => get<{ entries: E[] }>('/api/reports/audit'), []);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  return (
    <>
      <PageHeader title="Audit log" sub="Who changed what. The most recent 100 actions." />
      <DataTable rows={q.data.entries} rowKey={(e) => e.id} searchText={(e) => `${e.action} ${e.actor ?? ''}`} searchPlaceholder="Filter by action or person" pageSize={25}
        columns={[
          { key: 'at', header: 'When', className: 'whitespace-nowrap tnum', render: (e) => fmtDateTime(e.at) },
          { key: 'who', header: 'Who', render: (e) => e.actor ?? 'System' },
          { key: 'act', header: 'Action', render: (e) => <code className="text-xs">{e.action}</code> },
          { key: 'ent', header: 'Target', render: (e) => <span className="text-xs text-muted">{e.entity}{e.entityId ? ` ${e.entityId.slice(0, 8)}` : ''}</span> },
        ]} />
    </>
  );
}
