// Função serverless da Vercel
const { join } = require("../lib/rtk");

module.exports = async (req, res) => {
  // O app desktop chama de outra origem
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    res.status(200).json(await join(body.name, body.room));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
};
