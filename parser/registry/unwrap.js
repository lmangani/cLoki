const {_and, map} = require("./common");
/**
 *
 * @param token {Token}
 * @param query {registry_types.Request}
 * @returns {registry_types.Request}
 */
module.exports = (token, query) => {
    const label = token.Child('label').value;
    if (query.stream) {
        return via_stream(label, query);
    }
    if (query.select.some(e => e.endsWith('as extra_labels'))) {
        return via_query_with_extra_labels(label, query);
    }
    return via_query(label, query);
}

/**
 *
 * @param label {string}
 * @param query {registry_types.Request}
 * @returns {registry_types.Request}
 */
function via_query(label, query) {
    query = {
        ...query,
        select: [...query.select, `toFloat64OrNull(JSONExtractString(labels,'${label}')) as unwrapped`]
    }
    return _and(query, [
        `JSONHas(labels, '${label}')`,
        `isNotNull(unwrapped)`
    ]);
}

/**
 *
 * @param label {string}
 * @param query {registry_types.Request}
 * @returns {registry_types.Request}
 */
function via_query_with_extra_labels(label, query) {
    query = {
        ...query,
        select: [...query.select, `toFloat64OrNull(if(arrayExists(x -> x.1 == '${label}', extra_labels), `+
                `arrayFirst(x -> x.1 == '${label}', extra_labels).2, `+
            `JSONExtractString(labels,'${label}'))) as unwrapped`]
    }
    return _and(query, [[
        'OR',
        `arrayFirstIndex(x -> x.1 == '${label}', extra_labels) != 0`,
        ['AND', `arrayFirstIndex(x -> x.1 == '${label}', extra_labels) == 0`, `JSONHas(labels, '${label}')`]
    ], `isNotNull(unwrapped)`]);
}

/**
 *
 * @param label {string}
 * @param query {registry_types.Request}
 * @returns {registry_types.Request}
 */
function via_stream(label, query) {
    return {
        ...query,
        stream: [
            ...(query.stream ? query.stream : []),
            /**
             *
             * @param stream {DataStream}
             */
            (stream) => map(stream, e => {
                if (!e || !e.labels || !e.labels[label]) {
                    return {...e};
                }
                try {
                    e.unwrapped = parseFloat(e.labels[label]);
                    if (isNaN(e.unwrapped)) {
                        return null;
                    }
                    return e;
                } catch (e) {
                    return null;
                }
            }).filter(e => e)
        ]
    }
}