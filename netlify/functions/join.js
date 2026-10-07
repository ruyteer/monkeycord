// Função serverless da Netlify
const { join } = require("../../lib/rtk");

// O app desktop chama daqui de fora (origem "null"), então liberamos CORS.
const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: cors, body: '{"error":"Use POST"}' };
  try {
    const { name, room } = JSON.parse(event.body || "{}");
    return { statusCode: 200, headers: cors, body: JSON.stringify(await join(name, room)) };
  } catch (e) {
    console.error(e);
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
