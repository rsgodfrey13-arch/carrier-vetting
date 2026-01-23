// httpClient.js
const { logApiErrorMetric } = require("./apiErrorMetrics");

async function httpRequest({
  serviceName,
  vendor,
  url,
  options = {},
}) {
  try {
    const res = await fetch(url, options);

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      await logApiErrorMetric({
        serviceName,
        vendor,
        url,
        statusCode: res.status,
        message: `HTTP ${res.status} ${res.statusText} | ${bodyText}`,
      });

      // throw so your normal error handling continues
      const err = new Error(`HTTP ${res.status} ${res.statusText}`);
      err.statusCode = res.status;
      throw err;
    }

    return res;
  } catch (err) {
    // Network/timeout errors land here (no HTTP status)
    await logApiErrorMetric({
      serviceName,
      vendor,
      url,
      statusCode: err.statusCode ?? null,
      code: err.code ?? null,
      message: err.message,
    });

    throw err;
  }
}

module.exports = { httpRequest };
