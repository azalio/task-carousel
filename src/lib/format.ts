// Форматирование дат в локальном времени пользователя (§4.5).

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' });

export function formatDateTime(ms: number): string {
  return dateTimeFormat.format(new Date(ms));
}

export function formatDate(ms: number): string {
  return dateFormat.format(new Date(ms));
}

// Русское склонение: pluralRu(3, ['запись', 'записи', 'записей']) -> 'записи'.
export function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
