// 冒烟测试：手机号验证码登录 / 注册（用 mock 云 SDK 验证调用参数与状态流转）
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
const calls = { sendOtp: [], verifyOtp: [], signOut: 0 };
let failVerify = false;

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

// ---- mock 云 SDK ----
sandbox.WorkBuddyCloud = {
  createWorkBuddyCloud: () => ({
    auth: {
      sendOtp: async (arg) => { calls.sendOtp.push(arg); return { data: { verificationId: 'vid-1', isExistingUser: false } }; },
      verifyOtp: async (arg) => {
        calls.verifyOtp.push(arg);
        if (failVerify) return { error: { message: '验证码错误或已过期' } };
        return { data: { user: { id: 'u1', phone: '+86 13800138000' } } };
      },
      getSession: async () => ({ data: null }),
      signOut: async () => { calls.signOut++; },
    },
    database: {
      from: () => ({
        select: () => ({ limit: async () => ({ data: [], error: null }) }),
        update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }),
        insert: async () => ({ error: null }),
      }),
    },
  }),
};

vm.createContext(sandbox);
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
vm.runInContext(m[1], sandbox, { filename: 'rg_game.js' });

const G = vm.runInContext(`({
  sendPhoneCode, doPhoneAuth, maskPhone,
  get pendingOtp(){ return pendingOtp; },
  get cloudUser(){ return cloudUser; }, set cloudUser(v){ cloudUser = v; },
})`, sandbox);

const assert = (cond, msg) => { if (!cond){ console.error('FAIL: ' + msg); process.exit(1); } console.log('PASS: ' + msg); };
const el = (id) => sandbox.document.getElementById(id);
const msg = () => el('loginMsg').textContent || '';

(async ()=>{
  // 1. 手机号校验
  el('loginPhone').value = '12345';
  await G.sendPhoneCode();
  assert(calls.sendOtp.length === 0, '手机号不足 11 位不发短信');
  assert(msg().indexOf('11 位手机号') >= 0, `提示信息正确（${msg()}）`);

  el('loginPhone').value = '23800138000';
  await G.sendPhoneCode();
  assert(calls.sendOtp.length === 0, '非 1 开头不发短信');

  // 2. 正常发码
  el('loginPhone').value = '13800138000';
  await G.sendPhoneCode();
  assert(calls.sendOtp.length === 1, '11 位手机号触发一次发送');
  assert(calls.sendOtp[0].phone === '13800138000', '发送参数只有 phone');
  assert(!('email' in calls.sendOtp[0]), '发送时不混入 email');
  assert(!!G.pendingOtp && G.pendingOtp.phone === '13800138000', '待验证挑战已保存');
  assert(G.pendingOtp.verificationId === 'vid-1', 'verificationId 已保存');
  assert(el('sendCodeBtn').textContent.indexOf('60s') === 0, `60 秒倒计时生效（${el('sendCodeBtn').textContent}）`);

  // 3. 未填验证码
  el('loginCode').value = '';
  await G.doPhoneAuth();
  assert(calls.verifyOtp.length === 0, '未填验证码不提交');
  assert(msg().indexOf('验证码') >= 0, `提示先填验证码（${msg()}）`);

  // 4. 换了手机号但没重新发码
  el('loginCode').value = '123456';
  el('loginPhone').value = '13900139000';
  await G.doPhoneAuth();
  assert(calls.verifyOtp.length === 0, '换号后必须先重新获取验证码');
  assert(msg().indexOf('先获取') >= 0, `提示先获取（${msg()}）`);

  // 5. 正常验证
  el('loginPhone').value = '13800138000';
  await G.doPhoneAuth();
  assert(calls.verifyOtp.length === 1, '验证码提交一次');
  const v = calls.verifyOtp[0];
  assert(v.phone === '13800138000' && v.token === '123456', '提交 phone + token');
  assert(v.verificationId === 'vid-1', '提交带 verificationId');
  assert(!('password' in v), '不再提交密码（纯验证码）');
  assert(!('email' in v), '提交时不混入 email');
  assert(!!G.cloudUser && G.cloudUser.id === 'u1', '登录成功并记录用户');
  assert(G.pendingOtp === null, '用完后清空待验证状态');

  // 6. 脱敏显示
  assert(G.maskPhone('+86 13800138000') === '138****8000', '手机号脱敏为 138****8000');
  assert(el('loginState').textContent.indexOf('138****8000') >= 0, `登录态文案脱敏（${el('loginState').textContent}）`);
  assert(el('loginState').textContent.indexOf('13800138000') < 0, '登录态不出现完整手机号');

  // 7. 验证码错误
  G.cloudUser = null;
  await G.sendPhoneCode();
  failVerify = true;
  await G.doPhoneAuth();
  assert(msg().indexOf('验证失败') >= 0, `验证码错误有明确提示（${msg()}）`);
  assert(G.cloudUser === null, '验证失败不会登录');

  console.log('\n全部通过：手机号验证码登录 / 注册');
})();
