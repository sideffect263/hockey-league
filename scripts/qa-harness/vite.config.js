// Floodlight QA harness: the WHOLE site with a fake signed-in account, so role views
// (fan / player / coach / LM / referee / admin) can be checked without a real login.
// Reads are the real public data (anon key); writes and auth-only RPCs simply fail.
//   npx vite --config scripts/qa-harness/vite.config.js --port 5300
//   open http://localhost:5300/?as=player   (guest | fan | player | coach | lm | ref | admin)
// The role sticks for the tab (sessionStorage); ?as=guest signs out. Dev only — never built.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const root = path.resolve(__dirname, '../..')
// Tailwind resolves its content globs against the cwd: run from the repo root wherever vite was started.
process.chdir(root)
const swap = { [path.resolve(root, 'src/lib/AuthContext')]: path.resolve(__dirname, 'FakeAuth.jsx') }
const mocks = {
  name: 'harness-auth', enforce: 'pre',
  async resolveId(src, importer) {
    if (!importer || importer.startsWith(__dirname)) return null
    const r = await this.resolve(src, importer, { skipSelf: true })
    if (!r) return null
    return swap[r.id.replace(/\.(jsx?|tsx?)$/, '')] || null
  },
}
export default defineConfig({
  root,
  plugins: [mocks, react()],
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  server: { port: 5300 },
})
