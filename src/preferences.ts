export type Preferences = {
  mode: 'impromptu' | 'prepared';
  threshold: number;
  useAiTopic: boolean;
  selected: string[];
};
export function readPreferences(): Preferences {
  const fallback: Preferences = {
    mode: 'impromptu',
    threshold: 1.5,
    useAiTopic: true,
    selected: [],
  };
  try {
    const value = JSON.parse(localStorage.getItem('yifen-preferences') || '{}');
    return {
      mode: value.mode === 'prepared' ? 'prepared' : 'impromptu',
      threshold:
        typeof value.threshold === 'number' && value.threshold >= 0.5 && value.threshold <= 5
          ? value.threshold
          : 1.5,
      useAiTopic: typeof value.useAiTopic === 'boolean' ? value.useAiTopic : true,
      selected: Array.isArray(value.selected)
        ? value.selected.filter((s: unknown): s is string => typeof s === 'string').slice(0, 3)
        : [],
    };
  } catch {
    return fallback;
  }
}
export function savePreferences(value: Preferences) {
  try {
    localStorage.setItem('yifen-preferences', JSON.stringify(value));
  } catch {
    /* Training remains usable when preference storage is unavailable. */
  }
}
