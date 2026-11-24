'use strict'

const assert = require('node:assert/strict')
const { once } = require('node:events')

const { afterEach, beforeEach, describe, it } = require('mocha')

const createConfig = require('../../dd-trace/src/config')
const agent = require('../../dd-trace/test/plugins/agent')
const httpRequest = require('../../dd-trace/test/setup/helpers/http-client')

describe('HTTP server resource sampling', () => {
  let server
  let tracer

  beforeEach(async () => {
    await agent.load('http', { client: false }, {
      sampleRate: 0,
      rateLimit: -1,
      samplingRules: [
        { resource: 'GET', sampleRate: 1 },
        { resource: 'PATCH', sampleRate: 1 },
        { resource: 'POST /items/:id', sampleRate: 1 },
        { resource: 'custom resource', sampleRate: 1 },
      ],
    })
    tracer = require('../../dd-trace')
  })

  afterEach(async () => {
    if (server) await new Promise(resolve => server.close(resolve))
    await agent.close()
  })

  async function propagate (configureRequest, method = 'GET') {
    const http = require('node:http')
    server = http.createServer((req, res) => {
      const span = tracer.scope().active()
      configureRequest?.(req, span)
      const context = span.context()
      const resource = context.getTag('resource.name')
      const carrier = {}
      tracer.trace('outbound', child => tracer.inject(child, 'http_headers', carrier))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        priority: carrier['x-datadog-sampling-priority'],
        resourceUnchanged: context.getTag('resource.name') === resource,
      }))
    }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const url = 'http://127.0.0.1:' + server.address().port + '/items/42'
    const { data } = await httpRequest.request(url, { method })
    return data
  }

  it('uses the method without changing the resource tag', async () => {
    assert.deepStrictEqual(await propagate(), { priority: '2', resourceUnchanged: true })
  })

  it('uses the same method as the exporter when the application changes req.method', async () => {
    const { DD_TRACE_OTEL_SEMANTICS_ENABLED: otel } = createConfig()
    const [propagated] = await Promise.all([
      propagate(req => {
        req.method = otel ? 'POST' : 'PATCH'
      }, otel ? 'PATCH' : 'POST'),
      agent.assertFirstTraceSpan({ resource: 'PATCH', metrics: { _sampling_priority_v1: 2 } }),
    ])
    assert.deepStrictEqual(propagated, { priority: '2', resourceUnchanged: true })
  })

  it('matches a rule configured after the request started', async () => {
    const config = createConfig({ sampleRate: 0, rateLimit: -1 })
    tracer._tracer.configure(config)

    const response = await propagate(() => {
      config.setRemoteConfig({ DD_TRACE_SAMPLING_RULES: '[{"resource":"GET","sample_rate":1}]' })
      tracer._tracer.configure(config)
    })
    assert.deepStrictEqual(response, { priority: '2', resourceUnchanged: true })
  })

  it('honors an explicitly tagged route', async () => {
    const [propagated] = await Promise.all([
      propagate((req, span) => span.setTag('http.route', '/items/:id'), 'POST'),
      agent.assertFirstTraceSpan({ resource: 'POST /items/:id', metrics: { _sampling_priority_v1: 2 } }),
    ])
    assert.deepStrictEqual(propagated, { priority: '2', resourceUnchanged: true })
  })

  it('preserves an explicit resource name', async () => {
    const [propagated] = await Promise.all([
      propagate((req, span) => span.setTag('resource.name', 'custom resource'), 'POST'),
      agent.assertFirstTraceSpan({ resource: 'custom resource', metrics: { _sampling_priority_v1: 2 } }),
    ])
    assert.deepStrictEqual(propagated, { priority: '2', resourceUnchanged: true })
  })
})
