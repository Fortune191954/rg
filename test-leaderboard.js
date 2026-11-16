// 冒烟测试：随机玩家ID + 排行榜（本机降级路径）+ 各模式积分
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
    querySelectorAll(){ return []; },
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
const m = html.match(/<script>([\s\S]*?)<\/script>/);
vm.runInContext(m[1], sandbox, { filename: 'rg_game.js' });

const G = vm.runInContext(`({
  get playerId(){ return playerId; },
  ensurePlayerId, genPlayerId, submitScore, lbFetch, dedupeLB, loadLocalLB, saveLocalLB,
  endGame, newGame, killEnemy, LB_BOARDS,
  get lastLbBoard(){ return lastLbBoard; },
  get player(){ return player; },
  get mode(){ return mode; }, set mode(v){ mode = v; },
  get gameTime(){ return gameTime; }, set gameTime(v){ gameTime = v; },
  get runPoints(){ return runPoints; }, set runPoints(v){ runPoints = v; },
  get userPoints(){ return userPoints; }, set userPoints(v){ userPoints = v; },
  get kills(){ return kills; }, set kills(v){ kills = v; },
  get lbStatus(){ return lbStatus; },
  get state(){ return state; },
})`, sandbox);

const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };

const mkEnemy = (type, xp) => ({ x:0, y:0, type, id:1, r:12, hp:1, maxHp:1, spd:0, dmg:0,
  col:'#c94f4f', xp, hurtT:0, burnT:0, burnDmg:0 });

(async ()=>{
  // --- 1. 随机 ID ---
  assert(/^[A-Za-z]{2}$/.test(G.playerId), `玩家ID格式正确（${G.playerId}）`);
  assert(sandbox.localStorage.getItem('rg_player_id_v1') === G.playerId, 'ID 已写入本机存档');
  assert(G.ensurePlayerId() === G.playerId, '重复调用不换 ID（幂等）');

  let hasUpper = false, hasLower = false, ok = true;
  for (let i=0;i<3000;i++){
    const id = G.genPlayerId();
    if (!/^[A-Za-z]{2}$/.test(id)) ok = false;
    if (/[A-Z]/.test(id)) hasUpper = true;
    if (/[a-z]/.test(id)) hasLower = true;
  }
  assert(ok, '生成 3000 次全部符合两位字母');
  assert(hasUpper && hasLower, '大小写字母都会出现');

  // --- 2. 各模式积分 ---
  G.newGame('classic');
  G.runPoints = 0; G.userPoints = 0;
  G.killEnemy(mkEnemy('tank', 0));
  assert(G.runPoints === 5, `十分钟：紫怪 +5 本局积分（${G.runPoints}）`);
  assert(G.userPoints === 5, `十分钟：余额同时 +5（${G.userPoints}）`);

  G.newGame('endless');
  G.runPoints = 0; G.userPoints = 0;
  G.killEnemy(mkEnemy('shooter', 0));
  G.killEnemy(mkEnemy('boss', 0));   // BOSS 在无尽模式会继续游戏，这里只验证积分
  assert(G.runPoints === 507, `无尽：青怪 7 + BOSS 500 计入本局积分（${G.runPoints}）`);
  assert(G.userPoints === 0, '无尽：不计入可消费余额（仍需十分钟模式赚积分）');

  // --- 3. 提交与去重 ---
  sandbox.localStorage.removeItem('rg_lb_local_v1');
  G.submitScore('endless', null, 120, 300, 40, 9);
  G.submitScore('endless', null, 300, 420, 80, 14);
  G.submitScore('boss', 'blackhole', 60, 95, 12, 4);
  const local = G.loadLocalLB();
  assert(local.length === 3, `本机榜记录 3 条（${local.length}）`);
  assert(local.every(r => r.player_id === G.playerId), '记录都带玩家ID');
  const latest = local[0];
  assert(latest.mode === 'boss' && latest.points === 60 && latest.duration === 95, `最新一条在最前（${latest.mode} ${latest.points}分 ${latest.duration}s）`);

  const dedup = G.dedupeLB([
    { player_id:'Aa', points:300, duration:400 },
    { player_id:'Aa', points:120, duration:100 },
    { player_id:'Bb', points:200, duration:900 },
    { player_id:'Cc', points:50,  duration:50  },
  ]);
  assert(dedup.length === 3, `同一玩家只保留一条（${dedup.length}）`);
  assert(dedup[0].player_id === 'Aa' && dedup[0].points === 300, '保留的是排序靠前（最佳）成绩');

  const rows = await G.lbFetch('endless_points');
  assert(G.lbStatus.endless_points === 'local', '云端不可用时标记为本机榜');
  assert(rows.length === 1, `本机榜按玩家去重后 1 条（${rows.length}）`);
  assert(rows[0].points === 300, `无尽积分榜取最高分（${rows[0].points}）`);

  const trows = await G.lbFetch('boss_time_bh');
  assert(trows.length === 1 && trows[0].duration === 95, `黑洞最快击杀榜（${trows[0] && trows[0].duration}s）`);
  assert((await G.lbFetch('boss_time_blade')).length === 0, '血刃榜与黑洞榜分开统计（血刃暂无记录）');

  // --- 4. 结算自动提交 ---
  sandbox.localStorage.removeItem('rg_lb_local_v1');
  G.newGame('endless');
  G.gameTime = 725; G.kills = 33; G.runPoints = 210;
  G.endGame(false);
  let after = G.loadLocalLB();
  assert(after.length === 1 && after[0].mode === 'endless', '无尽结算自动上榜');
  assert(after[0].duration === 725 && after[0].points === 210, `时长/积分取当局值（${after[0].duration}s / ${after[0].points}）`);

  G.newGame('boss', 'blackhole');
  G.gameTime = 154; G.kills = 9; G.runPoints = 45;
  G.endGame(true);
  after = G.loadLocalLB();
  const bossRec = after.find(r => r.mode === 'boss');
  assert(!!bossRec, 'BOSS 结算自动上榜');
  assert(bossRec.duration === 154 && bossRec.boss === 'blackhole', `BOSS 榜记下时长与 BOSS 类型（${bossRec.duration}s / ${bossRec.boss}）`);

  const bp = await G.lbFetch('boss_points');
  assert(bp.length === 1 && bp[0].points === 45 + 2000, `BOSS 积分榜可读（击杀 45 + 通关奖励 2000 = ${bp[0] && bp[0].points}）`);
  assert(bossRec.win === true, '通关记录 win=true');
  assert(G.lastLbBoard === 'boss_time_bh', `通关后默认跳到该 BOSS 的最快击杀榜（${G.lastLbBoard}）`);

  // --- 4.5 最快击杀榜：只算击杀成功，取最短用时 ---
  G.submitScore('boss', 'blackhole', 12, 30, 2, 1, false);      // 30 秒被打死 → 不算
  let bh = await G.lbFetch('boss_time_bh');
  assert(bh.length === 1 && bh[0].duration === 154, `失败局不进最快击杀榜（仍 ${bh[0] && bh[0].duration}s）`);
  G.submitScore('boss', 'blackhole', 2060, 88, 15, 6, true);    // 88 秒击杀成功
  bh = await G.lbFetch('boss_time_bh');
  assert(bh.length === 1 && bh[0].duration === 88, `同一玩家只保留最快成绩（${bh[0] && bh[0].duration}s）`);
  G.submitScore('boss', 'blade', 2010, 120, 11, 5, true);
  assert((await G.lbFetch('boss_time_blade'))[0].duration === 120, '血刃榜独立记录（120s）');
  assert((await G.lbFetch('boss_time_bh'))[0].duration === 88, '血刃成绩不会串到黑洞榜');

  // --- 5. 失败局：不计入最快击杀榜 ---
  G.newGame('boss', 'blade');
  G.gameTime = 40; G.kills = 3; G.runPoints = 5;
  G.endGame(false);
  after = G.loadLocalLB();
  const failRec = after.find(r => r.mode === 'boss' && r.boss === 'blade');
  assert(!!failRec && failRec.win === false, 'BOSS 失败记录标记 win=false');
  assert(G.lastLbBoard === 'boss_points', '失败后跳到 BOSS 积分榜（不进时长榜）');
  const bladeRows = await G.lbFetch('boss_time_blade');
  assert(bladeRows.length === 1 && bladeRows[0].duration === 120, `失败局未污染血刃榜（${bladeRows[0] && bladeRows[0].duration}s）`);

  console.log('\n全部通过：随机ID + 排行榜 + 各模式积分');
})();
