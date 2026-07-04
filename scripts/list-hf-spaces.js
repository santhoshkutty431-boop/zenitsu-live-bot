const https = require('https');

const token = process.env.HF_TOKEN;
if (!token) {
  console.error('HF_TOKEN is required.');
  process.exit(1);
}

const options = {
  hostname: 'huggingface.co',
  port: 443,
  path: '/api/spaces?author=kutty-35',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'ZenitsuBot'
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      console.log('Spaces owned by kutty-35:');
      data.forEach(s => {
        console.log(`- Space ID: ${s.id}, SDK: ${s.sdk}, Status: ${s.runtime?.stage || 'unknown'}`);
      });
    } catch (e) {
      console.error('Failed to parse response:', e.message);
    }
  });
});

req.on('error', (err) => console.error(err));
req.end();
