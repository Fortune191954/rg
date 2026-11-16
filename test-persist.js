// 冒烟测试：刷新后身份与积分不丢（多通道存储 + URL 身份 + 云端恢复）
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeEl(){
  return {
    style:{}, textContent:'', innerHTML:'', value:'', disabled:false, className:'',
    appendChild(){}, remove(){}, addEventListener(){},
    getBoundingClientRect(){ return {left:0,top:0,width:800,height:600}; },
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
    setAttribute(){}, width:800, height:600,
  };
}

// 云端假实现：跨 boot 共享，模拟真实云表
function makeCloud(rows){
  return {
    database: {
      from(){
        let eq = null, table = 'x';
        const api = {
          select(){ return api; },
          eq(k, v){ eq = { k, v }; return api; },
          order(){ return api; },
          limit(){ return Promise.resolve({ error:null, data: (eq && rows[eq.v]) ? [rows[eq.v]] : [] }); },
          upsert(row){ rows[row.device_key] = Object.assign({}, row); return Promise.resolve({ error:null }); },
          insert(){ return Promise.resolve({ error:null }); },
        };
        return api;
      },
    },
  };
}

function parseCookie(str){
  const m = String(str).match(/^([^=]+)=([^;]*)/);
  if (!m) return null;
  const age = String(str).match(/max-age=(\d+)/i);
  return { name: m[1], value: m[2], maxAge: age ? +age[1] : null };
}

function boot(env){
  const els = {};
  const myid = makeEl();
  const documentStub = {
    getElementById(id){ return els[id] || (els[id] = makeEl()); },
    createElement(){ return makeEl(); },
    querySelectorAll(sel){ return sel === '.myid' ? [myid] : []; },
    body: makeEl(),
    addEventListener(){},
  };
  Object.defineProperty(documentStub, 'cookie', {
    configurable: true,
    get(){ return Object.keys(env.jar).map(k => k + '=' + env.jar[k].v).join('; '); },
    set(str){
      const c = parseCookie(str);
      if (!c) return;
      if (c.maxAge === 0) delete env.jar[c.name];
      else env.jar[c.name] = { v: c.value };
    },
  });
  const ls = {
    getItem(k){ if (env.lsThrows) throw new Error('SecurityError'); return k in env.lsData ? env.lsData[k] : null; },
    setItem(k, v){ if (env.lsThrows) throw new Error('SecurityError'); env.lsData[k] = String(v); },
    removeItem(k){ if (env.lsThrows) throw new Error('SecurityError'); delete env.lsData[k]; },
  };
  const loc = {
    pathname: '/rg/index.html',
    get search(){ return env.url.search; },
    get hash(){ return env.url.hash; },
    set hash(v){ env.url.hash = v; },
  };
  const sandbox = {
    console: { log(){}, warn(){}, error: console.error, info(){} },
    Math, Date, JSON, Promise, URL,
    setTimeout: (fn) => { try { fn(); } catch(_){} return 0; },
    clearTimeout(){}, setInterval: () => 0, clearInterval(){},
    performance: { now: () => Date.now() },
    document: documentStub,
    location: loc,
    history: {
      replaceState(_a, _b, url){
        const u = new URL(url, 'https://example.test');
        env.url.search = u.search;
        env.url.hash = u.hash;
      },
    },
    addEventListener(){}, removeEventListener(){},
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    requestAnimationFrame(){ return 0; },
    localStorage: ls,
    navigator: { userAgent: 'test', maxTouchPoints: 0 },
    WorkBuddyCloud: { createWorkBuddyCloud: () => env.cloud },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctxStub = new Proxy({}, { get: (t, p) => {
    if (p === 'canvas') return els['cv'];
    if (p === 'measureText') return () => ({ width: 10 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop(){} });
    return typeof p === 'string' ? function(){} : undefined;
  }, set: () => true });
  els['cv'] = { getContext: () => ctxStub, width: 800, height: 600, style:{},
    getBoundingClientRect(){ return { left:0, top:0, width:800, height:600 }; }, addEventListener(){} };

  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'rg_game.js' });
  const G = vm.runInContext(`({
    get deviceKey(){ return deviceKey; },
    get playerId(){ return playerId; },
    get userPoints(){ return userPoints; }, set userPoints(v){ userPoints = v; },
    get profileRev(){ return profileRev; },
    get unlockedBullets(){ return unlockedBullets; }, set unlockedBullets(v){ unlockedBullets = v; },
    get cloudSyncState(){ return cloudSyncState; },
    saveProgress, saveProgressLocal, ensureIdentity, flushProgress, cloudPushProgress,
    Store, cloudCode, normCode, dedupeLB, submitScore,
  })`, sandbox);
  return { sandbox, G, els, myid };
}

const assert = (cond, msg) => {
  if (!cond){ console.error('FAIL: ' + msg); process.exit(1); }
  console.log('PASS: ' + msg);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async ()=>{
  const cloudRows = {};
  const env = { lsData: {}, lsThrows: false, jar: {}, url: { search:'?sharecode=KZEPE4EMN7', hash:'' },
    cloud: makeCloud(cloudRows) };

  // ---- 1. 首次启动：生成身份并写进 URL ----
  let b = boot(env);
  await sleep(30);
  const key1 = b.G.deviceKey, pid1 = b.G.playerId;
  assert(/^[a-z0-9]{12}$/.test(key1), `设备密钥 12 位（${key1}）`);
  assert(/^[A-Za-z]{2}$/.test(pid1), `玩家 ID 两位（${pid1}）`);
  assert(env.url.hash === `#rgk=${key1}&rgpid=${pid1}`, '身份已写入 URL 锚点（刷新可还原）');
  assert(b.G.Store.mode() === 'local', '存储通道 = 本机 localStorage');
  assert(cloudRows[key1] && cloudRows[key1].points === 0, '首次启动已把进度登记到云端');

  // ---- 2. 积分变化后立刻落盘（不依赖游戏循环）----
  b.G.userPoints = 1234;
  b.G.unlockedBullets = ['normal', 'ice'];
  b.G.saveProgress();
  await b.G.cloudPushProgress(true);       // 真机由 4 秒定时器推送，这里手动触发
  await sleep(10);
  const raw = JSON.parse(env.lsData['rg_profile_v2']);
  assert(raw.points === 1234 && raw.key === key1 && raw.rev >= 1, 'saveProgress 立刻写入本机（含设备密钥与 rev）');
  assert(cloudRows[key1].points === 1234, '积分已推送到云端');

  // ---- 3. 刷新页面：同一存储 → 身份与积分都还在 ----
  env.url.hash = '';                       // 模拟"直接刷新"，只靠本机存储
  b = boot(env);
  await sleep(30);
  assert(b.G.deviceKey === key1, '刷新后设备密钥不变');
  assert(b.G.playerId === pid1, '刷新后玩家 ID 不变（不再是新随机 ID）');
  assert(b.G.userPoints === 1234, `刷新后积分保留（${b.G.userPoints}）`);
  assert(b.G.unlockedBullets.indexOf('ice') >= 0, '已解锁子弹保留');

  // ---- 4. localStorage 被禁用 → 自动降级 cookie，刷新仍保留 ----
  const env2 = { lsData: {}, lsThrows: true, jar: {}, url: { search:'', hash:'' }, cloud: makeCloud(cloudRows) };
  b = boot(env2);
  await sleep(30);
  const key2 = b.G.deviceKey;
  assert(b.G.Store.mode() === 'local' || b.G.Store.mode() === 'cookie' || b.G.Store.mode() === 'session',
    `localStorage 被禁时降级到可用通道（${b.G.Store.mode()}）`);
  assert(/^[a-z0-9]{12}$/.test(key2), '被禁环境仍生成稳定设备密钥');
  b.G.userPoints = 777;
  b.G.saveProgress();
  await b.G.cloudPushProgress(true);
  await sleep(10);
  assert(String(env2.jar['rg_profile_v2'] && env2.jar['rg_profile_v2'].v || '').indexOf('777') >= 0,
    'cookie 备用通道里存下了积分');
  env2.url.hash = '';
  b = boot(env2);
  await sleep(30);
  assert(b.G.userPoints === 777, `降级通道刷新后积分保留（${b.G.userPoints}）`);
  assert(b.G.deviceKey === key2, '降级通道刷新后身份不变');

  // ---- 5. 本机存储全清 → 靠恢复码（云端）找回 ----
  const env3 = { lsData: {}, lsThrows: true, jar: {}, url: { search:'', hash:`#rgk=${key2}&rgpid=AB` },
    cloud: makeCloud(cloudRows) };
  b = boot(env3);
  await sleep(40);
  assert(b.G.deviceKey === key2, '清空存储后从 URL 恢复码还原设备密钥');
  assert(b.G.userPoints === 777, `云端按恢复码把积分找回（${b.G.userPoints}）`);
  assert(b.G.playerId === cloudRows[key2].player_id, '云端同时还原玩家 ID');

  // ---- 6. 恢复码格式 ----
  assert(b.G.cloudCode('abcdefghijkl') === 'abcd-efgh-ijkl', '恢复码分段展示正确');
  assert(b.G.normCode('ABCD-EFGH-IJKL') === 'abcdefghijkl', '恢复码输入容错（大小写 / 分隔符）');
  assert(!/^[a-z0-9]{8,32}$/.test(b.G.normCode('短码')), '非法恢复码会被拒绝');

  // ---- 7. 排行榜按设备密钥去重（两位 ID 撞名不互吞）----
  const rows = [
    { player_id:'AB', device_key:'k1', points:100 },
    { player_id:'AB', device_key:'k2', points:90 },
    { player_id:'AB', device_key:'k1', points:80 },
  ];
  const dd = b.G.dedupeLB(rows);
  assert(dd.length === 2, `同 ID 不同设备各占一行（${dd.length} 行）`);
  assert(dd[0].points === 100 && dd[1].points === 90, '每人保留最好成绩');

  const rec = b.G.submitScore('endless', null, 55, 100, 3, 2);
  assert(rec.device_key === key2 && rec.player_id === b.G.playerId, '成绩记录带上设备密钥');

  console.log('\n全部通过 ✅');
  process.exit(0);
})();
