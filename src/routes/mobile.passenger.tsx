import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const Route = createFileRoute('/mobile/passenger')({ component: PassengerLauncher });
function PassengerLauncher() {
  const [provider, setProvider] = useState('');
  const [error, setError] = useState('');
  return <main className="flex min-h-screen items-center justify-center bg-background p-6">
    <form className="w-full max-w-md space-y-5 rounded-3xl border bg-surface p-8" onSubmit={event => {
      event.preventDefault();
      const slug = provider.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 40) { setError('Enter the provider code supplied by your transportation company.'); return; }
      window.location.assign(`/${encodeURIComponent(slug)}/passenger`);
    }}>
      <Car className="h-10 w-10 text-primary" /><h1 className="text-3xl font-semibold">NEMT Rides</h1>
      <p className="text-muted-foreground">Enter your transportation provider’s code to open your passenger app.</p>
      <div className="space-y-2"><Label htmlFor="provider-code">Provider code</Label><Input id="provider-code" value={provider} onChange={e => setProvider(e.target.value)} autoCapitalize="none" autoCorrect="off" required placeholder="Your provider code" /></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="h-12 w-full">Continue</Button>
      <p className="text-xs text-muted-foreground">Ask your transportation company if you do not know your code.</p>
    </form>
  </main>;
}
