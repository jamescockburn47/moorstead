// The test runner and its owned Vite server share this configuration boundary.
function portOption(raw, name) {
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer from 1024 to 65535.`);
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be an integer from 1024 to 65535.`);
  }
  return port;
}
export function playtestOptions(env = process.env) {
  const port = portOption(env.MOORSTEAD_TEST_PORT ?? '4317', 'MOORSTEAD_TEST_PORT');
  return { port, host: '127.0.0.1', origin: `http://127.0.0.1:${port}`, identity: 'moorstead-playtest-v1' };
}
export function releaseOptions(env = process.env) {
  const port = portOption(env.MOORSTEAD_RELEASE_TEST_PORT ?? '4318', 'MOORSTEAD_RELEASE_TEST_PORT');
  return { port, host: '127.0.0.1', origin: `http://127.0.0.1:${port}`, identity: 'moorstead-release-smoke-v1' };
}
export function freeplayFixtureOptions(env = process.env) {
  const port = portOption(env.MOORSTEAD_FREEPLAY_PORT ?? '4319', 'MOORSTEAD_FREEPLAY_PORT');
  return { port, host: '127.0.0.1', origin: `http://127.0.0.1:${port}` };
}
