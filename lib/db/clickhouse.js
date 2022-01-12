/*
 * cLoki DB Adapter for Clickhouse
 * (C) 2018-2022 QXIP BV
 */

const debug = process.env.DEBUG || false
const UTILS = require('../utils')
const toJSON = UTILS.toJSON

/* DB Helper */
const ClickHouse = require('@apla/clickhouse')
const clickhouseOptions = {
  host: process.env.CLICKHOUSE_SERVER || 'localhost',
  port: process.env.CLICKHOUSE_PORT || 8123,
  auth: process.env.CLICKHOUSE_AUTH || 'default:',
  protocol: process.env.CLICKHOUSE_PROTO ? process.env.CLICKHOUSE_PROTO + ':' : 'http:',
  readonly: !!process.env.READONLY,
  queryOptions: { database: process.env.CLICKHOUSE_DB || 'cloki' }
}
// clickhouseOptions.queryOptions.database = process.env.CLICKHOUSE_DB || 'cloki';

const transpiler = require('../../parser/transpiler')
const rotationLabels = process.env.LABELS_DAYS || 7
const rotationSamples = process.env.SAMPLES_DAYS || 7
const axios = require('axios')
const { samplesTableName, samplesReadTableName } = UTILS

const protocol = process.env.CLICKHOUSE_PROTO || 'http'

// External Storage Policy for Tables (S3, MINIO)
const storagePolicy = process.env.STORAGE_POLICY || false

const { StringStream, DataStream } = require('scramjet')

const { parseLabels, hashLabels } = require('../../common')

const capabilities = {}
let state = 'INITIALIZING'

const clickhouse = new ClickHouse(clickhouseOptions)
let ch

class TimeoutThrottler {
  constructor (statement) {
    this.statement = statement
    this.on = false
    this.queue = []
  }

  start () {
    if (this.on) {
      return
    }
    this.on = true
    const self = this
    setTimeout(async () => {
      while (self.on) {
        const ts = Date.now()
        try {
          await self.flush()
        } catch (e) {
          if (e.response) {
            console.log('AXIOS ERROR')
            console.log(e.message)
            console.log(e.response.status)
            console.log(e.response.data)
          } else {
            console.log(e)
          }
        }
        const p = Date.now() - ts
        if (p < 100) {
          await new Promise((resolve) => setTimeout(resolve, 100 - p))
        }
      }
    })
  }

  async flush () {
    const len = this.queue.length
    if (len < 1) {
      return
    }

    await axios.post(`${getClickhouseUrl()}/?query=${this.statement}`,
      this.queue.join('\n')
    )
    this.queue = this.queue.slice(len)
  }

  stop () {
    this.on = false
  }
}

const samplesThrottler = new TimeoutThrottler(
    `INSERT INTO ${clickhouseOptions.queryOptions.database}.${samplesTableName}(fingerprint, timestamp_ms, value, string) FORMAT JSONEachRow`)
const timeSeriesThrottler = new TimeoutThrottler(
    `INSERT INTO ${clickhouseOptions.queryOptions.database}.time_series(date, fingerprint, labels, name) FORMAT JSONEachRow`)
/* TODO: tsv2
const timeSeriesv2Throttler = new TimeoutThrottler(
  `INSERT INTO ${clickhouseOptions.queryOptions.database}.time_series_v2(date, fingerprint, labels, name) FORMAT JSONEachRow`); */
samplesThrottler.start()
timeSeriesThrottler.start()
// timeSeriesv2Throttler.start();

/* Cache Helper */
const recordCache = require('record-cache')
const { parseMs } = require('../utils')
const onStale = function (data) {
  for (const entry of data.records.entries()) {
    const value = entry[1]
    samplesThrottler.queue.push.apply(samplesThrottler.queue, value.list.map(r => JSON.stringify({
      fingerprint: r.record[0],
      timestamp_ms: r.record[1],
      value: r.record[2],
      string: r.record[3]
    })))
  }
}
const onStaleLabels = function (data) {
  for (const entry of data.records.entries()) {
    const value = entry[1]
    timeSeriesThrottler.queue.push.apply(timeSeriesThrottler.queue, value.list.map(r => JSON.stringify({
      date: r.record[0],
      fingerprint: r.record[1],
      labels: r.record[2],
      name: r.record[3]
    })))
    /* TODO: tsv2
    timeSeriesv2Throttler.queue.push.apply(timeSeriesv2Throttler.queue, value.list.map(r => JSON.stringify({
      date: r.record[0],
      fingerprint: r.record[1],
      labels: JSON.parse(r.record[2]),
      name: r.record[3]
    })));
    */
  }
}

// Flushing to Clickhouse
const bulk = recordCache({
  maxSize: process.env.BULK_MAXSIZE || 5000,
  maxAge: process.env.BULK_MAXAGE || 2000,
  onStale: onStale
})

const bulkLabels = recordCache({
  maxSize: 100,
  maxAge: 500,
  onStale: onStaleLabels
})

// In-Memory LRU for quick lookups
const labels = recordCache({
  maxSize: process.env.BULK_MAXCACHE || 50000,
  maxAge: 0,
  onStale: false
})

/* Initialize */
const initialize = function (dbName) {
  console.log('Initializing DB...', dbName)
  const dbQuery = 'CREATE DATABASE IF NOT EXISTS ' + dbName
  const tmp = { ...clickhouseOptions, queryOptions: { database: '' } }
  ch = new ClickHouse(tmp)

  const hackCh = (ch) => {
    ch._query = ch.query
    ch.query = (q, opts, cb) => {
      return new Promise(resolve => ch._query(q, opts, (err, data) => {
        cb(err, data)
        resolve()
      }))
    }
  }
  return new Promise((resolve, reject) => {
    ch.query(dbQuery, undefined, async function (err/*, data */) {
      if (err) {
        console.error('error', err)
        reject(err)
        return
      }
      const ch = new ClickHouse(clickhouseOptions)
      hackCh(ch)
      console.log('CREATE TABLES', dbName)

      let tsTable = 'CREATE TABLE IF NOT EXISTS ' + dbName + '.time_series (date Date,fingerprint UInt64,labels String, name String) ENGINE = ReplacingMergeTree(date) PARTITION BY date ORDER BY fingerprint'
      let smTable = 'CREATE TABLE IF NOT EXISTS ' + dbName + `.${samplesTableName} (fingerprint UInt64,timestamp_ms Int64,value Float64,string String) ENGINE = MergeTree PARTITION BY toRelativeHourNum(toDateTime(timestamp_ms / 1000)) ORDER BY (timestamp_ms)`
      const readTable = 'CREATE TABLE IF NOT EXISTS ' + dbName + `.${samplesReadTableName} (fingerprint UInt64,timestamp_ms Int64,value Float64,string String) ENGINE=Merge(\'${dbName}\', \'(samples|samples_v[0-9]+)\')`
      const settingsTable = 'CREATE TABLE IF NOT EXISTS ' + dbName + '.settings (fingerprint UInt64, type String, name String, value String, inserted_at DateTime64(9, \'UTC\')) ENGINE = ReplacingMergeTree(inserted_at) ORDER BY fingerprint'

      if (storagePolicy) {
        console.log('ADD SETTINGS storage policy', storagePolicy)
        const setStorage = ` SETTINGS storagePolicy='${storagePolicy}'`
        tsTable += setStorage
        smTable += setStorage
      }

      await ch.query(tsTable, undefined, function (err/*, data */) {
        if (err) {
          console.log(err)
          process.exit(1)
        } else if (debug) console.log('Timeseries Table ready!')
        return true
      })
      await ch.query(smTable, undefined, function (err/*, data */) {
        if (err) {
          console.log(err)
          process.exit(1)
        } else if (debug) console.log('Samples Table ready!')
        return true
      })
      await ch.query(readTable, undefined, function (err) {
        if (err) {
          console.log(err)
          process.exit(1)
        } else if (debug) console.log('Samples Table ready!')
        return true
      })
      await ch.query(settingsTable, undefined, function (err) {
        if (err) {
          console.log(err)
          process.exit(1)
        } else if (debug) console.log('Samples Table ready!')
        return true
      })

      if (rotationSamples > 0) {
        const alterTable = 'ALTER TABLE ' + dbName + `.${samplesTableName} MODIFY SETTING ttl_only_drop_parts = 1, merge_with_ttl_timeout = 3600, index_granularity = 8192`
        const rotateTable = 'ALTER TABLE ' + dbName + `.${samplesTableName} MODIFY TTL toDateTime(timestamp_ms / 1000)  + INTERVAL ` + rotationSamples + ' DAY'
        await ch.query(alterTable, undefined, function (err/*, data */) {
          if (err) { console.log(err) } else if (debug) console.log('Samples Table altered for rotation!')
          // return true;
        })
        await ch.query(rotateTable, undefined, function (err/*, data */) {
          if (err) { console.log(err) } else if (debug) console.log('Samples Table rotation set to days: ' + rotationSamples)
          return true
        })
      }

      if (rotationLabels > 0) {
        const alterTable = 'ALTER TABLE ' + dbName + '.time_series MODIFY SETTING ttl_only_drop_parts = 1, merge_with_ttl_timeout = 3600, index_granularity = 8192'
        const rotateTable = 'ALTER TABLE ' + dbName + '.time_series MODIFY TTL date  + INTERVAL ' + rotationLabels + ' DAY'
        await ch.query(alterTable, undefined, function (err/*, data */) {
          if (err) { console.log(err) } else if (debug) console.log('Labels Table altered for rotation!')
          return true
        })
        await ch.query(rotateTable, undefined, function (err/*, data */) {
          if (err) { console.log(err) } else if (debug) console.log('Labels Table rotation set to days: ' + rotationLabels)
          return true
        })
      }

      if (storagePolicy) {
        console.log('ALTER storage policy', storagePolicy)
        const alterTs = `ALTER TABLE ${dbName}.time_series MODIFY SETTING storagePolicy='${storagePolicy}'`
        const alterSm = `ALTER TABLE ${dbName}.${samplesTableName} MODIFY SETTING storagePolicy='${storagePolicy}'`

        await ch.query(alterTs, undefined, function (err/*, data */) {
          if (err) { console.log(err) } else if (debug) console.log('Storage policy update for fingerprints ' + storagePolicy)
          return true
        })
        await ch.query(alterSm, undefined, function (err/*, data */) {
          if (err) { console.log(err) } else if (debug) console.log('Storage policy update for samples ' + storagePolicy)
          return true
        })
      }

      await checkCapabilities()

      state = 'READY'

      /* TODO: tsv2
      const tsv2 = await axios.get(`${protocol}://${clickhouseOptions.auth}@${clickhouseOptions.host}:${clickhouseOptions.port}/?query=SHOW TABLES FROM ${dbName} LIKE 'time_series_v2' FORMAT JSON`);
      if (!tsv2.data.rows) {
        const create_tsv2 = `CREATE TABLE IF NOT EXISTS ${dbName}.time_series_v2
          (
              date Date,
              fingerprint UInt64,
            labels Array(Tuple(String, String)),
              labels_map Map(String, String),
              name String
            ) ENGINE = ReplacingMergeTree(date) PARTITION BY date ORDER BY fingerprint`;
        await ch.query(create_tsv2, undefined, () => {});
        const insert = `INSERT INTO ${dbName}.time_series_v2 (date, fingerprint, labels, labels_map, name)
          SELECT date, fingerprint, JSONExtractKeysAndValues(labels, 'String') as labels,
            CAST((
              arrayMap(x -> x.1, JSONExtractKeysAndValues(labels, 'String')),
              arrayMap(x -> x.2, JSONExtractKeysAndValues(labels, 'String'))), 'Map(String, String)') as labels_map,
              name FROM ${dbName}.time_series`;
        await axios.post(`${protocol}://${clickhouseOptions.auth}@${clickhouseOptions.host}:${clickhouseOptions.port}/`,
          insert);
      } */

      reloadFingerprints()
      resolve()
    })
  })
}

const checkCapabilities = async () => {
  console.log('Checking clickhouse capabilities: ')
  try {
    await axios.post(getClickhouseUrl() + '/?allow_experimental_live_view=1',
      `CREATE LIVE VIEW ${clickhouseOptions.queryOptions.database}.lvcheck WITH TIMEOUT 1 AS SELECT 1`)
    capabilities.liveView = true
    console.log('LIVE VIEW: supported')
  } catch (e) {
    console.log('LIVE VIEW: unsupported')
    capabilities.liveView = false
  }
}

const reloadFingerprints = function () {
  console.log('Reloading Fingerprints...')
  const selectQuery = `SELECT DISTINCT fingerprint, labels FROM ${clickhouseOptions.queryOptions.database}.time_series`
  const stream = ch.query(selectQuery)
  // or collect records yourself
  const rows = []
  stream.on('metadata', function (columns) {
    // do something with column list
  })
  stream.on('data', function (row) {
    rows.push(row)
  })
  stream.on('error', function (err) {
    console.log(err)
  })
  stream.on('end', function () {
    rows.forEach(function (row) {
      try {
        const JSONLabels = toJSON(row[1].replace(/\!?=/g, ':'))
        labels.add(row[0], JSON.stringify(JSONLabels))
        for (const key in JSONLabels) {
          // if (debug) console.log('Adding key',row);
          labels.add('_LABELS_', key)
          labels.add(key, JSONLabels[key])
        }
      } catch (e) { console.error(e) }
    })
    if (debug) console.log('Reloaded fingerprints:', rows.length + 1)
  })
}

const fakeStats = { summary: { bytesProcessedPerSecond: 0, linesProcessedPerSecond: 0, totalBytesProcessed: 0, totalLinesProcessed: 0, execTime: 0.001301608 }, store: { totalChunksRef: 0, totalChunksDownloaded: 0, chunksDownloadTime: 0, headChunkBytes: 0, headChunkLines: 0, decompressedBytes: 0, decompressedLines: 0, compressedBytes: 0, totalDuplicates: 0 }, ingester: { totalReached: 1, totalChunksMatched: 0, totalBatches: 0, totalLinesSent: 0, headChunkBytes: 0, headChunkLines: 0, decompressedBytes: 0, decompressedLines: 0, compressedBytes: 0, totalDuplicates: 0 } }

const scanFingerprints = async function (query, res) {
  if (debug) console.log('Scanning Fingerprints...')
  const _query = transpiler.transpile(query)
  _query.step = UTILS.parseOrDefault(query.step, 5) * 1000
  return queryFingerprintsScan(_query, res)
}

const instantQueryScan = async function (query, res) {
  if (debug) console.log('Scanning Fingerprints...')
  const time = parseMs(query.time, Date.now())
  query.start = (time - 10 * 60 * 1000) * 1000000
  query.end = Date.now() * 1000000
  const _query = transpiler.transpile(query)
  _query.step = UTILS.parseOrDefault(query.step, 5) * 1000

  const _stream = await axios.post(getClickhouseUrl() + '/',
    _query.query + ' FORMAT JSONEachRow',
    {
      responseType: 'stream'
    }
  )
  const dataStream = preprocessStream(_stream, _query.stream || [])
  return await (_query.matrix
    ? outputQueryVector(dataStream, res)
    : outputQueryStreams(dataStream, res))
}

const tempoQueryScan = async function (query, res, traceId) {
  if (debug) console.log('Scanning Tempo Fingerprints...',traceId)
  const time = parseMs(query.time, Date.now())
  /* Tempo does not seem to pass start/stop parameters. Use ENV or default 24h */
  var hours = this.tempo_span || 24;
  if (!query.start) query.start = (time - (hours * 60 * 60 * 1000)) * 1000000
  if (!query.end) query.end = Date.now() * 1000000
  const _query = transpiler.transpile(query)
  _query.step = UTILS.parseOrDefault(query.step, 5) * 1000

  const _stream = await axios.post(getClickhouseUrl() + '/',
    _query.query + ' FORMAT JSONEachRow',
    {
      responseType: 'stream'
    }
  )
  const dataStream = preprocessStream(_stream, _query.stream || [])
  console.log('debug tempo', query);
  return await (outputTempoSpans(dataStream, res, traceId))
}

function getClickhouseUrl () {
  return `${protocol}://${clickhouseOptions.auth}@${clickhouseOptions.host}:${clickhouseOptions.port}`
}

/**
 * @param query {
 * {query: string, duration: number, matrix: boolean, stream: (function(DataStream): DataStream)[], step: number}
 * }
 * @param res {{res: {write: (function(string)), writeHead: (function(number, {}))}}}
 * @returns {Promise<void>}
 */
const queryFingerprintsScan = async function (query, res) {
  if (debug) console.log('Scanning Fingerprints...')

  // console.log(_query.query);
  const _stream = await getClickhouseStream(query)
  const dataStream = preprocessStream(_stream, query.stream || [])
  return await (query.matrix
    ? outputQueryMatrix(dataStream, res, query.step, query.duration)
    : outputQueryStreams(dataStream, res))
}

/**
 *
 * @param query {{query: string}}
 * @returns {Promise<Stream>}
 */
const getClickhouseStream = (query) => {
  return axios.post(getClickhouseUrl() + '/',
    query.query + ' FORMAT JSONEachRow',
    {
      responseType: 'stream'
    }
  )
}

/**
 *
 * @param dataStream {DataStream}
 * @param res {{res: {write: (function(string)), writeHead: (function(number, {}))}}}
 * @returns {Promise<void>}
 */
const outputQueryStreams = async (dataStream, res) => {
  res.res.writeHead(200, { 'Content-Type': 'application/json' })
  const gen = dataStream.toGenerator()
  let i = 0
  let lastLabels = null
  let lastStream = []
  res.res.write('{"status":"success", "data":{ "resultType": "streams", "result": [')
  for await (const item of gen()) {
    if (!item) {
      continue
    }
    if (!item.labels) {
      if (!lastLabels || !lastStream.length) {
        continue
      }
      res.res.write(i ? ',' : '')
      res.res.write(JSON.stringify({
        stream: parseLabels(lastLabels),
        values: lastStream
      }))
      lastLabels = null
      lastStream = []
      ++i
      continue
    }
    const hash = hashLabels(item.labels)
    const ts = item.timestamp_ms ? parseInt(item.timestamp_ms) : null
    if (hash === lastLabels) {
      ts && lastStream.push([(ts * 1000000).toString(), item.string])
      continue
    }
    if (lastLabels) {
      res.res.write(i ? ',' : '')
      res.res.write(JSON.stringify({
        stream: parseLabels(lastLabels),
        values: lastStream
      }))
      ++i
    }
    lastLabels = hash
    lastStream = ts ? [[(ts * 1000000).toString(), item.string]] : []
  }
  res.res.write(']}}')
  res.res.end()
}

/**
 *
 * @param dataStream {DataStream}
 * @param res {{res: {write: (function(string)), writeHead: (function(number, {}))}}}
 * @param stepMs {number}
 * @param durationMs {number}
 * @returns {Promise<void>}
 */
const outputQueryMatrix = async (dataStream, res,
  stepMs, durationMs) => {
  res.res.writeHead(200, { 'Content-Type': 'application/json' })
  const addPoints = Math.ceil(durationMs / stepMs)
  const gen = dataStream.toGenerator()
  let i = 0
  let lastLabels = null
  let lastStream = []
  let lastTsMs = 0
  res.res.write('{"status":"success", "data":{ "resultType": "matrix", "result": [')
  for await (const item of gen()) {
    if (!item) {
      continue
    }
    if (!item.labels) {
      if (!lastLabels || !lastStream.length) {
        continue
      }
      res.res.write(i ? ',' : '')
      res.res.write(JSON.stringify({
        metric: parseLabels(lastLabels),
        values: lastStream
      }))
      lastLabels = null
      lastStream = []
      lastTsMs = 0
      ++i
      continue
    }
    const hash = hashLabels(item.labels)
    const ts = item.timestamp_ms ? parseInt(item.timestamp_ms) : null
    if (hash === lastLabels) {
      if (ts < (lastTsMs + stepMs)) {
        continue
      }
      for (let j = 0; j < addPoints; ++j) {
        ts && lastStream.push([(ts + stepMs * j) / 1000, item.value.toString()])
      }
      lastTsMs = ts
      continue
    }
    if (lastLabels) {
      res.res.write(i ? ',' : '')
      res.res.write(JSON.stringify({
        metric: parseLabels(lastLabels),
        values: lastStream
      }))
      ++i
    }
    lastLabels = hash
    lastStream = []
    for (let j = 0; j < addPoints; ++j) {
      ts && lastStream.push([(ts + stepMs * j) / 1000, item.value.toString()])
    }
    lastTsMs = ts
  }
  res.res.write(']}}')
  res.res.end()
}

/**
 *
 * @param dataStream {DataStream}
 * @param res {{res: {write: (function(string)), writeHead: (function(number, {}))}}}
 * @returns {Promise<void>}
 */
const outputQueryVector = async (dataStream, res) => {
  res.res.writeHead(200, { 'Content-Type': 'application/json' })
  const gen = dataStream.toGenerator()
  let i = 0
  let lastLabels = null
  let lastTsMs = 0
  let lastValue = 0
  res.res.write('{"status":"success", "data":{ "resultType": "vector", "result": [')
  for await (const item of gen()) {
    if (!item) {
      continue
    }
    if (!item.labels) {
      if (!lastLabels || !lastTsMs) {
        continue
      }
      res.res.write(i ? ',' : '')
      res.res.write(JSON.stringify({
        metric: parseLabels(lastLabels),
        value: [lastTsMs / 1000, lastValue.toString()]
      }))
      lastLabels = null
      lastTsMs = 0
      ++i
      continue
    }
    const hash = hashLabels(item.labels)
    const ts = item.timestamp_ms ? parseInt(item.timestamp_ms) : null
    if (hash === lastLabels) {
      lastTsMs = ts
      lastValue = item.value
      continue
    }
    if (lastLabels) {
      res.res.write(i ? ',' : '')
      res.res.write(JSON.stringify({
        metric: parseLabels(lastLabels),
        value: [lastTsMs / 1000, lastValue.toString()]
      }))
      ++i
    }
    lastLabels = hash
    lastTsMs = ts
    lastValue = item.value
  }
  res.res.write(']}}')
  res.res.end()
}

/**
 *
 * @param dataStream {DataStream}
 * @param res {{res: {write: (function(string)), writeHead: (function(number, {}))}}}
 * @param traceId {String}
 * @returns {Promise<any>}
 */
const outputTempoSpans = async (dataStream, res, traceId) => {
  // res.res.writeHead(200, { 'Content-Type': 'application/json' })
  const gen = dataStream.toGenerator()
  let i = 0
  let lastLabels = null
  let lastStream = []
  let response = '{"total": 0, "limit": 0, "offset": 0, "errors": null, "processes" : { "p1": {} }, "data": [ { "traceID": "'+traceId+'", '
  response += '"spans":['
  for await (const item of gen()) {
    if (!item) {
      continue
    }
    if (!item.labels) {
      if (!lastLabels || !lastStream.length) {
        continue
      }
      response += (i ? ',' : '')
      response += JSON.stringify(lastStream[0]);
      /*
      res.res.write(JSON.stringify({
        traceID: lastLabels.traceId,
        spans: lastStream
      }))
      */
      lastLabels = null
      lastStream = []
      ++i
      continue
    }
    const hash = hashLabels(item.labels)
    const ts = item.timestamp_ms ? parseInt(item.timestamp_ms) : null
    if (hash === lastLabels) {
      ts && lastStream.push(JSON.parse(item.string))
      continue
    }
    if (lastLabels) {
      response += (i ? ',' : '')
      response += (JSON.stringify(lastStream[0]));
      /*
      res.res.write(JSON.stringify({
        traceID: lastLabels.traceId,
        spans: lastStream
      }))
      */
      ++i
    }
    lastLabels = hash
    lastStream = ts ? [JSON.parse(item.string)] : []
  }
  response += (']}]}')
  return response;
  //res.res.write(response);
  //res.res.end()
}

/**
 *
 * @param rawStream {any} Stream from axios response
 * @param processors {(function(DataStream): DataStream)[] | undefined}
 * @returns {DataStream}
 */
const preprocessStream = (rawStream, processors) => {
  let dStream = StringStream.from(rawStream.data).lines().endWith(JSON.stringify({ EOF: true }))
    .map(chunk => chunk ? JSON.parse(chunk) : ({}), DataStream)
    .map(chunk => {
      try {
        if (!chunk || !chunk.labels) {
          return chunk
        }
        const labels = chunk.extra_labels
          ? { ...parseLabels(chunk.labels), ...parseLabels(chunk.extra_labels) }
          : parseLabels(chunk.labels)
        return { ...chunk, labels: labels }
      } catch (e) {
        console.log(chunk)
        return chunk
      }
    }, DataStream)
  if (processors && processors.length) {
    processors.forEach(f => {
      dStream = f(dStream)
    })
  }
  return dStream
}

/* cLoki Metrics Column */
const scanMetricFingerprints = function (settings, client, params) {
  if (debug) console.log('Scanning Clickhouse...', settings)
  // populate matrix structure
  const resp = {
    status: 'success',
    data: {
      resultType: 'matrix',
      result: []
    }
  }
  // Check for required fields or return nothing!
  if (!settings || !settings.table || !settings.db || !settings.tag || !settings.metric) { client.send(resp); return }
  settings.interval = settings.interval ? parseInt(settings.interval) : 60
  if (!settings.timefield) settings.timefield = process.env.CLICKHOUSE_TIMEFIELD || 'record_datetime'

  const tags = settings.tag.split(',')
  let template = 'SELECT ' + tags.join(', ') + ', groupArray((toUnixTimestamp(timestamp_ms)*1000, toString(value))) AS groupArr FROM (SELECT '
  if (tags) {
    tags.forEach(function (tag) {
      tag = tag.trim()
      template += " visitParamExtractString(labels, '" + tag + "') as " + tag + ','
    })
  }
  // if(settings.interval > 0){
  template += ' toStartOfInterval(toDateTime(timestamp_ms/1000), INTERVAL ' + settings.interval + ' second) as timestamp_ms, value' +
  // } else {
  //  template += " timestampMs, value"
  // }

  // template += " timestampMs, value"
  ' FROM ' + settings.db + '.samples RIGHT JOIN ' + settings.db + '.time_series ON samples.fingerprint = time_series.fingerprint'
  if (params.start && params.end) {
    template += ' WHERE ' + settings.timefield + ' BETWEEN ' + parseInt(params.start / 1000000000) + ' AND ' + parseInt(params.end / 1000000000)
    // template += " WHERE "+settings.timefield+" BETWEEN "+parseInt(params.start/1000000) +" AND "+parseInt(params.end/1000000)
  }
  if (tags) {
    tags.forEach(function (tag) {
      tag = tag.trim()
      template += " AND (visitParamExtractString(labels, '" + tag + "') != '')"
    })
  }
  if (settings.where) {
    template += ' AND ' + settings.where
  }
  template += ' AND value > 0 ORDER BY timestamp_ms) GROUP BY ' + tags.join(', ')

  if (debug) console.log('CLICKHOUSE METRICS SEARCH QUERY', template)

  const stream = ch.query(template)
  // or collect records yourself
  const rows = []
  stream.on('metadata', function (columns) {
    // do something with column list
  })
  stream.on('data', function (row) {
    rows.push(row)
  })
  stream.on('error', function (err) {
    // TODO: handler error
    client.code(400).send(err)
  })
  stream.on('end', function () {
    if (debug) console.log('CLICKHOUSE RESPONSE:', rows)
    if (!rows || rows.length < 1) {
      resp.data.result = []
      resp.data.stats = fakeStats
    } else {
      try {
        rows.forEach(function (row) {
          const metrics = { metric: {}, values: [] }
          const tags = settings.tag.split(',')
          // bypass empty blocks
          if (row[row.length - 1].length < 1) return
          // iterate tags
          for (let i = 0; i < row.length - 1; i++) {
            metrics.metric[tags[i]] = row[i]
          }
          // iterate values
          row[row.length - 1].forEach(function (row) {
            if (row[1] === 0) return
            metrics.values.push([parseInt(row[0] / 1000), row[1].toString()])
          })
          resp.data.result.push(metrics)
        })
      } catch (e) { console.log(e) }
    }
    if (debug) console.log('CLOKI RESPONSE', JSON.stringify(resp))
    client.send(resp)
  })
}

/**
 * Clickhouse Metrics Column Query
 * @param settings {{
 *   db: string,
 *   table: string,
 *   interval: string | number,
 *   tag: string,
 *   metric: string
 * }}
 * @param client {{
 *   code: function(number): any,
 *   send: function(string): any
 * }}
 * @param params {{
 *   start: string | number,
 *   end: string | number,
 *   shift: number | undefined
 * }}
 */
const scanClickhouse = function (settings, client, params) {
  if (debug) console.log('Scanning Clickhouse...', settings)

  // populate matrix structure
  const resp = {
    status: 'success',
    data: {
      resultType: 'matrix',
      result: []
    }
  }

  // TODO: Replace this template with a proper parser!
  // Check for required fields or return nothing!
  if (!settings || !settings.table || !settings.db || !settings.tag || !settings.metric) { client.send(resp); return }
  settings.interval = settings.interval ? parseInt(settings.interval) : 60
  // Normalize timefield
  if (!settings.timefield) settings.timefield = process.env.TIMEFIELD || 'record_datetime'
  else if (settings.timefield === 'false') settings.timefield = false
  // Normalize Tags
  if (settings.tag.includes('|')) { settings.tag = settings.tag.split('|').join(',') }
  // Lets query!
  let template = 'SELECT ' + settings.tag + ', groupArray((t, c)) AS groupArr FROM ('
  // Check for timefield or Bypass timefield
  if (settings.timefield) {
    const shiftSec = params.shift ? params.shift / 1000 : 0
    const timeReq = params.shift
      ? `intDiv(toUInt32(${settings.timefield} - ${shiftSec}), ${settings.interval}) * ${settings.interval} + ${shiftSec}`
      : 'intDiv(toUInt32(' + settings.timefield + '), ' + settings.interval + ') * ' + settings.interval
    template += `SELECT (${timeReq}) * 1000 AS t, ` + settings.tag + ', ' + settings.metric + ' c '
  } else {
    template += 'SELECT toUnixTimestamp(now()) * 1000 AS t, ' + settings.tag + ', ' + settings.metric + ' c '
  }
  template += 'FROM ' + settings.db + '.' + settings.table
  // Check for timefield or standalone where conditions
  if (params.start && params.end && settings.timefield) {
    template += ' PREWHERE ' + settings.timefield + ' BETWEEN ' + parseInt(params.start / 1000000000) + ' AND ' + parseInt(params.end / 1000000000)
    if (settings.where) {
      template += ' AND ' + settings.where
    }
  } else if (settings.where) {
    template += ' WHERE ' + settings.where
  }
  template += ' GROUP BY t, ' + settings.tag + ' ORDER BY t, ' + settings.tag + ')'
  template += ' GROUP BY ' + settings.tag + ' ORDER BY ' + settings.tag
  if (debug) console.log('CLICKHOUSE SEARCH QUERY', template)

  // Read-Only: Initiate a new driver connection
  if (process.env.READONLY) {
    const tmp = { ...clickhouseOptions, queryOptions: { database: settings.db } }
    ch = new ClickHouse(tmp)
  }

  const stream = ch.query(template)
  // or collect records yourself
  const rows = []
  stream.on('metadata', function (columns) {
    // do something with column list
  })
  stream.on('data', function (row) {
    rows.push(row)
  })
  stream.on('error', function (err) {
    // TODO: handler error
    client.code(400).send(err)
  })
  stream.on('end', function () {
    if (debug) console.log('CLICKHOUSE RESPONSE:', rows)
    if (!rows || rows.length < 1) {
      resp.data.result = []
      resp.data.stats = fakeStats
    } else {
      try {
        rows.forEach(function (row) {
          const metrics = { metric: {}, values: [] }
          const tags = settings.tag.split(',').map(t => t.trim())
          // bypass empty blocks
          if (row[row.length - 1].length < 1) return
          // iterate tags
          for (let i = 0; i < row.length - 1; i++) {
            metrics.metric[tags[i]] = row[i]
          }
          // iterate values
          row[row.length - 1].forEach(function (row) {
            if (row[1] === 0) return
            metrics.values.push([parseInt(row[0] / 1000), row[1].toString()])
          })
          resp.data.result.push(metrics)
        })
      } catch (e) { console.log(e) }
    }
    if (debug) console.log('CLOKI RESPONSE', JSON.stringify(resp))
    client.send(resp)
  })
}

/**
 *
 * @param matches {string[]} ['{ts1="a1"}', '{ts2="a2"}', ...]
 * @param res {{res: {write: (function(string)), writeHead: (function(number, {}))}}}
 */
const getSeries = async (matches, res) => {
  const query = transpiler.transpileSeries(matches)
  const stream = await axios.post(`${getClickhouseUrl()}`, query + ' FORMAT JSONEachRow', {
    responseType: 'stream'
  })
  const dStream = StringStream.from(stream.data).lines().map(l => {
    if (!l) {
      return null
    }
    try {
      return JSON.parse(l)
    } catch (e) {
      console.log(l)
      console.log(e)
      return null
    }
  }, DataStream).filter(e => e)
  const gen = dStream.toGenerator()
  res.res.writeHead(200, { 'Content-Type': 'application/json' })
  res.res.write('{"status":"success", "data":[')
  let i = 0
  for await (const item of gen()) {
    if (!item || !item.labels) {
      continue
    }
    res.res.write((i === 0 ? '' : ',') + item.labels)
    ++i
  }
  res.res.write(']}')
  res.res.end()
}

const ping = async () => {
  await Promise.all([
    new Promise((resolve, reject) => ch.query('SELECT 1', undefined, (err) => {
      err ? reject(err) : resolve(err)
    })),
    axios.get(`${getClickhouseUrl()}/?query=SELECT 1`)
  ])
}

/* Module Exports */

/**
 *
 * @param name {string}
 * @param request {string}
 * @param options {{db : string | undefined, timeout_sec: number | undefined}}
 */
module.exports.createLiveView = (name, request, options) => {
  const db = options.db || clickhouseOptions.queryOptions.database
  const timeout = options.timeout_sec ? `WITH TIMEOUT ${options.timeout_sec}` : ''
  return axios.post(`${getClickhouseUrl()}/?allow_experimental_live_view=1`,
    `CREATE LIVE VIEW ${db}.${name} ${timeout} AS ${request}`)
}

/**
 *
 * @param db {string}
 * @param name {string}
 * @param name {string}
 * @param res {{res: {write: (function(string)), writeHead: (function(number, {}))}}}
 * @param options {{
 *     stream: (function(DataStream): DataStream)[],
 * }}
 * @returns Promise<[Promise<void>, CancelTokenSource]>
 */
module.exports.watchLiveView = async (name, db, res, options) => {
  db = db || clickhouseOptions.queryOptions.database
  const cancel = axios.CancelToken.source()
  const stream = await axios.post(`${getClickhouseUrl()}/?allow_experimental_live_view=1`,
    `WATCH ${db}.${name} FORMAT JSONEachRow`,
    {
      responseType: 'stream',
      cancelToken: cancel.token
    })
  const endPromise = (async () => {
    const _stream = preprocessStream(stream, options.stream)
    const gen = _stream.toGenerator()
    res.res.writeHead(200, {})
    for await (const item of gen()) {
      if (!item || !item.labels) {
        continue
      }
      res.res.write(item)
    }
    res.res.end()
  })()
  return [endPromise, cancel]
}

module.exports.createMV = async (query, id, url) => {
  const request = `CREATE MATERIALIZED VIEW ${clickhouseOptions.queryOptions.database}.${id} ` +
    `ENGINE = URL('${url}', JSON) AS ${query}`
  console.log('MV: ' + request)
  await axios.post(`${getClickhouseUrl()}`, request)
}

module.exports.databaseOptions = clickhouseOptions
module.exports.database = clickhouse
module.exports.cache = { bulk: bulk, bulk_labels: bulkLabels, labels: labels }
module.exports.scanFingerprints = scanFingerprints
module.exports.queryFingerprintsScan = queryFingerprintsScan
module.exports.instantQueryScan = instantQueryScan
module.exports.tempoQueryScan = tempoQueryScan
module.exports.scanMetricFingerprints = scanMetricFingerprints
module.exports.scanClickhouse = scanClickhouse
module.exports.reloadFingerprints = reloadFingerprints
module.exports.init = initialize
module.exports.preprocessStream = preprocessStream
module.exports.capabilities = capabilities
module.exports.ping = ping
module.exports.stop = () => {
  samplesThrottler.stop()
  timeSeriesThrottler.stop()
}
module.exports.ready = () => state === 'READY'
module.exports.scanSeries = getSeries
module.exports.samplesTableName = samplesTableName
module.exports.samplesReadTableName = samplesReadTableName
module.exports.getClickhouseUrl = getClickhouseUrl
module.exports.getClickhouseStream = getClickhouseStream
