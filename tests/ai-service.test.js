const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeMessages,
  getProviderAvailability,
} = require('../services/ai-service');

test('normalizeMessages merges system and prompt into provider-neutral messages', () => {
  const output = normalizeMessages({
    system: 'You are concise.',
    prompt: 'Summarize this.',
  });

  assert.deepEqual(output, [
    { role: 'system', content: 'You are concise.' },
    { role: 'user', content: 'Summarize this.' },
  ]);
});

test('normalizeMessages drops empty and invalid messages', () => {
  const output = normalizeMessages({
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'tool', content: 'ignore me' },
      { role: 'assistant', content: '  ' },
    ],
  });

  assert.deepEqual(output, [{ role: 'user', content: 'Hello' }]);
});

test('getProviderAvailability reports configured providers and defaults', () => {
  const originalOpenAi = process.env.OPENAI_API_KEY;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalDefault = process.env.AI_DEFAULT_PROVIDER;

  process.env.OPENAI_API_KEY = 'test-openai';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_DEFAULT_PROVIDER;

  const output = getProviderAvailability();

  assert.equal(output.defaultProvider, 'openai');
  assert.equal(output.providers.openai.configured, true);
  assert.equal(output.providers.anthropic.configured, false);

  if (typeof originalOpenAi === 'string') process.env.OPENAI_API_KEY = originalOpenAi;
  else delete process.env.OPENAI_API_KEY;
  if (typeof originalAnthropic === 'string') process.env.ANTHROPIC_API_KEY = originalAnthropic;
  else delete process.env.ANTHROPIC_API_KEY;
  if (typeof originalDefault === 'string') process.env.AI_DEFAULT_PROVIDER = originalDefault;
  else delete process.env.AI_DEFAULT_PROVIDER;
});
