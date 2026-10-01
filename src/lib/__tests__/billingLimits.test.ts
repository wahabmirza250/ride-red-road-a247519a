import { describe, it, expect, vi } from 'vitest';
import { assertBillingLimits } from '../billingLimits';
import { postSubmitClaimTo } from '../robotAdapter.server';

describe('whole-bill limits', () => {
  it('allows exactly 50 miles and 2 trip units', () => {
    expect(() => assertBillingLimits({ miles: 50, trip_units: 2 })).not.toThrow();
  });
  it.each([{miles: 50.01}, {trip_units: 3}, {units: 2.01}, {miles: 12, total_miles: 51},
    {odometer_legs: [{pickup_odometer:100,dropoff_odometer:126},{pickup_odometer:200,dropoff_odometer:225}]},
    {odometer_legs: Array.from({length:3},()=>({pickup_odometer:100,dropoff_odometer:110}))},
    {service_lines:[{procedure_code:'A0120',units:2},{procedure_code:'A0120',units:1}]},
    {service_lines:[{procedure_code:'S0215',units:26},{procedure_code:'S0215',units:25}]},
  ])('blocks invalid quantities before any robot request: %j', async payload => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(postSubmitClaimTo(payload, 'test', {id:'test',url:'https://invalid.example'})).rejects.toThrow('Billing blocked');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it('does not count mileage units as trip units', () => {
    expect(() => assertBillingLimits({service_lines:[{procedure_code:'A0120',units:2},{procedure_code:'S0215',units:50}]})).not.toThrow();
  });
});
