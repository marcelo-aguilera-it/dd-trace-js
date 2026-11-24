'use strict'

const Plugin = require('../../dd-trace/src/plugins/plugin')
const { normalizeRouteSegment } = require('../../dd-trace/src/http-resource')
const web = require('../../dd-trace/src/plugins/util/web')

class FindMyWayPlugin extends Plugin {
  static id = 'find-my-way'

  constructor (...args) {
    super(...args)

    this.addSub('apm:find-my-way:request:route', ({ req, route }) => {
      web.setRoute(req, route, readSamplingRoute)
    })
  }
}

/**
 * @param {import('../../dd-trace/src/http-resource').HttpRequest} req
 * @param {string | undefined} displayedRoute
 * @param {import('../../dd-trace/src/http-resource').SamplingRouteHint} route
 */
function readSamplingRoute (req, displayedRoute, route) {
  const publishedRoute = /** @type {string} */ (route)
  if (publishedRoute === displayedRoute) {
    return displayedRoute
  }
  if (normalizeRouteSegment(publishedRoute) === displayedRoute &&
    !web.getContext(req)?.config?.DD_TRACE_OTEL_SEMANTICS_ENABLED) {
    return displayedRoute
  }
}

module.exports = FindMyWayPlugin
