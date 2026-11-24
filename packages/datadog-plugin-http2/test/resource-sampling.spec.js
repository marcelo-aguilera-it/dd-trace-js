'use strict'

const assert = require('node:assert/strict')
const { once } = require('node:events')
const { text } = require('node:stream/consumers')

const { afterEach, beforeEach, describe, it } = require('mocha')

const agent = require('../../dd-trace/test/plugins/agent')

describe('HTTP/2 server resource sampling', () => {
  let tracer
  let http2
  let server
  let client

  beforeEach(async () => {
    await agent.load('http2', { client: false }, {
      sampleRate: 0,
      rateLimit: -1,
      samplingRules: [{ resource: 'GET', sampleRate: 1 }],
    })
    tracer = require('../../dd-trace')
    http2 = require('node:http2')
    server = http2.createServer()
  })

  afterEach(async () => {
    client?.destroy()
    if (server?.listening) await new Promise(resolve => server.close(resolve))
    await agent.close()
  })

  function priority () {
    const carrier = {}
    tracer.inject(tracer.scope().active(), 'http_headers', carrier)
    return carrier['x-datadog-sampling-priority']
  }

  for (const event of ['request', 'stream', 'mixed']) {
    it('uses the method in the ' + event + ' listener', async () => {
      if (event === 'mixed') server.on('stream', () => {})
      if (event === 'stream') {
        server.on(event, stream => {
          stream.respond({ ':status': 200 })
          stream.end(priority())
        })
      } else {
        server.on('request', (req, res) => res.end(priority()))
      }

      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      client = http2.connect('http://127.0.0.1:' + server.address().port)
      assert.strictEqual(await text(client.request()), '2')
    })
  }
})
