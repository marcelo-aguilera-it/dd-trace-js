'use strict'

const RouterPlugin = require('../../datadog-plugin-router/src')
const { joinRoute, normalizeRouteSegment } = require('../../dd-trace/src/http-resource')
const web = require('../../dd-trace/src/plugins/util/web')

class RestifyPlugin extends RouterPlugin {
  static id = 'restify'

  /**
   * @param {object} tracer
   * @param {import('../../dd-trace/src/config/config-base')} tracerConfig
   */
  constructor (tracer, tracerConfig) {
    super(tracer, tracerConfig, writeRestifyRoute)

    this.addSub('apm:restify:request:handle', ({ req }) => {
      this.setFramework(req, 'restify', this.config)
      web.setSamplingRoute(req, readSamplingRoute)
    })

    this.addSub('tracing:orchestrion:restify:routeMatch:start', ({ req, path }) => {
      const context = web.getContext(req)
      if (!context?.span || joinRoute(context.paths)) {
        return
      }
      const route = readRestifyRoute(req, path)
      if (route) {
        web.setRoute(req, route, readSamplingRoute)
      } else if (route !== undefined) {
        web.setSamplingRoute(req, readSamplingRoute, route)
      }
    })
  }

  configure (config) {
    return super.configure({
      ...config,
      middleware: false, // not supported
    })
  }
}

/**
 * @param {object} req
 * @param {string} route
 */
function writeRestifyRoute (req, route) {
  web.setRoute(req, route, route ? readSamplingRoute : undefined)
}

/**
 * @param {object} req
 * @param {string | RegExp | undefined} path
 */
function readRestifyRoute (req, path) {
  if (typeof path === 'string' || !path) {
    return normalizeRouteSegment(path)
  }
  if (!web.getContext(req)?.config?.DD_TRACE_OTEL_SEMANTICS_ENABLED) {
    return path.toString()
  }
}

/**
 * @param {{ route?: { path?: string | RegExp } }} req
 * @param {string | RegExp | undefined} displayedRoute
 * @param {import('../../dd-trace/src/http-resource').SamplingRouteHint} hint
 */
function readSamplingRoute (req, displayedRoute, hint) {
  if (displayedRoute) {
    return typeof displayedRoute === 'string' ? displayedRoute : (readRestifyRoute(req, displayedRoute) ?? '')
  }
  if (req.route) {
    return readRestifyRoute(req, req.route.path)
  }
  if (typeof hint === 'string') {
    return hint
  }
}

module.exports = RestifyPlugin
