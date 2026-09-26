import { EMPTY_EDI_SETTINGS, type EdiCompanySettings } from './ediSetup';

export const legalNameKey = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/** Match the server-owned company name; never accept a backend id from a browser. */
export function matchExistingProvider(rows: Record<string, unknown>[], companyName: string) {
  const key = legalNameKey(companyName);
  const matches = rows.filter(row => row.is_active !== false && key &&
    [row.legal_name, row.billing_name].some(name => legalNameKey(name) === key));
  if (matches.length !== 1) throw new Error(matches.length ?
    'More than one matching provider exists. Contact the account owner to select the correct profile.' :
    'No existing EDI provider matches this company’s legal name. Enter its provider details or ask the account owner to check the backend profile.');
  return matches[0]!;
}

/** Copy provider details only. Linking a provider never enables payer submission. */
export function settingsFromProvider(companyId: string, provider: Record<string, unknown>): EdiCompanySettings {
  const value = (key: string) => typeof provider[key] === 'string' && String(provider[key]).trim() ? String(provider[key]).trim() : null;
  return {
    company_id: companyId, ...EMPTY_EDI_SETTINGS,
    billing_name: value('legal_name') ?? value('billing_name'),
    provider_identifier_type: provider.is_atypical === true ? 'health_first_colorado_id' : 'npi',
    medicaid_provider_id: value('medicaid_provider_id') ?? value('location_id'),
    npi: value('npi'), taxonomy_code: value('taxonomy_code'), tax_id: value('tax_id'),
    address_line1: value('address_line_1'), address_line2: value('address_line_2'),
    city: value('city'), state: value('state'), postal_code: value('zip'),
    phone: value('phone'), contact_email: value('email'),
  };
}
