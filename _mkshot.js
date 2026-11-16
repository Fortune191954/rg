// 生成截图用的临时页面：加载后自动打开「我的ID」存档面板
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const drive = `
setTimeout(()=>{ try { enterProfile(); } catch(e){ console.warn('drive fail', e); } }, 120);
`;
const out = html.replace(/<\/script>\s*<\/body>/, drive + '</script>\n</body>');
fs.writeFileSync(__dirname + '/_shot.html', out);
console.log('ok', out.length);
