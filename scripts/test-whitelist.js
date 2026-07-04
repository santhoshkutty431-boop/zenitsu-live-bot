/**
 * Automated tests for whitelist persistence and concurrency safety.
 * Verifies User, Role, and Server whitelists.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dbPath = path.join(__dirname, 'database.json');
const backupPath = path.join(__dirname, 'database.json.bak');

// Mock db structure
let db = {
  roleWhitelist: [],
  serverWhitelist: [],
  commandRoleWhitelist: { admin: [], staff: [], member: [] }
};

let dbInMemoryTimestamp = Date.now();
let dbFileLastModified = 0;
let writeQueue = Promise.resolve();

// Paste the DB Manager logic here for standalone test validation
function mergeDatabase(diskDb) {
  const mergedRoleWhitelist = Array.from(new Set([
    ...(db.roleWhitelist || []),
    ...(diskDb.roleWhitelist || [])
  ]));
  
  const mergedServerWhitelist = Array.from(new Set([
    ...(db.serverWhitelist || []),
    ...(diskDb.serverWhitelist || [])
  ]));

  const mergedCommandRoleWhitelist = {
    admin: Array.from(new Set([
      ...(db.commandRoleWhitelist?.admin || []),
      ...(diskDb.commandRoleWhitelist?.admin || [])
    ])),
    staff: Array.from(new Set([
      ...(db.commandRoleWhitelist?.staff || []),
      ...(diskDb.commandRoleWhitelist?.staff || [])
    ])),
    member: Array.from(new Set([
      ...(db.commandRoleWhitelist?.member || []),
      ...(diskDb.commandRoleWhitelist?.member || [])
    ]))
  };

  db = {
    ...db,
    ...diskDb,
    roleWhitelist: mergedRoleWhitelist,
    serverWhitelist: mergedServerWhitelist,
    commandRoleWhitelist: mergedCommandRoleWhitelist
  };

  dbInMemoryTimestamp = Date.now();
}

function loadDb() {
  if (fs.existsSync(dbPath)) {
    try {
      const stats = fs.statSync(dbPath);
      const mtime = stats.mtimeMs;
      const fileContent = fs.readFileSync(dbPath, 'utf8');
      const diskDb = JSON.parse(fileContent);

      if (dbFileLastModified === 0) {
        db = { ...db, ...diskDb };
        dbFileLastModified = mtime;
        dbInMemoryTimestamp = Date.now();
      } else if (mtime > dbFileLastModified) {
        mergeDatabase(diskDb);
        dbFileLastModified = mtime;
      }
    } catch (e) {
      console.error('DB load error:', e.message);
    }
  }
}

function saveDb() {
  return writeQueue = writeQueue.then(() => new Promise((resolve) => {
    try {
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        if (stats.mtimeMs > dbFileLastModified) {
          const fileContent = fs.readFileSync(dbPath, 'utf8');
          mergeDatabase(JSON.parse(fileContent));
          dbFileLastModified = stats.mtimeMs;
        }
      }
    } catch (err) {}

    const tempPath = `${dbPath}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), 'utf8');
      fs.renameSync(tempPath, dbPath);
      const stats = fs.statSync(dbPath);
      dbFileLastModified = stats.mtimeMs;
      dbInMemoryTimestamp = Date.now();
      resolve();
    } catch (e) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      resolve();
    }
  }));
}

// Helper to sleep
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runTests() {
  console.log('--- STARTING PERSISTENCE TESTS ---');

  // 1. Backup current db
  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, backupPath);
  }

  try {
    // Reset to initial clean state
    db = {
      roleWhitelist: [],
      serverWhitelist: [],
      commandRoleWhitelist: { admin: [], staff: [], member: [] }
    };
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    // Test 1: User Whitelist Write and Persist
    console.log('Test 1: Writing to User Whitelist...');
    db.roleWhitelist.push('user_123');
    await saveDb();

    // Reset memory cache
    db = { roleWhitelist: [], serverWhitelist: [], commandRoleWhitelist: { admin: [], staff: [], member: [] } };
    dbFileLastModified = 0;

    // Load from disk
    loadDb();
    assert.deepStrictEqual(db.roleWhitelist, ['user_123'], 'User Whitelist failed to persist!');
    console.log('✅ Test 1 Passed: User Whitelist persisted correctly.');

    // Test 2: Simultaneous updates / merge resolution (Multi-worker simulation)
    console.log('Test 2: Simulating simultaneous disk update...');
    // Write directly to disk bypassing memory (simulates another worker)
    const externalDb = {
      roleWhitelist: ['user_123'],
      serverWhitelist: ['server_456'],
      commandRoleWhitelist: { admin: ['role_admin'], staff: [], member: [] }
    };
    fs.writeFileSync(dbPath, JSON.stringify(externalDb, null, 2), 'utf8');

    // Sleep briefly to change modification time
    await sleep(100);

    // Modify memory
    db.roleWhitelist.push('user_789'); // memory has 'user_123' and 'user_789'
    db.commandRoleWhitelist.staff.push('role_staff');

    // Save Memory (should auto-detect disk changes and merge)
    await saveDb();

    // Verify merge result
    assert.ok(db.roleWhitelist.includes('user_123'));
    assert.ok(db.roleWhitelist.includes('user_789'));
    assert.ok(db.serverWhitelist.includes('server_456'));
    assert.ok(db.commandRoleWhitelist.admin.includes('role_admin'));
    assert.ok(db.commandRoleWhitelist.staff.includes('role_staff'));
    console.log('✅ Test 2 Passed: Auto-merge / conflict resolution resolved correctly without overwriting newer data.');

    // Test 3: Persistence after 5 seconds
    console.log('Test 3: Checking persistence after 5 seconds delay...');
    await sleep(5000);
    db = { roleWhitelist: [], serverWhitelist: [], commandRoleWhitelist: { admin: [], staff: [], member: [] } };
    dbFileLastModified = 0;
    loadDb();

    assert.ok(db.roleWhitelist.includes('user_123') && db.roleWhitelist.includes('user_789'), 'User whitelist lost after delay!');
    assert.ok(db.serverWhitelist.includes('server_456'), 'Server whitelist lost after delay!');
    assert.ok(db.commandRoleWhitelist.admin.includes('role_admin'), 'Admin role whitelist lost after delay!');
    assert.ok(db.commandRoleWhitelist.staff.includes('role_staff'), 'Staff role whitelist lost after delay!');
    console.log('✅ Test 3 Passed: Whitelist data persisted after 5 seconds delay.');

    console.log('\n🎉 ALL WHITELIST PERSISTENCE TESTS PASSED SUCCESSFULLY! 🎉');

  } catch (error) {
    console.error('❌ TEST FAILURE:', error);
  } finally {
    // Cleanup and restore backup
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, dbPath);
      fs.unlinkSync(backupPath);
    }
  }
}

runTests();
