/* Community feed: posts, comments, likes — all optimistic. */

import { h, mount, api, store, toast, timeAgo, optimistic, confirmDialog, openModal } from '../core.js';
import { icon } from '../icons.js';
import { avatar, emptyState, loadingRows } from '../components.js';
import { playTrack } from '../player.js';

export function renderFeed(root, { navigate }) {
  let scope = 'all';
  const list = h('div', { class: 'feed' });

  /* ------------------------------------------------------- composer */
  const composerInput = h('textarea', {
    class: 'textarea',
    placeholder: 'What are you listening to? Share a thought…',
    maxlength: '500',
    style: { minHeight: '68px' },
  });

  const postBtn = h('button', { class: 'btn btn-primary' }, icon('share'), 'Post');
  postBtn.addEventListener('click', async () => {
    const message = composerInput.value.trim();
    if (!message) return toast('Write something first', 'error');
    postBtn.disabled = true;
    postBtn.replaceChildren(h('div', { class: 'spinner' }), document.createTextNode('Posting…'));
    try {
      const { share } = await api.post('/api/shares', { message });
      composerInput.value = '';
      list.prepend(postCard(share, { navigate, onDelete: load }));
      toast('Posted to the feed');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      postBtn.disabled = false;
      postBtn.replaceChildren(icon('share'), document.createTextNode('Post'));
    }
  });

  const composer = h(
    'div',
    { class: 'post', style: { marginBottom: '18px' } },
    h('div', { class: 'flex gap-12' }, avatar(store.get().user, 38), h('div', { style: { flex: 1 } }, composerInput)),
    h('div', { class: 'flex justify-between items-center', style: { marginTop: '12px' } },
      h('span', { class: 'text-xs text-faint' }, 'Tip: use the share icon on any track to post it with audio'),
      postBtn)
  );

  const load = async () => {
    mount(list, loadingRows(4));
    try {
      const { shares } = await api.get(`/api/shares?scope=${scope}`);
      if (!shares.length) {
        mount(
          list,
          emptyState({
            iconName: 'users',
            title: scope === 'mine' ? 'You have not posted yet' : 'The feed is quiet',
            text:
              scope === 'mine'
                ? 'Share a track or playlist and it will show up here.'
                : 'Be the first to share something — post a thought above, or share a track from search.',
            action: h('button', { class: 'btn btn-primary', onclick: () => navigate('search') }, icon('search'), 'Find a track to share'),
          })
        );
        return;
      }
      mount(list, ...shares.map((s) => postCard(s, { navigate, onDelete: load })));
    } catch (err) {
      mount(list, emptyState({ iconName: 'x', title: 'Could not load the feed', text: err.message }));
    }
  };

  mount(
    root,
    h(
      'div',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Community'),
      h('p', { class: 'page-sub' }, 'What music lovers on Sonora are playing right now.')
    ),
    h(
      'div',
      { class: 'tabs' },
      ...[
        ['all', 'Everyone'],
        ['following', 'Following'],
        ['mine', 'My posts'],
      ].map(([key, label]) =>
        h(
          'button',
          {
            class: `tab ${scope === key ? 'active' : ''}`,
            onclick: (e) => {
              scope = key;
              [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('active'));
              e.currentTarget.classList.add('active');
              load();
            },
          },
          label
        )
      )
    ),
    composer,
    list
  );

  load();
  window.addEventListener('sonora:shares-changed', load);
}

/* ----------------------------------------------------------- post card */

export function postCard(share, { navigate, onDelete }) {
  const card = h('div', { class: 'post' });

  const likeBtn = h(
    'button',
    { class: `post-action ${share.likedByMe ? 'liked' : ''}` },
    icon(share.likedByMe ? 'heartFilled' : 'heart'),
    h('span', {}, String(share.likeCount))
  );
  likeBtn.addEventListener('click', async () => {
    const was = share.likedByMe;
    const paintLike = () => {
      likeBtn.className = `post-action ${share.likedByMe ? 'liked' : ''}`;
      likeBtn.replaceChildren(icon(share.likedByMe ? 'heartFilled' : 'heart'), h('span', {}, String(share.likeCount)));
    };
    await optimistic({
      apply() {
        share.likedByMe = !was;
        share.likeCount += was ? -1 : 1;
        paintLike();
      },
      rollback() {
        share.likedByMe = was;
        share.likeCount += was ? 1 : -1;
        paintLike();
      },
      commit: () => api.post('/api/likes', { targetType: 'share', targetId: share.id }),
      onSuccess: (res) => {
        share.likeCount = res.likeCount;
        share.likedByMe = res.liked;
        paintLike();
      },
      errorMessage: 'Could not update like',
    }).catch(() => {});
  });

  const commentsSlot = h('div', { class: 'comments hidden' });
  let commentsLoaded = false;

  const commentBtn = h(
    'button',
    { class: 'post-action' },
    icon('comment'),
    h('span', {}, String(share.commentCount))
  );
  commentBtn.addEventListener('click', async () => {
    commentsSlot.classList.toggle('hidden');
    if (commentsLoaded || commentsSlot.classList.contains('hidden')) return;
    commentsLoaded = true;
    mount(commentsSlot, h('div', { class: 'flex items-center gap-8 text-sm text-dim' }, h('div', { class: 'spinner' }), 'Loading comments…'));
    try {
      const { comments } = await api.get(`/api/shares/${share.id}/comments`);
      paintComments(comments);
    } catch (err) {
      mount(commentsSlot, h('p', { class: 'text-sm', style: { color: 'var(--danger)' } }, err.message));
    }
  });

  const paintComments = (comments) => {
    const input = h('input', { class: 'input', placeholder: 'Add a comment…', maxlength: '500' });
    const send = h('button', { class: 'btn btn-primary btn-sm' }, 'Reply');

    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      // optimistic: render the comment before the server confirms
      const temp = {
        id: `tmp_${Date.now()}`,
        body: text,
        createdAt: new Date().toISOString(),
        author: store.get().user,
        isOwner: true,
        likeCount: 0,
        likedByMe: false,
        pending: true,
      };
      comments.push(temp);
      paintComments(comments);
      try {
        const { comment } = await api.post(`/api/shares/${share.id}/comments`, { body: text });
        const idx = comments.findIndex((c) => c.id === temp.id);
        if (idx !== -1) comments[idx] = comment;
        share.commentCount += 1;
        commentBtn.replaceChildren(icon('comment'), h('span', {}, String(share.commentCount)));
        paintComments(comments);
      } catch (err) {
        const idx = comments.findIndex((c) => c.id === temp.id);
        if (idx !== -1) comments.splice(idx, 1);
        paintComments(comments);
        toast(err.message, 'error');
      }
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    mount(
      commentsSlot,
      ...comments.map((c) =>
        h(
          'div',
          { class: `comment ${c.pending ? 'pending' : ''}` },
          avatar(c.author, 30),
          h(
            'div',
            { class: 'comment-body' },
            h(
              'div',
              { class: 'comment-bubble' },
              h('div', { class: 'comment-author' }, c.author?.displayName || 'Unknown', h('span', { class: 'text-xs text-faint', style: { fontWeight: '400', marginLeft: '7px' } }, timeAgo(c.createdAt))),
              h('div', { class: 'comment-text' }, c.body)
            ),
            c.isOwner && !c.pending
              ? h(
                  'div',
                  { class: 'comment-actions' },
                  h(
                    'button',
                    {
                      class: 'comment-action',
                      onclick: () => editCommentModal(c, (updated) => {
                        const idx = comments.findIndex((x) => x.id === c.id);
                        if (idx !== -1) comments[idx] = updated;
                        paintComments(comments);
                      }),
                    },
                    'Edit'
                  ),
                  h(
                    'button',
                    {
                      class: 'comment-action',
                      onclick: async () => {
                        const ok = await confirmDialog({
                          title: 'Delete comment?',
                          message: 'This comment will be permanently removed.',
                        });
                        if (!ok) return;
                        const idx = comments.findIndex((x) => x.id === c.id);
                        const backup = comments[idx];
                        comments.splice(idx, 1);
                        paintComments(comments);
                        try {
                          await api.del(`/api/comments/${c.id}`);
                          share.commentCount = Math.max(0, share.commentCount - 1);
                          commentBtn.replaceChildren(icon('comment'), h('span', {}, String(share.commentCount)));
                          toast('Comment deleted');
                        } catch (err) {
                          comments.splice(idx, 0, backup);
                          paintComments(comments);
                          toast(err.message, 'error');
                        }
                      },
                    },
                    'Delete'
                  )
                )
              : null
          )
        )
      ),
      h('div', { class: 'comment-form' }, avatar(store.get().user, 30), input, send)
    );
  };

  /* embed */
  let embed = null;
  if (share.track) {
    const t = share.track;
    embed = h(
      'div',
      { class: 'embed', onclick: () => playTrack(t) },
      t.artwork ? h('img', { class: 'embed-art', src: t.artwork, alt: '', loading: 'lazy' }) : h('div', { class: 'embed-art-fallback' }, '♪'),
      h(
        'div',
        { class: 'embed-meta' },
        h('div', { class: 'embed-title' }, t.title),
        h('div', { class: 'embed-sub' }, h('span', { class: `prov-dot prov-${t.provider}`, style: { display: 'inline-block', marginRight: '6px' } }), t.artist)
      ),
      h('button', { class: 'embed-play', onclick: (e) => { e.stopPropagation(); playTrack(t); } }, icon('play'))
    );
  } else if (share.playlist) {
    const p = share.playlist;
    embed = h(
      'div',
      { class: 'embed', onclick: () => navigate('playlist', { id: p.id }) },
      p.covers?.[0] ? h('img', { class: 'embed-art', src: p.covers[0], alt: '' }) : h('div', { class: 'embed-art-fallback' }, '♫'),
      h(
        'div',
        { class: 'embed-meta' },
        h('div', { class: 'embed-title' }, p.name),
        h('div', { class: 'embed-sub' }, `Playlist · ${p.trackCount} tracks${p.aiGenerated ? ' · AI' : ''}`)
      ),
      icon('external')
    );
  }

  const msgEl = share.message ? h('p', { class: 'post-msg' }, share.message) : null;

  mount(
    card,
    h(
      'div',
      { class: 'post-head' },
      avatar(share.author, 38),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'post-author' }, share.author.displayName),
        h('div', { class: 'post-time' }, `@${share.author.handle} · ${timeAgo(share.createdAt)}${share.editedAt ? ' · edited' : ''}`)
      ),
      share.isOwner
        ? h(
            'div',
            { class: 'flex gap-6' },
            h(
              'button',
              {
                class: 'btn btn-icon btn-ghost',
                title: 'Edit post',
                onclick: () =>
                  editShareModal(share, (updated) => {
                    Object.assign(share, updated);
                    if (msgEl) msgEl.textContent = updated.message;
                  }),
              },
              icon('edit')
            ),
            h(
              'button',
              {
                class: 'btn btn-icon btn-ghost',
                title: 'Delete post',
                onclick: async () => {
                  const ok = await confirmDialog({ title: 'Delete this post?', message: 'Your post and its comments will be removed.' });
                  if (!ok) return;
                  card.classList.add('pending');
                  try {
                    await api.del(`/api/shares/${share.id}`);
                    card.remove();
                    toast('Post deleted');
                  } catch (err) {
                    card.classList.remove('pending');
                    toast(err.message, 'error');
                  }
                },
              },
              icon('trash')
            )
          )
        : null
    ),
    msgEl,
    embed,
    h('div', { class: 'post-actions' }, likeBtn, commentBtn),
    commentsSlot
  );

  return card;
}

function editShareModal(share, onDone) {
  openModal(({ close }) => {
    const msg = h('textarea', { class: 'textarea', maxlength: '500' });
    msg.value = share.message || '';
    const submit = h('button', { class: 'btn btn-primary' }, 'Save');
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.replaceChildren(h('div', { class: 'spinner' }));
      try {
        const { share: updated } = await api.patch(`/api/shares/${share.id}`, { message: msg.value.trim() });
        toast('Post updated');
        onDone(updated);
        close();
      } catch (err) {
        submit.disabled = false;
        submit.replaceChildren(document.createTextNode('Save'));
        toast(err.message, 'error');
      }
    });
    return h(
      'div',
      {},
      h('div', { class: 'modal-head' }, h('div', {}, h('div', { class: 'modal-title' }, 'Edit post')), h('button', { class: 'modal-close', onclick: close }, '×')),
      h('div', { class: 'modal-body' }, msg),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'), submit)
    );
  });
}

function editCommentModal(comment, onDone) {
  openModal(({ close }) => {
    const msg = h('textarea', { class: 'textarea', maxlength: '500' });
    msg.value = comment.body;
    const submit = h('button', { class: 'btn btn-primary' }, 'Save');
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.replaceChildren(h('div', { class: 'spinner' }));
      try {
        const { comment: updated } = await api.patch(`/api/comments/${comment.id}`, { body: msg.value.trim() });
        toast('Comment updated');
        onDone(updated);
        close();
      } catch (err) {
        submit.disabled = false;
        submit.replaceChildren(document.createTextNode('Save'));
        toast(err.message, 'error');
      }
    });
    return h(
      'div',
      {},
      h('div', { class: 'modal-head' }, h('div', {}, h('div', { class: 'modal-title' }, 'Edit comment')), h('button', { class: 'modal-close', onclick: close }, '×')),
      h('div', { class: 'modal-body' }, msg),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'), submit)
    );
  });
}
