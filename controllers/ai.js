const express = require('express');

const requireAuthUser = require('../middleware/require-auth-user');
const { ok, fail } = require('../utils/respond');
const { generateText, getProviderAvailability } = require('../services/ai-service');

const router = express.Router();

router.use(requireAuthUser);

router.get('/providers', (req, res) => ok(res, getProviderAvailability()));

router.post('/generate', async (req, res, next) => {
  try {
    const result = await generateText({
      provider: req.body.provider,
      model: req.body.model,
      system: req.body.system,
      prompt: req.body.prompt,
      messages: req.body.messages,
      temperature: req.body.temperature,
      maxTokens: req.body.maxTokens,
    });

    return ok(res, {
      provider: result.provider,
      model: result.model,
      text: result.text,
      usage: result.usage,
    });
  } catch (error) {
    if (error.status) {
      return fail(res, error.message, error.status);
    }
    return next(error);
  }
});

module.exports = router;
