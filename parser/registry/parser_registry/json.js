const { Compiler } = require('bnf/Compiler')
const { map, addStream } = require('../common')
const Sql = require('@cloki/clickhouse-sql')

/**
 *
 * @type {function(Token): Object | undefined}
 */
const getLabels = (() => {
  const compiler = new Compiler()
  compiler.AddLanguage(`
<SYNTAX> ::= first_part *(part)
<first_part> ::= 1*(<ALPHA> | "_" | <DIGITS>)
<part> ::= ("." <first_part>) | "[" <QLITERAL> "]" | "[" <DIGITS> "]"
        `, 'json_param')
  /**
     * @param token {Token}
     * @returns {Object | undefined}
     */
  return (token) => {
    if (!token.Children('parameter').length) {
      return undefined
    }
    return token.Children('parameter').reduce((sum, p) => {
      const label = p.Child('label').value
      let val = compiler.ParseScript(JSON.parse(p.Child('quoted_str').value))
      val = [
        val.rootToken.Child('first_part').value,
        ...val.rootToken.Children('part').map(t => t.value)
      ]
      sum[label] = val
      return sum
    }, {})
  }
})()

/**
 *
 * @param token {Token}
 * @param query {Select}
 * @returns {Select}
 */
module.exports.viaClickhouseQuery = (token, query) => {
  const labels = getLabels(token)
  let exprs = Object.entries(labels).map(lbl => {
    const path = lbl[1].map(path => {
      if (path.startsWith('.')) {
        return `'${path.substring(1)}'`
      }
      if (path.startsWith('["')) {
        return `'${JSON.parse(path.substring(1, path.length - 1))}'`
      }
      if (path.startsWith('[')) {
        return (parseInt(path.substring(1, path.length - 1)) + 1).toString()
      }
      return `'${path}'`
    })
    const expr = `if(JSONType(samples.string, ${path.join(',')}) == 'String', ` +
            `JSONExtractString(samples.string, ${path.join(',')}), ` +
            `JSONExtractRaw(samples.string, ${path.join(',')}))`
    return `('${lbl[0]}', ${expr})`
  })
  exprs = new Sql.Raw("arrayFilter((x) -> x.2 != '', [" + exprs.join(',') + '])')
  query.select_list = query.select_list.filter(f => f[1] !== 'extra_labels')
  query.select([exprs, 'extra_labels'])
  query.where(Sql.Eq(new Sql.Raw('isValidJSON(samples.string)'), 1))
  return query
}

/**
 *
 * @param token {Token}
 * @param query {Select}
 * @returns {Select}
 */
module.exports.viaStream = (token, query) => {
  const labels = getLabels(token)

  /**
     *
     * @param {any} obj
     * @param {string} prefix
     * @returns {string|{}|null}
     */
  const objToLabels = (obj, prefix) => {
    if (Array.isArray(obj) ||
            obj === null
    ) {
      return null
    }
    if (typeof obj === 'object') {
      let res = {}
      for (const k of Object.keys(obj)) {
        const label = prefix + (prefix ? '_' : '') + (k.replace(/[^a-zA-Z0-9_]/g, '_'))
        const val = objToLabels(obj[k], label)
        if (typeof val === 'object') {
          res = { ...res, ...val }
          continue
        }
        res[label] = val
      }
      return res
    }
    return obj.toString()
  }

  /**
     *
     * @param {Object} obj
     * @param {String[]} path
     */
  const extractLabel = (obj, path) => {
    let res = obj
    for (const p of path) {
      if (!res[p]) {
        return undefined
      }
      res = res[p]
    }
    if (typeof res === 'object' || Array.isArray(res)) {
      return JSON.stringify(res)
    }
    return res.toString()
  }

  /**
     *
     * @param {Object} obj
     * @param {Object} labels
     */
  const extractLabels = (obj, labels) => {
    const res = {}
    for (const l of Object.keys(labels)) {
      res[l] = extractLabel(obj, labels[l])
    }
    return res
  }

  /**
     *
     * @param {DataStream} stream
     * @return {DataStream}
     */
  const stream = (stream) => {
    return map(stream, (e) => {
      if (!e || !e.labels) {
        return { ...e }
      }
      try {
        const oString = JSON.parse(e.string)
        const extraLabels = labels ? extractLabels(oString, labels) : objToLabels(oString, '')
        return { ...e, labels: { ...e.labels, ...extraLabels } }
      } catch (err) {
        return undefined
      }
    })
  }
  return addStream(query, stream)
}
