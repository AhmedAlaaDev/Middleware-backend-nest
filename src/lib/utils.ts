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
