import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { BrandWordmark } from '@/components/Brand';
import { Button } from '@/components/ui/button';
import { LayoutDashboard, Route as RouteIcon, FileCheck2, Users, Car, RotateCcw, ArrowRight } from 'lucide-react';

// Public presentation only: no company IDs, database clients or server calls.
// Every record is fictional and every action changes component state only.
export const Route = createFileRoute('/demo')({
  head: () => ({ meta: [{ title: 'Public demo — NEMT Solutions' }, { name: 'description', content: 'Explore NEMT dispatch, trips and billing with fictional sample data. No login required.' }] }),
  component: PublicDemo,
});
type View = 'Overview' | 'Dispatch' | 'Billing' | 'Drivers' | 'Passengers';
type Trip = { id: string; passenger: string; driver: string; time: string; from: string; to: string; miles: number; units: number; status: 'Scheduled' | 'Assigned' | 'Completed'; billed: boolean };
const drivers = ['Jordan Lee', 'Casey Reed', 'Morgan Hayes'];
const samples: Trip[] = [
  { id: 'DEMO-001', passenger: 'Alex Morgan', driver: 'Jordan Lee', time: '8:30 AM', from: '10 Example Lane', to: 'Sample Medical Center', miles: 12, units: 1, status: 'Completed', billed: false },
  { id: 'DEMO-002', passenger: 'Sam Taylor', driver: 'Casey Reed', time: '9:15 AM', from: '20 Example Lane', to: 'Sample Therapy Center', miles: 24, units: 2, status: 'Completed', billed: false },
  { id: 'DEMO-003', passenger: 'Jamie Parker', driver: 'Morgan Hayes', time: '10:00 AM', from: '30 Example Lane', to: 'Sample Medical Center', miles: 8, units: 1, status: 'Assigned', billed: false },
  { id: 'DEMO-004', passenger: 'Riley Brooks', driver: '', time: '11:30 AM', from: '40 Example Lane', to: 'Sample Therapy Center', miles: 16, units: 2, status: 'Scheduled', billed: false },
];
const navigation = [{ label: 'Overview', icon: LayoutDashboard }, { label: 'Dispatch', icon: RouteIcon }, { label: 'Billing', icon: FileCheck2 }, { label: 'Drivers', icon: Car }, { label: 'Passengers', icon: Users }] as const;
const money = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const total = (trip: Trip) => trip.units * 36.4 + trip.miles * 3;

function PublicDemo() {
  const [view, setView] = useState<View>('Overview');
  const [trips, setTrips] = useState(() => samples.map(trip => ({ ...trip })));
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const completed = trips.filter(trip => trip.status === 'Completed');
  const ready = completed.filter(trip => !trip.billed);
  const submitted = completed.filter(trip => trip.billed);
  const visible = trips.filter(trip => `${trip.passenger} ${trip.driver} ${trip.id}`.toLowerCase().includes(filter.toLowerCase()));
  function go(next: View) { setView(next); setFilter(''); setDetail(null); setNotice(''); }
  function reset() { setTrips(samples.map(trip => ({ ...trip }))); setDetail(null); setFilter(''); setNotice('Sample data reset.'); }
  function assign(id: string, driver: string) {
    setTrips(current => current.map(trip => trip.id === id ? { ...trip, driver, status: driver ? 'Assigned' : 'Scheduled' } : trip));
    setNotice(driver ? `Sample trip assigned to ${driver}.` : 'Sample trip is unassigned.');
  }
  function finish(id: string) { setTrips(current => current.map(trip => trip.id === id ? { ...trip, status: 'Completed' } : trip)); setNotice('Sample trip completed. It is now ready in Billing.'); }
  function simulate() { setTrips(current => current.map(trip => trip.status === 'Completed' ? { ...trip, billed: true } : trip)); setNotice('Demo complete: sample claims recorded below. No claims were sent to a payer.'); }

  return <div className="min-h-screen bg-background text-foreground">
    <div className="border-b border-primary/20 bg-primary/10 px-5 py-3 text-center text-sm"><strong>Public demo</strong> · Fictional sample data · No login needed</div>
    <div className="mx-auto flex max-w-[1600px] flex-col lg:min-h-[calc(100vh-45px)] lg:flex-row">
      <aside className="border-b border-border bg-surface p-5 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <a href="/" aria-label="NEMT Solutions home"><BrandWordmark className="h-8" /></a>
        <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Evergreen Transport</p><p className="mt-1 text-xs text-muted-foreground">Sample company</p>
        <nav aria-label="Demo navigation" className="mt-5 flex flex-wrap gap-2 lg:flex-col">{navigation.map(({ label, icon: Icon }) => <button key={label} onClick={() => go(label)} aria-current={view === label ? 'page' : undefined} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${view === label ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}><Icon size={18} />{label}</button>)}</nav>
        <div className="mt-7 flex flex-wrap gap-3 lg:flex-col"><Button variant="outline" size="sm" onClick={reset}><RotateCcw size={14} />Reset demo</Button><a href="/access" className="px-1 text-sm text-muted-foreground underline underline-offset-4">Company sign in</a></div>
      </aside>
      <main className="min-w-0 flex-1 p-5 sm:p-8">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">Explore NEMT Solutions</p><h1 className="text-3xl font-semibold tracking-tight">{view === 'Overview' ? 'A day at Evergreen' : view}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{view === 'Overview' ? 'Follow a sample trip from dispatch to billing. Try the controls and explore at your own pace.' : 'Interactive sample workspace. Your changes last until you refresh or reset the demo.'}</p></div><span className="rounded-full border border-border px-3 py-1.5 text-xs">Sample day · February 16, 2026</span></header>
        {notice && <p role="status" className="mb-5 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">{notice}</p>}
        {view === 'Overview' && <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Sample trips', trips.length], ['Active drivers', drivers.length], ['Ready to bill', ready.length], ['Sample claim total', money(submitted.reduce((sum, trip) => sum + total(trip), 0))]].map(([label, value]) => <section key={label} className="rounded-2xl border border-border bg-surface p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-3 text-3xl font-semibold">{value}</p></section>)}</div>
          <section className="my-6 rounded-2xl border border-primary/25 bg-primary/5 p-6"><h2 className="text-xl font-semibold">Try the complete workflow</h2><p className="mt-2 text-sm text-muted-foreground">Assign Riley’s trip to a driver, mark it completed, then simulate its submission in Billing.</p><Button className="mt-4" onClick={() => go('Dispatch')}>Open dispatch<ArrowRight size={16} /></Button></section><h2 className="mb-4 text-xl font-semibold">Today’s sample trips</h2>
        </>}
        {(view === 'Overview' || view === 'Dispatch') && <div className="space-y-3">
          {view === 'Dispatch' && <input aria-label="Search sample trips" placeholder="Search passenger, driver or trip" value={filter} onChange={event => setFilter(event.target.value)} className="mb-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm" />}
          {visible.map(trip => <article key={trip.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5"><div><p className="text-xs text-muted-foreground">{trip.time} · {trip.id}</p><h3 className="mt-1 font-semibold">{trip.passenger}</h3><p className="mt-1 text-sm text-muted-foreground">{trip.from} → {trip.to}</p><p className="mt-2 text-xs text-muted-foreground">{trip.miles} miles · {trip.units === 2 ? 'Round trip' : 'One way'}</p></div><div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-accent px-3 py-1 text-xs">{trip.status}</span>{view === 'Dispatch' && trip.status !== 'Completed' ? <><select aria-label={`Driver for ${trip.passenger}`} value={trip.driver} onChange={event => assign(trip.id, event.target.value)} className="rounded-lg border border-border bg-background p-2 text-sm"><option value="">Assign a driver</option>{drivers.map(driver => <option key={driver}>{driver}</option>)}</select><Button size="sm" disabled={!trip.driver} onClick={() => finish(trip.id)}>Complete sample trip</Button></> : <span className="text-sm text-muted-foreground">{trip.driver || 'Unassigned'}</span>}</div></article>)}
          {!visible.length && <p className="p-5 text-sm text-muted-foreground">No sample trips match your search.</p>}
        </div>}
        {view === 'Billing' && <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5"><div><h2 className="font-semibold">{ready.length} sample bills ready</h2><p className="mt-1 text-sm text-muted-foreground">Example rates: {money(36.4)} per trip · {money(3)} per mile</p></div><Button disabled={!ready.length} onClick={simulate}>Simulate submission ({ready.length})</Button></div>
          <p className="mb-5 text-sm text-muted-foreground">This preview simulates billing only. No documents are uploaded and no claims are sent to a state portal.</p>
          <div className="space-y-3">{completed.map(trip => <article key={trip.id} className="rounded-2xl border border-border bg-surface p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-semibold">{trip.passenger}</h3><p className="mt-1 text-sm text-muted-foreground">{trip.id} · {trip.units} trip unit{trip.units > 1 ? 's' : ''} · {trip.miles} miles</p><p className="mt-2 text-xs text-muted-foreground">{trip.billed ? `Simulated claim: SAMPLE-${trip.id.slice(-3)} · Not a real claim number` : 'Ready for demo submission'}</p></div><div className="flex items-center gap-4"><strong>{money(total(trip))}</strong><Button variant="outline" size="sm" aria-expanded={detail === trip.id} onClick={() => setDetail(detail === trip.id ? null : trip.id)}>View details</Button></div></div>{detail === trip.id && <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm"><p>Trip charge: {trip.units} × {money(36.4)} = {money(trip.units * 36.4)}</p><p>Mileage charge: {trip.miles} × {money(3)} = {money(trip.miles * 3)}</p><p>Driver: {trip.driver}</p><p className="text-muted-foreground">Fictional trip and demonstration rates only.</p></div>}</article>)}</div>
        </>}
        {view === 'Drivers' && <div className="grid gap-4 md:grid-cols-3">{drivers.map((driver, index) => <article key={driver} className="rounded-2xl border border-border bg-surface p-6"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Car /></div><h2 className="font-semibold">{driver}</h2><p className="mt-2 text-sm text-muted-foreground">Sample van · DEMO-{12 + index}</p><p className="mt-4 text-sm">{trips.filter(trip => trip.driver === driver).length} assigned sample trips</p></article>)}</div>}
        {view === 'Passengers' && <div className="grid gap-4 sm:grid-cols-2">{samples.map((trip, index) => <article key={trip.id} className="rounded-2xl border border-border bg-surface p-5"><h2 className="font-semibold">{trip.passenger}</h2><p className="mt-2 text-sm text-muted-foreground">Fictional passenger · SAMPLE-{index + 1}</p><p className="mt-3 text-sm">{trip.from}</p><p className="mt-1 text-xs text-muted-foreground">Ambulatory transportation</p></article>)}</div>}
        <footer className="mt-10 border-t border-border pt-5 text-xs text-muted-foreground">NEMT Solutions · Public sample preview. No real passenger, company, or claim records are shown.</footer>
      </main>
    </div>
  </div>;
}