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
  path: `/v1/services/${serviceId}/deploys`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'ZenitsuBot'
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      console.log('Deploy Triggered Successfully!');
      console.log('Deploy ID:', data.id);
      console.log('Status   :', data.status);
    } catch (e) {
      console.error('Failed to parse response:', e.message);
      console.log('Raw body:', body);
    }
  });
});

req.on('error', (err) => console.error(err));
// Send empty JSON body
req.write(JSON.stringify({}));
req.end();
