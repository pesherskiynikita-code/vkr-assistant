// Экран входа: одна кнопка «Войти через Nextcloud».
// Пока человек входит в браузере, здесь крутится индикатор и есть «Отмена».
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { signIn } from './auth';
import { AppButton, Banner, colors } from './ui';

type Props = {
  onSignedIn: (login: string) => void;
  notice?: string; // например, «Сессия закончилась, войдите снова»
};

export function LoginScreen({ onSignedIn, notice }: Props) {
  const insets = useSafeAreaInsets();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  // useRef, а не useState: цикл опроса в auth.ts читает значение напрямую, без перерисовки.
  const cancelled = useRef(false);

  async function start() {
    setError('');
    setWaiting(true);
    cancelled.current = false;
    try {
      const login = await signIn(() => cancelled.current);
      if (login) {
        onSignedIn(login);
        return;
      }
      if (!cancelled.current) {
        setError('Вход не завершён. Попробуйте ещё раз.');
      }
    } catch (e) {
      setError(`Нет связи с сервером. ${String(e)}`);
    }
    setWaiting(false);
  }

  function cancel() {
    cancelled.current = true;
    setWaiting(false);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar style="dark" />

      <View style={styles.center}>
        <View style={styles.logo}>
          <Ionicons name="mic" size={44} color="#fff" />
        </View>
        <Text style={styles.title}>X2 Helpdesk</Text>
        <Text style={styles.text}>
          Голосовые заявки в Nextcloud Deck. Войдите своей учётной записью Nextcloud, и карточки будут создаваться от
          вашего имени.
        </Text>
      </View>

      <View style={styles.bottom}>
        {notice && !waiting && error === '' ? <Banner text={notice} /> : null}
        {error !== '' && <Banner text={error} />}

        {waiting ? (
          <>
            <View style={styles.waiting}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.waitingText}>Ждём входа в браузере…</Text>
            </View>
            <Text style={styles.hint}>Войдите в Nextcloud и подтвердите доступ. Потом вернитесь сюда.</Text>
            <AppButton title="Отмена" variant="secondary" onPress={cancel} />
          </>
        ) : (
          <AppButton title="Войти через Nextcloud" icon="log-in-outline" onPress={start} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  title: { fontSize: 34, fontWeight: '800', color: colors.text, marginTop: 24 },
  text: { fontSize: 16, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 22 },
  bottom: { gap: 12 },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  waitingText: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  hint: { fontSize: 14, color: colors.muted, textAlign: 'center' },
});
