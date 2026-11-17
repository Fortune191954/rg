// 生成截图用的临时页面：加载后按 DRV 打开指定界面
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const setup = `
  hideAll(); newGame('boss','eye'); state='playing'; bossWarn=0;
  spawnSelectedBoss();
  player.x = 0; player.y = 0; player.hp = player.maxHp;
  const b = enemies.find(e=>e.type==='eyeboss');
  b.x = 210; b.y = -30;
  for (let i=0;i<5;i++) update(0.05);
`;
const drivers = {
  profile: `enterProfile();`,
  status: `hideAll(); newGame('classic'); state='playing'; enemies.length=0; stats.burn=1234; updateStatusBar();`,
  lb: `enterLeaderboard('endless_points');`,
  lbblade: `enterLeaderboard('boss_time_eye');`,
  bosspick: `enterBossPick(); refreshBossWallet();`,
  pause: `hideAll(); newGame('endless'); state='playing'; gameTime=125; setPaused(true);`,
  art: `userPoints = 16500; ownedArtifacts = ['mask','steel','gourd']; equippedArtifact = 'gourd'; enterArtifacts();`,
  sword: `hideAll(); equippedArtifact='gourd'; newGame('endless'); state='playing';
    player.swords = 5; player.swordAngle = 0.4; player.invul = 999;
    for (let i=0;i<4;i++) update(0.05); state='paused';`,
  boom: `hideAll(); equippedArtifact='boom'; newGame('endless'); state='playing';
    player.invul = 999; for (let i=0;i<3;i++) update(0.05); state='paused';`,
  quitend: `hideAll(); newGame('endless'); state='playing'; gameTime=185;
    for (let i=0;i<3;i++) update(0.02);
    quitRun();`,
  eye1: `${setup}
    b.armAtkT = 0.001; for (let i=0;i<3;i++) update(0.05);
    state='paused';`,
  eye2: `${setup}
    b.hp = b.maxHp*0.5; for (let i=0;i<12;i++) update(0.04);
    b.openT = 1; b.laser = { start:-1.1, dir:1, ang:0.1, t:0.9, warm:0.5, dur:1.15 };
    for (let i=0;i<3;i++) update(0.03);
    state='paused';`,
  eye3: `${setup}
    eyeEnterPhase3(b); b.openT = 1;
    for (let i=0;i<6;i++) update(0.03);
    b.laser = { start:1.2, dir:-1, ang:1.2, t:0.95, warm:0.5, dur:1.15 };
    update(0.02);
    state='paused';`,
  blade: `
    hideAll(); newGame('boss','blade'); state='playing'; bossWarn=0;
    spawnSelectedBoss();
    player.x = 0; player.y = 0; player.hp = player.maxHp;
    const bb = enemies.find(e=>e.type==='boss');
    bb.x = 120; bb.y = -60;
    for (let i=0;i<5;i++) update(0.05);
    bb.raged = true; bb.hp = bb.maxHp*0.45;
    bb.charging = 0.55; bb.chargeAng = Math.atan2(player.y-bb.y, player.x-bb.x);
    bb.slashT = 5;
    for (let i=0;i<2;i++) update(1/60);
    state='paused';`,
};
const drv = drivers[process.env.DRV || 'profile'] || drivers.profile;
const drive = `
setTimeout(()=>{ try { ${drv} } catch(e){ console.warn('drive fail', e); } }, 150);
`;
const out = html.replace(/<\/script>\s*<\/body>/, drive + '</script>\n</body>');
fs.writeFileSync(__dirname + '/_shot.html', out);
console.log('ok', out.length, process.env.DRV || 'profile');
