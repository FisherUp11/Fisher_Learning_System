/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { NextRequest } = require('next/server');
const root = path.join(__dirname, '..');
const origin = 'https://le.example.test';

function loader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const resolve = id => id in overrides ? overrides[id] : id === 'server-only' ? {} : id.startsWith('@/') ? load(`${id.slice(2)}.ts`) : require(id);
    new Function('module', 'exports', 'require', code)(loaded, loaded.exports, resolve);
    return loaded.exports;
  }
  return load;
}

function request(route = 'password-recovery', body = { email: 'parent@example.test' }, headers = {}) {
  return new NextRequest(`${origin}/api/auth/${route}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

test('同源/JSON/流式大小边界；邮箱和密码服务端校验', async () => {
  const helpers = loader()('lib/password-flow-server.ts');
  assert.equal(helpers.passwordFlowRequestGuard(request()), null);
  const aliasRequest = new NextRequest('http://localhost:3000/api/auth/password-recovery', { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(helpers.passwordFlowRequestGuard(aliasRequest), null, 'Next 内部 localhost 不应误拒绝真实 Host 的同源请求');
  assert.equal(helpers.passwordFlowRequestGuard(new NextRequest(aliasRequest.url, { method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: '{}' })).status, 403, '必须比较实际 Host，而非允许内部地址绕过');
  for (const headers of [{ origin: 'https://attacker.test' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal(helpers.passwordFlowRequestGuard(request(undefined, undefined, headers)).status, 403);
  }
  for (const type of ['text/plain', 'application/jsonp']) assert.equal(helpers.passwordFlowRequestGuard(request(undefined, undefined, { 'content-type': type })).status, 415);
  assert.equal(await helpers.readPasswordFlowBody(request(undefined, { email: 'x'.repeat(5000) })), null);
  assert.equal(await helpers.readPasswordFlowBody(request(undefined, ['email'])), null);
  assert.equal(helpers.normalizedRecoveryEmail(' Parent@Example.test '), 'parent@example.test');
  for (const value of [null, {}, 'a@@b.com', 'a\nb@x.com', 'a'.repeat(255) + '@x.com']) assert.equal(helpers.normalizedRecoveryEmail(value), null);
  assert.equal(helpers.validRecoveryPassword('long-password-123'), true);
  for (const value of ['short1', 'onlyletterslong', '1'.repeat(20), 'long-password-1'.repeat(30)]) assert.equal(helpers.validRecoveryPassword(value), false);
});

test('同邮箱一分钟、同 IP 六次/十分钟；无账号存在性依赖，过期释放', () => {
  const { createRecoveryLimiter } = loader()('lib/password-flow-server.ts');
  const limit = createRecoveryLimiter();
  assert.equal(limit('parent@example.test', 'ip1', 1000), 0);
  assert.equal(limit('parent@example.test', 'ip2', 1001), 60);
  assert.equal(limit('parent@example.test', 'ip2', 61_000), 0);
  for (let i = 0; i < 5; i++) assert.equal(limit(`p${i}@example.test`, 'ip1', 61_000), 0);
  assert.ok(limit('other@example.test', 'ip1', 61_001) > 0);
  assert.equal(limit('other@example.test', 'ip1', 601_001), 0);
  const bounded = createRecoveryLimiter();
  for (let i = 0; i < 1024; i++) assert.equal(bounded(`p${i}@example.test`, `ip${i}`, 1000), 0);
  assert.equal(bounded('overflow@example.test', 'overflow', 1000), 60);
  assert.equal(bounded('overflow@example.test', 'overflow', 700_000), 0);
});

async function withProvider(fetcher, run) {
  const previous = { fetch: global.fetch, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, publicKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, secret: process.env.SUPABASE_SECRET_KEY };
  global.fetch = fetcher;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-test-key';
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_SECRET_KEY = 'DO-NOT-USE-THIS-SECRET';
  try { return await run(loader()); }
  finally {
    global.fetch = previous.fetch;
    for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: previous.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: previous.key, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: previous.publicKey, SUPABASE_SECRET_KEY: previous.secret })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function json(body, status = 200) { return Response.json(body, { status, headers: { 'x-supabase-api-version': '2024-01-01' } }); }

test('真实 SSR SDK 模拟 HTTP：仅发一次 /recover，公钥、PKCE Cookie、正式模板链接和统一结果保留', async () => {
  const calls = [];
  await withProvider(async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(init.body), headers: new Headers(init.headers) });
    return json({});
  }, async load => {
    const { POST } = load('app/api/auth/password-recovery/route.ts');
    const response = await POST(request());
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.retryAfter, 60);
    assert.match(body.message, /如果该邮箱已注册/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.match(response.headers.get('set-cookie'), /code-verifier/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.supabase.co/auth/v1/recover');
    assert.equal(calls[0].headers.get('apikey'), 'public-test-key');
    assert.doesNotMatch(JSON.stringify(calls), /DO-NOT-USE/);
    assert.equal(calls[0].body.email, 'parent@example.test');
    assert.equal(calls[0].body.code_challenge_method, 's256');
    assert.ok(calls[0].body.code_challenge);
    assert.equal((await POST(request())).status, 429);
    assert.equal(calls.length, 1, '重复点击不能发出第二次邮件');
  });
});

test('不存在/停用账号也返回统一结果；非法请求在联系提供商前拒绝', async () => {
  for (const code of ['user_not_found', 'user_banned']) {
    let calls = 0;
    await withProvider(async () => { calls++; return json({ code, msg: 'private account details' }, 400); }, async load => {
      const { POST } = load('app/api/auth/password-recovery/route.ts');
      assert.equal((await POST(request(undefined, {}, { origin: 'https://attacker.test' }))).status, 403);
      assert.equal((await POST(request(undefined, { email: 'invalid' }))).status, 400);
      assert.equal(calls, 0);
      const response = await POST(request());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
      assert.equal(calls, 1);
    });
  }
});

test('网络中断与 HTTP500/429 分开诊断，不暴露邮箱/原始错误，不自动重发', async () => {
  const warn = console.warn, error = console.error;
  const logs = [];
  console.warn = (...values) => logs.push(values);
  console.error = () => {};
  try {
    for (const [status, diagnostic] of [[0, 'server_supabase_network_error'], [500, 'supabase_auth_server_error'], [429, 'auth_rate_limit']]) {
      let calls = 0;
      await withProvider(async () => {
        calls++;
        if (!status) throw new TypeError('private credentials and email must not appear in response');
        return json({ code: 'unexpected_failure', msg: 'private credentials and email' }, status);
      }, async load => {
        const response = await load('app/api/auth/password-recovery/route.ts').POST(request());
        const result = await response.json();
        assert.equal(result.ok, false);
        assert.match(result.diagnostic, new RegExp(diagnostic));
        assert.doesNotMatch(JSON.stringify(result), /credentials|parent@example/);
        assert.equal(calls, 1);
      });
    }
    assert.doesNotMatch(JSON.stringify(logs), /credentials|parent@example/);
  } finally { console.warn = warn; console.error = error; }
});

test('上游超时有独立诊断且只调用一次，不等待重试循环', async () => {
  const timeout = AbortSignal.timeout;
  const warn = console.warn, error = console.error;
  AbortSignal.timeout = () => AbortSignal.abort();
  console.warn = () => {};
  console.error = () => {};
  try {
    let calls = 0;
    await withProvider(async (input, init) => {
      calls++;
      assert.equal(init.signal.aborted, true);
      throw new DOMException('aborted', 'AbortError');
    }, async load => {
      const response = await load('app/api/auth/password-recovery/route.ts').POST(request());
      assert.equal(response.status, 504);
      assert.match((await response.json()).diagnostic, /server_supabase_timeout/);
      assert.equal(calls, 1);
    });
  } finally { AbortSignal.timeout = timeout; console.warn = warn; console.error = error; }
});

test('未登录不能保存密码；有会话也必须先经 getUser 验证；改密后清理失败不谎报密码失败', async () => {
  const emptyCookies = [];
  const scenarios = [
    { user: null, error: null, expected: 401, updates: 0 },
    { user: { id: 'test-user' }, error: null, expected: 200, updates: 1 },
    { user: null, error: { name: 'AuthRetryableFetchError', status: 0 }, expected: 503, updates: 0 },
  ];
  for (const scenario of scenarios) {
    let updates = 0;
    const load = loader({ '@/lib/password-flow-server': {
      ...loader()('lib/password-flow-server.ts'),
      createPasswordFlowClient: () => ({ cookies: emptyCookies, timedOut: () => false, supabase: {
        auth: {
          getUser: async () => ({ data: { user: scenario.user }, error: scenario.error }),
          updateUser: async () => { updates++; return { error: null }; },
          signOut: async () => { throw new Error('cleanup failed'); },
        },
        rpc: async () => { throw new Error('old schema'); },
      } }),
    } });
    const response = await load('app/api/auth/password-reset/route.ts').POST(request('password-reset', { password: 'test-password-123', confirmation: 'test-password-123' }));
    assert.equal(response.status, scenario.expected);
    assert.equal(updates, scenario.updates);
    if (scenario.expected === 200) assert.deepEqual(await response.json(), { ok: true, message: '密码已经修改成功，请使用新密码登录。', sessionsRevoked: false });
  }
});

test('真实 Auth SDK 模拟恢复会话→改密→清首次改密标记→全局退出，HTTP Cookie 被清除', async () => {
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'parent@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {} };
  const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), role: 'authenticated' })).toString('base64url')}.test`;
  const calls = [];
  await withProvider(async (input, init) => {
    const url = new URL(String(input));
    calls.push([init.method, url.pathname, url.search]);
    if (url.pathname.endsWith('/verify')) return json({ access_token: token, refresh_token: 'fake-refresh-token', token_type: 'bearer', expires_in: 3600, user });
    if (url.pathname.endsWith('/user')) return json(user);
    if (url.pathname.endsWith('/complete_initial_password_change')) return json(null);
    if (url.pathname.endsWith('/logout')) return json({});
    assert.fail('unexpected provider call');
  }, async load => {
    const recovered = await load('app/auth/recovery/route.ts').GET(new NextRequest(`${origin}/auth/recovery?token_hash=fake-test-only-hash&type=recovery`));
    assert.equal(recovered.headers.get('location'), `${origin}/reset-password`);
    const cookie = recovered.cookies.getAll().map(c => `${c.name}=${c.value}`).join('; ');
    assert.ok(cookie.includes('auth-token'));
    const response = await load('app/api/auth/password-reset/route.ts').POST(request('password-reset', { password: 'test-password-123', confirmation: 'test-password-123' }, { cookie }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sessionsRevoked, true);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.deepEqual(calls.map(c => c[1]), ['/auth/v1/verify', '/auth/v1/user', '/auth/v1/user', '/rest/v1/rpc/complete_initial_password_change', '/auth/v1/logout']);
    assert.equal(calls.at(-1)[2], '?scope=global');
  });
});

test('客户端仅调用本站一次：HTML旧部署和网络失败均明确提示，不绕回浏览器直连', async () => {
  const original = global.fetch;
  try {
    let calls = 0;
    global.fetch = async (url, init) => { calls++; assert.equal(url, '/api/auth/password-recovery'); assert.equal(init.credentials, 'same-origin'); throw new TypeError('offline'); };
    const { postPasswordFlow } = loader()('lib/password-flow.ts');
    const result = await postPasswordFlow('/api/auth/password-recovery', { email: 'parent@example.test' });
    assert.equal(result.diagnostic, 'website_network_error');
    assert.equal(result.retryAfter, 60);
    assert.equal(calls, 1);
    global.fetch = async () => new Response('<html>old deployment</html>', { status: 404 });
    assert.match((await postPasswordFlow('/api/auth/password-recovery', {})).message, /Vercel/);
  } finally { global.fetch = original; }
  for (const file of ['components/forgot-password-form.tsx', 'components/reset-password-form.tsx']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /@\/lib\/supabase\/client|resetPasswordForEmail|auth\.updateUser/);
  }
});
