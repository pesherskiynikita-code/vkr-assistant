// Вход через Nextcloud (Login Flow v2) со стороны телефона.
// Как это устроено:
// 1. /auth/start → бэкенд даёт адрес страницы входа и токен опроса.
// 2. Открываем страницу во встроенном браузере, человек входит в Nextcloud.
// 3. Раз в 2 секунды спрашиваем /auth/poll, пока бэкенд не выдаст наш токен.
// 4. Токен кладём в SecureStore: это защищённое хранилище телефона (Keychain на iPhone,
//    Keystore на Android), обычные приложения и резервные копии его не видят.
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { getMe, logout, pollLogin, setToken, startLogin } from './api';

const TOKEN_KEY = 'vkr_token';
const LOGIN_KEY = 'vkr_login';

const POLL_EVERY_MS = 2000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000; // Nextcloud сам забывает запрос входа через 20 минут
const AFTER_CLOSE_MS = 6000; // браузер закрыли: ещё немного ждём, вдруг вход уже прошёл

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// При запуске: есть ли сохранённый вход и действует ли он.
// Возвращает логин или null, если нужно войти.
export async function restoreSession(): Promise<string | null> {
  const saved = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!saved) {
    return null;
  }
  setToken(saved);
  const savedLogin = (await SecureStore.getItemAsync(LOGIN_KEY)) ?? '';
  try {
    const login = await getMe();
    if (login === null) {
      // Сервер сказал 401: сессию удалили (выход на другом устройстве, отзыв в Nextcloud).
      await forget();
      return null;
    }
    return login;
  } catch {
    // Нет связи с сервером. Это не повод выкидывать пользователя: пускаем с сохранённым логином,
    // а если токен всё же недействителен, первый же запрос вернёт 401 и покажет вход.
    return savedLogin;
  }
}

// Полный вход. stopped() возвращает true, если пользователь нажал «Отмена».
// Возвращает логин или null, если вход отменён или не дождались.
export async function signIn(stopped: () => boolean): Promise<string | null> {
  const start = await startLogin();

  // Браузер открываем, но не ждём его: опрос идёт параллельно.
  // На iPhone промис завершится, когда браузер закроют; на Android сразу.
  let closedAt = 0;
  WebBrowser.openBrowserAsync(start.login_url)
    .then((r) => {
      if (r.type === 'cancel') {
        closedAt = Date.now();
      }
    })
    .catch(() => {
      closedAt = Date.now(); // браузер не открылся
    });

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (!stopped() && Date.now() < deadline) {
    if (closedAt && Date.now() - closedAt > AFTER_CLOSE_MS) {
      return null; // браузер закрыли, а вход так и не пришёл
    }
    await sleep(POLL_EVERY_MS);
    let res;
    try {
      res = await pollLogin(start.poll_token);
    } catch {
      continue; // связь моргнула: попробуем ещё раз через 2 секунды
    }
    if (res) {
      await SecureStore.setItemAsync(TOKEN_KEY, res.token);
      await SecureStore.setItemAsync(LOGIN_KEY, res.login);
      setToken(res.token);
      closeBrowser();
      return res.login;
    }
  }
  closeBrowser();
  return null;
}

// Выход: сервер удаляет сессию и отзывает пароль приложения, телефон забывает токен.
export async function signOut() {
  try {
    await logout();
  } catch {
    // Нет связи: всё равно выходим на телефоне. Сессию на сервере можно отозвать в Nextcloud.
  }
  await forget();
}

// Забыть токен на телефоне (без запроса к серверу).
export async function forget() {
  setToken(null);
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(LOGIN_KEY);
}

// Закрыть встроенный браузер. Программно это умеет только iPhone;
// на Android человек вернётся в приложение кнопкой «Назад».
function closeBrowser() {
  // На Android dismissBrowser может вернуть undefined вместо промиса, поэтому Promise.resolve.
  try {
    Promise.resolve(WebBrowser.dismissBrowser()).catch(() => {});
  } catch {
    // нечего закрывать
  }
}
