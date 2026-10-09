const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const coinflip = require('../commands/coinflip');

describe('coinflip command', () => {
  it('registers rounds from 1 to 5', () => {
    const option = coinflip.data.toJSON().options[0];
    assert.equal(option.min_value, 1);
    assert.equal(option.max_value, 5);
  });

  it('creates stable result keys', () => {
    assert.equal(coinflip._test.resultKey(['heads', 'tails', 'heads']), 'H-T-H');
  });

  it('generates exactly the requested number of valid results', () => {
    const results = coinflip._test.generateResults(5);
    assert.equal(results.length, 5);
    assert.ok(results.every(result => result === 'heads' || result === 'tails'));
  });

  it('creates summary embed with no description', () => {
    const embed = coinflip._test.createSummaryEmbed().toJSON();
    assert.equal(embed.description, undefined);
    assert.equal(embed.title, 'Coinflip Results');
  });
});
