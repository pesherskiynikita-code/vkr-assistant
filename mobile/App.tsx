import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import * as ImagePicker from 'expo-image-picker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

import { assist, Board, checkHealth, createCard, getBoards, LocalFile, transcribe } from './src/api';
import { AppButton, Banner, Card, colors } from './src/ui';

// Приложение — три экрана подряд: ввод → подтверждение → готово.
type Step = 'input' | 'confirm' | 'done';

export default function App() {
  const [step, setStep] = useState<Step>('input');

  // Экран ввода
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<LocalFile[]>([]);

  // Экран подтверждения
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState(''); // выбранная доска
  const [aiBoardId, setAiBoardId] = useState(''); // доска, которую предложил ИИ (для значка «ИИ»)
  const [title, setTitle] = useState('');
  const [hint, setHint] = useState('');

  const [loading, setLoading] = useState(false);
  // null — ещё проверяем, true/false — ответил ли сервер на /health
  const [online, setOnline] = useState<boolean | null>(null);

  // Голосовой ввод: recorder пишет звук с микрофона в файл .m4a на телефоне,
  // recorderState каждые 250 мс сообщает, идёт ли запись и сколько она длится.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [transcribing, setTranscribing] = useState(false);

  // При запуске один раз проверяем, видит ли телефон сервер.
  useEffect(() => {
    checkHealth().then(setOnline);
  }, []);

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
  async function send() {
    if (!text.trim()) {
      Alert.alert('Пусто', 'Опишите проблему текстом или голосом');
      return;
    }

    setLoading(true);
    try {
      // Доски нужны в любом случае: показать название и дать выбрать другую.
      setBoards(await getBoards());
      setOnline(true);

      const res = await assist(text);
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
      setStep('confirm');
    } catch (e) {
      setOnline(false);
      Alert.alert('Нет связи с сервером', String(e));
    } finally {
      setLoading(false);
    }
  }

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

  let content;

  if (step === 'done') {
    content = (
      <View style={styles.doneBox}>
        <View style={styles.doneCircle}>
          <Text style={styles.doneCheck}>✓</Text>
        </View>
        <Text style={styles.doneTitle}>Карточка создана</Text>
        <Text style={styles.doneText}>
          «{title.trim()}» добавлена на доску «{boardTitle}»
          {photos.length > 0 ? `, фото: ${photos.length}` : ''}
        </Text>
        <View style={{ alignSelf: 'stretch', marginTop: 24 }}>
          <AppButton title="Новая заявка" onPress={reset} />
        </View>
      </View>
    );
  } else if (step === 'confirm') {
    content = (
      <>
        {hint !== '' ? (
          <Banner text={hint} />
        ) : (
          <Banner kind="success" text="ИИ подобрал доску и заголовок. Проверьте и при необходимости поправьте." />
        )}

        <Card title="Доска">
          {boards.map((b) => {
            const selected = b.id === boardId;
            return (
              <Pressable
                key={b.id}
                onPress={() => setBoardId(b.id)}
                style={[styles.board, selected && styles.boardSelected]}
              >
                {/* Кружок как у радиокнопки: заполнен у выбранной доски */}
                <View style={[styles.radio, selected && styles.radioOn]} />
                <Text style={styles.boardText}>{b.title}</Text>
                {b.id === aiBoardId && <Text style={styles.aiBadge}>ИИ</Text>}
              </Pressable>
            );
          })}
        </Card>

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
            <View style={styles.photos}>
              {photos.map((p) => (
                <Image key={p.uri} source={{ uri: p.uri }} style={styles.thumb} />
              ))}
            </View>
          )}
        </Card>

        <AppButton title="Создать карточку" onPress={create} loading={loading} />
        <AppButton title="Назад" variant="secondary" onPress={() => setStep('input')} disabled={loading} />
      </>
    );
  } else {
    content = (
      <>
        <Card title="Что случилось?">
          {/* Большая кнопка микрофона: нажал — говоришь, нажал ещё раз — текст появляется в поле. */}
          <View style={styles.micBox}>
            {transcribing ? (
              <>
                <View style={[styles.mic, { backgroundColor: colors.primarySoft }]}>
                  <ActivityIndicator color={colors.primary} />
                </View>
                <Text style={styles.micHint}>Распознаю речь…</Text>
              </>
            ) : (
              <>
                <Pressable
                  onPress={recorderState.isRecording ? stopRecording : startRecording}
                  style={({ pressed }) => [
                    styles.mic,
                    recorderState.isRecording && styles.micActive,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={styles.micIcon}>{recorderState.isRecording ? '■' : '🎤'}</Text>
                </Pressable>
                <Text style={styles.micHint}>
                  {recorderState.isRecording
                    ? `Идёт запись 0:${String(seconds).padStart(2, '0')}. Нажмите, чтобы закончить`
                    : 'Нажмите и расскажите о проблеме'}
                </Text>
              </>
            )}
          </View>

          <TextInput
            style={[styles.input, styles.multiline]}
            multiline
            placeholder="…или напишите текстом"
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
          />
        </Card>

        <Card title="Фото">
          <View style={styles.photos}>
            {photos.map((p) => (
              <View key={p.uri}>
                <Image source={{ uri: p.uri }} style={styles.thumb} />
                {/* Крестик в углу превью — убрать фото */}
                <Pressable onPress={() => removePhoto(p.uri)} style={styles.removePhoto} hitSlop={8}>
                  <Text style={styles.removePhotoText}>×</Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => pickPhoto(true)} style={styles.addPhoto}>
              <Text style={styles.addPhotoIcon}>📷</Text>
              <Text style={styles.addPhotoText}>Камера</Text>
            </Pressable>
            <Pressable onPress={() => pickPhoto(false)} style={styles.addPhoto}>
              <Text style={styles.addPhotoIcon}>🖼️</Text>
              <Text style={styles.addPhotoText}>Галерея</Text>
            </Pressable>
          </View>
        </Card>

        <AppButton
          title="Далее"
          onPress={send}
          loading={loading}
          disabled={recorderState.isRecording || transcribing}
        />
        {/* Пока ИИ думает (на процессоре это несколько секунд), объясняем, чего ждём. */}
        {loading && <Text style={styles.waitText}>ИИ подбирает доску…</Text>}
      </>
    );
  }

  return (
    <View style={styles.root}>
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

      {/* KeyboardAvoidingView поднимает содержимое, когда открыта клавиатура */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {content}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  appName: { fontSize: 30, fontWeight: '700', color: colors.text },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, color: colors.muted },
  subtitle: { fontSize: 15, color: colors.muted, paddingHorizontal: 20, marginTop: 4 },
  scroll: { padding: 16, paddingBottom: 40 },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: '#fafafa',
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },

  micBox: { alignItems: 'center', marginBottom: 14 },
  mic: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micActive: { backgroundColor: colors.danger },
  micIcon: { fontSize: 36, color: '#fff' },
  micHint: { marginTop: 10, color: colors.muted, fontSize: 14 },

  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  thumb: { width: 76, height: 76, borderRadius: 12 },
  removePhoto: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhotoText: { color: '#fff', fontSize: 16, lineHeight: 18 },
  addPhoto: {
    width: 76,
    height: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoIcon: { fontSize: 22 },
  addPhotoText: { fontSize: 12, color: colors.primary, marginTop: 2 },

  waitText: { textAlign: 'center', color: colors.muted, marginTop: 8 },

  board: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: 8,
  },
  boardSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  boardText: { flex: 1, fontSize: 16, color: colors.text },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border, marginRight: 10 },
  radioOn: { borderColor: colors.primary, borderWidth: 6 },
  aiBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },

  doneBox: { alignItems: 'center', paddingTop: 60 },
  doneCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneCheck: { fontSize: 48, color: colors.success, fontWeight: '700' },
  doneTitle: { fontSize: 24, fontWeight: '700', color: colors.text, marginTop: 20 },
  doneText: { fontSize: 16, color: colors.muted, textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },
});
