# discord-admin

Styr en Discord-server från terminalen – av dig eller av Claude. Roller, kategorier, kanaler och behörigheter beskrivs i en JSON-fil som appliceras på servern.

Boten behöver **inte vara igång** – verktyget pratar direkt med Discords API när ett kommando körs. Ingen hosting.

## 1. Skapa boten (en gång)

1. Gå till [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** → **Reset Token** → kopiera token. Den ger full kontroll – dela den aldrig och klistra aldrig in den i en chatt.
3. **OAuth2 → URL Generator**: kryssa `bot` och behörigheten `Administrator`. Öppna länken och välj din server.
4. I Discord: **Serverinställningar → Roller** – dra botens roll högst upp. Annars kan den inte ändra roller ovanför sig.

## 2. Ge Claude tillgång (molnsession)

I miljöinställningarna (molnmenyn i sessionens titelrad → Edit):

- **Network access:** lägg till `discord.com` under Allowed domains.
- **Miljövariabel:** `DISCORD_TOKEN=<din token>`. Valfritt `DISCORD_GUILD_ID` om boten är med i flera servrar.

Starta sedan en ny session. I molnmiljön körs verktyget med `NODE_USE_ENV_PROXY=1` så att trafiken går via proxyn.

Lokalt: `export DISCORD_TOKEN=...` och kör kommandona nedan.

## Kommandon

```bash
cd discord && npm install
node cli.js guilds                    # servrar boten är med i
node cli.js export server.json        # spara nuvarande inställningar
node cli.js plan server.json          # visa ändringar (ändrar inget)
node cli.js apply server.json         # genomför ändringarna
node cli.js apply server.json --prune # ta även bort kanaler/roller som saknas i filen
node cli.js send regler "Välkommen!"  # skicka meddelande (--ping för att tillåta @everyone)
```

Arbetsflöde: `export` → ändra filen → `plan` → `apply`. Allt syns i serverns granskningslogg som "discord-admin".

## Filformat

Se [`exempel.json`](exempel.json) för en komplett server.

| Fält | Beskrivning |
|---|---|
| `everyone` | Behörigheter för @everyone |
| `roles[]` | `name`, `color` (`#rrggbb`), `hoist` (visas separat), `mentionable`, `permissions` – första rollen hamnar högst |
| `channels[]` | `name`, `type` (`text`, `voice`, `category`, `announcement`, `stage`, `forum`, `media`), `topic`, `nsfw`, `slowmode` (sekunder), `userLimit`, `overwrites` |
| `channels[].channels[]` | Kanaler i en kategori. Nya kanaler ärver kategorins `overwrites`. |
| `overwrites` | `{ "Rollnamn": { "allow": [...], "deny": [...] } }`. Även `"@everyone"` och `"user:<id>"`. |

Behörigheter skrivs med Discords namn, t.ex. `ViewChannel`, `SendMessages`, `ManageMessages`, `KickMembers`, `Administrator`. Ett felstavat namn ger ett fel med alla giltiga namn.

Matchning sker på namn (skiftläge och mellanslag/bindestreck spelar ingen roll). Fält som saknas i filen lämnas orörda. Utan `--prune` tas aldrig något bort. Botroller rörs aldrig.

Rollerna i filen sorteras i filens ordning. Roller som inte finns i filen, t.ex. botroller, ligger kvar på sina platser. Boten kan bara flytta roller som ligger under dess egen roll.

## Tester

```bash
npm test   # kör mot en låtsas-Discord, ingen token behövs
```
