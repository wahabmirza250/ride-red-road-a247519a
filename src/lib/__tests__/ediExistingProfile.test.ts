import {describe,it,expect} from 'vitest';
import {matchExistingProvider,settingsFromProvider} from '../ediExistingProfile';

describe('existing company EDI provider matching',()=>{
  const walla={id:2,legal_name:'WALLA INVESTMENT, LLC',is_active:true,is_atypical:true,location_id:'1234567890',address_line_1:'1 Main St',city:'City',state:'CO',zip:'80000'};
  it('matches the full legal name and ignores other providers',()=>{
    expect(matchExistingProvider([{id:1,legal_name:'Londons Transportation LLC'},walla],'Walla Investment LLC').id).toBe(2);
  });
  it('does not guess based on a partial company name',()=>{
    expect(()=>matchExistingProvider([walla],'Walla')).toThrow('No existing');
  });
  it('rejects ambiguous and inactive providers',()=>{
    expect(()=>matchExistingProvider([walla,{...walla,id:3}],'Walla Investment LLC')).toThrow('More than one');
    expect(()=>matchExistingProvider([{...walla,is_active:false}],'Walla Investment LLC')).toThrow('No existing');
  });
  it('imports atypical provider details without enabling production or copying secrets',()=>{
    const result=settingsFromProvider('company',{...walla,password:'secret',production_enabled:true,sender_id:'other'});
    expect(result).toMatchObject({company_id:'company',provider_identifier_type:'health_first_colorado_id',medicaid_provider_id:'1234567890',address_line1:'1 Main St',production_enabled:false,environment:'test',sender_id:null});
    expect(result).not.toHaveProperty('password');
  });
});
