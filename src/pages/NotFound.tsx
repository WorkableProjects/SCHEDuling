import { Link } from 'react-router-dom';
export function NotFound({ message = "We couldn't find that page." }: { message?: string }) {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="text-5xl font-bold text-brand">404</p>
      <p className="mt-3 text-lg font-semibold">Not found</p>
      <p className="mt-1 text-muted">{message}</p>
      <Link to="/" className="mt-5 inline-block rounded-md bg-brand px-4 py-2 font-medium text-brand-ink">Back to events</Link>
    </div>
  );
}
