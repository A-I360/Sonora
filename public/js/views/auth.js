/* Sign in / sign up screen. */

import { h, mount, api, store, toast } from '../core.js';
import { icons } from '../icons.js';

export function renderAuth(root, { onAuthed }) {
  let mode = 'login';

  const paint = () => {
    const isLogin = mode === 'login';

    const email = h('input', {
      class: 'input',
      type: 'email',
      placeholder: 'you@example.com',
      autocomplete: 'email',
      required: true,
    });
    const password = h('input', {
      class: 'input',
      type: 'password',
      placeholder: isLogin ? 'Your password' : 'At least 8 characters',
      autocomplete: isLogin ? 'current-password' : 'new-password',
      required: true,
    });
    const name = h('input', {
      class: 'input',
      type: 'text',
      placeholder: 'How should we call you?',
      autocomplete: 'name',
    });

    const alert = h('div', { class: 'auth-alert hidden' });
    const submit = h(
      'button',
      { class: 'btn btn-primary btn-block', type: 'submit', style: { padding: '12px' } },
      isLogin ? 'Sign in' : 'Create account'
    );

    const setBusy = (busy) => {
      submit.disabled = busy;
      submit.replaceChildren(
        busy ? h('div', { class: 'spinner' }) : document.createTextNode(isLogin ? 'Sign in' : 'Create account')
      );
    };

    const showError = (msg) => {
      alert.textContent = msg;
      alert.classList.remove('hidden');
    };

    const form = h(
      'form',
      {
        class: 'auth-form',
        onsubmit: async (e) => {
          e.preventDefault();
          alert.classList.add('hidden');

          const payload = { email: email.value.trim(), password: password.value };
          if (!payload.email || !payload.password) return showError('Email and password are required');
          if (!isLogin) {
            payload.displayName = name.value.trim();
            if (payload.password.length < 8) return showError('Password must be at least 8 characters');
          }

          setBusy(true);
          try {
            const res = await api.post(isLogin ? '/api/auth/login' : '/api/auth/register', payload);
            toast(isLogin ? `Welcome back, ${res.user.displayName}` : `Welcome to Sonora, ${res.user.displayName}`);
            onAuthed(res.user);
          } catch (err) {
            setBusy(false);
            showError(err.message);
          }
        },
      },
      alert,
      !isLogin ? h('div', { class: 'field' }, h('label', { class: 'label' }, 'Display name'), name) : null,
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Email'), email),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'label' }, 'Password'),
        password,
        !isLogin ? h('div', { class: 'hint' }, 'Minimum 8 characters. Stored with scrypt hashing.') : null
      ),
      submit
    );

    return h(
      'div',
      { class: 'auth-screen' },
      h(
        'div',
        { class: 'auth-card' },
        h(
          'div',
          { class: 'auth-brand' },
          h('div', { class: 'auth-mark', html: icons.logo }),
          h('div', {}, h('div', { class: 'auth-title' }, isLogin ? 'Welcome back' : 'Join Sonora'),
            h(
              'p',
              { class: 'auth-sub' },
              isLogin
                ? 'Sign in to your playlists, library and AI mixes.'
                : 'AI-built playlists from millions of real tracks across Apple Music, Deezer and Audius.'
            ))
        ),
        form,
        h(
          'div',
          { class: 'auth-switch' },
          isLogin ? "Don't have an account? " : 'Already have an account? ',
          h(
            'button',
            {
              type: 'button',
              onclick: () => {
                mode = isLogin ? 'register' : 'login';
                mount(root, paint());
              },
            },
            isLogin ? 'Create one' : 'Sign in'
          )
        ),
        h(
          'div',
          { class: 'auth-demo' },
          'No API keys needed — real music from Apple Music, Deezer and Audius works out of the box.'
        )
      )
    );
  };

  mount(root, paint());
}
