import { readFileSync, writeFileSync } from 'node:fs';

const origin = new URL(process.env.MOBILE_APP_ORIGIN || 'https://nemtsolutions.co');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('MOBILE_APP_ORIGIN must be a trusted HTTPS origin without credentials, path, query, or fragment.');
}
const template = readFileSync(new URL('./shared/launcher.html', import.meta.url), 'utf8');
for (const app of ['driver', 'passenger']) {
  const html = template.replaceAll('__APP_NAME__', app === 'driver' ? 'NEMT Driver' : 'NEMT Rides')
    .replace('__APP_KIND__', app).replace('__APP_ORIGIN__', origin.origin);
  for (const page of ['index.html', 'error.html']) {
    writeFileSync(new URL(`./${app}/www/${page}`, import.meta.url), html);
  }
}
console.log(`Prepared Android startup screens for ${origin.origin}`);
