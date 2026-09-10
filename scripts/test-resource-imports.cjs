/* eslint-disable @typescript-eslint/no-require-imports -- This CommonJS test loads transpiled server actions with isolated dependency mocks. */
/* Local-only integration regression: real import actions with an in-memory Data API.
 * No environment variables, credentials, network, or live database are used.
 * Run: node --test scripts/test-resource-imports.cjs
 * PostgreSQL RLS and locking still require deployed-database acceptance checks.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const roots = ["content_packages", "poem_collections", "catechism_collections"];
const constraints = {
  content_packages: ["created_by", "code"], poem_collections: ["created_by", "code"], catechism_collections: ["created_by", "code"],
  characters: ["workspace_id", "character"], poems: ["workspace_id", "poem_key"],
  package_characters: ["package_id", "character_id"], poem_collection_items: ["collection_id", "poem_id"], catechism_items: ["collection_id", "item_key"],
  learner_content_packages: ["learner_id", "package_id"], learner_poem_collections: ["learner_id", "collection_id"], learner_catechism_collections: ["learner_id", "collection_id"],
};
const itemRoots = { package_characters: ["content_packages", "package_id"], poem_collection_items: ["poem_collections", "collection_id"], catechism_items: ["catechism_collections", "collection_id"] };
const copy = (value) => structuredClone(value);
const at = (row, key) => key.split(".").reduce((value, part) => value?.[part], row);

function harness(role = "owner") {
  const context = { userId: "parent-a", workspaceId: "workspace-a", isAdmin: role !== "parent", isOwner: role === "owner", role };
  const tables = Object.fromEntries(Object.keys(constraints).map((table) => [table, []]));
  tables.learner_profiles = [
    { id: "child-a", parent_user_id: "parent-a", families: { workspace_id: "workspace-a" } },
    { id: "child-b", parent_user_id: "parent-a", families: { workspace_id: "workspace-a" } },
    { id: "other-family", parent_user_id: "parent-b", families: { workspace_id: "workspace-a" } },
    { id: "other-workspace", parent_user_id: "parent-a", families: { workspace_id: "workspace-b" } },
  ];
  const failures = [];
  const operations = [];
  let nextId = 0;

  function visible(table, row) {
    if (table === "learner_profiles") return context.isAdmin || row.parent_user_id === context.userId;
    if (roots.includes(table)) return row.workspace_id === context.workspaceId && (context.isAdmin || row.created_by === context.userId || row.review_status === "approved");
    if (itemRoots[table]) {
      const [parentTable, foreignKey] = itemRoots[table];
      const parent = tables[parentTable].find((item) => item.id === row[foreignKey]);
      return !!parent && visible(parentTable, parent);
    }
    return true;
  }

  function writable(table, row) {
    if (roots.includes(table)) return row.workspace_id === context.workspaceId && (context.isAdmin || (row.created_by === context.userId && row.status === "draft" && ["draft", "pending_review"].includes(row.review_status)));
    if (table.startsWith("learner_") && table !== "learner_profiles") return context.isAdmin;
    if (itemRoots[table]) {
      const [parentTable, foreignKey] = itemRoots[table];
      const parent = tables[parentTable].find((item) => item.id === row[foreignKey]);
      return !!parent && writable(parentTable, parent);
    }
    return true;
  }

  function query(table) {
    let operation = "select", payload, options = {}, selectOptions = {}, single = false, maybeSingle = false;
    const filters = [];
    let maximum = Infinity;
    const chain = {
      select(_fields, settings = {}) { selectOptions = settings; return chain; },
      insert(values) { operation = "insert"; payload = values; return chain; },
      upsert(values, settings = {}) { operation = "upsert"; payload = values; options = settings; return chain; },
      update(values) { operation = "update"; payload = values; return chain; },
      delete() { throw new Error("Imports must not delete existing books or shared learning data"); },
      eq(key, value) { filters.push((row) => at(row, key) === value); return chain; },
      in(key, values) { filters.push((row) => values.includes(at(row, key))); return chain; },
      order() { return chain; },
      limit(count) { maximum = count; return chain; },
      single() { single = true; return chain; },
      maybeSingle() { maybeSingle = true; return chain; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          operations.push({ table, operation });
          const failureIndex = failures.findIndex((failure) => failure.table === table && failure.operation === operation);
          if (failureIndex !== -1) {
            failures.splice(failureIndex, 1);
            return { data: null, error: { code: "TEST_FAILURE", message: "Injected temporary failure" }, count: null };
          }
          const matches = tables[table].filter((row) => visible(table, row) && filters.every((filter) => filter(row))).slice(0, maximum);
          let result = matches;
          if (operation === "insert" || operation === "upsert") {
            result = [];
            for (const value of Array.isArray(payload) ? payload : [payload]) {
              if (!writable(table, value)) return { data: null, error: { code: "42501", message: "RLS denied" } };
              const unique = constraints[table];
              const existing = unique && tables[table].find((row) => unique.every((key) => row[key] === value[key]));
              if (existing) {
                if (operation === "insert") return { data: null, error: { code: "23505", message: "Unique constraint" } };
                if (!options.ignoreDuplicates) Object.assign(existing, copy(value));
                continue;
              }
              const record = { id: `record-${++nextId}`, ...copy(value) };
              tables[table].push(record);
              result.push(record);
            }
          } else if (operation === "update") {
            result = matches.filter((row) => writable(table, row));
            for (const row of result) Object.assign(row, copy(payload));
          }
          if (selectOptions.head) return { count: result.length, data: null, error: null };
          if (single || maybeSingle) {
            if (result.length !== 1 && !(maybeSingle && result.length === 0)) return { data: null, error: { code: "PGRST116", message: "No single visible row" } };
            return { data: result[0] ? copy(result[0]) : null, error: null };
          }
          return { data: copy(result), error: null };
        }).then(resolve, reject);
      },
    };
    return chain;
  }

  const supabase = { from: query, auth: { getUser: async () => ({ data: { user: { id: context.userId } } }) } };
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const filename = path.join(root, relative);
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const fixtureModule = { exports: {} };
    cache.set(relative, fixtureModule.exports);
    const customRequire = (id) => {
      if (id === "@/lib/import-safety") return load("lib/import-safety.ts");
      if (id === "@/lib/supabase/server") return { createClient: async () => supabase };
      if (id === "@/lib/access") return { loadAccessContext: async () => context };
      if (id === "next/cache") return { revalidatePath: () => {} };
      if (id === "@/lib/reward-service" || id === "@/lib/catechism") return {};
      return require(id);
    };
    vm.runInNewContext(compiled, { module: fixtureModule, exports: fixtureModule.exports, require: customRequire, console: { error: () => {} }, File, FormData, crypto, Date, Map, Set }, { filename });
    return fixtureModule.exports;
  }
  const actions = load("lib/actions.ts");
  const catechism = load("lib/catechism-actions.ts");
  return { context, tables, failures, operations, actions, catechism };
}

const cases = [
  {
    name: "汉字", table: "content_packages", itemTable: "package_characters", assignmentTable: "learner_content_packages",
    makeForm: (child = "child-a") => {
      const form = new FormData();
      form.set("learner_id", child); form.set("package_title", "测试字册");
      form.set("csv_file", new File(["character,pinyin_marked,meaning,sequence\n天,tiān,天空,1\n地,dì,大地,2"], "test.csv"));
      return form;
    },
    run: (app, form) => app.actions.importCharacters(form),
  },
  {
    name: "诗词", table: "poem_collections", itemTable: "poem_collection_items", assignmentTable: "learner_poem_collections",
    makeForm: (child = "child-a") => {
      const form = new FormData();
      form.set("learner_id", child); form.set("poem_collection_title", "测试诗词册");
      form.set("poem_csv_file", new File(["poem_key,title,author,content,sequence\np1,春晓,孟浩然,春眠不觉晓\\n处处闻啼鸟,1\np2,静夜思,李白,床前明月光\\n疑是地上霜,2"], "test.csv"));
      return form;
    },
    run: (app, form) => app.actions.importPoems(form),
  },
  {
    name: "要理问答", table: "catechism_collections", itemTable: "catechism_items", assignmentTable: "learner_catechism_collections",
    makeForm: (child = "child-a") => {
      const form = new FormData();
      form.append("learner_ids", child); form.set("collection_title", "测试问答册"); form.set("publish_now", "on");
      form.set("catechism_csv_file", new File(["item_key,sequence,question_zh,question_en,answer_zh,answer_en\nq1,1,问题一,Question one,答案一,Answer one\nq2,2,问题二,Question two,答案二,Answer two"], "test.csv"));
      return form;
    },
    run: (app, form) => app.catechism.importCatechismCollection({ status: "idle", message: "" }, form),
  },
];

for (const scenario of cases) {
  test(`${scenario.name}: concurrent clicks produce one book and one assignment`, async () => {
    const app = harness();
    const results = await Promise.all(Array.from({ length: 4 }, () => scenario.run(app, scenario.makeForm())));
    for (const result of results) assert.notEqual(result.status, "error", result.message);
    assert.equal(app.tables[scenario.table].length, 1);
    assert.equal(app.tables[scenario.itemTable].length, 2);
    assert.equal(app.tables[scenario.assignmentTable].length, 1);
    assert.equal(app.tables[scenario.table][0].status, "published");
  });
  test(`${scenario.name}: retry for another child reuses content and preserves existing assignment`, async () => {
    const app = harness();
    await scenario.run(app, scenario.makeForm());
    const result = await scenario.run(app, scenario.makeForm("child-b"));
    assert.match(result.message, /相同内容已存在/);
    assert.equal(app.tables[scenario.table].length, 1);
    assert.equal(app.tables[scenario.assignmentTable].length, 2);
  });
  test(`${scenario.name}: failed content write remains unpublished and resumes same book`, async () => {
    const app = harness();
    app.failures.push({ table: scenario.itemTable, operation: "upsert" });
    const failed = await scenario.run(app, scenario.makeForm());
    assert.equal(failed.status, "error");
    const draftId = app.tables[scenario.table][0].id;
    assert.equal(app.tables[scenario.table][0].status, "draft");
    assert.equal(app.tables[scenario.assignmentTable].length, 0);
    const retried = await scenario.run(app, scenario.makeForm());
    assert.notEqual(retried.status, "error", retried.message);
    assert.equal(app.tables[scenario.table].length, 1);
    assert.equal(app.tables[scenario.table][0].id, draftId);
    assert.equal(app.tables[scenario.itemTable].length, 2);
    assert.equal(app.tables[scenario.table][0].status, "published");
  });
  test(`${scenario.name}: failed assignment keeps imported content and retries assignment`, async () => {
    const app = harness();
    app.failures.push({ table: scenario.assignmentTable, operation: "upsert" });
    assert.equal((await scenario.run(app, scenario.makeForm())).status, "error");
    const retried = await scenario.run(app, scenario.makeForm());
    assert.notEqual(retried.status, "error", retried.message);
    assert.equal(app.tables[scenario.table].length, 1);
    assert.equal(app.tables[scenario.itemTable].length, 2);
    assert.equal(app.tables[scenario.assignmentTable].length, 1);
  });
  test(`${scenario.name}: failure after items but before publication retries same complete draft`, async () => {
    const app = harness();
    app.failures.push({ table: scenario.table, operation: "update" });
    assert.equal((await scenario.run(app, scenario.makeForm())).status, "error");
    assert.equal(app.tables[scenario.itemTable].length, 2);
    assert.equal(app.tables[scenario.table][0].status, "draft");
    assert.equal(app.tables[scenario.assignmentTable].length, 0);
    const retried = await scenario.run(app, scenario.makeForm());
    assert.notEqual(retried.status, "error", retried.message);
    assert.equal(app.tables[scenario.table].length, 1);
    assert.equal(app.tables[scenario.table][0].status, "published");
  });
  test(`${scenario.name}: duplicate of archived resource cannot silently reactivate it`, async () => {
    const app = harness();
    await scenario.run(app, scenario.makeForm());
    app.tables[scenario.table][0].status = "archived";
    const result = await scenario.run(app, scenario.makeForm("child-b"));
    assert.match(result.message, /已归档/);
    assert.equal(app.tables[scenario.table][0].status, "archived");
    assert.equal(app.tables[scenario.table].length, 1);
    assert.equal(app.tables[scenario.assignmentTable].length, 1);
  });
  test(`${scenario.name}: reordered CSV rows with identical sequence stay duplicate`, async () => {
    const app = harness();
    await scenario.run(app, scenario.makeForm());
    const form = scenario.makeForm();
    for (const [key, value] of form.entries()) {
      if (!(value instanceof File)) continue;
      const [header, ...rows] = (await value.text()).split("\n");
      form.set(key, new File([[header, ...rows.reverse()].join("\n")], "renamed.csv"));
      break;
    }
    const result = await scenario.run(app, form);
    assert.match(result.message, /相同内容已存在/);
    assert.equal(app.tables[scenario.table].length, 1);
  });
  test(`${scenario.name}: parent submission cannot publish or assign and repeat stays pending`, async () => {
    const app = harness("parent");
    const result = await scenario.run(app, scenario.makeForm());
    assert.equal(result.status, "success", result.message);
    assert.equal(app.tables[scenario.table][0].status, "draft");
    assert.equal(app.tables[scenario.table][0].review_status, "pending_review");
    assert.equal(app.tables[scenario.assignmentTable].length, 0);
    const repeat = await scenario.run(app, scenario.makeForm());
    assert.match(repeat.message, /相同内容已存在/);
    assert.equal(app.tables[scenario.table].length, 1);
  });
  test(`${scenario.name}: inaccessible child and other workspace fail before resource creation`, async () => {
    const app = harness("parent");
    for (const child of ["other-family", "other-workspace"]) {
      assert.equal((await scenario.run(app, scenario.makeForm(child))).status, "error");
    }
    assert.equal(app.tables[scenario.table].length, 0);
  });
}
