import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';

const TOKEN_KEY = 'messenger_token';
const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6'];

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function nicknameInitials(nickname) {
  const words = String(nickname || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '??';
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  const first = words[0][0] || '';
  const secondWord = words[1] || '';
  const second = secondWord[1] || secondWord[0] || '';
  return `${first}${second}`.toUpperCase();
}

function avatarColor(nickname) {
  const input = String(nickname || '');
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function Avatar({ user, size = 'xs' }) {
  if (user.avatar) {
    return React.createElement('img', { className: `avatar ${size}`, src: user.avatar, alt: user.nickname });
  }
  return React.createElement(
    'div',
    {
      className: `avatar ${size} avatar-fallback`,
      style: { backgroundColor: avatarColor(user.nickname) },
      'aria-label': user.nickname,
      title: user.nickname
    },
    nicknameInitials(user.nickname)
  );
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      const data = await api(mode === 'login' ? '/api/login' : '/api/register', {
        method: 'POST',
        body: JSON.stringify({ nickname, password })
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      onAuth();
    } catch (e) {
      setError(e.message);
    }
  };

  return React.createElement(
    'main',
    { className: 'auth-screen' },
    React.createElement(
      'section',
      { className: 'auth-card' },
      React.createElement('h1', null, 'SyChat'),
      React.createElement('p', null, 'Регистрируйся по нику и паролю или входи в существующий аккаунт.'),
      React.createElement(
        'div',
        { className: 'tabs' },
        React.createElement(
          'button',
          { className: mode === 'login' ? 'tab active' : 'tab', type: 'button', onClick: () => setMode('login') },
          'Логин'
        ),
        React.createElement(
          'button',
          { className: mode === 'register' ? 'tab active' : 'tab', type: 'button', onClick: () => setMode('register') },
          'Регистрация'
        )
      ),
      React.createElement(
        'form',
        { className: 'stack', onSubmit: submit },
        React.createElement('input', {
          placeholder: 'Ник (минимум 3 символа)',
          value: nickname,
          maxLength: 32,
          onChange: (e) => setNickname(e.target.value)
        }),
        React.createElement('input', {
          type: 'password',
          placeholder: 'Пароль (минимум 6 символов)',
          value: password,
          onChange: (e) => setPassword(e.target.value)
        }),
        React.createElement('button', { type: 'submit', className: 'primary' }, mode === 'login' ? 'Войти' : 'Зарегистрироваться'),
        error ? React.createElement('p', { className: 'error' }, error) : null
      )
    )
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const loadState = async () => {
    try {
      const data = await api('/api/state');
      setMe(data.me);
      setUsers(data.users);
      setMessages(data.messages);
      setError('');
    } catch (e) {
      setError(e.message);
      if (e.message === 'unauthorized') {
        localStorage.removeItem(TOKEN_KEY);
        setMe(null);
      }
    } finally {
      setReady(true);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setReady(true);
      return;
    }

    let active = true;
    let timer;
    const loop = async () => {
      if (!active) return;
      await loadState();
      if (active && localStorage.getItem(TOKEN_KEY)) timer = setTimeout(loop, 1800);
    };
    loop();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const authenticated = useMemo(() => Boolean(localStorage.getItem(TOKEN_KEY) && me), [me]);

  const onAuth = async () => {
    await loadState();
    const schedule = async () => {
      await loadState();
      if (localStorage.getItem(TOKEN_KEY)) setTimeout(schedule, 1800);
    };
    setTimeout(schedule, 1800);
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    try {
      await api('/api/message', {
        method: 'POST',
        body: JSON.stringify({ text: text.trim() })
      });
      setText('');
      await loadState();
    } catch (e) {
      setError(e.message);
    }
  };

  const logout = async () => {
    try {
      await api('/api/logout', { method: 'POST', body: '{}' });
    } catch (_) {
      // ignore
    }
    localStorage.removeItem(TOKEN_KEY);
    setMe(null);
    setUsers([]);
    setMessages([]);
    setReady(true);
  };

  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const avatar = await fileToDataUrl(file);
      await api('/api/avatar', {
        method: 'POST',
        body: JSON.stringify({ avatar })
      });
      await loadState();
    } catch (e) {
      setError(e.message);
    } finally {
      event.target.value = '';
    }
  };

  const onlineUsers = users.filter((u) => u.online);
  const offlineUsers = users.filter((u) => !u.online);

  if (!ready) return React.createElement('main', { className: 'auth-screen' }, React.createElement('p', null, 'Загрузка...'));
  if (!authenticated) return React.createElement(AuthScreen, { onAuth });

  return React.createElement(
    'main',
    { className: 'layout' },
    React.createElement('header', { className: 'app-header' }, React.createElement('h1', null, 'SyChat')),
    React.createElement(
      'aside',
      { className: 'sidebar' },
      React.createElement(
        'div',
        { className: 'user-sections' },
        React.createElement('h2', null, 'Участники'),
        React.createElement('p', { className: 'sidebar-caption' }, `${onlineUsers.length} онлайн • ${offlineUsers.length} офлайн`),
        React.createElement('h3', { className: 'section-title' }, 'Онлайн'),
        React.createElement(
          'ul',
          { className: 'users' },
          onlineUsers.map((user) =>
            React.createElement(
              'li',
              { className: 'user-card', key: user.nickname },
              React.createElement('span', { className: 'presence-dot online' }),
              React.createElement(Avatar, { user }),
              React.createElement('span', { className: 'nickname' }, user.nickname)
            )
          )
        ),
        React.createElement('h3', { className: 'section-title' }, 'Офлайн'),
        React.createElement(
          'ul',
          { className: 'users' },
          offlineUsers.map((user) =>
            React.createElement(
              'li',
              { className: 'user-card', key: user.nickname },
              React.createElement('span', { className: 'presence-dot offline' }),
              React.createElement(Avatar, { user }),
              React.createElement('span', { className: 'nickname' }, user.nickname)
            )
          )
        )
      ),
      React.createElement(
        'div',
        { className: 'profile' },
        React.createElement(Avatar, { user: me, size: 'lg' }),
        React.createElement('div', null, React.createElement('strong', null, me.nickname), React.createElement('p', null, 'Твой профиль')),
        React.createElement('label', { className: 'upload' }, 'Сменить фото', React.createElement('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onChange: uploadAvatar })),
        React.createElement('button', { className: 'ghost', type: 'button', onClick: logout }, 'Выйти')
      )
    ),
    React.createElement(
      'section',
      { className: 'chat' },
      React.createElement('header', { className: 'chat-head' }, React.createElement('h2', null, 'Общий чат'), React.createElement('span', { className: 'chat-counter' }, `${onlineUsers.length} онлайн`)),
      error ? React.createElement('p', { className: 'error' }, error) : null,
      React.createElement(
        'div',
        { className: 'messages-wrap' },
        React.createElement(
          'div',
          { className: 'messages' },
          messages.map((msg) =>
            React.createElement(
              'article',
              { key: msg.id, className: msg.nickname === me.nickname ? 'mine' : '' },
              React.createElement(Avatar, { user: msg }),
              React.createElement(
                'div',
                { className: 'bubble' },
                React.createElement('div', { className: 'meta' }, React.createElement('strong', null, msg.nickname), React.createElement('time', null, formatTime(msg.createdAt))),
                React.createElement('p', null, msg.text)
              )
            )
          )
        ),
        React.createElement(
          'form',
          { className: 'composer floating', onSubmit: sendMessage },
          React.createElement('textarea', {
            value: text,
            rows: 2,
            maxLength: 700,
            placeholder: 'Напиши сообщение...',
            onChange: (e) => setText(e.target.value)
          }),
          React.createElement('button', { className: 'primary send-btn', type: 'submit', disabled: !text.trim() }, 'Отправить')
        )
      )
    )
  );
}

createRoot(document.getElementById('root')).render(React.createElement(App));
