import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import sirv from 'sirv'
import { createPricingProxy } from './pricing-proxy.mjs'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
const distDir = resolve(dirname(process.argv[1]), '../dist')
const serveStatic = sirv(distDir, { single: true, etag: true })
const pricingProxy = createPricingProxy()

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

createServer((req, res) => {
  pricingProxy(req, res, () => {
    if (req.url?.startsWith('/api/')) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    serveStatic(req, res, () => {
      res.statusCode = 404
      res.end('Not found')
    })
  })
}).listen(port, host, () => {
  console.log(`Sub Prices listening on http://${host}:${port}`)
})
