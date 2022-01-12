const { getNs } = require('../../db/alerting')
const { nsToResp, assertEnabled } = require('./common')
const yaml = require('yaml')
const { CLokiNotFound } = require('../errors')

module.exports = (req, res) => {
  assertEnabled()
  const ns = getNs(req.params.ns)
  if (!ns) {
    throw CLokiNotFound('Namespace not found')
  }
  const result = nsToResp({ ...ns })
  res.header('Content-Type', 'yaml').send(yaml.stringify(result))
}
