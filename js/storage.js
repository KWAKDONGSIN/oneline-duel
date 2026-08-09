const STORAGE_KEY = "old:v1";

const DEFAULT_DATA = {
  character: null,
  progress: { beatenBossIds: [] },
  daily: {},
  settings: { judgeUrl: "http://localhost:8787", offline: false, tutorialSeen: false },
  record: { wins: 0, losses: 0 },
  // 로그인 계정 관련 로컬 상태. inherited는 게스트 기록을 계정에 한 번만 승계하기 위한 표시다.
  account: { inherited: false },
};

export function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      ...DEFAULT_DATA,
      ...saved,
      progress: { ...DEFAULT_DATA.progress, ...saved.progress },
      settings: { ...DEFAULT_DATA.settings, ...saved.settings },
      record: { ...DEFAULT_DATA.record, ...saved.record },
      account: { ...DEFAULT_DATA.account, ...saved.account },
    };
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

export function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function saveCharacter(character) {
  const data = loadData();
  data.character = character;
  saveData(data);
  return data;
}

export function saveSettings(settings) {
  const data = loadData();
  data.settings = { ...data.settings, ...settings };
  saveData(data);
  return data;
}
