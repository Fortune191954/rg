// 冒烟测试：状态栏 + 护体旋风球格挡 + BOSS 试炼付费/奖励
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
  get player(){ return player; }, set player(v){ player = v; },
  get mode(){ return mode; }, set mode(v){ mode = v; },
  get state(){ return state; }, set state(v){ state = v; },
  get userPoints(){ return userPoints; }, set userPoints(v){ userPoints = v; },
  get runPoints(){ return runPoints; }, set runPoints(v){ runPoints = v; },
  get gameTime(){ return gameTime; }, set gameTime(v){ gameTime = v; },
  get kills(){ return kills; }, set kills(v){ kills = v; },
  newGame, update, endGame, updateStatusBar, resetStatusBar,
  hurtPlayer, orbGuardHit, startBoss, enterBossPick, retry,
  ORB_GUARD, BOSS_ENTRY_COST, BOSS_WIN_REWARD, UPGRADES, ARTIFACTS,
})`, sandbox);
const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };
const S = () => els['statbar'];

// ============ 一、状态栏 ============
G.newGame('classic');
G.state = 'playing';
G.player.orbs = 2; G.player.orbHp = [2, 1];
G.player.dmg = 12.5; G.player.speed = 224; G.player.crit = 0.15;
G.updateStatusBar();
let h = S().innerHTML;
assert(h.includes('攻击') && h.includes('12.5'), '状态栏显示攻击力');
assert(h.includes('攻速') && h.includes('/s'), '状态栏显示攻速');
assert(h.includes('多重') && h.includes('穿透') && h.includes('暴击'), '状态栏显示多重/穿透/暴击');
assert(h.includes('移速') && h.includes('224'), '状态栏显示移速');
assert(h.includes('减伤'), '状态栏显示减伤');
assert(h.includes('2 颗 · 挡 3 次'), `状态栏显示旋风球数量与剩余格挡次数（${h.match(/旋风[^<]*/)}）`);
assert(h.includes('普通弹'), '状态栏显示当前子弹');

// 值不变时不重写 DOM（节流）
S().innerHTML = 'MARK';
G.updateStatusBar();
assert(S().innerHTML === 'MARK', '属性未变化时不重写 DOM');

// 属性变化 → 重新渲染
G.player.dmg = 30;
G.updateStatusBar();
assert(S().innerHTML.includes('30.0'), '属性变化后状态栏刷新');

// 斩击流：显示普攻形态
G.player.slashMode = true; G.player.slashEnergy = 0;
G.updateStatusBar();
assert(S().innerHTML.includes('斩击'), '斩击流在状态栏标注普攻形态');
G.player.slashEnergy = 8;
G.updateStatusBar();
assert(S().innerHTML.includes('八向就绪'), '八向斩击就绪时状态栏提示');

// ============ 二、护体旋风球格挡 ============
assert(G.ORB_GUARD === 2, '每颗球可挡 2 次（ORB_GUARD = 2）');

G.newGame('classic');
G.state = 'playing';
G.player.hp = 100; G.player.maxHp = 100;

// 无球：正常受伤
G.player.invul = 0;
G.hurtPlayer(30, 0.5, 8);
assert(Math.abs(G.player.hp - 70) < 0.01, `无旋风球时正常扣血（hp=${G.player.hp}）`);

// 有 1 颗球（2 次）：前两次完全免伤
G.player.orbs = 1; G.player.orbHp = [2];
G.player.invul = 0;
G.hurtPlayer(30, 0.5, 8);
assert(Math.abs(G.player.hp - 70) < 0.01, `第 1 次伤害被球挡下，不掉血（hp=${G.player.hp}）`);
assert(G.player.orbs === 1 && G.player.orbHp[0] === 1, '球剩 1 次格挡，未消失');

G.player.invul = 0;
G.hurtPlayer(30, 0.5, 8);
assert(Math.abs(G.player.hp - 70) < 0.01, `第 2 次伤害同样被挡下（hp=${G.player.hp}）`);
assert(G.player.orbs === 0 && G.player.orbHp.length === 0, '挡满 2 次后球碎裂消失');

// 球碎之后正常受伤
G.player.invul = 0;
G.hurtPlayer(30, 0.5, 8);
assert(Math.abs(G.player.hp - 40) < 0.01, `球碎后恢复受伤（hp=${G.player.hp}）`);

// 多球：按顺序消耗，只消耗一颗
G.player.orbs = 3; G.player.orbHp = [2, 2, 2];
G.player.hp = 100; G.player.invul = 0;
G.hurtPlayer(20, 0.5, 8);
assert(G.player.orbs === 3 && G.player.orbHp.join() === '1,2,2', `只消耗一颗球的 1 次（${G.player.orbHp.join()}）`);
G.player.invul = 0; G.hurtPlayer(20, 0.5, 8);
assert(G.player.orbs === 2 && G.player.orbHp.join() === '2,2', `第 2 次后该球消失，剩 2 颗（${G.player.orbHp.join()}）`);
assert(Math.abs(G.player.hp - 100) < 0.01, '两次伤害全部被挡，血量不变');

// 真实碰撞：敌人贴脸 → 球格挡
G.newGame('classic');
G.state = 'playing';
G.player.hp = 100; G.player.orbs = 1; G.player.orbHp = [2]; G.player.invul = 0;
G.player.atkRange = 0;
G.enemies.push({ x: G.player.x, y: G.player.y, type:'grunt', id: 777, r: 14,
  hp: 9999, maxHp: 9999, spd: 0, dmg: 20, col:'#c94f4f', xp: 0,
  hurtT: 0, burnT: 0, burnDmg: 0 });
G.update(1/60);
assert(Math.abs(G.player.hp - 100) < 0.01, `敌人碰撞被球挡下，不掉血（hp=${G.player.hp}）`);
assert(G.player.orbHp[0] === 1, '碰撞消耗 1 次格挡');

// 45 秒成长：新球自带 2 次格挡
G.newGame('classic');
G.state = 'playing';
G.player.hp = 100000; G.player.maxHp = 100000;
G.player.orbs = 1; G.player.orbHp = [2]; G.player.orbT = 0.4;
G.player.invul = 999;
let t = 0;
while (t < 1){ G.update(1/60); t += 1/60; }
assert(G.player.orbs === 2, `45 秒到点后多 1 颗球（当前 ${G.player.orbs} 颗）`);
assert(G.player.orbHp.join() === '2,2', `新球自带 2 次格挡（${G.player.orbHp.join()}）`);

// 护体旋风已移入神器「呼呼符」：普通强化不再出现，能力由神器提供
const orbUp = G.UPGRADES.find(u => u.name === '护体旋风');
assert(!orbUp, '普通强化池已移除护体旋风');
const charm = G.ARTIFACTS.charm;
assert(!!charm && charm.desc.includes('挡 2 次'), '神器「呼呼符」说明已写明格挡机制');
G.newGame('classic');
charm.apply(G.player);
assert(G.player.orbs === 1 && G.player.orbHp.join() === '2', '装备呼呼符后获得 1 颗 2 次格挡的球');

// ============ 三、BOSS 试炼：500 积分挑战 / 2000 奖励 ============
assert(G.BOSS_ENTRY_COST === 500, '挑战消耗常量 = 500');
assert(G.BOSS_WIN_REWARD === 2000, '成功奖励常量 = 2000');

G.newGame('classic');
G.state = 'menu';
G.enterBossPick();
assert(els['bossWallet'].innerHTML.includes('挑战消耗') && els['bossWallet'].innerHTML.includes('500'),
  'BOSS 选择页显示消耗与奖励说明');

// 积分不足
G.userPoints = 100;
const ok1 = G.startBoss('blackhole');
assert(ok1 === false, '积分不足（100 < 500）无法开始挑战');
assert(G.userPoints === 100, '积分不足时不扣分');
assert(G.state !== 'playing', '未进入战斗');
assert(els['bossMsg'].textContent.includes('积分不足'), `给出积分不足提示：${els['bossMsg'].textContent}`);
assert(els['bossMsg'].textContent.includes('还差 400'), '提示中给出差额');

// 刚好够
G.userPoints = 500;
const ok2 = G.startBoss('blackhole');
assert(ok2 === true, '积分刚好 500 可以开始挑战');
assert(G.userPoints === 0, `开始挑战扣掉 500（余 ${G.userPoints}）`);
assert(G.state === 'playing', '进入战斗');

// 胜利奖励
G.newGame('boss', 'blackhole');
G.state = 'playing';
G.userPoints = 300; G.runPoints = 0; G.gameTime = 100; G.kills = 5;
G.endGame(true);
assert(G.userPoints === 2300, `挑战成功 +2000 积分（当前 ${G.userPoints}）`);
assert(G.runPoints === 2000, `奖励同时计入本局积分（${G.runPoints}）`);

// 失败无奖励
G.newGame('boss', 'blackhole');
G.state = 'playing';
G.userPoints = 300; G.runPoints = 0; G.gameTime = 60; G.kills = 3;
G.endGame(false);
assert(G.userPoints === 300, `挑战失败不奖励也不返还（当前 ${G.userPoints}）`);
assert(G.runPoints === 0, '失败时本局积分不加奖励');

// 结算页文案
assert(els['endInfo'].innerHTML.includes('挑战失败'), '失败结算提示消耗积分');
G.newGame('boss', 'blackhole'); G.state = 'playing';
G.userPoints = 0; G.runPoints = 0;
G.endGame(true);
assert(els['endInfo'].innerHTML.includes('挑战成功') && els['endInfo'].innerHTML.includes('+2000'),
  '成功结算提示 +2000 积分');
assert(els['endInfo'].innerHTML.includes('净赚 1500'), '成功结算给出净赚 1500');

// 再来一局也要扣分（积分不够则回到选 BOSS 页并提示）
G.userPoints = 800;
G.lastMode = 'boss';
G.startBoss('blade');
assert(G.userPoints === 300, `再来一局同样扣 500（余 ${G.userPoints}）`);
G.state = 'end';
G.retry();     // 余 300 < 500 → 回选 BOSS 页
assert(G.userPoints === 300 && els['bossMsg'].textContent.includes('积分不足'),
  '积分不足时"再来一局"回到选 BOSS 页并提示，不扣分');

console.log('\n全部断言通过 ✔');
