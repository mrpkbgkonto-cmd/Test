#!/usr/bin/env node
import fs from 'node:fs';
import { createClient } from './lib/rest.js';
import { describe, execute, exportConfig, fetchServer, key, plan } from './lib/server.js';

const HELP = `discord-admin – styr en Discord-server

Kommandon:
  guilds                     Lista servrar boten är med i
  export [fil]               Spara serverns roller och kanaler som JSON
  plan <fil> [--prune]       Visa vad som skulle ändras (ändrar inget)
  apply <fil> [--prune]      Genomför ändringarna
  send <kanal> <text|->      Skicka ett meddelande som boten ("-" läser text från stdin)

Flaggor:
  --guild <id>   Vilken server (annars DISCORD_GUILD_ID, eller den enda boten är med i)
  --prune        Ta också bort kanaler och roller som saknas i filen
  --ping         Låt meddelandet pinga @everyone/roller/personer

Miljövariabler: DISCORD_TOKEN (krävs), DISCORD_GUILD_ID (valfri)`;

function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--prune') flags.prune = true;
    else if (arg === '--ping') flags.ping = true;
    else if (arg === '--guild') flags.guild = argv[++i];
    else if (arg === '-h' || arg === '--help') flags.help = true;
    else args.push(arg);
  }
  return { args, flags };
}

async function resolveGuild(client, flag) {
  const id = flag || process.env.DISCORD_GUILD_ID;
  if (id) return id;
  const guilds = await client.get('/users/@me/guilds');
  if (guilds.length === 1) return guilds[0].id;
  if (!guilds.length) throw new Error('Boten är inte med i någon server ännu – bjud in den först (se README).');
  throw new Error(`Boten är med i flera servrar – ange --guild <id>:\n${guilds.map((g) => `  ${g.id}  ${g.name}`).join('\n')}`);
}

function readConfig(file) {
  if (!file) throw new Error('Ange en konfigurationsfil, t.ex. server.json.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const { args: [cmd, ...args], flags } = parseArgs(process.argv.slice(2));
  if (!cmd || flags.help) return console.log(HELP);
  const client = createClient(process.env.DISCORD_TOKEN, { reason: `discord-admin ${cmd}` });

  if (cmd === 'guilds') {
    for (const g of await client.get('/users/@me/guilds')) console.log(`${g.id}  ${g.name}`);
    return;
  }

  const guildId = await resolveGuild(client, flags.guild);

  if (cmd === 'export') {
    const json = `${JSON.stringify(exportConfig(await fetchServer(client, guildId)), null, 2)}\n`;
    if (!args[0]) return process.stdout.write(json);
    fs.writeFileSync(args[0], json);
    return console.error(`Sparat i ${args[0]}`);
  }

  if (cmd === 'plan' || cmd === 'apply') {
    const config = readConfig(args[0]);
    const current = await fetchServer(client, guildId);
    const ops = plan(current, config, { prune: flags.prune });
    if (!ops.length) return console.log('Inga ändringar – servern matchar filen.');
    if (cmd === 'plan') {
      for (const op of ops) console.log(describe(op));
      return console.log(`\n${ops.length} ändring(ar). Kör "apply" för att genomföra.`);
    }
    let done = 0;
    try {
      await execute(client, current, ops, (op) => {
        console.log(describe(op));
        done++;
      });
    } catch (err) {
      throw new Error(`${err.message}\n${done - 1} av ${ops.length} ändringar hann genomföras. Kör "plan" för att se vad som återstår.`);
    }
    return console.log(`\nKlart: ${ops.length} ändring(ar) genomförda.`);
  }

  if (cmd === 'send') {
    const [name, ...words] = args;
    let content = words.join(' ');
    if (content === '-') content = fs.readFileSync(0, 'utf8').trim();
    if (!name || !content) throw new Error('Användning: send <kanal> <text|->');
    if (content.length > 2000) throw new Error('Meddelandet är längre än 2000 tecken.');
    const channels = await client.get(`/guilds/${guildId}/channels`);
    const matches = channels.filter((c) => [0, 5].includes(c.type) && key(c.name) === key(name.replace(/^#/, '')));
    if (matches.length !== 1) throw new Error(matches.length ? `Flera kanaler heter "${name}".` : `Hittar ingen textkanal "${name}".`);
    await client.post(`/channels/${matches[0].id}/messages`, {
      content,
      allowed_mentions: { parse: flags.ping ? ['everyone', 'roles', 'users'] : [] },
    });
    return console.log(`Skickat till #${matches[0].name}.`);
  }

  throw new Error(`Okänt kommando "${cmd}".\n\n${HELP}`);
}

main().catch((err) => {
  console.error(`Fel: ${err.message}`);
  process.exit(1);
});
