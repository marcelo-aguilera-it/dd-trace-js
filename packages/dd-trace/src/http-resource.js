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
 * @typedef {{
 *   req: { method: string },
 *   config: { DD_TRACE_OTEL_SEMANTICS_ENABLED?: boolean },
 *   samplingRoute: string | typeof UNROUTED_HTTP | undefined,
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
  const explicitRoute = typeof taggedRoute === 'string' && taggedRoute !== generatedRoute
  const route = explicitRoute ? taggedRoute : samplingRoute
  if (route === undefined || (route === UNROUTED_HTTP && paths.length !== 0)) return resource
  if (!explicitRoute && typeof route === 'string' && paths.join('') !== route) return resource

  const method = otel ? context.getTag(HTTP_METHOD) : undefined
  const template = typeof route === 'string' ? route : undefined
  return httpResourceName(typeof method === 'string' ? method : req.method, template, otel)
}

module.exports = { UNROUTED_HTTP, getSamplingResource, httpResourceName, trackSamplingContext, untrackSamplingContext }
