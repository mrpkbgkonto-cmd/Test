const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DiscordError extends Error {
  constructor(status, data, method, path) {
    const hint = data?.code === 50013
      ? ' – boten saknar behörighet. Ge botens roll Administratör och flytta den överst i rollistan.'
      : '';
    super(`${method} ${path} → ${status}: ${data?.message ?? 'okänt fel'}${hint}`);
    this.status = status;
    this.data = data;
  }
}

export function createClient(token, {
  baseUrl = process.env.DISCORD_API_URL || 'https://discord.com/api/v10',
  reason = 'discord-admin',
  fetchImpl = fetch,
} = {}) {
  if (!token) throw new Error('DISCORD_TOKEN saknas.');

  async function request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(baseUrl + path, {
        method,
        headers: {
          Authorization: `Bot ${token}`,
          'User-Agent': 'DiscordBot (https://github.com/mrpkbgkonto-cmd/Test, 1.0)',
          'X-Audit-Log-Reason': encodeURIComponent(reason),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < 5) {
        const data = await res.json().catch(() => ({}));
        await sleep((data.retry_after ?? 1) * 1000);
        continue;
      }
      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new DiscordError(res.status, data, method, path);
      return data;
    }
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  };
}
