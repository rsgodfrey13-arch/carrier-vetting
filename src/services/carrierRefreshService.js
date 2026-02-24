const axios = require("axios");
const db = require("../db");

const FMCSA_BASE = "https://mobile.fmcsa.dot.gov/qc/services/carriers";
const FRESHNESS_MINUTES = 5; // skip refresh if already fresh

function mapFmcsaToCarrier(raw) {
  return {
    legalname: raw?.legalName || null,
    dbaname: raw?.dbaName || null,
    statuscode: raw?.statusCode || null,
    allowedtooperate: raw?.allowedToOperate || null,
    safetyrating: raw?.safetyRating || null
  };
}

async function fetchFromFmcsa(dot) {
  const apiKey = process.env.FMCSA_API_KEY;
  if (!apiKey) throw new Error("FMCSA_API_KEY missing");

  const url = `${FMCSA_BASE}/${encodeURIComponent(dot)}?webKey=${apiKey}`;

  try {
    const response = await axios.get(url, { timeout: 10000 });

    const carrier = response?.data?.content?.carrier;

    if (!carrier) {
      throw new Error("Carrier not found in FMCSA response");
    }

    return carrier;

  } catch (err) {
    if (err.response?.status === 429) {
      const e = new Error("Rate limited");
      e.status = 429;
      throw e;
    }

    throw err;
  }
}

async function refreshCarrier(dot) {
  if (!dot) throw new Error("Missing DOT");

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // 🔎 1️⃣ Check freshness first
    const existing = await client.query(
      `SELECT retrieval_date
       FROM carriers
       WHERE dotnumber = $1`,
      [dot]
    );

    if (existing.rows.length) {
      const last = existing.rows[0].retrieval_date;

      if (last) {
        const diffMinutes =
          (Date.now() - new Date(last).getTime()) / 60000;

        if (diffMinutes < FRESHNESS_MINUTES) {
          await client.query("COMMIT");
          return { skipped: true };
        }
      }
    }

    // 🌐 2️⃣ Fetch FMCSA
    const fmcsaData = await fetchFromFmcsa(dot);

    // 🔁 3️⃣ Map to schema
    const mapped = mapFmcsaToCarrier(fmcsaData);

    // 💾 4️⃣ Upsert (safer than UPDATE only)
    await client.query(
      `
      INSERT INTO carriers (
        dotnumber,
        legalname,
        dbaname,
        statuscode,
        allowedtooperate,
        safetyrating,
        retrieval_date,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
      ON CONFLICT (dotnumber)
      DO UPDATE SET
        legalname = EXCLUDED.legalname,
        dbaname = EXCLUDED.dbaname,
        statuscode = EXCLUDED.statuscode,
        allowedtooperate = EXCLUDED.allowedtooperate,
        safetyrating = EXCLUDED.safetyrating,
        retrieval_date = NOW(),
        updated_at = NOW()
      `,
      [
        dot,
        mapped.legalname,
        mapped.dbaname,
        mapped.statuscode,
        mapped.allowedtooperate,
        mapped.safetyrating
      ]
    );

    await client.query("COMMIT");

    return { ok: true };

  } catch (err) {
    await client.query("ROLLBACK");

    if (err.status === 429) {
      throw err; // let worker handle backoff
    }

    console.error("refreshCarrier error:", err);
    throw err;

  } finally {
    client.release();
  }
}

module.exports = { refreshCarrier };
