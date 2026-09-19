// Vite removes this branch and the command bridge from production builds.
export const PLAYTEST = import.meta.env.DEV && import.meta.env.MODE === 'playtest' &&
  ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
