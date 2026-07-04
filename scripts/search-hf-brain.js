const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\Admin\\.gemini\\antigravity\\brain';

function searchFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.toLowerCase().includes('hugging') || content.includes('hf_')) {
      console.log(`Found in: ${filePath}`);
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes('hugging') || line.includes('hf_')) {
          console.log(`  Line ${idx + 1}: ${line.trim().substring(0, 200)}`);
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
        traverse(fullPath);
      } else {
        if (file.endsWith('.jsonl') || file.endsWith('.json') || file.endsWith('.md')) {
          searchFile(fullPath);
        }
      }
    });
  } catch (e) {}
}

traverse(brainDir);
console.log('Brain search complete.');
