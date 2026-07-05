const { queryAI } = require('../modules/ai-handler');
const RuntimeClass = require('../src/core/Runtime');
const DatabaseManager = require('../src/managers/DatabaseManager');

const runtime = new RuntimeClass();
global.__zenitsuRuntime = runtime;
runtime.registerService('DatabaseManager', new DatabaseManager(runtime));

async function run() {
  console.log('Bootstrapping runtime...');
  await runtime.bootstrap();
  
  console.log('Calling queryAI...');
  try {
    const result = await queryAI('test-user-123', 'Hi, respond in one word.', 'gemini', 'english', {
      applicationId: 'test',
      guildId: '1444533392518680719',
      channelId: 'test',
      threadId: 'none',
      shardId: '0'
    });
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('queryAI crashed:', err);
  }
  process.exit(0);
}

run();
