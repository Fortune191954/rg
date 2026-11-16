const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const blocks = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) blocks.push(m[1]);
console.log('inline script blocks:', blocks.length, 'chars:', blocks.map(b => b.length).join(','));
fs.writeFileSync(__dirname + '/_tmp_check.js', blocks.join('\n;\n'));
