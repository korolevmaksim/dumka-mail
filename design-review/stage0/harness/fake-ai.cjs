// Canned, fully synthetic model replies for the fake OpenAI-compatible endpoint.
// The first version only echoes a neutral answer; request bodies are logged by
// fake-backend.cjs so replies can be shaped to what the app actually asks for.
'use strict';

function lastUserText(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const user = [...messages].reverse().find(m => m.role === 'user');
  const content = user?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part.text || '').join('\n');
  return '';
}

function systemText(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.find(m => m.role === 'system');
  return typeof system?.content === 'string' ? system.content : '';
}

function aiReply(body, context) {
  const custom = tryCustom(body, context);
  if (custom) return custom;
  return 'Here is a short summary based on the cached mail: three conversations need a reply today (pilot date, board numbers, contract redlines), and the rest is informational.';
}

function tryCustom(body, context) {
  try {
    // eslint-disable-next-line global-require
    const rules = require('./fake-ai-rules.cjs');
    return rules.reply({ body, system: systemText(body), user: lastUserText(body), context });
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return null;
    return null;
  }
}

module.exports = { aiReply, lastUserText, systemText };
