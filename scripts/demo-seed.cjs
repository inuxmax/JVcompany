// Dữ liệu demo tiếng Anh cho ảnh chụp README / GitHub Pages: một công ty đang chạy 3 dự án (tầng 1–3), có hội thoại,
// chuỗi bàn giao, phê duyệt chờ duyệt, chi phí 14 ngày, mục tiêu, lịch định kỳ, kỹ năng. Chỉ ghi vào CSDL có đuôi "_demo"
// (xoá sạch rồi tạo lại) – không bao giờ đụng CSDL thật. Chạy app trên CSDL này với worker tắt để không agent nào chạy:
//
//   node scripts/demo-seed.cjs                       (mặc định jvcompany_demo)
//   MONGODB_DB=jvcompany_demo JVCOMPANY_WORKER=off npm run dev
//   npx electron scripts/guide-screenshots.cjs
const { MongoClient, ObjectId } = require('mongodb');

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB = process.argv[2] || 'jvcompany_demo';
if (!DB.endsWith('_demo')) {
  console.error(`Từ chối: "${DB}" không có đuôi _demo – script này xoá CSDL trước khi tạo lại.`);
  process.exit(1);
}

const id = () => new ObjectId().toHexString();
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60_000).toISOString();

async function main() {
  const client = await MongoClient.connect(URI);
  const db = client.db(DB);
  await db.dropDatabase();
  const col = (n) => db.collection(n);

  await col('companies').insertOne({
    _id: 'main',
    name: 'JVCompany',
    mission: 'Ship delightful software with an AI-native team.',
    issuePrefix: 'JV',
    issueCounter: 27,
    status: 'active',
    pauseReason: null,
    budgetMonthlyUsd: 400,
    requireApprovalForNewAgents: false,
    onboardedAt: ago(60 * 24 * 12),
    createdAt: ago(60 * 24 * 12),
    updatedAt: ago(30),
  });

  // Kết nối AI (không có khoá thật)
  const CLAUDE = id();
  const OPENAI = id();
  const DEEPSEEK = id();
  await col('providers').insertMany([
    {
      _id: CLAUDE, name: 'Claude Code (subscription)', type: 'claude-code', kind: 'cli', enabled: true, command: 'claude', baseUrl: '',
      defaultModel: 'claude-opus-5-5', models: ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
      status: { ok: true, message: 'Agent replied: "hello"', checkedAt: ago(40), version: '2.1.314 (Claude Code)' },
      createdAt: ago(60 * 24 * 12), updatedAt: ago(40), cooldownUntil: null, extraArgs: [], promptMode: 'stdin', webUrl: '',
      authMode: 'subscription', cwd: '', options: { maxTurns: 0, chrome: false, ignoreHostApiKey: true }, timeoutSec: 0,
    },
    {
      _id: OPENAI, name: 'OpenAI API', type: 'openai', kind: 'api', enabled: true, baseUrl: 'https://api.openai.com/v1', apiKey: '',
      command: '', extraArgs: [], promptMode: 'stdin', webUrl: '', defaultModel: 'gpt-5', models: ['gpt-5', 'gpt-5-mini'],
      status: { ok: true, message: 'Connected · 2 models available', checkedAt: ago(55) }, cooldownUntil: null,
      createdAt: ago(60 * 24 * 10), updatedAt: ago(55),
    },
    {
      _id: DEEPSEEK, name: 'DeepSeek API', type: 'deepseek', kind: 'api', enabled: true, baseUrl: 'https://api.deepseek.com/v1', apiKey: '',
      command: '', extraArgs: [], promptMode: 'stdin', webUrl: '', defaultModel: 'deepseek-v4-pro', models: ['deepseek-v4-pro', 'deepseek-flash'],
      status: { ok: true, message: 'Connected · 2 models available', checkedAt: ago(70) }, cooldownUntil: null,
      createdAt: ago(60 * 24 * 9), updatedAt: ago(70),
    },
  ]);

  // Dự án
  const project = (o) => ({
    goal: '', status: 'active', workflowId: 'director', currentPhase: 'direct', phaseState: 'working', phaseTaskId: null, approvals: {},
    phaseAttempts: {}, phaseSummaries: {}, completedPhases: [], autopilot: true, permission: 'auto', blockedReason: null, completedAt: null,
    queuedAt: null, pendingRequest: null, ...o,
  });
  const P1 = id();
  const P2 = id();
  const P3 = id();
  const P4 = id();
  const projects = [
    project({
      _id: P1, name: 'Bean & Bloom ordering app', path: 'D:\\projects\\bean-and-bloom', floorId: 'floor-1',
      description: 'Mobile-first ordering web app for the Bean & Bloom coffee shop: menu with photos, cart, pick-up time and Stripe checkout.',
      createdAt: ago(190), updatedAt: ago(2), startedAt: ago(190),
    }),
    project({
      _id: P2, name: 'Marketing site redesign', path: 'D:\\projects\\jv-website', floorId: 'floor-2',
      description: 'Refresh the marketing site with a new visual identity, faster pages and a pricing calculator.',
      createdAt: ago(320), updatedAt: ago(9), startedAt: ago(320),
    }),
    project({
      _id: P3, name: 'Pulse analytics API', path: 'D:\\projects\\pulse-analytics', floorId: 'floor-3', phaseState: 'awaiting_user',
      description: 'Event ingestion service and /v1/metrics endpoints for the internal analytics dashboard.',
      createdAt: ago(600), updatedAt: ago(14), startedAt: ago(600),
    }),
    project({
      _id: P4, name: 'Pricing page A/B test', path: 'D:\\projects\\jv-website', floorId: null, status: 'completed', phaseState: 'done',
      description: 'Two pricing page variants with analytics events and a results summary.',
      completedPhases: ['direct'], createdAt: ago(60 * 24 * 3), updatedAt: ago(60 * 24 * 2), startedAt: ago(60 * 24 * 3), completedAt: ago(60 * 24 * 2),
    }),
  ];
  await col('projects').insertMany(projects);

  await col('floors').insertMany(
    [1, 2, 3, 4, 5].map((n) => {
      const p = projects.find((x) => x.floorId === `floor-${n}`);
      return { _id: `floor-${n}`, number: n, name: `Tầng ${n}`, enabled: true, projectId: p?._id ?? null, assignedAt: p ? p.startedAt : null, updatedAt: ago(5) };
    }),
  );

  // Nhiệm vụ: chuỗi bàn giao do giám đốc tầng lập
  let seq = 0;
  const tasks = [];
  const task = (o) => {
    const t = {
      _id: id(), parentId: null, depth: 1, kind: 'delegated', assignedBy: 'director', phase: 'direct', priority: 'normal', waitForChildren: false,
      round: 1, attempts: 1, retryAt: null, error: null, decision: null, identifier: `JV-${++seq}`, labels: [], dependsOn: [],
      providerId: CLAUDE, providerName: 'Claude Code (subscription)', model: 'sonnet', liveText: null, manualPrompt: null, output: '', result: '',
      createdAt: ago(180), updatedAt: ago(3), startedAt: null, finishedAt: null, ...o,
    };
    tasks.push(t);
    return t;
  };
  const lead1 = task({ projectId: P1, kind: 'phase', depth: 0, assignedBy: 'user', departmentId: 'director', status: 'waiting_children', waitForChildren: true, model: 'opus',
    title: 'Plan and coordinate: Bean & Bloom ordering app', instructions: projects[0].description, startedAt: ago(188) });
  const b1 = task({ projectId: P1, parentId: lead1._id, departmentId: 'studio', status: 'done', permission: 'write', labels: ['design'],
    title: 'B1 · Design the ordering flow (menu → cart → pick-up → pay)', instructions: 'Wireframes and design tokens for a mobile-first ordering flow.',
    result: 'Ordering flow designed: 5 screens, design tokens and an accessible colour palette. Spec saved as "Ordering flow spec".',
    startedAt: ago(170), finishedAt: ago(120), usage: { inputTokens: 182000, outputTokens: 21400, costUsd: 1.84 } });
  const b2 = task({ projectId: P1, parentId: lead1._id, departmentId: 'dev', status: 'running', permission: 'auto', priority: 'high', dependsOn: [b1._id], labels: ['frontend'],
    title: 'B2 · Build the Next.js app from the Studio design', instructions: 'Implement menu, cart, pick-up time and Stripe Checkout.',
    liveText: 'Wiring Stripe Checkout: created /api/checkout and the success page…', startedAt: ago(118), lastOutputAt: ago(1), model: 'opus' });
  const b3 = task({ projectId: P1, parentId: lead1._id, departmentId: 'tester', status: 'waiting_deps', dependsOn: [b2._id],
    title: 'B3 · Test the ordering flow on mobile and desktop', instructions: 'Playwright tests for the happy path, empty cart, sold-out items and payment failure.' });
  const b4 = task({ projectId: P1, parentId: lead1._id, departmentId: 'bugfix', status: 'waiting_deps', dependsOn: [b3._id],
    title: 'B4 · Fix the bugs reported by Test', instructions: 'Fix every failing test from B3 and add regression tests.' });
  task({ projectId: P1, parentId: lead1._id, departmentId: 'qa', status: 'waiting_deps', dependsOn: [b4._id], permission: 'read',
    title: 'B5 · Review and approve the release', instructions: 'Code review, accessibility check and final approval.' });

  const lead2 = task({ projectId: P2, kind: 'phase', depth: 0, assignedBy: 'user', departmentId: 'director', status: 'waiting_children', waitForChildren: true, model: 'opus',
    title: 'Plan and coordinate: Marketing site redesign', instructions: projects[1].description, startedAt: ago(318) });
  const m1 = task({ projectId: P2, parentId: lead2._id, departmentId: 'meeting', status: 'done', permission: 'read',
    title: 'B1 · Collect requirements and success metrics', instructions: 'Interview notes, target audience and KPIs.',
    result: 'Requirements ready: 3 personas, 5 key pages, target LCP < 1.5 s.', startedAt: ago(300), finishedAt: ago(250), usage: { inputTokens: 90000, outputTokens: 9000, costUsd: 0.62 } });
  const m2 = task({ projectId: P2, parentId: lead2._id, departmentId: 'studio', status: 'running', permission: 'write', dependsOn: [m1._id], labels: ['design'],
    title: 'B2 · New visual identity and page designs', instructions: 'Moodboard, typography, colour system and page layouts.',
    liveText: 'Exploring two type pairings for headings…', startedAt: ago(240), lastOutputAt: ago(2) });
  const m3 = task({ projectId: P2, parentId: lead2._id, departmentId: 'dev', status: 'waiting_deps', dependsOn: [m2._id],
    title: 'B3 · Rebuild pages with the new design system', instructions: 'Static export, image optimisation, pricing calculator.' });
  task({ projectId: P2, parentId: lead2._id, departmentId: 'engineering', status: 'running', permission: 'auto', labels: ['infra'],
    title: 'B4 · Set up preview deployments', instructions: 'Preview URL for every pull request.', liveText: 'Configuring the preview workflow…', startedAt: ago(60), lastOutputAt: ago(4), model: 'haiku', dependsOn: [] });
  void m3;

  const lead3 = task({ projectId: P3, kind: 'phase', depth: 0, assignedBy: 'user', departmentId: 'director', status: 'waiting_children', waitForChildren: true, model: 'opus',
    title: 'Plan and coordinate: Pulse analytics API', instructions: projects[2].description, startedAt: ago(598) });
  const a1 = task({ projectId: P3, parentId: lead3._id, departmentId: 'engineering', status: 'done', permission: 'write', labels: ['backend'],
    title: 'B1 · Design the event ingestion schema', instructions: 'Event model, partitioning and retention.',
    result: 'Schema approved: events table partitioned by day, 90-day retention, rollups every 5 minutes.', startedAt: ago(560), finishedAt: ago(420), usage: { inputTokens: 140000, outputTokens: 16000, costUsd: 1.21 } });
  const a2 = task({ projectId: P3, parentId: lead3._id, departmentId: 'dev', status: 'waiting_approval', permission: 'write', dependsOn: [a1._id], priority: 'high', labels: ['backend'],
    title: 'B2 · Implement the /v1/metrics endpoints', instructions: 'Query API with filters, pagination and caching.', startedAt: ago(400), lastOutputAt: ago(14) });
  task({ projectId: P3, parentId: lead3._id, departmentId: 'tester', status: 'waiting_deps', dependsOn: [a2._id],
    title: 'B3 · Load-test the metrics API', instructions: 'k6 load test at 500 req/s, p95 < 200 ms.' });

  const lead4 = task({ projectId: P4, kind: 'phase', depth: 0, assignedBy: 'user', departmentId: 'director', status: 'done', waitForChildren: true, model: 'opus',
    title: 'Plan and coordinate: Pricing page A/B test', instructions: projects[3].description, startedAt: ago(4300), finishedAt: ago(2900),
    result: 'Both variants shipped behind a flag; variant B converts 18% better after 2,400 visits.' });
  for (const [dept, title] of [
    ['studio', 'B1 · Design pricing variant B'],
    ['dev', 'B2 · Implement variants behind a feature flag'],
    ['tester', 'B3 · Verify analytics events'],
    ['qa', 'B4 · Review and approve'],
  ]) {
    task({ projectId: P4, parentId: lead4._id, departmentId: dept, status: 'done', title, instructions: title, result: 'Done.', startedAt: ago(4200), finishedAt: ago(3000) });
  }
  for (const [pid, lead] of [[P1, lead1], [P2, lead2], [P3, lead3], [P4, lead4]]) {
    await col('projects').updateOne({ _id: pid }, { $set: { phaseTaskId: lead._id } });
  }
  await col('tasks').insertMany(tasks);

  // Hội thoại dự án 1
  const msg = (projectId, min, author, kind, content, extra = {}) => ({ _id: id(), projectId, taskId: null, author, kind, content, meta: null, createdAt: ago(min), ...extra });
  const you = { type: 'user' };
  const sys = { type: 'system' };
  const dep = (departmentId) => ({ type: 'agent', departmentId });
  await col('messages').insertMany([
    msg(P1, 190, you, 'chat', 'Build an ordering web app for our coffee shop “Bean & Bloom”: menu with photos, cart, pick-up time and Stripe checkout. Mobile first, please.'),
    msg(P1, 189, { type: 'agent', role: 'ceo', name: 'CEO' }, 'chat', 'Floor 1 is free — I handed **Bean & Bloom ordering app** to the Floor 1 director.'),
    msg(P1, 186, dep('director'), 'report', [
      '**Plan** — five steps, each starts automatically when the previous one is done:',
      '',
      '1. **B1 · Studio** — ordering flow and design tokens',
      '2. **B2 · Dev** — Next.js app, cart and Stripe Checkout *(after B1)*',
      '3. **B3 · Test** — Playwright tests on mobile and desktop *(after B2)*',
      '4. **B4 · Fix Bug** — fix what Test reports *(after B3)*',
      '5. **B5 · QA** — review and approve the release *(after B4)*',
      '',
      'Permissions: Studio *read & write*, Dev *auto inside project*, QA *read-only*.',
    ].join('\n'), { taskId: lead1._id, meta: { title: 'Plan', decision: null, delegated: 5, round: 1 } }),
    msg(P1, 185, dep('director'), 'delegation', 'B1 · Design the ordering flow (menu → cart → pick-up → pay)', { taskId: b1._id, to: 'studio' }),
    msg(P1, 121, dep('studio'), 'report', 'B1 done: 5 screens (menu, item, cart, pick-up time, payment), design tokens and an accessible colour palette. Full spec in **Ordering flow spec**.', { taskId: b1._id, meta: { title: 'B1 report', decision: null, delegated: 0, round: 1 } }),
    msg(P1, 119, sys, 'system', 'B2 · Dev started automatically with the Studio design attached.'),
    msg(P1, 64, dep('dev'), 'chat', 'Menu, item pages and the cart are done (12 components, 31 unit tests passing). Starting the pick-up time picker.', { taskId: b2._id }),
    msg(P1, 12, you, 'chat', 'Can we also offer oat and almond milk as options?'),
    msg(P1, 11, dep('dev'), 'chat', 'Sure — I added a **Milk** option group (whole, oat, almond, +$0.60) to drinks. It shows in the cart and on the receipt.', { taskId: b2._id }),
    msg(P1, 2, dep('dev'), 'thought', 'Wiring Stripe Checkout: created /api/checkout and the success page…', { taskId: b2._id }),
    msg(P2, 320, you, 'chat', 'Redesign our marketing site: new visual identity, faster pages and a pricing calculator.'),
    msg(P2, 250, dep('meeting'), 'report', 'Requirements ready: 3 personas, 5 key pages, target LCP < 1.5 s.', { taskId: m1._id, meta: { title: 'B1 report', decision: null, delegated: 0, round: 1 } }),
    msg(P3, 600, you, 'chat', 'Build the event ingestion service and /v1/metrics endpoints for the analytics dashboard.'),
    msg(P3, 420, dep('engineering'), 'report', 'Schema approved: events partitioned by day, 90-day retention, rollups every 5 minutes.', { taskId: a1._id, meta: { title: 'B1 report', decision: null, delegated: 0, round: 1 } }),
    msg(P3, 14, dep('dev'), 'approval', 'I need to run `npm install @clickhouse/client` to query the events store.', { taskId: a2._id }),
  ]);

  await col('artifacts').insertMany([
    { _id: id(), projectId: P1, taskId: b1._id, departmentId: 'studio', title: 'Ordering flow spec', type: 'design', phase: 'direct', createdAt: ago(121),
      content: '# Ordering flow spec\n\n1. Menu – categories, photos, sold-out badges\n2. Item – size, milk, extra shot\n3. Cart – edit, notes\n4. Pick-up time – next 15-minute slots\n5. Payment – Stripe Checkout\n' },
    { _id: id(), projectId: P3, taskId: a1._id, departmentId: 'engineering', title: 'Event schema', type: 'plan', phase: 'direct', createdAt: ago(420),
      content: '# Event schema\n\n| field | type |\n|---|---|\n| ts | DateTime |\n| name | LowCardinality(String) |\n| props | JSON |\n' },
  ]);

  // Phê duyệt đang chờ
  await col('approvals').insertMany([
    { _id: id(), projectId: P3, taskId: a2._id, departmentId: 'dev', type: 'shell', title: 'Run command: npm install @clickhouse/client',
      detail: 'Dev needs the ClickHouse client to implement the /v1/metrics endpoints.', payload: { command: 'npm install @clickhouse/client', cwd: 'D:\\projects\\pulse-analytics' },
      status: 'pending', createdAt: ago(14), resolvedAt: null, note: '' },
    { _id: id(), projectId: P2, taskId: null, departmentId: 'director', type: 'budget_override', title: 'Raise the Studio budget to $80 / month',
      detail: 'Studio reached 92% of its monthly budget while exploring the new visual identity.', payload: { requestedBy: 'director', observed: 73.6, suggestedAmount: 80 },
      status: 'pending', createdAt: ago(35), resolvedAt: null, note: '' },
    { _id: id(), projectId: P1, taskId: b2._id, departmentId: 'dev', type: 'write', title: 'Write outside the project: D:\\shared\\brand\\logo.svg',
      detail: 'Copy the Bean & Bloom logo into the app.', payload: { path: 'D:\\shared\\brand\\logo.svg' }, status: 'approved', createdAt: ago(90), resolvedAt: ago(88), note: '', scope: 'once' },
  ]);

  // Lượt chạy + chi phí 14 ngày
  const runs = [];
  const costs = [];
  const depts = ['director', 'studio', 'dev', 'dev', 'dev', 'engineering', 'tester', 'qa', 'meeting', 'bugfix'];
  const projs = [P1, P2, P3, P4];
  let r = 7;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let day = 13; day >= 0; day--) {
    const n = 3 + Math.floor(rnd() * 6);
    for (let k = 0; k < n; k++) {
      const minAgo = day * 1440 + Math.floor(rnd() * 1300) + 20;
      const viaApi = rnd() < 0.3;
      const prov = viaApi ? (rnd() < 0.5 ? { id: OPENAI, name: 'OpenAI API', type: 'openai', model: 'gpt-5' } : { id: DEEPSEEK, name: 'DeepSeek API', type: 'deepseek', model: 'deepseek-v4-pro' })
        : { id: CLAUDE, name: 'Claude Code (subscription)', type: 'claude-code', model: ['opus', 'sonnet', 'haiku'][Math.floor(rnd() * 3)] };
      const input = 20000 + Math.floor(rnd() * 160000);
      const output = 2000 + Math.floor(rnd() * 18000);
      const costUsd = Math.round((input * 3 + output * 15) / 1e6 * (prov.model === 'opus' ? 1.6 : prov.model === 'haiku' ? 0.35 : 1) * 1000) / 1000;
      const runId = id();
      const projectId = projs[Math.floor(rnd() * projs.length)];
      const departmentId = depts[Math.floor(rnd() * depts.length)];
      const billingType = viaApi ? 'api' : 'subscription';
      const usage = { inputTokens: input, outputTokens: output, cachedInputTokens: Math.floor(input * 0.4), costUsd };
      runs.push({ _id: runId, taskId: null, projectId, departmentId, providerId: prov.id, providerName: prov.name, providerType: prov.type, model: prov.model, attempt: 1,
        wakeReason: 'assigned', status: 'succeeded', billingType, usage, sessionBefore: null, sessionAfter: null, startedAt: ago(minAgo + 6), finishedAt: ago(minAgo),
        lastOutputAt: ago(minAgo), watchdog: null, error: null, excerpt: 'Done.' });
      costs.push({ _id: id(), runId, taskId: null, projectId, departmentId, providerType: prov.type, providerName: prov.name, model: prov.model, billingType,
        inputTokens: input, cachedInputTokens: usage.cachedInputTokens, outputTokens: output, costUsd, occurredAt: ago(minAgo) });
    }
  }
  await col('runs').insertMany(runs);
  await col('cost_events').insertMany(costs);

  // Mục tiêu
  const g1 = id();
  const g2 = id();
  await col('goals').insertMany([
    { _id: g1, title: 'Reach 1,000 paying customers in Q4', description: 'Company goal for the quarter.', level: 'company', status: 'active', parentId: null, ownerDepartmentId: 'director', createdAt: ago(60 * 24 * 10), updatedAt: ago(60 * 24) },
    { _id: g2, title: 'Launch the Bean & Bloom ordering app', description: 'First paying customer through online orders.', level: 'team', status: 'active', parentId: g1, ownerDepartmentId: 'dev', createdAt: ago(200), updatedAt: ago(20) },
    { _id: id(), title: 'New marketing site live with LCP < 1.5 s', description: 'Faster pages, clearer pricing.', level: 'team', status: 'active', parentId: g1, ownerDepartmentId: 'studio', createdAt: ago(330), updatedAt: ago(40) },
    { _id: id(), title: 'Metrics API p95 under 200 ms', description: 'Measured with k6 at 500 req/s.', level: 'agent', status: 'planned', parentId: g1, ownerDepartmentId: 'engineering', createdAt: ago(610), updatedAt: ago(610) },
    { _id: id(), title: 'Pricing page converts 15% better', description: 'A/B test on the pricing page.', level: 'team', status: 'achieved', parentId: g1, ownerDepartmentId: 'studio', createdAt: ago(4400), updatedAt: ago(2900) },
  ]);

  // Lịch định kỳ
  const routine = (o) => ({ _id: id(), projectId: null, priority: 'normal', status: 'active', concurrency: 'skip_if_active', catchUp: 'skip_missed', variables: [], revision: 1,
    lastTriggeredAt: ago(60 * 20), createdAt: ago(60 * 24 * 8), updatedAt: ago(60 * 24 * 2), ...o });
  await col('routines').insertMany([
    routine({ title: 'Daily dependency audit', instructions: 'Check every project for outdated or vulnerable dependencies and open a task for each finding.', departmentId: 'engineering',
      triggers: [{ id: 't1', kind: 'schedule', enabled: true, cron: '0 9 * * 1-5', timezone: 'UTC', nextRunAt: new Date(NOW + 9 * 3600_000).toISOString(), lastFiredAt: ago(60 * 15) }] }),
    routine({ title: 'Weekly regression run', instructions: 'Run the full Playwright suite on every active project and report failures.', departmentId: 'tester', projectId: P1,
      triggers: [{ id: 't1', kind: 'schedule', enabled: true, cron: '0 14 * * 5', timezone: 'UTC', nextRunAt: new Date(NOW + 3 * 86400_000).toISOString(), lastFiredAt: ago(60 * 24 * 4) }] }),
    routine({ title: 'Post-deploy smoke test', instructions: 'After each deploy, smoke-test the release on {{url}} and report.', departmentId: 'qa', concurrency: 'coalesce_if_active',
      variables: [{ name: 'url', label: 'URL', type: 'text', default: 'https://beanandbloom.example' }],
      triggers: [{ id: 't1', kind: 'webhook', enabled: true, publicId: 'rt_8f3k2q', signingMode: 'hmac_sha256', lastFiredAt: ago(60 * 7) }], webhookSecret: '' }),
  ]);

  // Kỹ năng
  const skill = (key, name, description, markdown) => ({ _id: id(), key, name, description, markdown, source: { type: 'manual' }, currentVersion: 1,
    versions: [{ version: 1, markdown, createdAt: ago(60 * 24 * 6) }], createdAt: ago(60 * 24 * 6), updatedAt: ago(60 * 24 * 6) });
  await col('skills').insertMany([
    skill('frontend-conventions', 'Frontend conventions', 'Next.js App Router, server components first, Tailwind, accessible components.',
      '---\nname: Frontend conventions\ndescription: Next.js App Router, server components first, Tailwind, accessible components.\n---\n\n- Server components by default\n- Every interactive element is keyboard accessible\n'),
    skill('release-checklist', 'Release checklist', 'Steps QA follows before approving a release.',
      '---\nname: Release checklist\ndescription: Steps QA follows before approving a release.\n---\n\n1. Typecheck, lint, tests green\n2. Lighthouse ≥ 90\n3. Changelog updated\n'),
    skill('api-design', 'API design guide', 'REST naming, pagination, errors and versioning rules.',
      '---\nname: API design guide\ndescription: REST naming, pagination, errors and versioning rules.\n---\n\n- Cursor pagination\n- RFC 9457 problem details\n'),
  ]);

  await col('activity').insertMany([
    { _id: id(), actorType: 'user', actorId: null, actorName: 'You', action: 'project.create', entityType: 'project', entityId: P1, projectId: P1, summary: 'Created project "Bean & Bloom ordering app"', details: null, createdAt: ago(190) },
    { _id: id(), actorType: 'agent', actorId: 'director', actorName: 'Director’s Office', action: 'task.delegate', entityType: 'task', entityId: b1._id, projectId: P1, summary: 'Delegated B1 · Design the ordering flow to Studio', details: null, createdAt: ago(185) },
    { _id: id(), actorType: 'user', actorId: null, actorName: 'You', action: 'approval.approve', entityType: 'approval', entityId: null, projectId: P1, summary: 'Approved writing D:\\shared\\brand\\logo.svg (once)', details: null, createdAt: ago(88) },
  ]);

  console.log(`✓ ${DB}: 4 dự án, ${tasks.length} nhiệm vụ, ${runs.length} lượt chạy`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
