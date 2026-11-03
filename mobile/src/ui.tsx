// Небольшой набор своих компонентов, чтобы все экраны выглядели одинаково.
// Стандартный <Button> из React Native на iPhone выглядит как синяя надпись без фона,
// поэтому кнопки рисуем сами через Pressable.
import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Цвета в одном месте: поменял здесь — поменялось везде.
export const colors = {
  bg: '#f2f4f8',
  card: '#ffffff',
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  field: '#f8fafc',
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  primarySoft: '#dbeafe',
  violet: '#7c3aed',
  violetSoft: '#ede9fe',
  danger: '#dc2626',
  dangerSoft: '#fee2e2',
  success: '#16a34a',
  successSoft: '#dcfce7',
  warning: '#b45309',
  warningSoft: '#fef3c7',
};

// Имя иконки из набора Ionicons (mic, camera, search…), TypeScript проверит, что такая есть.
export type IconName = keyof typeof Ionicons.glyphMap;

// Белая карточка с заголовком: в них разложено содержимое экранов.
// right — что-нибудь справа от заголовка, например счётчик фото.
export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title && (
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>{title}</Text>
          {right}
        </View>
      )}
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
  icon?: IconName; // иконка справа от текста
};

export function AppButton({ title, onPress, loading, disabled, variant = 'primary', icon }: ButtonProps) {
  const primary = variant === 'primary';
  const off = disabled || loading;
  const color = primary ? '#fff' : colors.primary;
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
        <ActivityIndicator color={color} />
      ) : (
        <>
          <Text style={[styles.buttonText, { color }]}>{title}</Text>
          {icon && <Ionicons name={icon} size={20} color={color} />}
        </>
      )}
    </Pressable>
  );
}

// Круглая кнопка с одной иконкой: «Назад», «Очистить» в нижней панели.
export function IconButton({ icon, onPress, disabled }: { icon: IconName; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, (pressed || disabled) && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

// Цветная плашка с подсказкой: жёлтая — предупреждение, зелёная — всё хорошо.
export function Banner({ text, kind = 'warning' }: { text: string; kind?: 'warning' | 'success' }) {
  const warn = kind === 'warning';
  const color = warn ? colors.warning : colors.success;
  return (
    <View style={[styles.banner, { backgroundColor: warn ? colors.warningSoft : colors.successSoft }]}>
      <Ionicons name={warn ? 'alert-circle' : 'checkmark-circle'} size={18} color={color} />
      <Text style={{ color, flex: 1 }}>{text}</Text>
    </View>
  );
}

// Полоса загрузки: value от 0 до 100.
export function ProgressBar({ value }: { value: number }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, value))}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    // Тень: shadow* работает на iPhone, elevation — на Android.
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase' },
  button: {
    height: 54,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.primarySoft },
  buttonText: { fontSize: 17, fontWeight: '600' },
  iconButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: { flexDirection: 'row', gap: 8, alignItems: 'center', borderRadius: 14, padding: 12, marginBottom: 14 },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.primarySoft, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: colors.primary },
});
