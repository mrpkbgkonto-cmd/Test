import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import { ConfigError, toBits, toNames } from '../lib/permissions.js';
import { describe, execute, exportConfig, plan } from '../lib/server.js';

const G = '100';
const bits = (...names) => names.reduce((b, n) => b | P[n], 0n).toString();

// En nyskapad Discord-server: två standardkategorier och en botroll.
const fresh = () => ({
  guildId: G,
  roles: [
    { id: G, name: '@everyone', position: 0, permissions: bits('ViewChannel', 'SendMessages'), color: 0 },
    { id: '900', name: 'MinBot', position: 1, permissions: bits('Administrator'), managed: true, color: 0 },
  ],
  channels: [
    { id: '1', name: 'Textkanaler', type: 4, position: 0, permission_overwrites: [] },
    { id: '2', name: 'Röstkanaler', type: 4, position: 1, permission_overwrites: [] },
    { id: '3', name: 'allmänt', type: 0, position: 0, parent_id: '1', permission_overwrites: [] },
    { id: '4', name: 'Allmänt', type: 2, position: 0, parent_id: '2', permission_overwrites: [] },
  ],
});

const config = {
  roles: [
    { name: 'Moderator', color: '#e67e22', hoist: true, permissions: ['ManageMessages', 'KickMembers'] },
    { name: 'Medlem', permissions: ['ViewChannel', 'SendMessages'] },
  ],
  channels: [
    {
      name: 'Info',
      type: 'category',
      overwrites: { '@everyone': { deny: ['SendMessages'] }, Moderator: { allow: ['SendMessages'] } },
      channels: [
        { name: 'regler', topic: 'Läs innan du skriver' },
        { name: 'allmänt', overwrites: {} },
      ],
    },
  ],
};

test('behörighetsnamn översätts åt båda hållen och okända namn stoppas', () => {
  assert.equal(toBits(['ViewChannel', 'SendMessages']), P.ViewChannel | P.SendMessages);
  assert.deepEqual(toNames(P.ManageGuildExpressions), ['ManageGuildExpressions']);
  assert.throws(() => toBits(['FlygaRunt'], 'test'), ConfigError);
});

test('plan beskriver nya roller, kategori och flytt av befintlig kanal', () => {
  const ops = plan(fresh(), config);
  assert.deepEqual(ops.map(describe), [
    '+ roll "Medlem"',
    '+ roll "Moderator"',
    '~ rollordning (Moderator > Medlem)',
    '+ kategori "Info"',
    '+ textkanal "regler" i "Info"',
    '~ textkanal "allmänt" i "Info": kategori',
  ]);
  // Ny kanal i kategori ärver kategorins behörigheter
  assert.deepEqual(ops[4].overwrites.map((o) => o.target), ['@everyone', 'Moderator']);
  assert.equal(ops[1].body.colors.primary_color, 0xe67e22);
});

test('prune tar bara bort det som saknas, aldrig botroller', () => {
  const ops = plan(fresh(), config, { prune: true });
  assert.deepEqual(ops.filter((o) => o.op.startsWith('delete')).map(describe), [
    '- röstkanal "Allmänt"',
    '- kategori "Textkanaler"',
    '- kategori "Röstkanaler"',
  ]);
});

test('export följt av plan ger inga ändringar', () => {
  const server = fresh();
  server.roles.push({ id: '10', name: 'Moderator', position: 2, permissions: bits('KickMembers'), colors: { primary_color: 0xe67e22 }, hoist: true });
  server.channels.push(
    { id: '5', name: 'Info', type: 4, position: 2, permission_overwrites: [{ id: G, type: 0, allow: '0', deny: bits('SendMessages') }] },
    { id: '6', name: 'regler', type: 0, position: 1, parent_id: '5', topic: 'Hej', rate_limit_per_user: 10, permission_overwrites: [{ id: G, type: 0, allow: '0', deny: bits('SendMessages') }] },
    { id: '7', name: 'mods', type: 0, position: 2, parent_id: '5', permission_overwrites: [{ id: '10', type: 0, allow: bits('ViewChannel'), deny: '0' }, { id: '555', type: 1, allow: bits('ViewChannel'), deny: '0' }] },
  );
  const exported = exportConfig(server);
  assert.deepEqual(exported.channels.at(-1).channels[0], { name: 'regler', type: 'text', topic: 'Hej', slowmode: 10 });
  assert.deepEqual(exported.channels.at(-1).channels[1].overwrites, {
    Moderator: { allow: ['ViewChannel'] },
    'user:555': { allow: ['ViewChannel'] },
  });
  assert.deepEqual(plan(server, exported, { prune: true }), []);
});

test('rollordningen följer filen, övriga roller ligger kvar', () => {
  const server = fresh();
  server.roles[1].position = 3;
  server.roles.push(
    { id: '20', name: 'Rekryt', position: 2, permissions: '0' },
    { id: '10', name: 'Koloss', position: 1, permissions: '0' },
    { id: '30', name: 'Bot2', position: 1, permissions: '0', managed: true },
    { id: '40', name: 'Moderator', position: 1, permissions: '0' },
  );
  const ops = plan(server, { roles: [{ name: 'Koloss' }, { name: 'Moderator' }, { name: 'Rekryt' }] });
  assert.deepEqual(ops.map(describe), ['~ rollordning (Koloss > Moderator > Rekryt)']);
  assert.deepEqual(ops[0].order.map((r) => r.name), ['MinBot', 'Koloss', 'Moderator', 'Bot2', 'Rekryt']);

  for (const [i, r] of ops[0].order.entries()) server.roles.find((x) => x.id === r.id).position = 5 - i;
  assert.deepEqual(plan(server, { roles: [{ name: 'Koloss' }, { name: 'Moderator' }, { name: 'Rekryt' }] }), []);
});

test('oldName byter namn och behåller id', async () => {
  const server = fresh();
  server.roles.push({ id: '20', name: 'Rekryt', position: 1, permissions: '0' });
  const ops = plan(server, {
    roles: [{ name: 'Recruit', oldName: 'Rekryt' }],
    channels: [{
      name: 'Text Channels',
      oldName: 'Textkanaler',
      type: 'category',
      channels: [{ name: 'general', oldName: 'allmänt', overwrites: { Recruit: { allow: ['ViewChannel'] } } }],
    }],
  });
  assert.deepEqual(ops.map(describe), [
    '~ roll "Recruit": namn',
    '~ kategori "Text Channels": namn',
    '~ textkanal "general" i "Text Channels": namn, kanalbehörigheter',
  ]);

  const calls = [];
  const client = { patch: async (path, body) => { calls.push([path, body]); return {}; } };
  await execute(client, server, ops);
  assert.deepEqual(calls, [
    [`/guilds/${G}/roles/20`, { name: 'Recruit' }],
    ['/channels/1', { name: 'Text Channels' }],
    ['/channels/3', { name: 'general', permission_overwrites: [{ id: '20', type: 0, allow: bits('ViewChannel'), deny: '0' }] }],
  ]);
  assert.throws(() => plan(server, { roles: [{ name: 'X', oldName: '' }] }), /oldName/);
});

test('fel i konfigurationen ger tydliga meddelanden', () => {
  assert.throws(() => plan(fresh(), { channels: [{ name: 'x', type: 'karta' }] }), /Okänd kanaltyp/);
  assert.throws(() => plan(fresh(), { channels: [{ name: 'x', topik: 'stavfel' }] }), /Okänt fält "topik"/);
  assert.throws(() => plan(fresh(), { channels: [{ name: 'x', overwrites: { Spöke: { allow: ['ViewChannel'] } } }] }), /Spöke/);
  assert.throws(() => plan(fresh(), { roles: [{ name: 'A' }, { name: 'a' }] }), /två gånger/);
});

test('execute använder id:n från nyss skapade roller och kategorier', async () => {
  const calls = [];
  let next = 500;
  const client = {
    post: async (path, body) => { calls.push(['POST', path, body]); return { id: String(next++) }; },
    patch: async (path, body) => { calls.push(['PATCH', path, body]); return {}; },
    delete: async (path) => { calls.push(['DELETE', path]); return null; },
  };
  const server = fresh();
  await execute(client, server, plan(server, config));

  const [medlem, moderator, order, category, regler, move] = calls;
  assert.deepEqual(medlem.slice(0, 2), ['POST', `/guilds/${G}/roles`]);
  assert.equal(moderator[2].name, 'Moderator');
  assert.deepEqual(order, ['PATCH', `/guilds/${G}/roles`, [
    { id: '900', position: 3 },
    { id: '501', position: 2 },
    { id: '500', position: 1 },
  ]]);
  assert.deepEqual(category[2].permission_overwrites, [
    { id: G, type: 0, allow: '0', deny: bits('SendMessages') },
    { id: '501', type: 0, allow: bits('SendMessages'), deny: '0' },
  ]);
  assert.equal(regler[2].parent_id, '502');
  assert.equal(regler[2].topic, 'Läs innan du skriver');
  assert.deepEqual(move, ['PATCH', '/channels/3', { parent_id: '502' }]);
});

test('exempelfilen är giltig och bygger en hel server från en ny', async () => {
  const { default: example } = await import('../exempel.json', { with: { type: 'json' } });
  const ops = plan(fresh(), example, { prune: true });
  assert.equal(ops.filter((o) => o.op === 'createRole').length, 3);
  assert.ok(ops.some((o) => describe(o) === '~ textkanal "allmänt" i "Community": ämne, kategori'));
  assert.deepEqual(ops.filter((o) => o.op.startsWith('delete')).map(describe), [
    '- röstkanal "Allmänt"',
    '- kategori "Textkanaler"',
    '- kategori "Röstkanaler"',
  ]);
});
