const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const PROVIDERS = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
};

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';

const clampNumber = (value, min, max) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
};

const toText = (value) => String(value || '').trim();

const normalizeContent = (value) => {
  const text = toText(value);
  return text ? text : '';
};

const normalizeMessage = (message) => {
  if (!message || typeof message !== 'object') return null;
  const role = ['system', 'user', 'assistant'].includes(message.role) ? message.role : null;
  if (!role) return null;
  const content = normalizeContent(message.content);
  if (!content) return null;
  return { role, content };
};

const normalizeMessages = ({ system, prompt, messages }) => {
  const normalized = Array.isArray(messages) ? messages.map(normalizeMessage).filter(Boolean) : [];
  const normalizedSystem = normalizeContent(system);
  const normalizedPrompt = normalizeContent(prompt);

  if (normalizedSystem && !normalized.some((entry) => entry.role === 'system')) {
    normalized.unshift({ role: 'system', content: normalizedSystem });
  }

  if (normalizedPrompt && !normalized.some((entry) => entry.role === 'user')) {
    normalized.push({ role: 'user', content: normalizedPrompt });
  }

  return normalized;
};

const parseOpenAiContent = (content) => {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry?.type === 'text') return entry.text || '';
      return '';
    })
    .join('\n')
    .trim();
};

const parseAnthropicContent = (content) => {
  if (!Array.isArray(content)) return '';
  return content
    .map((entry) => (entry?.type === 'text' ? entry.text || '' : ''))
    .join('\n')
    .trim();
};

const resolveDefaultProvider = () => {
  const configured = toText(process.env.AI_DEFAULT_PROVIDER).toLowerCase();
  if (configured === PROVIDERS.OPENAI || configured === PROVIDERS.ANTHROPIC) return configured;
  if (process.env.OPENAI_API_KEY) return PROVIDERS.OPENAI;
  if (process.env.ANTHROPIC_API_KEY) return PROVIDERS.ANTHROPIC;
  return PROVIDERS.OPENAI;
};

const resolveProvider = (provider) => {
  const requested = toText(provider).toLowerCase();
  return requested || resolveDefaultProvider();
};

const getProviderAvailability = () => ({
  defaultProvider: resolveDefaultProvider(),
  providers: {
    [PROVIDERS.OPENAI]: {
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: DEFAULT_OPENAI_MODEL,
    },
    [PROVIDERS.ANTHROPIC]: {
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      model: DEFAULT_ANTHROPIC_MODEL,
    },
  },
});

const buildRequestOptions = ({ model, temperature, maxTokens }) => {
  const options = {};
  if (model) options.model = model;
  const safeTemperature = clampNumber(temperature, 0, 2);
  if (safeTemperature !== undefined) options.temperature = safeTemperature;
  const safeMaxTokens = clampNumber(maxTokens, 1, 4096);
  if (safeMaxTokens !== undefined) options.maxTokens = safeMaxTokens;
  return options;
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `AI provider request failed with status ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
};

const generateWithOpenAi = async ({ messages, model, temperature, maxTokens }) => {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OPENAI_API_KEY is not configured.');
    error.status = 503;
    throw error;
  }

  const payload = await fetchJson(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_OPENAI_MODEL,
      messages: messages.map((entry) => ({ role: entry.role, content: entry.content })),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    }),
  });

  const text = parseOpenAiContent(payload?.choices?.[0]?.message?.content);

  return {
    provider: PROVIDERS.OPENAI,
    model: payload?.model || model || DEFAULT_OPENAI_MODEL,
    text,
    usage: payload?.usage || null,
    raw: payload,
  };
};

const generateWithAnthropic = async ({ messages, model, temperature, maxTokens }) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    const error = new Error('ANTHROPIC_API_KEY is not configured.');
    error.status = 503;
    throw error;
  }

  const system = messages.filter((entry) => entry.role === 'system').map((entry) => entry.content).join('\n\n').trim();
  const conversation = messages
    .filter((entry) => entry.role !== 'system')
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      content: entry.content,
    }));

  const payload = await fetchJson(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: maxTokens || 1024,
      messages: conversation,
      ...(system ? { system } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    }),
  });

  const text = parseAnthropicContent(payload?.content);

  return {
    provider: PROVIDERS.ANTHROPIC,
    model: payload?.model || model || DEFAULT_ANTHROPIC_MODEL,
    text,
    usage: payload?.usage || null,
    raw: payload,
  };
};

const generateText = async (input = {}) => {
  const provider = resolveProvider(input.provider);
  const messages = normalizeMessages(input);

  if (!messages.length) {
    const error = new Error('Provide either `prompt` or a non-empty `messages` array.');
    error.status = 400;
    throw error;
  }

  const options = buildRequestOptions(input);

  if (provider === PROVIDERS.OPENAI) {
    return generateWithOpenAi({ messages, ...options });
  }

  if (provider === PROVIDERS.ANTHROPIC) {
    return generateWithAnthropic({ messages, ...options });
  }

  const error = new Error(`Unsupported AI provider: ${provider}.`);
  error.status = 400;
  throw error;
};

module.exports = {
  PROVIDERS,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  getProviderAvailability,
  normalizeMessages,
  generateText,
};
