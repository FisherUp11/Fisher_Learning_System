/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('023 migration reruns, enforces 50 learners, and atomically denies excess Azure calls', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const owner = id(1), workspace = id(2), family = id(3);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.learning_workspaces(id uuid primary key);
      create table public.workspace_members(workspace_id uuid, user_id uuid, status text, role text);
      create table public.families(id uuid primary key, workspace_id uuid not null, status text);
      create table public.learner_profiles(id uuid primary key, family_id uuid not null, timezone text);
      create table public.service_usage_events(
        id uuid primary key, workspace_id uuid, user_id uuid, learner_id uuid,
        feature text, service text, model text, characters integer default 0,
        audio_seconds numeric default 0, status text default 'started',
        http_status integer, created_at timestamptz default now()
      );
      create table public.daily_sessions(id uuid primary key, learner_id uuid, date_local date);
      create table public.daily_character_progress(session_id uuid, character_id uuid, passed_at timestamptz);
      create table public.content_packages(id uuid, status text, review_status text);
      create table public.learner_content_packages(learner_id uuid, package_id uuid, assignment_status text);
      create table public.package_characters(package_id uuid, character_id uuid);
      create table public.learning_states(learner_id uuid, character_id uuid, stage integer, due_at timestamptz);
      create table public.learning_attempts(learner_id uuid, character_id uuid, attempt_number integer, result text, assisted boolean, answered_at timestamptz);
      create table public.music_items(id uuid, status text, review_status text);
      create table public.learner_music_items(learner_id uuid, item_id uuid, assignment_status text);
      create table public.music_learning_states(learner_id uuid, item_id uuid, due_at timestamptz);
      create table public.catechism_collections(id uuid, status text, review_status text);
      create table public.learner_catechism_collections(learner_id uuid, collection_id uuid, assignment_status text);
      create table public.catechism_items(id uuid, collection_id uuid, status text);
      create table public.catechism_learning_states(learner_id uuid, item_id uuid, next_review_date date);
      create table public.poem_collections(id uuid, status text, review_status text);
      create table public.learner_poem_collections(learner_id uuid, collection_id uuid, assignment_status text);
      create table public.app_activity_days(
        workspace_id uuid, user_id uuid, learner_id uuid, activity_date date,
        active_seconds integer, visits integer, last_seen_at timestamptz default now()
      );
      create unique index app_activity_days_unique on public.app_activity_days
        (user_id, activity_date, (coalesce(learner_id, '00000000-0000-0000-0000-000000000000'::uuid)));
      create function private.is_workspace_admin(p_workspace_id uuid) returns boolean language sql stable as
        $$ select exists(select 1 from public.workspace_members
          where workspace_id=p_workspace_id and user_id=auth.uid() and status='active' and role='owner') $$;
      create function private.can_access_learner(p_learner_id uuid) returns boolean language sql stable as
        $$ select exists(select 1 from public.learner_profiles l join public.families f on f.id=l.family_id
          where l.id=p_learner_id and private.is_workspace_admin(f.workspace_id)) $$;
      create function private.learner_workspace_id(p_learner_id uuid) returns uuid language sql stable as
        $$ select f.workspace_id from public.learner_profiles l join public.families f on f.id=l.family_id
          where l.id=p_learner_id $$;
      grant usage on schema private, auth to authenticated;
      grant execute on function auth.uid(), private.is_workspace_admin(uuid),
        private.can_access_learner(uuid), private.learner_workspace_id(uuid) to authenticated;
      grant select on public.workspace_members, public.learner_profiles, public.families, public.daily_sessions,
        public.daily_character_progress, public.service_usage_events to authenticated;
      grant select on public.workspace_members, public.learner_profiles, public.families to service_role;
      grant select, insert, update on public.service_usage_events to service_role;
      insert into auth.users values('${owner}');
      insert into public.learning_workspaces values('${workspace}');
      insert into public.workspace_members values('${workspace}','${owner}','active','owner');
      insert into public.families values('${family}','${workspace}','active');
    `);
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '023_capacity_guard_50_learners.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    for (let n = 100; n < 150; n++) {
      await db.query('insert into public.learner_profiles(id,family_id,timezone) values($1,$2,$3)', [id(n), family, 'Asia/Shanghai']);
    }
    await assert.rejects(db.query('insert into public.learner_profiles(id,family_id,timezone) values($1,$2,$3)', [id(150), family, 'Asia/Shanghai']), /50 个孩子/);
    assert.equal((await db.query('select count(*)::int n from public.learner_profiles')).rows[0].n, 50);
    const reserve = (requestId, service = 'tts') => db.query(`select public.reserve_metered_service_call(
      $1,$2,$3,null,'test',$4,'test-model',10,0,1,1,5,5,100,100) as decision`,
      [requestId, workspace, owner, service]);
    assert.equal((await reserve(id(201))).rows[0].decision, 'allowed');
    assert.equal((await reserve(id(202))).rows[0].decision, 'workspace_minute');
    const simultaneous = await Promise.all([reserve(id(203), 'image'), reserve(id(204), 'image')]);
    assert.deepEqual(simultaneous.map((result) => result.rows[0].decision).sort(), ['allowed', 'workspace_minute']);
    await db.query('insert into auth.users values($1)', [id(4)]);
    await db.query("insert into public.workspace_members values($1,$2,'active','parent')", [workspace, id(4)]);
    const perAccount = (requestId) => db.query(`select public.reserve_metered_service_call(
      $1,$2,$3,null,'test','text','test-model',0,0,10,1,100,5,null,null) as decision`,
      [requestId, workspace, id(4)]);
    assert.equal((await perAccount(id(205))).rows[0].decision, 'allowed');
    assert.equal((await perAccount(id(206))).rows[0].decision, 'account_minute');
    assert.equal((await db.query('select count(*)::int n from public.service_usage_events')).rows[0].n, 3);
    assert.equal((await db.query('select count(*)::int n from public.service_guard_denials')).rows[0].n, 3);
    const asOwner = await db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      return tx.query('select service,day_calls,day_denials from public.workspace_capacity_snapshot($1)', [workspace]);
    });
    assert.equal(Number(asOwner.rows.find((row) => row.service === 'tts').day_denials), 1);
    await db.query("insert into public.content_packages values($1,'published','approved')", [id(301)]);
    await db.query("insert into public.learner_content_packages values($1,$2,'active')", [id(100), id(301)]);
    await db.query('insert into public.package_characters values($1,$2)', [id(301), id(302)]);
    await db.query("insert into public.learning_states values($1,$2,5,now()-interval '1 day')", [id(100), id(302)]);
    await db.query("insert into public.learning_attempts values($1,$2,1,'known',false,now())", [id(100), id(302)]);
    await db.query("insert into public.daily_sessions values($1,$2,(now() at time zone 'Asia/Shanghai')::date)", [id(303), id(100)]);
    await db.query('insert into public.daily_character_progress values($1,$2,null)', [id(303), id(302)]);
    const dashboard = await db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      return tx.query('select public.learner_dashboard_snapshot($1) as snapshot', [id(100)]);
    });
    assert.equal(dashboard.rows[0].snapshot.started, 1);
    assert.equal(dashboard.rows[0].snapshot.stable, 1);
    assert.equal(dashboard.rows[0].snapshot.due, 1);
    assert.equal(dashboard.rows[0].snapshot.firstAttemptRate, 100);
    assert.equal(dashboard.rows[0].snapshot.todayRemaining, 1);
  } finally {
    await db.close();
  }
});
