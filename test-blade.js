// 冒烟测试：血刃巨像（蓄力斩击 + 血量 50% 提速）
const fs = require('fs');
const vm = require('vm');

function makeEl(){
  const el = {
    style:{}, textContent:'', value:'', className:'', disabled:false,
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
  get bullets(){ return bullets; }, set bullets(v){ bullets = v; },
  get player(){ return player; }, set player(v){ player = v; },
  get mode(){ return mode; }, set mode(v){ mode = v; },
  get state(){ return state; }, set state(v){ state = v; },
  newGame, update, spawnSelectedBoss, killEnemy,
  BLADE_SLASH_DMG, BLADE_SLASH_CHARGE, BLADE_SLASH_CD,
})`, sandbox);
const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };
const find = t => G.enemies.filter(e => e.type === t);

// ---------- 0. 出生 ----------
G.newGame('boss', 'blade');
G.state = 'playing';
G.spawnSelectedBoss();
const boss = find('boss')[0];
assert(!!boss, '血刃巨像已登场');
assert(boss.hp === 2200, `初始血量 2200（${boss.hp}）`);
assert(boss.charging === 0 && boss.raged === false, '初始未蓄力、未提速');

// ---------- 1. 斩击蓄力：原地不动 + 锁定方向 ----------
G.player.x = boss.x - 300; G.player.y = boss.y; G.player.hp = 500; G.player.invul = 999;
boss.slashT = 0; boss.charging = 0; boss.rushT = 0; boss.chargeT = 99; boss.shootT = 99;
const bx0 = boss.x, by0 = boss.y;
G.update(1/60);
assert(boss.charging > 0, '进入斩击蓄力');
const wantAng = Math.atan2(G.player.y-boss.y, G.player.x-boss.x);
assert(Math.abs(boss.chargeAng - wantAng) < 1e-9, '蓄力方向锁定玩家（进度条箭头方向）');
const bx1 = boss.x, by1 = boss.y;
// 蓄力期间不应移动（也不冲刺）
for (let i=0;i<40;i++) G.update(0.02);
assert(Math.abs(boss.x-bx1) < 1e-9 && Math.abs(boss.y-by1) < 1e-9, '蓄力期间 BOSS 原地不动');
assert(find('swordwave').length === 0, '蓄力未满时不放剑气');

// ---------- 2. 蓄满 → 释放红色剑气（100 伤害） ----------
G.update(0.6);
let waves = find('swordwave');
assert(waves.length === 1, `蓄力满后放出剑气（${waves.length} 道）`);
assert(waves[0].dmg === G.BLADE_SLASH_DMG && waves[0].dmg === 100, '剑气伤害 100');
assert(waves[0].col === '#ff3b3b', '剑气是红色');
assert(boss.charging === 0, '释放后退出蓄力状态');
assert(boss.slashT > 0, '斩击进入冷却');

// ---------- 3. 剑气命中造成 100 伤害并被消耗 ----------
G.enemies = [boss];
G.enemies.push({ type:'swordwave', id:777, x:200, y:0, ang:0, spd:0, len:130, w:54, dmg:100,
  col:'#ff3b3b', life:1.5, hp:1, maxHp:1, r:30, xp:0, hurtT:0, burnT:0, burnDmg:0, invul:true });
boss.x = 5000; boss.y = 5000;
G.player.x = 100; G.player.y = 0; G.player.hp = 200; G.player.invul = 0; G.player.armor = 1; G.player.orbs = 0;
G.update(1/60);
assert(G.player.hp === 100, `剑气命中造成 100 伤害（剩余 ${G.player.hp}）`);
assert(find('swordwave').length === 0, '剑气命中后消失，不会持续扣血');

// ---------- 4. 血量 50% 后技能释放速度 +50% ----------
G.enemies = [boss];
boss.x = 0; boss.y = 0;
G.player.x = 300; G.player.y = 0; G.player.hp = 500; G.player.invul = 999;
boss.charging = 0; boss.rushT = 0; boss.chargeT = 99; boss.shootT = 99;
boss.slashT = 50;
boss.hp = boss.maxHp * 0.5;
G.update(1/60);
assert(boss.raged === true, '血量降到 50% 进入狂暴（技能提速）');
assert(boss.slashT < 50 - 1/60, '狂暴后计时按更快速度推进');
const before = boss.slashT;
boss.slashT = 2;
G.update(1);
assert(Math.abs(boss.slashT - 0.5) < 0.02, `技能速度 +50%（1 秒推进 1.5 秒：${boss.slashT.toFixed(3)}）`);
assert(before < 50, '狂暴标记生效');

// ---------- 5. 蓄力时长固定，玩家有反应时间 ----------
boss.raged = true; boss.charging = 0; boss.slashT = 0; boss.rushT = 0; boss.chargeT = 99; boss.shootT = 99;
G.update(1/60);
assert(Math.abs(boss.charging - G.BLADE_SLASH_CHARGE) < 0.02, `蓄力时长固定 ${G.BLADE_SLASH_CHARGE}s（狂暴不缩短预警时间）`);

console.log('\n全部断言通过 ✔');
