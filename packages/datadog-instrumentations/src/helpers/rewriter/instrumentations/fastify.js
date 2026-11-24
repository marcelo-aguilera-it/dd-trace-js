'use strict'

const rewriteCall = 'VariableDeclarator[id.name="url"]'

module.exports = [{
  module: { name: 'fastify', versionRange: '>=3', filePath: 'fastify.js' },
  astQuery: 'BlockStatement > VariableDeclaration:has(' +
    rewriteCall + '[init.callee.name="rewriteUrl"], ' +
    rewriteCall + '[init.callee.object.name="rewriteUrl"][init.callee.property.name="call"])',
  transform: 'publishFastifyRewrite',
  channelName: 'rewriteUrl',
}]
