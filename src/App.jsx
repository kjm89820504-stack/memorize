import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  FileText,
  FolderPlus,
  Home,
  LockKeyhole,
  LogOut,
  Pencil,
  Play,
  RefreshCcw,
  Save,
  Settings,
  Sparkles,
  Upload,
  UserPlus,
  XCircle,
} from "lucide-react";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
} from "firebase/auth";
import { get, onValue, push, ref, serverTimestamp, set, update } from "firebase/database";
import { auth, db, isFirebaseConfigured } from "./lib/firebase";
import {
  badgeLetters,
  buildAcronym,
  buildItemsFromText,
  EXAMPLE_TEXT,
  firstLetter,
  makeMnemonicSentences,
  makeQuiz,
} from "./utils/mnemonic";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,16}$/;
const DEFAULT_FOLDER_NAME = "기본 폴더";

function emptyDraft(folderId = "") {
  return {
    title: "",
    subject: "",
    folderId,
    content: "",
    items: [],
    acronym: "",
    mnemonics: [],
    selectedMnemonicId: "humor",
  };
}

export default function App() {
  const [session, setSession] = useState({ loading: true, user: null, profile: null });
  const [folders, setFolders] = useState([]);
  const [sets, setSets] = useState([]);
  const [reviewLogs, setReviewLogs] = useState([]);
  const [view, setView] = useState("home");
  const [draft, setDraft] = useState(emptyDraft());
  const [currentSet, setCurrentSet] = useState(null);
  const [quizResult, setQuizResult] = useState(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setSession({ loading: false, user: null, profile: null });
      return undefined;
    }

    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setSession({ loading: false, user: null, profile: null });
        setFolders([]);
        setSets([]);
        setReviewLogs([]);
        return;
      }

      const profileSnapshot = await get(ref(db, `profiles/${user.uid}`));
      const profile = profileSnapshot.val() || {
        username: usernameFromEmail(user.email),
        nickname: user.displayName || "암기러",
      };

      setSession({ loading: false, user, profile });
    });
  }, []);

  useEffect(() => {
    if (!session.user) return undefined;

    const uid = session.user.uid;
    let defaultFolderCreated = false;

    const stopFolders = onValue(ref(db, `folders/${uid}`), async (snapshot) => {
      const nextFolders = snapshotToArray(snapshot).sort(sortByCreatedAsc);
      setFolders(nextFolders);

      if (!snapshot.exists() && !defaultFolderCreated) {
        defaultFolderCreated = true;
        await set(ref(db, `folders/${uid}/default`), {
          name: DEFAULT_FOLDER_NAME,
          createdAt: serverTimestamp(),
        });
      }
    });

    const stopSets = onValue(ref(db, `sets/${uid}`), (snapshot) => {
      setSets(snapshotToArray(snapshot).sort(sortByUpdatedDesc));
    });

    const stopLogs = onValue(ref(db, `reviewLogs/${uid}`), (snapshot) => {
      setReviewLogs(snapshotToArray(snapshot).sort(sortByCreatedDesc));
    });

    return () => {
      stopFolders();
      stopSets();
      stopLogs();
    };
  }, [session.user]);

  const stats = useMemo(() => makeTodayStats(sets, reviewLogs), [sets, reviewLogs]);

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  }

  async function handleLogin(username, password) {
    await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
  }

  async function handleCheckUsername(username) {
    const key = normalizeUsername(username);
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error("아이디는 영문, 숫자, _, - 조합 3~16자로 입력해 주세요.");
    }

    const snapshot = await get(ref(db, `usernames/${key}`));
    return !snapshot.exists();
  }

  async function handleRegister({ username, password, nickname }) {
    const key = normalizeUsername(username);
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      usernameToEmail(username),
      password,
    );

    await updateProfile(userCredential.user, { displayName: nickname });
    await set(ref(db, `usernames/${key}`), userCredential.user.uid);
    await set(ref(db, `profiles/${userCredential.user.uid}`), {
      username: key,
      nickname,
      createdAt: serverTimestamp(),
    });

    notify("회원가입이 완료됐어요.");
  }

  async function handleProfileUpdate({ nickname, currentPassword, newPassword }) {
    if (!session.user || !session.profile) return;

    const updates = {};
    if (nickname && nickname !== session.profile.nickname) {
      await updateProfile(session.user, { displayName: nickname });
      updates.nickname = nickname;
    }

    if (newPassword) {
      const credential = EmailAuthProvider.credential(
        usernameToEmail(session.profile.username),
        currentPassword,
      );
      await reauthenticateWithCredential(session.user, credential);
      await updatePassword(session.user, newPassword);
    }

    if (Object.keys(updates).length) {
      await update(ref(db, `profiles/${session.user.uid}`), updates);
      setSession((previous) => ({
        ...previous,
        profile: { ...previous.profile, ...updates },
      }));
    }

    notify("프로필이 저장됐어요.");
  }

  async function handleLogout() {
    await signOut(auth);
    setView("home");
    setCurrentSet(null);
  }

  async function createFolder(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const folderRef = push(ref(db, `folders/${session.user.uid}`));
    const folder = {
      id: folderRef.key,
      name: trimmed,
      createdAt: serverTimestamp(),
    };

    await set(folderRef, {
      name: trimmed,
      createdAt: serverTimestamp(),
    });
    notify("새 폴더를 만들었어요.");
    return folder;
  }

  async function startNewSet(folderId = "") {
    let targetFolderId = folderId || folders[0]?.id;

    if (!targetFolderId) {
      await set(ref(db, `folders/${session.user.uid}/default`), {
        name: DEFAULT_FOLDER_NAME,
        createdAt: serverTimestamp(),
      });
      targetFolderId = "default";
    }

    setDraft(emptyDraft(targetFolderId));
    setCurrentSet(null);
    setView("input");
  }

  function goKeywordStep(nextDraft) {
    const items = buildItemsFromText(nextDraft.content);
    if (!items.length) {
      notify("암기 내용을 한 줄 이상 입력해 주세요.");
      return;
    }

    setDraft({
      ...nextDraft,
      items,
      acronym: buildAcronym(items),
      mnemonics: makeMnemonicSentences(items),
      selectedMnemonicId: "humor",
    });
    setView("keywords");
  }

  function goResultStep(nextItems) {
    const nextDraft = {
      ...draft,
      items: nextItems,
      acronym: buildAcronym(nextItems),
      mnemonics: makeMnemonicSentences(nextItems),
    };
    setDraft(nextDraft);
    setCurrentSet(normalizeSet(nextDraft));
    setView("result");
  }

  async function saveCurrentSet(setToSave = currentSet) {
    if (!setToSave || !session.user) return null;

    const selectedMnemonic =
      setToSave.mnemonics.find((mnemonic) => mnemonic.id === setToSave.selectedMnemonicId) ||
      setToSave.mnemonics[0];

    const payload = {
      title: setToSave.title || "이름 없는 암기세트",
      subject: setToSave.subject || "기타",
      folderId: setToSave.folderId || folders[0]?.id || "",
      items: setToSave.items,
      acronym: setToSave.acronym,
      mnemonics: setToSave.mnemonics,
      selectedMnemonicId: selectedMnemonic?.id || "compact",
      selectedMnemonic: selectedMnemonic?.text || setToSave.acronym,
      updatedAt: serverTimestamp(),
    };

    if (setToSave.id) {
      await update(ref(db, `sets/${session.user.uid}/${setToSave.id}`), payload);
      notify("암기세트를 다시 저장했어요.");
      return { ...setToSave, ...payload };
    }

    const setRef = push(ref(db, `sets/${session.user.uid}`));
    const saved = {
      id: setRef.key,
      ...setToSave,
      ...payload,
      createdAt: Date.now(),
    };

    await set(setRef, {
      ...payload,
      createdAt: serverTimestamp(),
    });
    setCurrentSet(saved);
    notify("암기세트를 저장했어요.");
    return saved;
  }

  function openSavedSet(savedSet) {
    const normalized = normalizeSet(savedSet);
    setCurrentSet(normalized);
    setDraft(emptyDraft(normalized.folderId));
    setView("result");
  }

  async function startQuiz() {
    const savedSet = currentSet?.id ? currentSet : await saveCurrentSet(currentSet);
    if (!savedSet) return;

    setCurrentSet(normalizeSet(savedSet));
    setView("quiz");
  }

  async function finishQuiz(result) {
    const logRef = push(ref(db, `reviewLogs/${session.user.uid}`));
    await set(logRef, {
      setId: currentSet?.id || "",
      setTitle: currentSet?.title || "",
      total: result.total,
      correct: result.correct,
      accuracy: result.accuracy,
      wrongs: result.wrongs,
      createdAt: serverTimestamp(),
    });

    setQuizResult(result);
    setView("quizResult");
  }

  if (!isFirebaseConfigured) {
    return <SetupScreen />;
  }

  if (session.loading) {
    return (
      <Shell>
        <div className="loading-card">앱을 깨우는 중...</div>
      </Shell>
    );
  }

  if (!session.user) {
    return (
      <Shell>
        <AuthScreen
          onCheckUsername={handleCheckUsername}
          onLogin={handleLogin}
          onRegister={handleRegister}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <AppHeader
        profile={session.profile}
        onHome={() => setView("home")}
        onLogout={handleLogout}
        onProfileUpdate={handleProfileUpdate}
      />

      {view === "home" && (
        <HomeScreen
          folders={folders}
          sets={sets}
          stats={stats}
          onCreateFolder={createFolder}
          onNewSet={startNewSet}
          onOpenSet={openSavedSet}
        />
      )}

      {view === "input" && (
        <InputScreen
          draft={draft}
          folders={folders}
          onBack={() => setView("home")}
          onNext={goKeywordStep}
        />
      )}

      {view === "keywords" && (
        <KeywordScreen
          draft={draft}
          onBack={() => setView("input")}
          onDone={goResultStep}
        />
      )}

      {view === "result" && currentSet && (
        <ResultScreen
          memorySet={currentSet}
          folders={folders}
          onBack={() => setView(currentSet.id ? "home" : "keywords")}
          onChange={setCurrentSet}
          onSave={saveCurrentSet}
          onStartQuiz={startQuiz}
        />
      )}

      {view === "quiz" && currentSet && (
        <QuizScreen
          memorySet={currentSet}
          onBack={() => setView("result")}
          onFinish={finishQuiz}
        />
      )}

      {view === "quizResult" && quizResult && currentSet && (
        <QuizResultScreen
          result={quizResult}
          memorySet={currentSet}
          onRetry={() => setView("quiz")}
          onHome={() => setView("home")}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="page-shell">
      <main className="phone-shell">{children}</main>
    </div>
  );
}

function AppHeader({ profile, onHome, onLogout, onProfileUpdate }) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="app-header">
      <button className="icon-button" type="button" onClick={onHome} aria-label="홈">
        <Home size={20} />
      </button>
      <div className="user-chip">
        <span>{profile?.nickname || "암기러"}</span>
        <small>@{profile?.username || "user"}</small>
      </div>
      <button
        className="icon-button"
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label="설정"
      >
        <Settings size={20} />
      </button>
      <button className="icon-button" type="button" onClick={onLogout} aria-label="로그아웃">
        <LogOut size={20} />
      </button>

      {settingsOpen && (
        <SettingsDialog
          profile={profile}
          onClose={() => setSettingsOpen(false)}
          onSave={async (form) => {
            await onProfileUpdate(form);
            setSettingsOpen(false);
          }}
        />
      )}
    </header>
  );
}

function BrandTitle({ compact = false }) {
  return (
    <div className={compact ? "brand compact" : "brand"}>
      <div className="brand-acronym" aria-label="암기외안헤">
        {["암", "기", "외", "안", "헤"].map((letter) => (
          <span key={letter}>{letter}</span>
        ))}
      </div>
      <p>
        <mark>암</mark>것도 <mark>기</mark>찮아서 <mark>외</mark>우고싶지{" "}
        <mark>안</mark>타 <mark>헤</mark>응
      </p>
    </div>
  );
}

function AuthScreen({ onCheckUsername, onLogin, onRegister }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [usernameOk, setUsernameOk] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      if (mode === "login") {
        await onLogin(username, password);
      } else {
        if (!usernameOk) throw new Error("아이디 중복 확인을 먼저 해 주세요.");
        if (password.length < 6) throw new Error("비밀번호는 6자 이상이어야 해요.");
        if (password !== confirmPassword) throw new Error("비밀번호 확인이 서로 달라요.");
        if (!nickname.trim()) throw new Error("닉네임을 입력해 주세요.");
        await onRegister({ username, password, nickname: nickname.trim() });
      }
    } catch (error) {
      setMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function checkUsername() {
    setBusy(true);
    setMessage("");

    try {
      const available = await onCheckUsername(username.trim());
      setUsernameOk(available);
      setMessage(available ? "사용 가능한 아이디예요." : "이미 사용 중인 아이디예요.");
    } catch (error) {
      setUsernameOk(false);
      setMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setUsernameOk(false);
    setMessage("");
  }

  return (
    <section className="auth-screen">
      <BrandTitle />
      <p className="hero-copy">외울 내용을 넣으면 첫글자 암기법과 퀴즈를 바로 만들어줘요.</p>

      <div className="segmented">
        <button
          className={mode === "login" ? "active" : ""}
          type="button"
          onClick={() => switchMode("login")}
        >
          로그인
        </button>
        <button
          className={mode === "register" ? "active" : ""}
          type="button"
          onClick={() => switchMode("register")}
        >
          회원가입
        </button>
      </div>

      <form className="card form-card" onSubmit={submit}>
        <label>
          아이디
          <div className="inline-field">
            <input
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setUsernameOk(false);
              }}
              placeholder="예: amgi123"
              autoComplete="username"
            />
            {mode === "register" && (
              <button className="small-button" type="button" onClick={checkUsername}>
                중복확인
              </button>
            )}
          </div>
        </label>

        <label>
          비밀번호
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="6자 이상"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>

        {mode === "register" && (
          <>
            <label>
              비밀번호 확인
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                placeholder="한 번 더 입력"
                autoComplete="new-password"
              />
            </label>
            <label>
              닉네임
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="앱에서 보일 이름"
              />
            </label>
          </>
        )}

        {message && (
          <p className={usernameOk ? "form-message good" : "form-message"}>
            {usernameOk ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {message}
          </p>
        )}

        <button className="primary-button" type="submit" disabled={busy}>
          {mode === "login" ? <LockKeyhole size={20} /> : <UserPlus size={20} />}
          {mode === "login" ? "로그인" : "가입 완료"}
        </button>
      </form>
    </section>
  );
}

function HomeScreen({ folders, sets, stats, onCreateFolder, onNewSet, onOpenSet }) {
  const [folderName, setFolderName] = useState("");
  const setCountByFolder = useMemo(() => {
    return sets.reduce((acc, memorySet) => {
      acc[memorySet.folderId] = (acc[memorySet.folderId] || 0) + 1;
      return acc;
    }, {});
  }, [sets]);

  async function submitFolder(event) {
    event.preventDefault();
    await onCreateFolder(folderName);
    setFolderName("");
  }

  return (
    <section className="screen-stack">
      <div className="home-hero">
        <BrandTitle compact />
        <p>외울 내용을 넣으면 첫글자 암기법과 퀴즈를 바로 만들어줘요.</p>
        <button className="primary-button hero-button window-cta" type="button" onClick={() => onNewSet()}>
          <Sparkles size={22} />
          새 암기 만들기
        </button>
      </div>

      <div className="home-actions">
        <form className="window-button folder-form" onSubmit={submitFolder}>
          <FolderPlus size={22} />
          <input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="새 폴더 이름"
            aria-label="새 폴더 이름"
          />
          <button type="submit">만들기</button>
        </form>
      </div>

      <section className="section-block">
        <div className="section-title">
          <h2>오늘 복습 현황</h2>
        </div>
        <div className="stats-grid">
          <StatCard label="오늘 만든 암기세트" value={`${stats.todaySetCount}개`} />
          <StatCard label="오늘 푼 퀴즈" value={`${stats.questionCount}문제`} />
          <StatCard label="정답률" value={`${stats.accuracy}%`} accent />
        </div>
        <div className="miss-card">
          <span>가장 많이 틀린 항목</span>
          <strong>{stats.topMiss || "아직 기록 없음"}</strong>
        </div>
      </section>

      <section className="section-block">
        <div className="section-title">
          <h2>폴더</h2>
        </div>
        <div className="folder-list">
          {folders.map((folder) => (
            <button
              className="folder-card"
              type="button"
              key={folder.id}
              onClick={() => onNewSet(folder.id)}
            >
              <span>{folder.name}</span>
              <small>{setCountByFolder[folder.id] || 0}개 암기세트</small>
            </button>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-title">
          <h2>저장된 암기세트</h2>
        </div>
        <div className="set-list">
          {sets.length === 0 && (
            <div className="empty-card">
              <BookOpen size={28} />
              <p>아직 저장된 암기세트가 없어요.</p>
            </div>
          )}
          {sets.map((memorySet) => (
            <button className="set-card" type="button" key={memorySet.id} onClick={() => onOpenSet(memorySet)}>
              <div>
                <strong>{memorySet.title}</strong>
                <small>{memorySet.subject || "기타"} · {formatDate(memorySet.updatedAt || memorySet.createdAt)}</small>
              </div>
              <span>{memorySet.acronym}</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}

function StatCard({ label, value, accent = false }) {
  return (
    <div className={accent ? "stat-card accent" : "stat-card"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InputScreen({ draft, folders, onBack, onNext }) {
  const [form, setForm] = useState(draft);

  function updateField(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  function loadExample() {
    setForm((previous) => ({
      ...previous,
      title: previous.title || "생명윤리 원칙",
      subject: previous.subject || "윤리",
      content: EXAMPLE_TEXT,
    }));
  }

  function uploadText(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => updateField("content", String(reader.result || ""));
    reader.readAsText(file, "utf-8");
  }

  return (
    <section className="screen-stack">
      <BackButton onClick={onBack} label="홈으로" />
      <div className="card form-card">
        <div className="screen-heading">
          <FileText size={24} />
          <div>
            <h1>암기 내용 입력</h1>
            <p>한 줄에 하나씩 외울 항목을 적어 주세요.</p>
          </div>
        </div>

        <label>
          제목
          <input
            value={form.title}
            onChange={(event) => updateField("title", event.target.value)}
            placeholder="예: 생명윤리 7원칙"
          />
        </label>

        <label>
          과목명
          <input
            value={form.subject}
            onChange={(event) => updateField("subject", event.target.value)}
            placeholder="예: 윤리와 사상"
          />
        </label>

        <label>
          저장 폴더
          <select value={form.folderId} onChange={(event) => updateField("folderId", event.target.value)}>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          암기 내용
          <textarea
            value={form.content}
            onChange={(event) => updateField("content", event.target.value)}
            placeholder={`1. 생명 보호의 원칙\n2. 평등과 불평등의 원칙`}
            rows={10}
          />
        </label>

        <div className="button-row">
          <button className="secondary-button" type="button" onClick={loadExample}>
            <Sparkles size={19} />
            예시 불러오기
          </button>
          <label className="secondary-button upload-button">
            <Upload size={19} />
            TXT 업로드
            <input type="file" accept=".txt,text/plain" onChange={uploadText} />
          </label>
        </div>

        <button className="primary-button" type="button" onClick={() => onNext(form)}>
          다음 단계
        </button>
      </div>
    </section>
  );
}

function KeywordScreen({ draft, onBack, onDone }) {
  const [items, setItems] = useState(draft.items);

  function updateKeyword(id, keyword) {
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, keyword } : item)),
    );
  }

  function reExtract() {
    setItems(buildItemsFromText(draft.content));
  }

  return (
    <section className="screen-stack">
      <BackButton onClick={onBack} label="입력으로" />
      <div className="screen-heading">
        <Pencil size={24} />
        <div>
          <h1>핵심어 수정</h1>
          <p>자동 추출된 핵심어를 시험장에서 떠오를 단어로 바꿔 주세요.</p>
        </div>
      </div>

      <div className="keyword-list">
        {items.map((item) => (
          <article className="keyword-card" key={item.id}>
            <div className="letter-badge">{firstLetter(item.keyword)}</div>
            <div className="keyword-body">
              <span className="order-label">{item.order}번 원문</span>
              <p>{item.original}</p>
              <label>
                핵심어
                <input
                  value={item.keyword}
                  onChange={(event) => updateKeyword(item.id, event.target.value)}
                />
              </label>
            </div>
          </article>
        ))}
      </div>

      <div className="sticky-actions">
        <button className="secondary-button" type="button" onClick={reExtract}>
          <RefreshCcw size={19} />
          핵심어 다시 추출
        </button>
        <button className="primary-button" type="button" onClick={() => onDone(items)}>
          암기 문장 만들기
        </button>
      </div>
    </section>
  );
}

function ResultScreen({ memorySet, folders, onBack, onChange, onSave, onStartQuiz }) {
  const selectedMnemonic =
    memorySet.mnemonics.find((mnemonic) => mnemonic.id === memorySet.selectedMnemonicId) ||
    memorySet.mnemonics[0];
  const folder = folders.find((item) => item.id === memorySet.folderId);

  function selectMnemonic(id) {
    onChange({ ...memorySet, selectedMnemonicId: id });
  }

  return (
    <section className="screen-stack">
      <BackButton onClick={onBack} label={memorySet.id ? "홈으로" : "수정으로"} />
      <div className="result-hero card">
        <span>{folder?.name || "기본 폴더"} · {memorySet.subject || "기타"}</span>
        <h1>{memorySet.title || "이름 없는 암기세트"}</h1>
        <div className="acronym-display">{memorySet.acronym}</div>
        <div className="letter-row">
          {badgeLetters(memorySet.items).map((letter, index) => (
            <span className="letter-badge small" key={`${letter}-${index}`}>
              {letter}
            </span>
          ))}
        </div>
      </div>

      <section className="section-block">
        <div className="section-title">
          <h2>추천 암기문장</h2>
        </div>
        <div className="speech-card">
          <span>{selectedMnemonic?.style || "추천"}</span>
          <p>{selectedMnemonic?.text || memorySet.acronym}</p>
        </div>
      </section>

      <section className="section-block">
        <div className="section-title">
          <h2>스타일별 암기문장</h2>
        </div>
        <div className="mnemonic-list">
          {memorySet.mnemonics.map((mnemonic) => (
            <button
              className={
                mnemonic.id === memorySet.selectedMnemonicId
                  ? "mnemonic-card selected"
                  : "mnemonic-card"
              }
              type="button"
              key={mnemonic.id}
              onClick={() => selectMnemonic(mnemonic.id)}
            >
              <span>
                {mnemonic.style}
                {mnemonic.id === "humor" && <em>재미 태그</em>}
              </span>
              <small>{mnemonic.tag}</small>
              <p>{mnemonic.text}</p>
            </button>
          ))}
        </div>
      </section>

      <div className="sticky-actions">
        <button className="secondary-button" type="button" onClick={() => onSave(memorySet)}>
          <Save size={19} />
          저장
        </button>
        <button className="primary-button" type="button" onClick={onStartQuiz}>
          <Play size={20} />
          퀴즈 시작
        </button>
      </div>
    </section>
  );
}

function QuizScreen({ memorySet, onBack, onFinish }) {
  const [questions] = useState(() => makeQuiz(memorySet));
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [checked, setChecked] = useState(false);
  const [answers, setAnswers] = useState([]);

  const current = questions[index];
  const progress = Math.round(((index + (checked ? 1 : 0)) / questions.length) * 100);

  function checkAnswer() {
    if (!selected) return;
    setChecked(true);
  }

  function goNext() {
    const record = {
      question: current.prompt,
      type: current.type,
      selected,
      answer: current.answer,
      correct: selected === current.answer,
      explanation: current.explanation,
    };
    const nextAnswers = [...answers, record];

    if (index === questions.length - 1) {
      const correct = nextAnswers.filter((answer) => answer.correct).length;
      onFinish({
        total: nextAnswers.length,
        correct,
        accuracy: Math.round((correct / nextAnswers.length) * 100),
        wrongs: nextAnswers.filter((answer) => !answer.correct),
      });
      return;
    }

    setAnswers(nextAnswers);
    setIndex((previous) => previous + 1);
    setSelected("");
    setChecked(false);
  }

  return (
    <section className="screen-stack">
      <BackButton onClick={onBack} label="결과로" />
      <div className="quiz-header card">
        <div>
          <span>{current.type}</span>
          <h1>
            문제 {index + 1} / {questions.length}
          </h1>
        </div>
        <div className="progress-track" aria-label={`진행률 ${progress}%`}>
          <div style={{ width: `${progress}%` }} />
        </div>
      </div>

      <article className="question-card">
        <p>{current.prompt}</p>
      </article>

      <div className="option-list">
        {current.options.map((option) => {
          const isSelected = selected === option;
          const isAnswer = option === current.answer;
          const className = [
            "option-card",
            isSelected ? "picked" : "",
            checked && isAnswer ? "correct" : "",
            checked && isSelected && !isAnswer ? "wrong" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              className={className}
              type="button"
              key={option}
              onClick={() => !checked && setSelected(option)}
            >
              {option}
            </button>
          );
        })}
      </div>

      {checked && (
        <div className={selected === current.answer ? "feedback correct" : "feedback wrong"}>
          {selected === current.answer ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
          <span>{current.explanation}</span>
        </div>
      )}

      <div className="sticky-actions">
        {!checked ? (
          <button className="primary-button" type="button" onClick={checkAnswer} disabled={!selected}>
            정답 확인
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={goNext}>
            {index === questions.length - 1 ? "결과 보기" : "다음 문제"}
          </button>
        )}
      </div>
    </section>
  );
}

function QuizResultScreen({ result, memorySet, onRetry, onHome }) {
  return (
    <section className="screen-stack">
      <div className="score-card">
        <span>{memorySet.title}</span>
        <strong>{result.accuracy}%</strong>
        <p>
          총 {result.total}문제 중 {result.correct}문제를 맞혔어요.
        </p>
      </div>

      <section className="section-block">
        <div className="section-title">
          <h2>틀린 문제 다시 보기</h2>
        </div>
        <div className="wrong-list">
          {result.wrongs.length === 0 && (
            <div className="empty-card success">
              <CheckCircle2 size={28} />
              <p>전부 정답이에요. 그대로 시험장까지 가져가요.</p>
            </div>
          )}
          {result.wrongs.map((wrong, index) => (
            <article className="wrong-card" key={`${wrong.question}-${index}`}>
              <span>{wrong.type}</span>
              <p>{wrong.question}</p>
              <small>내 답: {wrong.selected}</small>
              <strong>정답: {wrong.answer}</strong>
            </article>
          ))}
        </div>
      </section>

      <div className="sticky-actions">
        <button className="secondary-button" type="button" onClick={onRetry}>
          <RefreshCcw size={19} />
          다시 풀기
        </button>
        <button className="primary-button" type="button" onClick={onHome}>
          <Home size={20} />
          홈으로 가기
        </button>
      </div>
    </section>
  );
}

function SettingsDialog({ profile, onClose, onSave }) {
  const [nickname, setNickname] = useState(profile?.nickname || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      await onSave({ nickname: nickname.trim(), currentPassword, newPassword });
    } catch (error) {
      setMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <form className="dialog-card" onSubmit={submit}>
        <div className="dialog-title">
          <h2>내 정보</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="닫기">
            <XCircle size={20} />
          </button>
        </div>
        <label>
          닉네임
          <input value={nickname} onChange={(event) => setNickname(event.target.value)} />
        </label>
        <label>
          현재 비밀번호
          <input
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            type="password"
            placeholder="비밀번호 변경 시 필요"
          />
        </label>
        <label>
          새 비밀번호
          <input
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            placeholder="변경하지 않으면 비워두기"
          />
        </label>
        {message && <p className="form-message">{message}</p>}
        <button className="primary-button" type="submit" disabled={busy}>
          저장
        </button>
      </form>
    </div>
  );
}

function SetupScreen() {
  return (
    <Shell>
      <section className="auth-screen">
        <BrandTitle />
        <div className="card setup-card">
          <AlertCircle size={28} />
          <h1>Firebase 설정이 필요해요</h1>
          <p>
            `.env.example`을 복사해 `.env`를 만들고 Firebase 웹 앱 설정값을 채우면
            로그인과 Realtime Database 저장 기능이 켜집니다.
          </p>
        </div>
      </section>
    </Shell>
  );
}

function BackButton({ onClick, label }) {
  return (
    <button className="back-button" type="button" onClick={onClick}>
      <ChevronLeft size={19} />
      {label}
    </button>
  );
}

function normalizeSet(rawSet) {
  const items = rawSet.items || [];
  const acronym = rawSet.acronym || buildAcronym(items);
  const mnemonics = rawSet.mnemonics?.length ? rawSet.mnemonics : makeMnemonicSentences(items);

  return {
    ...rawSet,
    items,
    acronym,
    mnemonics,
    selectedMnemonicId: rawSet.selectedMnemonicId || mnemonics[0]?.id || "compact",
  };
}

function snapshotToArray(snapshot) {
  const value = snapshot.val() || {};
  return Object.entries(value).map(([id, data]) => ({ id, ...data }));
}

function sortByCreatedAsc(a, b) {
  return safeTime(a.createdAt) - safeTime(b.createdAt);
}

function sortByCreatedDesc(a, b) {
  return safeTime(b.createdAt) - safeTime(a.createdAt);
}

function sortByUpdatedDesc(a, b) {
  return safeTime(b.updatedAt || b.createdAt) - safeTime(a.updatedAt || a.createdAt);
}

function safeTime(value) {
  if (typeof value === "number") return value;
  return 0;
}

function makeTodayStats(sets, logs) {
  const today = localDateKey(Date.now());
  const todaySets = sets.filter((memorySet) => localDateKey(memorySet.createdAt) === today);
  const todayLogs = logs.filter((log) => localDateKey(log.createdAt) === today);
  const questionCount = todayLogs.reduce((sum, log) => sum + Number(log.total || 0), 0);
  const correctCount = todayLogs.reduce((sum, log) => sum + Number(log.correct || 0), 0);
  const missMap = new Map();

  todayLogs.forEach((log) => {
    (log.wrongs || []).forEach((wrong) => {
      const current = missMap.get(wrong.answer) || 0;
      missMap.set(wrong.answer, current + 1);
    });
  });

  const topMiss = [...missMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  return {
    todaySetCount: todaySets.length,
    questionCount,
    accuracy: questionCount ? Math.round((correctCount / questionCount) * 100) : 0,
    topMiss,
  };
}

function localDateKey(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(timestamp) {
  if (!timestamp) return "방금 전";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "방금 전";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function usernameToEmail(username) {
  return `${normalizeUsername(username)}@amgi-oeanhe.app`;
}

function usernameFromEmail(email = "") {
  return email.split("@")[0] || "user";
}

function friendlyAuthError(error) {
  const code = error?.code || "";
  if (code.includes("auth/invalid-credential")) return "아이디 또는 비밀번호가 맞지 않아요.";
  if (code.includes("auth/email-already-in-use")) return "이미 가입된 아이디예요.";
  if (code.includes("auth/weak-password")) return "비밀번호는 6자 이상으로 입력해 주세요.";
  if (code.includes("auth/requires-recent-login")) return "다시 로그인한 뒤 비밀번호를 변경해 주세요.";
  if (code.includes("auth/wrong-password")) return "현재 비밀번호가 맞지 않아요.";
  return error?.message || "처리 중 문제가 생겼어요.";
}
