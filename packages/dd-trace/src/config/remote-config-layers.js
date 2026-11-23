'use strict'

/**
 * @typedef {ReturnType<import('./index')>} Config
 * @typedef {'APM_TRACING' | 'APM_PROFILING'} Product
 * @typedef {Partial<Record<import('./helper').SupportedEnvKey, string>>} Settings
 */

/** @type {WeakMap<Config, Record<Product, Settings | null>>} */
const layersByConfig = new WeakMap()

/**
 * Replace a product's settings and apply the settings of every active product. For a setting
 * both products supply, APM_PROFILING takes precedence over the broader APM_TRACING by supplying
 * canonical keys. Alias resolution in Config gives those keys priority regardless of update order.
 *
 * @param {Config} config
 * @param {Product} product
 * @param {Settings | null} settings
 */
module.exports = function applyRemoteConfig (config, product, settings) {
  let layers = layersByConfig.get(config)
  if (layers === undefined) {
    layers = { APM_TRACING: null, APM_PROFILING: null }
    layersByConfig.set(config, layers)
  }
  layers[product] = settings

  const { APM_TRACING: tracing, APM_PROFILING: profiling } = layers
  if (tracing === null || profiling === null) {
    config.setRemoteConfig(tracing ?? profiling)
    return
  }
  config.setRemoteConfig({ ...tracing, ...profiling })
}
