import { AppLink } from '@/lib/appLink';

/** Old driver finance links remain safe when opened from bookmarks or older APKs. */
export function OfficeManaged() {
  return <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
    <h1 className="text-xl font-semibold">Managed by your office</h1>
    <p className="text-sm text-muted-foreground">Contact your company office for help with this section.</p>
    <AppLink to="/driver" className="inline-block rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Back to your shift</AppLink>
  </section>;
}
