import React, { useEffect, useMemo, useRef, useState } from 'https://esm.sh/react@18.3.1';
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
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const first = words[0][0] || '';
  const secondWord = words[1] || '';
  const second = secondWord[1] || secondWord[0] || '';
  return `${first}${second}`.toUpperCase();
}

function avatarColor(nickname) {
  const input = String(nickname || '');
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function Avatar({ user, size = 'xs' }) {
  if (user.avatar) {
    return <img className={`avatar ${size}`} src={user.avatar} alt={user.nickname} />;
  }
  return (
    <div
      className={`avatar ${size} avatar-fallback`}
      style={{ backgroundColor: avatarColor(user.nickname) }}
      aria-label={user.nickname}
      title={user.nickname}
    >
      {nicknameInitials(user.nickname)}
    </div>
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

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <h1>SyChat</h1>
        <p>Регистрируйся по нику и паролю или входи в существующий аккаунт.</p>
        <div className="tabs">
          <button className={mode === 'login' ? 'tab active' : 'tab'} type="button" onClick={() => setMode('login')}>
            Логин
          </button>
          <button className={mode === 'register' ? 'tab active' : 'tab'} type="button" onClick={() => setMode('register')}>
            Регистрация
          </button>
        </div>
        <form className="stack" onSubmit={submit}>
          <input
            placeholder="Ник (минимум 3 символа)"
            value={nickname}
            maxLength={32}
            onChange={(e) => setNickname(e.target.value)}
          />
          <input
            type="password"
            placeholder="Пароль (минимум 6 символов)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="primary">
            {mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const messagesRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const checkScrollPosition = () => {
    const node = messagesRef.current;
    if (!node) return;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    const nearBottom = distanceToBottom < 80;
    stickToBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
  };

  const scrollToBottom = (force = false) => {
    const node = messagesRef.current;
    if (!node) return;
    if (force || stickToBottomRef.current) {
      node.scrollTop = node.scrollHeight;
      stickToBottomRef.current = true;
      setShowScrollButton(false);
    }
  };

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

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const authenticated = useMemo(() => Boolean(localStorage.getItem(TOKEN_KEY) && me), [me]);

  const onAuth = async () => {
    await loadState();
    setTimeout(() => scrollToBottom(true), 0);

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
      await api('/api/message', { method: 'POST', body: JSON.stringify({ text: text.trim() }) });
      setText('');
      stickToBottomRef.current = true;
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
      await api('/api/avatar', { method: 'POST', body: JSON.stringify({ avatar }) });
      await loadState();
    } catch (e) {
      setError(e.message);
    } finally {
      event.target.value = '';
    }
  };

  const onlineUsers = users.filter((u) => u.online);
  const offlineUsers = users.filter((u) => !u.online);

  if (!ready) return <main className="auth-screen"><p>Загрузка...</p></main>;
  if (!authenticated) return <AuthScreen onAuth={onAuth} />;

  return (
    <main className="layout">
      <header className="app-header">
        <div className="brand-mark" aria-hidden>✦</div>
        <h1>SyChat</h1>
      </header>

      <nav className="mobile-tabs" aria-label="Навигация">
        <button type="button" className={activeTab === 'chat' ? 'mobile-tab-btn active' : 'mobile-tab-btn'} onClick={() => setActiveTab('chat')}>Чат</button>
        <button type="button" className={activeTab === 'participants' ? 'mobile-tab-btn active' : 'mobile-tab-btn'} onClick={() => setActiveTab('participants')}>Участники</button>
        <button type="button" className={activeTab === 'profile' ? 'mobile-tab-btn active' : 'mobile-tab-btn'} onClick={() => setActiveTab('profile')}>Профиль</button>
      </nav>

      <aside className={activeTab === 'chat' ? 'sidebar mobile-hidden' : 'sidebar'}>
        <div className={activeTab === "profile" ? "user-sections mobile-hidden" : "user-sections"}>
          <h2>Участники</h2>
          <p className="sidebar-caption">{onlineUsers.length} онлайн • {offlineUsers.length} офлайн</p>

          <h3 className="section-title">Онлайн</h3>
          <ul className="users">
            {onlineUsers.map((user) => (
              <li className="user-card" key={user.nickname}>
                <span className="presence-dot online" />
                <Avatar user={user} />
                <span className="nickname">{user.nickname}</span>
              </li>
            ))}
          </ul>

          <h3 className="section-title">Офлайн</h3>
          <ul className="users">
            {offlineUsers.map((user) => (
              <li className="user-card" key={user.nickname}>
                <span className="presence-dot offline" />
                <Avatar user={user} />
                <span className="nickname">{user.nickname}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={activeTab === "participants" ? "profile mobile-hidden" : "profile"}>
          <Avatar user={me} size="lg" />
          <div>
            <strong>{me.nickname}</strong>
            <p>Твой профиль</p>
          </div>
          <label className="upload">
            Сменить фото
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadAvatar} />
          </label>
          <button className="danger logout-btn" type="button" onClick={logout}>Выйти</button>
        </div>
      </aside>

      <section className={activeTab === "chat" ? "chat" : "chat mobile-hidden"}>
        <header className="chat-head">
          <h2>Общий чат</h2>
          <span className="chat-counter">{onlineUsers.length} онлайн</span>
        </header>

        {error ? <p className="error">{error}</p> : null}

        <div className="messages-wrap">
          <div className="messages" ref={messagesRef} onScroll={checkScrollPosition}>
            {messages.map((msg) => (
              <article key={msg.id} className={msg.nickname === me.nickname ? 'mine' : ''}>
                <Avatar user={msg} />
                <div className="bubble">
                  <div className="meta">
                    <strong>{msg.nickname}</strong>
                    <time>{formatTime(msg.createdAt)}</time>
                  </div>
                  <p>{msg.text}</p>
                </div>
              </article>
            ))}
          </div>

          {showScrollButton ? (
            <button
              type="button"
              className="scroll-bottom-btn"
              onClick={() => scrollToBottom(true)}
              title="Пролистать чат до конца"
              aria-label="Пролистать чат до конца"
            >
              ↓
            </button>
          ) : null}

          <form className="composer floating" onSubmit={sendMessage}>
            <textarea
              value={text}
              rows={2}
              maxLength={700}
              placeholder="Напиши сообщение..."
              onChange={(e) => setText(e.target.value)}
            />
            <button className="primary send-btn" type="submit" disabled={!text.trim()}>Отправить</button>
          </form>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
