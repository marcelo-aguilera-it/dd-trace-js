'use strict'

const assert = require('node:assert/strict')
const { promisify } = require('node:util')

const { afterEach, beforeEach, describe, it } = require('mocha')

const createConfig = require('../../dd-trace/src/config')
const agent = require('../../dd-trace/test/plugins/agent')
const externals = require('../../dd-trace/test/plugins/externals')
const { resolvePluginVersions } = require('../../dd-trace/test/plugins/versions')
const { withVersions } = require('../../dd-trace/test/setup/mocha')
const httpRequest = require('../../dd-trace/test/setup/helpers/http-client')

/**
 * @param {{
 *   listen: (options: { host: string, port: number }, callback: (error: Error | null) => void) => void,
 *   server: import('node:http').Server
 * }} app
 */
async function listenOnLoopback (app) {
  const listen = promisify(app.listen.bind(app))
  await listen({ host: '127.0.0.1', port: 0 })
  const { port } = /** @type {import('node:net').AddressInfo} */ (app.server.address())
  return 'http://127.0.0.1:' + port
}

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
      const address = await listenOnLoopback(app)

      await Promise.all([
        assertPropagatedPriority(address, 2),
        agent.assertFirstTraceSpan({ resource: 'GET /items/:id', metrics: { _sampling_priority_v1: 2 } }),
      ])
    })
  })

  for (const rewriteUrl of [undefined, () => '/items/42']) {
    withVersions('fastify', 'fastify', rewriteUrl ? '>=3' : '*', version => {
      const title = rewriteUrl
        ? 'dispatches a rewritten URL without an HTTP server span'
        : 'dispatches without an HTTP server span'

      it(title, async () => {
        const tracer = await agent.load(['fastify', 'find-my-way', 'http'], [{}, {}, { client: false, server: false }])
        const fastify = require('../../../versions/fastify@' + version).get()
        const app = fastify(rewriteUrl ? { rewriteUrl } : undefined)
        try {
          app.get('/items/:id', (request, reply) => {
            assert.strictEqual(tracer.scope().active(), null)
            return reply.send(request.params)
          })
          const address = await listenOnLoopback(app)
          const { status, data } = await httpRequest.get(address + (rewriteUrl ? '/before-rewrite' : '/items/42'))
          assert.strictEqual(status, 200)
          assert.deepStrictEqual(data, { id: '42' })
        } finally {
          await app.close()
          await agent.close()
        }
      })
    })
  }

  withVersions('fastify', 'fastify', '>=3', version => {
    it('does not use the bare HTTP fallback before rewriteUrl runs', async () => {
      await agent.load(['fastify', 'find-my-way', 'http'], [{}, {}, { client: false }], {
        sampleRate: 0,
        rateLimit: -1,
        samplingRules: [{ resource: 'GET', sampleRate: 1 }],
      })
      const tracer = require('../../dd-trace')
      const createFastify = require('../../../versions/fastify@' + version).get()
      const carrier = {}
      const fastify = createFastify({
        rewriteUrl () {
          if (tracer.scope().active()) {
            tracer.trace('outbound', span => tracer.inject(span, 'http_headers', carrier))
          }
          return '/rewritten/42'
        },
      })
      fastify.get('/rewritten/:id', (req, reply) => reply.send({ priority: carrier['x-datadog-sampling-priority'] }))

      const priority = createConfig().DD_TRACE_OTEL_SEMANTICS_ENABLED ? 2 : -1
      try {
        const address = await listenOnLoopback(fastify)
        await Promise.all([
          assertPropagatedPriority(address, priority),
          priority === 2
            ? agent.assertFirstTraceSpan({ resource: 'GET /rewritten/:id', metrics: { _sampling_priority_v1: 2 } })
            : agent.assertUserRejectedTrace('GET /rewritten/:id'),
        ])
      } finally {
        await fastify.close()
        await agent.close()
      }
    })
  })

  for (const { range, mode, compile } of [
    { range: '>=1.14.6 <4', mode: 'version' },
    { range: '>=4', mode: 'sync' },
    { range: '>=4', mode: 'async' },
    { range: '>=5.12.8', mode: 'sync', compile: true },
    { range: '>=5.12.8', mode: 'async', compile: true },
  ]) {
    withVersions('fastify', 'fastify', range, version => {
      it(`ignores bare HTTP while deriving route constraints (${mode}${compile ? ', compiled' : ''})`, async () => {
        const tracer = await agent.load(['fastify', 'find-my-way', 'http'], [{}, {}, { client: false }], {
          sampleRate: 0,
          rateLimit: -1,
          samplingRules: [{ resource: 'GET', sampleRate: 1 }],
        })
        const createFastify = require('../../../versions/fastify@' + version).get()
        const carrier = {}
        const deriveTenant = request => {
          tracer.trace('outbound', span => tracer.inject(span, 'http_headers', carrier))
          return request.headers['x-tenant']
        }
        const app = createFastify(mode === 'version'
          ? { versioning: { storage: () => new Map(), deriveVersion: deriveTenant } }
          : { routerOptions: { compile } })

        try {
          const tenant = '1.0.0'
          const routeOptions = mode === 'version' ? { version: tenant } : { constraints: { tenant } }
          if (mode !== 'version') {
            app.addConstraintStrategy({
              name: 'tenant',
              storage: () => new Map(),
              deriveConstraint: mode === 'async'
                ? (request, _context, done) => queueMicrotask(() => done(null, deriveTenant(request)))
                : deriveTenant,
            })
          }
          app.get('/items/:id', routeOptions, (req, reply) => {
            reply.send({ id: req.params.id, priority: carrier['x-datadog-sampling-priority'] })
          })

          const address = await listenOnLoopback(app)
          const priority = createConfig().DD_TRACE_OTEL_SEMANTICS_ENABLED ? 2 : -1
          const [{ status, data }] = await Promise.all([
            httpRequest.get(address + '/items/42', { headers: { 'x-tenant': tenant } }),
            priority === 2
              ? agent.assertFirstTraceSpan({ resource: 'GET /items/:id', metrics: { _sampling_priority_v1: 2 } })
              : agent.assertUserRejectedTrace('GET /items/:id'),
          ])
          assert.strictEqual(status, 200)
          assert.deepStrictEqual(data, { id: '42', priority: String(priority) })
        } finally {
          await app.close()
          await agent.close()
        }
      })
    })
  }

  const { unversioned: expressRange } = resolvePluginVersions({
    name: 'express',
    declarations: externals.fastify.filter(({ name }) => name === 'express'),
    honourEnvRange: false,
  })

  withVersions('fastify', 'fastify', '>=4', version => {
    if (!expressRange) return

    /**
     * @param {string | RegExp} resource
     * @param {number} priority
     */
    async function assertDelegatedSampling (resource, priority) {
      await agent.load(['fastify', 'find-my-way', 'http', 'express', 'router'], [{}, {}, { client: false }], {
        sampleRate: 0,
        rateLimit: -1,
        samplingRules: [{ resource, sampleRate: 1 }],
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

      try {
        const address = await fastify.listen({ host: '127.0.0.1', port: 0 })
        await Promise.all([
          assertPropagatedPriority(address, priority),
          priority === 2
            ? agent.assertFirstTraceSpan({ resource: 'GET /items/:id', metrics: { _sampling_priority_v1: 2 } })
            : agent.assertUserRejectedTrace('GET /items/:id'),
        ])
      } finally {
        await fastify.close()
        await agent.close()
      }
    }

    it('uses the existing inner resource after delegation to Express', async () => {
      const priority = createConfig().DD_TRACE_OTEL_SEMANTICS_ENABLED ? 2 : -1
      await assertDelegatedSampling('GET /items/:id', priority)
    })

    it('does not match a rule for the superseded outer route', async () => {
      await assertDelegatedSampling(/^GET \/\*$/, -1)
    })
  })
})
