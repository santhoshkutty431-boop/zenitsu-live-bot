const https = require('https');

const token = process.env.RENDER_API_TOKEN;
if (!token) {
  console.error('RENDER_API_TOKEN is required.');
  process.exit(1);
}

const options = {
  hostname: 'api.render.com',
  port: 443,
  path: '/v1/services?limit=20',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'User-Agent': 'ZenitsuBot'
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (Array.isArray(data)) {
        data.forEach(item => {
          const s = item.service;
          console.log(`Name: ${s.name}`);
          console.log(`URL : ${s.serviceDetails?.url || s.url}`);
          console.log(`ID  : ${s.id}`);
          console.log('---');
        });
      } else {
        console.log('Response is not an array:', body);
      }
    } catch (e) {
      console.error('Failed to parse response:', e.message);
    }
  });
});

req.on('error', (err) => console.error(err));
req.end();
