const https = require('https');

const token = process.env.HF_TOKEN;
if (!token) {
  console.error('HF_TOKEN is required.');
  process.exit(1);
}

const options = {
  hostname: 'huggingface.co',
  port: 443,
  path: '/api/spaces/kutty-35/KuttyAI/keys', // or files list
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'ZenitsuBot'
  }
};

// Actually let's list files in the space kutty-35/KuttyAI
options.path = '/api/spaces/kutty-35/key-server-24-7/tree/main';

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      console.log('Files in kutty-35/KuttyAI:');
      data.forEach(f => {
        console.log(`- Path: ${f.path}, Type: ${f.type}`);
      });
    } catch (e) {
      console.error('Failed to parse response:', e.message);
    }
  });
});

req.on('error', (err) => console.error(err));
req.end();
