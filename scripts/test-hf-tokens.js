const https = require('https');

const token = process.env.HF_TOKEN;
if (!token) {
  console.error('HF_TOKEN is required.');
  process.exit(1);
}

function testToken(tokenToTest) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'huggingface.co',
      port: 443,
      path: '/api/whoami-v2',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokenToTest}`,
        'User-Agent': 'ZenitsuBot'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const data = JSON.parse(body);
            console.log(`Token is valid. Username: ${data.name}`);
            resolve({ valid: true, username: data.name });
          } catch (e) {
            resolve({ valid: false });
          }
        } else {
          resolve({ valid: false });
        }
      });
    });

    req.on('error', () => resolve({ valid: false }));
    req.end();
  });
}

testToken(token).then(result => {
  if (!result.valid) {
    console.error('Token is invalid.');
    process.exit(1);
  }
});
