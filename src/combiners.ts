import {
  defer, fail, mapMatch, Match, MatchFailure, MatchResult, MatchSuccess, mergeSpan, Schedule, schedule, Span, success
} from "./matcher";
import { LazyParser, Parser } from "./parser";
import { quote } from "./strings";

/*
 * chain together parsers p1 & p2 such that if p1 matches, p2 is executed on
 * the following state. if both match, `combiner` is called with the two
 * matched objects, to create a single match result.
 */
export function chain<A, T1, T2, R>(
  p1: LazyParser<A, T1>,
  p2: LazyParser<A, T2>,
  combiner: (r1: T1, r2: T2) => R
): Parser<A, R> {
  return new Parser<A, R>("chain", {
    cacheable: true,
    children: [ p1, p2 ],
    describe: list => `${list[0]} then ${list[1]}`
  }, children => {
    return (stream, index) => {
      return schedule<A, T1, R>(children[0], index, (match1: Match<T1>) => {
        return mapMatch<A, T1, R>(match1, (span1, value1) => {
          return schedule<A, T2, R>(children[1], span1.end, (match2: Match<T2>) => {
            return mapMatch<A, T2, R>(match2, (span2, value2) => {
              return [ new MatchSuccess<R>(mergeSpan(span1, span2), combiner(value1, value2)) ];
            });
          });
        });
      });
    };
  });
}

// for convenience, static type sequences

export function seq2<A, T1, T2>(
  p1: LazyParser<A, T1>,
  p2: LazyParser<A, T2>
): Parser<A, [ T1, T2 ]> {
  return chain(p1, p2, (r1, r2) => [ r1, r2 ] as [ T1, T2 ]);
}

export function seq3<A, T1, T2, T3>(
  p1: LazyParser<A, T1>,
  p2: LazyParser<A, T2>,
  p3: LazyParser<A, T3>
): Parser<A, [ T1, T2, T3 ]> {
  return chain(seq2(p1, p2), p3, (rx, r3) => [ rx[0], rx[1], r3 ] as [ T1, T2, T3 ]);
}

export function seq4<A, T1, T2, T3, T4>(
  p1: LazyParser<A, T1>,
  p2: LazyParser<A, T2>,
  p3: LazyParser<A, T3>,
  p4: LazyParser<A, T4>
): Parser<A, [ T1, T2, T3, T4 ]> {
  return chain(seq3(p1, p2, p3), p4, (rx, r4) => [ rx[0], rx[1], rx[2], r4 ] as [ T1, T2, T3, T4 ]);
}

export function seq5<A, T1, T2, T3, T4, T5>(
  p1: LazyParser<A, T1>,
  p2: LazyParser<A, T2>,
  p3: LazyParser<A, T3>,
  p4: LazyParser<A, T4>,
  p5: LazyParser<A, T5>
): Parser<A, [ T1, T2, T3, T4, T5 ]> {
  return chain(seq4(p1, p2, p3, p4), p5, (rx, r5) => [ rx[0], rx[1], rx[2], rx[3], r5 ] as [ T1, T2, T3, T4, T5 ]);
}

/*
 * chain together a series of parsers as in 'chain'. the match value is an
 * array of non-null match values from the inner parsers.
 */
export function seq<A>(...parsers: LazyParser<A, any>[]): Parser<A, any[]> {
  return new Parser<A, any[]>("seq", {
    cacheable: true,
    children: parsers,
    describe: list => "seq(" + list.join(", ") + ")"
  }, children => {
    function next(i: number, start: number, index: number, rv: any[] = []): MatchResult<A, any[]> {
      if (i >= parsers.length) return success(start, index, rv);
      return schedule<A, any, any[]>(children[i], index, (match: Match<any>) => {
        return mapMatch<A, any, any[]>(match, (span, value) => next(i + 1, start, span.end, rv.concat([ value ])));
      });
    }

    return (stream, index) => next(0, index, index);
  });
}

/*
 * try each of these parsers, in order (starting from the same position),
 * looking for the first match.
 */
export function alt<A, Out>(...parsers: LazyParser<A, Out>[]): Parser<A, Out> {
  const parser: Parser<A, Out> = new Parser<A, Out>("alt", {
    cacheable: true,
    children: parsers,
    describe: list => list.join(" or ")
  }, children => {
    return (stream, index) => {
      let count = 0;
      const fails: MatchFailure<any>[] = [];

      // reverse so the first listed alternative is tried first.
      return children.map(p => {
        return new Schedule<A, Out, Out>(p, index, (match: Match<Out>) => {
          if (match instanceof MatchSuccess) {
            return [ match ];
          } else if (match instanceof MatchFailure) {
            fails.push(match);
          } else {
            throw new Error("impossible");
          }

          // save up all the fails.
          // if *all* of the alternatives fail, summarize it.
          count++;
          if (count == children.length && count == fails.length) {
            return findBestFail(index, fails);
          }
          return [] as MatchResult<A, Out>;
        });
      }).reverse();
    };
  });

  const findBestFail = (index: number, fails: MatchFailure<any>[]): Match<any>[] => {
    let best = fails[0];
    fails.forEach(f => {
      if (f.priority > best.priority || (f.priority == best.priority && f.span.start > best.span.start)) best = f;
    });
    // if the best failure was the same index as we started, none of them
    // were particularly good, so construct a new one.
    if (best.span.start == index && best.priority == 0) {
      return fail(index, parser);
    } else {
      return [ best ];
    }
  }

  return parser;
}

/*
 * allow a parser to fail, and instead return undefined (js equivalent of
 * the Optional type).
 */
export function optional<A, Out>(p: LazyParser<A, Out>): Parser<A, Out | undefined> {
  return optionalOr<A, Out | undefined>(p, undefined);
}

/*
 * allow a parser to fail, and instead return a default value (the empty string
 * if no other value is provided).
 */
export function optionalOr<A, Out>(p: LazyParser<A, Out>, defaultValue: Out): Parser<A, Out> {
  return new Parser<A, Out>("optionalOr", {
    children: [ p ],
    cacheable: (defaultValue == null || typeof defaultValue == "string" || typeof defaultValue == "number"),
    describe: children => `optionalOr(${children[0]}, ${quote(defaultValue ? defaultValue.toString() : defaultValue)})`
  }, children => {
    return (stream, index) => {
      // always succeed, but also try the optional parser.
      return defer<A, Out>(children[0], index).concat(success(index, index, defaultValue) as MatchResult<A, Out>);
    };
  });
}

/*
 * check that this parser matches, but don't advance our position in the
 * string. (perl calls this a zero-width lookahead.)
 */
export function check<A, Out>(p: LazyParser<A, Out>): Parser<A, Out> {
  return new Parser<A, Out>("check", { children: [ p ], cacheable: true }, children => {
    return (stream, index) => {
      return schedule<A, Out, Out>(children[0], index, (match: Match<Out>) => {
        return mapMatch<A, Out, Out>(match, (span, value) => success(index, index, value));
      });
    };
  });
}

/*
 * succeed (with an empty match) if the inner parser fails; otherwise fail.
 */
export function not<A, Out>(p: LazyParser<A, Out>): Parser<A, null> {
  const parser: Parser<A, null> = new Parser<A, null>("not", { children: [ p ], cacheable: true }, children => {
    return (stream, index) => {
      return schedule<A, Out, null>(children[0], index, (match: Match<Out>) => {
        if (match instanceof MatchSuccess) {
          return fail(index, parser);
        } else if (match instanceof MatchFailure) {
          return success(index, index, null);
        } else {
          throw new Error("impossible");
        }
      });
    };
  });
  return parser;
}

export interface RepeatOptions {
  min?: number;
  max?: number;
}

/*
 * from 'min' to 'max' (inclusive) repetitions of a parser, returned as an
 * array. 'max' may be omitted to mean infinity.
 */
export function repeat<A, Out>(p: LazyParser<A, Out>, options: RepeatOptions = {}): Parser<A, Out[]> {
  const min = options.min || 0;
  const max = options.max || Infinity;

  const parser: Parser<A, Out[]> = new Parser<A, Out[]>("repeat", {
    children: [ p ],
    describe: list => list.join() + (max == Infinity ? `{${min}+}` : `{${min}, ${max}}`)
  }, children => {
    return (stream, index) => {
      return next(0, [], index);

      // register any success, and try again if we're allowed to go for more.
      function next(count: number, accumulator: Out[], pos: number): MatchResult<A, Out[]> {
        const rv: MatchResult<A, Out[]> = [];
        if (count >= min) rv.push(new MatchSuccess(new Span(index, pos), accumulator));
        if (count < max) rv.push(new Schedule<A, Out, Out[]>(children[0], pos, (match: Match<Out>) => {
          return process(match, count, accumulator);
        }));
        return rv;
      }

      // process the next match.
      function process(match: Match<Out>, count: number, accumulator: Out[]): MatchResult<A, Out[]> {
        if (match instanceof MatchFailure) {
          if (count < min) {
            return [ new MatchFailure(new Span(index, match.span.start), "Expected " + parser.description) ];
          } else {
            return [];
          }
        } else if (match instanceof MatchSuccess) {
          if (match.span.start == match.span.end) {
            throw new Error(`Repeating parser isn't making progress at position ${match.span.start}: ${children[0]}`);
          }
          return next(count + 1, accumulator.concat([ match.value ]), match.span.end);
        } else {
          throw new Error("impossible");
        }
      }
    };
  });
  return parser;
}
