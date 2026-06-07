export const EXAMPLE_TEXT = `1. 생명 보호의 원칙
2. 평등과 불평등의 원칙
3. 자율성과 자유의 원칙
4. 최소 손실의 원칙
5. 삶의 질 원칙
6. 사생활 보호와 비밀보장의 원칙
7. 진실 및 정보공개의 원칙`;

const STOP_WORDS = [
  "원칙",
  "법칙",
  "개념",
  "정의",
  "특징",
  "종류",
  "방법",
  "단계",
  "및",
  "그리고",
  "또는",
  "혹은",
  "의",
  "를",
  "을",
  "은",
  "는",
  "이",
  "가",
  "에",
  "로",
  "으로",
];

export function parseLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[-*•]\s*/, "")
        .replace(/^\s*\d+[.)]?\s*/, "")
        .trim(),
    )
    .filter(Boolean);
}

export function extractKeyword(sentence) {
  const cleaned = sentence
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";
  if (cleaned.includes("정보공개")) return "정보공개";
  if (cleaned.includes("사생활")) return "사생활";
  if (cleaned.includes("삶의 질")) return "질";
  if (cleaned.includes("손실")) return "손실";

  const pieces = cleaned
    .split(/[\s,·/]+/)
    .map((piece) =>
      piece
        .replace(/(과|와|과의|와의|의)$/g, "")
        .replace(/(성과|성과의|성과와|성과과)$/g, "성")
        .replace(/(성|적|적인)$/g, "")
        .trim(),
    )
    .filter((piece) => piece && !STOP_WORDS.includes(piece));

  return pieces[0] || cleaned.slice(0, 2);
}

export function firstLetter(keyword) {
  return Array.from(keyword || "")[0] || "?";
}

export function buildAcronym(items) {
  return items.map((item) => firstLetter(item.keyword)).join("");
}

export function badgeLetters(items) {
  return items.map((item) => firstLetter(item.keyword));
}

export function makeMnemonicSentences(items) {
  const keywords = items.map((item) => item.keyword).filter(Boolean);
  const letters = keywords.map((keyword) => firstLetter(keyword));
  const acronym = letters.join("");
  const arrow = keywords.join(" → ");
  const first = keywords[0] || "첫 항목";
  const second = keywords[1] || "다음 항목";
  const last = keywords[keywords.length - 1] || "마지막 항목";
  const letterChunks = chunkText(acronym, 2);

  return [
    {
      id: "compact",
      style: "압축형",
      tag: "초단기",
      text: acronym,
    },
    {
      id: "clean",
      style: "깔끔형",
      tag: "시험장용",
      text: `${first}부터 ${last}까지, ${arrow} 순서로 차분히 기억한다.`,
    },
    {
      id: "humor",
      style: "유머형",
      tag: "피식 태그",
      text: `${letterChunks[0] || acronym}이가 ${letterChunks[1] || second}을 외치자 ${letterChunks.slice(2).join("") || last} 때문에 사정이 생겼다.`,
    },
    {
      id: "story",
      style: "스토리형",
      tag: "장면 기억",
      text: `${first}을 시작으로 ${second}을 만나고, 마지막에는 ${last}까지 챙기는 이야기로 기억한다.`,
    },
    {
      id: "exam",
      style: "시험형",
      tag: "정답 순서",
      text: `${arrow} 순서로 기억한다.`,
    },
  ];
}

export function buildItemsFromText(text) {
  return parseLines(text).map((original, index) => ({
    id: cryptoId(index),
    order: index + 1,
    original,
    keyword: extractKeyword(original),
  }));
}

export function shuffle(list) {
  return [...list]
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
}

export function makeQuiz(set) {
  const items = set.items || [];
  const questions = [];

  items.forEach((item, index) => {
    questions.push({
      id: `letter-${index}`,
      type: "첫글자 맞히기",
      prompt: `"${set.acronym}"에서 '${firstLetter(item.keyword)}'는 무엇일까요?`,
      answer: item.original,
      options: makeOptions(item.original, items),
      explanation: `${firstLetter(item.keyword)} = ${item.keyword}`,
    });
  });

  items.slice(1, -1).forEach((item, index) => {
    const actualIndex = index + 1;
    questions.push({
      id: `blank-${actualIndex}`,
      type: "빈칸 채우기",
      prompt: makeBlankPrompt(items, actualIndex),
      answer: item.original,
      options: makeOptions(item.original, items),
      explanation: `${actualIndex + 1}번째 항목은 ${item.original}입니다.`,
    });
  });

  items.forEach((item, index) => {
    questions.push({
      id: `order-${index}`,
      type: "순서 맞추기",
      prompt: `다음 중 ${index + 1}번째로 와야 하는 항목은 무엇일까요?`,
      answer: item.original,
      options: makeOptions(item.original, items),
      explanation: `${index + 1}번째 순서는 ${item.original}입니다.`,
    });
  });

  return shuffle(questions).slice(0, Math.min(12, Math.max(items.length, 5)));
}

function makeOptions(answer, items) {
  const wrong = shuffle(items.map((item) => item.original).filter((text) => text !== answer));
  return shuffle([answer, ...wrong.slice(0, 3)]);
}

function makeBlankPrompt(items, blankIndex) {
  return items
    .map((item, index) => (index === blankIndex ? "________" : item.original))
    .join(" → ");
}

function chunkText(text, size) {
  const letters = Array.from(text || "");
  const chunks = [];
  for (let index = 0; index < letters.length; index += size) {
    chunks.push(letters.slice(index, index + size).join(""));
  }
  return chunks;
}

function cryptoId(index) {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `item-${Date.now()}-${index}`;
}
