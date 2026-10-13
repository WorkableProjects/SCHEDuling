import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync } from 'node:fs';

/**
 * Local full-stack dev: serves each Netlify function module (netlify/functions/*.ts) from the Vite dev server,
 * using the same `config.path` patterns Netlify uses. Set NETLIFY_DB_URL + NETLIFY_DB_DRIVER=server to point at local Postgres.
 * (`netlify dev` also works when linked to a site; this keeps local dev and e2e tests independent of Netlify auth.)
 */
function netlifyFunctions(): Plugin {
  return {
    name: 'netlify-functions-dev',
    apply: 'serve',
    configureServer(server) {
      const files = readdirSync('netlify/functions').filter((f) => f.endsWith('.ts') && f !== 'maintenance.ts');
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        for (const f of files) {
          const mod = await server.ssrLoadModule(`/netlify/functions/${f}`);
          const paths: string[] = [mod.config?.path].flat().filter(Boolean);
          const hit = paths.some((p) => (p.endsWith('/*') ? url.pathname.startsWith(p.slice(0, -1)) || url.pathname === p.slice(0, -2) : url.pathname === p));
          if (!hit) continue;
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
          const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
          const response: Response = await mod.default(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body }), {});
          res.statusCode = response.status;
          response.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
          const cookies = response.headers.getSetCookie();
          if (cookies.length) res.setHeader('set-cookie', cookies);
          res.end(Buffer.from(await response.arrayBuffer()));
          return;
        }
        res.statusCode = 404; res.setHeader('content-type', 'application/json'); res.end('{"error":"No such endpoint"}');
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), netlifyFunctions()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 700 },
});
