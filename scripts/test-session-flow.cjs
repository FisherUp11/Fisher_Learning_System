/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { NextRequest } = require('next/server');
const root = path.join(__dirname, '..');
const origin = 'https://le.example.test';
const invitation = '/join?token=' + 'a'.repeat(43);

function loader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const resolve = id => id in overrides ? overrides[id] : id === 'server-only' ? {} : id.startsWith('@/') ? load(`${id.slice(2)}.ts`) : require(id);
    new Function('module', 'exports', 'require', code)(loaded, loaded.exports, resolve);
    return loaded.exports;
  }
  return load;
}

function request(body = {}, headers = {}) {
  return new NextRequest(`${origin}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
function signin(extra = {}) { return { intent: 'signin', email: 'parent@example.test', password: 'fake-test-password-123', next: '/parent', ...extra }; }
function json(body, status = 200) { return Response.json(body, { status, headers: { 'x-supabase-api-version': '2024-01-01' } }); }
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'parent@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {} };
function session() {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), role: 'authenticated' })).toString('base64url');
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fake`, refresh_token: 'fake-refresh-token', expires_in: 3600, token_type: 'bearer', user };
}

async function withProvider(fetcher, run) {
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'];
  const previous = names.map(name => process.env[name]);
  const original = { fetch: global.fetch, warn: console.warn, error: console.error };
  const logs = [];
  global.fetch = fetcher;
  console.warn = (...values) => logs.push(values);
  console.error = () => {};
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-test-key';
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_SECRET_KEY = 'NEVER-USE-ADMIN-KEY';
  try { return await run(loader(), logs); }
  finally {
    global.fetch = original.fetch; console.warn = original.warn; console.error = original.error;
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
}

test('站内跳转白名单：拒绝外站、反斜杠、控制字符；注册只接受完整邀请路径', () => {
  const { sessionNextPath, invitationSignupPath } = loader()('lib/session-flow.ts');
  for (const value of ['https://attacker.test', '//attacker.test', '/\\attacker.test', '/\t/attacker.test', '/\n/attacker.test', '/\u0000/attacker.test', {}, null]) assert.equal(sessionNextPath(value), '/');
  assert.equal(sessionNextPath('/library?learner=test'), '/library?learner=test');
  assert.equal(invitationSignupPath(invitation), invitation);
  for (const value of ['/join', '/join?token=short', '/join-other?token=' + 'a'.repeat(43), '//attacker.test/join?token=' + 'a'.repeat(43)]) assert.equal(invitationSignupPath(value), null);
});

test('非法来源、类型、超大正文、非法凭据和无邀请注册在发出 Auth 请求前拒绝', async () => {
  await withProvider(() => assert.fail('invalid request must not contact Auth'), async load => {
    const { POST } = load('app/api/auth/session/route.ts');
    assert.equal((await POST(request(signin(), { origin: 'https://attacker.test' }))).status, 403);
    assert.equal((await POST(request(signin(), { 'content-type': 'text/plain' }))).status, 415);
    for (const body of [{ intent: ['signin'] }, {}, signin({ email: 'invalid' }), signin({ password: '' }), signin({ password: 'x'.repeat(5000) }), signin({ intent: 'signup', next: '/parent' }), signin({ intent: 'signup', next: invitation, password: 'short1' })]) assert.equal((await POST(request(body))).status, 400);
  });
});

test('真实 SSR SDK 模拟 HTTP：公钥单次登录、旧 Cookie 分片清理、JSON 无凭据、会话能由后续请求验证', async () => {
  const calls = [];
  await withProvider(async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    assert.equal(headers.get('apikey'), 'public-test-key');
    assert.doesNotMatch(headers.get('authorization') || '', /NEVER-USE/);
    calls.push([init.method, url.pathname, url.search]);
    if (url.pathname.endsWith('/token')) {
      const body = JSON.parse(init.body);
      assert.equal(body.password, 'fake-test-password-123');
      assert.equal(body.email, 'parent@example.test');
      return json(session());
    }
    if (url.pathname.endsWith('/user')) return json(user);
    assert.fail('unexpected provider call');
  }, async load => {
    const { POST } = load('app/api/auth/session/route.ts');
    const response = await POST(request(signin(), { cookie: 'sb-example-auth-token.0=stale; sb-example-auth-token.1=old' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, signedIn: true, message: '登录成功，正在进入…', redirectTo: '/parent' });
    assert.deepEqual(calls, [['POST', '/auth/v1/token', '?grant_type=password']], '登录前不刷新旧会话');
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.match(response.headers.get('set-cookie'), /sb-example-auth-token/);
    assert.equal(response.cookies.get('sb-example-auth-token.0').value, '');
    assert.equal(response.cookies.get('sb-example-auth-token.1').value, '');
    const cookie = response.cookies.getAll().filter(c => c.value).map(c => `${c.name}=${c.value}`).join('; ');
    const flow = load('lib/password-flow-server.ts').createPasswordFlowClient(new NextRequest(`${origin}/parent`, { headers: { cookie } }));
    const verified = await flow.supabase.auth.getUser();
    assert.equal(verified.error, null);
    assert.equal(verified.data.user.id, user.id);
    assert.equal(calls.length, 2);
    const safe = await POST(request(signin({ next: '//attacker.test' })));
    assert.equal((await safe.json()).redirectTo, '/');
  });
});

test('登录错误不泄露账号存在性；网络、500、429 和缺失会话分开提示，不重试', async () => {
  for (const [status, code, diagnostic, expected] of [[400, 'invalid_credentials', 'login_failed', 401], [400, 'user_not_found', 'login_failed', 401], [400, 'email_not_confirmed', 'login_failed', 401], [0, '', 'server_auth_network_error', 503], [500, '', 'supabase_auth_server_error', 502], [429, 'over_request_rate_limit', 'auth_rate_limit', 429], [200, '', 'login_session_missing', 502]]) {
    let calls = 0;
    await withProvider(async () => {
      calls++;
      if (!status) throw new TypeError('private upstream text parent@example.test fake-test-password-123');
      return status === 200 ? json({}) : json({ code, msg: 'private upstream text parent@example.test fake-test-password-123' }, status);
    }, async (load, logs) => {
      const response = await load('app/api/auth/session/route.ts').POST(request(signin()));
      const result = await response.json();
      assert.equal(response.status, expected);
      assert.equal(result.ok, false);
      assert.match(result.diagnostic, new RegExp(diagnostic));
      assert.doesNotMatch(JSON.stringify({ result, logs }), /parent@example|fake-test-password|private upstream/);
      assert.equal(calls, 1);
    });
  }
});

test('登录实例级辅助限流不沿用邮件的一分钟一次，且登录与注册额度隔离', async () => {
  let calls = 0;
  await withProvider(async () => { calls++; return json({ code: 'invalid_credentials', msg: 'no' }, 400); }, async load => {
    const { POST } = load('app/api/auth/session/route.ts');
    for (let i = 0; i < 8; i++) assert.equal((await POST(request(signin()))).status, 401);
    const denied = await POST(request(signin()));
    assert.equal(denied.status, 429);
    assert.equal((await denied.json()).diagnostic, 'session_cooldown');
    assert.equal(calls, 8);
    assert.equal((await POST(request(signin({ intent: 'signup', next: invitation })))).status, 401);
    assert.equal(calls, 9, '注册有独立的额度');
  });
});

test('邀请注册保留 PKCE、本站回调和 next，无会话时提示查邮件，不授予家庭/角色', async () => {
  let calls = 0;
  await withProvider(async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.pathname, '/auth/v1/signup');
    const callback = new URL(url.searchParams.get('redirect_to'));
    assert.equal(callback.origin, origin);
    assert.equal(callback.pathname, '/auth/callback');
    assert.equal(callback.searchParams.get('next'), invitation);
    const body = JSON.parse(init.body);
    assert.equal(body.code_challenge_method, 's256');
    assert.equal(body.data.role, undefined);
    return json({ user });
  }, async load => {
    const response = await load('app/api/auth/session/route.ts').POST(request(signin({ intent: 'signup', next: invitation })));
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.signedIn, false);
    assert.equal(result.redirectTo, undefined);
    assert.match(response.headers.get('set-cookie'), /code-verifier/);
    assert.equal(calls, 1);
  });
});

test('切换账号只退出当前会话并回写删除 Cookie；不暴露 token 或绕过 Auth', async () => {
  const calls = [];
  await withProvider(async input => {
    const url = new URL(String(input)); calls.push([url.pathname, url.search]);
    return url.pathname.endsWith('/token') ? json(session()) : json({});
  }, async load => {
    const { POST } = load('app/api/auth/session/route.ts');
    const login = await POST(request(signin()));
    const cookie = login.cookies.getAll().map(c => `${c.name}=${c.value}`).join('; ');
    const response = await POST(request({ intent: 'signout' }, { cookie }));
    assert.equal((await response.json()).ok, true);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.deepEqual(calls, [['/auth/v1/token', '?grant_type=password'], ['/auth/v1/logout', '?scope=local']]);
  });
});

test('客户端只向本站发一次请求；旧部署404、网络失败明确提示，没有浏览器直连或自动重试', async () => {
  const original = global.fetch;
  try {
    let calls = 0;
    global.fetch = async (input, init) => { calls++; assert.equal(input, '/api/auth/session'); assert.equal(init.credentials, 'same-origin'); throw new TypeError('offline'); };
    const { postSessionFlow } = loader()('lib/session-flow.ts');
    assert.equal((await postSessionFlow(signin())).diagnostic, 'website_session_network_error');
    assert.equal(calls, 1);
    global.fetch = async () => new Response('<html>old</html>', { status: 404 });
    assert.match((await postSessionFlow(signin())).message, /Vercel/);
  } finally { global.fetch = original; }
  for (const file of ['components/login-form.tsx', 'components/accept-invitation-form.tsx']) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /@\/lib\/supabase\/client|auth\.signInWithPassword|auth\.signUp|auth\.signOut/);
});

test('公开登录入口不刷新无关旧 Cookie；受保护页面仍执行原会话验证', async () => {
  await withProvider(() => assert.fail('no real HTTP'), async () => {
    let clients = 0, verifications = 0;
    const { updateSession } = loader({ '@supabase/ssr': { createServerClient: () => {
      clients++;
      return { auth: { getUser: async () => { verifications++; return { data: { user: null }, error: null }; } } };
    } } })('lib/supabase/proxy.ts');
    for (const route of ['/login', '/forgot-password', '/api/auth/session', '/api/auth/password-recovery', '/api/auth/password-reset']) {
      const response = await updateSession(new NextRequest(`${origin}${route}`));
      assert.match(response.headers.get('cache-control'), /no-store/);
    }
    assert.equal(clients, 0);
    await updateSession(new NextRequest(`${origin}/parent`));
    assert.equal(clients, 1);
    assert.equal(verifications, 1, '不能将公开入口的豁免扩大到受保护页面');
  });
});
