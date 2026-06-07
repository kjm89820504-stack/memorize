# 암기외안헤

암기외안헤는 암기가 필요한 내용을 줄 단위로 넣으면 핵심어, 첫글자 조합, 스타일별 암기문장, 복습 퀴즈를 만들어 주는 모바일 우선 공부 보조 앱입니다.

앱 제목은 **암기외안헤 - 암것도 기찮아서 외우고싶지 안타 헤응**이며, Firebase Auth와 Firebase Realtime Database를 사용하고 Vercel 배포를 기준으로 구성했습니다.

## 주요 기능

- 아이디/비밀번호 회원가입, 아이디 중복 확인, 닉네임 설정
- 로그인, 닉네임 변경, 비밀번호 변경
- 폴더 생성 및 암기세트 저장
- 직접 입력 또는 `.txt` 파일 업로드
- 줄 단위 암기 항목 분리
- 핵심어 자동 추출 및 직접 수정
- 첫글자 조합 자동 생성
- 압축형, 깔끔형, 유머형, 스토리형, 시험형 암기문장 생성
- 첫글자 맞히기, 빈칸 채우기, 순서 맞추기 퀴즈
- 퀴즈 정답률, 틀린 문제, 오늘 복습 현황 기록

## 기술 스택

- React
- Vite
- Firebase Auth
- Firebase Realtime Database
- Vercel

## 로컬 실행

```bash
npm install
npm run dev
```

## Firebase 설정

1. Firebase 콘솔에서 새 프로젝트를 만듭니다.
2. Authentication에서 **Email/Password** 로그인을 활성화합니다.
3. Realtime Database를 생성합니다.
4. 웹 앱을 추가하고 Firebase 설정값을 복사합니다.
5. `.env.example`을 복사해 `.env`를 만들고 값을 채웁니다.

```bash
cp .env.example .env
```

현재 프로젝트 주소는 코드와 `.env.example`에 반영되어 있습니다. 최소로 필요한 환경변수는 Firebase 웹 앱 설정의 `apiKey`입니다.

```bash
VITE_FIREBASE_API_KEY=Firebase_콘솔에서_복사한_apiKey
VITE_FIREBASE_AUTH_DOMAIN=memorize-52974.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://memorize-52974-default-rtdb.firebaseio.com/
VITE_FIREBASE_PROJECT_ID=memorize-52974
VITE_FIREBASE_STORAGE_BUCKET=memorize-52974.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

`VITE_FIREBASE_MESSAGING_SENDER_ID`와 `VITE_FIREBASE_APP_ID`는 앱 실행에는 필수로 막지 않지만, Firebase 콘솔의 웹 앱 설정에 표시되면 함께 넣는 것을 권장합니다.

## Realtime Database 보안 규칙

`firebase.rules.json`에 기본 규칙을 넣어 두었습니다.

- `usernames`는 아이디 중복 확인을 위해 읽기를 허용합니다.
- `profiles`, `folders`, `sets`, `reviewLogs`는 로그인한 본인만 읽고 쓸 수 있습니다.

Firebase CLI를 사용한다면 아래처럼 배포할 수 있습니다.

```bash
firebase deploy --only database
```

## Vercel 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Vercel에서 해당 저장소를 Import합니다.
3. Framework Preset은 **Vite**로 둡니다.
4. Vercel Project Settings의 Environment Variables에 `.env.example`과 같은 키를 등록합니다.
5. 배포합니다.

## 데이터 구조

```text
usernames/{username} = uid
profiles/{uid}
folders/{uid}/{folderId}
sets/{uid}/{setId}
reviewLogs/{uid}/{logId}
```

## 참고

Firebase Auth는 이메일 기반 인증을 사용하므로 앱에서는 사용자가 입력한 아이디를 내부 전용 이메일 형식으로 변환합니다. 사용자는 이메일을 입력하지 않고 아이디와 비밀번호로 로그인합니다.

아이디는 Firebase Auth 내부 변환 안정성을 위해 영문, 숫자, `_`, `-` 조합 3~16자로 제한했습니다. 닉네임은 한글로 자유롭게 설정할 수 있습니다.
