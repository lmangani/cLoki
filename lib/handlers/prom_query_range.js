/* Emulated PromQL Query Handler */
/*
  Converts PromQL to LogQL queries, accepts the following parameters in the query-string:
  query: a PromQL query
  limit: max number of entries to return
  start: the start time for the query, as a nanosecond Unix epoch (nanoseconds since 1970)
  end: the end time for the query, as a nanosecond Unix epoch (nanoseconds since 1970)
  direction: forward or backward, useful when specifying a limit
  regexp: a regex to filter the returned results, will eventually be rolled into the query language
*/

const { rangeQuery } = require('../../promql/index')

async function handler (req, res) {
  req.log.debug('GET /api/v1/query_range')
  const startMs = parseInt(req.query.start) * 1000 || Date.now() - 60000
  const endMs = parseInt(req.query.end) * 1000 || Date.now()
  const stepMs = parseInt(req.query.step) * 1000 || 15000
  const query = req.query.query
  try {
    const result = await rangeQuery(query, startMs, endMs, stepMs)
    return res.code(200).send(result)
  } catch (err) {
    return res.code(500).send(JSON.stringify({ status: 'error', error: err.message }))
  }
}

module.exports = handler
