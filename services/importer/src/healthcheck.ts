const port = process.env.HEALTH_PORT ?? "3001";
try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
