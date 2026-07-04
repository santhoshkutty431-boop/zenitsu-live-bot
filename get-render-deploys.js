const https = require('https');

const token = process.env.RENDER_API_TOKEN;
const serviceId = process.env.RENDER_SERVICE_ID || 'srv-d920leegvqtc73935vgg';
if (!token) {
  console.error('RENDER_API_TOKEN is required.');
  process.exit(1);
}

const options = {
  hostname: 'api.render.com',
  port: 443,
  path: `/v1/services/${serviceId}/deploys?limit=5`,
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
          const d = item.deploy;
          console.log(`Commit Msg: "${d.commit?.message}"`);
          console.log(`Status    : ${d.status}`);
          console.log(`Started   : ${d.createdAt}`);
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
