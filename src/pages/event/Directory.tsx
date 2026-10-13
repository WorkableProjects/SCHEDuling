import { get } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { useEvent } from '../../layouts/EventLayout';
import { Avatar, Badge, DataTable, ErrorState, ListSkeleton } from '../../ui/kit';
import { useGate } from './parts';

type P = { id: string; name: string; title: string | null; org: string | null; role: string; hasPhoto: boolean };

export function Directory() {
  const { data } = useEvent();
  const gate = useGate();
  const q = useQuery(() => (gate ? Promise.resolve(null) : get<{ people: P[] }>(`/api/people/directory?eventId=${data!.event.id}`)), [data!.event.id, !!gate]);
  if (gate) return gate;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <ListSkeleton />;
  return (
    <DataTable rows={q.data.people} rowKey={(p) => p.id} searchText={(p) => `${p.name} ${p.org ?? ''} ${p.title ?? ''}`} searchPlaceholder="Search people"
      columns={[
        { key: 'name', header: 'Name', sort: (a, b) => a.name.localeCompare(b.name), render: (p) => <span className="flex items-center gap-3"><Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={32} /><span className="font-medium">{p.name}</span></span> },
        { key: 'title', header: 'Title', render: (p) => p.title ?? '' },
        { key: 'org', header: 'Organization', sort: (a, b) => (a.org ?? '').localeCompare(b.org ?? ''), render: (p) => p.org ?? '' },
        { key: 'role', header: '', render: (p) => (p.role === 'speaker' ? <Badge tone="brand">Speaker</Badge> : null) },
      ]} />
  );
}
