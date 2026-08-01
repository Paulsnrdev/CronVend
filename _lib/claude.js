'use strict';

const Anthropic = require('@anthropic-ai/sdk');

let _client;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

async function getUpsellRecommendations({ customerName, previousItems, storeName }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const itemList = (previousItems || [])
    .map(i => `- ${i.name}${i.quantity > 1 ? ` (x${i.quantity})` : ''}`)
    .join('\n') || '- (no item details available)';

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: `You are a concise email copywriter for e-commerce stores. Write warm, natural upsell copy — never pushy. Never invent specific product names; keep suggestions category-level.`,
    messages: [{
      role: 'user',
      content: `Store: "${storeName}"
Customer: ${customerName}
Previous purchase:
${itemList}

Write a single friendly paragraph (2–3 sentences) suggesting complementary products they'd love, then a soft call to action to browse the store. Reply with only the paragraph.`,
    }],
  });

  return response.content[0]?.text?.trim() || null;
}

module.exports = { getUpsellRecommendations };
