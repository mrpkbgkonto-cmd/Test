import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CLI = new URL('../cli.js', import.meta.url).pathname;
const G = '100';

// Minimal låtsas-Discord med samma REST-vägar som verktyget använder.
const state = {
  roles: [{ id: G, name: '@everyone', position: 0, permissions: '3072', color: 0 }],
  channels: [{ id: '1', name: 'allmänt', type: 0, position: 0, permission_overwrites: [] }],
  messages: [],
};
let nextId = 200;
let rateLimited = false;
const seenHeaders = [];

const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : undefined;
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(data === undefined ? '' : JSON.stringify(data));
  };
  seenHeaders.push(req.headers);
  if (req.headers.authorization !== 'Bot test-token') return send(401, { message: '401: Unauthorized', code: 0 });

  const route = `${req.method} ${req.url}`;
  if (route === 'GET /users/@me/guilds') return send(200, [{ id: G, name: 'Testservern' }]);
  if (route === `GET /guilds/${G}/roles`) return send(200, state.roles);
  if (route === `GET /guilds/${G}/channels`) return send(200, state.channels);
  if (route === `POST /guilds/${G}/roles`) {
    if (!rateLimited) {
      rateLimited = true;
      return send(429, { message: 'You are being rate limited.', retry_after: 0.05 });
    }
    const role = { id: String(nextId++), position: 1, color: 0, permissions: '0', ...body };
    state.roles.push(role);
    return send(200, role);
  }
  if (route === `POST /guilds/${G}/channels`) {
    const channel = { id: String(nextId++), position: state.channels.length, ...body };
    state.channels.push(channel);
    return send(201, channel);
  }
  const channelMatch = /^(PATCH|DELETE) \/channels\/(\d+)$/.exec(route);
  if (channelMatch) {
    const channel = state.channels.find((c) => c.id === channelMatch[2]);
    if (channelMatch[1] === 'DELETE') {
      state.channels = state.channels.filter((c) => c !== channel);
      return send(200, channel);
    }
    Object.assign(channel, body);
    return send(200, channel);
  }
  const message = /^POST \/channels\/(\d+)\/messages$/.exec(route);
  if (message) {
    state.messages.push({ channel: message[1], ...body });
    return send(200, { id: String(nextId++) });
  }
  send(404, { message: `Unknown route ${route}`, code: 0 });
});

let env;
let dir;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-admin-'));
  env = { ...process.env, DISCORD_TOKEN: 'test-token', DISCORD_API_URL: `http://localhost:${server.address().port}`, DISCORD_GUILD_ID: '' };
});
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const cli = (...args) => run(process.execPath, [CLI, ...args], { env });

test('plan, apply och export mot servern', async () => {
  const file = path.join(dir, 'server.json');
  fs.writeFileSync(file, JSON.stringify({
    roles: [{ name: 'Medlem', permissions: ['ViewChannel'] }],
    channels: [
      { name: 'allmänt', topic: 'Snacka på' },
      { name: 'Röst', type: 'category', channels: [{ name: 'Lounge', type: 'voice', userLimit: 5 }] },
    ],
  }));

  const planned = await cli('plan', file);
  assert.match(planned.stdout, /\+ roll "Medlem"/);
  assert.match(planned.stdout, /~ textkanal "allmänt": ämne/);
  assert.equal(state.roles.length, 1, 'plan får inte ändra något');

  const applied = await cli('apply', file);
  assert.match(applied.stdout, /Klart: 4 ändring\(ar\)/);
  assert.ok(rateLimited, 'rate limit ska ha hanterats med nytt försök');
  const lounge = state.channels.find((c) => c.name === 'Lounge');
  assert.equal(lounge.parent_id, state.channels.find((c) => c.name === 'Röst').id);
  assert.equal(lounge.user_limit, 5);

  assert.match((await cli('plan', file)).stdout, /Inga ändringar/);

  const exported = JSON.parse((await cli('export')).stdout);
  assert.deepEqual(exported.roles, [{ name: 'Medlem', permissions: ['ViewChannel'] }]);
  assert.ok(seenHeaders.every((h) => h['user-agent'].startsWith('DiscordBot (')));
});

test('send skickar utan pingar som standard', async () => {
  const { stdout } = await cli('send', '#allmänt', 'Hej', 'alla!');
  assert.match(stdout, /Skickat till #allmänt/);
  assert.deepEqual(state.messages.at(-1), { channel: '1', content: 'Hej alla!', allowed_mentions: { parse: [] } });
});

test('fel visas begripligt', async () => {
  await assert.rejects(run(process.execPath, [CLI, 'guilds'], { env: { ...env, DISCORD_TOKEN: 'fel' } }), /401: Unauthorized/);
  await assert.rejects(cli('send', 'finnsinte', 'hej'), /Hittar ingen textkanal/);
});
