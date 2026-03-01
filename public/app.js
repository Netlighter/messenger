import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';

const TOKEN_KEY = 'messenger_token';

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Request failed');
  }
  return body;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      React.createElement('h1', null, 'Messenger'),
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
      if (active && localStorage.getItem(TOKEN_KEY)) {
        timer = setTimeout(loop, 1800);
      }
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
      if (localStorage.getItem(TOKEN_KEY)) {
        setTimeout(schedule, 1800);
      }
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

  if (!ready) {
    return React.createElement('main', { className: 'auth-screen' }, React.createElement('p', null, 'Загрузка...'));
  }

  if (!authenticated) {
    return React.createElement(AuthScreen, { onAuth });
  }

  return React.createElement(
    'main',
    { className: 'layout' },
    React.createElement(
      'header',
      { className: 'app-header' },
      React.createElement('h1', null, 'SyChat')
    ),
    React.createElement(
      'aside',
      { className: 'sidebar' },
      React.createElement('h2', null, 'Онлайн'),
      React.createElement(
        'ul',
        { className: 'users' },
        users.map((user) =>
          React.createElement(
            'li',
            { key: user.nickname },
            React.createElement('img', { className: 'avatar xs', src: user.avatar || '/avatar-placeholder.svg', alt: user.nickname }),
            React.createElement('span', null, user.nickname)
          )
        )
      ),
      React.createElement(
        'div',
        { className: 'profile' },
        React.createElement('img', { className: 'avatar lg', src: me.avatar || '/avatar-placeholder.svg', alt: me.nickname }),
        React.createElement('div', null, React.createElement('strong', null, me.nickname), React.createElement('p', null, 'Твой профиль')),
        React.createElement('label', { className: 'upload' }, 'Сменить фото', React.createElement('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onChange: uploadAvatar })),
        React.createElement('button', { className: 'ghost', type: 'button', onClick: logout }, 'Выйти')
      )
    ),
    React.createElement(
      'section',
      { className: 'chat' },
      React.createElement(
        'header',
        { className: 'chat-head' },
        React.createElement('h2', null, 'Общий чат'),
        React.createElement('span', { className: 'chat-counter' }, `${users.length} онлайн`)
      ),
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
              React.createElement('img', { className: 'avatar xs', src: msg.avatar || '/avatar-placeholder.svg', alt: msg.nickname }),
              React.createElement(
                'div',
                { className: 'bubble' },
                React.createElement('div', { className: 'meta' }, React.createElement('strong', null, msg.nickname), React.createElement('time', null, formatTime(msg.createdAt))),
                React.createElement('p', null, msg.text)
              )
            )
          )
        )
      ),
      React.createElement(
        'form',
        { className: 'composer', onSubmit: sendMessage },
        React.createElement(
          'div',
          { className: 'composer-input-wrap' },
          React.createElement('textarea', {
            value: text,
            rows: 2,
            maxLength: 700,
            placeholder: 'Напиши сообщение...',
            onChange: (e) => setText(e.target.value),
            onInput: (e) => {
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 220)}px`;
            }
          })
        ),
        React.createElement('button', { className: 'primary send-btn', type: 'submit', disabled: !text.trim() }, 'Отправить')
      )
    )
  );
}

createRoot(document.getElementById('root')).render(React.createElement(App));
