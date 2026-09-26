import { createFileRoute } from '@tanstack/react-router';
import { SuperEdiWorkspace } from '@/components/billing/superedi/SuperEdiWorkspace';

export const Route = createFileRoute('/$companySlug/billing/edi')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Electronic billing — NEMT Solutions' }] }),
  component: () => <SuperEdiWorkspace billingApp />,
});
