util = require 'util'
Trampoline = require("./trampoline").Trampoline

# parser state, used internally.
class ParserState
  constructor: (@text, @pos=0, @end) ->
    if not @end? then @end = @text.length
    @lineno = 0
    @xpos = 0
    @trampoline = new Trampoline(@)
    @depth = 0
    @debugger = null
    @stateName = null
    @previousStateName = null
    Object.freeze(@)

  copy: (changes) ->
    rv = {}
    rv.prototype = @prototype
    for k of @ then rv[k] = @[k]
    for k, v of changes then rv[k] = v
    Object.freeze(rv)

  toString: ->
    truncated = if @text.length > 10 then "'#{@text[...10]}...'" else "'#{@text}'"
    "ParserState(text=#{truncated}, pos=#{@pos}, end=#{@end}, lineno=#{@lineno}, xpos=#{@xpos}, depth=#{@depth}, work=#{@trampoline.size()})"

  # return a new ParserState with the position advanced 'n' places.
  # the new @lineno and @xpos are adjusted by watching for linefeeds.
  # the previous position is saved as 'oldpos'
  advance: (n) ->
    pos = @pos
    lineno = @lineno
    xpos = @xpos
    while pos < @pos + n
      if @text[pos++] == '\n'
        lineno++
        xpos = 0
      else
        xpos++
    @copy(oldpos: [ @pos, @xpos, @lineno ], pos: pos, lineno: lineno, xpos: xpos)

  # turn (oldpos, pos) into (pos, endpos) to create a covering span for a successful match.
  flip: ->
    [ pos, xpos, lineno ] = if @oldpos? then @oldpos else [ @pos, @xpos, @lineno ]
    @copy(pos: pos, xpos: xpos, lineno: lineno, endpos: @pos, endxpos: @xpos, endlineno: @lineno)

  # rewind oldpos to cover a previous state, too.
  backfill: (otherState) ->
    if @endpos?
      # this state has already been flipped. rewind pos
      @copy(pos: otherState.pos, xpos: otherState.xpos, lineno: otherState.lineno)
    else
      @copy(oldpos: if otherState.oldpos? then otherState.oldpos else [ otherState.pos, otherState.xpos, otherState.lineno ])

  # return the text of the current line around 'pos'.
  line: (pos = @pos) ->
    text = @text
    end = @end
    lstart = pos
    lend = pos
    if lstart > 0 and text[lstart] == '\n' then lstart--
    while lstart > 0 and text[lstart] != '\n' then lstart--
    if text[lstart] == '\n' then lstart++
    while lend < end and text[lend] != '\n' then lend++
    text.slice(lstart, lend)

  # silly indicator (for ascii terminals) of where we are
  around: (width) ->
    line = @line()
    left = @xpos - width
    right = @xpos + width
    if left < 0 then left = 0
    if right >= line.length then right = line.length - 1
    line[left ... @xpos] + "[" + (line[@xpos] or "") + "]" + line[@xpos + 1 ... right + 1]

  getCache: (parser) -> @trampoline.getCache(parser, @)

  addJob: (description, job) -> @trampoline.push @depth, description, job

  deeper: (parser) ->
    newStateName = "#{parser.id}:#{@pos}"
    state = @copy(depth: @depth + 1, stateName: newStateName, previousStateName: @stateName)
    if @debugger?.graph?
      @debugger.graph.addNode(newStateName, parser, state)
      if @stateName? then @debugger.graph.addEdge(@stateName, newStateName)
    state

  logSuccess: ->
    if @debugger?.graph?
      @debugger.graph.addEdge(@stateName, "success")

  logFailure: ->
    # don't do anything for now.

  debugGraphToDot: ->
    return unless @debugger?.graph?
    @debugger.graph.toDot()

  toSquiggles: ->
    line = @line()
    endxpos = @endxpos
    if @endlineno != @lineno
      # multi-line: just show the first line.
      endxpos = line.length
    if endxpos == @xpos then endxpos += 1
    [ line, [0 ... @xpos].map(-> " ").join("") + [@xpos ... endxpos].map(-> "~").join("") ]


class Match
  constructor: (@state, @match, @commit=false) ->
    @ok = true

  toString: -> "Match(state=#{@state}, match=#{util.inspect(@match)}, commit=#{@commit})"

  equals: (other) -> other.ok and @match == other.match and @state.pos == other.state.pos


class NoMatch
  constructor: (@state, @message, @abort=false) ->
    @ok = false

  toString: -> "NoMatch(state=#{@state}, message='#{@message}', abort=#{@abort})"

  equals: (other) -> (not other.ok) and @state.pos == other.state.pos and @message == other.message


exports.ParserState = ParserState
exports.Match = Match
exports.NoMatch = NoMatch
