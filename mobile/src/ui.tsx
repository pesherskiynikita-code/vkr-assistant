// Небольшой набор своих компонентов, чтобы все экраны выглядели одинаково.
// Стандартный <Button> из React Native на iPhone выглядит как синяя надпись без фона,
// поэтому кнопки рисуем сами через Pressable.
import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

// Цвета в одном месте: поменял здесь — поменялось везде.
export const colors = {
  bg: '#f2f4f8',
  card: '#ffffff',
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  primary: '#2563eb',
  primarySoft: '#dbeafe',
  danger: '#dc2626',
  success: '#16a34a',
  successSoft: '#dcfce7',
  warning: '#b45309',
  warningSoft: '#fef3c7',
};

// Белая карточка с заголовком: в них разложено содержимое экранов.
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title && <Text style={styles.cardTitle}>{title}</Text>}
      {children}
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean; // вместо текста крутится индикатор, нажатия не принимаются
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
};

export function AppButton({ title, onPress, loading, disabled, variant = 'primary' }: ButtonProps) {
  const primary = variant === 'primary';
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      // pressed — палец на кнопке: делаем её чуть прозрачнее, как у системных кнопок
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonSecondary,
        (pressed || off) && { opacity: 0.6 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? '#fff' : colors.primary} />
      ) : (
        <Text style={[styles.buttonText, !primary && { color: colors.primary }]}>{title}</Text>
      )}
    </Pressable>
  );
}

// Цветная плашка с подсказкой: жёлтая — предупреждение, зелёная — всё хорошо.
export function Banner({ text, kind = 'warning' }: { text: string; kind?: 'warning' | 'success' }) {
  const warn = kind === 'warning';
  return (
    <View style={[styles.banner, { backgroundColor: warn ? colors.warningSoft : colors.successSoft }]}>
      <Text style={{ color: warn ? colors.warning : colors.success }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    // Тень: shadow* работает на iPhone, elevation — на Android.
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 10, textTransform: 'uppercase' },
  button: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.primarySoft },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  banner: { borderRadius: 12, padding: 12, marginBottom: 14 },
});
