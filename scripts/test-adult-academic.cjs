/* eslint-disable @typescript-eslint/no-require-imports -- Isolated regression harness. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const cache=new Map();
function load(name){
  if(cache.has(name))return cache.get(name);
  const moduleObject={exports:{}};cache.set(name,moduleObject.exports);
  const code=ts.transpileModule(fs.readFileSync(path.join(root,'lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module:moduleObject,exports:moduleObject.exports,require:p=>load(p.replace('./','')),Intl,Set,Map,Date,RegExp});
  cache.set(name,moduleObject.exports);return moduleObject.exports;
}
const {academicChunks,validateAcademicCandidates}=load('adult-academic');
const sentence='A protein sequence contains information required for folding.';

test('Whole bilingual lecture is split into bounded English-backed chunks',()=>{
  const raw=Array.from({length:25},(_,i)=>`ENGLISH ${i+1}\n${sentence.repeat(6)}\n\n中文 ${i+1}\n蛋白质序列包含折叠所需的信息。`).join('\n\n');
  const parts=academicChunks(raw);
  assert.ok(parts.length>1);
  assert.equal(parts.join('').replace(/\s/g,''),raw.replace(/\s/g,''));
  assert.ok(parts.every(p=>p.length<=12000));
  assert.throws(()=>academicChunks('只有中文。'.repeat(100)));
});
test('AI terms need a verifiable English source sentence',()=>{
  const excerpt=`${sentence}\n蛋白质序列包含折叠所需的信息。`.repeat(15);
  const good={items:[{phrase:'protein sequence',meaning:'蛋白质序列',source_quote:sentence,translation:'蛋白质序列包含折叠所需的信息。',category:'phrase'}]};
  assert.equal(validateAcademicCandidates(good,excerpt).length,1);
  assert.throws(()=>validateAcademicCandidates({items:[{...good.items[0],source_quote:'This sentence was invented by AI.'}]},excerpt));
  assert.throws(()=>validateAcademicCandidates({items:[{...good.items[0],phrase:'蛋白质序列'}]},excerpt));
});
test('Academic SQL migration, ownership, deduplication and first-day confirmation', {skip:!process.env.PGLITE_MODULE},async()=>{
  const {PGlite}=require(process.env.PGLITE_MODULE);const db=new PGlite();
  const A=randomUUID(),B=randomUUID(),profile=randomUUID(),course=randomUUID(),source=randomUUID(),chunk=randomUUID(),attempt1=randomUUID(),attempt2=randomUUID();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; insert into auth.users values('${A}'),('${B}');`);
  for(const file of ['019_parent_growth.sql','020_english_listening_courses.sql','028_adult_academic_english.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase',file),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/028_adult_academic_english.sql'),'utf8'));
  const user=(id,fn)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);return fn(tx);});
  const query=(sql,args=[])=>user(A,tx=>tx.query(sql,args));
  await query('insert into public.adult_profiles(id,name) values($1,$2)',[profile,'爸爸']);
  await query('insert into public.adult_academic_courses(id,title) values($1,$2)',[course,'基础生物学']);
  await query('insert into public.adult_academic_sources(id,course_id,title,body,content_hash) values($1,$2,$3,$4,$5)',[source,course,'第 1 讲',sentence.repeat(20),'a'.repeat(64)]);
  const candidates=[{phrase:'protein sequence',meaning:'蛋白质序列',source_quote:sentence,translation:'蛋白质序列包含折叠所需的信息。',category:'phrase'}];
  await query('insert into public.adult_academic_chunks(id,source_id,ordinal,excerpt,status,candidates) values($1,$2,1,$3,$4,$5)',[chunk,source,sentence.repeat(20),'complete',JSON.stringify(candidates)]);
  const selected=JSON.stringify([{chunk_id:chunk,index:0,new_sense:false}]);
  const published=await query('select public.adult_academic_publish($1,$2) as result',[source,selected]);
  assert.equal(published.rows[0].result.new_terms,1);
  const twice=await query('select public.adult_academic_publish($1,$2) as result',[source,selected]);
  assert.equal(twice.rows[0].result.source_links,0);
  const hidden=await user(B,tx=>tx.query('select count(*)::integer as n from public.adult_academic_sources'));
  assert.equal(hidden.rows[0].n,0);
  const concept=(await query('select concept_id from public.adult_academic_terms')).rows[0].concept_id;
  const count=await query('select public.adult_academic_start_day($1) as n',[profile]);assert.equal(count.rows[0].n,1);
  const first=await query('select public.adult_academic_answer($1,$2,$3,$4) as result',[attempt1,profile,concept,'known']);
  assert.equal(first.rows[0].result.completed,false);assert.equal(first.rows[0].result.stage,0);
  const again=await query('select public.adult_academic_answer($1,$2,$3,$4) as result',[attempt1,profile,concept,'known']);assert.equal(again.rows[0].result.idempotent,true);
  const second=await query('select public.adult_academic_answer($1,$2,$3,$4) as result',[attempt2,profile,concept,'known']);assert.equal(second.rows[0].result.completed,true);assert.equal(second.rows[0].result.stage,1);
  await db.close();
});
