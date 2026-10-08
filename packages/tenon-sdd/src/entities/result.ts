export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function parsed<T>(value: T, errors: readonly string[]): ParseResult<T> {
  return errors.length ? { ok: false, errors: [...errors] } : { ok: true, value };
}

export function errorsOf(result: ParseResult<unknown>): string[] {
  return result.ok ? [] : result.errors;
}
