import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { CONTENT_SECURITY_POLICY } from './server/security';

/**
 * Static hosts such as GitHub Pages cannot send security headers, so the built
 * page carries the same policy as a meta tag (frame-ancestors only works as a
 * header). Only for builds: the dev server injects inline scripts for HMR.
 */
const securityMeta = (): Plugin => ({
  name: 'security-meta',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: CONTENT_SECURITY_POLICY.replace(/; frame-ancestors [^;]+/, ''),
      },
      injectTo: 'head-prepend',
    },
    { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
  ],
});

export default defineConfig({
  plugins: [react(), securityMeta()],
  server: {
    // The API server (npm run server) listens on 3001 during development.
    proxy: { '/api': 'http://localhost:3001' },
  },
});
