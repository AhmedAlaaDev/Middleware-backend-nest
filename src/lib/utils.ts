export function formatToMonthYear(dateStr: string): string {
  if (!dateStr) return '';

  const date = new Date(dateStr);

  const month = date.toLocaleString('en-US', { month: 'long' });
  const year = date.getFullYear();

  return `${month} ${year}`;
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function getMonthRange(dateStr: string) {
  if (!dateStr) {
    return {
      fromDate: undefined,
      toDate: undefined,
    };
  }

  const date = new Date(dateStr);

  const year = date.getFullYear();
  const month = date.getMonth(); // 0-based

  const fromDate = new Date(Date.UTC(year, month, 1));
  const toDate = new Date(Date.UTC(year, month + 1, 1));

  return {
    fromDate,
    toDate,
  };
}

export function getMonthKey(dateStr: string): string {
  if (!dateStr) return 'invalid-date';

  const d = new Date(dateStr);

  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');

  return `${year}-${month}`; // always YYYY-MM
}
