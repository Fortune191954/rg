// 冒烟测试：黑洞怪吞噬加血验证
// 用最小 DOM/Canvas 桩件驱动真实的游戏代码
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
// 直接从 index.html 提取内联游戏脚本
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const code = m[1];
vm.runInContext(code, sandbox, { filename: 'rg_game.js' });

// let/const 声明在全局词法作用域里，需在同一 context 内二次求值获取引用
const G = vm.runInContext(`({
  get enemies(){ return enemies; }, set enemies(v){ enemies = v; },
  newGame, update, bhRadius,
  get state(){ return state; }, set state(v){ state = v; },
  get bossWarn(){ return bossWarn; }, set bossWarn(v){ bossWarn = v; },
  get player(){ return player; }, set player(v){ player = v; },
})`, sandbox);
const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };

// --- 开一局 BOSS 战（黑洞怪） ---
G.newGame('boss', 'blackhole');
G.state = 'playing';
G.player.atkRange = 0;   // 关闭玩家自动攻击，避免子弹干扰 BOSS 血量断言

// 让 BOSS 立即登场
G.bossWarn = 0.001;
G.update(0.016);
let boss = G.enemies.find(e => e.type === 'bhboss');
assert(boss, '黑洞怪已登场');
assert(boss.maxHp === 2000 && boss.hp === 2000, `BOSS 初始血量 2000（当前 hp=${boss.hp} maxHp=${boss.maxHp}）`);

// --- 手动生成一只小怪，跑 update 直到被吞噬 ---
const minionHp0 = 100;   // 用自定义血量便于精确核对
G.enemies.push({ x: boss.x + 500, y: boss.y, type:'grunt', id: 99999,
  r:12, hp:minionHp0, maxHp:minionHp0, spd:0, dmg:0, col:'#8a6fd0', xp:0,
  hurtT:0, burnT:0, burnDmg:0, suck:true, suckV:240 });

let t = 0;
while (t < 10){
  G.update(1/60);
  t += 1/60;
  const stillThere = G.enemies.some(e => e.id === 99999);
  if (!stillThere) break;
}
boss = G.enemies.find(e => e.type === 'bhboss');
assert(!G.enemies.some(e => e.id === 99999), '小怪已被吞噬移除');
assert(Math.abs(boss.absorbed - minionHp0) < 0.01, `吞噬计数 = ${boss.absorbed}（期望 ${minionHp0}）`);
assert(Math.abs(boss.maxHp - (2000 + minionHp0)) < 0.01, `maxHp = ${boss.maxHp}（期望 ${2000 + minionHp0}）`);
assert(Math.abs(boss.hp - (2000 + minionHp0)) < 0.01, `hp = ${boss.hp}（期望 ${2000 + minionHp0}）`);
assert(Math.abs(boss.r - G.bhRadius(boss.absorbed)) < 0.01, `体型按对数公式增长 r=${boss.r.toFixed(1)}`);

// --- 再吞一只，验证累加 ---
G.enemies.push({ x: boss.x + 500, y: boss.y, type:'grunt', id: 99998,
  r:12, hp:50, maxHp:50, spd:0, dmg:0, col:'#8a6fd0', xp:0,
  hurtT:0, burnT:0, burnDmg:0, suck:true, suckV:240 });
t = 0;
while (t < 10){
  G.update(1/60);
  t += 1/60;
  if (!G.enemies.some(e => e.id === 99998)) break;
}
boss = G.enemies.find(e => e.type === 'bhboss');
assert(Math.abs(boss.maxHp - (2000 + minionHp0 + 50)) < 0.01, `累加后 maxHp = ${boss.maxHp}（期望 ${2000 + minionHp0 + 50}）`);

// --- 吞噬受伤小怪：只按当前剩余血量加血 ---
G.enemies.push({ x: boss.x + 500, y: boss.y, type:'grunt', id: 99997,
  r:12, hp:30, maxHp:100, spd:0, dmg:0, col:'#8a6fd0', xp:0,
  hurtT:0, burnT:0, burnDmg:0, suck:true, suckV:240 });
t = 0;
while (t < 10){
  G.update(1/60);
  t += 1/60;
  if (!G.enemies.some(e => e.id === 99997)) break;
}
boss = G.enemies.find(e => e.type === 'bhboss');
assert(Math.abs(boss.maxHp - (2150 + 30)) < 0.01, `受伤小怪只按当前血量加：maxHp = ${boss.maxHp}（期望 2180）`);
const plus = G.dmgNums ? G.dmgNums.find(d => typeof d.val === 'string' && d.val.startsWith('+')) : null;

console.log('\n全部断言通过 ✔');
