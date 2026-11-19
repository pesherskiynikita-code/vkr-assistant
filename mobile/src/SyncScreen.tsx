// Экран «Инициализация досок»: сервер описывает доски через ИИ, а мы показываем прогресс.
// Как это устроено (так же, как вход через Nextcloud):
// 1. POST /boards/sync — сервер запускает работу в фоне и сразу отвечает.
// 2. Раз в 2 секунды GET /boards/sync — «сколько уже готово?».
// 3. Когда running = false, всё готово, открываем главный экран.
// Человек ничего не нажимает: опрос идёт сам, на экране просто ползёт полоска.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';

import { getBoardSync, isAuthError, startBoardSync, SyncStatus } from './api';
import { AppButton, Banner, colors, ProgressBar } from './ui';

const POLL_EVERY_MS = 2000;
const MAX_FAILS = 3; // столько неудачных опросов подряд терпим (связь моргнула), потом показываем ошибку
const DAY_MS = 24 * 60 * 60 * 1000;
const SYNCED_AT_KEY = 'boards_synced_at'; // когда доски последний раз проверялись

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// При запуске приложения: пора ли снова проверить доски (прошли сутки или ещё ни разу).
export async function needsDailySync(): Promise<boolean> {
  try {
    const saved = await SecureStore.getItemAsync(SYNCED_AT_KEY);
    return !saved || Date.now() - Number(saved) > DAY_MS;
  } catch {
    return false; // хранилище недоступно: не мешаем работать
  }
}

async function markSynced() {
  try {
    await SecureStore.setItemAsync(SYNCED_AT_KEY, String(Date.now()));
  } catch {
    // не записалось: значит, проверим ещё раз при следующем запуске
  }
}

type Props = {
  visible: boolean;
  all: boolean; // true — «Обновить доски»: переописать все, false — только новые
  onDone: () => void;
};

// Modal поверх главного экрана: то, что человек уже начал вводить, не пропадает.
export function SyncScreen({ visible, all, onDone }: Props) {
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onDone}>
      {visible && <SyncBody all={all} onDone={onDone} />}
    </Modal>
  );
}

function SyncBody({ all, onDone }: { all: boolean; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState('');

  // onDone в ref: цикл опроса запускается один раз и должен звать актуальную функцию.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let stopped = false; // экран закрыли — цикл тихо останавливается

    (async () => {
      try {
        await startBoardSync(all);
      } catch (e) {
        if (!stopped && !isAuthError(e)) {
          setError(`Не удалось обновить доски (${String(e)}).`);
        }
        return;
      }

      let fails = 0;
      while (!stopped) {
        try {
          const s = await getBoardSync();
          fails = 0;
          if (stopped) {
            return;
          }
          setStatus(s);
          if (!s.running) {
            await markSynced();
            done.current();
            return;
          }
        } catch (e) {
          if (stopped || isAuthError(e)) {
            return;
          }
          fails++;
          if (fails >= MAX_FAILS) {
            setError(`Нет связи с сервером (${String(e)}).`);
            return;
          }
        }
        await sleep(POLL_EVERY_MS);
      }
    })();

    return () => {
      stopped = true;
    };
  }, [all]);

  // «Продолжить без ожидания»: сервер всё равно доделает работу в фоне.
  async function skip() {
    if (error === '') {
      await markSynced();
    }
    onDone();
  }

  const total = status?.total ?? 0;
  const ready = status?.done ?? 0;
  const percent = total > 0 ? (ready / total) * 100 : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.center}>
        <View style={styles.logo}>
          <Ionicons name="albums" size={40} color="#fff" />
        </View>
        <Text style={styles.title}>{all ? 'Обновление досок…' : 'Инициализация досок…'}</Text>
        <Text style={styles.text}>
          ИИ знакомится с вашими досками в Nextcloud, чтобы точнее раскладывать заявки. Обычно это занимает от
          нескольких секунд до пары минут.
        </Text>

        {error === '' && (
          <View style={styles.progress}>
            {total > 0 ? (
              <>
                <ProgressBar value={percent} />
                <Text style={styles.count}>
                  Готово {ready} из {total}
                </Text>
              </>
            ) : (
              <ActivityIndicator color={colors.primary} size="large" />
            )}
          </View>
        )}
      </View>

      <View style={styles.bottom}>
        {error !== '' && <Banner text={`${error} Заявки можно создавать и так.`} />}
        <AppButton
          title={error !== '' ? 'Продолжить' : 'Продолжить без ожидания'}
          variant={error !== '' ? 'primary' : 'secondary'}
          onPress={skip}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, marginTop: 24, textAlign: 'center' },
  text: { fontSize: 16, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 22 },
  progress: { alignSelf: 'stretch', marginTop: 32, gap: 10, alignItems: 'stretch' },
  count: { fontSize: 15, color: colors.primary, fontWeight: '600', textAlign: 'center' },
  bottom: { gap: 12 },
});
