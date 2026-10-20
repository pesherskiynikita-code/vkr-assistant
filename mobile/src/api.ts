// Всё общение с Go-бэкендом собрано здесь, чтобы экраны не знали про URL и коды ответов.
import { File } from 'expo-file-system';

// Адрес Go-бэкенда. Телефон не видит localhost компьютера,
// поэтому здесь IP компьютера в локальной сети (ipconfig → IPv4-адрес).
// Тот же IP показывает npx expo start в строке «Metro: exp://...».
export const API_URL = 'http://192.168.0.104:8080';

// Сколько ждать ответа ИИ. Модель на процессоре отвечает за 6–25 секунд.
const ASSIST_TIMEOUT_MS = 30000;

// Типы повторяют JSON, который отдаёт бэкенд (как структуры с json-тегами в Go).
export type Board = { id: string; title: string };
export type Command = { action: string; board_id: string; title: string; description: string };
// Файл на телефоне: адрес, имя и тип.
export type LocalFile = { uri: string; name: string; type: string };

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
  const resp = await fetch(`${API_URL}/boards`);
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (resp.ok) {
      return { ok: true, command: await resp.json() };
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
  const resp = await fetch(`${API_URL}/transcribe`, { method: 'POST', body: form });
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
  // Content-Type не ставим: fetch сам добавит его вместе с boundary.
  const resp = await fetch(`${API_URL}/cards`, { method: 'POST', body: form });
  if (resp.status !== 201) {
    throw new Error(`${resp.status}: ${await resp.text()}`);
  }
}
