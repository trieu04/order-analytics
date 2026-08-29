"use strict";

function createObservationClient(baseUrl) {
  const endpoint = new URL("/internal/observations", baseUrl).toString();

  async function submit(observation) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(observation),
      signal: AbortSignal.timeout(15_000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Observation API returned HTTP ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return data;
  }

  return { submit };
}

module.exports = { createObservationClient };
