const { hashLabels, parseLabels } = require('../../common')
const { get_plg } = require('../../plugins/engine')

/**
 * @param query {registry_types.Request | string[]}
 * @param clauses {string[]}
 * @returns {registry_types.Request | string[]}
 */
module.exports._and = (query, clauses) => {
  if (Array.isArray(query)) {
    if (!query.length) {
      return ['AND', ...clauses]
    }
    return query[0] === 'AND'
      ? [...query, ...clauses]
      : ['AND', query, ...clauses]
  }
  query = { ...query }
  if (!query.where) {
    query.where = ['AND']
  } else if (query.where[0] !== 'AND') {
    query.where = ['AND', query.where]
  } else {
    query.where = [...query.where]
  }
  query.where.push.apply(query.where, clauses)
  return query
}

/**
 * @param query {registry_types.Request}
 * @returns {registry_types.Request}
 */
module.exports.querySelectorPostProcess = (query) => {
  return query
}

/**
 *
 * @param token {Token}
 * @returns {string}
 */
module.exports.unquote_token = (token) => {
  let value = token.Child('quoted_str').value
  value = `"${value.substr(1, value.length - 2)}"`
  return JSON.parse(value)
}

/**
 *
 * @param duration_str {string}
 * @returns {number}
 */
module.exports.durationToMs = (duration_str) => {
  const durations = {
    ns: 1 / 1000000,
    us: 1 / 1000,
    ms: 1,
    s: 1000,
    m: 60000,
    h: 60000 * 60
  }
  for (const k of Object.keys(durations)) {
    const m = duration_str.match(new RegExp(`^([0-9][.0-9]*)${k}$`))
    if (m) {
      return parseInt(m[1]) * durations[k]
    }
  }
  throw new Error('Unsupported duration')
}

/**
 *
 * @param s {DataStream}
 * @param fn
 * @returns {DataStream}
 */
module.exports.map = (s, fn) => s.map((e) => {
  return new Promise(f => {
    setImmediate(() => {
      f(fn(e))
    })
  })
})

/**
 *
 * @param token {Token}
 * //@param query {registry_types.Request}
 * @returns {number}
 */
module.exports.getDuration = (token/*, query */) => {
  return module.exports.durationToMs(token.Child('duration_value').value)
  // Math.max(duration, query.ctx && query.ctx.step ? query.ctx.step : 1000);
}

const getDuration = module.exports.getDuration

/**
 *
 * @param eof {any}
 * @returns boolean
 */
module.exports.isEOF = (eof) => eof.EOF

module.exports.getPlugins = (type, cb) => {
  const _plgs = get_plg({ type: type })
  const plgs = {}
  for (const _e of Object.values(_plgs)) {
    for (const e of Object.entries(_e)) {
      plgs[e[0]] = cb ? cb(e[1]) : () => e[1]
    }
  }
  return plgs
  /* for (let file of glob.sync(path + "/*.js")) {
        const mod = require(file);
        for (let fn of Object.keys(mod)) {
            plugins[fn] = cb ? cb(mod[fn]()) : mod[fn]();
        }
    }
    return plugins; */
}

/**
 *
 * @param query {registry_types.Request}
 * @returns {boolean}
 */
module.exports.has_extra_labels = (query) => {
  return query.select.some(f => f.endsWith('as extra_labels'))
}

/**
 *
 * @param query {registry_types.Request}
 * @returns {string}
 */
module.exports.concat_labels = (query) => {
  if (module.exports.has_extra_labels(query)) {
    return 'arraySort(arrayConcat(arrayFilter(' +
            'x -> arrayExists(y -> y.1 == x.1, extra_labels) == 0, ' +
            'JSONExtractKeysAndValues(labels, \'String\')), extra_labels))'
  }
  return 'JSONExtractKeysAndValues(labels, \'String\')'
}

/**
 * sum_over_time(unwrapped-range): the sum of all values in the specified interval.
 * @param token {Token}
 * @param query {registry_types.Request}
 * @param by_without_name {string} name of the by_without token
 * @returns {registry_types.Request}
 */
function apply_by_without_stream (token, query, by_without_name) {
  const is_by = token.Child(by_without_name).value === 'by'
  const filter_labels = token.Children('label').map(l => l.value)
  return {
    ...query,
    stream: [...(query.stream ? query.stream : []),
      /**
             *
             * @param stream {DataStream}
             */
      (stream) => stream.map(e => {
        if (!e || !e.labels) {
          return e
        }
        const labels = [...Object.entries(e.labels)].filter(l =>
          (is_by && filter_labels.includes(l[0])) || (!is_by && !filter_labels.includes(l[0]))
        )
        return { ...e, labels: parseLabels(labels) }
      })
    ]
  }
}

/**
 *
 * @param values {Object}
 * @param timestamp {number}
 * @param value {number}
 * @param duration {number}
 * @param step {number}
 * @param counter_fn {function(any, any, number): any}
 * @returns {Object}
 */
function add_timestamp (values, timestamp, value, duration, step, counter_fn) {
  const timestamp_without_step = Math.floor(timestamp / duration) * duration
  const timestamp_with_step = step > duration
    ? Math.floor(timestamp_without_step / step) * step
    : timestamp_without_step
  if (!values) {
    values = {}
  }
  if (!values[timestamp_with_step]) {
    values[timestamp_with_step] = {}
  }
  if (!values[timestamp_with_step][timestamp_without_step]) {
    values[timestamp_with_step][timestamp_without_step] = 0
  }
  values[timestamp_with_step][timestamp_without_step] =
        counter_fn(values[timestamp_with_step][timestamp_without_step], value, timestamp)
  return values
}

/**
 *
 * @param query {registry_types.Request}
 * @returns {boolean}
 */
module.exports.has_extra_labels = (query) => {
  return query.select.some((x) => x.endsWith('as extra_labels'))
}

/**
 *
 * @param token {Token}
 * @param query {registry_types.Request}
 * @param counter_fn {function(any, any, number): any}
 * @param summarize_fn {function(any): number}
 * @param last_value {boolean} if the applier should take the latest value in step (if step > duration)
 * @param by_without_name {string} name of the by_without token
 * @returns {registry_types.Request}
 */
module.exports.apply_via_stream = (token, query,
  counter_fn, summarize_fn, last_value, by_without_name) => {
  by_without_name = by_without_name || 'by_without'
  if (token.Child(by_without_name)) {
    query = apply_by_without_stream(token.Child(`opt_${by_without_name}`), query, by_without_name)
  }
  let results = new Map()
  const duration = getDuration(token, query)
  const step = query.ctx.step
  return {
    ...query,
    limit: undefined,
    ctx: { ...query.ctx, duration: duration },
    matrix: true,
    stream: [...(query.stream ? query.stream : []),
      /**
             * @param s {DataStream}
             */
      (s) => s.remap((emit, e) => {
        if (!e || !e.labels) {
          for (const [_, v] of results) {
            const ts = [...Object.entries(v.values)]
            ts.sort()
            for (const _v of ts) {
              let value = Object.entries(_v[1])
              value.sort()
              value = last_value ? value[value.length - 1][1] : value[0][1]
              value = summarize_fn(value)// Object.values(_v[1]).reduce((sum, v) => sum + summarize_fn(v), 0);
              emit({ labels: v.labels, timestamp_ms: _v[0], value: value })
            }
          }
          results = new Map()
          emit({ EOF: true })
          return
        }
        const l = hashLabels(e.labels)
        if (!results.has(l)) {
          results.set(l, {
            labels: e.labels,
            values: add_timestamp(undefined, e.timestamp_ms, e, duration, step, counter_fn)
          })
        } else {
          results.get(l).values = add_timestamp(
            results.get(l).values, e.timestamp_ms, e, duration, step, counter_fn
          )
        }
      })
    ]
  }
}

/**
 *
 * @param str {string}
 * @param custom {(function(string): string | undefined) | undefined}
 * @param custom_slash {(function(string): (string | undefined)) | undefined}
 * @return {string}
 */
module.exports.unquote = (str, custom, custom_slash) => {
  const quote = str.substr(0, 1)
  switch (quote) {
    case '"':
    case '`':
      break
    default:
      throw new Error(`Unknown quote: ${quote}`)
  }
  str = str.trim()
  str = str.substr(1, str.length - 2)
  let res = ''
  let slash = false
  for (let i = 0; i < str.length; i++) {
    if (!slash) {
      if (custom && custom(str[i])) {
        res += custom(str[i])
        continue
      }
      if (str[i] === quote) {
        throw new Error('Unexpected quote')
      }
      switch (str[i]) {
        case '\\':
          slash = true
          continue
        default:
          res += str[i]
      }
    }
    if (slash) {
      if (custom_slash && custom_slash(str[i])) {
        res += custom_slash(str[i])
        continue
      }
      if (str[i] === quote) {
        res += quote
        continue
      }
      switch (str[i]) {
        case 'n':
          res += '\n'
          break
        case 't':
          res += '\t'
          break
        default:
          res += '\\' + str[i]
      }
    }
  }
  return res
}
