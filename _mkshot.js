// 生成截图用的临时页面：加载后按 DRV 打开指定界面
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const drivers = {
  profile: `enterProfile();`,
  status: `hideAll(); newGame('classic'); state='playing'; enemies.length=0; stats.burn=1234; updateStatusBar();`,
  lb: `enterLeaderboard('endless_points');`,
  lbblade: `enterLeaderboard('boss_time_blade');`,
};
const drv = drivers[process.env.DRV || 'profile'] || drivers.profile;
const drive = `
setTimeout(()=>{ try { ${drv} } catch(e){ console.warn('drive fail', e); } }, 150);
`;
const out = html.replace(/<\/script>\s*<\/body>/, drive + '</script>\n</body>');
fs.writeFileSync(__dirname + '/_shot.html', out);
console.log('ok', out.length, process.env.DRV || 'profile');
