// Shows the ?ok= / ?error= message an admin action redirected back with
export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <p className="alert error" role="alert">{error}</p>;
  if (ok) return <p className="alert ok" role="status">{ok}</p>;
  return null;
}
