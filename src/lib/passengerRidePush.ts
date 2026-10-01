export const ridePushMessages = {
  assigned: ['Driver assigned', 'A driver has been assigned to your ride.'],
  driver_en_route_to_pickup: ['Driver on the way', 'Your driver is on the way to pick you up.'],
  arrived_at_pickup: ['Your driver has arrived', 'Your driver is waiting at your pickup location.'],
  in_progress: ['Ride started', 'Your ride is now in progress.'],
  completed: ['Ride completed', 'Your ride is complete. Thank you for riding with us.'],
  cancelled: ['Ride cancelled', 'Your ride has been cancelled. Open the app for details.'],
} as const;
export type RidePushStatus = keyof typeof ridePushMessages;

export function isRidePushStatus(value: string): value is RidePushStatus {
  return Object.prototype.hasOwnProperty.call(ridePushMessages, value);
}

/** Accept only local application links, never arbitrary notification URLs. */
export function safeNotificationPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\s]/.test(value)) return null;
  const url = new URL(value, 'https://nemtsolutions.co');
  if (url.origin !== 'https://nemtsolutions.co') return null;
  if (!/^\/[a-z0-9-]+\/(passenger(?:\/|$)|driver(?:\/|$)|billing(?:\/|$)|dashboard(?:\/|$)|dispatch(?:\/|$))/.test(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}
