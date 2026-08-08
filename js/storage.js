const STORAGE_KEY = "old:v1";

const DEFAULT_DATA = {
  character: null,
  progress: { beatenBossIds: [] },
  daily: {},
  settings: { judgeUrl: "http://localhost:8787", offline: false, tutorialSeen: false },
  record: { wins: 0, losses: 0 },
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
