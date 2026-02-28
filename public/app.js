import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';

function createClientId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function App() {
  const [nicknameInput, setNicknameInput] = useState('');
  const [nickname, setNickname] = useState('');
  const [clientId] = useState(createClientId);
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!nickname) return;

    let active = true;
    let timer;

    const syncState = async () => {
      try {
        const response = await fetch(`/api/state?clientId=${encodeURIComponent(clientId)}`);
        if (!response.ok) throw new Error('state failed');
        const data = await response.json();
        if (!active) return;
        setUsers(data.users);
        setMessages(data.messages);
        setError('');
      } catch {
        if (active) {
          setError('Нет соединения с сервером');
        }
      } finally {
        if (active) {
          timer = setTimeout(syncState, 1500);
        }
      }
    };

    syncState();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [nickname, clientId]);

  const join = async (event) => {
    event.preventDefault();
    const nick = nicknameInput.trim();
    if (!nick) return;

    const response = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, nickname: nick })
    });

    if (response.ok) {
      setNickname(nick);
    }
  };

  const canSend = useMemo(() => nickname && text.trim().length > 0, [nickname, text]);

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!canSend) return;

    const payload = {
      clientId,
      text: text.trim()
    };

    const response = await fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      setText('');
    }
  };

  if (!nickname) {
    return React.createElement(
      'main',
      { className: 'login-screen' },
      React.createElement(
        'section',
        { className: 'card' },
        React.createElement('h1', null, 'Общий чат'),
        React.createElement('p', null, 'Введи ник, чтобы войти в чат.'),
        React.createElement(
          'form',
          { onSubmit: join },
          React.createElement('input', {
            value: nicknameInput,
            onChange: (e) => setNicknameInput(e.target.value),
            placeholder: 'Твой ник',
            maxLength: 32,
            autoFocus: true
          }),
          React.createElement('button', { type: 'submit' }, 'Войти')
        )
      )
    );
  }

  return React.createElement(
    'main',
    { className: 'app-shell' },
    React.createElement(
      'aside',
      { className: 'sidebar card' },
      React.createElement('h2', null, `Онлайн (${users.length})`),
      React.createElement(
        'ul',
        null,
        users.map((u) => React.createElement('li', { key: u }, u))
      )
    ),
    React.createElement(
      'section',
      { className: 'chat card' },
      React.createElement('h2', null, 'Общий чат'),
      error ? React.createElement('p', { className: 'error' }, error) : null,
      React.createElement(
        'div',
        { className: 'messages' },
        messages.map((msg) =>
          React.createElement(
            'article',
            {
              key: msg.id,
              className: msg.nickname === nickname ? 'mine' : ''
            },
            React.createElement('strong', null, msg.nickname),
            React.createElement('p', null, msg.text)
          )
        )
      ),
      React.createElement(
        'form',
        { className: 'composer', onSubmit: sendMessage },
        React.createElement('input', {
          value: text,
          onChange: (e) => setText(e.target.value),
          placeholder: 'Сообщение...',
          maxLength: 400
        }),
        React.createElement('button', { type: 'submit', disabled: !canSend }, 'Отправить')
      )
    )
  );
}

createRoot(document.getElementById('root')).render(React.createElement(App));
