const { describe, it } = require('node:test');
const assert = require('node:assert');
const { VALID_STYLES } = require('../utils/styles');

describe('VALID_STYLES', () => {
  it('should contain primary style', () => {
    assert.ok(VALID_STYLES.primary !== undefined);
  });

  it('should contain all expected styles', () => {
    const expected = ['primary', 'secondary', 'success', 'danger'];
    for (const s of expected) {
      assert.ok(s in VALID_STYLES, `Missing style: ${s}`);
    }
  });

  it('should not contain invalid styles', () => {
    assert.equal(VALID_STYLES.blurple, undefined);
  });
});
