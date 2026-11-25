'use strict'

const routerPrototype = 'AssignmentExpression[left.object.object.name="Router"][left.object.property.name="prototype"]'
const functionBody = ' > FunctionExpression > BlockStatement > '

module.exports = [{
  module: { name: 'find-my-way', versionRange: '>=1', filePath: 'index.js' },
  functionQuery: { index: null },
  astQuery: `${routerPrototype}[left.property.name="lookup"]${functionBody}:first-child, ` +
    `${routerPrototype}[left.property.name="_lookupCompiled"]${functionBody}` +
    'VariableDeclaration:has(VariableDeclarator[id.name="derivedConstraints"])',
  transform: 'publishRoutingStart',
  channelName: 'lookup',
}]
