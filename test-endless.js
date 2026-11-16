// 冒烟测试：无尽模式核心机制
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
const lsCalls = [];
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
  localStorage: {
    getItem(k){ lsCalls.push(['get',k]); return sandbox._ls[k] || null; },
    setItem(k,v){ lsCalls.push(['set',k]); sandbox._ls[k] = v; },
    removeItem(k){ delete sandbox._ls[k]; },
  },
  navigator: { userAgent: 'test', maxTouchPoints: 0 },
};
sandbox._ls = {};
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
  get gems(){ return gems; },
  get gameTime(){ return gameTime; }, set gameTime(v){ gameTime = v; },
  get state(){ return state; }, set state(v){ state = v; },
  get bossWarn(){ return bossWarn; }, set bossWarn(v){ bossWarn = v; },
  get endlessBossT(){ return endlessBossT; }, set endlessBossT(v){ endlessBossT = v; },
  get endlessBosses(){ return endlessBosses; },
  get endlessNewBest(){ return endlessNewBest; },
  get bossKind(){ return bossKind; },
  newGame, update, spawnEnemy, killEnemy,
})`, sandbox);

const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };

// --- 开一局无尽模式 ---
G.newGame('endless');
G.state = 'playing';
assert(G.gameTime === 0, '开局 gameTime=0');

// --- 刷怪正常进行 ---
for (let i=0;i<300;i++) G.update(1/60);   // 5 秒
assert(G.enemies.filter(e => e.type!=='ebullet').length > 0, '5 秒内已刷出小怪');
const early = G.enemies.find(e => e.type!=='ebullet');
const earlyHp = early ? early.maxHp : 0;
assert(earlyHp > 0 && earlyHp < 60, `10 分钟内无增强乘区（小怪 maxHp=${earlyHp}）`);

// --- 周期 BOSS：缩短计时触发 ---
G.endlessBossT = 0.01;
G.update(1/60);
assert(G.bossWarn > 0, 'BOSS 计时到 0 后进入登场警告');
G.bossWarn = 0.01;
G.update(1/60);
const boss = G.enemies.find(e => e.type==='bhboss' || e.type==='boss');
assert(boss, 'BOSS 已登场');
assert(G.endlessBosses === 1, `BOSS 计数 = ${G.endlessBosses}`);
assert(boss.maxHp === (boss.type==='bhboss' ? 2000 : 2200), `首个 BOSS 血量无加成（${boss.maxHp}）`);

// --- 击杀 BOSS：掉大量经验水晶 + 额外三选一，不结束游戏 ---
// （真实流程中由伤害结算方调用 killEnemy 后自行 splice 移除尸体）
const gemCount0 = G.gems.length;
const bidx = G.enemies.indexOf(boss);
G.killEnemy(boss);
G.enemies.splice(bidx, 1);
assert(G.gems.length - gemCount0 === 25, `击杀 BOSS 掉落 25 颗水晶（+${G.gems.length - gemCount0}）`);
assert(G.state === 'levelup', '击杀 BOSS 弹出三选一强化');
G.state = 'playing';
assert(!G.enemies.some(e => e === boss), 'BOSS 已移除，游戏继续');

// --- 第二个 BOSS 血量 +50% ---
G.endlessBossT = 0.01; G.update(1/60);
G.bossWarn = 0.01; G.update(1/60);
const boss2 = G.enemies.find(e => e.type==='bhboss' || e.type==='boss');
assert(boss2 && boss2.maxHp === Math.round((boss2.type==='bhboss'?2000:2200)*1.5),
  `第二个 BOSS 血量 +50%（${boss2 && boss2.maxHp}）`);

// --- 10 分钟后无限增强乘区 ---
G.gameTime = 1000;          // post=400，stages=1.333
G.newGame('endless');
G.state = 'playing'; G.gameTime = 1000;
// 反复刷怪直到出一只 grunt（普通怪），便于精确核对公式
let e1 = null;
for (let tries=0; tries<60; tries++){
  G.spawnEnemy();
  const last = G.enemies[G.enemies.length-1];
  if (last.type === 'grunt'){ e1 = last; break; }
  G.enemies.pop();
}
assert(e1 && e1.type === 'grunt', '成功刷出普通怪用于核对');
// 注意：经典刷怪公式的 diff = t/GAME_TIME 未封顶，无尽模式 t>600 后基础血量继续线性成长，再叠乘区
const diffU = 1000/600;                       // 1.667，不封顶
const stages = 400/300;                       // 1.333
const expectHp = (20 + diffU*60*0.60) * (1 + stages*0.5);
assert(Math.abs(e1.maxHp - expectHp) < 0.01, `增强乘区：maxHp=${e1.maxHp.toFixed(1)}（期望 ${expectHp.toFixed(1)}）`);
assert(e1.dmg === Math.round(10*(1+stages*0.2)), `伤害 +20%/5分钟（dmg=${e1.dmg}）`);
assert(e1.xp === 1 + Math.floor(stages), `经验 +1/5分钟（xp=${e1.xp}）`);
assert(e1.spd === Math.round((70+diffU*50) * Math.min(1.6, 1+stages*0.1)), `移速 +10%/5分钟 封顶1.6倍（spd=${e1.spd}）`);

// --- 死亡结算 + 本地最佳纪录 ---
G.gameTime = 700;
G.endlessBossT = 999;
const bossDie = G.enemies.find(e => e.type==='bhboss' || e.type==='boss');
if (bossDie){ const idx = G.enemies.indexOf(bossDie); G.enemies.splice(idx,1); }
G.update(0.016);
// 直接触发死亡结算
vm.runInContext(`endGame(false)`, sandbox);
assert(G.state === 'end', '死亡进入结算');
assert(lsCalls.some(c => c[0]==='set' && c[1]==='rg_endless_best'), '最佳纪录已写入 localStorage');
assert(G.endlessNewBest === true, '首局即新纪录');

console.log('\n全部断言通过 ✔');
