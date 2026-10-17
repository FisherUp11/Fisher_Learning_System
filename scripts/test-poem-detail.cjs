/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToPipeableStream, renderToStaticMarkup } = require('react-dom/server');
const { PassThrough } = require('node:stream');
const root = path.join(__dirname, '..');
const poemId = '10000000-0000-4000-8000-000000000001';
const learnerId = '20000000-0000-4000-8000-000000000001';
const poem = { id: poemId, poem_key: 'p1', title: '静夜思', author: '李白', dynasty: '唐', content: '床前明月光，\n疑是地上霜。' };

function load(file, overrides = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  const resolve = id => {
    if (id in overrides) return overrides[id];
    if (id === 'server-only') return {};
    if (id.startsWith('@/')) return load(`${id.slice(2)}.ts`, overrides);
    return require(id);
  };
  new Function('module', 'exports', 'require', code)(loaded, loaded.exports, resolve);
  return loaded.exports;
}

function query(data, error = null, calls = []) {
  const chain = { then: (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject) };
  for (const method of ['select', 'eq', 'order', 'range', 'limit', 'maybeSingle']) {
    chain[method] = (...args) => { calls.push([method, ...args]); return chain; };
  }
  return chain;
}

test('单首诗正文只查目标诗及孩子活跃分配，不读取整册或历史；来源顺序稳定且去重', async () => {
  const { loadPoemDetail } = load('lib/poem-detail.ts');
  const calls = [];
  const rows = [
    { collection_id: 'b', sequence: 9, poems: poem, poem_collections: { title: '第二册' } },
    { collection_id: 'a', sequence: 1, poems: poem, poem_collections: { title: '第一册' } },
    { collection_id: 'c', sequence: 2, poems: poem, poem_collections: { title: '第一册' } },
  ];
  const db = { from: table => { assert.equal(table, 'poem_collection_items'); return query(rows, null, calls); }, rpc: () => assert.fail('正文不应等待汇总 RPC') };
  const detail = await loadPoemDetail(db, learnerId, poemId);
  assert.equal(detail.content, poem.content);
  assert.deepEqual(detail.sourceTitles, ['第一册', '第二册']);
  for (const filter of [['eq', 'poem_id', poemId], ['eq', 'poem_collections.learner_poem_collections.learner_id', learnerId], ['eq', 'poem_collections.learner_poem_collections.assignment_status', 'active']]) assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(filter)));
  assert.deepEqual(calls.find(call => call[0] === 'range'), ['range', 0, 499]);
  assert.equal(await loadPoemDetail({ from: () => query([]) }, learnerId, poemId), null);
  await assert.rejects(loadPoemDetail({ from: () => query(null, { message: 'network error' }) }, learnerId, poemId), /network error/);
});

test('汇总故障不变成零次；视频失败与旧字段缺失分别处理', async () => {
  const { loadPoemSummary, loadPoemVideo } = load('lib/poem-detail.ts');
  await assert.rejects(loadPoemSummary({ rpc: async () => ({ data: null, error: { message: 'failed' } }) }, learnerId, poemId), /036/);
  assert.equal((await loadPoemSummary({ rpc: async () => ({ data: [], error: null }) }, learnerId, poemId)).attemptCount, 0);
  assert.deepEqual(await loadPoemVideo({ from: () => query(null, { message: 'column music_video_url does not exist' }) }, poemId), { url: null, setupMissing: true });
  await assert.rejects(loadPoemVideo({ from: () => query(null, { message: 'network error' }) }, poemId), /视频链接暂时读取失败/);
  assert.equal((await loadPoemVideo({ from: () => query({ music_video_url: 'javascript:alert(1)' }) }, poemId)).url, null);
});

test('真实 Supabase SDK 请求只携带当前诗、孩子及活跃分配筛选（模拟 HTTP，不冒充真实 REST）', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const { loadPoemDetail } = load('lib/poem-detail.ts');
  const requests = [];
  const db = createClient('https://example.supabase.co', 'test-only-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      requests.push(new URL(String(input)));
      return new Response(JSON.stringify([{ collection_id: 'a', sequence: 1, poems: poem, poem_collections: { title: '第一册' } }]), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  assert.equal((await loadPoemDetail(db, learnerId, poemId)).id, poemId);
  assert.equal(requests.length, 1);
  const url = requests[0];
  assert.equal(url.pathname, '/rest/v1/poem_collection_items');
  assert.equal(url.searchParams.get('poem_id'), `eq.${poemId}`);
  assert.equal(url.searchParams.get('poem_collections.learner_poem_collections.learner_id'), `eq.${learnerId}`);
  assert.equal(url.searchParams.get('poem_collections.learner_poem_collections.assignment_status'), 'eq.active');
  assert.match(url.searchParams.get('select'), /poems!inner/);
  assert.match(url.searchParams.get('select'), /poem_collections!inner.*learner_poem_collections!inner/);
  assert.equal(url.searchParams.get('limit'), '500');
});

function pageWith({ blocked = false, detail = { ...poem, sourceTitles: ['第一册'] }, sections = {} } = {}) {
  let reads = 0;
  const defaults = {
    PoemSummaryLoading: () => React.createElement('p', null, '统计读取中'),
    PoemHistoryLoading: () => React.createElement('p', null, '历史读取中'),
    PoemDetailSummary: () => React.createElement('p', null, '背诵统计'),
    PoemDetailHistory: () => React.createElement('p', null, '历史记录'),
    PoemVideoLink: () => null,
    PoemVideoManagement: () => null,
  };
  const page = load('app/(app)/poems/[poemId]/page.tsx', {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { redirect: value => { throw new Error(`redirect:${value}`); } },
    '@/lib/supabase/page-client': { createPageClient: async () => ({ from: () => query({ id: learnerId, display_name: '测试孩子' }) }), getPageUser: async () => ({ id: 'parent' }) },
    '@/lib/access': { loadAccessContext: async () => ({ isAdmin: true }) },
    '@/lib/module-access': { requireChildModule: async () => { if (blocked) throw new Error('未开通'); } },
    '@/lib/poem-detail': { loadPoemDetail: async () => { reads++; return detail; } },
    '@/components/poem-recitation-form': { PoemRecitationForm: () => React.createElement('button', null, '今天背过一次') },
    '@/components/poem-detail-sections': { ...defaults, ...sections },
  }).default;
  return { render: () => page({ params: Promise.resolve({ poemId }), searchParams: Promise.resolve({ learner: learnerId }) }), reads: () => reads };
}

test('孩子模块未开通时不读取正文；未分配诗词不呈现打卡入口', async () => {
  const blocked = pageWith({ blocked: true });
  assert.match(renderToStaticMarkup(await blocked.render()), /暂未开通诗词背诵/);
  assert.equal(blocked.reads(), 0);
  const missing = pageWith({ detail: null });
  const html = renderToStaticMarkup(await missing.render());
  assert.match(html, /没有找到这首诗/);
  assert.doesNotMatch(html, /今天背过一次/);
});

test('真实 React 流式渲染：统计/历史/视频仍等待时，正文和打卡已经输出', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const slow = text => async () => { await gate; return React.createElement('p', null, text); };
  const page = pageWith({ sections: { PoemDetailSummary: slow('统计完成'), PoemDetailHistory: slow('历史完成'), PoemVideoLink: slow('视频完成') } });
  const element = await page.render();
  const output = new PassThrough();
  let html = '';
  output.on('data', chunk => { html += chunk.toString(); });
  const ended = new Promise((resolve, reject) => { output.on('end', resolve); output.on('error', reject); });
  let stream;
  try {
    await new Promise((resolve, reject) => {
      stream = renderToPipeableStream(element, { onShellReady() { stream.pipe(output); resolve(); }, onShellError: reject, onError: reject });
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(html, /静夜思/);
    assert.match(html, /床前明月光/);
    assert.match(html, /今天背过一次/);
    assert.match(html, /统计读取中/);
    assert.doesNotMatch(html, /统计完成|历史完成|视频完成/);
    release();
    await ended;
    assert.match(html, /统计完成/);
    assert.match(html, /历史完成/);
  } finally { release(); stream?.abort(); }
});

test('真实 Supabase REST 关联查询（显式开启的只读检查，不代表客户端权限验收）', { skip: process.env.FISHER_LIVE_READONLY !== '1' }, async () => {
  process.loadEnvFile(path.join(root, '.env.local'));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  assert.equal(new URL(url).hostname, 'hodhbakqdmyahymyhjss.supabase.co', '目标项目必须核对');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(key, '没有服务端键，无法执行真实只读测试；不会打印凭据');
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from('learner_poem_collections').select('learner_id,poem_collections!inner(poem_collection_items!inner(poem_id))').eq('assignment_status', 'active').limit(1).single();
  assert.equal(error, null, '读取已分配诗词失败');
  const id = data.poem_collections.poem_collection_items[0].poem_id;
  const { loadPoemDetail } = load('lib/poem-detail.ts');
  const detail = await loadPoemDetail(db, data.learner_id, id);
  assert.equal(detail.id, id);
  assert.ok(detail.sourceTitles.length > 0);
  assert.equal(await loadPoemDetail(db, data.learner_id, 'ffffffff-ffff-4fff-8fff-ffffffffffff'), null);
});
