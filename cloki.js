#!/usr/bin/env node

/*
 * Loki API to Clickhouse Gateway
 * (C) 2018-2021 QXIP BV
 */

this.debug = process.env.DEBUG || false
// const debug = this.debug

this.readonly = process.env.READONLY || false
this.http_user = process.env.CLOKI_LOGIN || false
this.http_password = process.env.CLOKI_PASSWORD || false

require('./plugins/engine')

const DATABASE = require('./lib/db/clickhouse')
const UTILS = require('./lib/utils')

/* ProtoBuf Helper */
const fs = require('fs')
const protoBuff = require('protocol-buffers')
const { startAlerting, stop } = require('./lib/db/alerting')
const messages = protoBuff(fs.readFileSync('lib/loki.proto'))
const yaml = require('yaml')

/* Fingerprinting */
this.fingerPrint = UTILS.fingerPrint
this.toJSON = UTILS.toJSON

/* Database this.bulk Helpers */
this.bulk = DATABASE.cache.bulk // samples
this.bulk_labels = DATABASE.cache.bulk_labels // labels
this.labels = DATABASE.cache.labels // in-memory labels

/* Function Helpers */
this.labelParser = UTILS.labelParser

const init = DATABASE.init
this.reloadFingerprints = DATABASE.reloadFingerprints
this.scanFingerprints = DATABASE.scanFingerprints
this.instantQueryScan = DATABASE.instantQueryScan
this.tempoQueryScan = DATABASE.tempoQueryScan
this.scanMetricFingerprints = DATABASE.scanMetricFingerprints
this.tempoQueryScan = DATABASE.tempoQueryScan
if (!this.readonly) init(process.env.CLICKHOUSE_DB || 'cloki')
this.scanClickhouse = DATABASE.scanClickhouse;
(async () => {
  if (!this.readonly) {
    await init(process.env.CLICKHOUSE_DB || 'cloki')
    await startAlerting()
  }
})().catch((err) => {
  console.log(err)
  process.exit(1)
})

/* Fastify Helper */
const fastify = require('fastify')({

  logger: false,
  bodyLimit: parseInt(process.env.FASTIFY_BODYLIMIT) || 5242880,
  requestTimeout: parseInt(process.env.FASTIFY_REQUESTTIMEOUT) || 0,
  maxRequestsPerSocket: parseInt(process.env.FASTIFY_MAXREQUESTS) || 0
})

fastify.register(require('fastify-url-data'))
fastify.register(require('fastify-websocket'))

fastify.after((err) => {
  if (err) throw err
})

/* Enable Simple Authentication */
if (this.http_user && this.http_password) {
  function checkAuth (username, password, req, reply, done) {
    if (username === this.http_user && password === this.http_password) {
      done()
    } else {
      done(new Error('Unauthorized!: Wrong username/password.'))
    }
  }
  const validate = checkAuth.bind(this)

  fastify.register(require('fastify-basic-auth'), {
    validate
  })
  fastify.after(() => {
    fastify.addHook('preHandler', fastify.basicAuth)
  })
}

fastify.addContentTypeParser('text/plain', {
  parseAs: 'string'
}, function (req, body, done) {
  try {
    const json = JSON.parse(body)
    done(null, json)
  } catch (err) {
    err.statusCode = 400
    done(err, undefined)
  }
})

fastify.addContentTypeParser('application/yaml', {
  parseAs: 'string'
}, function (req, body, done) {
  try {
    const json = yaml.parse(body)
    done(null, json)
  } catch (err) {
    err.statusCode = 400
    done(err, undefined)
  }
})

try {
  const snappy = require('snappyjs')
  /* Protobuf Handler */
  fastify.addContentTypeParser('application/x-protobuf', { parseAs: 'buffer' },
    async function (req, body, done) {
      let _data = await snappy.uncompress(body)
      _data = messages.PushRequest.decode(_data)
      _data.streams = _data.streams.map(s => ({
        ...s,
        entries: s.entries.map(e => {
          const millis = Math.floor(e.timestamp.nanos / 1000000)
          return {
            ...e,
            timestamp: e.timestamp.seconds * 1000 + millis
          }
        })
      }))
      return _data.streams
    })
} catch (e) {
  console.log(e)
  console.log('Protobuf ingesting is unsupported')
}

/* Null content-type handler for CH-MV HTTP PUSH */
fastify.addContentTypeParser('*', {
  parseAs: 'string'
}, function (req, body, done) {
  try {
    const json = JSON.parse(body)
    done(null, json)
  } catch (err) {
    err.statusCode = 400
    done(err, undefined)
  }
})

/* 404 Handler */
const handler404 = require('./lib/handlers/404.js').bind(this)
fastify.setNotFoundHandler(handler404)
fastify.setErrorHandler(require('./lib/handlers/errors').handler.bind(this))

/* Hello cloki test API */
const handlerHello = require('./lib/handlers/ready').bind(this)
fastify.get('/hello', handlerHello)
fastify.get('/ready', handlerHello)

/* Write Handler */
const handlerPush = require('./lib/handlers/push.js').bind(this)
fastify.post('/loki/api/v1/push', handlerPush)

/* Tempo Write Handler */
this.tempo_tagtrace = process.env.TEMPO_TAGTRACE || false
const handlerTempoPush = require('./lib/handlers/tempo_push.js').bind(this)
fastify.post('/tempo/api/push', handlerTempoPush)
fastify.post('/api/v2/spans', handlerTempoPush)

/* Tempo Traces Query Handler */
this.tempo_span = process.env.TEMPO_SPAN || 24
const handlerTempoTraces = require('./lib/handlers/tempo_traces.js').bind(this)
fastify.get('/api/traces/:traceId', handlerTempoTraces)
fastify.get('/api/traces/:traceId/:json', handlerTempoTraces)

/* Tempo Tag Handlers */
const handlerTempoLabel = require('./lib/handlers/tags.js').bind(this)
fastify.get('/api/search/tags', handlerTempoLabel)

/* Tempo Tag Value Handler */
const handlerTempoLabelValues = require('./lib/handlers/tags_values.js').bind(this)
fastify.get('/api/search/tag/:name/values', handlerTempoLabelValues)

/* Telegraf HTTP Bulk handler */
const handlerTelegraf = require('./lib/handlers/telegraf.js').bind(this)
fastify.post('/telegraf', handlerTelegraf)

/* Query Handler */
const handlerQueryRange = require('./lib/handlers/query_range.js').bind(this)
fastify.get('/loki/api/v1/query_range', handlerQueryRange)

/* Label Handlers */
/* Label Value Handler via query (test) */
const handlerQuery = require('./lib/handlers/query.js').bind(this)
fastify.get('/loki/api/v1/query', handlerQuery)

/* Label Handlers */
const handlerLabel = require('./lib/handlers/label.js').bind(this)
fastify.get('/loki/api/v1/label', handlerLabel)
fastify.get('/loki/api/v1/labels', handlerLabel)

/* Label Value Handler */
const handlerLabelValues = require('./lib/handlers/label_values.js').bind(this)
fastify.get('/loki/api/v1/label/:name/values', handlerLabelValues)

/* Series Placeholder - we do not track this as of yet */
const handlerSeries = require('./lib/handlers/series.js').bind(this)
fastify.get('/loki/api/v1/series', handlerSeries)

fastify.get('/loki/api/v1/tail', { websocket: true }, require('./lib/handlers/tail').bind(this))

// ALERT MANAGER

fastify.get('/api/prom/rules', require('./lib/handlers/alerts/get_rules').bind(this))
fastify.get('/api/prom/rules/:ns/:group', require('./lib/handlers/alerts/get_group').bind(this))
fastify.post('/api/prom/rules/:ns', require('./lib/handlers/alerts/post_group').bind(this))
fastify.delete('/api/prom/rules/:ns/:group', require('./lib/handlers/alerts/del_group').bind(this))
fastify.delete('/api/prom/rules/:ns', require('./lib/handlers/alerts/del_ns').bind(this))
fastify.get('/prometheus/api/v1/rules', require('./lib/handlers/alerts/prom_get_rules').bind(this))

// Run API Service
fastify.listen(
  process.env.PORT || 3100,
  process.env.HOST || '0.0.0.0',
  (err, address) => {
    if (err) throw err
    console.log('cLoki API up')
    fastify.log.info(`cloki API listening on ${address}`)
  }
)

module.exports.stop = () => {
  fastify.close()
  DATABASE.stop()
  require('./parser/transpiler').stop()
  stop()
}
