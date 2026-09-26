import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const raw = process.env.FIREBASE_PASSENGER_GOOGLE_SERVICES_JSON;
if (!raw) throw new Error('Passenger notification configuration is required before building this APK.');
let config;
try { config = JSON.parse(raw); } catch { throw new Error('Invalid passenger notification configuration JSON.'); }
if (config.project_info?.project_id !== 'nemt-solutions' || !config.client?.some(c=>
  c.client_info?.android_client_info?.package_name === 'com.redart.rides' &&
  c.client_info?.mobilesdk_app_id && c.api_key?.some(k=>k.current_key)
)) throw new Error('Firebase configuration must match the NEMT Passenger app.');
writeFileSync(fileURLToPath(new URL('./passenger/android/app/google-services.json',import.meta.url)),JSON.stringify(config,null,2)+'\n');
console.log('Passenger notification configuration installed.');
