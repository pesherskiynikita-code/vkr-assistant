// Выбор доски на экране подтверждения.
// Сверху крупно доска, которую выбрал ИИ. Если она не подходит,
// «Другая доска» раскрывает список с поиском.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Board } from './api';
import { colors } from './ui';

// Поиск без учёта регистра и разницы между «е» и «ё».
function normalize(s: string) {
  return s.toLowerCase().replace(/ё/g, 'е');
}

type Props = {
  boards: Board[];
  selectedId: string;
  aiId: string; // доска, которую предложил ИИ; пустая строка, если ИИ не справился
  onSelect: (id: string) => void;
};

export function BoardPicker({ boards, selectedId, aiId, onSelect }: Props) {
  // Если ИИ доску не выбрал, список сразу открыт: без доски дальше не пройти.
  const [open, setOpen] = useState(!aiId);
  const [query, setQuery] = useState('');

  const selected = boards.find((b) => b.id === selectedId);
  const fromAi = selectedId !== '' && selectedId === aiId;

  const q = normalize(query.trim());
  const found = q
    ? boards.filter((b) => normalize(`${b.title} ${b.description ?? ''}`).includes(q))
    : boards;

  function choose(id: string) {
    onSelect(id);
    setOpen(false);
    setQuery('');
  }

  // Карточка выбранной доски: синяя, если выбрал ИИ, белая, если выбрали вручную.
  let hero;
  if (selected) {
    const fg = fromAi ? '#fff' : colors.text;
    hero = (
      <View style={[styles.hero, fromAi ? styles.heroAi : styles.heroManual]}>
        <View style={[styles.badge, fromAi ? styles.badgeAi : styles.badgeManual]}>
          <Ionicons name={fromAi ? 'sparkles' : 'hand-left'} size={14} color={fromAi ? '#fff' : colors.primary} />
          <Text style={[styles.badgeText, { color: fromAi ? '#fff' : colors.primary }]}>
            {fromAi ? 'Выбрал ИИ' : 'Выбрано вручную'}
          </Text>
        </View>
        <Text style={[styles.heroLabel, { color: fromAi ? '#c7d7fe' : colors.muted }]}>Доска</Text>
        <Text style={[styles.heroTitle, { color: fg }]}>{selected.title}</Text>
        {selected.description ? (
          <Text style={[styles.heroDesc, { color: fromAi ? '#e0e7ff' : colors.muted }]}>{selected.description}</Text>
        ) : null}

        <View style={styles.heroActions}>
          <Pressable
            onPress={() => setOpen(!open)}
            style={({ pressed }) => [styles.change, fromAi ? styles.changeAi : styles.changeManual, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.changeText, { color: fromAi ? '#fff' : colors.primary }]}>Другая доска</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={fromAi ? '#fff' : colors.primary} />
          </Pressable>
          {!fromAi && aiId !== '' && (
            <Pressable onPress={() => choose(aiId)} hitSlop={8} style={styles.undo}>
              <Ionicons name="arrow-undo" size={16} color={colors.violet} />
              <Text style={styles.undoText}>Вернуть вариант ИИ</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  } else {
    hero = (
      <View style={[styles.hero, styles.heroEmpty]}>
        <Ionicons name="help-circle" size={28} color={colors.warning} />
        <Text style={[styles.heroTitle, { color: colors.text, fontSize: 22 }]}>Доска не выбрана</Text>
        <Text style={[styles.heroDesc, { color: colors.muted }]}>Найдите её в списке ниже</Text>
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 14 }}>
      {hero}

      {open && (
        <View style={styles.dropdown}>
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Поиск: город, магазин, код"
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />
            {query !== '' && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>

          {found.length === 0 && <Text style={styles.empty}>Ничего не найдено</Text>}

          {found.map((b) => {
            const isSelected = b.id === selectedId;
            return (
              <Pressable
                key={b.id}
                onPress={() => choose(b.id)}
                style={({ pressed }) => [styles.item, isSelected && styles.itemSelected, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{b.title}</Text>
                  {b.description ? (
                    <Text style={styles.itemDesc} numberOfLines={1}>
                      {b.description}
                    </Text>
                  ) : null}
                </View>
                {b.id === aiId && (
                  <View style={styles.itemAi}>
                    <Ionicons name="sparkles" size={12} color={colors.violet} />
                    <Text style={styles.itemAiText}>ИИ</Text>
                  </View>
                )}
                {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 22, padding: 20 },
  heroAi: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  heroManual: { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.primarySoft },
  heroEmpty: { backgroundColor: colors.warningSoft, alignItems: 'flex-start', gap: 4 },

  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 14,
  },
  badgeAi: { backgroundColor: 'rgba(255,255,255,0.2)' },
  badgeManual: { backgroundColor: colors.primarySoft },
  badgeText: { fontSize: 13, fontWeight: '700' },

  heroLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  heroTitle: { fontSize: 32, fontWeight: '800', marginTop: 2 },
  heroDesc: { fontSize: 15, marginTop: 4, lineHeight: 20 },

  heroActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 18 },
  change: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  changeAi: { backgroundColor: 'rgba(255,255,255,0.18)' },
  changeManual: { backgroundColor: colors.primarySoft },
  changeText: { fontSize: 15, fontWeight: '600' },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  undoText: { color: colors.violet, fontSize: 14, fontWeight: '600' },

  dropdown: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 12,
    marginTop: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 11, color: colors.text },
  empty: { textAlign: 'center', color: colors.muted, paddingVertical: 16 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12 },
  itemSelected: { backgroundColor: colors.primarySoft },
  itemTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  itemDesc: { fontSize: 13, color: colors.muted, marginTop: 2 },
  itemAi: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.violetSoft,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  itemAiText: { fontSize: 12, fontWeight: '700', color: colors.violet },
});
