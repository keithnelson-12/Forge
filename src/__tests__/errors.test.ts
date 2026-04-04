/**
 * Error class tests — verify status codes, codes, and inheritance.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, ValidationError, UnauthorizedError, NotFoundError } from '../errors.js';

describe('AppError', () => {
  it('sets message, statusCode, and default code', () => {
    const err = new AppError('something went wrong', 500);
    assert.equal(err.message, 'something went wrong');
    assert.equal(err.statusCode, 500);
    assert.equal(err.code, 'ERR_500');
    assert.equal(err.name, 'AppError');
  });

  it('accepts an explicit code', () => {
    const err = new AppError('bad thing', 503, 'SERVICE_UNAVAILABLE');
    assert.equal(err.code, 'SERVICE_UNAVAILABLE');
  });

  it('is an instance of Error', () => {
    assert.ok(new AppError('x', 500) instanceof Error);
  });

  it('is an instance of AppError', () => {
    assert.ok(new AppError('x', 500) instanceof AppError);
  });
});

describe('ValidationError', () => {
  it('has status 400 and VALIDATION_ERROR code', () => {
    const err = new ValidationError('bad input');
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.name, 'ValidationError');
  });

  it('extends AppError', () => {
    assert.ok(new ValidationError('x') instanceof AppError);
  });

  it('extends Error', () => {
    assert.ok(new ValidationError('x') instanceof Error);
  });
});

describe('UnauthorizedError', () => {
  it('has status 401 and UNAUTHORIZED code', () => {
    const err = new UnauthorizedError();
    assert.equal(err.statusCode, 401);
    assert.equal(err.code, 'UNAUTHORIZED');
    assert.equal(err.message, 'Unauthorized');
  });

  it('accepts custom message', () => {
    const err = new UnauthorizedError('bad key');
    assert.equal(err.message, 'bad key');
  });

  it('extends AppError', () => {
    assert.ok(new UnauthorizedError() instanceof AppError);
  });
});

describe('NotFoundError', () => {
  it('has status 404 and NOT_FOUND code', () => {
    const err = new NotFoundError('container not found');
    assert.equal(err.statusCode, 404);
    assert.equal(err.code, 'NOT_FOUND');
  });

  it('has correct message', () => {
    const err = new NotFoundError('thing not found');
    assert.equal(err.message, 'thing not found');
  });

  it('extends AppError', () => {
    assert.ok(new NotFoundError('x') instanceof AppError);
  });
});
