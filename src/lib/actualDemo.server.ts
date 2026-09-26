import { createHash, randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/integrations/supabase/client.server';

const db: any = supabaseAdmin;
async function checked(query: any) { const { data, error } = await query; if (error) throw new Error(`Demo setup: ${error.message}`); return data; }
function idFor(company: string, key: string) { const h = createHash('sha256').update(`${company}:${key}`).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; }

export async function prepareActualDemo(ownerId: string) {
  const slug = `demo-${ownerId.replaceAll('-','').slice(0,16)}`;
  let company = await checked(db.from('companies').select('id,url_slug,is_demo,demo_owner_id').eq('demo_owner_id',ownerId).eq('is_demo',true).maybeSingle());
  if (!company) {
    const created = await db.from('companies').insert({name:'Evergreen Transport — Demo',url_slug:slug,status:'active',is_demo:true,demo_owner_id:ownerId}).select('id,url_slug,is_demo,demo_owner_id').single();
    if (created.error) company = await checked(db.from('companies').select('id,url_slug,is_demo,demo_owner_id').eq('demo_owner_id',ownerId).eq('is_demo',true).single());
    else company = created.data;
  }
  if (!company.is_demo || company.demo_owner_id !== ownerId) throw new Error('Demo ownership could not be verified.');
  const companyId = company.id;
  const email = `presenter-${ownerId}@demo.nemtsolutions.co`;
  async function account(accountEmail: string, first: string, last: string, presenter: boolean) {
    let profile = await checked(db.from('profiles').select('id,company_id').eq('email',accountEmail).maybeSingle());
    if (!profile) {
      const res = await db.auth.admin.createUser({ email:accountEmail,password:randomUUID()+randomUUID(),email_confirm:true,user_metadata:{first_name:first,last_name:last,company_id:companyId},app_metadata:{is_demo:true,demo_company_slug:slug,demo_owner_id:ownerId} });
      if (res.error || !res.data.user) throw new Error(`Demo account: ${res.error?.message ?? 'creation failed'}`);
      profile = {id:res.data.user.id,company_id:companyId};
    }
    if (profile.company_id !== companyId) throw new Error('Demo account belongs to another company.');
    const { data: auth, error } = await db.auth.admin.getUserById(profile.id);
    if (error || auth.user?.app_metadata?.demo_owner_id !== ownerId) throw new Error('Demo account ownership mismatch.');
    await checked(db.from('profiles').update({company_id:companyId,first_name:first,last_name:last,phone:null,sms_alerts_enabled:false,is_active:true}).eq('id',profile.id));
    const roles = presenter ? ['admin','driver','passenger','dispatch','billing','admin_biller'] : ['driver'];
    await checked(db.from('user_roles').upsert(roles.map(role=>({user_id:profile.id,company_id:companyId,role})),{onConflict:'user_id,role'}));
    return profile.id as string;
  }
  const presenterId = await account(email,'Jordan','Lee',true);
  const driver2Id = await account(`driver-${ownerId}@demo.nemtsolutions.co`,'Casey','Reed',false);
  const marker = `company:${companyId}:actual_demo_seed`;
  const seeded = await checked(db.from('app_settings').select('value').eq('key',marker).maybeSingle());
  if (!seeded) {
    await checked(db.from('edi_company_settings').upsert({company_id:companyId,billing_name:'Evergreen Transport - Demo',provider_identifier_type:'health_first_colorado_id',medicaid_provider_id:'DEMO-PROVIDER',address_line1:'100 Example Lane',city:'Colorado Springs',state:'CO',postal_code:'80903',environment:'test',production_enabled:false,notes:'Fictional demo provider - never submit'}, {onConflict:'company_id'}));
    for (const [index, uid] of [presenterId,driver2Id].entries()) {
      const existing = await checked(db.from('drivers').select('id').eq('user_id',uid).maybeSingle());
      const row={id:existing?.id ?? idFor(companyId,`driver-${index}`),user_id:uid,company_id:companyId,status:index ? 'available':'busy',vehicle_make:'Ford',vehicle_model:'Transit',vehicle_year:2024,vehicle_plate:`DEMO-${index+12}`,unit_number:String(index+12),default_vehicle_type:'ambulatory',default_plate:`DEMO-${index+12}`,current_lat:38.83+index*.02,current_lng:-104.82,last_location_at:new Date().toISOString(),rating:4.9,total_trips:24};
      await checked(db.from('drivers').upsert(row));
      await checked(db.from('driver_shifts').upsert({id:idFor(companyId,`shift-${index}`),driver_id:row.id,company_id:companyId,clock_in_at:new Date(Date.now()-7200000).toISOString(),start_odometer:25000}));
    }
    const drivers = await checked(db.from('drivers').select('id,user_id').eq('company_id',companyId));
    const driverId=drivers.find((d:any)=>d.user_id===presenterId).id;
    const names=[['Jordan','Lee'],['Alex','Morgan'],['Sam','Taylor'],['Jamie','Parker']];
    const passengerIds:string[]=[]; const riderIds:string[]=[];
    for (const [index,[first,last]] of names.entries()) {
      const existing=index===0 ? await checked(db.from('passengers').select('id').eq('user_id',presenterId).maybeSingle()) : null;
      const pid=existing?.id ?? idFor(companyId,`passenger-${index}`);passengerIds.push(pid);
      await checked(db.from('passengers').upsert({id:pid,company_id:companyId,user_id:index===0?presenterId:null,first_name:first,last_name:last,date_of_birth:'1980-01-01',phone:null,email:null,medicaid_id:`DEMO00${index+1}`,address:`${10+index} Example Lane, Colorado Springs, CO`,is_active:true,notes:'Fictional presentation passenger'}));
      const rid=idFor(companyId,`rider-${index}`);riderIds.push(rid);
      await checked(db.from('riders').upsert({id:rid,company_id:companyId,full_name:`${first} ${last}`,dob:'1980-01-01',medicaid_id:`DEMO00${index+1}`,address:`${10+index} Example Lane, Colorado Springs, CO`,created_by:presenterId,notes:'Fictional demo record — never submit to a payer'}));
    }
    for(let i=0;i<12;i++) {
      const tid=idFor(companyId,`trip-${i}`);const pickup=new Date(Date.now()+(i<6 ? -(i+1)*3600000 : (i-5)*3600000)).toISOString();const completed=i<6;
      await checked(db.from('trips').upsert({id:tid,company_id:companyId,driver_id:driverId,passenger_id:passengerIds[i%4],status:completed?'completed':i===6?'assigned':'scheduled',pickup_address:`${10+i%4} Example Lane, Colorado Springs, CO`,dropoff_address:'Demo Medical Center, Colorado Springs, CO',pickup_lat:38.83,pickup_lng:-104.82,dropoff_lat:38.87,dropoff_lng:-104.80,scheduled_pickup_time:pickup,actual_pickup_time:completed?pickup:null,actual_dropoff_time:completed?new Date(new Date(pickup).getTime()+1800000).toISOString():null,odometer_start:completed?25000+i*20:null,odometer_end:completed?25012+i*20:null,computed_miles:completed?12:null,estimated_fare:45,notes:'Fictional presentation trip',ride_purpose:'Medical appointment'}));
      if(completed) {
        const mid=idFor(companyId,`medical-${i}`);
        await checked(db.from('medicaid_trips').upsert({id:mid,company_id:companyId,driver_id:presenterId,rider_id:riderIds[i%4],dispatch_trip_id:tid,pickup_at:pickup,pickup_address:`${10+i%4} Example Lane, Colorado Springs, CO`,dropoff_address:'Demo Medical Center, Colorado Springs, CO',odometer_start:25000+i*20,odometer_end:25012+i*20,miles:12,status:'pending_review',trip_kind:'one_way',vehicle_type:'ambulatory',vehicle_plate:'DEMO-12',created_by:presenterId,review_notes:'Demo only — external submission disabled'}));
        await checked(db.from('medicaid_trip_legs').upsert({id:idFor(companyId,`leg-${i}`),medicaid_trip_id:mid,leg_index:1,leg_date:pickup.slice(0,10),pickup_time:'08:30',dropoff_time:'09:00',pickup_odometer:25000+i*20,dropoff_odometer:25012+i*20,pickup_address:'Example Lane',dropoff_address:'Demo Medical Center'}));
        await checked(db.from('billing_records').update({company_id:companyId}).eq('trip_id',mid));
      }
    }
    for(let i=0;i<3;i++) await checked(db.from('ride_requests').upsert({id:idFor(companyId,`request-${i}`),company_id:companyId,passenger_id:presenterId,pickup_address:`${10+i} Example Lane, Colorado Springs, CO`,dropoff_address:'Demo Medical Center, Colorado Springs, CO',pickup_lat:38.83,pickup_lng:-104.82,dropoff_lat:38.87,dropoff_lng:-104.80,status:'pending',contact_name:names[i].join(' '),contact_phone:null,requested_pickup_time:new Date(Date.now()+3600000*(i+1)).toISOString(),vehicle_type:'ambulatory',ride_purpose:'Medical appointment',notes:'Fictional demo request',source:'passenger'}));
    await checked(db.from('app_settings').upsert({key:marker,value:'1'},{onConflict:'key'}));
  }
  const link=await db.auth.admin.generateLink({type:'magiclink',email});
  if(link.error || !link.data.properties?.hashed_token) throw new Error('Could not start demo session.');
  return {slug,token_hash:link.data.properties.hashed_token as string};
}
