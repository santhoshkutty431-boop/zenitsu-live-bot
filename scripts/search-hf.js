const fs = require('fs');
const path = require('path');

const projectDir = 'C:\\Users\\Admin\\Pictures\\Saved Pictures\\ZenitsuLiveBot';

function searchFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.toLowerCase().includes('hugging') || content.includes('hf_')) {
      console.log(`Found in: ${filePath}`);
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes('hugging') || line.includes('hf_')) {
          console.log(`  Line ${idx + 1}: ${line.trim()}`);
        }
      });
    }
  } catch (e) {}
}

function traverse(dir) {
  try {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (file !== 'node_modules' && file !== '.git') {
          traverse(fullPath);
        }
      } else {
        searchFile(fullPath);
      }
    });
  } catch (e) {}
}

traverse(projectDir);
console.log('Search complete.');
