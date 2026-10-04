import { ConfigError, toBits, toNames } from './permissions.js';

export const TYPES = { text: 0, voice: 2, category: 4, announcement: 5, stage: 13, forum: 15, media: 16 };
const TYPE_NAMES = Object.fromEntries(Object.entries(TYPES).map(([name, id]) => [id, name]));
const TYPE_LABELS = { 0: 'textkanal', 2: 'röstkanal', 4: 'kategori', 5: 'nyhetskanal', 13: 'scenkanal', 15: 'forum', 16: 'mediakanal' };

// Konfigurationsnamn → Discord-API-fält för kanaler
const CHANNEL_FIELDS = { topic: 'topic', nsfw: 'nsfw', slowmode: 'rate_limit_per_user', userLimit: 'user_limit' };

const CHANGE_LABELS = {
  name: 'namn', permissions: 'behörigheter', colors: 'färg', hoist: 'visas separat', mentionable: 'nämnbar',
  topic: 'ämne', nsfw: 'nsfw', rate_limit_per_user: 'slowmode', user_limit: 'maxantal',
  parent: 'kategori', overwrites: 'kanalbehörigheter',
};

const ROLE_KEYS = new Set(['name', 'color', 'hoist', 'mentionable', 'permissions']);
const CHANNEL_KEYS = new Set(['name', 'type', 'channels', 'overwrites', ...Object.keys(CHANNEL_FIELDS)]);
const TOP_KEYS = new Set(['everyone', 'roles', 'channels']);

// Discord gör textkanalnamn gemena med bindestreck, så matchning sker på normaliserat namn.
export const key = (name) => String(name).trim().toLowerCase().replace(/\s+/g, '-');

const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
const roleColor = (role) => role.colors?.primary_color ?? role.color ?? 0;
const typeLabel = (type) => TYPE_LABELS[type] ?? 'kanal';
// Högst först. Samma position sorteras på id för en stabil ordning.
const byHeight = (a, b) => b.position - a.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);

function parseColor(color, where) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ConfigError(`Ogiltig färg "${color}" i ${where} – använd #rrggbb.`);
  return parseInt(color.slice(1), 16);
}

function checkKeys(obj, allowed, where) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new ConfigError(`${where} måste vara ett objekt.`);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k) && !k.startsWith('_')) throw new ConfigError(`Okänt fält "${k}" i ${where}. Tillåtna: ${[...allowed].join(', ')}`);
  }
}

export function validate(config) {
  checkKeys(config, TOP_KEYS, 'konfigurationen');
  const roleNames = new Set();
  for (const role of config.roles ?? []) {
    checkKeys(role, ROLE_KEYS, 'en roll');
    if (typeof role.name !== 'string' || !role.name.trim()) throw new ConfigError('Varje roll måste ha ett namn.');
    if (roleNames.has(role.name.toLowerCase())) throw new ConfigError(`Rollen "${role.name}" finns två gånger.`);
    roleNames.add(role.name.toLowerCase());
  }
  const checkChannel = (ch, inCategory) => {
    checkKeys(ch, CHANNEL_KEYS, 'en kanal');
    if (typeof ch.name !== 'string' || !ch.name.trim()) throw new ConfigError('Varje kanal måste ha ett namn.');
    const type = ch.type ?? 'text';
    if (!(type in TYPES)) throw new ConfigError(`Okänd kanaltyp "${type}" för "${ch.name}". Giltiga: ${Object.keys(TYPES).join(', ')}`);
    if (type === 'category' && inCategory) throw new ConfigError(`Kategorin "${ch.name}" kan inte ligga i en annan kategori.`);
    if (ch.channels && type !== 'category') throw new ConfigError(`Bara kategorier kan innehålla kanaler ("${ch.name}").`);
    for (const child of ch.channels ?? []) checkChannel(child, true);
  };
  for (const ch of config.channels ?? []) checkChannel(ch, false);
}

const roleNameMap = (guildId, roles) => new Map(roles.map((r) => [r.id, r.id === guildId ? '@everyone' : r.name]));
const byTarget = (a, b) => a.target.toLowerCase().localeCompare(b.target.toLowerCase());
const notEmpty = (o) => o.allow !== '0' || o.deny !== '0';

function currentOverwrites(channel, roleNames) {
  return (channel.permission_overwrites ?? [])
    .map((o) => ({
      target: Number(o.type) === 1 ? `user:${o.id}` : roleNames.get(o.id) ?? `role:${o.id}`,
      allow: String(o.allow),
      deny: String(o.deny),
    }))
    .filter(notEmpty)
    .sort(byTarget);
}

const sameOverwrites = (a, b) => JSON.stringify(a.map((o) => ({ ...o, target: o.target.toLowerCase() })))
  === JSON.stringify(b.map((o) => ({ ...o, target: o.target.toLowerCase() })));

const overwritesToConfig = (list) => Object.fromEntries(list.map((o) => [o.target, compact({
  allow: o.allow !== '0' ? toNames(o.allow) : undefined,
  deny: o.deny !== '0' ? toNames(o.deny) : undefined,
})]));

/** Läser av servern till samma format som konfigurationsfilen. */
export function exportConfig({ guildId, roles, channels }) {
  const roleNames = roleNameMap(guildId, roles);
  const everyone = roles.find((r) => r.id === guildId);
  const sorted = channels
    .filter((c) => c.type in TYPE_NAMES)
    .sort((a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

  const entry = (c, parentOverwrites) => {
    const ow = currentOverwrites(c, roleNames);
    const synced = parentOverwrites && sameOverwrites(ow, parentOverwrites);
    const showOverwrites = !synced && (ow.length > 0 || parentOverwrites?.length > 0);
    return compact({
      name: c.name,
      type: TYPE_NAMES[c.type],
      topic: c.topic || undefined,
      nsfw: c.nsfw || undefined,
      slowmode: c.rate_limit_per_user || undefined,
      userLimit: c.user_limit || undefined,
      overwrites: showOverwrites ? overwritesToConfig(ow) : undefined,
    });
  };

  return compact({
    everyone: everyone && toNames(everyone.permissions),
    roles: roles
      .filter((r) => r.id !== guildId && !r.managed)
      .sort(byHeight)
      .map((r) => compact({
        name: r.name,
        color: roleColor(r) ? `#${roleColor(r).toString(16).padStart(6, '0')}` : undefined,
        hoist: r.hoist || undefined,
        mentionable: r.mentionable || undefined,
        permissions: toNames(r.permissions),
      })),
    channels: [
      ...sorted.filter((c) => !c.parent_id && c.type !== TYPES.category).map((c) => entry(c)),
      ...sorted.filter((c) => c.type === TYPES.category).map((cat) => {
        const ow = currentOverwrites(cat, roleNames);
        return { ...entry(cat), channels: sorted.filter((c) => c.parent_id === cat.id).map((c) => entry(c, ow)) };
      }),
    ],
  });
}

/** Jämför servern med konfigurationen och returnerar de ändringar som behövs. Ändrar inget. */
export function plan({ guildId, roles, channels }, config, { prune = false } = {}) {
  validate(config);
  const ops = [];
  const roleNames = roleNameMap(guildId, roles);
  const otherRoles = roles.filter((r) => r.id !== guildId);
  const knownRoles = new Set(['@everyone', ...roles.map((r) => r.name.toLowerCase()), ...(config.roles ?? []).map((r) => r.name.toLowerCase())]);

  const desiredOverwrites = (spec, where) => {
    if (spec === undefined) return undefined;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new ConfigError(`overwrites i ${where} måste vara ett objekt.`);
    return Object.entries(spec)
      .map(([target, value]) => {
        if (!/^(user|role):\d+$/.test(target) && !knownRoles.has(target.toLowerCase())) {
          throw new ConfigError(`Rollen "${target}" i ${where} finns varken på servern eller i konfigurationen.`);
        }
        checkKeys(value ?? {}, new Set(['allow', 'deny']), `${where} → ${target}`);
        return {
          target,
          allow: toBits(value?.allow, `${where} → ${target}`).toString(),
          deny: toBits(value?.deny, `${where} → ${target}`).toString(),
        };
      })
      .filter(notEmpty)
      .sort(byTarget);
  };

  // @everyone
  if (config.everyone !== undefined) {
    const current = roles.find((r) => r.id === guildId);
    const bits = toBits(config.everyone, '@everyone');
    if (current && BigInt(current.permissions) !== bits) {
      ops.push({ op: 'updateRole', id: guildId, label: 'roll "@everyone"', changes: ['permissions'], body: { permissions: bits.toString() } });
    }
  }

  // Roller – nya roller hamnar längst ner, rollordningen sätts efteråt.
  const matchedRoles = new Set();
  const configRoleIds = new Map();
  for (const role of [...(config.roles ?? [])].reverse()) {
    const where = `roll "${role.name}"`;
    const body = compact({
      name: role.name,
      permissions: role.permissions !== undefined ? toBits(role.permissions, where).toString() : undefined,
      colors: role.color !== undefined ? { primary_color: parseColor(role.color, where) } : undefined,
      hoist: role.hoist,
      mentionable: role.mentionable,
    });
    const current = otherRoles.find((r) => !matchedRoles.has(r.id) && r.name.toLowerCase() === role.name.toLowerCase());
    if (!current) {
      ops.push({ op: 'createRole', name: role.name, label: where, body });
      continue;
    }
    matchedRoles.add(current.id);
    configRoleIds.set(role, current.id);
    if (current.managed) continue;
    const changes = [];
    if (current.name !== role.name) changes.push('name');
    if (body.permissions !== undefined && BigInt(current.permissions) !== BigInt(body.permissions)) changes.push('permissions');
    if (body.colors && roleColor(current) !== body.colors.primary_color) changes.push('colors');
    if (body.hoist !== undefined && Boolean(current.hoist) !== body.hoist) changes.push('hoist');
    if (body.mentionable !== undefined && Boolean(current.mentionable) !== body.mentionable) changes.push('mentionable');
    if (changes.length) {
      ops.push({ op: 'updateRole', id: current.id, label: where, changes, body: Object.fromEntries(changes.map((c) => [c, body[c]])) });
    }
  }

  const reorder = planRoleOrder(otherRoles, config.roles ?? [], configRoleIds);
  if (reorder) ops.push(reorder);

  // Kanaler
  const used = new Set();
  const findChannel = (name, type, parentId) => {
    const candidates = channels.filter((c) => !used.has(c.id) && c.type === type && key(c.name) === key(name));
    const hit = candidates.find((c) => (c.parent_id ?? null) === parentId) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (hit) used.add(hit.id);
    return hit;
  };

  const planChannel = (entry, parent, inheritedOverwrites) => {
    const type = TYPES[entry.type ?? 'text'];
    const where = `${typeLabel(type)} "${entry.name}"${parent ? ` i "${parent.name}"` : ''}`;
    const current = findChannel(entry.name, type, parent ? parent.id ?? 'ny' : null);
    const fields = {};
    for (const [cfg, api] of Object.entries(CHANNEL_FIELDS)) if (entry[cfg] !== undefined) fields[api] = entry[cfg];

    if (!current) {
      ops.push(compact({
        op: 'createChannel',
        label: where,
        name: entry.name,
        type,
        parent: parent ? { name: parent.name, id: parent.id } : undefined,
        fields,
        overwrites: desiredOverwrites(entry.overwrites ?? (parent ? inheritedOverwrites : undefined), where),
      }));
      return undefined;
    }

    const op = { op: 'updateChannel', id: current.id, label: where, changes: [], fields: {} };
    for (const [api, value] of Object.entries(fields)) {
      const fallback = typeof value === 'string' ? '' : typeof value === 'boolean' ? false : 0;
      if ((current[api] ?? fallback) !== value) {
        op.changes.push(api);
        op.fields[api] = value;
      }
    }
    if (parent ? parent.id === undefined || current.parent_id !== parent.id : current.parent_id) {
      op.changes.push('parent');
      op.parent = parent ? { name: parent.name, id: parent.id } : null;
    }
    const wanted = desiredOverwrites(entry.overwrites, where);
    if (wanted && !sameOverwrites(wanted, currentOverwrites(current, roleNames))) {
      op.changes.push('overwrites');
      op.overwrites = wanted;
    }
    if (op.changes.length) ops.push(op);
    return current;
  };

  for (const entry of config.channels ?? []) {
    const current = planChannel(entry, null);
    for (const child of entry.channels ?? []) {
      planChannel(child, { name: entry.name, id: current?.id }, entry.overwrites);
    }
  }

  if (prune) {
    const leftovers = channels
      .filter((c) => !used.has(c.id) && c.type in TYPE_NAMES)
      .sort((a, b) => (a.type === TYPES.category) - (b.type === TYPES.category));
    for (const c of leftovers) ops.push({ op: 'deleteChannel', id: c.id, label: `${typeLabel(c.type)} "${c.name}"` });
    for (const r of otherRoles) {
      if (!matchedRoles.has(r.id) && !r.managed) ops.push({ op: 'deleteRole', id: r.id, label: `roll "${r.name}"` });
    }
  }

  return ops;
}

/** Rollerna i filen byter plats med varandra till filens ordning. Övriga roller, t.ex. botroller, ligger kvar. */
function planRoleOrder(roles, configRoles, ids) {
  const entries = new Map(configRoles.map((r) => [r, compact({ id: ids.get(r), name: r.name })]));
  const byId = new Map([...entries.values()].filter((e) => e.id).map((e) => [e.id, e]));
  // Nya roller hamnar längst ner.
  const current = [
    ...[...roles].sort(byHeight).map((r) => byId.get(r.id) ?? { id: r.id, name: r.name }),
    ...[...configRoles].reverse().filter((r) => !ids.has(r)).map((r) => entries.get(r)),
  ];
  const wanted = configRoles.map((r) => entries.get(r));
  const listed = new Set(wanted);
  let next = 0;
  const order = current.map((e) => (listed.has(e) ? wanted[next++] : e));
  // Nya rollers inbördes ordning går inte att förutse, så den sätts alltid när fler än en roll finns i filen.
  const created = configRoles.some((r) => !ids.has(r));
  if (!(created && configRoles.length > 1) && order.every((e, i) => e === current[i])) return undefined;
  return { op: 'reorderRoles', label: `rollordning (${wanted.map((e) => e.name).join(' > ')})`, order };
}

export function describe(op) {
  const sign = op.op.startsWith('create') ? '+' : op.op.startsWith('delete') ? '-' : '~';
  const changes = op.changes ? `: ${op.changes.map((c) => CHANGE_LABELS[c] ?? c).join(', ')}` : '';
  return `${sign} ${op.label}${changes}`;
}

/** Utför ändringarna i ordning. Nya roller och kategorier kan användas av senare steg. */
export async function execute(client, { guildId, roles }, ops, onStep = () => {}) {
  const roleIds = new Map(roles.map((r) => [r.id === guildId ? '@everyone' : r.name.toLowerCase(), r.id]));
  const newCategories = new Map();

  const parentId = (parent) => {
    if (!parent) return null;
    const id = parent.id ?? newCategories.get(key(parent.name));
    if (!id) throw new Error(`Kategorin "${parent.name}" hittades inte.`);
    return id;
  };

  const overwrites = (list) => list.map((o) => {
    const member = /^user:(\d+)$/.exec(o.target);
    const role = /^role:(\d+)$/.exec(o.target);
    const id = member?.[1] ?? role?.[1] ?? roleIds.get(o.target.toLowerCase());
    if (!id) throw new Error(`Rollen "${o.target}" hittades inte.`);
    return { id, type: member ? 1 : 0, allow: o.allow, deny: o.deny };
  });

  for (const op of ops) {
    onStep(op);
    switch (op.op) {
      case 'createRole': {
        const role = await client.post(`/guilds/${guildId}/roles`, op.body);
        roleIds.set(op.name.toLowerCase(), role.id);
        break;
      }
      case 'updateRole':
        await client.patch(`/guilds/${guildId}/roles/${op.id}`, op.body);
        break;
      case 'reorderRoles': {
        const ids = op.order.map((r) => r.id ?? roleIds.get(r.name.toLowerCase()));
        const missing = op.order.find((r, i) => !ids[i]);
        if (missing) throw new Error(`Rollen "${missing.name}" hittades inte.`);
        await client.patch(`/guilds/${guildId}/roles`, ids.map((id, i) => ({ id, position: ids.length - i })));
        break;
      }
      case 'deleteRole':
        await client.delete(`/guilds/${guildId}/roles/${op.id}`);
        break;
      case 'createChannel': {
        const body = { name: op.name, type: op.type, ...op.fields };
        if (op.parent) body.parent_id = parentId(op.parent);
        if (op.overwrites) body.permission_overwrites = overwrites(op.overwrites);
        const channel = await client.post(`/guilds/${guildId}/channels`, body);
        if (op.type === TYPES.category) newCategories.set(key(op.name), channel.id);
        break;
      }
      case 'updateChannel': {
        const body = { ...op.fields };
        if ('parent' in op) body.parent_id = parentId(op.parent);
        if (op.overwrites) body.permission_overwrites = overwrites(op.overwrites);
        await client.patch(`/channels/${op.id}`, body);
        break;
      }
      case 'deleteChannel':
        await client.delete(`/channels/${op.id}`);
        break;
      default:
        throw new Error(`Okänd åtgärd ${op.op}`);
    }
  }
}

export async function fetchServer(client, guildId) {
  const [roles, channels] = await Promise.all([
    client.get(`/guilds/${guildId}/roles`),
    client.get(`/guilds/${guildId}/channels`),
  ]);
  return { guildId, roles, channels };
}
