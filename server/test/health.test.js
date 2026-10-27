import test from 'node:test';
import assert from 'node:assert/strict';
import { healthResponse } from '../src/health.js';

test('health response reports the application is running', () => {
  const result = healthResponse();
  assert.equal(result.status, 'ok');
  assert.equal(result.service, 'maringo-sports-club-api');
});

test('health response does not falsely claim database is connected', () => {
  const result = healthResponse();
  assert.equal(Object.hasOwn(result, 'databaseConnected'), false);
});
