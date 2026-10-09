import { createServerFn } from '@tanstack/react-start';

/** No caller-supplied owner, company, email, role or redirect is accepted. */
export const launchPublicDemo = createServerFn({ method: 'POST' }).handler(async () => {
  const { openPublicDemo } = await import('./publicDemo.server');
  return openPublicDemo();
});
