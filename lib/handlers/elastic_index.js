
/* Elastic Indexing Handler
    Accepts JSON formatted requests when the header Content-Type: application/json is sent.

	POST /<target>/_doc/
	PUT /<target>/_doc/<_id>
	PUT /<target>/_create/<_id>
	POST /<target>/_create/<_id>

*/

const stringify = require('../utils').stringify

function handler (req, res) {
  const self = this
  req.log.debug('ELASTIC Index Request')
  if (!req.body || !req.params.target) {
    req.log.error('No Request Body or Target!')
    res.code(400).send('{"status":400, "error": { "reason": "No Request Body" } }')
    return
  }
  if (this.readonly) {
    req.log.error('Readonly! No push support.')
    res.code(400).send('{"status":400, "error": { "reason": "Read Only Mode" } }')
    return
  }

  const doc_target = req.params.target || false;
  const doc_id = req.params.id || false;

  let streams
  if (
    req.headers['content-type'] &&
                req.headers['content-type'].indexOf('application/json') > -1
  ) {
    // json body, handle as sinle node array
    streams = [req.body]
  } else {
    // raw body, handle as ndjson
    streams = req.body.split(/\n/)
  }
  req.log.info({ streams }, 'streams')
  if (streams) {
    streams.forEach(function (stream) {
      req.log.debug({ stream }, 'ingesting elastic doc')
      let finger = null
      let JSONLabels = {}
      try {
        try {
          JSONLabels.type = 'elastic'
          if (doc_target) JSONLabels._index = doc_target
          if (doc_id) JSONLabels._id = doc_id
          JSONLabels = Object.fromEntries(Object.entries(JSONLabels).sort())
        } catch (err) {
          req.log.error({ err })
          return
        }
        // Calculate Fingerprint
        const strJson = stringify(JSONLabels)
        finger = self.fingerPrint(strJson)
        // Store Fingerprint
        self.bulk_labels.add([[
          new Date().toISOString().split('T')[0],
          finger,
          strJson,
          JSONLabels.target || ''
        ]])
        for (const key in JSONLabels) {
          req.log.debug({ key, data: JSONLabels[key] }, 'Storing label')
          self.labels.add('_LABELS_', key)
          self.labels.add(key, JSONLabels[key])
        }
      } catch (err) {
        req.log.error({ err }, 'failed ingesting elastic doc')
      }

      try {
        stream = JSON.parse(stream);
      } catch (err) { req.log.error({ err }); return };
      // Store Elastic Doc Object
      const values = [
        finger,
        BigInt((new Date().getTime() * 1000) + '000'),
        null,
        JSON.stringify(stream) || stream
      ]
      req.log.debug({ finger, values }, 'store')
      self.bulk.add([values])
    })
  }
  res.code(200).send('{"took":0, "errors": false }')
}

module.exports = handler
