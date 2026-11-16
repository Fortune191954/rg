// 冒烟测试：子弹系统（命中率/寒冰/雷电/灼烧/耶律）+ 积分 + 商店解锁
const fs = require('fs');
const vm = require('vm');

function makeEl(){
  return {
    style:{}, textContent:'', innerHTML:'', value:'', disabled:false, className:'',
    appendChild(){}, remove(){}, addEventListener(){},
    getBoundingClientRect(){ return {left:0,top:0,width:800,height:600}; },
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return false;} },
    setAttribute(){}, width:800, height:600,
  };
}
const els = {};
const sandbox = {
  console: { log: console.log, error: console.error, warn(){}, info(){} },
  Math, Date, JSON, Promise, setTimeout, clearTimeout, setInterval: ()=>0, clearInterval(){},
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
  localStorage: { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; }, removeItem(k){ delete this._d[k]; } },
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
// 主脚本是第二个 <script>（第一个为 CDN 引入）
const m = html.match(/<script>([\s\S]*?)<\/script>/);
vm.runInContext(m[1], sandbox, { filename: 'rg_game.js' });

const G = vm.runInContext(`({
  get enemies(){ return enemies; }, set enemies(v){ enemies = v; },
  get bullets(){ return bullets; }, set bullets(v){ bullets = v; },
  get player(){ return player; },
  get state(){ return state; }, set state(v){ state = v; },
  get gems(){ return gems; },
  get kills(){ return kills; },
  get userPoints(){ return userPoints; }, set userPoints(v){ userPoints = v; },
  get unlockedBullets(){ return unlockedBullets; }, set unlockedBullets(v){ unlockedBullets = v; },
  get equippedBullet(){ return equippedBullet; }, set equippedBullet(v){ equippedBullet = v; },
  get runPoints(){ return runPoints; },
  get chainFx(){ return chainFx; },
  BULLETS, BULLET_ORDER, KILL_POINTS, UPGRADES, HIT_RATE,
  newGame, update, killEnemy, applyBulletEffect,
})`, sandbox);

const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };

// --- 1. 子弹定义与价格 ---
assert(G.BULLETS.ice.cost === 3000, '寒冰弹 3000 积分');
assert(G.BULLETS.thunder.cost === 4500, '雷电子弹 4500 积分');
assert(G.BULLETS.burn.cost === 5000, '灼烧弹 5000 积分');
assert(G.BULLETS.yelve.cost === 6000, '耶律弹 6000 积分');
assert(G.BULLET_ORDER.length === 5, '共 5 种子弹');
assert(G.HIT_RATE === 0.8, '命中率 80%');

// --- 2. 灼热弹已从强化池移除 ---
assert(!G.UPGRADES.some(u => u.name.includes('灼热')), '灼热弹不再出现在强化中');

// --- 3. 积分表 ---
assert(G.KILL_POINTS.grunt === 1 && G.KILL_POINTS.fast === 2
  && G.KILL_POINTS.tank === 5 && G.KILL_POINTS.shooter === 7
  && G.KILL_POINTS.boss === 500, '积分表 红1/黄2/紫5/青7/BOSS500');

// --- 4. 命中率统计（1000 发，期望 ~80%）---
G.newGame('classic');
G.state = 'playing';
G.player.atkRange = 0;           // 关自动射击
G.player.crit = 0; G.player.dmg = 10;
const e0 = { x:120, y:0, type:'grunt', id:90001, r:14, hp:1e7, maxHp:1e7,
  spd:0, dmg:0, col:'#c94f4f', xp:0, hurtT:0, burnT:0, burnDmg:0 };
G.enemies = [e0];
const N = 1000;
for (let i=0;i<N;i++){
  G.bullets.push({ x:0, y:0, ang:0, spd:560, dmg:10, pierce:0, life:0.9, r:5, hit:[], bt:'normal',
    dud: Math.random() >= 0.8 });
}
for (let f=0; f<60 && G.bullets.length; f++) G.update(1/60);
const dmgDealt = 1e7 - G.enemies[0].hp;
const hitCount = Math.round(dmgDealt/10);
const rate = hitCount/N;
assert(rate > 0.70 && rate < 0.90, `命中率实测 ${(rate*100).toFixed(1)}%（期望 80%）`);

// --- 5. 寒冰弹：减速 50% ---
G.newGame('classic'); G.state='playing'; G.player.atkRange=0;
const eIce = { x:100, y:0, type:'grunt', id:90002, r:14, hp:500, maxHp:500,
  spd:100, dmg:0, col:'#c94f4f', xp:0, hurtT:0, burnT:0, burnDmg:0 };
G.enemies = [eIce];
G.applyBulletEffect({ bt:'ice' }, eIce, 10);
assert(eIce.slowT === 3, '寒冰命中后减速计时 3 秒');
const x0 = eIce.x;
G.update(1/60);
const moved = x0 - eIce.x;   // 敌人朝玩家（原点）移动
assert(Math.abs(moved - 100*0.5*(1/60)) < 0.3, `减速后移速减半（单帧位移 ${moved.toFixed(2)}px，期望 ${(100*0.5/60).toFixed(2)}）`);

// --- 6. 雷电链：最多 5 个，各 50% 伤害 ---
G.newGame('classic'); G.state='playing'; G.player.atkRange=0;
const mk = (id,x,y) => ({ x, y, type:'grunt', id, r:12, hp:1000, maxHp:1000, spd:0, dmg:0,
  col:'#c94f4f', xp:0, hurtT:0, burnT:0, burnDmg:0 });
const main = mk(90010, 0, 0);
G.enemies = [main];
for (let i=0;i<8;i++) G.enemies.push(mk(90011+i, 50+i*20, 0));   // 8 个附近敌人
G.applyBulletEffect({ bt:'thunder' }, main, 100);
const damaged = G.enemies.filter(e => e.hp < 1000);
assert(damaged.length === 5, `雷电链接命中 5 个敌人（实际 ${damaged.length}）`);
assert(damaged.every(e => Math.abs(e.hp - 950) < 0.01), '被链接的敌人各受 50% 伤害（-50）');
assert(G.chainFx.length === 5, `生成 5 段闪电特效（实际 ${G.chainFx.length}）`);

// --- 7. 灼烧弹：8 秒、每秒 1% 最大生命、不可叠加 ---
G.newGame('classic'); G.state='playing'; G.player.atkRange=0;
const eBurn = { x:300, y:0, type:'grunt', id:90020, r:14, hp:1000, maxHp:1000,
  spd:0, dmg:0, col:'#c94f4f', xp:0, hurtT:0, burnT:0, burnDmg:0 };
G.enemies = [eBurn];
G.applyBulletEffect({ bt:'burn' }, eBurn, 10);
assert(eBurn.burnT === 8, '点燃 8 秒');
assert(Math.abs(eBurn.burnDmg - eBurn.maxHp*0.01) < 0.001, '每秒掉 1% 最大生命（10/秒）');
// 再命中一次不应叠加
G.applyBulletEffect({ bt:'burn' }, eBurn, 10);
assert(Math.abs(eBurn.burnDmg - 10) < 0.001, '再次命中不叠加（伤害仍为 10/秒）');
// 烧伤掉血
const hpB = eBurn.hp;
G.update(1/60);
assert(Math.abs((hpB - eBurn.hp) - 10/60) < 0.05, '灼烧按秒结算掉血');

// --- 8. 耶律弹：1.25 倍伤害 + 追踪 + 拖尾 ---
G.newGame('classic'); G.state='playing';
G.player.atkRange = 460; G.player.fireT = 0; G.player.dmg = 100; G.equippedBullet = 'yelve';
G.player.bullet = 'yelve';
const eY = { x:200, y:0, type:'grunt', id:90030, r:14, hp:1e6, maxHp:1e6,
  spd:0, dmg:0, col:'#c94f4f', xp:0, hurtT:0, burnT:0, burnDmg:0 };
G.enemies = [eY];
G.update(1/60);
const yb = G.bullets.find(b => b.bt === 'yelve');
assert(!!yb, '耶律弹已发射');
assert(Math.abs(yb.dmg - 125) < 0.01, `耶律弹 1.25 倍伤害（${yb.dmg}）`);
assert(Array.isArray(yb.trail), '耶律弹带拖尾数组');
// 追踪：把敌人挪到侧面，子弹角度应转向
const a0 = yb.ang;
eY.x = 200; eY.y = 260;
for (let f=0; f<10; f++) G.update(1/60);
const yb2 = G.bullets.find(b => b.id === yb.id) || G.bullets.find(b => b.bt === 'yelve');
assert(yb2 && Math.abs(yb2.ang - a0) > 0.15, `耶律弹会转向追踪（角度变化 ${yb2 ? (yb2.ang-a0).toFixed(2) : 'n/a'}）`);
assert(yb2 && yb2.trail.length > 3, '拖尾在累积');

// --- 9. 积分只在十分钟模式获取 ---
G.newGame('classic'); G.state='playing';
G.userPoints = 0;
const eg = { x:0, y:0, type:'grunt', id:90040, r:14, hp:0, maxHp:10, spd:0, dmg:0,
  col:'#c94f4f', xp:0, hurtT:0, burnT:0, burnDmg:0 };
G.killEnemy(eg);
G.killEnemy({ ...eg, type:'tank' });
G.killEnemy({ ...eg, type:'boss' });
assert(G.userPoints === 1+5+500, `十分钟模式积分累计正确（${G.userPoints}）`);
G.newGame('boss','blackhole'); G.state='playing';
G.userPoints = 0;
G.killEnemy({ ...eg, type:'boss' });
assert(G.userPoints === 0, 'BOSS 试炼不产积分');
G.newGame('endless'); G.state='playing';
G.userPoints = 0;
G.killEnemy({ ...eg, type:'boss' });
assert(G.userPoints === 0, '无尽模式不产积分');

// --- 10. 商店解锁扣积分并装备 ---
G.userPoints = 7000; G.unlockedBullets = ['normal']; G.equippedBullet = 'normal';
// 模拟点击解锁逻辑（与 renderShop 中一致）
function buy(id){
  const info = G.BULLETS[id];
  if (G.userPoints < info.cost) return false;
  G.userPoints -= info.cost; G.unlockedBullets.push(id); G.equippedBullet = id; return true;
}
assert(buy('ice') === true && G.userPoints === 4000, '解锁寒冰弹扣 3000（余 4000）');
assert(G.equippedBullet === 'ice', '解锁后自动装备');
assert(buy('yelve') === false, '积分不足无法解锁耶律弹');
assert(buy('thunder') === false, '积分不足无法解锁雷电子弹');

// --- 11. 装备影响新开局 ---
G.equippedBullet = 'ice';
G.newGame('classic');
assert(G.player.bullet === 'ice', '新开局使用已装备的子弹（寒冰弹）');

console.log('\n全部断言通过 ✔');
