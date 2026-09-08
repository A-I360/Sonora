'use strict';
/**
 * Optional LLM refinement layer.
 *
 * Sonora's AI works with zero keys. If OPENAI_API_KEY or ANTHROPIC_API_KEY is
 * set, we ask the model to sharpen the parsed intent — better playlist names,
 * smarter catalog queries, mood/genre extraction the rules layer missed.
 *
 * Every failure path silently falls back to the deterministic engine.
 */

const { fetchRaw } = require('../fetchx');

function provider() {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function isEnabled() {
  return provider() !== null;
}

function status() {
  const p = provider();
  return {
    enabled: Boolean(p),
    provider: p,
    note: p
      ? `LLM refinement active via ${p}`
      : 'Deterministic engine (add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env for LLM refinement)',
  };
}

const SYSTEM = `You are a music curation engine. Given a user's playlist request, respond with STRICT JSON only:
{"name":"short catchy playlist name (max 6 words)","description":"one sentence, max 140 chars","moods":["from: chill,hype,sad,happy,moody,romantic,focus,party,nostalgic,driving,sleep,confident"],"genres":["from: afrobeats,hiphop,rnb,pop,rock,electronic,jazz,classical,reggae,latin,country,gospel,kpop"],"queries":["3-6 music search queries that would surface matching real songs"],"artistHints":["artist names if the user referenced any"]}
No markdown, no prose, JSON object only.`;

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callOpenAI(prompt) {
  const res = await fetchRaw('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 400,
    }),
    timeout: 15000,
  });
  const data = JSON.parse(res.body);
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(prompt) {
  const res = await fetchRaw('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022',
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
    timeout: 15000,
  });
  const data = JSON.parse(res.body);
  return data.content?.[0]?.text || '';
}

/** Returns a partial intent patch, or null to keep the rules-based result. */
async function refineIntent(prompt, baseIntent) {
  const p = provider();
  if (!p) return null;
  const raw = p === 'openai' ? await callOpenAI(prompt) : await callAnthropic(prompt);
  const parsed = extractJson(raw);
  if (!parsed) return null;

  const patch = {};
  if (typeof parsed.name === 'string' && parsed.name.trim()) patch.name = parsed.name.trim().slice(0, 60);
  if (typeof parsed.description === 'string' && parsed.description.trim()) {
    patch.description = parsed.description.trim().slice(0, 200);
  }
  if (Array.isArray(parsed.queries) && parsed.queries.length) {
    patch.queries = [...new Set([...parsed.queries.filter((q) => typeof q === 'string' && q.trim()).slice(0, 6), ...baseIntent.queries])].slice(0, 6);
  }
  if (Array.isArray(parsed.moods)) patch.moods = [...new Set([...baseIntent.moods, ...parsed.moods.filter((x) => typeof x === 'string')])];
  if (Array.isArray(parsed.genres)) patch.genres = [...new Set([...baseIntent.genres, ...parsed.genres.filter((x) => typeof x === 'string')])];
  if (Array.isArray(parsed.artistHints)) {
    patch.artistHints = [...new Set([...baseIntent.artistHints, ...parsed.artistHints.filter((x) => typeof x === 'string')])];
  }
  return patch;
}

module.exports = { isEnabled, status, refineIntent, provider };
