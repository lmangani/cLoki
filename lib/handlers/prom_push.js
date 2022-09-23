/* Prometheus Remote Write Handler for Qryn */
/*

   Accepts Prometheus WriteRequest Protobuf events

   { "timeseries":[
      {
        "labels":[{"name":"test","response_code":"200"}],
        "samples":[{"value":7.1,"timestamp":"1641758471000"}]
     }]
   }

*/
const stringify = require('../utils').stringify

async function handler (req, res) {
  const self = this
  req.log.debug('POST /api/v1/prom/remote/write')
  if (!req.body) {
    req.log.error('No Request Body!')
    res.code(500).send()
    return
  }
  if (this.readonly) {
    req.log.error('Readonly! No push support.')
    res.code(500).send()
    return
  }
  let streams
  if (req.headers['content-type'] && req.headers['content-type'].indexOf('application/x-protobuf') > -1) {
    streams = req.body.timeseries
  }
  const promises = []
  if (streams) {
    streams.forEach(function (stream) {
      let JSONLabels
      let finger = null
      try {
        try {
          JSONLabels = stream.labels.reduce((sum, l) => {
            sum[l.name] = l.value
            return sum
          }, {})
        } catch (err) {
          req.log.error({ err })
          return
        }
        // Calculate Fingerprint
        const strJson = stringify(JSONLabels)
        finger = self.fingerPrint(strJson)
        req.log.debug({ labels: stream.labels, finger }, 'LABELS FINGERPRINT')
        self.labels.add(finger.toString(), stream.labels)
        // Store Fingerprint
        promises.push(self.bulk_labels.add([[
          new Date().toISOString().split('T')[0],
          finger,
          strJson,
          JSONLabels['__name__'] || 'undefined'
        ]]))
        for (const key in JSONLabels) {
          self.labels.add('_LABELS_', key)
          self.labels.add(key, JSONLabels[key])
        }
      } catch (err) {
        req.log.error({ err })
      }

      if (stream.samples) {
        stream.samples.forEach(function (entry) {
          req.log.debug({ entry, finger }, 'BULK ROW')
          if (
            !entry &&
            !entry.timestamp &&
            !entry.value
          ) {
            req.log.error({ entry }, 'no bulkable data')
            return
          }
          const values = [
            finger,
            BigInt(entry.timestamp),
            entry.value,
            JSONLabels['__name__'] || 'undefined'
          ]
          promises.push(self.bulk.add([values]))
        })
      }
    })
  }
  await Promise.all(promises)
  res.code(204).send()
}

module.exports = handler
