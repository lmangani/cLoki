package main

import (
	"context"
	"fmt"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql"
	"github.com/prometheus/prometheus/promql/parser"
	"github.com/prometheus/prometheus/storage"
	"github.com/prometheus/prometheus/tsdb/chunkenc"
	"strconv"
	"strings"
	"time"
	"unsafe"
	"wasm_parts/profiling"
	"wasm_parts/shared"
	sql "wasm_parts/sql_select"
	parser2 "wasm_parts/traceql/parser"
	traceql_transpiler "wasm_parts/traceql/transpiler"
	"wasm_parts/types"
)

type ctx struct {
	onDataLoad func(c *ctx)
	request    []byte
	response   []byte
}

var data = map[uint32]*ctx{}

//export createCtx
func createCtx(id uint32) {
	data[id] = &ctx{}
}

//export alloc
func alloc(id uint32, size int) *byte {
	data[id].request = make([]byte, size)
	return &data[id].request[0]
}

//export dealloc
func dealloc(id uint32) {
	delete(data, id)
}

//export getCtxRequest
func getCtxRequest(id uint32) *byte {
	return &data[id].request[0]
}

//export getCtxRequestLen
func getCtxRequestLen(id uint32) uint32 {
	return uint32(len(data[id].request))
}

//export getCtxResponse
func getCtxResponse(id uint32) *byte {
	return &data[id].response[0]
}

//export getCtxResponseLen
func getCtxResponseLen(id uint32) uint32 {
	return uint32(len(data[id].response))
}

//export transpileTraceQL
func transpileTraceQL(id uint32) int {
	request := types.TraceQLRequest{}
	err := request.UnmarshalJSON(data[id].request)
	if err != nil {
		data[id].response = []byte(err.Error())
		return 1
	}

	script, err := parser2.Parse(request.Request)
	if err != nil {
		data[id].response = []byte(err.Error())
		return 1
	}

	planner, err := traceql_transpiler.Plan(script)
	if err != nil {
		data[id].response = []byte(err.Error())
		return 1
	}
	request.Ctx.Ctx = context.Background()
	request.Ctx.CancelCtx = func() {}
	request.Ctx.CHSqlCtx = &sql.Ctx{
		Params: make(map[string]sql.SQLObject),
		Result: make(map[string]sql.SQLObject),
	}
	request.Ctx.From = time.Unix(int64(request.Ctx.FromS), 0)
	request.Ctx.To = time.Unix(int64(request.Ctx.ToS), 0)
	sel, err := planner.Process(&request.Ctx)
	if err != nil {
		data[id].response = []byte(err.Error())
		return 1
	}
	var options []int
	if request.Ctx.IsCluster {
		options = append(options, sql.STRING_OPT_INLINE_WITH)
	}
	str, err := sel.String(request.Ctx.CHSqlCtx, options...)
	if err != nil {
		data[id].response = []byte(err.Error())
		return 1
	}
	data[id].response = []byte(str)
	return 0
}

var eng *promql.Engine = nil
var engC = 0

func getEng() *promql.Engine {
	if eng == nil || engC > 5 {
		eng = promql.NewEngine(promql.EngineOpts{
			Logger:                   TestLogger{},
			MaxSamples:               100000,
			Timeout:                  time.Second * 30,
			ActiveQueryTracker:       nil,
			LookbackDelta:            0,
			NoStepSubqueryIntervalFn: nil,
			EnableAtModifier:         false,
			EnableNegativeOffset:     false,
		})
		engC = 0
	}
	engC++
	return eng
}

//export stats
func stats() {
	fmt.Printf("Allocated data: %d\n", len(data))
}

//export pqlRangeQuery
func pqlRangeQuery(id uint32, fromMS float64, toMS float64, stepMS float64) uint32 {
	return pql(data[id], func() (promql.Query, error) {
		queriable := &TestQueryable{id: id}
		return getEng().NewRangeQuery(
			queriable,
			nil,
			string(data[id].request),
			time.Unix(0, int64(fromMS)*1000000),
			time.Unix(0, int64(toMS)*1000000),
			time.Millisecond*time.Duration(stepMS))
	})

}

//export pqlInstantQuery
func pqlInstantQuery(id uint32, timeMS float64) uint32 {
	return pql(data[id], func() (promql.Query, error) {
		queriable := &TestQueryable{id: id}
		return getEng().NewInstantQuery(
			queriable,
			nil,
			string(data[id].request),
			time.Unix(0, int64(timeMS)*1000000))
	})
}

//export pqlSeries
func pqlSeries(id uint32) uint32 {
	queriable := &TestQueryable{id: id}
	query, err := getEng().NewRangeQuery(
		queriable,
		nil,
		string(data[id].request),
		time.Unix(0, 1),
		time.Unix(0, 2),
		time.Second)
	if err != nil {
		data[id].response = wrapError(err)
		return 1
	}
	data[id].response = []byte(getmatchersJSON(query))
	return 0
}

//export pyroscopeSelectMergeStacktraces
func pyroscopeSelectMergeStacktraces(id uint32) uint32 {
	ctx := data[id]
	fg, err := profiling.CreateFlameGraph(ctx.request)
	if err != nil {
		data[id].response = wrapError(err)
		return 1
	}
	bld := strings.Builder{}
	bld.Grow(10 * 1024 * 1024)
	bld.WriteString(`{"names": [`)
	for i := range fg.Names {
		if i != 0 {
			bld.WriteString(",")
		}
		bld.WriteString(strconv.Quote(fg.Names[i]))
	}
	bld.WriteString(`], "levels": [`)
	for i, lvls := range fg.Levels {
		if i != 0 {
			bld.WriteString(",")
		}
		bld.WriteString("[")
		for j, lvl := range lvls {
			if j != 0 {
				bld.WriteString(",")
			}
			bld.WriteString(strconv.FormatInt(lvl, 10))
		}
		bld.WriteString("]")
	}
	bld.WriteString(fmt.Sprintf(`], "total": %d, "maxSelf": %d}`, fg.Total, fg.MaxSelf))

	ctx.response = []byte(bld.String())
	return 0
}

func getmatchersJSON(q promql.Query) string {
	var matchersJson = strings.Builder{}
	var walk func(node parser.Node, i func(node parser.Node))
	walk = func(node parser.Node, i func(node parser.Node)) {
		i(node)
		for _, n := range parser.Children(node) {
			walk(n, i)
		}
	}
	i := 0
	matchersJson.WriteString("[")
	walk(q.Statement(), func(node parser.Node) {
		switch n := node.(type) {
		case *parser.VectorSelector:
			if i != 0 {
				matchersJson.WriteString(",")
			}
			matchersJson.WriteString(matchers2Str(n.LabelMatchers))
			i++
		}
	})
	matchersJson.WriteString("]")
	return matchersJson.String()
}

func wrapError(err error) []byte {
	return []byte(wrapErrorStr(err))
}

func wrapErrorStr(err error) string {
	//return fmt.Sprintf(`{"status":"error", "error":%s}`, strconv.Quote(err.Error()))
	return err.Error()
}

func pql(c *ctx, query func() (promql.Query, error)) uint32 {
	rq, err := query()

	if err != nil {
		c.response = wrapError(err)
		return 1
	}
	var walk func(node parser.Node, i func(node parser.Node))
	walk = func(node parser.Node, i func(node parser.Node)) {
		i(node)
		for _, n := range parser.Children(node) {
			walk(n, i)
		}
	}
	matchersJSON := getmatchersJSON(rq)

	c.response = []byte(matchersJSON)
	c.onDataLoad = func(c *ctx) {
		res := rq.Exec(context.Background())
		c.response = []byte(writeResponse(res))
		return
	}
	return 0
}

//export onDataLoad
func onDataLoad(idx uint32) {
	data[idx].onDataLoad(data[idx])
}

func writeResponse(res *promql.Result) string {
	if res.Err != nil {
		return wrapErrorStr(res.Err)
	}
	switch res.Value.Type() {
	case parser.ValueTypeMatrix:
		m, err := res.Matrix()
		if err != nil {
			return wrapErrorStr(err)
		}
		return writeMatrix(m)
	case parser.ValueTypeVector:
		v, err := res.Vector()
		if err != nil {
			return wrapErrorStr(err)
		}
		return writeVector(v)
	}
	return wrapErrorStr(fmt.Errorf("result type not supported"))
}

func writeMatrix(m promql.Matrix) string {
	jsonBuilder := strings.Builder{}
	jsonBuilder.WriteString(`{"status": "success", "data": {"resultType":"matrix","result":[`)
	for i, s := range m {
		if i != 0 {
			jsonBuilder.WriteString(",")
		}
		jsonBuilder.WriteString(`{"metric": {`)
		for j, l := range s.Metric {
			if j != 0 {
				jsonBuilder.WriteString(",")
			}
			jsonBuilder.WriteString(fmt.Sprintf("%s:%s", strconv.Quote(l.Name), strconv.Quote(l.Value)))
		}
		jsonBuilder.WriteString(`}, "values": [`)
		for j, v := range s.Points {
			if j != 0 {
				jsonBuilder.WriteString(",")
			}
			jsonBuilder.WriteString(fmt.Sprintf("[%d,\"%f\"]", v.T/1000, v.V))
		}
		jsonBuilder.WriteString(`]}`)
	}
	jsonBuilder.WriteString(`]}}`)
	return jsonBuilder.String()
}

func writeVector(v promql.Vector) string {
	jsonBuilder := strings.Builder{}
	jsonBuilder.WriteString(`{"status": "success", "data": {"resultType":"vector","result":[`)
	for i, s := range v {
		if i != 0 {
			jsonBuilder.WriteString(",")
		}
		jsonBuilder.WriteString(`{"metric": {`)
		for j, l := range s.Metric {
			if j != 0 {
				jsonBuilder.WriteString(",")
			}
			jsonBuilder.WriteString(fmt.Sprintf("%s:%s", strconv.Quote(l.Name), strconv.Quote(l.Value)))
		}
		jsonBuilder.WriteString(fmt.Sprintf(`}, "value": [%d,"%f"]}`, s.T/1000, s.V))
	}
	jsonBuilder.WriteString(`]}}`)
	return jsonBuilder.String()
}

func main() {}

type TestLogger struct{}

func (t TestLogger) Log(keyvals ...interface{}) error {
	fmt.Print(keyvals...)
	fmt.Print("\n")
	return nil
}

type TestQueryable struct {
	id uint32
}

func (t TestQueryable) Querier(ctx context.Context, mint, maxt int64) (storage.Querier, error) {
	sets := make(map[string][]byte)
	r := BinaryReader{buffer: data[t.id].request}
	for r.i < uint32(len(data[t.id].request)) {
		sets[r.ReadString()] = r.ReadByteArray()
	}
	return &TestQuerier{sets: sets}, nil
}

type TestQuerier struct {
	sets map[string][]byte
}

func (t TestQuerier) LabelValues(name string, matchers ...*labels.Matcher) ([]string, storage.Warnings, error) {
	return nil, nil, nil
}

func (t TestQuerier) LabelNames(matchers ...*labels.Matcher) ([]string, storage.Warnings, error) {
	return nil, nil, nil
}

func (t TestQuerier) Close() error {
	return nil
}

func (t TestQuerier) Select(sortSeries bool, hints *storage.SelectHints, matchers ...*labels.Matcher) storage.SeriesSet {
	strMatchers := matchers2Str(matchers)
	return &TestSeriesSet{
		data:   t.sets[strMatchers],
		reader: BinaryReader{buffer: t.sets[strMatchers]},
	}
}

type TestSeriesSet struct {
	data   []byte
	reader BinaryReader
}

func (t *TestSeriesSet) Next() bool {
	return t.reader.i < uint32(len(t.data))
}

func (t *TestSeriesSet) At() storage.Series {
	res := &TestSeries{
		i: -1,
	}
	res.labels = t.reader.ReadLabelsTuple()
	res.data = t.reader.ReadPointsArrayRaw()
	return res
}

func (t *TestSeriesSet) Err() error {
	return nil
}

func (t *TestSeriesSet) Warnings() storage.Warnings {
	return nil
}

type TestSeries struct {
	data []byte

	labels labels.Labels
	i      int
}

func (t *TestSeries) Next() bool {
	t.i++
	return t.i*16 < len(t.data)
}

func (t *TestSeries) Seek(tmMS int64) bool {
	for t.i = 0; t.i*16 < len(t.data); t.i++ {
		ms := *(*int64)(unsafe.Pointer(&t.data[t.i*16]))
		if ms >= tmMS {
			return true
		}
	}
	return false
}

func (t *TestSeries) At() (int64, float64) {
	ts := *(*int64)(unsafe.Pointer(&t.data[t.i*16]))
	val := *(*float64)(unsafe.Pointer(&t.data[t.i*16+8]))
	return ts, val
}

func (t *TestSeries) Err() error {
	return nil
}

func (t *TestSeries) Labels() labels.Labels {
	return t.labels
}

func (t *TestSeries) Iterator() chunkenc.Iterator {
	return t
}

type BinaryReader struct {
	buffer []byte
	i      uint32
}

func (b *BinaryReader) ReadULeb32() uint32 {
	res, i := shared.ReadULeb32(b.buffer[b.i:])
	b.i += i
	return res
}

func (b *BinaryReader) ReadLabelsTuple() labels.Labels {
	ln := b.ReadULeb32()
	res := make(labels.Labels, ln)
	for i := uint32(0); i < ln; i++ {
		ln := b.ReadULeb32()
		res[i].Name = string(b.buffer[b.i : b.i+ln])
		b.i += ln
		ln = b.ReadULeb32()
		res[i].Value = string(b.buffer[b.i : b.i+ln])
		b.i += ln
	}
	return res
}

func (b *BinaryReader) ReadPointsArrayRaw() []byte {
	ln := b.ReadULeb32()
	res := b.buffer[b.i : b.i+(ln*16)]
	b.i += ln * 16
	return res
}

func (b *BinaryReader) ReadString() string {
	ln := b.ReadULeb32()
	res := string(b.buffer[b.i : b.i+ln])
	b.i += ln
	return res
}

func (b *BinaryReader) ReadByteArray() []byte {
	ln := b.ReadULeb32()
	res := b.buffer[b.i : b.i+ln]
	b.i += ln
	return res
}

func matchers2Str(labelMatchers []*labels.Matcher) string {
	matchersJson := strings.Builder{}
	matchersJson.WriteString("[")
	for j, m := range labelMatchers {
		if j != 0 {
			matchersJson.WriteString(",")
		}
		matchersJson.WriteString(fmt.Sprintf(`[%s,"%s",%s]`,
			strconv.Quote(m.Name),
			m.Type,
			strconv.Quote(m.Value)))
	}
	matchersJson.WriteString("]")
	return matchersJson.String()
}
