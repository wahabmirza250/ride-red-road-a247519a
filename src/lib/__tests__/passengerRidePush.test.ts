import { describe,it,expect } from 'vitest';
import { isRidePushStatus,ridePushMessages,safeNotificationPath } from '../passengerRidePush';
describe('passenger ride alerts',()=>{
  it('recognizes real ride milestones and rejects arbitrary properties',()=>{
    expect(Object.keys(ridePushMessages)).toHaveLength(6);
    expect(isRidePushStatus('arrived_at_pickup')).toBe(true);
    for(const value of ['pending','toString','__proto__','driver_declined']) expect(isRidePushStatus(value)).toBe(false);
  });
  it('opens company app routes and rejects external or executable destinations',()=>{
    expect(safeNotificationPath('/walla/passenger/track')).toBe('/walla/passenger/track');
    expect(safeNotificationPath('/walla/driver')).toBe('/walla/driver');
    for(const value of [null,'https://evil.example','//evil.example','/\\evil.example','javascript:alert(1)','/owner','/walla/passenger/../../owner','/walla/passenger\n/track']) expect(safeNotificationPath(value)).toBeNull();
  });
});
