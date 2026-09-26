import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';

/** Import a matching provider into this company. Never writes to the EDI backend. */
export const findExistingEdiProvider = createServerFn({method:'POST'})
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({company_id:z.string().uuid().nullable().optional()}).parse(data))
  .handler(async ({data,context}) => {
    const {resolveEdiScope} = await import('./ediCompany.server');
    const {companyId,isPlatformOwner} = await resolveEdiScope(context.supabase,context.userId,data.company_id);
    const {data:admin,error:roleError} = await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'admin'});
    if (roleError || (!admin && !isPlatformOwner)) throw new Error('A company admin must link an existing provider.');
    const {supabaseAdmin} = await import('@/integrations/supabase/client.server');
    const {data:company,error:companyError} = await supabaseAdmin.from('companies').select('name,status').eq('id',companyId).single();
    if (companyError || company?.status !== 'active') throw new Error('Active company required.');
    const {loadCatalogState} = await import('./ediSync.server');
    const catalog = await loadCatalogState(context.supabase);
    if (catalog.error || !catalog.paths.provider) throw new Error(catalog.error ?? 'Backend provider lookup is unavailable.');
    const {ediFetch} = await import('./ediBridge.server');
    const rows: Record<string,unknown>[] = [];
    // Bounded pagination on the discovered collection; never follow arbitrary URLs.
    for (let page=1;page<=20;page++) {
      const result = await ediFetch<any>(context.supabase,{path:`${catalog.paths.provider}?page=${page}`,method:'GET'});
      if (!result.ok) throw new Error(result.error);
      const payload = result.data;
      const pageRows = Array.isArray(payload) ? payload : payload?.results;
      if (!Array.isArray(pageRows)) throw new Error('The provider list has an unsupported response format.');
      rows.push(...pageRows);
      if (!(result.hasNextPage || (!Array.isArray(payload) && payload.next))) break;
      if (page===20) throw new Error('Provider list is too large for automatic matching. Contact the account owner.');
    }
    const {matchExistingProvider,settingsFromProvider,legalNameKey} = await import('./ediExistingProfile');
    const {data:companies,error:companiesError} = await supabaseAdmin.from('companies').select('id,name');
    if (companiesError) throw new Error(companiesError.message);
    if (companies?.some(c => c.id !== companyId && legalNameKey(c.name) === legalNameKey(company.name)))
      throw new Error('Company legal name is ambiguous. Contact the account owner to link this provider.');
    const provider = matchExistingProvider(rows,company.name);
    const {parseEdiId} = await import('./ediGuard');
    const id = parseEdiId(provider.id);
    if (!id) throw new Error('The matching provider has no valid identifier.');
    const {data:other,error:otherError} = await supabaseAdmin.from('edi_company_mapping').select('company_id').eq('edi_provider_profile_id',id).neq('company_id',companyId);
    if (otherError) throw new Error(otherError.message);
    if (other?.length) throw new Error('This provider is already linked to another company. Contact the account owner.');
    const {loadEdiCompanySettings} = await import('./ediSetup.server');
    const {saveCompanyMapping,loadCompanyMapping} = await import('./ediLedger.server');
    const mapping = await loadCompanyMapping(supabaseAdmin,companyId);
    if (mapping.edi_provider_profile_id && String(mapping.edi_provider_profile_id) !== String(id))
      throw new Error('This company already has a different provider linked. Contact the account owner before replacing it.');
    const existing = await loadEdiCompanySettings(supabaseAdmin,companyId);
    const imported = settingsFromProvider(companyId,provider);
    const settings = {...existing, ...Object.fromEntries(Object.entries(imported).filter(([key]) =>
      !['environment','production_enabled','transport_mode','sender_id','receiver_id','contact_name','tax_id','sftp_host','sftp_port','sftp_username','sftp_directory','sftp_secret_configured','notes'].includes(key)))};
    // Save the identity first so a retry after a settings failure cannot create a duplicate provider.
    await saveCompanyMapping(supabaseAdmin,companyId,{edi_provider_profile_id:String(id),provider_fingerprint:null});
    const {error:saveError} = await supabaseAdmin.from('edi_company_settings').upsert(settings as never,{onConflict:'company_id'});
    if (saveError) throw new Error(`Provider linked, but details could not be saved: ${saveError.message}. Retry importing.`);
    return {provider_id:id};
  });
