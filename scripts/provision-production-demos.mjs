import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

if(process.env.CONFIRM_PRODUCTION_DEMO!=='ALL_FIVE_PRODUCTION')throw new Error('Set CONFIRM_PRODUCTION_DEMO=ALL_FIVE_PRODUCTION.');
for(const key of ['SUPABASE_URL','SUPABASE_SECRET_KEY','PRODUCTION_DEMO_PASSWORD'])if(!process.env[key])throw new Error(`Missing ${key}.`);
const manifest=JSON.parse(await readFile('ops/production/demo-tenants.json','utf8'));
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const listed=await db.auth.admin.listUsers({page:1,perPage:1000});if(listed.error)throw listed.error;
const users=new Map(listed.data.users.map((user)=>[user.email?.toLowerCase(),user]));
async function upsert(table,rows,onConflict){const result=await db.from(table).upsert(rows,{onConflict});if(result.error)throw result.error;}
const platformEmail='demo+platform-admin@soliventa.tech';
const platformExisting=users.get(platformEmail);
const platformIdentity=platformExisting?await db.auth.admin.updateUserById(platformExisting.id,{password:process.env.PRODUCTION_DEMO_PASSWORD,email_confirm:true}):await db.auth.admin.createUser({email:platformEmail,password:process.env.PRODUCTION_DEMO_PASSWORD,email_confirm:true,user_metadata:{full_name:'Soliventa Platform Administrator'}});
if(platformIdentity.error)throw platformIdentity.error;
const platformActor=platformIdentity.data.user.id;
await upsert('profiles',[{user_id:platformActor,display_name:'Soliventa Platform Administrator',email:platformEmail}],'user_id');
await upsert('platform_role_assignments',[{user_id:platformActor,role:'moderator'}],'user_id,role');
const platformRole=await db.from('platform_authorization_roles').select('id').eq('code','platform_admin').single();if(platformRole.error)throw platformRole.error;
await upsert('platform_operator_role_assignments',[{account_id:platformActor,role_id:platformRole.data.id,granted_by:platformActor}],'account_id,role_id');
console.log(`Prepared platform administrator: ${platformEmail}`);
const demoFeatureKeys=['admissions','news','gallery','website.studio','payments.online','portal.academic','portal.students','portal.staff','portal.attendance','portal.results','portal.fees','portal.parents','portal.messages','portal.exams','portal.assignments','portal.lessons','portal.library'];
await upsert('platform_features',demoFeatureKeys.map((feature_key)=>({feature_key,available:true})),'feature_key');
const palettes={horizon:{primary:'#155e55',secondary:'#d9eee8',accent:'#dc8b36',background:'#f7faf9',surface:'#ffffff',text:'#172522',muted:'#596b66'},crest:{primary:'#17345c',secondary:'#e7dfcb',accent:'#a77a2f',background:'#faf8f2',surface:'#ffffff',text:'#182438',muted:'#646b75'},atlas:{primary:'#102a43',secondary:'#d7e7f4',accent:'#d8aa55',background:'#f6f8fb',surface:'#ffffff',text:'#111c2a',muted:'#596779'},mosaic:{primary:'#814c8f',secondary:'#f4df73',accent:'#e46f4f',background:'#fff9ef',surface:'#ffffff',text:'#2d2430',muted:'#6f626f'},editorial:{primary:'#111111',secondary:'#e9e9e9',accent:'#ff5a36',background:'#f4f2ed',surface:'#ffffff',text:'#111111',muted:'#66635f'}};
function configuration(tenant){const headings={horizon:'Learning clearly. Growing confidently.',crest:'A tradition of scholarship and service.',atlas:'A global education with a human centre.',mosaic:'Every child brings something wonderful.',editorial:'Ideas become practice.'};return{schemaVersion:1,template:tenant.template,branding:{logoUrl:null,faviconUrl:null,colors:palettes[tenant.template],fonts:{heading:tenant.template==='atlas'?'Playfair Display':tenant.template==='crest'?'Merriweather':'Inter',body:'Inter'},buttonStyle:['crest','editorial'].includes(tenant.template)?'square':tenant.template==='mosaic'?'pill':'rounded',cardStyle:['horizon','mosaic'].includes(tenant.template)?'elevated':'flat'},contact:{email:`office@${tenant.publicHostname}`,phone:'+234 800 000 0000',address:'Lagos, Nigeria'},socialLinks:[],features:{admissions:true,news:true,'portal.students':true,'portal.fees':true,'payments.online':true},navigation:[{label:'Home',href:'/',requiredFeature:null},{label:'Admissions',href:'/admissions/',requiredFeature:'admissions'}],pages:[{slug:'/',title:tenant.name,visible:true,blocks:[{id:randomUUID(),type:'hero',heading:headings[tenant.template],body:`Welcome to ${tenant.name}. Explore our school and begin your application online.`,imageUrl:null,primaryAction:{label:'Apply now',href:'/apply/'}}]}]};}
for(const tenant of manifest.tenants){
 await upsert('schools',[{id:tenant.id,code:tenant.code,legal_name:tenant.name,display_name:tenant.name,status:'active'}],'id');
 const email=`demo+${tenant.code}-admin@soliventa.tech`;const existing=users.get(email);const identity=existing?await db.auth.admin.updateUserById(existing.id,{password:process.env.PRODUCTION_DEMO_PASSWORD,email_confirm:true}):await db.auth.admin.createUser({email,password:process.env.PRODUCTION_DEMO_PASSWORD,email_confirm:true,user_metadata:{full_name:`${tenant.name} Demo Administrator`}});if(identity.error)throw identity.error;const actor=identity.data.user.id;
 await upsert('profiles',[{user_id:actor,display_name:`${tenant.name} Demo Administrator`,email}],'user_id');
 await upsert('school_memberships',[{school_id:tenant.id,user_id:actor,role:'school_admin',status:'active'}],'school_id,user_id,role');
 await upsert('school_feature_entitlements',demoFeatureKeys.map((feature_key)=>({school_id:tenant.id,feature_key,entitled:true})),'school_id,feature_key');
 const school=await db.from('schools').select('published_config_version_id').eq('id',tenant.id).single();if(school.error)throw school.error;
 if(!school.data.published_config_version_id){const draft=await db.rpc('save_tenant_config_draft',{_school_id:tenant.id,_version_id:null,_actor_id:actor,_config:configuration(tenant)});if(draft.error)throw draft.error;const published=await db.rpc('publish_tenant_config_as_service',{_school_id:tenant.id,_version_id:draft.data.id,_actor_id:actor,_action:'publish'});if(published.error)throw published.error;}
 await upsert('tenant_domains',[{school_id:tenant.id,hostname:tenant.publicHostname,domain_type:'public_site',domain_kind:'platform',status:'active',verified_at:new Date().toISOString(),certificate_status:'active',is_primary:true},{school_id:tenant.id,hostname:tenant.portalHostname,domain_type:'portal',domain_kind:'platform',status:'active',verified_at:new Date().toISOString(),certificate_status:'active',is_primary:true}],'normalized_hostname');
 await upsert('school_payment_settings',[{school_id:tenant.id,paystack_enabled:false,manual_transfer_enabled:false,updated_by:actor}],'school_id');
 console.log(`Prepared ${tenant.name}: ${tenant.publicHostname} / ${tenant.portalHostname}`);
}
