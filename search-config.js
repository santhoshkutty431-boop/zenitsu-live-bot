const fs = require('fs');

const content = fs.readFileSync('index.js', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('config.')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
