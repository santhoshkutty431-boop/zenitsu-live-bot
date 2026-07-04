const fs = require('fs');
const path = require('path');

const targetDir = 'C:\\Users\\Admin\\.gemini\\antigravity\\brain\\cdc20745-c5fc-4352-888e-b85c67a45bb6';

function searchFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const regex = /hf_[a-zA-Z0-9]+/g;
    const matches = content.match(regex);
    if (matches) {
      console.log(`Found HF token in: ${filePath}`);
      matches.forEach(m => console.log(`  Token: ${m}`));
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
        traverse(fullPath);
      } else {
        searchFile(fullPath);
      }
    });
  } catch (e) {}
}

traverse(targetDir);
console.log('Search finished.');
