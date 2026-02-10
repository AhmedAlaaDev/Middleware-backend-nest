export function formatToMonthYear(dateStr: string): string {
  if (!dateStr) return '';

  const date = new Date(dateStr);

  const month = date.toLocaleString('en-US', { month: 'long' });
  const year = date.getFullYear();

  return `${month} ${year}`;
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
    return 'invalid-date';
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');

  return `${year}-${month}`; // always YYYY-MM
}

export const capitalize = (string: string): string => {
  return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
};

export const titleCase = (str: string): string => {
  return str
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};
