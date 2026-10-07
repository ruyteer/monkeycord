// Lógica compartilhada: acha/cria a sala e gera o token do participante.
// As chaves vêm das variáveis de ambiente (veja .env.example).
const crypto = require("crypto");

const API = "https://api.cloudflare.com/client/v4";
const cache = {}; // título da sala -> meeting id

function cfg() {
  const { CF_ACCOUNT_ID, CF_API_TOKEN, RTK_APP_ID } = process.env;
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !RTK_APP_ID) {
    throw new Error("Faltam variáveis: CF_ACCOUNT_ID, CF_API_TOKEN, RTK_APP_ID");
  }
  return {
    base: `${API}/accounts/${CF_ACCOUNT_ID}/realtime/kit/${RTK_APP_ID}`,
    token: CF_API_TOKEN,
    preset: process.env.RTK_PRESET_NAME || "group_call_participant",
  };
}

async function cf(c, path, method = "GET", body) {
  const res = await fetch(c.base + path, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(`Cloudflare ${res.status}: ${JSON.stringify(json.errors || json)}`);
  }
  return json;
}

async function getMeetingId(c, room) {
  if (process.env.RTK_MEETING_ID) return process.env.RTK_MEETING_ID;
  if (cache[room]) return cache[room];

  // Reaproveita uma sala com o mesmo título, se já existir
  const list = await cf(c, "/meetings?per_page=100");
  const found = (list.data || []).find((m) => m.title === room);
  const id = found ? found.id : (await cf(c, "/meetings", "POST", { title: room })).data.id;
  cache[room] = id;
  return id;
}

async function join(name, room) {
  const c = cfg();
  name = String(name || "").trim().slice(0, 40);
  room = String(room || "resenha").trim().toLowerCase().slice(0, 40) || "resenha";
  if (!name) throw new Error("Coloca um nome");

  const meetingId = await getMeetingId(c, room);
  const p = await cf(c, `/meetings/${meetingId}/participants`, "POST", {
    name,
    preset_name: c.preset,
    custom_participant_id: crypto.randomUUID(),
  });
  return { authToken: p.data.token || p.data.authToken, room };
}

module.exports = { join };
