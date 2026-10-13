export type Session = {
  id: string; eventId: string; title: string; description: string | null; startsAt: string; endsAt: string; status: 'draft' | 'published' | 'cancelled';
  room: { id: string; name: string } | null; capacity: number | null; requiresRegistration: boolean; pinned: boolean; frozen: boolean;
  registeredCount?: number; capacityLabel: 'open' | 'filling' | 'nearly_full' | 'full' | null;
  materials: { index: number; name: string; size: number }[];
  tracks: { id: string; name: string; color: string }[];
  speakers: { id: string; name: string; title: string | null; org: string | null; hasPhoto: boolean }[];
  mine: { inAgenda: boolean; registration: 'registered' | 'waitlisted' | null; position: number | null; checkedIn: boolean } | null;
  reason?: 'pinned' | 'agenda' | 'registered';
};
export type Track = { id: string; name: string; color: string };
export type Room = { id: string; name: string; capacity: number | null };
