/* AI Studio — natural-language playlist generation. */

import { h, mount, api, store, toast, fmtDuration } from '../core.js';
import { icon } from '../icons.js';
import { trackList, emptyState, sectionHead, featureBars, loadingRows } from '../components.js';
import { playQueue } from '../player.js';

const SUGGESTIONS = [
  'rainy night drive, moody afrobeats',
  'high energy gym session',
  '90s r&b slow jams for a date night',
  'deep focus instrumentals for coding',
  'sunday morning gospel and soul',
  'amapiano party starters',
  'sad indie songs for overthinking',
  'nostalgic 2000s throwbacks',
];

let lastResult = null;

export function renderAI(root, { navigate }) {
  const resultSlot = h('div');
  const aiStatus = store.get().aiStatus;

  const input = h('input', {
    class: 'input',
    placeholder: 'Describe a vibe… e.g. "late night amapiano for a long drive"',
    maxlength: '300',
    value: '',
  });

  const sizeSelect = h(
    'select',
    { class: 'select', style: { maxWidth: '128px' } },
    ...[10, 15, 20, 25, 30].map((n) => h('option', { value: String(n), selected: n === 20 }, `${n} tracks`))
  );

  const genBtn = h('button', { class: 'btn btn-primary' }, icon('sparkle'), 'Generate');

  const generate = async (prompt) => {
    const value = String(prompt ?? input.value).trim();
    if (value.length < 2) {
      toast('Describe the vibe you want first', 'error');
      input.focus();
      return;
    }
    input.value = value;
    genBtn.disabled = true;
    genBtn.replaceChildren(h('div', { class: 'spinner' }), document.createTextNode('Composing…'));

    mount(
      resultSlot,
      h(
        'div',
        { class: 'section' },
        h(
          'div',
          { class: 'glass', style: { borderRadius: 'var(--radius-lg)', padding: '22px', marginBottom: '18px' } },
          h(
            'div',
            { class: 'flex items-center gap-12' },
            h('div', { class: 'spinner spinner-lg' }),
            h(
              'div',
              {},
              h('div', { style: { fontWeight: '700', fontSize: '15px' } }, 'Reading the vibe…'),
              h('div', { class: 'text-sm text-dim', style: { marginTop: '4px' } }, `Matching "${value}" against millions of tracks`)
            )
          )
        ),
        loadingRows(8)
      )
    );

    try {
      const data = await api.post('/api/ai/playlist', { prompt: value, limit: Number(sizeSelect.value) });
      lastResult = data;
      paintResult(data, value);
    } catch (err) {
      mount(
        resultSlot,
        emptyState({
          iconName: 'x',
          title: 'Could not build that playlist',
          text: err.message,
          action: h('button', { class: 'btn btn-primary', onclick: () => generate(value) }, 'Try again'),
        })
      );
    } finally {
      genBtn.disabled = false;
      genBtn.replaceChildren(icon('sparkle'), document.createTextNode('Generate'));
    }
  };

  const paintResult = (data, prompt) => {
    const totalMs = data.tracks.reduce((s, t) => s + (t.durationMs || 0), 0);

    const saveBtn = h('button', { class: 'btn btn-primary' }, icon('plus'), 'Save as playlist');
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.replaceChildren(h('div', { class: 'spinner' }), document.createTextNode('Saving…'));
      try {
        const res = await api.post('/api/playlists', {
          name: data.name,
          description: data.description,
          isPublic: true,
          aiGenerated: true,
          aiPrompt: prompt,
          aiIntent: data.intent,
          tracks: data.tracks,
        });
        toast(`Saved "${res.playlist.name}" with ${res.playlist.trackCount} tracks`);
        window.dispatchEvent(new CustomEvent('sonora:playlists-changed'));
        navigate('playlist', { id: res.playlist.id });
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.replaceChildren(icon('plus'), document.createTextNode('Save as playlist'));
        toast(err.message, 'error');
      }
    });

    const intentChips = [
      ...(data.intent.moods || []).map((m) => ({ label: m, kind: 'mood' })),
      ...(data.intent.genres || []).map((g) => ({ label: g === 'rnb' ? 'R&B' : g, kind: 'genre' })),
      ...(data.intent.artistHints || []).map((a) => ({ label: `like ${a}`, kind: 'artist' })),
      ...(data.intent.decade ? [{ label: `${data.intent.decade.from}s`, kind: 'era' }] : []),
    ];

    mount(
      resultSlot,
      h(
        'div',
        { class: 'section' },
        h(
          'div',
          { class: 'detail-head', style: { alignItems: 'flex-start' } },
          h(
            'div',
            { class: 'detail-cover' },
            data.tracks.filter((t) => t.artwork).length >= 4
              ? h(
                  'div',
                  { class: 'detail-cover-grid' },
                  ...data.tracks
                    .filter((t) => t.artwork)
                    .slice(0, 4)
                    .map((t) => h('img', { src: t.artwork, alt: '' }))
                )
              : data.tracks[0]?.artwork
              ? h('img', { src: data.tracks[0].artwork, alt: '' })
              : h('div', { class: 'detail-cover-fallback' }, '✨')
          ),
          h(
            'div',
            { class: 'detail-meta' },
            h('div', { class: 'detail-kicker' }, h('span', { class: 'badge badge-ai' }, 'AI generated'), ' · draft'),
            h('h2', { class: 'detail-title', style: { fontSize: '30px' } }, data.name),
            h('p', { class: 'detail-desc' }, data.description),
            h(
              'div',
              { class: 'detail-facts' },
              `${data.tracks.length} tracks`,
              h('span', { class: 'dot-sep' }),
              fmtDuration(totalMs),
              h('span', { class: 'dot-sep' }),
              `engine: ${data.intent.source === 'llm' ? 'LLM + feature match' : 'feature match'}`
            ),
            intentChips.length
              ? h(
                  'div',
                  { class: 'flex wrap gap-6', style: { marginTop: '13px' } },
                  ...intentChips.map((c) => h('span', { class: 'chip chip-static' }, c.label))
                )
              : null,
            h(
              'div',
              { class: 'detail-actions' },
              h(
                'button',
                { class: 'btn', onclick: () => playQueue(data.tracks, 0, { queueName: data.name }) },
                icon('play'),
                'Play'
              ),
              saveBtn,
              h('button', { class: 'btn btn-ghost', onclick: () => generate(prompt) }, icon('repeat'), 'Regenerate')
            )
          )
        ),
        h(
          'div',
          {
            style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,250px)', gap: '20px', alignItems: 'start' },
            class: 'ai-result-layout',
          },
          h('div', {}, trackList(data.tracks, { contextName: data.name })),
          h(
            'div',
            { class: 'glass', style: { borderRadius: 'var(--radius)', padding: '17px', position: 'sticky', top: '80px' } },
            h('div', { style: { fontSize: '13px', fontWeight: '700', marginBottom: '4px' } }, 'Target sound profile'),
            h(
              'p',
              { class: 'text-xs text-faint', style: { marginBottom: '14px', lineHeight: '1.5' } },
              'Every track is scored against this 5-dimension vector.'
            ),
            featureBars(data.intent.target),
            h(
              'div',
              { style: { marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--stroke)' } },
              h('div', { class: 'text-xs text-dim', style: { fontWeight: '650', marginBottom: '8px' } }, 'Catalog queries used'),
              h(
                'div',
                { class: 'flex-col gap-6' },
                ...(data.intent.queries || []).map((q) => h('div', { class: 'text-xs text-faint' }, `· ${q}`))
              )
            )
          )
        )
      )
    );

    const layout = resultSlot.querySelector('.ai-result-layout');
    const applyLayout = () => {
      if (layout) layout.style.gridTemplateColumns = window.innerWidth < 900 ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,250px)';
    };
    applyLayout();
    window.addEventListener('resize', applyLayout);
  };

  genBtn.addEventListener('click', () => generate());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') generate();
  });

  mount(
    root,
    h(
      'div',
      { class: 'ai-hero' },
      h(
        'div',
        { class: 'flex items-center gap-12', style: { marginBottom: '6px' } },
        h('span', { class: 'badge badge-ai' }, 'AI Studio'),
        aiStatus?.enabled ? h('span', { class: 'badge badge-full' }, aiStatus.provider) : null
      ),
      h('h1', { class: 'page-title', style: { marginTop: '10px' } }, 'Describe a vibe. Get a playlist.'),
      h(
        'p',
        { class: 'page-sub', style: { maxWidth: '640px' } },
        'Sonora parses your mood, genre, era and artist references, then scores millions of real tracks against a 5-dimension sound profile.',
        aiStatus && !aiStatus.enabled
          ? ' Running on the built-in engine — add an LLM key to .env for even sharper naming.'
          : ''
      ),
      h('div', { class: 'ai-prompt-row' }, input, sizeSelect, genBtn),
      h(
        'div',
        { class: 'ai-suggestions' },
        ...SUGGESTIONS.map((s) =>
          h(
            'button',
            {
              class: 'chip',
              onclick: () => {
                input.value = s;
                generate(s);
              },
            },
            s
          )
        )
      )
    ),
    resultSlot
  );

  if (lastResult) paintResult(lastResult, lastResult.intent?.prompt || '');
  else
    mount(
      resultSlot,
      emptyState({
        iconName: 'sparkle',
        title: 'Your AI mix will appear here',
        text: 'Pick a suggestion above or write your own prompt. Try naming a mood, a genre, a decade, or an artist to sound like.',
      })
    );
}
