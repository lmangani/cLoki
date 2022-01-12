const { getDuration, concatLabels, timeShiftViaStream } = require('../common')
const _applyViaStream = require('../common').applyViaStream
const Sql = require('@cloki/clickhouse-sql')
/**
 *
 * @param viaRequest {function(Token, Select): Select}
 * @param viaStream {function(Token, Select): Select}
 * @returns {{
 *  viaRequest: (function(Token, Select): Select),
 *  viaStream: (function(Token, Select): Select)
 *  }}
 */
function builder (viaRequest, viaStream) {
  return {
    viaRequest: viaRequest,
    viaStream: viaStream
  }
}

/**
 *
 * @param token {Token}
 * @param query {Select}
 * @param counterFn {function(any, any, number): any}
 * @param summarizeFn {function(any): number}
 * @param lastValue {boolean} if the applier should take the latest value in step (if step > duration)
 * @param byWithoutName {string} name of the by_without token
*/
const applyViaStream = (token, query, counterFn, summarizeFn, lastValue, byWithoutName) => {
  return _applyViaStream(token, timeShiftViaStream(token, query), counterFn, summarizeFn, lastValue, byWithoutName)
}

/**
 * sum_over_time(unwrapped-range): the sum of all values in the specified interval.
 * @param token {Token}
 * @param query {Select}
 * @returns {SQLObject}
 */
function applyByWithoutLabels (token, query) {
  let labels = concatLabels(query)
  const filterLabels = token.Children('label').map(l => l.value).map(l => `'${l}'`)
  if (token.Child('by_without_unwrap').value === 'by') {
    labels = `arraySort(arrayFilter(x -> arrayExists(y -> x.1 == y, [${filterLabels.join(',')}]) != 0, ` +
            `${labels}))`
  }
  if (token.Child('by_without_unwrap').value === 'without') {
    labels = `arraySort(arrayFilter(x -> arrayExists(y -> x.1 == y, [${filterLabels.join(',')}]) == 0, ` +
            `${labels}))`
  }
  return new Sql.Raw(labels)
}

/**
 *
 * @param token {Token}
 * @param query {Select}
 * @param valueExpr {string}
 * @param lastValue {boolean | undefined} if the applier should take the latest value in step (if step > duration)
 * @returns {Select}
 */
function applyViaRequest (token, query, valueExpr, lastValue) {
  valueExpr = new Sql.Raw(valueExpr)
  const labels = token.Child('by_without_unwrap')
    ? applyByWithoutLabels(token.Child('opt_by_without_unwrap'), query)
    : concatLabels(query)
  const duration = getDuration(token, query)
  query.ctx.matrix = true
  query.ctx.duration = duration
  query.limit(undefined, undefined)
  const step = query.ctx.step
  const tsMoveParam = new Sql.Parameter('timestamp_shift')
  query.addParam(tsMoveParam)
  const tsGroupingExpr = new Sql.Raw('')
  tsGroupingExpr.toString = () => {
    if (!tsMoveParam.get()) {
      return `intDiv(timestamp_ms, ${duration}) * ${duration}`
    }
    return `intDiv(timestamp_ms - ${tsMoveParam.toString()}, ${duration}) * ${duration} + ${tsMoveParam.toString()}`
  }
  const uwRateA = new Sql.With('uw_rate_a', query)
  const groupingQuery = (new Sql.Select())
    .select(
      [labels, 'labels'],
      [valueExpr, 'value'],
      [tsGroupingExpr, 'timestamp_ms']
    ).from(new Sql.WithReference(uwRateA))
    .groupBy('labels', 'timestamp_ms')
    .orderBy('labels', 'timestamp_ms')
  if (step <= duration) {
    return groupingQuery.with(uwRateA)
  }
  const groupingQueryWith = new Sql.With('uw_rate_b', groupingQuery)
  return (new Sql.Select())
    .with(uwRateA, groupingQueryWith)
    .select('labels',
      [new Sql.Raw(`intDiv(timestamp_ms, ${step}) * ${step}`), 'timestamp_ms'],
      [new Sql.Raw('argMin(uw_rate_b.value, uw_rate_b.timestamp_ms)'), 'value']
    )
    .from(new Sql.WithReference(groupingQueryWith))
    .groupBy('labels', 'timestamp_ms')
    .orderBy(['labels', 'asc'], ['timestamp_ms', 'asc'])
}

module.exports = {
  applyViaStream: _applyViaStream,
  rate: builder((token, query) => {
    const duration = getDuration(token, query)
    return applyViaRequest(token, query, `SUM(unwrapped) / ${duration / 1000}`)
  }, (token, query) => {
    const duration = getDuration(token, query)
    return applyViaStream(token, query,
      (sum, val) => sum + val.unwrapped,
      (sum) => sum / duration * 1000, false, 'by_without_unwrap')
  }),

  /**
     * sum_over_time(unwrapped-range): the sum of all values in the specified interval.
     * @param token {Token}
     * @param query {Select}
     * @returns {Select}
     */
  sumOverTime: builder((token, query) => {
    return applyViaRequest(token, query, 'sum(unwrapped)')
  }, (token, query) => {
    return applyViaStream(token, query,
      (sum, val) => sum + val.unwrapped,
      (sum) => sum, false, 'by_without_unwrap')
  }),

  /**
     * avg_over_time(unwrapped-range): the average value of all points in the specified interval.
     * @param token {Token}
     * @param query {Select}
     * @returns {Select}
     */
  avgOverTime: builder((token, query) => {
    return applyViaRequest(token, query, 'avg(unwrapped)')
  }, (token, query) => {
    return applyViaStream(token, query, (sum, val) => {
      return sum ? { count: sum.count + 1, val: sum.val + val.unwrapped } : { count: 1, val: val.unwrapped }
    }, (sum) => sum.val / sum.count, false, 'by_without_unwrap')
  }),
  /**
     * max_over_time(unwrapped-range): the maximum value of all points in the specified interval.
     * @param token {Token}
     * @param query {Select}
     * @returns {Select}
     */
  maxOverTime: builder((token, query) => {
    return applyViaRequest(token, query, 'max(unwrapped)')
  }, (token, query) => {
    return applyViaStream(token, query, (sum, val) => {
      return Math.max(sum, val.unwrapped)
    }, (sum) => sum, false, 'by_without_unwrap')
  }),
  /**
     * min_over_time(unwrapped-range): the minimum value of all points in the specified interval
     * @param token {Token}
     * @param query {Select}
     * @returns {Select}
     */
  minOverTime: builder((token, query) => {
    return applyViaRequest(token, query, 'min(unwrapped)')
  }, (token, query) => {
    return applyViaStream(token, query, (sum, val) => {
      return Math.min(sum, val.unwrapped)
    }, (sum) => sum, false, 'by_without_unwrap')
  }),
  /**
     * firstOverTime(unwrapped-range): the first value of all points in the specified interval
     * @param token {Token}
     * @param query {Select}
     * @returns {Select}
     */
  firstOverTime: builder((token, query) => {
    return applyViaRequest(token, query, 'argMin(unwrapped, uw_rate_a.timestamp_ms)')
  }, (token, query) => {
    return applyViaStream(token, query, (sum, val, time) => {
      return sum && sum.time < time ? sum : { time: time, first: val.unwrapped }
    }, (sum) => sum.first, false, 'by_without_unwrap')
  }),
  /**
     * lastOverTime(unwrapped-range): the last value of all points in the specified interval
     * @param token {Token}
     * @param query {Select}
     * @returns {Select}
     */
  lastOverTime: builder((token, query) => {
    return applyViaRequest(token, query, 'argMax(unwrapped, uw_rate_a.timestamp_ms)', true)
  }, (token, query) => {
    return applyViaStream(token, query, (sum, val, time) => {
      return sum && sum.time > time ? sum : { time: time, first: val.unwrapped }
    }, (sum) => sum.first, false, 'by_without_unwrap')
  }),
  /**
     * stdvarOverTime(unwrapped-range): the population standard variance of the values in the specified interval.
     * @param token {Token}
     * @param query {Select}
     * @returns {Select}
     */
  stdvarOverTime: builder((token, query) => {
    return applyViaRequest(token, query, 'varPop(unwrapped)')
  }, (token, query) => {
    return applyViaStream(token, query, (/* sum, val */) => {
      throw new Error('not implemented')
    }, (sum) => sum, false, 'by_without_unwrap')
  }),
  /**
     * stddevOverTime(unwrapped-range): the population standard deviation of the values in the specified interval.
     * @param token {Token}
     * @param query {Select}
     * @returns {Select}
     */
  stddevOverTime: builder((token, query) => {
    return applyViaRequest(token, query, 'stddevPop(unwrapped)')
  }, (token, query) => {
    return applyViaStream(token, query, (/* sum, val */) => {
      throw new Error('not implemented')
    }, (sum) => sum, false, 'by_without_unwrap')
  }),
  /**
     * quantileOverTime(scalar,unwrapped-range): the φ-quantile (0 ≤ φ ≤ 1) of the values in the specified interval.
     * //@param token {Token}
     * //@param query {Select}
     * @returns {Select}
     */
  quantileOverTime: (/* token, query */) => {
    throw new Error('Not implemented')
  },
  /**
     * absentOverTime(unwrapped-range): returns an empty vector if the range vector passed to it has any elements and a 1-element vector with the value 1 if the range vector passed to it has no elements. (absentOverTime is useful for alerting on when no time series and logs stream exist for label combination for a certain amount of time.)
     * //@param token {Token}
     * //@param query {Select}
     * @returns {Select}
     */
  absentOverTime: (/* token, query */) => {
    throw new Error('Not implemented')
  }
}
