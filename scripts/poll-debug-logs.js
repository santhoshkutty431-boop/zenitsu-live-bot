const https = require('https');

const url = 'https://zenitsu-live-bot.onrender.com/api/debug-logs?passcode=d920leegvqtc73935vgg';

function fetchLogs() {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`Status ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('Polling debug logs from Render...');
  for (let i = 0; i < 15; i++) {
    try {
      const logs = await fetchLogs();
      console.log('\n--- SUCCESS! LATEST LOGS FROM SERVER ---\n');
      console.log(logs);
      process.exit(0);
    } catch (err) {
      console.log(`[Attempt ${i + 1}/15] Server not updated yet: ${err.message}`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  console.log('Timeout waiting for deployment.');
  process.exit(1);
}

run();
