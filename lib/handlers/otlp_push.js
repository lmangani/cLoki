/* Zipkin Push Handler
    Accepts JSON formatted requests when the header Content-Type: application/json is sent.
    Example of the Zipkin span JSON format:
    [{
	 "id": "1234",
	 "traceId": "0123456789abcdef",
	 "timestamp": 1608239395286533,
	 "duration": 100000,
	 "name": "span from bash!",
	 "tags": {
		"http.method": "GET",
		"http.path": "/api"
	  },
	  "localEndpoint": {
		"serviceName": "shell script"
	  }
	}]
*/

const { asyncLogError } = require('../../common')
const { pushOTLP } = require('../db/clickhouse')
const { readonly } = require('../../common')

async function handler (req, res) {
  req.log.debug('POST /tempo/api/push')
  if (!req.body) {
    asyncLogError('No Request Body!', req.log)
    return res.code(500).send()
  }
  if (readonly) {
    asyncLogError('Readonly! No push support.', req.log)
    return res.code(500).send()
  }
  const streams = req.body
  const spans = []
  for (const res of streams.resourceSpans) {
    const resAttrs = res.resource && res.resource.attributes ? res.resource.attributes : []
    for (const scope of res.scopeSpans) {
      scope.spans = scope.spans.map(span => ({
        ...span,
        attributes: [
          ...(span.attributes ? span.attributes: []),
          ...resAttrs
        ]
      }))
      spans.push.apply(spans, scope.spans)
    }
  }
  await pushOTLP(spans)
  return res.code(200).send('OK')
}

module.exports = handler
