import { ParseTask } from "./engine";
import { Parser } from "./parser";

// a thing that can be parsed. any Array<A> should work.
export interface Sequence<A> {
  readonly length: number;
  readonly [index: number]: A;
  slice(start: number, end?: number): Sequence<A>;
}

export class Span {
  constructor(public readonly start: number, public readonly end: number) {
    // pass
  }

  toString() {
    return `[${this.start}...${this.end}]`;
  }
}

export function mergeSpan(span1: Span, span2: Span): Span {
  return (span1.start < span2.start || span1.end < span2.end) ? new Span(span1.start, span2.end) : new Span(span2.start, span1.end);
}

export class MatchSuccess<Out> {
  constructor(public span: Span, public value: Out) {
    // pass
  }

  toString() {
    return `Success(${this.span})`;
  }
}

export class MatchFailure<A, Out> {
  constructor(public span: Span, public message: string, public task?: ParseTask<A, Out>) {
    // pass
  }

  toString() {
    return `Failure(${this.span}, ${this.message})`;
  }
}

export type Match<A, Out> = MatchSuccess<Out> | MatchFailure<A, Out>;

// request to schedule another parser and respond to its result
export class Schedule<A, R, Out> {
  constructor(
    public parser: Parser<A, R>,
    public index: number,
    public handler: (result: Match<A, R>) => MatchResult<A, Out>
  ) {
    // pass
  }
}

export type MatchResult<A, Out> = (Match<A, Out> | Schedule<A, any, Out>)[];

export type Matcher<A, Out> = (stream: Sequence<A>, index: number) => MatchResult<A, Out>;


// helpers:

export function fail<A, Out>(
  index: number, message: string | Parser<any, any>, task?: ParseTask<A, Out>
): Match<A, any>[] {
  const match = new MatchFailure(
    new Span(index, index),
    message instanceof Parser ? ("Expected " + message.description) : message,
    task
  );
  return [ match ];
}

export function success<A, Out>(start: number, end: number, value: Out): Match<A, Out>[] {
  return [ new MatchSuccess(new Span(start, end), value) ];
}

export function schedule<A, R, Out>(
  parser: Parser<A, R>,
  index: number,
  handler: (result: Match<A, R>) => MatchResult<A, Out>
): MatchResult<A, Out> {
  return [ new Schedule<A, R, Out>(parser, index, handler) ];
}

export function defer<A, Out>(
  parser: Parser<A, Out>,
  index: number
): MatchResult<A, Out> {
  return [ new Schedule<A, Out, Out>(parser, index, match => [ match ]) ];
}

// pass failures through, but map successes
export function mapMatch<A, T1, T2>(
  match: Match<A, T1>,
  f: (span: Span, value: T1) => MatchResult<A, T2>
): MatchResult<A, T2> {
  if (match instanceof MatchFailure) {
    return [ match as any as MatchFailure<A, T2> ];
  } else if (match instanceof MatchSuccess) {
    return f(match.span, match.value);
  } else {
    // typescript bug
    throw new Error("impossible");
  }
}
