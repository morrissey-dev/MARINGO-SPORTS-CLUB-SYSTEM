// A pure function: creates predictable API output and is easy to test.
export function healthResponse() {
  return {
    status: 'ok',
    service: 'maringo-sports-club-api',
    version: '0.1.0',
    note: 'API running; database connection checked separately.',
  };
}
