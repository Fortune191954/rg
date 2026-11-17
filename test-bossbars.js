// 冒烟测试：多 BOSS 血条（最多 4 条）+ 坦克引擎下架
const fs = require('fs');
const vm = require('vm');

// 带子节点追踪的 DOM 桩：可以检查 bossbar 里生成了几条血条
function makeEl(){
  const el = {
    style:{}, textContent:'', value:'', className:'',
    children: [],
    appendChild(c){ this.children.push(c); return c; },
    remove(){}, addEventListener(){},
    getBoundingClientRect(){ return {left:0,top:0,width:800,height:600}; },
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
    setAttribute(){}, width:800, height:600,
  };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get(){ return html; },
    set(v){ html = v; if (v === '') el.children.length = 0; },
  });
  return el;
}
const els = {};
const sandbox = {
  console,
  Math, Date, JSON, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  document: {
    getElementById(id){ return els[id] || (els[id] = makeEl()); },
    createElement(){ return makeEl(); },
    body: makeEl(),
    addEventListener(){},
  },
  addEventListener(){}, removeEventListener(){},
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  requestAnimationFrame(){ return 0; },
  localStorage: (function(){ const s={}; return {
    getItem(k){ return k in s ? s[k] : null; }, setItem(k,v){ s[k]=String(v); }, removeItem(k){ delete s[k]; } }; })(),
  navigator: { userAgent: 'test', maxTouchPoints: 0 },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctxStub = new Proxy({}, { get: (t,p) => {
  if (p === 'canvas') return els['cv'];
  if (['measureText'].includes(p)) return () => ({width:10});
  if (['createLinearGradient','createRadialGradient'].includes(p)) return () => ({addColorStop(){}});
  return typeof p === 'string' ? function(){} : undefined;
}, set: () => true });
els['cv'] = { getContext: () => ctxStub, width:800, height:600, style:{},
  getBoundingClientRect(){ return {left:0,top:0,width:800,height:600}; }, addEventListener(){} };

vm.createContext(sandbox);
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
vm.runInContext(m[1], sandbox, { filename: 'rg_game.js' });

const G = vm.runInContext(`({
  get enemies(){ return enemies; }, set enemies(v){ enemies = v; },
  get player(){ return player; }, set player(v){ player = v; },
  get mode(){ return mode; }, set mode(v){ mode = v; },
  get state(){ return state; }, set state(v){ state = v; },
  get bossWarn(){ return bossWarn; }, set bossWarn(v){ bossWarn = v; },
  newGame, update, updateBossBar, resetBossBar, showUpgradePanel,
  UPGRADES, ARTIFACTS, MAX_BOSS_BARS, MAX_UPGRADES,
})`, sandbox);
const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };

const bar = () => els['bossbar'];
// 血条行 = 带 .bossrow 类名的子节点
const rows = () => bar().children.filter(c => c.className === 'bossrow');
const more = () => bar().children.find(c => c.className === 'bossmore');
const label = (row) => row.children.find(c => c.className === 'bossnm').textContent;
const fillW  = (row) => {
  const track = row.children.find(c => c.className === 'bosstrack');
  return track.children[0].style.width;
};

// ============ 一、普通强化池清理（能力移入神器） ============
const tank = G.UPGRADES.find(u => u.name === '坦克引擎');
assert(!tank, '普通强化池已移除坦克引擎（能力移入神器「心之钢」）');
assert(!G.UPGRADES.find(u => u.name === '爽煎滑蛋'), '普通强化池已移除爽煎滑蛋（能力移入神器「水思面具」）');
assert(!G.UPGRADES.find(u => u.name === '护体旋风'), '普通强化池已移除护体旋风（能力移入神器「呼呼符」）');
assert(G.ARTIFACTS.steel.desc.includes('生命上限翻倍'), '神器「心之钢」继承坦克引擎能力');

// 反复开强化面板，确认永远抽不到已移出的三项
G.newGame('classic');
G.state = 'playing';
let tankSeen = 0, rolls = 0;
for (let i=0; i<400; i++){
  G.showUpgradePanel();
  const names = els['cards'].children.map(c => (c.innerHTML || '').toString());
  if (names.some(s => s.includes('坦克引擎') || s.includes('爽煎滑蛋') || s.includes('护体旋风'))) tankSeen++;
  rolls++;
}
assert(tankSeen === 0, `400 次强化面板均未出现已移入神器的三项（出现 ${tankSeen} 次）`);
assert(rolls === 400, '强化面板共抽取 400 次');

// 其它强化仍正常出现（确认过滤没把整个池子清空）
G.showUpgradePanel();
assert(els['cards'].children.length === 3, `强化面板正常给出 3 个选项（当前 ${els['cards'].children.length}）`);

// ============ 二、单 BOSS：1 条血条 ============
G.newGame('boss', 'blackhole');
G.state = 'playing';
G.player.atkRange = 0;
G.bossWarn = 0.001;
G.update(1/60);
G.updateBossBar();
assert(rows().length === 1, `单 BOSS 显示 1 条血条（当前 ${rows().length}）`);
assert(label(rows()[0]).includes('黑洞怪'), `血条文字含"黑洞怪"：${label(rows()[0])}`);
assert(!label(rows()[0]).startsWith('#'), '单 BOSS 不加序号前缀');
assert(fillW(rows()[0]) === '100%', `满血宽度 100%（当前 ${fillW(rows()[0])}）`);
assert(!more(), '单 BOSS 不显示"未显示"提示');

// 掉血后宽度同步
const b0 = G.enemies.find(e => e.type === 'bhboss');
b0.hp = b0.maxHp * 0.5;
G.updateBossBar();
assert(fillW(rows()[0]) === '50%', `掉到半血宽度 50%（当前 ${fillW(rows()[0])}）`);

// 黑洞怪狂暴：血条换紫色渐变
b0.enraged = true;
G.updateBossBar();
const track = rows()[0].children.find(c => c.className === 'bosstrack');
assert(String(track.children[0].style.background).includes('7a3bd6'), '狂暴态血条为紫色渐变');
assert(label(rows()[0]).includes('狂暴'), '狂暴态文字标注');

// ============ 三、多 BOSS：每人一条 ============
G.newGame('endless');
G.state = 'playing';
G.player.atkRange = 0;
const mkBoss = (id, kind, hpRatio) => {
  const e = {
    x: 300 + id, y: 200, type: kind, id, r: 40, rMul: 1, absorbed: 0,
    hp: 1000 * hpRatio, maxHp: 1000, spd: 60, dmg: 10, col: '#a06fd0', xp: 0,
    hurtT: 0, burnT: 0, burnDmg: 0, castT: 5, volleyT: 1, vortexA: 0,
    shootT: 1, chargeT: 5, rushT: 0, enraged: false,
  };
  G.enemies.push(e);
  return e;
};
G.enemies = [];
mkBoss(1, 'boss', 1);
mkBoss(2, 'bhboss', 0.8);
mkBoss(3, 'boss', 0.4);
G.updateBossBar();
assert(rows().length === 3, `3 个 BOSS 显示 3 条血条（当前 ${rows().length}）`);
assert(label(rows()[0]).startsWith('#1 '), `多 BOSS 加序号：#1（${label(rows()[0])}）`);
assert(label(rows()[1]).startsWith('#2 ') && label(rows()[1]).includes('黑洞怪'), `第 2 条是黑洞怪（${label(rows()[1])}）`);
assert(label(rows()[2]).startsWith('#3 '), `第 3 条序号（${label(rows()[2])}）`);
assert(fillW(rows()[0]) === '100%' && fillW(rows()[1]) === '80%' && fillW(rows()[2]) === '40%',
  `三条血条宽度各自独立：${fillW(rows()[0])} / ${fillW(rows()[1])} / ${fillW(rows()[2])}`);
assert(!more(), '3 个 BOSS 无需"未显示"提示');

// ============ 四、超过 4 个：只显示 4 条 ============
G.enemies = [];
for (let i=1;i<=6;i++) mkBoss(i, i % 2 ? 'boss' : 'bhboss', 1);
G.updateBossBar();
assert(G.MAX_BOSS_BARS === 4, '上限常量 MAX_BOSS_BARS = 4');
assert(rows().length === 4, `6 个 BOSS 只显示 4 条（当前 ${rows().length}）`);
assert(!!more(), '超出部分给出"未显示"提示');
assert(more().textContent.includes('还有 2 个'), `提示文案正确：${more().textContent}`);

// ============ 五、BOSS 减少后血条同步收缩 ============
G.enemies = G.enemies.filter(e => e.id <= 2);
G.updateBossBar();
assert(rows().length === 2, `BOSS 减少到 2 个后显示 2 条（当前 ${rows().length}）`);
assert(!more(), '数量回落时清除"未显示"提示');

// 全部清空 → 隐藏
G.enemies = [];
G.updateBossBar();
assert(bar().style.display === 'none', '没有 BOSS 时血条容器隐藏');

// 非 BOSS 模式（十分钟）即使有 BOSS 也不显示
G.mode = 'classic';
G.enemies = [];
mkBoss(9, 'boss', 1);
G.updateBossBar();
assert(bar().style.display === 'none', '十分钟模式不显示 BOSS 血条');

// 重新进 BOSS 战：状态复位，不残留旧行
G.newGame('boss', 'blackhole');
assert(bar().style.display === 'none', '新开局血条隐藏');
G.bossWarn = 0.001;
G.player.atkRange = 0;
G.update(1/60);
G.updateBossBar();
assert(rows().length === 1, `新开局只有 1 条（当前 ${rows().length}，无残留）`);

console.log('\n全部断言通过 ✔');
