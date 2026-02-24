const THROTTLE_MS = 700;
const { refreshCarrier } = require("../services/carrierRefreshService");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getNextPendingRow(db) {
  const result = await db.query(`
    UPDATE carrier_refresh_queue
    SET status = 'RUNNING',
        updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM carrier_refresh_queue
      WHERE status = 'PENDING'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `);

  return result.rows[0] || null;
}

async function processRow(db, row) {
  try {
    await refreshCarrier(row.dotnumber); // existing service

    await db.query(`
      UPDATE carrier_refresh_queue
      SET status = 'COMPLETE',
          updated_at = NOW()
      WHERE id = $1
    `, [row.id]);

    if (row.job_id) {
      await db.query(`
        UPDATE carrier_verification_jobs
        SET completed = completed + 1
        WHERE id = $1
      `, [row.job_id]);

      await db.query(`
        UPDATE carrier_verification_jobs
        SET status = 'COMPLETE',
            completed_at = NOW()
        WHERE id = $1
          AND completed >= total
      `, [row.job_id]);
    }

  } catch (err) {
    await db.query(`
      UPDATE carrier_refresh_queue
      SET
        attempts = attempts + 1,
        last_error = $2,
        status = CASE
          WHEN attempts + 1 >= 5 THEN 'FAILED'
          ELSE 'PENDING'
        END,
        updated_at = NOW()
      WHERE id = $1
    `, [row.id, err.message]);

    if (err.status === 429) {
      await sleep(10000);
    }
  }
}

async function startRefreshWorker(db) {
  console.log("Carrier refresh worker started");

  await sleep(1000);

  while (true) {
    try {
      const row = await getNextPendingRow(db);

      if (!row) {
        await sleep(500);
        continue;
      }

      await processRow(db, row);
      await sleep(THROTTLE_MS);

    } catch (err) {
      console.error("Worker error:", err);
      await sleep(2000);
    }
  }
}

module.exports = { startRefreshWorker };


