/**
 * Render Keep-Alive Cronjob
 * Executes every 30 seconds to ping the /health endpoint.
 * This prevents Render free-tier instances from spinning down due to inactivity
 * and keeps response times fast and consistent.
 */
export const initKeepAliveCron = (port) => {
  const effectivePort = port || process.env.PORT || 5000;

  // Resolve target base URL
  // On Render, RENDER_EXTERNAL_URL is automatically populated with the deployed public URL (e.g., https://leadflow-api.onrender.com)
  const baseUrl = (
    process.env.RENDER_EXTERNAL_URL ||
    process.env.BACKEND_URL ||
    process.env.API_URL ||
    `http://127.0.0.1:${effectivePort}`
  ).replace(/\/+$/, '');

  const healthUrl = `${baseUrl}/health`;

  console.log(`[Keep-Alive Cron] Service initialized. Target URL: ${healthUrl} | Interval: 30s`);

  const pingHealth = async () => {
    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'LeadFlow-KeepAlive-Cron/1.0' },
      });

      if (response.ok) {
        const data = await response.json();
        console.log(
          `[Keep-Alive Cron] API Status: ${data.status?.toUpperCase() || 'HEALTHY'} | HTTP ${response.status} | Uptime: ${Math.round(data.uptime || process.uptime())}s | ${new Date().toLocaleTimeString()}`
        );
      } else {
        console.warn(
          `[Keep-Alive Cron] Health Check Warning: HTTP ${response.status} ${response.statusText}`
        );
      }
    } catch (err) {
      console.warn(`[Keep-Alive Cron] Ping Error: ${err.message}`);
    }
  };

  // Run first ping after 5s once server is fully up, then every 30s
  const initialTimeout = setTimeout(pingHealth, 5000);
  const intervalId = setInterval(pingHealth, 30000);

  return { intervalId, initialTimeout };
};

export default initKeepAliveCron;