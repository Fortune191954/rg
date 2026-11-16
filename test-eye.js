// 冒烟测试：深空之眼（三阶段 BOSS）
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
  get gameTime(){ return gameTime; }, set gameTime(v){ gameTime = v; },
  newGame, update, spawnSelectedBoss, killEnemy, eyeEnterPhase3, bossShielded, segDist,
  EYE_HP, EYE_P3_HP, EYE_ARM_HP, EYE_LASER_SWEEP,
})`, sandbox);
const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };
const find = t => G.enemies.filter(e => e.type === t);

// ---------- 0. 出生 ----------
G.newGame('boss', 'eye');
G.state = 'playing';
G.spawnSelectedBoss();
let boss = find('eyeboss')[0];
assert(!!boss, '深空之眼已登场');
assert(boss.hp === 5000 && boss.maxHp === G.EYE_HP, `初始血量 5000（${boss.hp}）`);
assert(boss.phase === 1 && boss.openT === 0, '一阶段 · 闭眼');
assert(find('eyeArm').length === 0, '一、二阶段没有实体触手（触手为程序绘制）');

// ---------- 1. 一阶段：两只触手每秒放出线条攻击（不追踪） ----------
boss.armAtkT = 0.0001;
G.update(0.02);
let beams = find('eblam');
assert(beams.length === 2, `两只触手各放出一条线条攻击（实际 ${beams.length}）`);
assert(beams[0].dmg === 30, '线条攻击伤害 30');
assert(beams[0].invul === true, '线条攻击不可被玩家打掉');
const ang0 = beams[0].ang, bx0 = beams[0].x, by0 = beams[0].y;
G.player.x += 260; G.player.y += 160;
G.update(0.02);
assert(Math.abs(beams[0].ang - ang0) < 1e-9, '线条攻击不追踪（方向锁定）');
assert(Math.hypot(beams[0].x-bx0, beams[0].y-by0) > 1, '线条攻击持续向前飞行');

// 线条攻击命中：胶囊判定
G.enemies = [];
G.enemies.push({ type:'eblam', id:999, x:200, y:0, ang:0, spd:0, len:170, w:13, dmg:30,
  col:'#c08bff', life:2, hp:1, maxHp:1, r:8, xp:0, hurtT:0, burnT:0, burnDmg:0, invul:true });
G.player.x = 100; G.player.y = 0; G.player.hp = 200; G.player.invul = 0; G.player.armor = 1; G.player.orbs = 0;
G.update(1/60);
assert(G.player.hp === 170, `线条攻击命中造成 30 伤害（剩余 ${G.player.hp}）`);

// ---------- 2. 血量 50% → 二阶段睁眼 ----------
G.enemies = [boss];
G.player.hp = 500; G.player.invul = 0;
boss.hp = boss.maxHp * 0.5;
G.update(1/60);
assert(boss.phase === 2, '血量 50% 进入二阶段');
assert(Math.abs(boss.atkMul - 1.35) < 1e-9, `触手攻速 +35%（${boss.atkMul}）`);
G.update(0.2);
assert(boss.openT > 0.3, `睁眼动画推进（openT=${boss.openT.toFixed(2)}）`);

// ---------- 3. 二阶段：旋转 150° 激光，100 伤害 ----------
boss.laserT = 0.0001;
G.update(1/60);
assert(!!boss.laser, '眼睛开始释放激光');
assert(Math.abs(boss.laser.start - (Math.atan2(G.player.y-boss.y, G.player.x-boss.x) - boss.laser.dir*G.EYE_LASER_SWEEP*0.35)) < 1e-6,
  '起始角度保证扫掠覆盖玩家方向');
assert(boss.laser.warm > 0, '激光有预热（警示）阶段');

// 预热阶段不造成伤害
boss.x = 0; boss.y = 0; boss.laser = { start:0, dir:1, ang:0, t:0.1, warm:0.5, dur:1.15 };
G.player.x = 300; G.player.y = 0; G.player.hp = 200; G.player.invul = 0;
G.update(1/60);
assert(G.player.hp === 200, '预热阶段激光不伤人');

// 扫到玩家：100 伤害
boss.laser = { start:0, dir:1, ang:0, t:0.52, warm:0.5, dur:1.15 };
G.player.hp = 200; G.player.invul = 0;
G.update(1/60);
assert(G.player.hp === 100, `激光命中造成 100 伤害（剩余 ${G.player.hp}）`);
assert(G.player.invul >= 1, '激光命中后有无敌帧，避免一次扫掠连续扣血');

// 扫掠角度总量 = 150°
boss.laser = { start:0, dir:1, ang:0, t:0.5, warm:0.5, dur:1.15 };
G.player.x = 5000; G.player.y = 5000;   // 挪开玩家，只看扫掠
let steps = 0;
while (boss.laser && steps < 400){ G.update(1/60); steps++; }
assert(!boss.laser, '激光扫完后自动结束');
assert(Math.abs(G.EYE_LASER_SWEEP - Math.PI*150/180) < 1e-9, '扫掠角度为 150°');

// ---------- 4. 二阶段血量归零 → 三阶段 1500 血 + 八只触手 ----------
boss.hp = 1;
G.player.x = 0; G.player.y = 0; G.player.hp = 500;
G.killEnemy(boss);
assert(boss.phase === 3, '二阶段血量归零进入三阶段（不是死亡）');
assert(boss.hp === 1500 && boss.maxHp === G.EYE_P3_HP, `三阶段重设 1500 血（${boss.hp}/${boss.maxHp}）`);
assert(find('eyeArm').length === 8, `八只触手实体化（实际 ${find('eyeArm').length}）`);
assert(boss.armCount === 8, '记录 8 只存活触手');
assert(G.bossShielded(boss), '触手存活时眼睛有护盾');
assert(Math.abs(boss.atkMul - 1.35*1.35) < 1e-9, `触手攻速再 +35%（${boss.atkMul.toFixed(4)}）`);
assert(Math.abs(boss.laserMul - 1.35) < 1e-9, '眼睛释放频率 +35%');

// ---------- 5. 护盾：子弹打眼睛不掉血 ----------
boss.x = 0; boss.y = 0;
G.player.x = 400; G.player.y = 0;
const hpBefore = boss.hp;
G.bullets = [{ x:0, y:0, ang:0, spd:0, dmg:100, pierce:0, life:2, r:5, hit:[], bt:'normal', dud:false }];
G.update(1/60);
assert(boss.hp === hpBefore, '护盾期间子弹被弹开，眼睛不掉血');

// ---------- 6. 触手独立攻击 + 绕本体旋转 ----------
const arms = find('eyeArm');
G.player.x = 400; G.player.y = 0;
const ax0 = arms[0].x, ay0 = arms[0].y;
for (const a of arms) a.atkT = 0.001;
G.update(0.02);
assert(Math.hypot(arms[0].x-ax0, arms[0].y-ay0) > 0.05, '触手绕本体旋转（位置在变）');
assert(find('eblam').length >= 8, `八只触手各自独立开火（${find('eblam').length} 条线条攻击）`);

// ---------- 7. 打光触手 → 眼睛破防 ----------
for (const a of find('eyeArm')){ a.hp = 0; G.killEnemy(a); }
assert(boss.armCount === 0, '触手全灭');
assert(!G.bossShielded(boss), '触手全灭后眼睛破防');
G.bullets = [{ x:0, y:0, ang:0, spd:0, dmg:100, pierce:0, life:2, r:5, hit:[], bt:'normal', dud:false }];
G.update(1/60);
assert(boss.hp < 1500, `破防后子弹能打眼睛（${boss.hp} < 1500）`);

// ---------- 8. 三阶段击杀 = 胜利 ----------
G.player.x = 5000; G.player.y = 5000;
boss.hp = 1;
G.bullets = [{ x:boss.x, y:boss.y, ang:0, spd:0, dmg:999, pierce:0, life:2, r:5, hit:[], bt:'normal', dud:false }];
vm.runInContext('boss = null;', sandbox);
G.killEnemy(boss);
assert(G.state === 'end', '三阶段击杀后战斗结算');

console.log('\n全部断言通过 ✔');
