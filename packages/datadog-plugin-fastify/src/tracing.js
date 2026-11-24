'use strict'

const RouterPlugin = require('../../datadog-plugin-router/src')
const web = require('../../dd-trace/src/plugins/util/web')
const { storage } = require('../../datadog-core')

class FastifyTracingPlugin extends RouterPlugin {
  static id = 'fastify'

  constructor (...args) {
    super(...args)

    this.addSub('apm:fastify:request:handle', ({ req }) => {
      this.setFramework(req, 'fastify', this.config)
    })

    this.addSub('tracing:orchestrion:fastify:rewriteUrl:start', req => {
      web.setSamplingRoute(req)
    })

    this.addBind('datadog:fastify:pre-parsing:start', getParentStore)
    this.addBind('datadog:fastify:pre-validation:start', getParentStore)

    this.addSub('datadog:fastify:pre-parsing:finish', (ctx) => {
      return ctx.parentStore
    })
    this.addSub('datadog:fastify:pre-validation:finish', (ctx) => {
      return ctx.parentStore
    })
    this.addSub('datadog:fastify:callback:execute', getParentStore)
  }
}

function getParentStore (ctx) {
  ctx.parentStore ??= storage('legacy').getStore()
  return ctx.parentStore
}

module.exports = FastifyTracingPlugin
