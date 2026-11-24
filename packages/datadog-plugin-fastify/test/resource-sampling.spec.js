'use strict'

const assert = require('node:assert/strict')

const { afterEach, beforeEach, describe, it } = require('mocha')

const createConfig = require('../../dd-trace/src/config')
const agent = require('../../dd-trace/test/plugins/agent')
const externals = require('../../dd-trace/test/plugins/externals')
const { resolvePluginVersions } = require('../../dd-trace/test/plugins/versions')
const { withVersions } = require('../../dd-trace/test/setup/mocha')
const httpRequest = require('../../dd-trace/test/setup/helpers/http-client')

/**
 * @param {string} address
 * @param {number} priority
 */
async function assertPropagatedPriority (address, priority) {
  const { data } = await httpRequest.get(address + '/items/42')
  assert.deepStrictEqual(data, { priority: String(priority) })
}

describe('Fastify resource sampling', () => {
  withVersions('fastify', 'fastify', version => {
    let app
    let tracer

    beforeEach(async () => {
      await agent.load(['fastify', 'find-my-way', 'http'], [{}, {}, { client: false }], {
        sampleRate: 0,
        rateLimit: -1,
        samplingRules: [{ resource: 'GET /items/:id', sampleRate: 1 }],
      })
      tracer = require('../../dd-trace')
      const fastify = require('../../../versions/fastify@' + version).get()
      app = fastify()
    })

    afterEach(async () => {
      if (app) await app.close()
      await agent.close()
    })

    it('matches the native route before propagation in a request hook', async () => {
      const carrier = {}
      app.addHook('onRequest', (req, reply, done) => {
        tracer.trace('outbound', span => tracer.inject(span, 'http_headers', carrier))
        done()
      })
      app.get('/items/:id', (req, reply) => reply.send({ priority: carrier['x-datadog-sampling-priority'] }))
      await new Promise((resolve, reject) => {
        app.listen({ host: '127.0.0.1', port: 0 }, error => error ? reject(error) : resolve())
      })

      await Promise.all([
        assertPropagatedPriority('http://127.0.0.1:' + app.server.address().port, 2),
        agent.assertFirstTraceSpan({ resource: 'GET /items/:id', metrics: { _sampling_priority_v1: 2 } }),
      ])
    })

    it('keeps native dispatch working without an HTTP server span', async () => {
      app.get('/items/:id', (req, reply) => reply.send(req.params))
      const response = await app.inject({ method: 'GET', url: '/items/42' })
      assert.strictEqual(response.statusCode, 200)
      assert.deepStrictEqual(JSON.parse(response.payload), { id: '42' })
    })
  })

  const { unversioned: expressRange } = resolvePluginVersions({
    name: 'express',
    declarations: externals.fastify.filter(({ name }) => name === 'express'),
    honourEnvRange: false,
  })

  withVersions('fastify', 'fastify', '>=4', version => {
    if (!expressRange) return

    it('does not use the outer route after delegation to Express', async () => {
      await agent.load(['fastify', 'find-my-way', 'http', 'express', 'router'], [{}, {}, { client: false }], {
        sampleRate: 0,
        rateLimit: -1,
        samplingRules: [{ resource: 'GET /items/:id', sampleRate: 1 }],
      })
      const tracer = require('../../dd-trace')
      const createExpress = require('../../../versions/express').get()
      const createFastify = require('../../../versions/fastify@' + version).get()
      const express = createExpress()
      const fastify = createFastify()

      express.get('/items/:id', (req, res) => {
        const carrier = {}
        tracer.trace('outbound', span => tracer.inject(span, 'http_headers', carrier))
        res.json({ priority: carrier['x-datadog-sampling-priority'] })
      })
      fastify.get('/*', (req, reply) => {
        reply.hijack()
        express(req.raw, reply.raw)
      })

      const priority = createConfig().DD_TRACE_OTEL_SEMANTICS_ENABLED ? 2 : -1
      try {
        const address = await fastify.listen({ host: '127.0.0.1', port: 0 })
        await Promise.all([
          assertPropagatedPriority(address, priority),
          agent.assertFirstTraceSpan({ resource: 'GET /items/:id', metrics: { _sampling_priority_v1: priority } }),
        ])
      } finally {
        await fastify.close()
        await agent.close()
      }
    })
  })
})
