const axios = require("axios");
const db = require("../db"); // your pg pool
// const { mapFmcsaToCarrier } = require("./carrierMapper"); // if you have one

async function fetchFromFmcsa(dot) {
  const apiKey = process.env.FMCSA_API_KEY;

  const url = `https://mobile.fmcsa.dot.gov/qc/services/carriers/${encodeURIComponent(dot)}?webKey=${apiKey}`;

  const response = await axios.get(url, { timeout: 10000 });

  if (response.status !== 200 || !response.data) {
    throw new Error("FMCSA response invalid");
  }

  // Adjust based on actual FMCSA response shape
  const carrier = response.data?.content?.carrier;

  if (!carrier) {
    throw new Error("Carrier not found in FMCSA");
  }

  return carrier;
}


async function refreshCarrier(dot) {
  if (!dot) throw new Error("Missing DOT");

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Fetch fresh FMCSA data
    const fmcsaData = await fetchFromFmcsa(dot);

    // 2️⃣ Map FMCSA → your schema
    const mapped = mapFmcsaToCarrier(fmcsaData);

    // 3️⃣ Update carrier table
    await client.query(
      `
      UPDATE carriers
      SET
        legalname = $2,
        dbaname = $3,
        statuscode = $4,
        allowedtooperate = $5,
        safetyrating = $6,
        retrieval_date = NOW(),
        updated_at = NOW()
      WHERE dotnumber = $1
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

    if (err.response?.status === 429) {
      const e = new Error("Rate limited");
      e.status = 429;
      throw e;
    }

    throw err;

  } finally {
    client.release();
  }
}

function mapFmcsaToCarrier(raw) {
  return {
    legalname: raw.legalName || null,
    dbaname: raw.dbaName || null,
    statuscode: raw.statusCode || null,
    allowedtooperate: raw.allowedToOperate || null,
    safetyrating: raw.safetyRating || null
  };
}
