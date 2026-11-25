'use strict'

const { HTTP_METHOD, HTTP_ROUTE, RESOURCE_NAME } = require('../../../ext/tags')
const {
  INSTRUMENTATION_HTTP_RESOURCE,
  isInstrumentationOwnedResource,
  otelHttpResourceName,
} = require('./plugins/util/http-otel-semantics')

const UNROUTED_HTTP = Symbol('unrouted HTTP')

/** @type {WeakMap<DatadogSpanContext, WeakRef<HttpResourceSource>>} */
const resourceSources = new WeakMap()

/**
 * @typedef {import('./opentracing/span_context')} DatadogSpanContext
 * @typedef {{ method: string }} HttpRequest
 * @typedef {string | object | undefined} SamplingRouteHint
 * @typedef {(req: HttpRequest, displayedRoute: string | undefined, hint: SamplingRouteHint) =>
 *   string | false | undefined} SamplingRouteReader
 * @typedef {string | false | SamplingRouteReader} SamplingRoute
 * @typedef {{
 *   req: HttpRequest,
 *   config: { DD_TRACE_OTEL_SEMANTICS_ENABLED?: boolean },
 *   samplingRoute: SamplingRoute | typeof UNROUTED_HTTP | undefined,
 *   samplingRouteHint?: SamplingRouteHint,
 *   generatedRoute?: string,
 *   paths: string[],
 * }} HttpResourceSource
 */

/**
 * @param {string} method
 * @param {string} [route]
 * @param {boolean} [otel]
 */
function httpResourceName (method, route, otel) {
  if (otel) return otelHttpResourceName(method, route)
  return route ? method + ' ' + route : method
}

/** @param {string[]} paths */
function joinRoute (paths) {
  return paths.length > 1 ? paths.join('') : paths[0]
}

/**
 * @param {DatadogSpanContext} context
 * @param {HttpResourceSource} requestContext
 */
function trackSamplingContext (context, requestContext) {
  resourceSources.set(context, new WeakRef(requestContext))
}

/** @param {DatadogSpanContext} context */
function untrackSamplingContext (context) {
  resourceSources.delete(context)
}

/** @param {DatadogSpanContext} context */
function getSamplingResource (context) {
  const resource = context.getTag(RESOURCE_NAME)
  const source = resourceSources.get(context)?.deref()
  if (!source) return resource

  const { req, config, samplingRoute, generatedRoute, paths } = source
  const otel = config.DD_TRACE_OTEL_SEMANTICS_ENABLED
  if (resource && (!otel || !isInstrumentationOwnedResource(resource, context.getTag(INSTRUMENTATION_HTTP_RESOURCE)))) {
    return resource
  }

  const taggedRoute = context.getTag(HTTP_ROUTE)
  let template
  if (typeof taggedRoute === 'string' && taggedRoute !== generatedRoute) {
    template = taggedRoute
  } else if (samplingRoute === UNROUTED_HTTP) {
    if (paths.length !== 0) return resource
    template = ''
  } else if (typeof samplingRoute === 'function') {
    template = samplingRoute(req, joinRoute(paths), source.samplingRouteHint)
  } else {
    template = samplingRoute
  }

  if (template === undefined) return resource
  if (template === false) return taggedRoute === undefined && !joinRoute(paths) ? resource : undefined

  const method = otel ? context.getTag(HTTP_METHOD) : undefined
  return httpResourceName(typeof method === 'string' ? method : req.method, template, otel)
}

module.exports = {
  UNROUTED_HTTP,
  getSamplingResource,
  httpResourceName,
  joinRoute,
  trackSamplingContext,
  untrackSamplingContext,
}
