// 冒烟测试：BOSS 试炼封闭竞技场 + 黑洞怪攻速/小黑洞提速 + 狂暴弹幕反弹
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
  get holes(){ return holes; },
  get bullets(){ return bullets; },
  get player(){ return player; },
  get camX(){ return camX; }, get camY(){ return camY; },
  get state(){ return state; }, set state(v){ state = v; },
  get bossWarn(){ return bossWarn; }, set bossWarn(v){ bossWarn = v; },
  get gameTime(){ return gameTime; }, set gameTime(v){ gameTime = v; },
  BOSS_ARENA_HALF, spawnHole,
  newGame, update,
})`, sandbox);

const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };
const HF = G.BOSS_ARENA_HALF;
assert(HF === 650, `场地半宽常量 = ${HF}`);

// --- 开一局黑洞怪 BOSS 战 ---
G.newGame('boss', 'blackhole');
G.state = 'playing';
G.player.atkRange = 0;          // 关闭自动攻击，隔离测试
G.player.maxHp = 100; G.player.hp = 10000;   // 足量血量扛满测试时长（小黑洞伤害按 maxHp 百分比）

// --- BOSS 登场 ---
G.bossWarn = 0.01;
G.update(1/60);
const boss = G.enemies.find(e => e.type === 'bhboss');
assert(boss, '黑洞怪已登场');
assert(Math.abs(boss.castT - (1.47 - 1/60)) < 0.01, `攻速 +70%：castT = ${boss.castT.toFixed(3)}（初始 1.47，已扣一帧）`);

// --- 小黑洞移速 +50% ---
G.spawnHole(boss);
const h = G.holes[G.holes.length-1];
assert(Math.abs(h.spd - (30 - h.r*0.25)*1.5) < 0.01, `小黑洞移速 +50%：spd=${h.spd}（r=${h.r}）`);
assert(Math.abs(h.x) <= HF && Math.abs(h.y) <= HF, '小黑洞出生在场地内');

// --- 玩家位置夹紧 ---
G.player.x = 1000; G.player.y = -2000;
G.update(1/60);
assert(G.player.x <= HF - 14 && G.player.y >= -(HF - 14), `玩家被夹紧（x=${G.player.x.toFixed(1)}, y=${G.player.y.toFixed(1)}）`);

// --- 相机夹紧 ---
G.player.x = 600; G.player.y = 0;
G.update(1/60);
assert(G.camX <= HF - 1280 + 0.01, `相机右边界夹紧 camX=${G.camX.toFixed(1)}（上限 ${HF-1280}）`);

// --- 敌弹反弹：3 次反弹后第 4 次撞墙销毁 ---
// 玩家挪到 (400,400)，弹丸沿 x=0 纵向飞行，路径不经过玩家
G.player.x = 400; G.player.y = 400;
G.enemies.push({ x:0, y:600, type:'ebullet', id:88881, ang:-Math.PI/2, r:9, hp:1, maxHp:1,
  spd:175, dmg:14, col:'#a97cff', xp:0, life:9999, hurtT:0, burnT:0, burnDmg:0, trail:[], bounce:3 });
let bounces = 0, alive = true, prevAng = -Math.PI/2;   // 与弹丸初始朝向一致，避免误计
for (let f=0; f<6000 && alive; f++){
  G.update(1/60);
  const b = G.enemies.find(e => e.id === 88881);
  if (!b){ alive = false; break; }
  if (Math.abs(b.ang - prevAng) > 0.01){ bounces++; prevAng = b.ang; }
  assert(Math.abs(b.x) <= HF, '反弹弹幕未飞出场地');
}
assert(bounces === 3, `恰好反弹 3 次（实际 ${bounces}）`);
assert(!alive, '第 4 次撞墙后销毁');

// --- 无反弹标记的敌弹撞墙即碎 ---
G.enemies.push({ x:600, y:300, type:'ebullet', id:88882, ang:0, r:7, hp:1, maxHp:1,
  spd:200, dmg:15, col:'#ff8aa8', xp:0, life:9999, hurtT:0, burnT:0, burnDmg:0 });
let died = false;
for (let f=0; f<600; f++){
  G.update(1/60);
  if (!G.enemies.some(e => e.id === 88882)){ died = true; break; }
}
assert(died, '普通敌弹撞墙即碎');

console.log('\n全部断言通过 ✔');
