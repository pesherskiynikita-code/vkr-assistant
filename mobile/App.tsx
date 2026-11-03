import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

import { assist, AssistResult, Board, checkHealth, createCard, getBoards, LocalFile, transcribe } from './src/api';
import { AiProgress } from './src/AiProgress';
import { BoardPicker } from './src/BoardPicker';
import { AppButton, Banner, Card, colors, IconButton, IconName } from './src/ui';

// Приложение — три экрана подряд: ввод → подтверждение → готово.
type Step = 'input' | 'confirm' | 'done';

// SafeAreaProvider узнаёт у телефона размеры «чёлки» сверху и полоски жестов снизу,
// чтобы шапка и нижняя панель не залезали под них.
export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('input');

  // Экран ввода
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<LocalFile[]>([]);

  // Экран подтверждения
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState(''); // выбранная доска
  const [aiBoardId, setAiBoardId] = useState(''); // доска, которую предложил ИИ
  const [title, setTitle] = useState('');
  const [hint, setHint] = useState('');

  const [loading, setLoading] = useState(false);
  // Окно «ИИ подбирает доску»: aiOpen — показано, aiDone — ответ уже пришёл.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  // null — ещё проверяем, true/false — ответил ли сервер на /health
  const [online, setOnline] = useState<boolean | null>(null);

  // Голосовой ввод: recorder пишет звук с микрофона в файл .m4a на телефоне,
  // recorderState каждые 250 мс сообщает, идёт ли запись и сколько она длится.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [transcribing, setTranscribing] = useState(false);
  const recording = recorderState.isRecording;

  // При запуске один раз проверяем, видит ли телефон сервер.
  useEffect(() => {
    checkHealth().then(setOnline);
  }, []);

  // Пульсирующее кольцо вокруг микрофона во время записи: 0 → 1 по кругу.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!recording) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  // ---------- Голос ----------

  // Первое нажатие на микрофон — начать запись.
  async function startRecording() {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нет доступа к микрофону', 'Разрешите доступ в настройках телефона');
      return;
    }
    // На iPhone без этого запись не начнётся: звуковую сессию нужно перевести в режим записи.
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  // Второе нажатие — остановить запись и отправить файл на сервер для распознавания.
  async function stopRecording() {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });

    const uri = recorder.uri;
    if (!uri) {
      Alert.alert('Запись не получилась', 'Попробуйте ещё раз');
      return;
    }

    setTranscribing(true);
    try {
      const heard = await transcribe({ uri, name: 'voice.m4a', type: 'audio/m4a' });
      // Дописываем распознанное к тому, что уже есть в поле,
      // чтобы можно было надиктовать в несколько заходов.
      if (heard) {
        setText((old) => (old.trim() ? `${old.trim()} ${heard}` : heard));
      }
    } catch (e) {
      Alert.alert('Не удалось распознать речь', String(e));
    } finally {
      setTranscribing(false);
    }
  }

  // ---------- Фото ----------

  // Фото с камеры или из галереи. Сохраняем только адрес файла на телефоне,
  // сам файл уйдёт на сервер при создании карточки.
  async function pickPhoto(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нет доступа', 'Разрешите доступ в настройках телефона');
      return;
    }

    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    setPhotos([
      ...photos,
      {
        uri: asset.uri,
        name: asset.fileName ?? `photo-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      },
    ]);
  }

  function removePhoto(uri: string) {
    setPhotos(photos.filter((p) => p.uri !== uri));
  }

  // ---------- Переходы между экранами ----------

  // Экран 1 → 2: берём список досок и спрашиваем ИИ, куда положить заявку.
  // Пока ждём, открыто окно с полосой загрузки.
  async function send() {
    if (!text.trim()) {
      Alert.alert('Пусто', 'Опишите проблему текстом или голосом');
      return;
    }

    setAiDone(false);
    setAiOpen(true);
    let res: AssistResult;
    try {
      // Доски нужны в любом случае: показать название и дать выбрать другую.
      setBoards(await getBoards());
      setOnline(true);
      res = await assist(text);
    } catch (e) {
      setOnline(false);
      setAiOpen(false);
      // Ждём, пока окно закроется: на iPhone сообщение поверх закрывающегося окна теряется.
      setTimeout(() => Alert.alert('Нет связи с сервером', String(e)), 400);
      return;
    }

    if (res.ok) {
      setBoardId(res.command.board_id);
      setAiBoardId(res.command.board_id);
      setTitle(res.command.title);
      setHint('');
    } else {
      // Не тупик: пользователь сам выберет доску на следующем экране.
      setBoardId('');
      setAiBoardId('');
      setTitle(text.trim().slice(0, 80));
      setHint(
        res.reason === 'no_board'
          ? 'ИИ не смог определить доску. Выберите её вручную.'
          : 'ИИ сейчас недоступен. Выберите доску вручную.',
      );
    }
    // Полоса добежит до 100 %, и тогда onAiFinished переключит экран.
    setAiDone(true);
  }

  // useCallback: одна и та же функция между перерисовками, иначе таймер в окне сбрасывался бы.
  const onAiFinished = useCallback(() => {
    setAiOpen(false);
    setStep('confirm');
  }, []);

  // Экран 2 → 3: пользователь подтвердил, создаём карточку.
  async function create() {
    if (!boardId) {
      Alert.alert('Выберите доску');
      return;
    }
    if (!title.trim()) {
      Alert.alert('Заголовок пустой');
      return;
    }

    setLoading(true);
    try {
      await createCard(boardId, title.trim(), text.trim(), photos);
      setStep('done');
    } catch (e) {
      Alert.alert('Не удалось создать карточку', String(e));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setText('');
    setPhotos([]);
    setBoardId('');
    setAiBoardId('');
    setTitle('');
    setHint('');
    setStep('input');
  }

  // ---------- Экраны ----------

  const boardTitle = boards.find((b) => b.id === boardId)?.title ?? '';
  const seconds = Math.floor(recorderState.durationMillis / 1000);
  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  // Плитка «Камера» или «Галерея».
  function photoTile(icon: IconName, label: string, sub: string, color: string, soft: string, fromCamera: boolean) {
    return (
      <Pressable
        onPress={() => pickPhoto(fromCamera)}
        style={({ pressed }) => [styles.tile, { backgroundColor: soft }, pressed && { transform: [{ scale: 0.97 }] }]}
      >
        <View style={[styles.tileIcon, { backgroundColor: color }]}>
          <Ionicons name={icon} size={24} color="#fff" />
        </View>
        <Text style={[styles.tileLabel, { color }]}>{label}</Text>
        <Text style={styles.tileSub}>{sub}</Text>
      </Pressable>
    );
  }

  let content;
  let bottom; // нижняя панель: кнопки в зоне большого пальца

  if (step === 'done') {
    content = (
      <View style={styles.doneBox}>
        <View style={styles.doneCircle}>
          <Ionicons name="checkmark" size={56} color={colors.success} />
        </View>
        <Text style={styles.doneTitle}>Карточка создана</Text>
        <Text style={styles.doneText}>
          «{title.trim()}» добавлена на доску «{boardTitle}»
          {photos.length > 0 ? `, фото: ${photos.length}` : ''}
        </Text>
      </View>
    );
    bottom = <AppButton title="Новая заявка" icon="add" onPress={reset} />;
  } else if (step === 'confirm') {
    content = (
      <>
        {hint !== '' && <Banner text={hint} />}

        <BoardPicker boards={boards} selectedId={boardId} aiId={aiBoardId} onSelect={setBoardId} />

        <Card title="Заголовок">
          <TextInput style={styles.input} value={title} onChangeText={setTitle} />
        </Card>

        <Card title="Описание">
          <TextInput
            style={[styles.input, styles.multiline]}
            multiline
            value={text}
            onChangeText={setText}
          />
          {photos.length > 0 && (
            <View style={styles.photoRow}>
              {photos.map((p) => (
                <Image key={p.uri} source={{ uri: p.uri }} style={styles.thumbSmall} />
              ))}
            </View>
          )}
        </Card>
      </>
    );
    bottom = (
      <View style={styles.bottomRow}>
        <IconButton icon="arrow-back" onPress={() => setStep('input')} disabled={loading} />
        <View style={{ flex: 1 }}>
          <AppButton title="Создать карточку" icon="checkmark" onPress={create} loading={loading} />
        </View>
      </View>
    );
  } else {
    content = (
      <>
        <Card title="Что случилось?">
          <TextInput
            style={[styles.input, styles.multiline, { minHeight: 130 }]}
            multiline
            placeholder="Опишите проблему или нажмите на микрофон внизу"
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
          />
          {transcribing && (
            <View style={styles.inlineStatus}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.inlineStatusText}>Распознаю речь…</Text>
            </View>
          )}
        </Card>

        <Card
          title="Фото"
          right={
            photos.length > 0 ? (
              <View style={styles.counter}>
                <Text style={styles.counterText}>{photos.length}</Text>
              </View>
            ) : undefined
          }
        >
          <View style={styles.tiles}>
            {photoTile('camera', 'Камера', 'сделать снимок', colors.primary, colors.primarySoft, true)}
            {photoTile('images', 'Галерея', 'выбрать готовое', colors.violet, colors.violetSoft, false)}
          </View>
          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
              {photos.map((p) => (
                <View key={p.uri}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} />
                  {/* Крестик в углу превью — убрать фото */}
                  <Pressable onPress={() => removePhoto(p.uri)} style={styles.removePhoto} hitSlop={8}>
                    <Ionicons name="close" size={14} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </Card>
      </>
    );

    // Кольцо растёт и тает: scale 1 → 1.6, прозрачность 0.5 → 0.
    const ring = {
      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
    };
    const canClear = !recording && !transcribing && (text !== '' || photos.length > 0);
    const canSend = !recording && !transcribing && text.trim() !== '';

    bottom = (
      <>
        <Text style={[styles.micHint, recording && { color: colors.danger }]}>
          {recording
            ? `● Запись ${timer} · нажмите, чтобы закончить`
            : transcribing
              ? 'Распознаю речь…'
              : 'Нажмите и расскажите о проблеме'}
        </Text>
        <View style={styles.bottomRow}>
          <View style={styles.side}>
            <IconButton icon="trash-outline" onPress={reset} disabled={!canClear} />
          </View>

          {/* Большая кнопка микрофона: нажал — говоришь, нажал ещё раз — текст появляется в поле. */}
          <View style={styles.micWrap}>
            {recording && <Animated.View style={[styles.mic, styles.micRing, ring]} />}
            <Pressable
              onPress={recording ? stopRecording : startRecording}
              disabled={transcribing}
              style={({ pressed }) => [
                styles.mic,
                recording && styles.micActive,
                transcribing && { backgroundColor: colors.primarySoft },
                pressed && { transform: [{ scale: 0.95 }] },
              ]}
            >
              {transcribing ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Ionicons name={recording ? 'stop' : 'mic'} size={36} color="#fff" />
              )}
            </Pressable>
          </View>

          <View style={[styles.side, { alignItems: 'flex-end' }]}>
            <Pressable
              onPress={send}
              disabled={!canSend}
              style={({ pressed }) => [styles.next, (!canSend || pressed) && { opacity: 0.4 }]}
            >
              <Text style={styles.nextText}>Далее</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      </>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <StatusBar style="dark" />

      {/* Шапка: название и индикатор связи с сервером */}
      <View style={styles.header}>
        <Text style={styles.appName}>Заявка</Text>
        <View style={styles.status}>
          <View
            style={[
              styles.dot,
              { backgroundColor: online === null ? colors.muted : online ? colors.success : colors.danger },
            ]}
          />
          <Text style={styles.statusText}>
            {online === null ? 'Проверка…' : online ? 'Сервер на связи' : 'Нет связи'}
          </Text>
        </View>
      </View>
      {step !== 'done' && (
        <Text style={styles.subtitle}>
          {step === 'input' ? 'Шаг 1 из 2 · Опишите проблему' : 'Шаг 2 из 2 · Проверьте карточку'}
        </Text>
      )}

      {/* KeyboardAvoidingView поднимает содержимое и нижнюю панель, когда открыта клавиатура */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {content}
        </ScrollView>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>{bottom}</View>
      </KeyboardAvoidingView>

      <AiProgress visible={aiOpen} done={aiDone} onFinished={onAiFinished} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  appName: { fontSize: 30, fontWeight: '800', color: colors.text },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, color: colors.muted },
  subtitle: { fontSize: 15, color: colors.muted, paddingHorizontal: 20, marginTop: 4, marginBottom: 4 },
  scroll: { padding: 16, paddingBottom: 24 },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.field,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  inlineStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  inlineStatusText: { color: colors.primary, fontSize: 14 },

  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, borderRadius: 18, padding: 14, gap: 2 },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  tileLabel: { fontSize: 16, fontWeight: '700' },
  tileSub: { fontSize: 13, color: colors.muted },
  counter: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  photoStrip: { gap: 12, paddingTop: 14, paddingRight: 8 },
  thumb: { width: 88, height: 88, borderRadius: 16 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  thumbSmall: { width: 64, height: 64, borderRadius: 12 },
  removePhoto: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(17, 24, 39, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Нижняя панель
  bottom: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  side: { flex: 1 },
  micHint: { textAlign: 'center', color: colors.muted, fontSize: 13, marginBottom: 10 },
  micWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  mic: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  micActive: { backgroundColor: colors.danger, shadowColor: colors.danger },
  micRing: { position: 'absolute', backgroundColor: colors.danger, shadowOpacity: 0, elevation: 0 },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 54,
    borderRadius: 27,
    paddingHorizontal: 18,
    backgroundColor: colors.text,
  },
  nextText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  doneBox: { alignItems: 'center', paddingTop: 60 },
  doneCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitle: { fontSize: 24, fontWeight: '700', color: colors.text, marginTop: 20 },
  doneText: { fontSize: 16, color: colors.muted, textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },
});
