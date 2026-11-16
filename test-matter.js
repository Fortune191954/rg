// 冒烟测试：宇宙物质（黑洞怪 BOSS 战额外吞噬目标）
// 血量 20/50/100/1000，概率 70%/20%/9%/1%；黑色方形 + 灰色重影；靠近黑洞怪被引力捕获吞噬
const fs = require('fs');
const vm = require('vm');

function makeEl(){
  return {
    style:{}, textContent:'', innerHTML:'', value:'',
    appendChild(){}, remove(){}, addEventListener(){},
    getBoundingClientRect(){ return {left:0,top:0,width:800,height:600}; },
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
    setAttribute(){}, width:800, height:600,
  };
}
const els = {};
const sandbox = {
  console, Math, Date, JSON, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
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
  localStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
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
  get player(){ return player; },
  get state(){ return state; }, set state(v){ state = v; },
  get bossWarn(){ return bossWarn; }, set bossWarn(v){ bossWarn = v; },
  get gems(){ return gems; },
  get kills(){ return kills; },
  spawnMatter, update, newGame,
})`, sandbox);

const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };

// --- 开一局黑洞怪 BOSS 战 ---
G.newGame('boss', 'blackhole');
G.state = 'playing';
G.player.atkRange = 0;
G.player.maxHp = 100; G.player.hp = 10000;

// --- 测试 1：血量档位与概率分布 ---
// 强制多次生成，统计档位分布（Math.random 由 vm 内置，用大样本验证概率区间划分）
const dist = { 20:0, 50:0, 100:0, 1000:0 };
for (let i=0;i<4000;i++){
  G.spawnMatter();
  // 场上上限 6 个，先清空再继续
  G.enemies = G.enemies.filter(e => e.type !== 'matter');
}
// spawnMatter 内部有上限 6 判断：每次生成后立刻清理，所以每次都能生成
// 再跑一遍真实采样
let counts = { 20:0, 50:0, 100:0, 1000:0 };
for (let i=0;i<4000;i++){
  G.enemies = G.enemies.filter(e => e.type !== 'matter');
  G.spawnMatter();
  const mt = G.enemies.find(e => e.type === 'matter');
  if (mt) counts[mt.maxHp]++;
}
assert(counts[20] > 2600 && counts[20] < 3200, `20 血档位 ≈70%（${(counts[20]/40).toFixed(1)}%）`);
assert(counts[50] > 640 && counts[50] < 960, `50 血档位 ≈20%（${(counts[50]/40).toFixed(1)}%）`);
assert(counts[100] > 240 && counts[100] < 520, `100 血档位 ≈9%（${(counts[100]/40).toFixed(1)}%）`);
assert(counts[1000] > 0 && counts[1000] < 90, `1000 血档位 ≈1%（${(counts[1000]/40).toFixed(1)}%）`);

// --- 测试 2：外形字段（黑色方形渲染所需的 dx/dy/rot）---
G.enemies = G.enemies.filter(e => e.type !== 'matter');
G.spawnMatter();
const mt = G.enemies.find(e => e.type === 'matter');
assert(mt.col === '#0a0a10', `本体为黑色 col=${mt.col}`);
assert(typeof mt.dx === 'number' && typeof mt.dy === 'number' && typeof mt.rot === 'number',
  `有漂移向量与自旋角 dx=${mt.dx.toFixed(1)}, dy=${mt.dy.toFixed(1)}, rot=${mt.rot.toFixed(2)}`);
assert(mt.dmg === 0 && mt.xp === 0, '不攻击玩家、不掉经验');
assert(Math.abs(mt.x) <= 650 && Math.abs(mt.y) <= 650, '出生在场地内');

// --- 测试 3：场上上限 6 个 ---
G.enemies = G.enemies.filter(e => e.type !== 'matter');
for (let i=0;i<10;i++) G.spawnMatter();
assert(G.enemies.filter(e => e.type === 'matter').length === 6, '场上宇宙物质上限 6 个');

// --- 测试 4：漂移与自旋 ---
const m2 = G.enemies.find(e => e.type === 'matter');
const x0 = m2.x, y0 = m2.y, r0 = m2.rot;
for (let f=0; f<30; f++) G.update(1/60);
assert(Math.hypot(m2.x-x0, m2.y-y0) > 1, `物质在漂移（位移 ${(Math.hypot(m2.x-x0, m2.y-y0)).toFixed(1)}px）`);
assert(Math.abs(m2.rot - r0) > 0.05, `物质在自旋（Δrot=${(m2.rot-r0).toFixed(3)}）`);

// --- 测试 5：边界反弹 ---
m2.x = 645; m2.y = 0; m2.dx = 50; m2.dy = 0;
for (let f=0; f<60; f++) G.update(1/60);
assert(m2.x <= 650 && m2.dx < 0, `撞右边界反弹（x=${m2.x.toFixed(1)}, dx=${m2.dx}）`);

// --- 测试 6：靠近黑洞怪被引力捕获并吞噬 ---
G.enemies = G.enemies.filter(e => e.type !== 'matter' && e.type !== 'bhboss');
// 黑洞怪登场
G.bossWarn = 0.01;
G.update(1/60);
const boss = G.enemies.find(e => e.type === 'bhboss');
assert(boss, '黑洞怪已登场');
// 造一个 1000 血物质放在黑洞怪旁边（引力范围内）
const hpBefore = boss.hp;
G.enemies.push({ x: boss.x + boss.r + 50, y: boss.y, type:'matter', id:99991, r:30,
  hp:1000, maxHp:1000, spd:0, dmg:0, col:'#0a0a10', xp:0, hurtT:0, burnT:0, burnDmg:0,
  dx:5, dy:0, rot:0, rotV:0.4 });
let absorbed = false;
for (let f=0; f<1200 && !absorbed; f++){
  G.update(1/60);
  if (!G.enemies.some(e => e.id === 99991)) absorbed = true;
}
assert(absorbed, '宇宙物质被黑洞怪吞噬');
const gained = G.enemies.find(e => e.type === 'bhboss').hp - hpBefore;
assert(gained >= 1000, `黑洞怪血量增加 ≥1000（实际 +${gained}，吞噬等额加血）`);

// --- 测试 7：玩家打碎物质不掉经验 ---
G.enemies = G.enemies.filter(e => e.type !== 'matter');
G.enemies.push({ x: G.player.x + 100, y: G.player.y, type:'matter', id:99992, r:10,
  hp:20, maxHp:20, spd:0, dmg:0, col:'#0a0a10', xp:0, hurtT:0, burnT:0, burnDmg:0,
  dx:0, dy:0, rot:0, rotV:0 });
G.player.atkRange = 460;
G.player.dmg = 50; G.player.fireDelay = 0.1; G.player.multi = 1; G.player.pierce = 0;
const gemsBefore = G.gems.length;
let killed = false;
for (let f=0; f<600 && !killed; f++){
  G.update(1/60);
  if (!G.enemies.some(e => e.id === 99992)) killed = true;
}
assert(killed, '玩家子弹可打碎宇宙物质');
assert(G.gems.length === gemsBefore, '打碎宇宙物质不掉经验水晶');

console.log('\n全部断言通过 ✔');
