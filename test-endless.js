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
  get spawnTimer(){ return spawnTimer; }, set spawnTimer(v){ spawnTimer = v; },
  get endlessNewBest(){ return endlessNewBest; },
  get bossKind(){ return bossKind; },
  get runPoints(){ return runPoints; },
  get userPoints(){ return userPoints; },
  get endlessTimePoints(){ return endlessTimePoints; },
  newGame, update, spawnEnemy, killEnemy, endGame,
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
const boss = G.enemies.find(e => e.type==='bhboss' || e.type==='boss' || e.type==='eyeboss');
assert(boss, 'BOSS 已登场');
assert(G.endlessBosses === 1, `BOSS 计数 = ${G.endlessBosses}`);
const BASE_HP = { bhboss:2000, boss:2200, eyeboss:5000 };
assert(boss.maxHp === BASE_HP[boss.type], `首个 BOSS 血量无加成（${boss.maxHp}）`);

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
const boss2 = G.enemies.find(e => e.type==='bhboss' || e.type==='boss' || e.type==='eyeboss');
assert(boss2 && boss2.maxHp === Math.round(BASE_HP[boss2.type]*1.5),
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
const slowGrow = 1000/60;                     // 17 分钟内缓慢成长：血 +2.2%/分钟，伤害 +1.6%/分钟
const expectHp = (20 + diffU*60*0.60) * (1 + stages*0.6) * (1 + slowGrow*0.022);
assert(Math.abs(e1.maxHp - expectHp) < 0.01, `增强乘区：maxHp=${e1.maxHp.toFixed(1)}（期望 ${expectHp.toFixed(1)}）`);
// 注意：代码先按阶段取整再乘缓慢成长，期望值要按同样顺序算
assert(e1.dmg === Math.max(1, Math.round(Math.round(10*(1+stages*0.25))*(1+slowGrow*0.016))), `伤害 +25%/5分钟 且随时间缓慢成长（dmg=${e1.dmg}）`);
assert(e1.xp === 1 + Math.floor(stages), `经验 +1/5分钟（xp=${e1.xp}）`);
assert(e1.spd === Math.round((70+diffU*50) * Math.min(1.6, 1+stages*0.12)), `移速 +12%/5分钟 封顶1.6倍（spd=${e1.spd}）`);

// --- 无尽积分：按存活时间结算，每分钟 300 分 ---
G.newGame('endless'); G.state = 'playing';assert(G.runPoints === 0, '开局积分为 0');
G.gameTime = 59.9; G.update(0.2);
assert(G.runPoints === 300, `存活 1 分钟 = 300 积分（${G.runPoints}）`);
G.gameTime = 119.9; G.update(0.2);
assert(G.runPoints === 600, `存活 2 分钟 = 600 积分（${G.runPoints}）`);

// --- 后期刷怪提速：10 分钟后间隔继续压缩，并一次多刷 ---
G.newGame('endless'); G.state = 'playing'; G.enemies = [];
G.gameTime = 100; G.spawnTimer = 0; G.update(1/60);
assert(G.enemies.length === 1, `10 分钟前每次刷 1 只（${G.enemies.length}）`);
G.newGame('endless'); G.state = 'playing'; G.enemies = [];
G.gameTime = 900; G.spawnTimer = 0; G.update(1/60);
assert(G.enemies.length === 2, `15 分钟后一次刷 2 只（${G.enemies.length}）`);
assert(G.spawnTimer <= 0.031, `刷怪间隔压缩到 ${G.spawnTimer.toFixed(3)} 秒`);

// --- BOSS 成长封顶：血量 500%、伤害 250% ---
G.newGame('endless'); G.state = 'playing';
vm.runInContext(`endlessBosses = 3; bossKind = 'blackhole'; spawnSelectedBoss();`, sandbox);
let bb = G.enemies.find(e => e.type==='bhboss');
assert(bb && bb.maxHp === 2000*2.5 && bb.dmg === 53,
  `第 4 个 BOSS：血量 250%（${bb && bb.maxHp}）、伤害 175%（${bb && bb.dmg}）`);
G.enemies = [];
vm.runInContext(`endlessBosses = 20; bossKind = 'blackhole'; spawnSelectedBoss();`, sandbox);
bb = G.enemies.find(e => e.type==='bhboss');
assert(bb && bb.maxHp === 2000*5 && bb.dmg === 75,
  `血量封顶 500%（${bb && bb.maxHp}）、伤害封顶 250%（${bb && bb.dmg}）`);
G.enemies = [];
vm.runInContext(`endlessBosses = 6; bossKind = 'eye'; spawnSelectedBoss();`, sandbox);
const eb = G.enemies.find(e => e.type==='eyeboss');
assert(eb && eb.maxHp === 5000*4 && eb.dmg === 100, `深空之眼同享成长（${eb && eb.maxHp} / ${eb && eb.dmg}）`);

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

// --- 提前结束（游玩途中返回主页）：按当前进度结算并提示 ---
G.newGame('endless'); G.state = 'playing'; G.gameTime = 120;
vm.runInContext(`endlessTimePoints = 600; runPoints = 600;`, sandbox);
const before = G.userPoints;
vm.runInContext(`endGame(false, { quit:true })`, sandbox);
assert(G.state === 'end', '提前结束进入结算');
assert(G.userPoints === before + 600, `提前结束仍发放时间积分（+${G.userPoints - before}）`);
assert((els['winTitle'].textContent||'').indexOf('提前结束') >= 0, `结算标题提示提前结束（${els['winTitle'].textContent}）`);
assert((els['endInfo'].innerHTML||'').indexOf('提前结算') >= 0, '结算信息说明已提前结算');

// 十分钟模式同样支持提前结算
G.newGame('classic'); G.state = 'playing'; G.gameTime = 30;
vm.runInContext(`runPoints = 12; endGame(false, { quit:true })`, sandbox);
assert(G.state === 'end' && (els['winTitle'].textContent||'').indexOf('提前结束') >= 0, '十分钟模式同样支持提前结算');

// BOSS 试炼：提前退出视为挑战失败（入场费不退）
G.newGame('boss'); G.state = 'playing'; G.gameTime = 20;
vm.runInContext(`endGame(false, { quit:true })`, sandbox);
assert((els['endInfo'].innerHTML||'').indexOf('提前退出视为挑战失败') >= 0, 'BOSS 试炼提前退出提示视为失败');

console.log('\n全部断言通过 ✔');
