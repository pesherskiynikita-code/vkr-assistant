// Отдельное окно «ИИ подбирает доску» с полосой от 1 до 100 %.
// Сколько осталось, сервер не сообщает, поэтому проценты условные:
// пока ждём ответ, полоса плавно подбирается к 90 % и замедляется,
// а когда ответ пришёл (done), быстро добегает до 100 %.
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, ProgressBar } from './ui';

const TICK_MS = 100;
// Какую долю оставшегося до 90 % проходим за тик. 0.02 даёт ~50 % через 4 с
// и ~85 % через 15 с: это примерно время ответа модели на процессоре.
const STEP = 0.02;

// Подпись под полосой меняется по мере роста процентов.
function stage(p: number) {
  if (p >= 100) return 'Готово';
  if (p < 25) return 'Читаю описание заявки';
  if (p < 55) return 'Сверяю со справочником досок';
  if (p < 85) return 'Выбираю подходящую доску';
  return 'Придумываю заголовок карточки';
}

type Props = {
  visible: boolean;
  done: boolean; // ответ от сервера получен
  onFinished: () => void; // полоса дошла до 100 %, окно можно закрывать
};

export function AiProgress({ visible, done, onFinished }: Props) {
  const [percent, setPercent] = useState(1);

  // Пока ждём: каждые 100 мс прибавляем немного, всё меньше и меньше.
  useEffect(() => {
    if (!visible) {
      setPercent(1);
      return;
    }
    if (done) return;
    const timer = setInterval(() => setPercent((p) => p + (90 - p) * STEP), TICK_MS);
    return () => clearInterval(timer);
  }, [visible, done]);

  // Ответ пришёл: быстро добираем до 100 %, даём полсекунды увидеть «Готово» и закрываем.
  useEffect(() => {
    if (!visible || !done) return;
    const timer = setInterval(() => setPercent((p) => Math.min(100, p + 6)), 30);
    return () => clearInterval(timer);
  }, [visible, done]);

  useEffect(() => {
    if (!visible || percent < 100) return;
    const timer = setTimeout(onFinished, 500);
    return () => clearTimeout(timer);
  }, [visible, percent, onFinished]);

  const shown = Math.max(1, Math.floor(percent));

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <View style={styles.iconCircle}>
            <Ionicons name={shown >= 100 ? 'checkmark' : 'sparkles'} size={34} color="#fff" />
          </View>
          <Text style={styles.title}>ИИ подбирает доску</Text>
          <Text style={styles.percent}>{shown} %</Text>
          <View style={{ alignSelf: 'stretch' }}>
            <ProgressBar value={shown} />
          </View>
          <Text style={styles.stage}>{stage(shown)}</Text>
          <Text style={styles.note}>Обычно это занимает 5–20 секунд</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  box: {
    alignSelf: 'stretch',
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  percent: { fontSize: 44, fontWeight: '800', color: colors.primary, marginVertical: 12 },
  stage: { fontSize: 15, color: colors.text, marginTop: 14 },
  note: { fontSize: 13, color: colors.muted, marginTop: 6 },
});
