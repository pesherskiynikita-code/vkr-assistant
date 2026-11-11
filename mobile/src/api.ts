// Всё общение с Go-бэкендом собрано здесь, чтобы экраны не знали про URL и коды ответов.
import { File } from 'expo-file-system';

// Адрес Go-бэкенда. Телефон должен быть в той же сети, что и сервер.
// На работе бэкенд крутится в Docker на dockerport (стек vkr-backend в Portainer).
// Дома, если запускаешь go run на своём компьютере, поставь его IP:
// 'http://192.168.0.104:8080' (ipconfig → IPv4-адрес).
export const API_URL = 'http://192.168.1.112:18080';

// Сколько ждать ответа ИИ. Модель на процессоре отвечает за 6–25 секунд.
const ASSIST_TIMEOUT_MS = 30000;

// Типы повторяют JSON, который отдаёт бэкенд (как структуры с json-тегами в Go).
// description есть, только если бэкенд берёт его из справочника досок; иначе экран покажет одно название.
export type Board = { id: string; title: string; description?: string };
export type Command = { action: string; board_id: string; title: string; description: string };
// Файл на телефоне: адрес, имя и тип.
export type LocalFile = { uri: string; name: string; type: string };

// ---------- Вход ----------

// Токен сессии, который выдал бэкенд после входа через Nextcloud.
// Здесь он только в памяти; на диске телефона его хранит auth.ts (SecureStore).
let token: string | null = null;

export function setToken(t: string | null) {
  token = t;
}

// Заголовок Authorization: Bearer <токен>. Его ждёт requireAuth в Go.
function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Что делать, если сервер ответил 401 (токен отозван или устарел).
// App.tsx подставляет сюда «показать экран входа».
let onUnauthorized: () => void = () => {};

export function setOnUnauthorized(fn: () => void) {
  onUnauthorized = fn;
}

// Ошибка «нужно войти заново». Экраны её не показывают: App уже переключился на вход.
export class AuthError extends Error {
  constructor() {
    super('нужно войти');
    this.name = 'AuthError';
  }
}

export function isAuthError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AuthError';
}

// Общая проверка: на 401 сообщаем App и бросаем AuthError.
function check401(resp: Response) {
  if (resp.status === 401) {
    onUnauthorized();
    throw new AuthError();
  }
}

// POST /auth/start: адрес страницы входа Nextcloud и токен опроса.
export async function startLogin(): Promise<{ login_url: string; poll_token: string }> {
  const resp = await fetch(`${API_URL}/auth/start`, { method: 'POST' });
  if (!resp.ok) {
    throw new Error(`/auth/start ответил ${resp.status}`);
  }
  return resp.json();
}

// POST /auth/poll: null, пока пользователь не вошёл (202), потом токен и логин (200).
export async function pollLogin(pollToken: string): Promise<{ token: string; login: string } | null> {
  const resp = await fetch(`${API_URL}/auth/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ poll_token: pollToken }),
  });
  if (resp.status === 202) {
    return null;
  }
  if (!resp.ok) {
    throw new Error(`/auth/poll ответил ${resp.status}`);
  }
  return resp.json();
}

// GET /me: логин, если токен действует; null, если сервер ответил 401.
// Ошибку сети бросаем: «нет связи» это не повод выкидывать пользователя.
export async function getMe(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`${API_URL}/me`, { headers: authHeaders(), signal: controller.signal });
    if (resp.status === 401) {
      return null;
    }
    if (!resp.ok) {
      throw new Error(`/me ответил ${resp.status}`);
    }
    const data: { login: string } = await resp.json();
    return data.login;
  } finally {
    clearTimeout(timer);
  }
}

// POST /auth/logout: сервер удаляет сессию и отзывает пароль приложения в Nextcloud.
export async function logout(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: authHeaders() });
}

// ---------- Заявки ----------

// В Expo SDK 57 fetch заменён на новый (expo/fetch), и старый приём
// form.append('files', {uri, name, type}) больше не работает: падает
// «Unsupported FormDataPart implementation». Новый fetch умеет брать файлы
// из expo-file-system: File сам читает байты с диска, а имя файла берёт
// из пути (например, recording-....m4a), его же увидит Go в header.Filename.
function filePart(f: LocalFile) {
  return new File(f.uri) as unknown as Blob;
}

// Результат /assist: либо предложение ИИ, либо причина, почему его нет.
export type AssistResult =
  | { ok: true; command: Command }
  | { ok: false; reason: 'no_board' | 'unavailable' };

// GET /health. Нужен только для индикатора «сервер на связи» в шапке.
export async function checkHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(`${API_URL}/health`, { signal: controller.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// GET /boards: список досок Nextcloud Deck.
export async function getBoards(): Promise<Board[]> {
  const resp = await fetch(`${API_URL}/boards`, { headers: authHeaders() });
  check401(resp);
  if (!resp.ok) {
    throw new Error(`/boards ответил ${resp.status}`);
  }
  return resp.json();
}

// POST /assist: ИИ предлагает доску и заголовок.
// Ошибку не бросаем: если ИИ не справился, пользователь выберет доску сам.
export async function assist(text: string): Promise<AssistResult> {
  // Если модель недоступна (например, дома нет доступа к Ollama),
  // не ждём минуту: через 30 секунд обрываем запрос.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSIST_TIMEOUT_MS);
  try {
    const resp = await fetch(`${API_URL}/assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (resp.ok) {
      return { ok: true, command: await resp.json() };
    }
    if (resp.status === 401) {
      onUnauthorized();
      return { ok: false, reason: 'unavailable' };
    }
    // 422: ИИ не понял доску. Остальное (502 и т. п.): модель недоступна.
    return { ok: false, reason: resp.status === 422 ? 'no_board' : 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' }; // таймаут или обрыв связи
  } finally {
    clearTimeout(timer);
  }
}

// POST /transcribe: аудиофайл → текст. Поле формы audio, ответ {"text": "..."}.
export async function transcribe(audio: LocalFile): Promise<string> {
  const form = new FormData();
  form.append('audio', filePart(audio));
  const resp = await fetch(`${API_URL}/transcribe`, { method: 'POST', headers: authHeaders(), body: form });
  check401(resp);
  if (!resp.ok) {
    throw new Error(`${resp.status}: ${await resp.text()}`);
  }
  const data: { text: string } = await resp.json();
  return data.text.trim();
}

// POST /cards: создать карточку. multipart/form-data, те же поля, что принимает Go-обработчик.
export async function createCard(
  boardId: string,
  title: string,
  description: string,
  photos: LocalFile[],
): Promise<void> {
  const form = new FormData();
  form.append('board_id', boardId);
  form.append('title', title);
  form.append('description', description);
  for (const p of photos) {
    form.append('files', filePart(p));
  }
  // Content-Type не ставим: fetch сам добавит его вместе с boundary. Authorization не мешает.
  const resp = await fetch(`${API_URL}/cards`, { method: 'POST', headers: authHeaders(), body: form });
  check401(resp);
  if (resp.status !== 201) {
    throw new Error(`${resp.status}: ${await resp.text()}`);
  }
}
