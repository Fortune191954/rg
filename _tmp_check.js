
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
let W, H, dpr = 1;
let viewScale = 1;              // 世界缩放：手机拉远以扩大视野，桌面保持 1
const REF_AREA = 1280 * 720;    // 桌面参考可视面积

function computeViewScale(){
  if (innerWidth >= 1000) { viewScale = 1; return; }      // 桌面/横屏大屏不缩放
  const s = Math.sqrt((innerWidth * innerHeight) / REF_AREA);
  viewScale = Math.min(1, Math.max(0.72, s));            // 手机适中：最小 0.72
}

function resize(){
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 高清渲染，逻辑坐标仍用 CSS 像素
  computeViewScale();
}
addEventListener('resize', resize); resize();

const GAME_TIME = 600;      // 整局 10 分钟（秒）
const BOSS_TIME = 480;      // 第 8 分钟刷最终 BOSS，留 2 分钟 BOSS 战
const SLASH_ARC = 0.26;     // 斩击半角（约 30° 扇面，收窄以换更远射程）
const SLASH_RADIUS = 300;   // 斩击射程（原 200，提升 50%）
const SLASH8_RADIUS = 330;  // 八向斩击半径
const SLASH_CHARGE = 8;     // 移动充能满 8 秒释放八向斩击
const HP_GROWTH = 0.60;     // 敌人血量随时间成长的总量下调 40%（原为 1.0）
const MAX_ALIVE = 160;      // 场上存活敌人上限（防止刷太快导致卡顿）
const BOSS_UPGRADE_T = 30;  // BOSS 战：每 30 秒给一次强化
const MAX_UPGRADES = 10;    // BOSS 战：强化次数上限
const ORB_GUARD = 2;        // 护体旋风球：每颗可为玩家抵挡 2 次伤害，挡满即碎
const BOSS_ENTRY_COST = 500;   // BOSS 试炼：每次挑战消耗积分
const BOSS_WIN_REWARD = 2000;  // BOSS 试炼：挑战成功奖励积分
const BH_WARN = 3.2;        // BOSS 登场前提示时长
const BH_HP = 2000;         // 黑洞怪初始血量
const BH_R0 = 58;           // 黑洞怪基础半径
const HOLE_MAX = 5;         // 小黑洞数量上限
const BOSS_SLOW = 0.65;     // BOSS 登场后玩家移速倍率（-35%）
const ENDLESS_BOSS_T = 180; // 无尽模式：每 3 分钟刷一个 BOSS
const BOSS_ARENA_HALF = 650; // BOSS 试炼场地半宽（1300×1300 的封闭竞技场）

// ---------- 子弹系统（商店解锁，任何模式可用） ----------
// 所有子弹命中率统一 80%（20% 概率穿过敌人不造成伤害与效果）
const HIT_RATE = 0.8;
const BULLETS = {
  normal:  { icon:'•',  name:'普通弹',   cost:0,    desc:'标准弹药，稳定可靠', color:'#bfe6ff' },
  ice:     { icon:'❄',  name:'寒冰弹',   cost:3000, desc:'命中减速 50%（移速 + 攻速，持续 3 秒），伤害与普通弹相同', color:'#7fd8ff' },
  thunder: { icon:'⚡',  name:'雷电子弹', cost:4500, desc:'命中后雷电链接附近最多 5 个敌人，各受 50% 伤害', color:'#a8b8ff' },
  burn:    { icon:'🔥',  name:'灼烧弹',   cost:5000, desc:'点燃 8 秒，每秒掉 0.5% 最大生命值（不可叠加）', color:'#ff9a5c' },
  yelve:   { icon:'☄',  name:'耶律弹',   cost:6000, desc:'自动追踪敌人，伤害 1.25 倍，带长绿色拖尾', color:'#6dff9e' },
};
const BULLET_ORDER = ['normal','ice','thunder','burn','yelve'];
// 击杀积分：红1 / 黄2 / 紫5 / 青7 / BOSS 500（仅十分钟模式获取）
const KILL_POINTS = { grunt:1, fast:2, tank:5, shooter:7, boss:500, bhboss:500 };
// 玩家进度（跨局持久化：本机多通道 + 云端按设备密钥同步）
let userPoints = 0;                       // 总积分（余额）
let unlockedBullets = ['normal'];         // 已解锁子弹
let equippedBullet = 'normal';            // 当前装备
let runPoints = 0;                        // 本局获得积分
let chainFx = [];                         // 雷电链特效
let saveT = 0, progressDirty = false;     // 进度节流存盘
let profileRev = 0;                       // 存档版本号（云端比较新旧用）
var cloudDirty = false;                   // 有未推送的改动
let cloudBusy = false, cloudSyncState = 'idle', cloudLastPush = 0, cloudSaveT = 0;

// ---------- 多通道存储（本机存档可能被浏览器禁用，逐级降级） ----------
// 关键：隐私模式 / 受限 iframe 里 localStorage 会抛异常，直接读写会静默失败，
// 导致「一刷新 ID 和积分全丢」。这里按 localStorage → sessionStorage → cookie → 内存
// 逐级兜底，并且真机探测可用性（写入后读回）。
const Store = (()=>{
  const mem = Object.create(null);
  let ls = null, ss = null;
  function probe(s){
    try {
      const k = '__rg_probe__';
      s.setItem(k, '1');
      const ok = s.getItem(k) === '1';
      s.removeItem(k);
      return ok;
    } catch(_){ return false; }
  }
  try { if (typeof localStorage !== 'undefined' && probe(localStorage)) ls = localStorage; } catch(_){}
  try { if (typeof sessionStorage !== 'undefined' && probe(sessionStorage)) ss = sessionStorage; } catch(_){}
  const CK = '__rg_ck__';
  const cookieOK = (()=>{
    try {
      document.cookie = CK + '=1;path=/;max-age=120;SameSite=Lax';
      const ok = document.cookie.indexOf(CK + '=1') >= 0;
      document.cookie = CK + '=;path=/;max-age=0;SameSite=Lax';
      return ok;
    } catch(_){ return false; }
  })();
  function ckGet(k){
    try {
      const m = document.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch(_){ return null; }
  }
  function ckSet(k, v){
    try { document.cookie = k + '=' + encodeURIComponent(v) + ';path=/;max-age=31536000;SameSite=Lax'; } catch(_){}
  }
  function ckDel(k){ try { document.cookie = k + '=;path=/;max-age=0;SameSite=Lax'; } catch(_){} }
  return {
    get(k){
      if (ls){ try { const v = ls.getItem(k); if (v !== null) return v; } catch(_){} }
      if (ss){ try { const v = ss.getItem(k); if (v !== null) return v; } catch(_){} }
      const c = ckGet(k);
      if (c !== null) return c;
      // 内存副本只在本机通道全都不可用时兜底，避免主通道清空后读到陈旧值
      if (!ls && !ss && !cookieOK) return k in mem ? mem[k] : null;
      return null;
    },
    set(k, v){
      mem[k] = v;
      if (ls){ try { ls.setItem(k, v); } catch(_){} }
      if (ss){ try { ss.setItem(k, v); } catch(_){} }
      // cookie 单条约 4KB，小数据才走 cookie
      if (cookieOK && v.length < 600) ckSet(k, v);
    },
    remove(k){
      delete mem[k];
      if (ls){ try { ls.removeItem(k); } catch(_){} }
      if (ss){ try { ss.removeItem(k); } catch(_){} }
      ckDel(k);
    },
    info(){ return { ls: !!ls, ss: !!ss, cookie: cookieOK, mem: true }; },
    mode(){
      if (ls) return 'local';
      if (ss) return 'session';
      if (cookieOK) return 'cookie';
      return 'memory';
    },
  };
})();

// ---------- 玩家进度存档 ----------
const LS_KEY = 'rg_profile_v2';
const LS_KEY_OLD = 'rg_profile_v1';
function loadProgress(){
  let raw = null;
  try { raw = JSON.parse(Store.get(LS_KEY) || 'null'); } catch(_){}
  if (!raw){                                  // 老存档（v1）自动迁移
    try { raw = JSON.parse(Store.get(LS_KEY_OLD) || 'null'); } catch(_){}
    if (raw) profileRev = 1;
  }
  if (raw){
    userPoints = Math.max(0, raw.points|0);
    unlockedBullets = Array.isArray(raw.unlocked) ? raw.unlocked.filter(id=>BULLETS[id]) : ['normal'];
    if (unlockedBullets.indexOf('normal') < 0) unlockedBullets.unshift('normal');
    equippedBullet = unlockedBullets.indexOf(raw.equipped) >= 0 ? raw.equipped : 'normal';
    if (raw.rev) profileRev = Math.max(profileRev, raw.rev|0);
  }
}
function progressSnapshot(){
  return JSON.stringify({
    v: 2, key: deviceKey, pid: playerId,
    points: userPoints, unlocked: unlockedBullets, equipped: equippedBullet, rev: profileRev,
  });
}
function saveProgressLocal(){                 // 只写本机，不递增 rev
  try { Store.set(LS_KEY, progressSnapshot()); return true; } catch(_){ return false; }
}
function saveProgress(){                      // 任何积分 / 解锁变化都走这里
  profileRev++;
  const ok = saveProgressLocal();
  cloudDirty = true;
  return ok;
}

// ---------- 玩家身份：随机两位 ID（A-Z / a-z）+ 设备密钥（找回积分用） ----------
const PID_KEY = 'rg_player_id_v1';
const KEY_KEY = 'rg_device_key_v1';
const PID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
let playerId = '';
let deviceKey = '';

function randChars(chars, n){
  const out = [];
  if (typeof crypto !== 'undefined' && crypto.getRandomValues){
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    for (let i=0;i<n;i++) out.push(chars[buf[i] % chars.length]);
  } else {
    for (let i=0;i<n;i++) out.push(chars[Math.floor(Math.random()*chars.length)]);
  }
  return out.join('');
}
function genPlayerId(){ return randChars(PID_CHARS, 2); }
function genDeviceKey(){ return randChars(KEY_CHARS, 12); }

// 身份同时写进 URL 锚点：本机存储被禁用时，刷新 / 收藏 / 从历史记录进入都能还原
function readUrlIdentity(){
  const out = { key:'', pid:'' };
  try {
    const s = String(location.hash || '') + '&' + String(location.search || '');
    const mk = s.match(/rgk=([a-z0-9]{8,32})/i);
    const mp = s.match(/rgpid=([A-Za-z]{2})(?![A-Za-z0-9])/);
    if (mk) out.key = mk[1].toLowerCase();
    if (mp) out.pid = mp[1];
  } catch(_){}
  return out;
}
function writeUrlIdentity(){
  try {
    const hash = '#rgk=' + deviceKey + '&rgpid=' + playerId;
    if (location.hash === hash) return;
    history.replaceState(null, '', location.pathname + (location.search || '') + hash);
  } catch(_){}
}
function paintMyId(){
  try {
    if (!document.querySelectorAll) return;
    for (const el of document.querySelectorAll('.myid')){
      if (el.textContent !== playerId) el.textContent = playerId;
    }
  } catch(_){}
}
function ensureIdentity(){
  const url = readUrlIdentity();
  if (!deviceKey){
    let k = url.key;
    if (!/^[a-z0-9]{8,32}$/.test(k)) k = String(Store.get(KEY_KEY) || '');
    if (!/^[a-z0-9]{8,32}$/.test(k)) k = genDeviceKey();
    deviceKey = k;
    Store.set(KEY_KEY, k);
  }
  if (!playerId){
    let pid = /^[A-Za-z]{2}$/.test(url.pid) ? url.pid : String(Store.get(PID_KEY) || '');
    if (!/^[A-Za-z]{2}$/.test(pid)) pid = genPlayerId();
    playerId = pid;
    Store.set(PID_KEY, pid);
  }
  writeUrlIdentity();
  paintMyId();
  return playerId;
}
function ensurePlayerId(){ return ensureIdentity(); }   // 兼容旧调用点

// ---------- 排行榜（云端公开榜；云端不可用时回退本机榜） ----------
// 时长榜按 BOSS 分开，只统计"击杀成功"的局，用时越短越靠前
const LB_BOARDS = {
  endless_points:  { mode:'endless', metric:'points',   title:'♾ 无尽 · 积分' },
  boss_points:     { mode:'boss',    metric:'points',   title:'🔥 BOSS · 积分' },
  boss_time_bh:    { mode:'boss', boss:'blackhole', metric:'duration', asc:true, winOnly:true, title:'⏱ 黑洞 · 最快击杀' },
  boss_time_blade: { mode:'boss', boss:'blade',     metric:'duration', asc:true, winOnly:true, title:'⏱ 血刃 · 最快击杀' },
};
const BOSS_TIME_BOARD = { blackhole:'boss_time_bh', blade:'boss_time_blade' };
const LS_LB = 'rg_lb_local_v1';
let lbBoard = 'endless_points';
let lbCache = {};              // board -> 行数组
let lbStatus = {};             // board -> 'cloud' | 'local' | 'error'

function loadLocalLB(){
  try { const a = JSON.parse(Store.get(LS_LB) || '[]'); return Array.isArray(a) ? a : []; } catch(_){ return []; }
}
function saveLocalLB(rows){
  try { Store.set(LS_LB, JSON.stringify(rows.slice(0, 300))); } catch(_){}
}
// 记录一次成绩：先写本机，再尝试写云端（win 仅 BOSS 模式有意义：是否击杀成功）
function submitScore(mode, boss, points, duration, kills, level, win){
  ensureIdentity();
  const rec = {
    player_id: playerId, device_key: deviceKey, mode, boss: boss || null,
    points: Math.max(0, Math.round(points)), duration: Math.max(0, Math.round(duration)),
    kills: Math.max(0, Math.round(kills)), level: Math.max(1, Math.round(level)),
    win: win === undefined ? true : !!win,
    created_at: new Date().toISOString(),
  };
  const local = loadLocalLB();
  local.unshift(rec);
  saveLocalLB(local);
  cloudSubmitScore(rec);
  return rec;
}
async function cloudSubmitScore(rec){
  const c = getCloud();
  if (!c) return false;
  try {
    const { error } = await c.database.from('leaderboard').insert({
      player_id: rec.player_id, device_key: rec.device_key, mode: rec.mode, boss: rec.boss,
      points: rec.points, duration: rec.duration, kills: rec.kills, level: rec.level, win: rec.win,
    });
    if (error) throw error;
    return true;
  } catch(e){
    console.warn('[leaderboard] 提交失败（已保留本机记录）', e && e.message);
    return false;
  }
}
// 拉取某个榜：云端前 200 条 → 按玩家去重取最佳；失败则用本机记录
async function lbFetch(key){
  const board = LB_BOARDS[key];
  const col = board.metric === 'points' ? 'points' : 'duration';
  const asc = !!board.asc;
  const c = getCloud();
  if (c){
    try {
      let q = c.database.from('leaderboard')
        .select('player_id,device_key,mode,boss,points,duration,kills,level,created_at,win')
        .eq('mode', board.mode);
      if (board.boss) q = q.eq('boss', board.boss);
      if (board.winOnly) q = q.eq('win', true);
      const { data, error } = await q.order(col, { ascending: asc }).limit(200);
      if (error) throw error;
      lbStatus[key] = 'cloud';
      return dedupeLB((data || []).filter(r => board.winOnly ? r.win === true : true));
    } catch(e){
      console.warn('[leaderboard] 读取失败，使用本机榜', e && e.message);
    }
  }
  lbStatus[key] = 'local';
  const rows = loadLocalLB()
    .filter(r => r.mode === board.mode)
    .filter(r => !board.boss || r.boss === board.boss)
    .filter(r => !board.winOnly || r.win === true)
    .sort((a,b)=> asc ? (a[board.metric]||0) - (b[board.metric]||0) : (b[board.metric]||0) - (a[board.metric]||0));
  return dedupeLB(rows);
}
function dedupeLB(rows){
  const seen = new Set(), out = [];
  for (const r of rows){
    // 两位 ID 会撞名，优先用设备密钥区分，老记录回退到 ID
    const id = r.device_key ? 'k:' + r.device_key : 'p:' + (r.player_id || '??');
    if (seen.has(id)) continue;
    seen.add(id); out.push(r);
    if (out.length >= 20) break;
  }
  return out;
}

// 黑洞怪：体型与吞噬总量呈对数关系（无上限）
function bhRadius(absorbed){ return BH_R0 * (1 + 0.55*Math.log(1 + absorbed/150)); }

// ---------- 状态 ----------
let state = 'menu'; // menu / playing / levelup / paused / end
let mode = 'classic';        // classic | boss | endless
let bossKind = 'blackhole';  // blackhole | blade
let lastMode = 'classic', lastBoss = 'blackhole';   // 重开用
let player, enemies, gems, bullets, parts, spawnTimer, gameTime, kills, shake;
let holes = [];              // 黑洞怪释放的追踪小黑洞
let bossWarn = 0;            // >0：BOSS 即将降临（倒计时）
let upgradesGiven = 0;       // BOSS 战已获得的强化次数
let upgradeTimer = 0;        // BOSS 战距离下一次强化
let bossMobT = 0;            // BOSS 战小怪刷新计时
let matterT = 0;             // 宇宙物质刷新计时（黑洞怪 BOSS 战专用）
let endlessBosses = 0;       // 无尽模式：已登场的 BOSS 数（决定血量递增）
let endlessBossT = 0;        // 无尽模式：距离下一个 BOSS
let endlessNewBest = false;  // 无尽模式：本局是否刷新最佳纪录
let slashFx = [];   // 斩击特效
let dmgNums = [];   // 伤害飘字
let stats = { bullet:0, burn:0, orb:0, slash:0 };
let camX = 0, camY = 0; // 相机（世界无限，跟随玩家）
const keys = {};
addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

// ---------- 移动端虚拟摇杆 ----------
const joy = { active:false, id:null, bx:0, by:0, kx:0, ky:0, dx:0, dy:0, R:62 };
function joyUpdate(){
  let vx = joy.kx - joy.bx, vy = joy.ky - joy.by;
  const d = Math.hypot(vx,vy);
  if (d > joy.R){ vx = vx/d*joy.R; vy = vy/d*joy.R; }
  joy.kx = joy.bx + vx; joy.ky = joy.by + vy;
  const dead = joy.R*0.18;
  if (d < dead){ joy.dx = 0; joy.dy = 0; }
  else { const m = Math.hypot(vx,vy)||1; joy.dx = vx/m; joy.dy = vy/m; }
}
function joyStart(x,y){ joy.active=true; joy.bx=x; joy.by=y; joy.kx=x; joy.ky=y; joy.dx=0; joy.dy=0; }
function joyEnd(){ joy.active=false; joy.id=null; joy.dx=0; joy.dy=0; }

cv.addEventListener('touchstart', e => {
  if (state !== 'playing') return;
  for (const t of e.changedTouches){
    if (joy.id === null){ joy.id = t.identifier; joyStart(t.clientX, t.clientY); }
  }
  e.preventDefault();
}, { passive:false });

cv.addEventListener('touchmove', e => {
  for (const t of e.changedTouches){
    if (t.identifier === joy.id){ joy.kx = t.clientX; joy.ky = t.clientY; joyUpdate(); }
  }
  e.preventDefault();
}, { passive:false });

['touchend','touchcancel'].forEach(ev =>
  cv.addEventListener(ev, e => {
    for (const t of e.changedTouches){
      if (t.identifier === joy.id) joyEnd();
    }
    e.preventDefault();
  }, { passive:false })
);

// 兜底：手指在弹窗/其他元素上离开时也要松开摇杆
['touchend','touchcancel'].forEach(ev =>
  addEventListener(ev, e => {
    for (const t of e.changedTouches || []){
      if (t.identifier === joy.id) joyEnd();
    }
  }, { passive:true })
);

// ---------- 升级池 ----------
// max: 可选择的次数上限（不写=无限叠加）
const UPGRADES = [
  { icon:'⚔️', name:'利刃', desc:'攻击伤害 +25%', note:'滚雪球核心，越早拿越赚', apply:p=>p.dmg*=1.25 },
  { icon:'⚡', name:'急速扳机', desc:'攻击间隔 -20%，出手更快', note:'与利刃、分裂弹叠加收益最高', apply:p=>p.fireDelay*=0.8 },
  { icon:'👟', name:'疾风步', desc:'移动速度 +12%', note:'走位拉扯的本钱', apply:p=>p.speed*=1.12 },
  { icon:'❤️', name:'强健体魄', desc:'生命上限 +25，并立即回满', note:'残血时选它等于一次复活', apply:p=>{p.maxHp+=25;p.hp=p.maxHp;} },
  { icon:'🧲', name:'磁力水晶', desc:'拾取范围 +40%', note:'后期满地水晶时收益极高', apply:p=>p.magnet*=1.4 },
  { icon:'🔱', name:'分裂弹', desc:'每次攻击多发射 1 发子弹', note:'扇形散射，近身可全中 · 斩击流：每层在身周额外多一道斩击（360° 均匀分布）', apply:p=>p.multi+=1 },
  { icon:'🎯', name:'穿透弹', desc:'子弹可多穿透 1 个敌人', note:'敌人排成一串时收益翻倍', apply:p=>p.pierce+=1 },
  { icon:'💊', name:'再生', desc:'每秒回复 1 点生命', note:'越早拿越值', apply:p=>p.regen+=1 },
  { icon:'🧛', name:'吸血鬼', desc:'每击杀 1 个敌人，回复 1% 生命上限', note:'限选 1 次 · 与斩击、旋风、分裂弹等高频击杀流派配合收益最高', max:1,
    apply:p=>{ p.vampire = true; } },
  { icon:'💥', name:'致命一击', desc:'暴击率 +10%（暴击双倍伤害）', note:'初始暴击率 5%', apply:p=>p.crit+=0.10 },
  { icon:'🌀', name:'护体旋风', desc:'获得环绕护盾球：可撞击敌人，也能替你挡伤害——每颗球可挡 2 次，挡满即碎；每 45 秒 +1 颗（无上限）',
    note:'限选 1 次 · 贴身防守，伤害随攻击力提升', max:1,
    apply:p=>{ p.orbs = 1; p.orbT = 45; p.orbHp = [ORB_GUARD]; } },
  { icon:'🛡️', name:'减伤装甲', desc:'受到的伤害 -15%', note:'最多叠加到 -60%', apply:p=>p.armor=Math.max(0.4,p.armor*0.85) },
  // 🛞 坦克引擎：暂时下架（所有模式均不再出现）。要恢复：把 off 改成 false 即可。
  { icon:'🛞', name:'坦克引擎', desc:'生命上限翻倍并回满，但攻击距离大幅缩短（约 3 个紫球）',
    note:'限选 1 次 · 每击杀 5 个敌人，生命上限 +1%（按选择时的血量上限）', max:1, off:true,
    apply:p=>{ p.maxHp*=2; p.hp=p.maxHp; p.atkRange=156; p.killHpBase=p.maxHp; p.killHpCount=0; } },
  { icon:'🍳', name:'爽煎滑蛋', desc:'普攻变为斩击：每秒朝最近敌人挥出窄扇形斩击（100% 伤害，射程 300，范围伤害，可斩掉青色弹幕）；移动速度 +15%',
    note:'限选 1 次 · 斩击角度较窄，每层分裂弹额外多一道斩击（前、后、360° 均匀分布）· 移动充能 8 秒后八向斩击（400% 伤害）', max:1,
    apply:p=>{ p.slashMode=true; p.slashEnergy=0; p.speed*=1.15; } },
];

// ---------- 初始化 ----------
function newGame(m='classic', kind='blackhole'){
  mode = m; bossKind = kind;
  player = { x:0, y:0, r:14, hp:100, maxHp:100, speed:200, dmg:10, fireDelay:0.45,
    fireT:0, multi:1, pierce:0, magnet:70, regen:0, crit:0.05, orbs:0, burn:0, armor:1,
    level:1, xp:0, xpNeed:5, orbT:45, orbAngle:0, invul:0, orbHp:[],
    atkRange:460, slashMode:false, slashEnergy:0, killHpBase:0, killHpCount:0, faceAng:0, vampire:false,
    bullet:equippedBullet, taken:{} };
  enemies=[]; gems=[]; bullets=[]; parts=[]; slashFx=[]; dmgNums=[]; holes=[]; chainFx=[];
  spawnTimer=0; gameTime=0; kills=0; shake=0; runPoints=0;
  stats = { bullet:0, burn:0, orb:0, slash:0 };
  camX=0; camY=0;
  spawnedBoss = false;
  upgradesGiven = 0; upgradeTimer = BOSS_UPGRADE_T; bossMobT = 2.5; matterT = 4;
  endlessBosses = 0; endlessBossT = ENDLESS_BOSS_T; endlessNewBest = false;
  bossWarn = (mode==='boss') ? BH_WARN : 0;
  resetBossBar(); resetStatusBar();
  joyEnd(); lastHeartKey = '';
}

// ---------- 敌人生成 ----------
function spawnEnemy(){
  const t = gameTime;
  const diff = t/GAME_TIME; // 难度进度 0→1
  const dist = 900 + Math.random()*200;
  const a = Math.random()*Math.PI*2;
  const x = player.x + Math.cos(a)*dist, y = player.y + Math.sin(a)*dist;
  let type = 'grunt';
  const roll = Math.random();
  // 注意：必须用 else if —— 原写法里坦克(>0.85)会被射手(>0.72)覆盖，导致 4 分钟后坦克永不刷新
  if (t>60 && roll<0.25) type='fast';
  else if (t>120 && roll>0.85) type='tank';
  else if (t>240 && roll>0.72) type='shooter';
  const e = { x, y, type, id:++eid, hurtT:0, burnT:0, burnDmg:0 };
  if (type==='grunt'){ e.r=14; e.hp=e.maxHp=20+diff*60*HP_GROWTH; e.spd=70+diff*50; e.dmg=10; e.col='#c94f4f'; e.xp=1; }
  if (type==='fast'){ e.r=10; e.hp=e.maxHp=12+diff*30*HP_GROWTH; e.spd=150+diff*70; e.dmg=8; e.col='#e6b84f'; e.xp=1; }
  if (type==='tank'){ e.r=26; e.hp=e.maxHp=90+diff*220*HP_GROWTH; e.spd=40+diff*25; e.dmg=20; e.col='#8f5fd0'; e.xp=3; }
  if (type==='shooter'){ e.r=13; e.hp=e.maxHp=30+diff*70*HP_GROWTH; e.spd=55; e.dmg=12; e.col='#4fd0c9'; e.xp=2;
    e.shootT = 1+Math.random()*2; }
  // 无尽模式：10 分钟后无限增强——血量每 5 分钟 +50%、伤害 +20%、移速 +10%（封顶 1.6 倍），经验 +1/5分钟
  // 另外全场随时间缓慢成长：每 1 分钟血量 +1.5%、伤害 +1%（非常慢，长局也能感觉到压力）
  if (mode === 'endless'){
    const post = Math.max(0, gameTime - GAME_TIME);
    const stages = post/300;
    const hpMul = 1 + stages*0.5;
    e.hp *= hpMul; e.maxHp *= hpMul;
    e.dmg = Math.round(e.dmg * (1 + stages*0.2));
    e.spd = Math.round(e.spd * Math.min(1.6, 1 + stages*0.1));
    e.xp += Math.floor(stages);
    const slowGrow = gameTime/60;      // 分钟数
    e.hp *= 1 + slowGrow*0.015; e.maxHp *= 1 + slowGrow*0.015;
    e.dmg = Math.max(1, Math.round(e.dmg * (1 + slowGrow*0.01)));
  }
  enemies.push(e);
}
// BOSS：独立计时触发（不再依赖刷怪节拍，避免错过时间点永不出现）
function spawnBoss(){
  if (spawnedBoss) return;
  spawnedBoss = true;
  shake = 12;
  enemies.push({ x:player.x+400, y:player.y, type:'boss', id:++eid, r:52, hp:2200, maxHp:2200,
    spd:55, dmg:35, col:'#ff3b6b', xp:50, hurtT:0, burnT:0, burnDmg:0, shootT:2, chargeT:5 });
}
let spawnedBoss = false;
let eid = 0;

// ---------- BOSS 战 ----------
// BOSS 战小怪：血量很低、不掉经验，会被黑洞怪吸走当作养料
function spawnMinion(){
  const diff = Math.min(1, gameTime/600);
  const a = Math.random()*Math.PI*2, dist = 600 + Math.random()*200;
  let mx = player.x+Math.cos(a)*dist, my = player.y+Math.sin(a)*dist;
  // BOSS 战：出生点限制在场地内
  if (mode === 'boss'){
    mx = Math.max(-BOSS_ARENA_HALF+20, Math.min(BOSS_ARENA_HALF-20, mx));
    my = Math.max(-BOSS_ARENA_HALF+20, Math.min(BOSS_ARENA_HALF-20, my));
  }
  const e = { x:mx, y:my, type:'grunt', id:++eid,
    r:12, hp:0, maxHp:0, spd:0, dmg:0, col:'#8a6fd0', xp:0,
    hurtT:0, burnT:0, burnDmg:0, suck:true, suckV:90 };
  e.hp = e.maxHp = 18 + diff*30*HP_GROWTH;
  enemies.push(e);
}
// 宇宙物质：黑色方形 + 灰色重影，漂浮在场中
// 黑洞怪可以额外吞噬它们养血：血量 20/50/100/1000，概率 70%/20%/9%/1%
// 玩家也可以打碎它们（BOSS 战不掉经验），1000 血的巨型物质要不要留给黑洞怪是个抉择
function spawnMatter(){
  let alive = 0;
  for (const e of enemies) if (e.type==='matter') alive++;
  if (alive >= 6) return;
  const roll = Math.random();
  let hp, r;
  if (roll < 0.70){ hp = 20;   r = 10; }
  else if (roll < 0.90){ hp = 50;   r = 13; }
  else if (roll < 0.99){ hp = 100;  r = 17; }
  else { hp = 1000; r = 30; }
  const a = Math.random()*Math.PI*2, dist = 450 + Math.random()*350;
  let mx = player.x+Math.cos(a)*dist, my = player.y+Math.sin(a)*dist;
  mx = Math.max(-BOSS_ARENA_HALF+r+10, Math.min(BOSS_ARENA_HALF-r-10, mx));
  my = Math.max(-BOSS_ARENA_HALF+r+10, Math.min(BOSS_ARENA_HALF-r-10, my));
  const da = Math.random()*Math.PI*2;
  enemies.push({ x:mx, y:my, type:'matter', id:++eid, r, hp, maxHp:hp,
    spd:0, dmg:0, col:'#0a0a10', xp:0, hurtT:0, burnT:0, burnDmg:0,
    dx:Math.cos(da)*14, dy:Math.sin(da)*14, rot:Math.random()*Math.PI, rotV:(Math.random()<0.5?-1:1)*(0.3+Math.random()*0.5) });
}
// 黑洞怪登场：先提示，再出现；场上已有小怪立刻被吸向它
// 无尽模式：每刷一个 BOSS，血量 +50%（endlessBosses 递增）
function spawnSelectedBoss(){
  shake = 16;
  // BOSS 试炼：出生点限制在场地内
  const x = Math.max(-BOSS_ARENA_HALF+300, Math.min(BOSS_ARENA_HALF-300, player.x + 300));
  const y = Math.max(-BOSS_ARENA_HALF+200, Math.min(BOSS_ARENA_HALF-200, player.y - 40));
  const hpScale = mode==='endless' ? 1 + endlessBosses*0.5 : 1;
  if (bossKind === 'blackhole'){
    const hp = Math.round(BH_HP*hpScale);
    const b = { x, y, type:'bhboss', id:++eid, r:bhRadius(0), rMul:1, absorbed:0,
      hp, maxHp:hp, spd:14, dmg:30, col:'#4a2f7a', xp:0,
      hurtT:0, burnT:0, burnDmg:0, castT:1.47, volleyT:1, volleyA:0, vortexA:0, enraged:false };
    enemies.push(b);
    for (const e of enemies){
      if (e === b || e.type==='ebullet' || e.type==='bhboss' || e.type==='boss') continue;
      e.suck = true; e.suckV = Math.max(e.suckV||0, 240);
    }
  } else {
    const hp = Math.round(2200*hpScale);
    enemies.push({ x, y, type:'boss', id:++eid, r:52, hp, maxHp:hp,
      spd:55, dmg:35, col:'#ff3b6b', xp:0, hurtT:0, burnT:0, burnDmg:0, shootT:2, chargeT:5 });
  }
  if (mode === 'endless') endlessBosses++;
}
// 吞噬：小怪当前有多少血，BOSS 就加多少血（hp 与 maxHp 等额提升），体型按对数增长（无上限）
function absorbMinion(e, boss){
  if (e.type==='bhboss' || e.type==='boss') return;   // BOSS 之间不互相吞噬
  const add = Math.max(0, e.hp || 0);
  boss.absorbed += add;
  boss.hp += add; boss.maxHp += add;
  boss.r = bhRadius(boss.absorbed) * (boss.rMul||1);
  burst(e.x, e.y, '#9a7cff', 5);
  burst(boss.x, boss.y, '#c9a8ff', 3);
  // 吞噬回血飘字：紫色 +N，加了多少一眼可见
  dmgNums.push({ x: boss.x, y: boss.y - boss.r - 14, val: '+' + Math.round(add),
    crit: false, col: '#c9a8ff', t: 0, life: 0.8,
    vx: (Math.random()-0.5)*30, vy: -60 });
}
// 小黑洞：极慢追踪（移速 +50%），上限 5 个，按体型扣 15%/20%/25% 生命上限，移动带细长紫色拖尾
function spawnHole(boss){
  const roll = Math.random();
  let r, pct;
  if (roll < 0.50){ r = 15; pct = 0.15; }
  else if (roll < 0.82){ r = 24; pct = 0.20; }
  else { r = 34; pct = 0.25; }
  const a = Math.random()*Math.PI*2;
  holes.push({ x: boss.x + Math.cos(a)*boss.r, y: boss.y + Math.sin(a)*boss.r,
    r, pct, spd: (30 - r*0.25)*1.5, rot: 0, trail: [], trailT: 0 });
  // BOSS 试炼：小黑洞也限制在场地内
  const h = holes[holes.length-1];
  if (mode === 'boss'){
    const lim = BOSS_ARENA_HALF - h.r;
    h.x = Math.max(-lim, Math.min(lim, h.x));
    h.y = Math.max(-lim, Math.min(lim, h.y));
  }
  if (holes.length > HOLE_MAX) holes.shift();
}

// ---------- 输入/更新 ----------
// ---------- 玩家受伤：护体旋风球优先抵挡 ----------
// 每颗球可替玩家挡 ORB_GUARD 次伤害（完全免伤），挡满即碎消失。
function orbGuardHit(){
  if (!player.orbs || !player.orbHp || !player.orbHp.length) return false;
  let i = -1;
  for (let k=0;k<player.orbHp.length;k++){ if (player.orbHp[k] > 0){ i = k; break; } }
  if (i < 0) return false;
  const cnt = Math.max(1, player.orbs);
  const ang = player.orbAngle + i*Math.PI*2/cnt;
  const ox = player.x + Math.cos(ang)*55, oy = player.y + Math.sin(ang)*55;
  player.orbHp[i]--;
  burst(ox, oy, '#7ee7d8', 7);
  slashFx.push({ x:ox, y:oy, ring:true, radius:26, life:0.24, maxLife:0.24, col:'#7ee7d8' });
  if (player.orbHp[i] <= 0){
    // 挡满两次 → 碎裂消失
    player.orbHp.splice(i, 1);
    player.orbs = Math.max(0, player.orbs - 1);
    burst(ox, oy, '#c8fff5', 14);
  }
  return true;
}
// 统一受伤入口：返回 true 表示这一下把玩家打死了（调用方应 return）
function hurtPlayer(dmg, invulT, shakeAmt){
  if (orbGuardHit()){
    player.invul = Math.max(player.invul, invulT*0.55);
    shake = Math.max(shake, shakeAmt*0.5);
    return false;
  }
  player.hp -= dmg;
  player.invul = invulT;
  shake = shakeAmt;
  if (player.hp <= 0){ endGame(false); return true; }
  return false;
}

function update(dt){
  gameTime += dt;
  if (mode === 'classic'){
    if (!spawnedBoss && gameTime >= BOSS_TIME) spawnBoss();
    if (gameTime >= GAME_TIME){ endGame(true); return; }
  } else if (mode === 'boss'){
    // BOSS 战：不限时间，登场前有提示
    if (bossWarn > 0){
      bossWarn -= dt;
      if (bossWarn <= 0) spawnSelectedBoss();
    }
    // 每 30 秒一次强化（最多 10 次）
    if (upgradesGiven < MAX_UPGRADES){
      upgradeTimer -= dt;
      if (upgradeTimer <= 0){ upgradeTimer = BOSS_UPGRADE_T; bossUpgrade(); return; }
    }
  } else {
    // 无尽模式：不限时、无胜利，BOSS 登场提示在刷怪段处理
    if (bossWarn > 0){
      bossWarn -= dt;
      if (bossWarn <= 0) spawnSelectedBoss();
    }
  }
  // 场上的 BOSS（黑洞怪登场后玩家会被减速）
  let curBoss = null;
  for (const e of enemies){ if (e.type==='bhboss' || e.type==='boss'){ curBoss = e; break; } }

  // 玩家移动
  let dx=0, dy=0;
  if (keys['w']||keys['arrowup']) dy--;
  if (keys['s']||keys['arrowdown']) dy++;
  if (keys['a']||keys['arrowleft']) dx--;
  if (keys['d']||keys['arrowright']) dx++;
  if (joy.active){ dx += joy.dx; dy += joy.dy; }
  const len = Math.hypot(dx,dy)||1;
  const slow = (mode!=='classic' && curBoss) ? BOSS_SLOW : 1;   // BOSS 登场：移速 -35%
  player.x += dx/len*player.speed*slow*dt;
  player.y += dy/len*player.speed*slow*dt;
  // BOSS 试炼：玩家限制在封闭场地内
  if (mode === 'boss'){
    const lim = BOSS_ARENA_HALF - player.r;
    player.x = Math.max(-lim, Math.min(lim, player.x));
    player.y = Math.max(-lim, Math.min(lim, player.y));
  }
  if (player.invul>0) player.invul-=dt;
  if (player.regen>0) player.hp = Math.min(player.maxHp, player.hp+player.regen*dt);
  // 记录朝向（斩击方向用）
  const moving = (dx!==0 || dy!==0);
  if (moving) player.faceAng = Math.atan2(dy, dx);

  // 攻击：子弹流 / 斩击流
  player.fireT -= dt;
  if (player.slashMode){
    // 移动充能：满 8 秒释放八向斩击
    if (moving) player.slashEnergy += dt;
    if (player.slashEnergy >= SLASH_CHARGE){
      player.slashEnergy = 0;
      releaseSlash8();
    }
    if (player.fireT <= 0){
      // 与子弹流一致：自动锁定最近敌人，不再跟随移动方向
      const R = Math.min(SLASH_RADIUS, player.atkRange);
      let best=null, bd=1e9;
      for (const e of enemies){
        if (e.type==='ebullet' || e.suck) continue;   // 被吸走的小怪不抢索敌
        const d=Math.hypot(e.x-player.x, e.y-player.y); if(d<bd){bd=d;best=e;}
      }
      if (best && bd < R + best.r){
        player.fireT = 1.0;
        const ang = Math.atan2(best.y-player.y, best.x-player.x);
        player.faceAng = ang;
        // 分裂弹：斩击流不再是"加宽扇面"，而是每层多一道斩击，均匀铺满 360°
        // 1 层=正前方；2 层=前 + 后；3 层=三个方向，以此类推
        const n = Math.max(1, player.multi);
        for (let i=0;i<n;i++){
          const a = ang + i*Math.PI*2/n;
          slashAttack(a, player.dmg, R, SLASH_ARC, i===0 ? '#dff3ff' : '#a8dcff');
        }
      }
    }
  } else if (player.fireT<=0){
    let best=null, bd=1e9;
    for (const e of enemies){
      if (e.type==='ebullet' || e.suck) continue;
      const d=Math.hypot(e.x-player.x,e.y-player.y); if(d<bd){bd=d;best=e;}
    }
    if (best && bd < player.atkRange){
      player.fireT = player.fireDelay;
      const ang = Math.atan2(best.y-player.y, best.x-player.x);
      const bt = player.bullet || 'normal';
      const isYelve = bt === 'yelve';
      for (let i=0;i<player.multi;i++){
        const off = (i-(player.multi-1)/2)*0.16;
        const b = { x:player.x, y:player.y, ang:ang+off, spd:isYelve ? 480 : 560,
          dmg:player.dmg * (isYelve ? 1.25 : 1),
          pierce:player.pierce, life:isYelve ? 2.6 : 0.9, r:5, hit:[], bt,
          dud: Math.random() >= HIT_RATE };   // 20% 空弹：整发穿过不造成伤害
        if (isYelve){ b.trail = []; b.turn = 0; }   // 耶律弹：追踪 + 长绿色拖尾
        bullets.push(b);
      }
    }
  }
  // 护体旋风：每 45 秒 +1 颗（仅可选 1 次，无限增涨）；每颗球可为玩家挡 2 次伤害
  if (player.orbs>0){
    while (player.orbHp.length < player.orbs) player.orbHp.push(ORB_GUARD);
    player.orbT -= dt;
    if (player.orbT<=0){ player.orbT = 45; player.orbs += 1; player.orbHp.push(ORB_GUARD); }
    player.orbAngle += dt*2.2;
    for (let i=0;i<player.orbs;i++){
      const ox = player.x + Math.cos(player.orbAngle + i*Math.PI*2/player.orbs)*55;
      const oy = player.y + Math.sin(player.orbAngle + i*Math.PI*2/player.orbs)*55;
      for (let j=enemies.length-1;j>=0;j--){
        const e = enemies[j];
        if (e.hp<=0 || e.type==='ebullet' || e.suck) continue;
        if (Math.hypot(e.x-ox,e.y-oy) < e.r+10){
          if ((e.orbCd||0) > gameTime) continue;
          e.orbCd = gameTime + 0.3;
          const od = 25 + player.dmg;
          stats.orb += od; e.hp -= od; hurtFlash(e);
          addDmg(e.x, e.y-e.r-8, od, false);
          burst(e.x,e.y,'#7ee7d8',3);
          if (e.hp<=0) killEnemy(e);   // 旋风击杀同样掉经验、计数
        }
      }
    }
  }
  // 子弹
  for (let i=bullets.length-1;i>=0;i--){
    const b = bullets[i];
    // 耶律弹：朝最近敌人有限转向追踪，并记录长拖尾
    if (b.bt === 'yelve'){
      let tg=null, td=1e9;
      for (const e of enemies){
        if (e.hp<=0 || e.suck || e.type==='ebullet') continue;
        const dd = Math.hypot(e.x-b.x, e.y-b.y);
        if (dd < td){ td = dd; tg = e; }
      }
      if (tg){
        const want = Math.atan2(tg.y-b.y, tg.x-b.x);
        let diff = want - b.ang;
        while (diff > Math.PI) diff -= Math.PI*2;
        while (diff < -Math.PI) diff += Math.PI*2;
        const maxTurn = 5.5*dt;   // 转向速率：能拐弯但不会瞬移甩尾
        b.ang += Math.max(-maxTurn, Math.min(maxTurn, diff));
      }
      b.trail.push({x:b.x, y:b.y});
      if (b.trail.length > 26) b.trail.shift();
    }
    b.x += Math.cos(b.ang)*b.spd*dt; b.y += Math.sin(b.ang)*b.spd*dt; b.life-=dt;
    if (b.missT > 0) b.missT -= dt;
    if (b.life<=0){ bullets.splice(i,1); continue; }
    // BOSS 试炼：玩家子弹撞场地边界即消失
    if (mode === 'boss' && (b.x < -BOSS_ARENA_HALF || b.x > BOSS_ARENA_HALF
        || b.y < -BOSS_ARENA_HALF || b.y > BOSS_ARENA_HALF)){
      bullets.splice(i,1); continue;
    }
    for (const e of enemies){
      if (e.hp<=0 || e.suck) continue;
      if (b.hit.indexOf(e.id) >= 0) continue;
      if (Math.hypot(e.x-b.x,e.y-b.y) < e.r+b.r){
        // 敌弹可被子弹打掉（不计伤害/击杀）
        if (e.type==='ebullet'){
          e.hp = 0; burst(e.x,e.y,'#4fd0c9',6);
          b.hit.push(e.id);
          if (b.pierce > 0) b.pierce--; else bullets.splice(i,1);
          break;
        }
        // 命中率 80%：空弹整发穿过，不造成伤害与任何效果（但记入 hit，避免逐帧重复判定）
        if (b.dud){
          b.missT = 0.2;
          b.hit.push(e.id);
          continue;
        }
        let dmg = b.dmg;
        let crit = Math.random() < player.crit;
        if (crit) dmg*=2;
        stats.bullet += dmg;
        e.hp -= dmg; hurtFlash(e);
        addDmg(e.x, e.y-e.r-8, dmg, crit);
        // 子弹特效
        applyBulletEffect(b, e, dmg);
        burst(b.x,b.y, crit?'#ffd76a':'#9fd0ff', 4);
        if (e.hp<=0) killEnemy(e);
        b.hit.push(e.id);
        // 穿透：还有穿透次数就继续飞，否则消失
        if (b.pierce > 0){ b.pierce--; } else { bullets.splice(i,1); }
        break;
      }
    }
  }
  // 敌人
  for (let i=enemies.length-1;i>=0;i--){
    const e = enemies[i];
    if (e.hp<=0){ enemies.splice(i,1); continue; }
    if (e.hurtT>0) e.hurtT-=dt;
    if (e.burnT>0){ e.burnT-=dt; const bd = Math.min(e.burnDmg*dt, Math.max(0,e.hp)); stats.burn += bd; e.hp-=e.burnDmg*dt; if(Math.random()<dt*8) burst(e.x,e.y,'#ff7a3c',1); if(e.hp<=0){killEnemy(e); continue;} }
    // 寒冰减速：移速与攻速各 -50%（持续 3 秒）
    if (e.slowT > 0) e.slowT -= dt;
    const sm = e.slowT > 0 ? 0.5 : 1;
    const d = Math.hypot(player.x-e.x, player.y-e.y);
    const ang = Math.atan2(player.y-e.y, player.x-e.x);
    // 被黑洞怪吸走的小怪：直冲黑洞，碰到即被吞噬（不掉经验、不伤害玩家）
    if (e.suck){
      let tgt = null;
      for (const o of enemies){ if (o.type==='bhboss'){ tgt = o; break; } }
      if (tgt){
        const a2 = Math.atan2(tgt.y-e.y, tgt.x-e.x);
        e.suckV = Math.min(1200, e.suckV + 900*dt);
        e.x += Math.cos(a2)*e.suckV*dt;
        e.y += Math.sin(a2)*e.suckV*dt;
        if (Math.random() < dt*18) parts.push({x:e.x,y:e.y,vx:0,vy:0,life:0.25,col:'#a98cff'});
        if (Math.hypot(tgt.x-e.x, tgt.y-e.y) < tgt.r*0.75){
          absorbMinion(e, tgt);
          enemies.splice(i,1);
        }
        // BOSS 试炼：被吸的小怪也限制在场地内
        if (mode === 'boss'){
          const mlim = BOSS_ARENA_HALF - e.r;
          e.x = Math.max(-mlim, Math.min(mlim, e.x));
          e.y = Math.max(-mlim, Math.min(mlim, e.y));
        }
      }
      continue;
    }
    // 宇宙物质：缓慢漂移 + 自旋，不追玩家不攻击；撞场地边界反弹（BOSS 试炼）
    // 靠近黑洞怪时被引力捕获，直冲黑洞被额外吞噬
    if (e.type==='matter'){
      let bh = null;
      for (const o of enemies){ if (o.type==='bhboss'){ bh = o; break; } }
      if (bh && Math.hypot(bh.x-e.x, bh.y-e.y) < bh.r*1.5 + 320){
        e.suck = true; e.suckV = 60;
        continue;
      }
      e.x += e.dx*dt; e.y += e.dy*dt; e.rot += e.rotV*dt;
      if (mode === 'boss'){
        const mlim = BOSS_ARENA_HALF - e.r;
        if (e.x < -mlim){ e.x = -mlim; e.dx = Math.abs(e.dx); }
        if (e.x >  mlim){ e.x =  mlim; e.dx = -Math.abs(e.dx); }
        if (e.y < -mlim){ e.y = -mlim; e.dy = Math.abs(e.dy); }
        if (e.y >  mlim){ e.y =  mlim; e.dy = -Math.abs(e.dy); }
      }
      continue;
    }
    // 敌方子弹：直线飞行，不追踪
    if (e.type==='ebullet'){
      e.x += Math.cos(e.ang)*e.spd*dt;
      e.y += Math.sin(e.ang)*e.spd*dt;
      e.life -= dt;
      // 拖尾（黑洞怪的弹幕带尾迹）
      if (e.trail){
        e.trail.push({x:e.x, y:e.y});
        if (e.trail.length > 9) e.trail.shift();
      }
      const dd = Math.hypot(player.x-e.x, player.y-e.y);
      if (dd < e.r+player.r && player.invul<=0){
        const dead = hurtPlayer(e.dmg*player.armor, 0.5, 8);
        if (dead) return;
        enemies.splice(i,1); continue;
      }
      // BOSS 试炼场地边界：黑洞怪狂暴弹幕最多反弹 3 次，其余敌弹撞墙即碎
      if (mode === 'boss'){
        const blim = BOSS_ARENA_HALF - e.r;
        if (e.x < -blim || e.x > blim || e.y < -blim || e.y > blim){
          if (e.bounce > 0){
            e.bounce--;
            if ((e.x < -blim && Math.cos(e.ang) < 0) || (e.x > blim && Math.cos(e.ang) > 0)) e.ang = Math.PI - e.ang;
            if ((e.y < -blim && Math.sin(e.ang) < 0) || (e.y > blim && Math.sin(e.ang) > 0)) e.ang = -e.ang;
            e.x = Math.max(-blim, Math.min(blim, e.x));
            e.y = Math.max(-blim, Math.min(blim, e.y));
          } else { enemies.splice(i,1); continue; }
        }
      }
      if (e.life<=0) enemies.splice(i,1);
      continue;
    }
    if (e.type==='shooter'){
      e.shootT -= dt*sm;
      if (d>260) { e.x+=Math.cos(ang)*e.spd*sm*dt; e.y+=Math.sin(ang)*e.spd*sm*dt; }
      if (e.shootT<=0 && d<520){ e.shootT=2.2;
        // 发射瞬间锁定方向，之后不再追踪
        enemies.push({x:e.x,y:e.y,type:'ebullet',id:++eid,ang:ang,r:6,hp:1,maxHp:1,spd:280,dmg:e.dmg,col:'#4fd0c9',xp:0,life:3,hurtT:0,burnT:0,burnDmg:0});
      }
    } else if (e.type==='bhboss'){
      // 黑洞怪：缓慢逼近，每 1.47 秒放一个小黑洞（攻击速度 +70%）；血量 50% 时狂暴
      e.vortexA += dt*1.6;
      if (d > 260){ e.x += Math.cos(ang)*e.spd*sm*dt; e.y += Math.sin(ang)*e.spd*sm*dt; }
      e.castT -= dt*sm;
      if (e.castT <= 0){ e.castT = 1.47; spawnHole(e); }
      if (!e.enraged && e.hp <= e.maxHp*0.5){
        e.enraged = true;
        e.rMul = 1.5;
        e.r = bhRadius(e.absorbed) * e.rMul;      // 再次变大 1.5 倍
        e.volleyT = 1.0;
        shake = 18;
        slashFx.push({ x:e.x, y:e.y, ring:true, radius:e.r*2.4, life:0.6, maxLife:0.6, col:'#c9a8ff' });
      }
      if (e.enraged){
        e.volleyT -= dt*sm;
        if (e.volleyT <= 0){
          e.volleyT = 1.0;
          e.volleyA += 0.55;                      // 每轮换个方向
          for (let k=0;k<8;k++){
            const a2 = k/8*Math.PI*2 + e.volleyA;
            enemies.push({ x:e.x+Math.cos(a2)*e.r*0.85, y:e.y+Math.sin(a2)*e.r*0.85,
              type:'ebullet', id:++eid, ang:a2, r:9, hp:1, maxHp:1, spd:175, dmg:14,
              col:'#a97cff', xp:0, life:7, hurtT:0, burnT:0, burnDmg:0, trail:[], bounce:3 });
          }
        }
      }
    } else if (e.type==='boss'){
      e.shootT-=dt*sm; e.chargeT-=dt*sm;
      if (e.chargeT<=0){ e.chargeT=6; e.rushT=1.2; e.rushAng=ang; }
      if (e.rushT>0){ e.rushT-=dt; e.x+=Math.cos(e.rushAng)*e.spd*6*sm*dt; e.y+=Math.sin(e.rushAng)*e.spd*6*sm*dt; }
      else { e.x+=Math.cos(ang)*e.spd*sm*dt; e.y+=Math.sin(ang)*e.spd*sm*dt; }
      if (e.shootT<=0){ e.shootT=1.6;
        for(let k=0;k<8;k++){ const a2=k/8*Math.PI*2 + gameTime*0.6;
          enemies.push({x:e.x,y:e.y,type:'ebullet',id:++eid,ang:a2,r:7,hp:1,maxHp:1,spd:200,dmg:15,col:'#ff8aa8',xp:0,life:4,hurtT:0,burnT:0,burnDmg:0}); }
      }
    } else {
      e.x += Math.cos(ang)*e.spd*sm*dt; e.y += Math.sin(ang)*e.spd*sm*dt;
    }
    // BOSS 试炼：BOSS 本体与小怪限制在场地内（按各自半径留边）
    if (mode === 'boss'){
      const elim = BOSS_ARENA_HALF - e.r;
      e.x = Math.max(-elim, Math.min(elim, e.x));
      e.y = Math.max(-elim, Math.min(elim, e.y));
    }
    // 碰撞玩家
    if (d < e.r+player.r && player.invul<=0){
      if (hurtPlayer(e.dmg*player.armor, 0.5, 8)) return;
    }
  }
  // 水晶
  for (let i=gems.length-1;i>=0;i--){
    const g = gems[i];
    // 弹出停留期：先向外飞一小段，之后再被磁力吸附
    if (g.t > 0){
      g.t -= dt;
      g.x += g.vx*dt; g.y += g.vy*dt;
      const damp = Math.max(0, 1 - 5*dt);
      g.vx *= damp; g.vy *= damp;
      continue;
    }
    const d = Math.hypot(player.x-g.x, player.y-g.y) || 1;
    // 无尽模式：经验自动全屏吸收
    const mg = mode === 'endless' ? Infinity : player.magnet;
    if (d < mg){ const pull = mode === 'endless' ? 620 : 300; g.x += (player.x-g.x)/d*pull*dt; g.y += (player.y-g.y)/d*pull*dt; }
    if (d < player.r+8){
      gems.splice(i,1); player.xp += g.v;
      if (player.xp >= player.xpNeed){ levelUp(); return; }
    }
  }
  // 小黑洞：极慢追踪玩家，碰到按体型扣血
  for (let i=holes.length-1;i>=0;i--){
    const h = holes[i];
    const hd = Math.hypot(player.x-h.x, player.y-h.y) || 1;
    h.x += (player.x-h.x)/hd*h.spd*dt;
    h.y += (player.y-h.y)/hd*h.spd*dt;
    h.rot += dt*2.2;
    // 拖尾采样：小黑洞移动很慢，按时间间隔采样才能拉出细长尾迹
    h.trailT -= dt;
    if (h.trailT <= 0){
      h.trailT = 0.12;
      h.trail.push({x:h.x, y:h.y});
      if (h.trail.length > 16) h.trail.shift();
    }
    if (hd < h.r + player.r && player.invul <= 0){
      const dead = hurtPlayer(player.maxHp*h.pct*player.armor, 0.6, 12);
      burst(h.x, h.y, '#9a7cff', 12);
      holes.splice(i,1);
      if (dead) return;
    }
  }
  // 生成
  if (mode === 'classic'){
    // 开局约 0.75 秒一只，末段压缩到 0.13 秒一只；场上存活数有上限防卡顿
    spawnTimer -= dt;
    const rate = Math.max(0.13, 0.75 - gameTime/GAME_TIME*0.62);
    if (spawnTimer<=0){
      spawnTimer = rate;
      let alive = 0;
      for (const e of enemies) if (e.type!=='ebullet') alive++;
      if (alive < MAX_ALIVE) spawnEnemy();
    }
  } else if (mode === 'endless') {
    // 无尽模式：曲线继续收紧（末段 0.05 秒/只），10 分钟后场上上限每 2 分钟 +20（封顶 260）
    spawnTimer -= dt;
    if (spawnTimer <= 0){
      const post = Math.max(0, gameTime - GAME_TIME);
      spawnTimer = Math.max(0.05, 0.75 - Math.min(1.2, gameTime/600)*0.70);
      const cap = Math.min(260, MAX_ALIVE + Math.floor(post/120)*20);
      let alive = 0;
      for (const e of enemies) if (e.type!=='ebullet') alive++;
      if (alive < cap) spawnEnemy();
    }
    // 周期 BOSS：每 5 分钟随机一个（黑洞怪/血刃巨像），血量按已登场次数 +50%/个
    if (bossWarn <= 0){
      endlessBossT -= dt;
      if (endlessBossT <= 0){
        endlessBossT = ENDLESS_BOSS_T;
        bossKind = Math.random() < 0.5 ? 'blackhole' : 'blade';
        bossWarn = BH_WARN;
      }
    }
  } else {
    // BOSS 战：小怪刷怪速度与十分钟模式同一难度曲线，仅整体放慢 30%
    bossMobT -= dt;
    if (bossMobT <= 0){
      const diff = Math.min(1, gameTime/600);
      const rate = Math.max(0.13, 0.75 - diff*0.62) * 1.3;   // 0.975s 起步，末段 0.169s
      bossMobT = rate;
      let alive = 0;
      for (const e of enemies) if (e.type!=='ebullet') alive++;
      if (alive < 40) spawnMinion();
    }
    // 宇宙物质：黑洞怪 BOSS 战专用，每 2.5 秒尝试生成一个（黑洞怪可吞噬它们养血）
    if (bossKind === 'blackhole'){
      matterT -= dt;
      if (matterT <= 0){ matterT = 2.5; spawnMatter(); }
    }
  }
  // 粒子
  for (let i=parts.length-1;i>=0;i--){
    const p=parts[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=dt;
    if (p.life<=0) parts.splice(i,1);
  }
  // 雷电链特效计时
  for (let i=chainFx.length-1;i>=0;i--){
    chainFx[i].t += dt;
    if (chainFx[i].t >= chainFx[i].life) chainFx.splice(i,1);
  }
  // 斩击特效计时
  for (let i=slashFx.length-1;i>=0;i--){
    slashFx[i].life -= dt;
    if (slashFx[i].life<=0) slashFx.splice(i,1);
  }
  // 伤害飘字计时
  for (let i=dmgNums.length-1;i>=0;i--){
    const n = dmgNums[i];
    n.t += dt;
    n.x += n.vx*dt; n.y += n.vy*dt; n.vy += 150*dt;
    if (n.t >= n.life) dmgNums.splice(i,1);
  }
  if (shake>0) shake-=dt*20;
  camX = player.x - (W/viewScale)/2; camY = player.y - (H/viewScale)/2;
  // BOSS 试炼：相机限制在场地范围内（视野比场地还大时居中）
  if (mode === 'boss'){
    const vw2 = W/viewScale, vh2 = H/viewScale, HF = BOSS_ARENA_HALF;
    camX = vw2 >= HF*2 ? -vw2/2 : Math.max(-HF, Math.min(HF - vw2, camX));
    camY = vh2 >= HF*2 ? -vh2/2 : Math.max(-HF, Math.min(HF - vh2, camY));
  }
  updateHUD();
  // 进度节流存盘（积分变化后最多 1 秒落一次，刷新也不会丢）
  saveT -= dt;
  if (progressDirty && saveT <= 0){ saveT = 1; progressDirty = false; saveProgress(); }
}

function hurtFlash(e){ e.hurtT = 0.1; }

// 伤害飘字：普通伤害字号小、暴击字号更大并附带金色爆闪
function addDmg(x, y, val, crit){
  if (!(val > 0)) return;
  dmgNums.push({ x, y, val: Math.round(val), crit: !!crit, t: 0,
    life: crit ? 0.9 : 0.55, vx: (Math.random()-0.5)*40, vy: -80 - Math.random()*25 });
  if (crit){
    slashFx.push({ x, y, ring:true, radius:38, life:0.28, maxLife:0.28, col:'#ffd76a' });
    burst(x, y, '#ffd76a', 8);
  }
}

// ---------- 斩击（爽煎滑蛋） ----------
function slashAttack(ang, dmg, radius, halfArc, col){
  slashFx.push({ x:player.x, y:player.y, ang, arc:halfArc, radius, life:0.22, maxLife:0.22, col });
  for (let j=enemies.length-1;j>=0;j--){
    const e = enemies[j];
    if (e.hp<=0 || e.suck) continue;
    const d = Math.hypot(e.x-player.x, e.y-player.y);
    if (d > radius + e.r) continue;
    let da = Math.atan2(e.y-player.y, e.x-player.x) - ang;
    while (da >  Math.PI) da -= Math.PI*2;
    while (da < -Math.PI) da += Math.PI*2;
    if (Math.abs(da) > halfArc + Math.atan2(e.r, Math.max(1,d))) continue;
    // 青色敌弹可以被斩击打掉（不计伤害、不计击杀）
    if (e.type==='ebullet'){ e.hp = 0; burst(e.x,e.y,'#4fd0c9',6); continue; }
    let dm = dmg;
    const isCrit = Math.random() < player.crit;
    if (isCrit) dm *= 2;
    stats.slash += dm;
    e.hp -= dm; hurtFlash(e);
    addDmg(e.x, e.y-e.r-8, dm, isCrit);
    if (player.burn>0){ e.burnT=3; e.burnDmg=player.burn; }
    burst(e.x,e.y,col,3);
    if (e.hp<=0) killEnemy(e);
  }
}
function releaseSlash8(){
  shake = 10;
  const R = Math.min(SLASH8_RADIUS, player.atkRange);
  slashFx.push({ x:player.x, y:player.y, ring:true, radius:R, life:0.4, maxLife:0.4, col:'#ffe9a8' });
  for (let k=0;k<8;k++){
    const a = k/8*Math.PI*2 + player.faceAng;
    slashAttack(a, 4*player.dmg, R, 0.62, '#ffe9a8');
  }
}
function burst(x,y,col,n){
  for(let i=0;i<n;i++) parts.push({x,y,vx:(Math.random()-0.5)*200,vy:(Math.random()-0.5)*200,life:0.3,col});
}
function killEnemy(e){
  kills++;
  // 积分：所有模式都累计本局积分（用于排行榜）；只有十分钟模式计入可消费余额
  const gp = KILL_POINTS[e.type] || 0;
  if (gp > 0){
    runPoints += gp;
    if (mode === 'classic'){ userPoints += gp; progressDirty = true; }
  }
  burst(e.x,e.y,e.col,10);
  // 坦克引擎：每击杀 5 个敌人，生命上限 +1%（基于选择时的血量上限）
  if (player.killHpBase > 0 && e.type !== 'boss'){
    player.killHpCount = (player.killHpCount || 0) + 1;
    if (player.killHpCount % 5 === 0) player.maxHp += player.killHpBase * 0.01;
  }
  // 吸血鬼：每击杀 1 个敌人，回复 1% 生命上限
  if (player.vampire) player.hp = Math.min(player.maxHp, player.hp + player.maxHp*0.01);
  // 水晶先向外弹出并停留片刻（避免被磁力瞬间吸走、看不到掉落）
  if (e.xp>0) for(let i=0;i<e.xp;i++){
    const a = Math.random()*Math.PI*2, sp = 40+Math.random()*40;
    gems.push({ x:e.x, y:e.y, v:1, t:0.55, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp });
  }
  if (e.type==='boss' || e.type==='bhboss'){
    burst(e.x,e.y,'#ffd76a',40);
    shake = 16;
    if (mode === 'boss'){ holes = []; endGame(true); }   // BOSS 战击杀 BOSS 即胜利
    else if (mode === 'endless'){
      // 无尽模式：击杀 BOSS = 大量经验水晶 + 一次额外三选一强化，游戏继续
      holes = [];
      for (let k=0;k<25;k++){
        const a = Math.random()*Math.PI*2, sp = 60+Math.random()*140;
        gems.push({ x:e.x, y:e.y, v:3, t:0.55, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp });
      }
      showUpgradePanel(); return;
    }
  }
}
// ---------- 子弹特效 ----------
// 寒冰：命中减速 50%（移速 + 攻速）3 秒
// 雷电：链接附近最多 5 个敌人，各受 50% 伤害
// 灼烧：点燃 8 秒，每秒 1% 最大生命值，不可叠加
// 耶律：无附加特效（1.25 倍伤害 + 追踪已在发射时处理）
function applyBulletEffect(b, e, dmg){
  const bt = b.bt || 'normal';
  if (bt === 'ice'){
    e.slowT = 3;
    burst(e.x, e.y, '#7fd8ff', 4);
  } else if (bt === 'thunder'){
    const cand = [];
    for (const o of enemies){
      if (o === e || o.hp <= 0 || o.suck || o.type === 'ebullet') continue;
      const dd = Math.hypot(o.x-e.x, o.y-e.y);
      if (dd < 300) cand.push({ o, dd });
    }
    cand.sort((a,b2)=>a.dd-b2.dd);
    const hits = cand.slice(0, 5);
    let prev = { x:e.x, y:e.y };
    for (const { o } of hits){
      const d2 = dmg*0.5;
      stats.bullet += d2; o.hp -= d2; hurtFlash(o);
      addDmg(o.x, o.y-o.r-8, d2, false);
      chainFx.push({ x1:prev.x, y1:prev.y, x2:o.x, y2:o.y, t:0, life:0.2 });
      prev = { x:o.x, y:o.y };
      if (o.hp <= 0) killEnemy(o);
    }
    if (hits.length) burst(e.x, e.y, '#c9d4ff', 5);
  } else if (bt === 'burn'){
    // 不可叠加：已经在燃烧就保持原有点燃强度与时长
    if (!(e.burnT > 0)){
      e.burnT = 8;
      e.burnDmg = Math.max(0.5, e.maxHp*0.005);   // 每秒 0.5% 最大生命（不可叠加）
    }
    burst(e.x, e.y, '#ff9a5c', 4);
  }
}
function levelUp(){
  player.level++; player.xp -= player.xpNeed; player.xpNeed = Math.floor(player.xpNeed*1.1+2);
  showUpgradePanel();
}
// BOSS 战：每 30 秒白给一次强化（不吃经验）
function bossUpgrade(){
  if (upgradesGiven >= MAX_UPGRADES) return;
  upgradesGiven++;
  showUpgradePanel();
}
function showUpgradePanel(){
  // 限选次数的强化（如护体旋风、爽煎滑蛋）选过后不再出现；off:true 的强化（坦克引擎）暂时下架不出现
  const avail = UPGRADES.filter(u => !u.off && (!u.max || (player.taken[u.name]||0) < u.max));
  if (!avail.length) return;
  state='levelup';
  joyEnd();
  const title = document.getElementById('levelupTitle');
  if (title) title.textContent = mode==='boss'
    ? `⬆ BOSS 战强化 ${upgradesGiven}/${MAX_UPGRADES}` : '⬆ 升级！选择强化';
  const pool = avail.sort(()=>Math.random()-0.5).slice(0,3);
  const box = document.getElementById('cards');
  box.innerHTML='';
  for (const u of pool){
    const c = document.createElement('div'); c.className='card';
    const badge = u.max ? `<span class="badge">限选 ${u.max} 次</span>` : '';
    c.innerHTML = `<div class="icon">${u.icon}</div>
      <div class="body"><div class="name">${u.name}${badge}</div>
      <div class="desc">${u.desc}</div>
      <div class="note">${u.note||''}</div></div>`;
    c.onclick = ()=>{
      u.apply(player);
      player.taken[u.name] = (player.taken[u.name]||0) + 1;
      document.getElementById('levelup').style.display='none';
      state='playing';
    };
    box.appendChild(c);
  }
  document.getElementById('levelup').style.display='flex';
}
function endGame(win){
  state='end';
  holes = [];
  const winEl = document.getElementById('winTitle'), loseEl = document.getElementById('loseTitle');
  winEl.textContent = mode==='boss' ? '🏆 BOSS 已被击杀！' : '🏆 你活下来了！';
  loseEl.textContent = mode==='boss' ? '💀 你被 BOSS 碾碎了…' : (mode==='endless' ? '💀 无尽之旅到此为止…' : '💀 你被吞没了…');
  winEl.style.display = win?'block':'none';
  loseEl.style.display = win?'none':'block';
  const m = Math.floor(gameTime/60), s = Math.floor(gameTime%60);
  const total = Math.round(stats.bullet + stats.burn + stats.orb + stats.slash);
  const dps = Math.round(total / Math.max(1, gameTime));
  const pct = v => total>0 ? Math.round(v/total*100) : 0;
  const card = (v,k) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
  const durTxt = `${m}:${String(s).padStart(2,'0')}`;
  document.getElementById('endStats').innerHTML =
      (mode === 'classic' ? card('+'+runPoints, '本局积分') : card(runPoints, '本局积分'))
    + card(total.toLocaleString(), '总伤害')
    + card(dps, '每秒伤害')
    + card(kills, '击杀数')
    + (mode==='boss' ? card(`${upgradesGiven}/${MAX_UPGRADES}`, '强化')
      : mode==='endless' ? card(endlessBosses, '击杀BOSS')
      : card(player.level, '等级'))
    + card(durTxt, mode==='boss' ? '挑战时长' : '存活时间');
  const src = [];
  if (stats.bullet>0) src.push(`<b>子弹 ${pct(stats.bullet)}%</b>`);
  if (stats.slash>0)  src.push(`<b>斩击 ${pct(stats.slash)}%</b>`);
  if (stats.burn>0)   src.push(`<b>灼烧 ${pct(stats.burn)}%</b>`);
  if (stats.orb>0)    src.push(`<b>旋风 ${pct(stats.orb)}%</b>`);
  let infoHtml = '伤害来源：' + (src.join(' · ') || '—');
  // 积分结算：十分钟模式本局积分已存入账户余额
  if (mode === 'classic'){
    infoHtml += `<br>💰 本局 +${runPoints} 积分 · 总积分 ${userPoints}（可在商店解锁子弹）`;
    progressDirty = false;
    saveProgress();
  }
  // BOSS 试炼：挑战成功奖励 2000 积分（进入时已扣 500）
  if (mode === 'boss'){
    if (win){
      userPoints += BOSS_WIN_REWARD;
      runPoints += BOSS_WIN_REWARD;
      progressDirty = false;
      saveProgress();
      infoHtml += `<br>🏆 挑战成功！<b style="color:#7ee787">+${BOSS_WIN_REWARD} 积分</b>`
        + `（消耗 ${BOSS_ENTRY_COST}）· 总积分 ${userPoints.toLocaleString()}`
        + `<br><b style="color:#ffd76a">净赚 ${BOSS_WIN_REWARD - BOSS_ENTRY_COST} 积分</b>`;
    } else {
      infoHtml += `<br>💀 挑战失败 · 已消耗 ${BOSS_ENTRY_COST} 积分 · 总积分 ${userPoints.toLocaleString()}`;
    }
  }
  // 无尽模式：本地最佳纪录（按存活时间），破纪录时标记
  if (mode === 'endless'){
    let best = null;
    try { best = JSON.parse(Store.get('rg_endless_best') || 'null'); } catch(_){}
    endlessNewBest = !best || gameTime > best.time;
    if (endlessNewBest){
      best = { time: Math.floor(gameTime), kills, level: player.level };
      try { Store.set('rg_endless_best', JSON.stringify(best)); } catch(_){}
    }
    const bm = Math.floor((best?best.time:0)/60), bs = Math.floor((best?best.time:0)%60);
    infoHtml += `<br>♾ 最佳纪录 ${bm}:${String(bs).padStart(2,'0')} · 击杀 ${best?best.kills:0}`
      + (endlessNewBest ? '　<b style="color:#ffd76a">🌟 新纪录！</b>' : '');
  }
  // 排行榜：无尽提交积分榜；BOSS 提交积分榜 + 该 BOSS 的最快击杀榜（仅击杀成功计入）
  if (mode === 'endless' || mode === 'boss'){
    const rec = submitScore(mode, mode==='boss' ? bossKind : null, runPoints, Math.floor(gameTime),
      kills, player.level, mode === 'boss' ? !!win : true);
    if (mode === 'endless') lastLbBoard = 'endless_points';
    else lastLbBoard = (win && BOSS_TIME_BOARD[bossKind]) ? BOSS_TIME_BOARD[bossKind] : 'boss_points';
    const bossName = bossKind === 'blade' ? '血刃巨像' : '黑洞怪';
    const boardTxt = mode === 'endless' ? '无尽 · 积分'
      : win ? `BOSS 积分 + ${bossName} 最快击杀（${fmtDur(gameTime)}）`
      : 'BOSS 积分（未击杀，不计入最快击杀榜）';
    infoHtml += `<br>📊 已提交排行榜（${boardTxt}）`
      + ` · 我的ID <b style="color:#8fd6ff">${rec.player_id}</b>`;
  }
  document.getElementById('endInfo').innerHTML = infoHtml;
  document.getElementById('endLbBtn').style.display = (mode === 'endless' || mode === 'boss') ? 'block' : 'none';
  document.getElementById('endscreen').style.display='flex';
}

function updateHUD(){
  const timerEl = document.getElementById('timer');
  if (mode === 'boss'){
    // BOSS 战：正计时，无倒计时
    const m=Math.floor(gameTime/60), s=Math.floor(gameTime%60);
    timerEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
    timerEl.style.color = '#ffb0c8';
    document.getElementById('stats').innerHTML =
      `强化 ${upgradesGiven}/${MAX_UPGRADES}<br>击杀 ${kills}<br>积分 ${runPoints}`;
    const p = upgradesGiven >= MAX_UPGRADES ? 1 : 1 - Math.max(0, upgradeTimer)/BOSS_UPGRADE_T;
    document.getElementById('xpfill').style.width = (p*100)+'%';
    document.getElementById('xpfill').style.background = '#c07cff';
  } else if (mode === 'endless'){
    // 无尽模式：正计时，经验升级正常进行
    const m=Math.floor(gameTime/60), s=Math.floor(gameTime%60);
    timerEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
    timerEl.style.color = '#8fd6ff';
    document.getElementById('stats').innerHTML =
      `等级 ${player.level}<br>击杀 ${kills}<br>BOSS ${endlessBosses}<br>积分 ${runPoints}`;
    document.getElementById('xpfill').style.width = (player.xp/player.xpNeed*100)+'%';
    document.getElementById('xpfill').style.background = '#4dd4ff';
  } else {
    const left = Math.max(0, GAME_TIME-gameTime);
    const m=Math.floor(left/60), s=Math.floor(left%60);
    timerEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
    timerEl.style.color = left<60 ? '#ff6b6b' : '#e8e8e8';
    document.getElementById('stats').innerHTML = `等级 ${player.level}<br>积分 ${runPoints}`;
    document.getElementById('xpfill').style.width = (player.xp/player.xpNeed*100)+'%';
    document.getElementById('xpfill').style.background = '#4dd4ff';
  }
  updateBossBar();
  updateHearts();
  updateStatusBar();
}

// ---------- 状态栏：实时显示当前属性 ----------
let lastStatSig = '', statBurnAt = 0, statBurnVal = 0;
function updateStatusBar(){
  const el = document.getElementById('statbar');
  if (!el || state === 'menu') return;
  const rate = player.fireDelay > 0 ? 1/player.fireDelay : 0;
  const bt = BULLETS[player.bullet] || BULLETS.normal;
  // 灼烧累计伤害每帧都在涨，按 0.4 秒节流取值，避免频繁重写 DOM
  const clock = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (clock - statBurnAt > 400){ statBurnAt = clock; statBurnVal = Math.round(stats.burn); }
  const rows = [];
  rows.push(['⚔ 攻击', player.dmg.toFixed(1), false]);
  rows.push(['⚡ 攻速', rate.toFixed(2)+'/s', true]);
  rows.push(['🔱 多重', String(player.multi), true]);
  rows.push(['🎯 穿透', String(player.pierce), true]);
  rows.push(['💥 暴击', Math.round(player.crit*100)+'%', true]);
  rows.push(['👟 移速', String(Math.round(player.speed)), false]);
  rows.push(['🛡 减伤', Math.round(player.armor*100)+'%', true]);
  if (player.regen > 0) rows.push(['💊 再生', player.regen+'/s', true]);
  if (player.orbs > 0){
    const charges = (player.orbHp||[]).reduce((a,b)=>a+Math.max(0,b), 0);
    rows.push(['🌀 旋风', `${player.orbs} 颗 · 挡 ${charges} 次`, false]);
  }
  if (stats.burn > 0) rows.push(['🔥 灼烧', statBurnVal.toLocaleString()+' 总伤害', false]);
  rows.push(['🔮 子弹', bt.icon + bt.name, false]);
  if (player.slashMode){
    const ready = player.slashEnergy >= SLASH_CHARGE;
    rows.push(['🍳 普攻', ready ? '斩击 · 八向就绪' : '斩击', true]);
  }
  const sig = rows.map(r => r[0]+r[1]).join('|');
  if (sig === lastStatSig) return;
  lastStatSig = sig;
  el.innerHTML = rows.map(([k,v,opt]) =>
    `<div class="sr${opt?' opt':''}"><span class="sk">${k}</span><span class="sv">${v}</span></div>`
  ).join('');
}
function resetStatusBar(){ lastStatSig = ''; const el = document.getElementById('statbar'); if (el) el.innerHTML = ''; }

// BOSS 血条（仅 BOSS 战 / 无尽模式显示）
// 场上同时存在多个 BOSS 时，每个 BOSS 一条血条；最多显示 4 条，超出部分不展示。
const MAX_BOSS_BARS = 4;
let bossBars = [];        // [{ root, name, fill, key }]
let bossBarsSig = '';     // 血条结构签名（BOSS 数量/类型变化才重建 DOM）
function resetBossBar(){
  const bar = document.getElementById('bossbar');
  if (bar){ bar.style.display='none'; bar.innerHTML=''; }
  bossBars = []; bossBarsSig = '';
}
function updateBossBar(){
  const bar = document.getElementById('bossbar');
  if (!bar) return;
  const list = [];
  for (const e of enemies){ if (e.type==='bhboss' || e.type==='boss') list.push(e); }
  if ((mode !== 'boss' && mode !== 'endless') || !list.length){
    if (bar.style.display !== 'none') resetBossBar();
    return;
  }
  bar.style.display = 'flex';
  const shown = list.slice(0, MAX_BOSS_BARS);

  // 结构变化（BOSS 数量/类型/顺序）才重建，避免每帧重建 DOM
  const sig = shown.map(e => e.type + '#' + e.id).join(',');
  if (sig !== bossBarsSig){
    bossBarsSig = sig;
    bar.innerHTML = '';
    bossBars = [];
    for (let i=0;i<shown.length;i++){
      const root  = document.createElement('div'); root.className = 'bossrow';
      const name  = document.createElement('div'); name.className = 'bossnm';
      const track = document.createElement('div'); track.className = 'bosstrack';
      const fill  = document.createElement('div'); fill.className = 'bossfill';
      track.appendChild(fill); root.appendChild(name); root.appendChild(track);
      bar.appendChild(root);
      bossBars.push({ name, fill, key:'', lastW:null, lastBg:null });
    }
    if (list.length > MAX_BOSS_BARS){
      const more = document.createElement('div'); more.className = 'bossmore';
      more.textContent = `还有 ${list.length - MAX_BOSS_BARS} 个 BOSS 未显示`;
      bar.appendChild(more);
    }
  }

  for (let i=0;i<shown.length;i++){
    const b = shown[i], row = bossBars[i];
    if (!row) break;
    const nm = (shown.length > 1 ? `#${i+1} ` : '')
      + (b.type==='bhboss' ? '🌀 黑洞怪' : '🔥 血刃巨像')
      + (b.enraged ? ' · 狂暴' : '')
      + (b.type==='bhboss'
          ? ` · 总血 ${Math.round(b.maxHp)} · 吞噬 ${Math.round(b.absorbed||0)}`
          : ` · ${Math.max(0,Math.round(b.hp))}/${Math.round(b.maxHp)}`);
    if (row.key !== nm){ row.name.textContent = nm; row.key = nm; }
    const pct = Math.max(0, Math.min(100, b.hp / b.maxHp * 100));
    if (row.lastW !== pct){ row.fill.style.width = pct + '%'; row.lastW = pct; }
    const bg = b.enraged
      ? 'linear-gradient(90deg,#7a3bd6,#d9b8ff)' : 'linear-gradient(90deg,#ff3b6b,#ff8aa8)';
    if (row.lastBg !== bg){ row.fill.style.background = bg; row.lastBg = bg; }
  }
}

// ---------- 心形血量 ----------
// 每颗心固定代表 HP_PER_HEART 点生命：血上限越高，心越多、血条越长。
// 最多显示 HEART_SLOTS 颗（一行 15、共两行）；再往上不再加长，
// 而是在每颗心上用不同颜色层层叠加，并在右侧标注「×层数」。
let lastHeartKey = '';
const HP_PER_HEART = 10;
const HEART_SLOTS  = 30;
const HEART_COLORS = ['#e5484d','#ff8f3c','#ffd24a','#5fe0a8','#4dd4ff','#c07cff'];
const HEART_PATH = 'M12 21.2C9.2 19 2.2 14.2 2.2 8.9 2.2 5.7 4.7 3.4 7.6 3.4c1.9 0 3.5 1 4.4 2.5.9-1.5 2.5-2.5 4.4-2.5 2.9 0 5.4 2.3 5.4 5.5 0 5.3-7 10.1-9.8 12.3z';

function updateHearts(){
  const totalHearts = Math.max(1, Math.ceil(player.maxHp/HP_PER_HEART));
  const layers = Math.max(1, Math.ceil(totalHearts/HEART_SLOTS));  // 叠加层数
  const slots  = Math.min(totalHearts, HEART_SLOTS);
  const filled = Math.max(0, player.hp)/HP_PER_HEART;              // 已填充心数（含小数）
  const low = player.hp <= player.maxHp*0.3;
  const key = totalHearts+'|'+(Math.round(filled*4)/4)+'|'+(low?1:0);
  if (key === lastHeartKey) return;
  lastHeartKey = key;

  let html = '';
  for (let i=0;i<slots;i++){
    let stack = '';
    for (let k=0;k<layers;k++){
      const idx = k*HEART_SLOTS + i;      // 这一层对应的心序号
      if (idx >= totalHearts) break;      // 该槽位没有这一层
      const f = Math.min(1, Math.max(0, filled - idx));
      const col = HEART_COLORS[k % HEART_COLORS.length];
      const cid = 'hc'+k+'_'+i;
      if (k === 0){
        stack += `<svg viewBox="0 0 24 24">
          <path d="${HEART_PATH}" fill="#2a2f3a" stroke="#4a5464" stroke-width="0.8"/>`
          + (f>0 ? `<clipPath id="${cid}"><rect x="0" y="0" width="${(f*24).toFixed(2)}" height="24"/></clipPath>
            <path d="${HEART_PATH}" fill="${col}" clip-path="url(#${cid})"/>` : '')
          + `</svg>`;
      } else if (f > 0){
        const sc = Math.max(0.34, 1 - k*0.2).toFixed(3);
        stack += `<svg viewBox="0 0 24 24">
          <clipPath id="${cid}"><rect x="0" y="0" width="${(f*24).toFixed(2)}" height="24"/></clipPath>
          <g transform="translate(12 12) scale(${sc}) translate(-12 -12)">
            <path d="${HEART_PATH}" fill="rgba(0,0,0,.35)" stroke="rgba(0,0,0,.55)" stroke-width="1.1"/>
            <path d="${HEART_PATH}" fill="${col}" clip-path="url(#${cid})"/>
          </g></svg>`;
      }
    }
    html += `<div class="heart${low&&filled>0?' low':''}">${stack}</div>`;
  }
  if (layers > 1) html += `<span class="mul">×${layers}</span>`;
  document.getElementById('hearts').innerHTML = html;
}

// ---------- 绘制 ----------
// 黑洞怪：旋涡外形
function drawBlackHole(e){
  const R = e.r;
  const g = ctx.createRadialGradient(e.x, e.y, R*0.2, e.x, e.y, R*1.45);
  g.addColorStop(0, 'rgba(10,3,22,0.96)');
  g.addColorStop(0.5, 'rgba(58,26,110,0.9)');
  g.addColorStop(1, 'rgba(120,70,220,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(e.x, e.y, R*1.45, 0, Math.PI*2); ctx.fill();
  // 三条旋臂
  ctx.strokeStyle = e.enraged ? '#e0c4ff' : '#9a7cff';
  ctx.lineWidth = Math.max(2, R*0.07);
  for (let k=0;k<3;k++){
    ctx.beginPath();
    const base = e.vortexA + k*Math.PI*2/3;
    for (let t=0;t<=1.0001;t+=0.1){
      const rr = R*(0.25 + 0.8*t);
      const aa = base + t*2.6;
      const px = e.x + Math.cos(aa)*rr, py = e.y + Math.sin(aa)*rr;
      if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
  }
  // 事件视界
  ctx.beginPath(); ctx.arc(e.x, e.y, R*0.4, 0, Math.PI*2);
  ctx.fillStyle = e.enraged ? '#f0e0ff' : '#7a4ad0'; ctx.fill();
  // 血条 + 名字
  const w = R*1.8;
  ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(e.x-w/2, e.y-R-16, w, 5);
  ctx.fillStyle='#c9a8ff'; ctx.fillRect(e.x-w/2, e.y-R-16, w*Math.max(0,e.hp/e.maxHp), 5);
  ctx.fillStyle='#fff'; ctx.font='bold 15px sans-serif'; ctx.textAlign='center';
  ctx.fillText(e.enraged ? '黑洞怪 · 狂暴' : '黑洞怪', e.x, e.y-R-24);
}
// 宇宙物质：黑色方形本体 + 双层灰色重影（向运动方向偏移），缓慢自旋
function drawMatter(e){
  const s = e.r;
  const va = Math.hypot(e.dx||0, e.dy||0) || 1;
  const ox = (e.dx||0)/va*s*0.55, oy = (e.dy||0)/va*s*0.55;
  // 重影 1：远层，更大更淡
  ctx.save();
  ctx.translate(e.x+ox*1.8, e.y+oy*1.8);
  ctx.rotate(e.rot);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#9a9aa6';
  ctx.fillRect(-s*1.15, -s*1.15, s*2.3, s*2.3);
  ctx.restore();
  // 重影 2：近层，偏移一半
  ctx.save();
  ctx.translate(e.x+ox, e.y+oy);
  ctx.rotate(e.rot);
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#8a8a94';
  ctx.fillRect(-s*0.95, -s*0.95, s*1.9, s*1.9);
  ctx.restore();
  ctx.globalAlpha = 1;
  // 黑色本体
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.rot);
  ctx.fillStyle = e.hurtT>0 ? '#e8e8f0' : e.col;
  ctx.fillRect(-s, -s, s*2, s*2);
  ctx.lineWidth = Math.max(1.5, s*0.14);
  ctx.strokeStyle = '#6a6a76';
  ctx.strokeRect(-s, -s, s*2, s*2);
  ctx.restore();
  // 血条
  if (e.hp < e.maxHp){
    const w = s*2;
    ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(e.x-w/2, e.y-s-8, w, 4);
    ctx.fillStyle='#e5484d'; ctx.fillRect(e.x-w/2, e.y-s-8, w*Math.max(0,e.hp/e.maxHp), 4);
  }
}

function draw(){
  ctx.fillStyle='#0d0f14'; ctx.fillRect(0,0,W,H);
  ctx.save();
  if (shake>0) ctx.translate((Math.random()-0.5)*shake,(Math.random()-0.5)*shake);
  // 世界变换：先平移相机，再按视野缩放
  ctx.translate(-camX*viewScale, -camY*viewScale);
  ctx.scale(viewScale, viewScale);
  const vw = W/viewScale, vh = H/viewScale;   // 可视世界范围
  // 网格地面
  const gs=80, px = 1/viewScale;              // 保持屏幕 1px 细线
  ctx.strokeStyle='#1a1f2b'; ctx.lineWidth=px;
  const x0 = Math.floor(camX/gs)*gs, y0 = Math.floor(camY/gs)*gs;
  for(let x=x0; x<camX+vw+gs; x+=gs){ ctx.beginPath(); ctx.moveTo(x,camY); ctx.lineTo(x,camY+vh); ctx.stroke(); }
  for(let y=y0; y<camY+vh+gs; y+=gs){ ctx.beginPath(); ctx.moveTo(camX,y); ctx.lineTo(camX+vw,y); ctx.stroke(); }
  if (state==='menu'){ ctx.restore(); return; }
  // BOSS 试炼：封闭竞技场（场外压暗 + 发光边界）
  if (mode === 'boss'){
    const HF = BOSS_ARENA_HALF;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    if (camX < -HF) ctx.fillRect(camX, camY, -HF-camX, vh);
    if (camX+vw > HF) ctx.fillRect(HF, camY, camX+vw-HF, vh);
    const ix0 = Math.max(camX, -HF), ix1 = Math.min(camX+vw, HF);
    if (camY < -HF && ix1 > ix0) ctx.fillRect(ix0, camY, ix1-ix0, -HF-camY);
    if (camY+vh > HF && ix1 > ix0) ctx.fillRect(ix0, HF, ix1-ix0, camY+vh-HF);
    ctx.strokeStyle = '#7a5aff'; ctx.lineWidth = 2.5/viewScale;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(-HF, -HF, HF*2, HF*2);
    ctx.globalAlpha = 1;
  }
  // 水晶（无尽模式亮度降低，避免全屏吸取时晃眼）
  const gemDim = mode === 'endless' ? 0.42 : 1;
  for (const g of gems){
    const pop = g.t>0 ? 0.75 + 0.55*(1 - g.t/0.55) : 1;
    ctx.save(); ctx.translate(g.x,g.y); ctx.rotate(gameTime*3);
    ctx.globalAlpha = (mode === 'endless' ? 0.12 : 0.3);
    ctx.fillStyle='#4dd4ff'; ctx.beginPath(); ctx.arc(0,0,12*pop,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = gemDim;
    ctx.fillStyle='#8be6ff';
    ctx.fillRect(-4.5*pop,-4.5*pop,9*pop,9*pop);
    ctx.restore();
  }
  // 敌人
  for (const e of enemies){
    if (e.type==='bhboss'){ drawBlackHole(e); continue; }
    if (e.type==='matter'){ drawMatter(e); continue; }
    // 拖尾（黑洞怪弹幕）
    if (e.trail && e.trail.length > 1){
      for (let k=1;k<e.trail.length;k++){
        const a = k/e.trail.length;
        ctx.globalAlpha = a*0.55;
        ctx.strokeStyle = e.col; ctx.lineWidth = Math.max(1.5, e.r*1.7*a);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(e.trail[k-1].x, e.trail[k-1].y);
        ctx.lineTo(e.trail[k].x, e.trail[k].y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,Math.PI*2);
    ctx.fillStyle = e.hurtT>0 ? '#ffffff' : e.col;
    ctx.fill();
    // 深色描边：缩放变小后仍能看清轮廓
    ctx.lineWidth = Math.max(2, e.r*0.14);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    // 血条
    if (e.hp<e.maxHp && e.type!=='ebullet'){
      ctx.fillStyle='#000a'; ctx.fillRect(e.x-e.r, e.y-e.r-8, e.r*2, 4);
      ctx.fillStyle='#e5484d'; ctx.fillRect(e.x-e.r, e.y-e.r-8, e.r*2*Math.max(0,e.hp/e.maxHp), 4);
    }
    if (e.type==='boss'){
      ctx.fillStyle='#fff'; ctx.font='bold 16px sans-serif'; ctx.textAlign='center';
      ctx.fillText('BOSS', e.x, e.y-e.r-14);
    }
  }
  // 小黑洞
  for (const h of holes){
    // 细长紫色拖尾：沿运动轨迹逐段收窄变淡
    if (h.trail && h.trail.length > 1){
      ctx.lineCap = 'round';
      for (let k=1;k<h.trail.length;k++){
        const a = k/h.trail.length;
        ctx.globalAlpha = a*0.65;
        ctx.strokeStyle = '#a26bff';
        ctx.lineWidth = Math.max(1, h.r*0.34*a);
        ctx.beginPath(); ctx.moveTo(h.trail[k-1].x, h.trail[k-1].y);
        ctx.lineTo(h.trail[k].x, h.trail[k].y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.arc(h.x,h.y,h.r*1.7,0,Math.PI*2);
    ctx.fillStyle='rgba(110,60,200,0.14)'; ctx.fill();
    ctx.beginPath(); ctx.arc(h.x,h.y,h.r,0,Math.PI*2);
    ctx.fillStyle='#08030f'; ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = h.pct>=0.20 ? '#ff5c8a' : h.pct>=0.15 ? '#c07cff' : '#7a5aff';
    ctx.stroke();
    ctx.beginPath(); ctx.arc(h.x,h.y,h.r*0.62, h.rot, h.rot+Math.PI*1.4);
    ctx.strokeStyle='rgba(190,150,255,0.8)'; ctx.lineWidth = Math.max(1.5, h.r*0.14);
    ctx.stroke();
  }
  // 粒子
  for (const p of parts){ ctx.globalAlpha=p.life/0.3; ctx.fillStyle=p.col; ctx.fillRect(p.x-2,p.y-2,4,4); }
  ctx.globalAlpha=1;
  // 子弹（按类型着色；耶律弹带长绿色拖尾；未命中时变淡）
  for (const b of bullets){
    const info = BULLETS[b.bt || 'normal'] || BULLETS.normal;
    const missA = b.missT > 0 ? 0.35 : 1;
    if (b.bt === 'yelve' && b.trail && b.trail.length > 1){
      ctx.lineCap = 'round';
      for (let k=1;k<b.trail.length;k++){
        const a = k/b.trail.length;
        ctx.globalAlpha = a*0.85*missA;
        ctx.strokeStyle = '#3ee87a';
        ctx.lineWidth = Math.max(1, b.r*1.1*a);
        ctx.beginPath(); ctx.moveTo(b.trail[k-1].x, b.trail[k-1].y);
        ctx.lineTo(b.trail[k].x, b.trail[k].y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = missA;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r*1.9,0,Math.PI*2);
    ctx.fillStyle = info.color + '38'; ctx.fill();
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
    ctx.fillStyle = info.color; ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle='rgba(10,25,45,0.6)'; ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 雷电链
  for (const c of chainFx){
    const a = 1 - c.t/c.life;
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#bcd0ff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const seg = 4;
    ctx.moveTo(c.x1, c.y1);
    for (let k=1;k<seg;k++){
      const t = k/seg;
      const jx = (Math.random()-0.5)*14, jy = (Math.random()-0.5)*14;
      ctx.lineTo(c.x1 + (c.x2-c.x1)*t + jx, c.y1 + (c.y2-c.y1)*t + jy);
    }
    ctx.lineTo(c.x2, c.y2);
    ctx.stroke();
    ctx.globalAlpha = a*0.5;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 旋风盾
  if (player.orbs>0){
    for (let i=0;i<player.orbs;i++){
      const ox2 = player.x + Math.cos(player.orbAngle + i*Math.PI*2/player.orbs)*55;
      const oy2 = player.y + Math.sin(player.orbAngle + i*Math.PI*2/player.orbs)*55;
      const left = player.orbHp && player.orbHp[i] != null ? player.orbHp[i] : ORB_GUARD;
      ctx.beginPath(); ctx.arc(ox2,oy2,9,0,Math.PI*2);
      ctx.fillStyle = left > 1 ? '#7ee7d8' : '#3f8f88';   // 只剩 1 次格挡时变暗
      ctx.fill();
      ctx.lineWidth=1.5; ctx.strokeStyle='rgba(0,40,40,0.55)'; ctx.stroke();
      if (left > 1){
        // 满格挡：外圈光晕
        ctx.beginPath(); ctx.arc(ox2,oy2,12.5,0,Math.PI*2);
        ctx.strokeStyle='rgba(126,231,216,0.35)'; ctx.lineWidth=1.5; ctx.stroke();
      } else {
        // 剩 1 次：虚线外圈提示即将碎裂
        ctx.beginPath(); ctx.arc(ox2,oy2,12.5,0,Math.PI*2);
        ctx.setLineDash([3,4]); ctx.strokeStyle='rgba(126,231,216,0.55)'; ctx.lineWidth=1.2;
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }
  // 斩击特效
  for (const s of slashFx){
    const p = 1 - s.life/s.maxLife;
    const r = s.radius * (0.55 + 0.5*p);
    ctx.globalAlpha = (1-p)*0.95;
    ctx.strokeStyle = s.col;
    ctx.lineWidth = s.ring ? Math.max(2, 5*(1-p)) : Math.max(3, 16*(1-p));
    ctx.beginPath();
    if (s.ring) ctx.arc(s.x, s.y, r, 0, Math.PI*2);
    else ctx.arc(s.x, s.y, r, s.ang - s.arc, s.ang + s.arc);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 玩家
  ctx.beginPath(); ctx.arc(player.x,player.y,player.r,0,Math.PI*2);
  ctx.fillStyle = player.invul>0 && Math.floor(gameTime*20)%2 ? '#666' : '#f2f2f2';
  ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#2b6cff'; ctx.stroke();
  // 斩击充能环（满 8 秒释放八向斩击）
  if (player.slashMode){
    const t = Math.min(1, player.slashEnergy/SLASH_CHARGE);
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r+9, -Math.PI/2, -Math.PI/2 + t*Math.PI*2);
    ctx.lineWidth = 4; ctx.strokeStyle = t>=0.999 ? '#ffe9a8' : 'rgba(255,233,168,0.75)';
    ctx.stroke();
  }
  ctx.fillStyle='#2b6cff'; // 朝向指示（指向最近敌人）
  let nearest=null,bd=1e9;
  for(const e of enemies){ if(e.type==='ebullet'||e.suck) continue; const d=Math.hypot(e.x-player.x,e.y-player.y);if(d<bd){bd=d;nearest=e;} }
  const fa = nearest ? Math.atan2(nearest.y-player.y,nearest.x-player.x) : player.faceAng;
  ctx.beginPath(); ctx.arc(player.x+Math.cos(fa)*10, player.y+Math.sin(fa)*10, 5, 0, Math.PI*2); ctx.fill();

  // 伤害飘字：普通伤害字号克制，暴击字号更大 + 金色发光
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const d of dmgNums){
    const left = 1 - d.t/d.life;                       // 1 → 0
    const pop  = Math.min(1, d.t/0.08);                // 弹出放大
    const size = (d.crit ? 26 : 15) * (0.65 + 0.35*pop) / viewScale;
    ctx.globalAlpha = left > 0.6 ? 1 : Math.max(0, left/0.6);
    ctx.font = `${d.crit ? 900 : 700} ${size.toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.lineWidth = Math.max(2, size*0.22);
    ctx.strokeStyle = d.crit ? 'rgba(90,45,0,0.95)' : 'rgba(0,0,0,0.8)';
    ctx.strokeText(d.val, d.x, d.y);
    if (d.crit){ ctx.shadowColor = '#ffb020'; ctx.shadowBlur = 12; }
    ctx.fillStyle = d.col || (d.crit ? '#ffd24a' : '#ffe9cf');
    ctx.fillText(d.val, d.x, d.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // BOSS 登场提示（屏幕坐标）
  if ((mode==='boss'||mode==='endless') && bossWarn>0 && state==='playing'){
    const nm = bossKind==='blackhole' ? '黑洞' : '血刃巨像';
    const size = Math.min(38, W*0.052) * (1 + Math.sin(gameTime*9)*0.05);
    ctx.save();
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0, H*0.30, W, size*1.8);
    ctx.font = `900 ${size.toFixed(1)}px "Microsoft YaHei", sans-serif`;
    ctx.shadowColor='#ff2d6a'; ctx.shadowBlur = 20;
    ctx.fillStyle='#ff8aa8';
    ctx.fillText(`⚠ ${nm}正在降临… ${Math.ceil(bossWarn)}`, W/2, H*0.30 + size*0.9);
    ctx.restore();
  }

  // 摇杆（屏幕坐标）
  if (joy.active && state==='playing'){
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(joy.bx, joy.by, joy.R, 0, Math.PI*2);
    ctx.fillStyle = '#1b2333'; ctx.fill();
    ctx.strokeStyle = '#5a7392'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(joy.kx, joy.ky, 26, 0, Math.PI*2);
    ctx.fillStyle = '#8fc6ff'; ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---------- 主循环 ----------
let last = performance.now();
let uiPointsSeen = -1;
function loop(now){
  const dt = Math.min(0.05, (now-last)/1000); last = now;
  document.body.classList.toggle('ingame', state !== 'menu');
  if (state==='playing') update(dt);
  else if (state==='levelup'||state==='end') updateHUD();
  // 主页积分 / 存档面板跟随余额刷新
  if (uiPointsSeen !== userPoints){ uiPointsSeen = userPoints; paintPointsUI(); }
  // 云端推送心跳（菜单里也生效；后台标签页由 visibilitychange / pagehide 兜底）
  cloudSaveT += dt;
  if (cloudDirty && !cloudBusy && cloudSaveT >= 3){ cloudSaveT = 0; cloudPushProgress(true); }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- 按钮 ----------
const pauseBtn = document.getElementById('pauseBtn');
const pauseScreen = document.getElementById('pausescreen');
function setPaused(p){
  if (p){
    if (state !== 'playing') return;
    state = 'paused';
    joyEnd();                                  // 暂停时松开摇杆，避免恢复后自己乱跑
    for (const k in keys) keys[k] = false;     // 清掉按住的方向键
    pauseScreen.style.display = 'flex';
    pauseBtn.textContent = '▶';
  } else {
    if (state !== 'paused') return;
    state = 'playing';
    pauseScreen.style.display = 'none';
    pauseBtn.textContent = '⏸';
  }
}
pauseBtn.onclick = e => { e.stopPropagation(); setPaused(state === 'playing'); };
document.getElementById('resumeBtn').onclick = ()=> setPaused(false);
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'p' || k === 'escape'){
    if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  }
});
// 切到后台自动暂停（避免回来时被围杀）
document.addEventListener('visibilitychange', ()=>{ if (document.hidden) setPaused(true); });

// ---------- 页面切换 ----------
const homescreen = document.getElementById('homescreen');
const startscreen = document.getElementById('startscreen');
const bossscreen  = document.getElementById('bossscreen');
const endlessScreen = document.getElementById('endlessScreen');
const endscreen   = document.getElementById('endscreen');
function hideAll(){
  homescreen.style.display='none';
  startscreen.style.display='none';
  bossscreen.style.display='none';
  endlessScreen.style.display='none';
  pauseScreen.style.display='none';
  endscreen.style.display='none';
  const shop = document.getElementById('shopscreen');
  const login = document.getElementById('loginscreen');
  const lb = document.getElementById('lbscreen');
  if (shop) shop.style.display='none';
  if (login) login.style.display='none';
  if (lb) lb.style.display='none';
  pauseBtn.textContent='⏸';
}
function goHome(){
  hideAll();
  state = 'menu';
  joyEnd();
  homescreen.style.display='flex';
}
function enterClassic(){          // 主页 → 十分钟模式 → 玩法说明
  hideAll();
  state = 'menu';
  startscreen.style.display='flex';
}
function bossMsg(text, ok){
  const el = document.getElementById('bossMsg');
  if (!el) return;
  el.textContent = text;
  el.className = 'bossmsg' + (ok ? ' ok' : '');
}
function refreshBossWallet(){
  const el = document.getElementById('bossWallet');
  if (!el) return;
  el.innerHTML = `💰 我的积分 <b>${userPoints.toLocaleString()}</b>`
    + `　·　挑战消耗 <b style="color:#ff9a9a">${BOSS_ENTRY_COST}</b>`
    + `　·　挑战成功 <b style="color:#7ee787">+${BOSS_WIN_REWARD}</b>`;
}
function enterBossPick(keepMsg){  // 主页 → BOSS 试炼 → 选 boss
  hideAll();
  state = 'menu';
  bossscreen.style.display='flex';
  refreshBossWallet();
  if (!keepMsg) bossMsg('');
}
function enterEndless(){          // 主页 → 无尽模式 → 玩法说明（含最佳纪录）
  hideAll();
  state = 'menu';
  let best = null;
  try { best = JSON.parse(Store.get('rg_endless_best') || 'null'); } catch(_){}
  const el = document.getElementById('endlessBest');
  if (best){
    const bm = Math.floor(best.time/60), bs = Math.floor(best.time%60);
    el.textContent = `🏅 最佳纪录 ${bm}:${String(bs).padStart(2,'0')} · 击杀 ${best.kills} · 等级 ${best.level}`;
  } else {
    el.textContent = '暂无纪录，来创造第一个吧！';
  }
  endlessScreen.style.display='flex';
}
function startClassic(){          // 真正开局（十分钟）
  hideAll();
  lastMode='classic';
  newGame('classic'); state='playing';
}
function startEndless(){          // 真正开局（无尽）
  hideAll();
  lastMode='endless';
  newGame('endless'); state='playing';
}
function startBoss(kind){         // 真正开局（BOSS 战）：每次挑战消耗 500 积分
  if (userPoints < BOSS_ENTRY_COST){
    const lack = BOSS_ENTRY_COST - userPoints;
    bossMsg(`积分不足：挑战 BOSS 需要 ${BOSS_ENTRY_COST} 积分，当前 ${userPoints}，还差 ${lack} 分（十分钟模式可赚积分）`, false);
    refreshBossWallet();
    return false;
  }
  userPoints -= BOSS_ENTRY_COST;
  progressDirty = false;
  saveProgress();
  hideAll();
  lastMode='boss'; lastBoss=kind;
  newGame('boss', kind); state='playing';
  return true;
}
function retry(){
  if (lastMode==='boss'){ if (!startBoss(lastBoss)){ enterBossPick(true); } }
  else if (lastMode==='endless') startEndless();
  else startClassic();
}

document.getElementById('modeClassic').onclick = enterClassic;
document.getElementById('modeEndless').onclick = enterEndless;
document.getElementById('modeBoss').onclick = enterBossPick;
document.getElementById('bossBackBtn').onclick = goHome;
document.getElementById('bossBlackhole').onclick = ()=> startBoss('blackhole');
document.getElementById('bossBlade').onclick = ()=> startBoss('blade');
document.getElementById('startBackBtn').onclick = goHome;
document.getElementById('startBtn').onclick = startClassic;
document.getElementById('endlessBackBtn').onclick = goHome;
document.getElementById('endlessStartBtn').onclick = startEndless;
document.getElementById('retryBtn').onclick = retry;
document.getElementById('endHomeBtn').onclick = goHome;
document.getElementById('pauseHomeBtn').onclick = goHome;
document.getElementById('restartBtn').onclick = retry;

// ================= 商店 =================
const shopScreen = document.getElementById('shopscreen');
function enterShop(){
  hideAll();
  state = 'menu';
  renderShop();
  shopScreen.style.display = 'flex';
}
function renderShop(){
  document.getElementById('shopPoints').textContent =
    `💰 积分 ${userPoints.toLocaleString()}（云端同步 · 无需注册）`;
  const list = document.getElementById('shopList');
  list.innerHTML = '';
  for (const id of BULLET_ORDER){
    const info = BULLETS[id];
    const owned = unlockedBullets.indexOf(id) >= 0;
    const eq = equippedBullet === id;
    const div = document.createElement('div');
    div.className = 'bcard' + (eq ? ' equipped' : '');
    div.innerHTML = `<div class="btop"><span class="bicon" style="color:${info.color}">${info.icon}</span>`
      + `<span class="bname">${info.name}</span></div>`
      + `<div class="bdesc">${info.desc}</div>`;
    const btn = document.createElement('button');
    if (eq){
      btn.textContent = '✓ 已装备'; btn.className = 'eq'; btn.disabled = true;
    } else if (owned){
      btn.textContent = '装备';
      btn.onclick = ()=>{ equippedBullet = id; saveProgress(); renderShop(); };
    } else {
      btn.textContent = `解锁 · ${info.cost} 积分`;
      btn.disabled = userPoints < info.cost;
      btn.onclick = ()=>{
        if (userPoints < info.cost) return;
        userPoints -= info.cost;
        unlockedBullets.push(id);
        equippedBullet = id;
        progressDirty = false;
        saveProgress();
        renderShop();
      };
    }
    div.appendChild(btn);
    list.appendChild(div);
  }
}
document.getElementById('shopBtn').onclick = enterShop;
document.getElementById('shopBackBtn').onclick = goHome;
document.getElementById('shopAccountBtn').onclick = ()=> enterLogin();

// ================= 排行榜 =================
const lbScreen = document.getElementById('lbscreen');
let lastLbBoard = 'endless_points';

function fmtDur(sec){
  const v = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(v/60)}:${String(v%60).padStart(2,'0')}`;
}
function enterLeaderboard(board){
  hideAll();
  state = 'menu';
  if (board && LB_BOARDS[board]) lbBoard = board;
  ensurePlayerId();
  lbScreen.style.display = 'flex';
  renderLBTabs();
  loadLB();
}
function renderLBTabs(){
  const box = document.getElementById('lbTabs');
  box.innerHTML = '';
  for (const key of Object.keys(LB_BOARDS)){
    const btn = document.createElement('button');
    btn.className = 'lbtab' + (key === lbBoard ? ' on' : '');
    btn.textContent = LB_BOARDS[key].title;
    btn.onclick = ()=>{ lbBoard = key; renderLBTabs(); loadLB(); };
    box.appendChild(btn);
  }
  document.getElementById('lbMyId').innerHTML = `我的ID <b>${playerId}</b> · 排行榜只显示这个随机 ID`;
}
async function loadLB(){
  const key = lbBoard;
  document.getElementById('lbList').innerHTML = '<div class="lbempty">加载中…</div>';
  let rows = [];
  try { rows = await lbFetch(key); lbCache[key] = rows; } catch(_){ rows = []; }
  if (key !== lbBoard) return;         // 加载期间切了榜
  renderLB(rows, key);
}
function renderLB(rows, key){
  const board = LB_BOARDS[key];
  const list = document.getElementById('lbList');
  const hint = document.getElementById('lbHint');
  if (!rows || !rows.length){
    list.innerHTML = `<div class="lbempty">${board.winOnly ? '还没有人击杀成功，去抢首个纪录' : '还没有人上榜，快去打一局'}</div>`;
    hint.textContent = lbStatus[key] === 'local' ? '本机榜（云端暂时不可用，成绩已存本机）' : '';
    return;
  }
  list.innerHTML = rows.map((r, i)=>{
    const mine = r.device_key ? r.device_key === deviceKey : r.player_id === playerId;
    const sub = board.metric === 'points'
      ? `击杀 ${r.kills|0} · 时长 ${fmtDur(r.duration)}`
      : `积分 ${r.points|0} · 击杀 ${r.kills|0}`;
    const val = board.metric === 'points' ? `${r.points|0} 分` : fmtDur(r.duration);
    return `<div class="lbrow${mine?' me':''}">`
      + `<div class="lbrank${i<3?' top'+(i+1):''}">${i+1}</div>`
      + `<div class="lbname">${r.player_id}${mine?'<span class="lbme">我</span>':''}`
      + `<div class="lbsub">${sub}</div></div>`
      + `<div class="lbval">${val}</div></div>`;
  }).join('');
  hint.textContent = lbStatus[key] === 'local'
    ? '本机榜（云端暂时不可用，成绩已存本机）'
    : (board.winOnly ? '云端榜 · 只统计击杀成功，用时越短越靠前' : '云端榜 · 每人只显示最佳成绩');
}
document.getElementById('lbBtn').onclick = ()=> enterLeaderboard(lbBoard);
document.getElementById('lbBackBtn').onclick = goHome;
document.getElementById('endLbBtn').onclick = ()=> enterLeaderboard(lastLbBoard);

// ================= 账号（云数据库） =================
// publicConfig 来自云服务激活结果；endpoint/publishableKey 必须在初始化时传入
const CLOUD_CFG = {
  endpoint: 'https://wbapp-i81c7cxlflh4r0jd9jrdb2.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_i81C7CxlFLh4R0JD9jrdB2_cwahcLkfKI7U2f5j6drkdc5z2wxLbPtd',
};
let cloudClient = null;

function getCloud(){
  if (cloudClient) return cloudClient;
  if (typeof WorkBuddyCloud === 'undefined') return null;
  cloudClient = WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: CLOUD_CFG.endpoint,
    oauthRelayBaseUrl: CLOUD_CFG.oauthRelayBaseUrl,
    publishableKey: CLOUD_CFG.publishableKey,
  });
  return cloudClient;
}

const loginScreen = document.getElementById('loginscreen');

// ---------- 云端进度同步（设备密钥 → player_progress 表） ----------
let saveMsgTxt = '', saveMsgOK = true;
function cloudCode(k){ return String(k || '').replace(/(.{4})(?=.)/g, '$1-'); }
function normCode(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function refreshSaveUI(){
  const st = document.getElementById('saveState');
  if (!st) return;
  const mode = Store.mode();
  const modeTxt = mode === 'local' ? '浏览器本机存储'
    : mode === 'session' ? '会话存储（关标签页后靠恢复码）'
    : mode === 'cookie' ? 'Cookie 备用通道（本机存储被禁用）'
    : '仅内存（请立刻抄下恢复码）';
  const syncTxt = cloudSyncState === 'ok' ? '<b style="color:#7ee787">☁ 云端已同步</b>'
    : cloudSyncState === 'fail' ? '<b style="color:#ff9a9a">☁ 同步失败，稍后自动重试</b>'
    : cloudSyncState === 'off' ? '<b style="color:#ffd76a">☁ 云端未连接</b>'
    : '<b style="color:#9aa4b2">☁ 同步中…</b>';
  st.innerHTML = `💾 ${modeTxt}<br>${syncTxt} · 积分 <b style="color:#ffd76a">${userPoints.toLocaleString()}</b>`;
  const codeEl = document.getElementById('recoverCode');
  if (codeEl) codeEl.textContent = cloudCode(deviceKey);
  const msg = document.getElementById('saveMsg');
  if (msg){
    msg.textContent = saveMsgTxt || '恢复码相当于账号：换设备、清缓存、换浏览器都能靠它把积分拿回来';
    msg.style.color = saveMsgTxt ? (saveMsgOK ? '#7ee787' : '#ff9a9a') : '#8fa3bd';
  }
}
function setSaveMsg(t, ok){ saveMsgTxt = t; saveMsgOK = !!ok; refreshSaveUI(); }

function paintPointsUI(){                    // 主页余额 + 打开着的存档面板
  const el = document.getElementById('homePoints');
  if (el) el.textContent = userPoints.toLocaleString();
  try { if (loginScreen.style.display === 'flex') refreshSaveUI(); } catch(_){}
}

function waitCloud(ms){
  return new Promise(resolve=>{
    const t0 = Date.now();
    (function poll(){
      if (getCloud()) return resolve(true);
      if (Date.now() - t0 > (ms || 12000)) return resolve(false);
      setTimeout(poll, 250);
    })();
  });
}

function applyCloudProgress(row){
  userPoints = Math.max(0, row.points|0);
  const arr = String(row.unlocked || 'normal').split(',').map(s=>s.trim()).filter(id=>BULLETS[id]);
  if (arr.indexOf('normal') < 0) arr.unshift('normal');
  unlockedBullets = arr;
  equippedBullet = arr.indexOf(row.equipped) >= 0 ? row.equipped : 'normal';
  profileRev = Math.max(profileRev, row.rev|0);
  if (/^[A-Za-z]{2}$/.test(row.player_id || '')) playerId = row.player_id;
  Store.set(PID_KEY, playerId);
  saveProgressLocal();
  paintMyId();
  refreshSaveUI();
}

async function cloudPullProgress(force){
  const c = getCloud();
  if (!c || !deviceKey) return null;
  try {
    const { data, error } = await c.database.from('player_progress')
      .select('device_key,player_id,points,unlocked,equipped,rev')
      .eq('device_key', deviceKey).limit(1);
    if (error) throw error;
    const row = data && data[0];
    cloudSyncState = 'ok';
    if (!row) return null;
    if (force || (row.rev|0) > profileRev){ applyCloudProgress(row); return row; }
    return row;
  } catch(e){
    cloudSyncState = 'fail';
    console.warn('[progress] 云端读取失败（本机存档不受影响）', e && e.message);
    return null;
  }
}

async function cloudPushProgress(silent){
  const c = getCloud();
  if (!c || !deviceKey || cloudBusy) return false;
  cloudBusy = true;
  try {
    const { error } = await c.database.from('player_progress').upsert({
      device_key: deviceKey,
      player_id: playerId,
      points: Math.max(0, Math.round(userPoints)),
      unlocked: unlockedBullets.join(','),
      equipped: equippedBullet,
      rev: profileRev,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'device_key' });
    if (error) throw error;
    cloudDirty = false; cloudSyncState = 'ok'; cloudLastPush = Date.now();
    refreshSaveUI();
    return true;
  } catch(e){
    cloudSyncState = 'fail';
    if (!silent) console.warn('[progress] 云端保存失败', e && e.message);
    refreshSaveUI();
    return false;
  } finally { cloudBusy = false; }
}

function flushProgress(){                    // 切后台 / 关页面 / 刷新：立刻落盘
  try { saveProgressLocal(); } catch(_){}
  if (cloudDirty) cloudPushProgress(true);
}

async function doRecover(){
  const input = document.getElementById('recoverInput');
  const code = normCode(input ? input.value : '');
  if (!/^[a-z0-9]{8,32}$/.test(code)){
    setSaveMsg('恢复码格式不对：应该是 12 位字母数字（可带 - 分隔）', false);
    return false;
  }
  setSaveMsg('正在云端查询…', true);
  const ok = await waitCloud(9000);
  if (!ok){ setSaveMsg('云端暂时连不上，稍后再试（当前进度没受影响）', false); return false; }
  const oldKey = deviceKey, oldPid = playerId, oldRev = profileRev;
  deviceKey = code; profileRev = 0;
  const row = await cloudPullProgress(true);
  if (!row){
    deviceKey = oldKey; playerId = oldPid; profileRev = oldRev;
    writeUrlIdentity(); refreshSaveUI();
    setSaveMsg('云端没有这个恢复码的记录，检查一下是否抄错', false);
    return false;
  }
  Store.set(KEY_KEY, deviceKey);
  writeUrlIdentity();
  refreshBossWallet();
  if (shopScreen.style.display === 'flex') renderShop();
  setSaveMsg(`✅ 找回成功：积分 ${userPoints.toLocaleString()} · 已解锁 ${unlockedBullets.length - 1} 种子弹`, true);
  return true;
}

function copyRecoverCode(){
  const txt = cloudCode(deviceKey);
  const done = ()=> setSaveMsg('已复制恢复码：' + txt, true);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(done, ()=> setSaveMsg('复制失败，请手动抄下：' + txt, false));
      return;
    }
  } catch(_){}
  try {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch(_){ setSaveMsg('复制失败，请手动抄下：' + txt, false); }
}

function enterProfile(){
  hideAll();
  state = 'menu';
  ensureIdentity();
  refreshSaveUI();
  loginScreen.style.display = 'flex';
}

// 启动：先读本机进度 → 还原身份 → 用云端校准（云端更新则覆盖本机）
loadProgress();
ensureIdentity();
document.getElementById('accountBtn').onclick = ()=> enterProfile();
document.getElementById('shopAccountBtn').onclick = ()=> enterProfile();
document.getElementById('loginBackBtn').onclick = goHome;
document.getElementById('profileLbBtn').onclick = ()=> enterLeaderboard(lbBoard);
document.getElementById('copyCodeBtn').onclick = copyRecoverCode;
document.getElementById('recoverBtn').onclick = doRecover;
document.getElementById('syncNowBtn').onclick = async ()=>{
  setSaveMsg('正在同步…', true);
  const ok = await waitCloud(6000);
  if (!ok) return setSaveMsg('云端未连接，稍后再试（本机进度正常）', false);
  const row = await cloudPullProgress(false);
  if (!row || profileRev > (row.rev|0)) await cloudPushProgress(false);
  refreshSaveUI();
  setSaveMsg(row ? '已同步：云端与本机自动取较新的一份' : '云端暂无记录，已上传本机进度', true);
};
const recInput = document.getElementById('recoverInput');
if (recInput) recInput.addEventListener('keydown', e=>{ if (e.key === 'Enter') doRecover(); });

refreshSaveUI();
paintPointsUI();
goHome();                                    // 启动时只显示主菜单（兜底，防止面板叠加）
addEventListener('pagehide', flushProgress);
addEventListener('beforeunload', flushProgress);
document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState === 'hidden') flushProgress(); });

(async function bootCloud(){
  const ok = await waitCloud(10000);
  if (!ok){ cloudSyncState = 'off'; refreshSaveUI(); return; }
  const row = await cloudPullProgress(false);
  if (!row || profileRev > (row.rev|0)) cloudPushProgress(true);
  refreshSaveUI();
})();

