/* Profile & settings: edit account, provider status, danger zone. */

import { h, mount, api, store, toast, confirmDialog, fmtDuration } from '../core.js';
import { icon } from '../icons.js';
import { avatar, emptyState, playlistCard, sectionHead, spinnerBlock } from '../components.js';

export function renderProfile(root, { navigate, onSignedOut }) {
  const user = store.get().user;
  const slot = h('div');
  mount(root, slot);
  mount(slot, spinnerBlock('Loading your profile…'));

  Promise.all([api.get('/api/stats'), api.get(`/api/users/${user.handle}`), api.get('/api/providers')])
    .then(([{ stats }, profileData, provData]) => paint(stats, profileData, provData))
    .catch((err) => mount(slot, emptyState({ iconName: 'x', title: 'Could not load profile', text: err.message })));

  function paint(stats, profileData, provData) {
    /* ---------------------------------------------------- edit form */
    const nameInput = h('input', { class: 'input', value: user.displayName, maxlength: '60' });
    const handleInput = h('input', { class: 'input', value: user.handle, maxlength: '20' });
    const bioInput = h('textarea', { class: 'textarea', maxlength: '300', placeholder: 'Tell people what you listen to…' });
    bioInput.value = user.bio || '';

    const saveBtn = h('button', { class: 'btn btn-primary' }, 'Save changes');
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.replaceChildren(h('div', { class: 'spinner' }), document.createTextNode('Saving…'));
      try {
        const { user: updated } = await api.patch('/api/me', {
          displayName: nameInput.value.trim(),
          handle: handleInput.value.trim(),
          bio: bioInput.value.trim(),
        });
        store.set({ user: { ...store.get().user, ...updated } });
        toast('Profile updated');
        window.dispatchEvent(new CustomEvent('sonora:user-changed'));
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.replaceChildren(document.createTextNode('Save changes'));
      }
    });

    /* -------------------------------------------------------- stats */
    const statCards = [
      { icon: 'listMusic', value: stats.playlists, label: 'Playlists' },
      { icon: 'heart', value: stats.savedTracks, label: 'Saved' },
      { icon: 'share', value: stats.shares, label: 'Posts' },
      { icon: 'wave', value: stats.plays, label: 'Plays' },
      { icon: 'clock', value: fmtDuration(stats.listenedMs), label: 'Listened' },
      { icon: 'users', value: stats.followers, label: 'Followers' },
    ];

    mount(
      slot,
      h(
        'div',
        { class: 'detail-head' },
        h('div', { style: { flexShrink: '0' } }, avatar(user, 118)),
        h(
          'div',
          { class: 'detail-meta' },
          h('div', { class: 'detail-kicker' }, 'Your profile'),
          h('h1', { class: 'detail-title' }, user.displayName),
          h('p', { class: 'detail-desc' }, user.bio || 'No bio yet — add one below.'),
          h(
            'div',
            { class: 'detail-facts' },
            `@${user.handle}`,
            h('span', { class: 'dot-sep' }),
            user.email,
            h('span', { class: 'dot-sep' }),
            `joined ${new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`
          )
        )
      ),

      h(
        'div',
        { class: 'section' },
        sectionHead('At a glance'),
        h(
          'div',
          { class: 'stat-grid' },
          ...statCards.map((c) =>
            h(
              'div',
              { class: 'stat-card' },
              h('div', { class: 'stat-icon' }, icon(c.icon)),
              h('div', { class: 'stat-value' }, String(c.value)),
              h('div', { class: 'stat-label' }, c.label)
            )
          )
        )
      ),

      stats.topArtists?.length
        ? h(
            'div',
            { class: 'section' },
            sectionHead('Your top artists'),
            h(
              'div',
              { class: 'flex wrap gap-8' },
              ...stats.topArtists.map((a, i) =>
                h('span', { class: 'chip chip-static' }, `${i + 1}. ${a.name}`, h('span', { class: 'text-faint' }, ` · ${a.plays}`))
              )
            )
          )
        : null,

      h(
        'div',
        { class: 'section' },
        sectionHead('Account settings'),
        h(
          'div',
          { class: 'glass', style: { borderRadius: 'var(--radius-lg)', padding: '22px' } },
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '16px' } },
            h('div', { class: 'field' }, h('label', { class: 'label' }, 'Display name'), nameInput),
            h('div', { class: 'field' }, h('label', { class: 'label' }, 'Handle'), handleInput, h('div', { class: 'hint' }, 'Letters, numbers and underscores'))
          ),
          h('div', { class: 'field', style: { marginTop: '16px' } }, h('label', { class: 'label' }, 'Bio'), bioInput),
          h('div', { style: { marginTop: '16px' } }, saveBtn)
        )
      ),

      h(
        'div',
        { class: 'section' },
        sectionHead('Connected catalogs'),
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: '14px' } },
          ...provData.providers.map((p) =>
            h(
              'div',
              { class: 'glass', style: { borderRadius: 'var(--radius)', padding: '16px' } },
              h(
                'div',
                { class: 'flex items-center justify-between', style: { marginBottom: '8px' } },
                h('div', { class: 'flex items-center gap-8' }, h('span', { class: `prov-dot prov-${p.key}` }), h('strong', { style: { fontSize: '14px' } }, p.label)),
                h('span', { class: `badge ${p.enabled ? 'badge-full' : 'badge-private'}` }, p.enabled ? 'Active' : 'Off')
              ),
              h('p', { class: 'text-xs text-dim', style: { lineHeight: '1.55' } }, p.note)
            )
          ),
          h(
            'div',
            { class: 'glass', style: { borderRadius: 'var(--radius)', padding: '16px' } },
            h(
              'div',
              { class: 'flex items-center justify-between', style: { marginBottom: '8px' } },
              h('div', { class: 'flex items-center gap-8' }, icon('sparkle'), h('strong', { style: { fontSize: '14px' } }, 'AI engine')),
              h('span', { class: `badge ${provData.ai.enabled ? 'badge-full' : 'badge-ai'}` }, provData.ai.enabled ? provData.ai.provider : 'Built-in')
            ),
            h('p', { class: 'text-xs text-dim', style: { lineHeight: '1.55' } }, provData.ai.note)
          )
        )
      ),

      h(
        'div',
        { class: 'section' },
        sectionHead('Danger zone'),
        h(
          'div',
          {
            class: 'glass',
            style: { borderRadius: 'var(--radius-lg)', padding: '22px', borderColor: 'rgba(251,113,133,.28)' },
          },
          h(
            'div',
            { class: 'flex items-center justify-between wrap gap-16' },
            h(
              'div',
              {},
              h('div', { style: { fontWeight: '700', marginBottom: '5px' } }, 'Sign out'),
              h('p', { class: 'text-sm text-dim' }, 'End this session on this device.')
            ),
            h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  await api.post('/api/auth/logout');
                  onSignedOut();
                },
              },
              icon('logout'),
              'Sign out'
            )
          ),
          h('div', { style: { height: '1px', background: 'var(--stroke)', margin: '18px 0' } }),
          h(
            'div',
            { class: 'flex items-center justify-between wrap gap-16' },
            h(
              'div',
              {},
              h('div', { style: { fontWeight: '700', marginBottom: '5px', color: 'var(--danger)' } }, 'Delete account'),
              h('p', { class: 'text-sm text-dim' }, 'Permanently removes your playlists, library, posts and comments.')
            ),
            h(
              'button',
              {
                class: 'btn btn-danger',
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: 'Delete your account?',
                    message: 'Every playlist, saved track, post and comment will be permanently erased. This cannot be undone.',
                    confirmLabel: 'Delete everything',
                  });
                  if (!ok) return;
                  try {
                    await api.del('/api/me');
                    toast('Your account has been deleted');
                    onSignedOut();
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              icon('trash'),
              'Delete account'
            )
          )
        )
      )
    );
  }
}
