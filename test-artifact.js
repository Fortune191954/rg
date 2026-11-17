// 冒烟测试：神器抽奖（5000/次）+ 五件神器能力
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
  localStorage: { _s:{},
    getItem(k){ return k in this._s ? this._s[k] : null; },
    setItem(k,v){ this._s[k] = String(v); },
    removeItem(k){ delete this._s[k]; } },
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
  get gems(){ return gems; },
  get bullets(){ return bullets; },
  get player(){ return player; }, set player(v){ player = v; },
  get state(){ return state; }, set state(v){ state = v; },
  get kills(){ return kills; }, set kills(v){ kills = v; },
  get userPoints(){ return userPoints; }, set userPoints(v){ userPoints = v; },
  get ownedArtifacts(){ return ownedArtifacts; }, set ownedArtifacts(v){ ownedArtifacts = v; },
  get equippedArtifact(){ return equippedArtifact; }, set equippedArtifact(v){ equippedArtifact = v; },
  newGame, update, killEnemy, drawArtifact, renderArtifacts, saveProgress,
  ARTIFACTS, ARTIFACT_ORDER, ARTIFACT_COST, UPGRADES, ORB_MAX,
})`, sandbox);
const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };

// ============ 一、神器配置 ============
assert(G.ARTIFACT_COST === 5000, '抽一次 5000 积分');
assert(G.ARTIFACT_ORDER.length === 5, '五件神器');
for (const id of G.ARTIFACT_ORDER){
  const a = G.ARTIFACTS[id];
  assert(!!a && !!a.name && !!a.desc && typeof a.apply === 'function', `神器 ${id} 配置完整（${a && a.name}）`);
}
assert(!G.UPGRADES.find(u => /爽煎滑蛋|坦克引擎|护体旋风/.test(u.name)),
  '普通强化池不再包含已移入神器的三项');

// ============ 二、抽奖 ============
G.userPoints = 12000;
G.ownedArtifacts = []; G.equippedArtifact = '';
const id1 = G.drawArtifact();
assert(!!id1 && G.ownedArtifacts.length === 1, `抽到第 1 件神器（${id1}）`);
assert(G.userPoints === 7000, `扣除 5000 积分（余 ${G.userPoints}）`);
assert(G.equippedArtifact === id1, '首抽自动装备');
const id2 = G.drawArtifact();
assert(id2 && id2 !== id1, `不会抽到已拥有的神器（${id1} → ${id2}）`);
assert(G.userPoints === 2000, '第二抽再扣 5000');
const before = G.ownedArtifacts.length;
const id3 = G.drawArtifact();
assert(id3 === null && G.ownedArtifacts.length === before, '积分不足（2000 < 5000）无法抽取');
assert(G.userPoints === 2000, '积分不足时不扣分');
assert(els['artMsg'].textContent.includes('积分不足'), `给出积分不足提示（${els['artMsg'].textContent}）`);

// 存档包含神器
G.saveProgress();
const snap = JSON.parse(sandbox.localStorage._s['rg_profile_v2'] || '{}');
assert(snap.artifacts && snap.artifacts.length === 2, '神器写入本机存档');
assert(snap.artifact === G.equippedArtifact && snap.artifact === id1,
  `装备神器写入存档（已装备 ${snap.artifact}，第二抽不自动换装）`);

// ============ 三、水思面具（原爽煎滑蛋） ============
G.ownedArtifacts = ['mask']; G.equippedArtifact = 'mask';
G.newGame('classic');
assert(G.player.slashMode === true, '水思面具：普攻变为斩击');
assert(Math.abs(G.player.speed - 200*1.15) < 1e-6, `水思面具：移速 +15%（${G.player.speed}）`);
assert(G.player.artifact === 'mask', '神器标记写入本局玩家');

// ============ 四、心之钢（原坦克引擎） ============
G.equippedArtifact = 'steel'; G.newGame('classic');
assert(G.player.maxHp === 200 && G.player.hp === 200, `心之钢：生命上限翻倍并回满（${G.player.maxHp}）`);
assert(G.player.atkRange === 156, '心之钢：攻击距离缩短到 156');
assert(G.player.killHpBase === 200, '心之钢：记录击杀成长基准血量');

// ============ 五、养剑葫 ============
G.equippedArtifact = 'gourd'; G.newGame('classic');
assert(G.player.swords === 2, '养剑葫：初始 2 把飞剑');
G.kills = 99;
G.killEnemy({ type:'grunt', x:0, y:0, r:10, hp:0, maxHp:0, col:'#fff', xp:0 });
assert(G.kills === 100 && G.player.swords === 3, `第 100 次击杀新增 1 把（${G.player.swords} 把）`);
G.player.swords = 7; G.kills = 199;
G.killEnemy({ type:'grunt', x:0, y:0, r:10, hp:0, maxHp:0, col:'#fff', xp:0 });
assert(G.player.swords === 7, '飞剑数量上限 7 把');

// 飞剑命中伤害
G.newGame('classic');
G.equippedArtifact = 'gourd'; G.newGame('classic');
G.player.invul = 999; G.player.swordAngle = 0;
const swordTarget = { x:82, y:0, type:'grunt', id:99001, r:14, hp:1000, maxHp:1000,
  spd:0, dmg:0, col:'#c94f4f', xp:0, hurtT:0, burnT:0, burnDmg:0 };
G.enemies = [swordTarget];
G.update(1/60);
assert(swordTarget.hp < 1000, `飞剑碰到敌人造成伤害（${Math.round(1000 - swordTarget.hp)}）`);

// 飞剑追踪：敌人放在上方，飞剑应离开环绕轨道主动扑过去
G.equippedArtifact = 'gourd'; G.newGame('classic');
G.player.invul = 999;
const chaseT = { x:0, y:-300, type:'grunt', id:99010, r:14, hp:5000, maxHp:5000,
  spd:0, dmg:0, col:'#c94f4f', xp:0, hurtT:0, burnT:0, burnDmg:0 };
G.enemies = [chaseT];
G.update(1/60);
const spA = G.player.swordPos[0];
const dA = Math.hypot(spA.x-chaseT.x, spA.y-chaseT.y);
for (let i=0;i<12;i++) G.update(1/60);
const spB = G.player.swordPos[0];
const dB = Math.hypot(spB.x-chaseT.x, spB.y-chaseT.y);
assert(dB < dA - 60, `飞剑会追踪敌人（距离 ${dA.toFixed(0)} → ${dB.toFixed(0)}）`);
assert(spB.trail.length > 3, '飞剑拖尾记录真实飞行轨迹');
// 敌人清空后回到环绕轨道
G.enemies = [];
for (let i=0;i<70;i++) G.update(1/60);
const spC = G.player.swordPos[0];
const orbitD = Math.hypot(spC.x-G.player.x, spC.y-G.player.y);
assert(Math.abs(orbitD - 82) < 6, `无敌人时飞剑归位环绕（距玩家 ${orbitD.toFixed(1)}px）`);

// ============ 六、崩崩乐 ============
G.equippedArtifact = 'boom'; G.newGame('classic');
assert(G.player.noAttack === true, '崩崩乐：无法攻击');
assert(G.player.maxHp === 1100, `崩崩乐：生命上限 +1000%（${G.player.maxHp}）`);
assert(Math.abs(G.player.armor - 0.45) < 1e-9, `崩崩乐：55% 伤害减免（受伤倍率 ${G.player.armor}）`);
// 不发射子弹
G.player.fireT = 0; G.player.invul = 999;
G.enemies = [{ x:300, y:0, type:'grunt', id:99002, r:14, hp:9999, maxHp:9999,
  spd:0, dmg:0, col:'#c94f4f', xp:0, hurtT:0, burnT:0, burnDmg:0 }];
for (let i=0;i<10;i++) G.update(1/60);
assert(G.bullets.length === 0, '崩崩乐：全程不发射子弹');
// 撞击伤害
G.player.x = 0; G.player.y = 0;
const bumpTarget = { x:0, y:0, type:'grunt', id:99003, r:14, hp:100, maxHp:100,
  spd:0, dmg:0, col:'#c94f4f', xp:0, hurtT:0, burnT:0, burnDmg:0 };
G.enemies = [bumpTarget];
G.player.hp = 5000; G.player.maxHp = 5000; G.player.invul = 0;
G.update(1/60);
assert(bumpTarget.hp === 70, `崩崩乐：撞击造成 30 伤害（剩 ${bumpTarget.hp}）`);

// ============ 七、呼呼符 ============
G.equippedArtifact = 'charm'; G.newGame('classic');
assert(G.player.orbs === 1 && G.player.orbHp.join() === '2', '呼呼符：1 面可挡 2 次的护体护盾');
assert(G.ORB_MAX === 3, '护盾上限 3 面');
G.player.orbT = 0; G.update(1/60);
assert(G.player.orbs === 2 && G.player.orbHp.length === 2, `45 秒后 +1 面（${G.player.orbs} 面）`);
G.player.orbT = 0; G.update(1/60);
assert(G.player.orbs === 3 && G.player.orbHp.length === 3, `再来 45 秒到 3 面（${G.player.orbs} 面）`);
G.player.orbT = 0; G.update(1/60);
assert(G.player.orbs === 3 && G.player.orbHp.length === 3, '3 面后不再增加（上限生效）');

// ============ 八、不装备神器 = 无效果 ============
G.equippedArtifact = ''; G.newGame('classic');
assert(G.player.swords === 0 && !G.player.slashMode && !G.player.noAttack && G.player.orbs === 0,
  '未装备神器时没有任何神器效果');

console.log('\n全部断言通过 ✔');
